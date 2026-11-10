import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTED = path.join(ROOT, "dist", "hosted");
const MOUNT = "/embedded/tools/offline-speech/";
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((file) => file && fs.existsSync(file));
const status = (page) => page.$eval("#status", (el) => el.textContent);
async function waitState(page, expression, timeout = 180000) { await page.waitForFunction(expression, { timeout, polling: 50 }); }
async function readyModel(page) {
  await page.click("#load-model");
  await waitState(page, () => !document.querySelector("#speak").disabled || document.querySelector("#status").textContent.startsWith("Error"));
  assert.match(await status(page), /^Ready/);
}
async function speak(page) {
  await page.$eval("#text", (el) => { el.value = "Hello from the offline bookmark."; });
  await page.click("#speak");
  await waitState(page, () => /^(Done|Audio is ready|Error)/.test(document.querySelector("#status").textContent));
  assert.match(await status(page), /^(Done|Audio is ready)/);
  const audio = await page.evaluate(async () => {
    const link = document.querySelector("#download");
    const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    document.querySelector("audio").pause();
    return { rate: view.getUint32(24, true), bytes: bytes.length, nonzero: bytes.slice(44).some((value) => value !== 0) };
  });
  assert.equal(audio.rate, 24000);
  assert.ok(audio.bytes > 48044 && audio.nonzero);
}

test("hosted output is self-contained, integrity-pinned, and fits static-host file limits", async () => {
  const { MANIFEST } = await import(pathToFileURL(path.join(HOSTED, "manifest.js")));
  for (const asset of MANIFEST.assets) {
    const hash = createHash("sha256");
    let size = 0;
    assert.ok(["model", "library"].includes(asset.kind));
    for (const part of asset.parts) {
      const bytes = fs.readFileSync(path.join(HOSTED, part.url));
      assert.ok(bytes.length <= 8 * 1024 * 1024);
      assert.equal(bytes.length, part.size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), part.sha256);
      hash.update(bytes); size += bytes.length;
    }
    assert.equal(size, asset.size);
    assert.equal(hash.digest("hex"), asset.sha256);
  }
  const kokoro = MANIFEST.assets.find((asset) => asset.key === "kokoro-js");
  const source = fs.readFileSync(path.join(HOSTED, kokoro.parts[0].url), "utf8");
  assert.ok(!source.includes('from"@huggingface/transformers"'));
  assert.ok(!source.includes('caches.open("kokoro-voices")'));
});

test("a subdirectory bookmark survives a cold offline browser and lets users reclaim disk and RAM", { timeout: 420000 }, async (t) => {
  assert.ok(chrome, "Chrome is required; set CHROME_PATH");
  const { MANIFEST } = await import(pathToFileURL(path.join(HOSTED, "manifest.js")));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-hosted-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const requests = new Map();
  const failedPart = MANIFEST.assets.find((asset) => asset.key === "ort.wasm").parts[0].url;
  const completedPart = MANIFEST.assets.find((asset) => asset.key === "node-shim").parts[0].url;
  let failOnce = true;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith(MOUNT)) { res.writeHead(404); res.end(); return; }
    const relative = decodeURIComponent(pathname.slice(MOUNT.length)) || "index.html";
    requests.set(relative, (requests.get(relative) ?? 0) + 1);
    if (relative === "cache-seed.html") { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end("<!doctype html><title>Cache seed</title>"); return; }
    if (relative === failedPart && failOnce) { failOnce = false; res.writeHead(503); res.end(); return; }
    const file = path.resolve(HOSTED, relative);
    if (!file.startsWith(`${HOSTED}${path.sep}`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = [".js", ".mjs"].includes(path.extname(file)) ? "text/javascript" : file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Vary": "Accept-Encoding", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' blob:; style-src 'self'; img-src 'self'; media-src 'self' blob:" });
    const stream = fs.createReadStream(file, { highWaterMark: 65536 });
    stream.on("data", (chunk) => {
      stream.pause();
      if (!res.destroyed) res.write(chunk);
      setTimeout(() => stream.resume(), 1);
    });
    stream.on("end", () => res.end());
    res.on("close", () => stream.destroy());
  });
  const listen = (port = 0) => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const closeServer = () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  await listen();
  t.after(() => closeServer());
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${MOUNT}`;
  let browser;
  const pageErrors = [];
  const launch = async () => {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, protocolTimeout: 300000,
      args: process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
    const page = await browser.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    return page;
  };
  try {
    let page = await launch();
    // Seed an older payload before the new service worker activates, as on upgrade.
    await page.goto(`${url}cache-seed.html`);
    const cacheNames = await page.evaluate(async (id) => {
      const { PREFIX, DATA_CACHE } = await import(new URL(`storage.js?v=${id}`, location.href));
      const obsolete = `${PREFIX}data:obsolete-version`;
      await (await caches.open(obsolete)).put(new URL("old-model", location.href), new Response("obsolete model"));
      await (await caches.open(DATA_CACHE)).put(new URL("current-marker", location.href), new Response("keep current"));
      await (await caches.open("parent-application")).put("/parent-marker", new Response("keep me"));
      return { obsolete, current: DATA_CACHE };
    }, MANIFEST.id);
    await page.goto(url);
    await waitState(page, () => !document.querySelector("#save-offline").disabled || document.querySelector("#status").textContent.startsWith("Error"));
    assert.ok(!/^Error/.test(await status(page)), await status(page));
    assert.match(await page.$eval("#next-step", el => el.textContent), /Step 1 of 3.*Download/);
    assert.equal(await page.$eval("#save-offline", el => getComputedStyle(el).backgroundColor), "rgb(210, 153, 34)");
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    assert.equal(await page.$eval("body", el => getComputedStyle(el).backgroundColor), "rgb(13, 17, 23)");
    await page.select("#theme", "light");
    assert.equal(await page.$eval("body", el => getComputedStyle(el).backgroundColor), "rgb(246, 247, 249)");
    await page.select("#theme", "dark");
    assert.equal(await page.$eval("body", el => getComputedStyle(el).backgroundColor), "rgb(13, 17, 23)");
    const upgrade = await page.evaluate(async ({ obsolete, current }) => ({
      removedOld: !(await caches.has(obsolete)),
      keptCurrent: await (await caches.open(current)).match(new URL("current-marker", location.href)).then((r) => r?.text()),
      keptParent: await (await caches.open("parent-application")).match("/parent-marker").then((r) => r?.text()),
    }), cacheNames);
    assert.deepEqual(upgrade, { removedOld: true, keptCurrent: "keep current", keptParent: "keep me" });
    assert.equal(await page.$eval("#ram-usage", (el) => el.textContent), "Model unloaded");
    const matches = await page.evaluate(async () => {
      const storageUrl = document.querySelector('script[type="module"]').src.replace("app.js", "storage.js");
      const { resolveAsset } = await import(storageUrl);
      return [
        !!resolveAsset("https://example.test/@huggingface/transformers"),
        !!resolveAsset("/models/onnx-community/Kokoro-82M-v1.0-ONNX/config.json"),
      ];
    });
    assert.deepEqual(matches, [false, true], "library names must never match model-file requests");
    await page.click("#save-offline");
    await waitState(page, () => { const p = document.querySelector("progress"); return p.value > 0 && p.value < p.max; });
    await waitState(page, () => document.querySelector("#status").textContent.startsWith("Download failed"));
    assert.ok(await page.$eval("#download-progress", (el) => el.value < el.max));
    const savedRequests = requests.get(completedPart);
    await page.click("#save-offline");
    await waitState(page, () => !document.querySelector("#cancel-download").hidden);
    await page.click("#cancel-download");
    await waitState(page, () => document.querySelector("#status").textContent.startsWith("Download cancelled") && !document.querySelector("#save-offline").disabled);
    await page.click("#save-offline");
    await waitState(page, () => document.querySelector("#offline-state").textContent.startsWith("Ready offline") && !document.querySelector("#load-model").disabled);
    assert.equal(requests.get(completedPart), savedRequests, "completed pieces must not download again");
    assert.equal(await page.$eval("#download-progress", (el) => el.value === el.max), true);
    assert.match(await page.$eval("#next-step", el => el.textContent), /Step 2 of 3.*Load model/);
    console.log("[hosted] Verified download, visible progress and resume");
    await readyModel(page);
    assert.match(await page.$eval("#ram-usage", (el) => el.textContent), /estimate/);
    assert.match(await page.$eval("#next-step", el => el.textContent), /Step 3 of 3.*Speak/);
    await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Playback blocked", "NotAllowedError")); });
    await speak(page);
    assert.match(await status(page), /Press Speak again.*Automatic playback was blocked/);
    assert.equal(await page.$eval("#audio", el => el.hidden && !el.controls), true);
    assert.match(await page.$eval("#phoneme-state", el => el.textContent), /1 \/ 1 chunk prepared/);
    assert.match(await page.$eval("#generation-state", el => el.textContent), /5 \/ 5 words complete/);
    assert.ok((await page.$eval("#phoneme-text", el => el.textContent)).length > 5);
    const downloadUrl = await page.$eval("#download", (el) => el.href);
    await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); });
    await page.click("#speak");
    await waitState(page, () => document.querySelector("#status").textContent === "Done — playing the prepared speech.");
    assert.equal(await page.$eval("#download", el => el.href), downloadUrl, "Speak retries playback without regenerating the file");
    await page.evaluate(() => {
      window.playbackAttempts = []; window.playbackReports = [];
      window.playbackObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) window.playbackReports.push(node.textContent);
      });
      window.playbackObserver.observe(document.querySelector("#status"), { childList: true });
      HTMLMediaElement.prototype.play = () => new Promise((resolve, reject) => window.playbackAttempts.push({ resolve, reject }));
    });
    await page.click("#speak");
    await page.click("#speak");
    await page.evaluate(() => {
      window.playbackAttempts[0].reject(new DOMException("Interrupted by replay", "AbortError"));
      window.playbackAttempts[1].resolve();
    });
    await waitState(page, () => document.querySelector("#status").textContent === "Done — playing the prepared speech.");
    assert.ok(!(await page.evaluate(() => window.playbackReports)).some(message => /blocked/.test(message)), "cancelled replay must never flash a false policy-block message");
    await page.evaluate(() => { window.playbackObserver.disconnect(); HTMLMediaElement.prototype.play = () => Promise.resolve(); });
    const diskBefore = await page.$eval("#disk-usage", (el) => el.textContent);
    const stopped = new Promise((resolve) => page.once("workerdestroyed", resolve));
    assert.equal(await page.$eval("#unload-saved-model", el => el.hidden), false);
    assert.match(await page.$eval("#offline-state", el => el.textContent), /model loaded in RAM/);
    await page.click("#unload-saved-model");
    await stopped;
    assert.equal(await page.$eval("#ram-usage", (el) => el.textContent), "Model unloaded");
    assert.equal(await page.$eval("#unload-saved-model", el => el.hidden), true);
    assert.match(await page.$eval("#offline-state", el => el.textContent), /model not loaded in RAM/);
    await page.click("#speak");
    await waitState(page, () => document.querySelector("#status").textContent === "Done — playing the prepared speech.");
    assert.equal(page.workers().length, 0, "replay must not restart the unloaded inference worker");
    await page.$eval("#text", el => { el.value += " Changed."; el.dispatchEvent(new Event("input")); });
    assert.equal(await page.$eval("#speak", el => el.disabled), true, "changed text requires the model to be loaded");
    assert.equal(await page.$eval("#disk-usage", (el) => el.textContent), diskBefore);
    assert.equal(await page.$eval("#download", (el) => el.href), downloadUrl);
    assert.ok(!(await page.evaluate(() => caches.keys())).includes("kokoro-voices"));

    console.log("[hosted] Verified online speech and worker unloading");
    // No server, no old renderer, no loaded model: only persistent offline storage remains.
    await browser.close(); browser = undefined;
    await closeServer();
    page = await launch();
    await page.setOfflineMode(true);
    const navigation = await page.goto(url);
    assert.equal(navigation.fromServiceWorker(), true);
    await waitState(page, () => !document.querySelector("#load-model").disabled);
    assert.equal(await page.$eval("#theme", el => el.value), "dark");
    const offlineNotices = await page.evaluate(async () => Promise.all(["LICENSE.txt", "THIRD_PARTY_NOTICES.txt"].map(async file => {
      const response = await fetch(file); return { ok: response.ok, text: await response.text() };
    })));
    assert.ok(offlineNotices.every(file => file.ok));
    assert.match(offlineNotices[0].text, /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
    assert.match(offlineNotices[1].text, /eSpeak NG/);
    await readyModel(page);
    await speak(page);
    assert.match(await page.$eval("#audio-cache-info", el => el.textContent), /1 \/ 10/);
    await page.click("#clear-audio-cache");
    assert.match(await page.$eval("#audio-cache-info", el => el.textContent), /0 \/ 10/);
    assert.equal(await page.$eval("#speak", el => el.disabled), false, "clearing clips keeps the loaded model ready");
    console.log("[hosted] Verified cold-browser offline navigation and real speech");
    await page.evaluate(async () => {
      const foreign = await caches.open("parent-application");
      await foreign.put("/parent-marker", new Response("keep me"));
    });
    const stoppedOffline = new Promise((resolve) => page.once("workerdestroyed", resolve));
    await page.click("#delete-offline");
    await stoppedOffline;
    await waitState(page, () => document.querySelector("#status").textContent.startsWith("Offline files deleted"));
    assert.equal(await page.$eval("#load-model", (el) => el.disabled), true);
    assert.equal(await page.$eval("#ram-usage", (el) => el.textContent), "Model unloaded");
    assert.equal(await page.evaluate(async () => (await caches.open("parent-application")).match("/parent-marker").then((r) => r.text())), "keep me");
    const ownCaches = await page.evaluate(() => caches.keys());
    assert.ok(!ownCaches.some((name) => name.startsWith("offline-speech:") && name.includes(":data:")));
    await page.reload();
    await waitState(page, () => !document.querySelector("#save-offline").disabled);
    assert.equal(await page.$eval("#load-model", (el) => el.disabled), true, "the small shell still opens offline after deleting model files");

    console.log("[hosted] Verified offline deletion, retained page shell and parent-cache isolation");
    await listen(port);
    await page.setOfflineMode(false);
    await page.click("#save-offline");
    await waitState(page, () => document.querySelector("#offline-state").textContent.startsWith("Ready offline") && !document.querySelector("#load-model").disabled);
    const other = await browser.newPage();
    await other.goto(url);
    await waitState(other, () => !document.querySelector("#load-model").disabled);
    await readyModel(other);
    const stoppedOther = new Promise((resolve) => other.once("workerdestroyed", resolve));
    await page.bringToFront();
    await page.evaluate(() => document.querySelector("#delete-offline").click());
    await stoppedOther;
    await waitState(other, () => document.querySelector("#ram-usage").textContent === "Model unloaded" && document.querySelector("#load-model").disabled);
    assert.deepEqual(pageErrors, []);
  } finally { await browser?.close(); }
});
