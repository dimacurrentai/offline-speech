import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";

const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(file => file && fs.existsSync(file));
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

// Tiny payloads exercise the real page, storage, and worker update lifecycle,
// without downloading or synthesizing a model in this regression test.
function release(id) {
  const files = Object.fromEntries(["app.js", "storage.js", "updates.js", "sw.js", "style.css", "index.html"]
    .map(name => [name, read(`src/hosted/${name}`)]));
  files["audio.js"] = read("src/audio.mjs");
  files["tts-worker.js"] = `// worker for ${id}`;
  files["prnui.css"] = read("third_party/prnui/prnui.html").match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  files["favicon.svg"] = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
  files["index.html"] = files["index.html"].replace("<!--SPEECH_PROGRESS-->", read("src/speech-progress.html"));
  const assets = ["unchanged model", `runtime ${id}`].map((bytes, index) => {
    const url = `assets/${sha(bytes)}.bin`;
    files[url] = bytes;
    return { key: `fixture-${index}`, url, kind: "library", size: bytes.length, type: "application/octet-stream",
      sha256: sha(bytes), parts: [{ url, size: bytes.length, sha256: sha(bytes) }] };
  });
  const shell = [...Object.keys(files).filter(name => !name.startsWith("assets/") && name !== "sw.js"), "manifest.js"]
    .map(name => /\.(js|css)$/.test(name) ? `${name}?v=${id}` : name);
  files["manifest.js"] = `export const MANIFEST = ${JSON.stringify({ id, dataId: id, assets, shell, voices: [{ id: "voice", label: "Voice" }] })};`;
  for (const [name, source] of Object.entries(files)) {
    files[name] = name.endsWith(".js") ? source.replace(/from "(\.\/[^"?]+\.js)"/g, (_, url) => `from "${url}?v=${id}"`)
      : name === "index.html" ? source.replace(/(\.\/(?:app\.js|prnui\.css|style\.css))"/g, `$1?v=${id}"`) : source;
  }
  return { files, assets };
}

test("updates preserve legacy downloads, old tabs, drafts, and offline use; only changed parts download", { timeout: 60000 }, async t => {
  assert.ok(chrome, "Chrome is required; set CHROME_PATH");
  const first = release("one"), second = release("two");
  let current = first;
  const downloads = [];
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname.replace(/^\/tts\//, "") || "index.html";
    const body = current.files[name];
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    if (name.startsWith("assets/")) downloads.push(name);
    const type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".html") ? "text/html" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}/tts/`;
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector("#save-offline").disabled);
  await page.click("#save-offline");
  await page.waitForFunction(() => !document.querySelector("#load-model").disabled);
  assert.equal(downloads.length, 2);
  // Simulate the cache name used by already-deployed releases.
  await page.evaluate(async () => {
    const { PREFIX, DATA_CACHE } = await import("./storage.js?v=one");
    const source = await caches.open(DATA_CACHE), legacy = await caches.open(`${PREFIX}data:old-payload`);
    for (const request of await source.keys()) await legacy.put(request, await source.match(request));
    await caches.delete(DATA_CACHE);
    await (await caches.open("other-app")).put("/marker", new Response("untouched"));
  });
  await page.$eval("#text", el => { el.value = "Keep my draft across the update."; });
  current = second;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(() => !document.querySelector("#app-update").hidden);
  // The server no longer has the old runtime; the active worker still serves it.
  assert.equal(await page.evaluate(async url => (await fetch(url)).text(), first.assets[1].url), "runtime one");
  assert.equal(await page.evaluate(async () => (await fetch("./tts-worker.js?v=one")).text()), "// worker for one");
  const oldUsage = await page.evaluate(async () => (await import("./storage.js?v=one")).getUsage());
  assert.equal(oldUsage.complete, true);

  const newPage = await browser.newPage();
  await newPage.goto(url);
  await newPage.waitForFunction(() => !document.querySelector("#save-offline").disabled);
  const usage = await newPage.evaluate(async () => (await import("./storage.js?v=two")).getUsage());
  assert.equal(usage.savedBytes, first.assets[0].size);
  await newPage.click("#save-offline");
  await newPage.waitForFunction(() => !document.querySelector("#load-model").disabled);
  assert.deepEqual(downloads, [first.assets[0].url, first.assets[1].url, second.assets[1].url]);
  assert.equal(await page.evaluate(async () => {
    const { readAsset } = await import("./storage.js?v=one");
    const { MANIFEST } = await import("./manifest.js?v=one");
    return (await readAsset(MANIFEST.assets[1])).text();
  }), "runtime one");

  await page.bringToFront();
  await page.waitForFunction(() => !document.querySelector("#reload-update").disabled);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }), page.click("#reload-update")]);
  await page.waitForFunction(() => !document.querySelector("#load-model").disabled);
  assert.equal(await page.$eval("#text", el => el.value), "Keep my draft across the update.");
  assert.equal(await page.$eval("#app-update", el => el.hidden), true);
  await page.setOfflineMode(true);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#load-model").disabled);
  await page.click("#delete-offline");
  await page.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Offline files deleted"));
  assert.equal(await page.evaluate(async () => (await caches.keys()).some(name => name.includes(":data:"))), false);
  assert.equal(await page.evaluate(async () => (await (await caches.open("other-app")).match("/marker")).text()), "untouched");
});
