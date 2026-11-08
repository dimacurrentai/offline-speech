import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { unpackAsset } from "../src/unpack.mjs";

// The small CharacterData surface used by the decoder; whole-asset reads fail.
function asset(parts, type = "application/octet-stream") {
  const el = {
    dataset: { type }, firstChild: null, detached: false,
    remove() { this.detached = true; },
    replaceChildren() { this.firstChild = null; },
    get textContent() { throw new Error("Do not copy the full encoded asset"); },
  };
  let next = null;
  for (const text of parts.toReversed()) {
    const node = { length: text.length, nextSibling: next,
      substringData: (offset, count) => text.slice(offset, offset + count),
      remove() { assert.equal(el.firstChild, this); el.firstChild = this.nextSibling; this.nextSibling = null; },
    };
    next = node;
  }
  el.firstChild = next;
  return el;
}

test("gzip assets decode byte-for-byte across padding and DOM text-node boundaries", async () => {
  for (const size of [0, 1, 2, 3, 49153, 200003]) {
    const bytes = randomBytes(size);
    const encoded = gzipSync(bytes).toString("base64");
    const el = asset([encoded.slice(0, 1), "", encoded.slice(1, 3), encoded.slice(3, 65535), encoded.slice(65535)], "text/javascript");
    const blob = await unpackAsset(el);
    assert.equal(blob.type, "text/javascript");
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    assert.equal(el.detached, true);
    assert.equal(el.firstChild, null);
  }
});

test("large assets use bounded base64 pieces and never fetch a data URL", async (t) => {
  const bytes = randomBytes(2 * 1024 * 1024);
  const el = asset([gzipSync(bytes).toString("base64")]);
  const originalAtob = globalThis.atob, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.atob = originalAtob; globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.atob = (encoded) => {
    assert.ok(encoded.length <= 64 * 1024);
    calls++;
    return originalAtob(encoded);
  };
  globalThis.fetch = () => { throw new Error("Asset decoding must not use fetch"); };
  const blob = await unpackAsset(el);
  assert.ok(calls > 1);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  assert.equal(el.firstChild, null);
});

test("invalid base64 and corrupt gzip fail and release the encoded source", async () => {
  for (const encoded of ["not base64!", Buffer.from("not gzip").toString("base64"), ""]) {
    const el = asset([encoded]);
    await assert.rejects(unpackAsset(el));
    assert.equal(el.detached, true);
    assert.equal(el.firstChild, null);
  }
});
