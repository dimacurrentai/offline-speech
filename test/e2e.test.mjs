// Run after building. CHROME_PATH selects Chrome; CHROME_NO_SANDBOX=1 is for containers
// that cannot launch Chrome's sandbox. All application network requests are blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { VOICES } from "../src/assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "dist", "offline-speech.html");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ...(process.platform === "win32" ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean).map((dir) => path.join(dir, "Google", "Chrome", "Application", "chrome.exe")) : []),
];

async function waitForEnd(page) {
  await page.waitForFunction(() => /^(Done|Error|Cancelled)/.test(document.getElementById("status").textContent),
    { timeout: 180_000, polling: 50 });
  return page.$eval("#status", (el) => el.textContent);
}
async function setInput(page, text, voice = "af_heart") {
  await page.evaluate((text, voice) => {
    document.getElementById("text").value = text;
    document.getElementById("voice").value = voice;
  }, text, voice);
}
async function inspectWav(page) {
  return page.evaluate(async () => {
    const link = document.getElementById("download");
    const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const ascii = (offset) => String.fromCharCode(...bytes.slice(offset, offset + 4));
    let sum = 0, peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) {
      const value = view.getInt16(offset, true) / 32768;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    document.getElementById("audio").pause();
    return {
      filename: link.download, sameAsPlayer: link.href === document.getElementById("audio").src,
      riff: ascii(0), wave: ascii(8), format: view.getUint16(20, true), channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true), bits: view.getUint16(34, true),
      dataBytes: view.getUint32(40, true), totalBytes: bytes.length,
      rms: Math.sqrt(sum / ((bytes.length - 44) / 2)), peak,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join(""),
    };
  });
}

function assertWav(wav) {
  assert.equal(wav.filename, "offline-speech.wav");
  assert.equal(wav.sameAsPlayer, true);
  assert.equal(wav.riff, "RIFF");
  assert.equal(wav.wave, "WAVE");
  assert.equal(wav.format, 1);
  assert.equal(wav.channels, 1);
  assert.equal(wav.sampleRate, 24000);
  assert.equal(wav.bits, 16);
  assert.equal(wav.dataBytes, wav.totalBytes - 44);
  assert.ok(wav.dataBytes > 24000 * 2, "expected more than a second of audio");
  assert.ok(wav.rms > 0.001 && wav.peak > 0.01, "expected non-silent audio");
}

test("the standalone application works offline", { timeout: 600_000 }, async (t) => {
  assert.ok(fs.existsSync(PAGE), "dist/offline-speech.html is missing: run npm run build first");
  const chrome = CHROME_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(chrome, "Chrome not found: set CHROME_PATH");
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-e2e-"));
  t.after(() => fs.rmSync(downloads, { recursive: true, force: true }));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 300_000,
    args: process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
  try {
    const page = await browser.newPage();
    const blocked = [], pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (/^(file|data|blob):/.test(request.url())) return request.continue();
      blocked.push(request.url());
      request.abort();
    });
    await page.evaluateOnNewDocument(() => {
      const originalFetch = window.fetch.bind(window);
      window.assetDataRequests = 0;
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("data:application/octet-stream;base64,")) {
          window.assetDataRequests++;
          throw new Error("Embedded assets must decode without data-URL fetches");
        }
        return originalFetch(input, init);
      };
    });
    await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction(() => !document.getElementById("speak").disabled || /^Error/.test(document.getElementById("status").textContent),
      { timeout: 180_000, polling: 250 });
    assert.match(await page.$eval("#status", (el) => el.textContent), /^Ready/);

    await t.test("startup consumes the encoded assets without data-URL fetches", async () => {
      assert.equal(await page.evaluate(() => window.assetDataRequests), 0);
      assert.equal(await page.$$eval("script[data-asset]", (elements) => elements.length), 0);
    });

    await t.test("the fetch adapter serves model files but never library names", async () => {
      const statuses = await page.evaluate(async () => Promise.all([
        "/models/onnx-community/Kokoro-82M-v1.0-ONNX/config.json",
        "https://huggingface.co/any/revision/voices/af_heart.bin",
        "https://example.test/@huggingface/transformers",
        "https://example.test/kokoro-js",
      ].map(async (url) => (await fetch(url)).status)));
      assert.deepEqual(statuses, [200, 200, 404, 404]);
    });

    // Record the actual production generation calls without altering inference.
    await page.evaluate(async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const original = KokoroTTS.prototype.generate;
      window.testCalls = [];
      KokoroTTS.prototype.generate = function (text, options) {
        const call = { text, voice: options.voice };
        window.testCalls.push(call);
        return original.call(this, text, options).then((out) => { call.samples = out.audio.length; return out; });
      };
    });

    for (const { id } of VOICES) {
      await t.test(`${id} produces a non-silent WAV offline`, async () => {
        await setInput(page, "Hello from our offline speech test.", id);
        await page.click("#speak");
        assert.match(await waitForEnd(page), /^Done — [\d.]+s of audio at 24000 Hz/);
        assertWav(await inspectWav(page));
      });
    }

    await t.test("two short utterances are joined with the expected silence", async () => {
      // Padding crosses the real 300-character boundary without generating a long speech.
      const text = `Hello${" ".repeat(287)}world. Hello again.`;
      await page.evaluate(() => { window.testCalls = []; });
      await setInput(page, text);
      await page.click("#speak");
      assert.match(await waitForEnd(page), /^Done/);
      const calls = await page.evaluate(() => window.testCalls);
      assert.equal(calls.length, 2);
      assert.equal(calls.map((call) => call.text).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
      const wav = await inspectWav(page);
      assertWav(wav);
      assert.equal(wav.dataBytes / 2, calls[0].samples + 3600 + calls[1].samples);
      assert.equal(await page.evaluate(async (start) => {
        const data = new DataView(await (await fetch(document.getElementById("download").href)).arrayBuffer());
        return Array.from({ length: 3600 }, (_, i) => data.getInt16(44 + (start + i) * 2, true)).every((sample) => sample === 0);
      }, calls[0].samples), true);
    });

    await t.test("clicking Download WAV saves exactly the generated audio", async () => {
      const cdp = await browser.target().createCDPSession();
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
      const wav = await inspectWav(page);
      await page.click("#download");
      const file = path.join(downloads, "offline-speech.wav");
      const deadline = Date.now() + 15_000;
      while ((!fs.existsSync(file) || fs.existsSync(`${file}.crdownload`)) && Date.now() < deadline) await delay(50);
      assert.ok(fs.existsSync(file), "download did not complete");
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.length, wav.totalBytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), wav.hash);
      await cdp.detach();
    });

    // Use controlled inference responses for deterministic failure and race tests.
    // The page's event handlers, state management, chunking, and WAV encoder stay real.
    await page.evaluate(async () => {
      const { KokoroTTS } = await import("kokoro-js");
      window.testCalls = [];
      window.testMode = "normal";
      window.testDefer = false;
      KokoroTTS.prototype.generate = async (text, options) => {
        window.testCalls.push({ text, voice: options.voice });
        if (window.testDefer) await new Promise((resolve) => { window.testRelease = resolve; });
        if (window.testMode === "error") throw new Error("test inference failure");
        return {
          audio: window.testMode === "empty" ? new Float32Array() : new Float32Array(2400).fill(window.testMode === "invalid" ? NaN : 0.25),
          sampling_rate: window.testMode === "rate-change" && window.testCalls.length > 1 ? 22050 : 24000,
        };
      };
    });

    await t.test("shortcuts cannot overlap jobs, truncate words, or change a job's voice", async () => {
      await page.evaluate(() => { window.testCalls = []; window.testDefer = true; });
      await setInput(page, "x".repeat(450));
      await page.click("#speak");
      const during = await page.evaluate(() => {
        document.getElementById("voice").value = "am_michael";
        for (let i = 0; i < 4; i++) document.getElementById("text").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, cancelable: true }));
        return { calls: window.testCalls.length, disabled: document.getElementById("speak").disabled,
          voiceDisabled: document.getElementById("voice").disabled };
      });
      assert.deepEqual(during, { calls: 1, disabled: true, voiceDisabled: true });
      await page.evaluate(() => { window.testDefer = false; window.testRelease(); });
      assert.match(await waitForEnd(page), /^Done/);
      const calls = await page.evaluate(() => window.testCalls);
      assert.equal(calls.length, 2);
      assert.equal(calls.map((call) => call.text).join(""), "x".repeat(450));
      assert.deepEqual(calls.map((call) => call.voice), ["af_heart", "af_heart"]);
    });

    await t.test("cancellation waits for active inference and preserves the previous output", async () => {
      const previous = await page.$eval("#download", (el) => el.href);
      await page.evaluate(() => { window.testCalls = []; window.testDefer = true; });
      await setInput(page, "x".repeat(450));
      await page.click("#speak");
      await page.click("#cancel");
      assert.equal(await page.$eval("#speak", (el) => el.disabled), true);
      await page.evaluate(() => { window.testDefer = false; window.testRelease(); });
      assert.equal(await waitForEnd(page), "Cancelled.");
      assert.equal(await page.evaluate(() => window.testCalls.length), 1);
      assert.equal(await page.$eval("#download", (el) => el.href), previous);
      assert.equal(await page.$eval("#speak", (el) => el.disabled), false);
    });

    await t.test("inference and encoding errors restore controls and allow a successful retry", async () => {
      for (const mode of ["error", "empty", "invalid", "rate-change"]) {
        const previous = await page.$eval("#download", (el) => el.href);
        await page.evaluate((mode) => { window.testCalls = []; window.testMode = mode; }, mode);
        await setInput(page, mode === "rate-change" ? "x".repeat(450) : "Hello");
        await page.click("#speak");
        assert.match(await waitForEnd(page), /^Error/);
        assert.equal(await page.$eval("#speak", (el) => el.disabled), false);
        assert.equal(await page.$eval("#voice", (el) => el.disabled), false);
        assert.equal(await page.$eval("#cancel", (el) => el.disabled), true);
        assert.equal(await page.$eval("#download", (el) => el.href), previous);
      }
      const previous = await page.$eval("#download", (el) => el.href);
      await page.evaluate(() => { window.testMode = "normal"; });
      await page.click("#speak");
      assert.match(await waitForEnd(page), /^Done/);
      assert.notEqual(await page.$eval("#download", (el) => el.href), previous);
      assert.equal(await page.evaluate(async (url) => { try { await fetch(url); return true; } catch { return false; } }, previous), false);
    });

    await t.test("Unicode is accepted, oversized and empty text are rejected, and controls have labels", async () => {
      await page.evaluate(() => { window.testCalls = []; });
      await setInput(page, "ééé");
      await page.click("#speak");
      assert.match(await waitForEnd(page), /^Done/);
      assert.equal(await page.evaluate(() => window.testCalls[0].text), "ééé");
      await page.evaluate(() => { window.testCalls = []; });
      for (const [text, status] of [["x".repeat(20001), /20,000/], [" \n...", /Type something/]]) {
        await setInput(page, text);
        await page.click("#speak");
        assert.match(await page.$eval("#status", (el) => el.textContent), status);
        assert.equal(await page.evaluate(() => window.testCalls.length), 0);
      }
      assert.ok(await page.$eval("#text", (el) => el.labels.length));
      assert.equal(await page.$eval("#status", (el) => el.getAttribute("role")), "status");
    });
    assert.deepEqual(blocked, [], "the page tried to reach the network");
    assert.deepEqual(pageErrors, [], "uncaught browser errors");
  } finally {
    await browser.close();
  }
});
