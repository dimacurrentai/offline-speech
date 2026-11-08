import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { downloadFile } from "../scripts/download.mjs";

const bytes = Buffer.from("verified model bytes");
const expected = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const options = { attempts: 2, retryDelayMs: 0, log: () => {} };
async function fixture(t, handler) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-speech-download-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer((req, res) => { requests.push(req.headers.range); handler(req, res, requests.length); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { target: path.join(dir, "asset"), url: `http://127.0.0.1:${server.address().port}/asset`, requests };
}

test("verified files are skipped; corrupt files are replaced", async (t) => {
  const { target, url, requests } = await fixture(t, (_req, res) => res.end(bytes));
  await fs.writeFile(target, bytes);
  await downloadFile(url, target, expected, options);
  assert.equal(requests.length, 0);
  await fs.writeFile(target, Buffer.alloc(bytes.length));
  await downloadFile(url, target, expected, options);
  assert.equal(requests.length, 1);
  assert.deepEqual(await fs.readFile(target), bytes);
});

test("completed partial files are verified and promoted without downloading", async (t) => {
  const { target, url, requests } = await fixture(t, (_req, res) => res.end(bytes));
  await fs.writeFile(`${target}.part`, bytes);
  await downloadFile(url, target, expected, options);
  assert.equal(requests.length, 0);
  assert.deepEqual(await fs.readFile(target), bytes);
});

for (const mode of ["resume", "ignore Range", "resume incorrectly", "reject Range"]) {
  test(`partial downloads recover when servers ${mode}`, async (t) => {
    const { target, url, requests } = await fixture(t, (_req, res, count) => {
      if (count === 1 && mode === "resume") { res.writeHead(206); res.end(bytes.subarray(4)); }
      else if (count === 1 && mode === "resume incorrectly") { res.writeHead(206); res.end(bytes); }
      else if (count === 1 && mode === "reject Range") { res.writeHead(416); res.end(); }
      else res.end(bytes);
    });
    await fs.writeFile(`${target}.part`, bytes.subarray(0, 4));
    await downloadFile(url, target, expected, options);
    assert.equal(requests[0], "bytes=4-");
    assert.equal(requests.length, ["resume incorrectly", "reject Range"].includes(mode) ? 2 : 1);
    if (requests.length === 2) assert.equal(requests[1], undefined);
    assert.deepEqual(await fs.readFile(target), bytes);
  });
}

test("failed verification deletes the partial file and preserves the previous output", async (t) => {
  const { target, url } = await fixture(t, (_req, res) => res.end(Buffer.alloc(bytes.length)));
  await fs.writeFile(target, "previous");
  await assert.rejects(downloadFile(url, target, expected, { ...options, attempts: 1 }), /SHA-256/);
  assert.equal(await fs.readFile(target, "utf8"), "previous");
  await assert.rejects(fs.stat(`${target}.part`), { code: "ENOENT" });
});

test("HTTP failures stop after the configured retries", async (t) => {
  const { target, url, requests } = await fixture(t, (_req, res) => { res.writeHead(503); res.end(); });
  await assert.rejects(downloadFile(url, target, expected, options), /HTTP 503/);
  assert.equal(requests.length, 2);
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
});

test("slow transfers keep running while data arrives within the idle timeout", async (t) => {
  const { target, url, requests } = await fixture(t, (_req, res) => {
    let offset = 0;
    const send = () => {
      res.write(bytes.subarray(offset, offset += 2));
      if (offset >= bytes.length) res.end();
    };
    const interval = setInterval(send, 50);
    res.on("close", () => clearInterval(interval));
    send();
  });
  const started = Date.now();
  await downloadFile(url, target, expected, { ...options, idleTimeoutMs: 200 });
  assert.ok(Date.now() - started > 200, "the total transfer exceeded the idle timeout");
  assert.equal(requests.length, 1);
  assert.deepEqual(await fs.readFile(target), bytes);
});

test("progress resets the retry budget across more interrupted transfers than the limit", async (t) => {
  const { target, url, requests } = await fixture(t, (req, res) => {
    const offset = Number(req.headers.range?.match(/\d+/)[0] ?? 0);
    res.writeHead(offset ? 206 : 200);
    res.write(bytes.subarray(offset, offset + 4));
    if (offset + 4 >= bytes.length) res.end(); // Otherwise stall until the client resumes.
  });
  await downloadFile(url, target, expected, { ...options, idleTimeoutMs: 200 });
  assert.ok(requests.length > options.attempts);
  assert.deepEqual(await fs.readFile(target), bytes);
});

test("a connection with no incoming data still exhausts the retry budget", async (t) => {
  const { target, url, requests } = await fixture(t, () => {});
  await assert.rejects(downloadFile(url, target, expected, { ...options, idleTimeoutMs: 100 }), /stalled|aborted/i);
  assert.equal(requests.length, options.attempts);
});
