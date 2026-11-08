import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { LIBRARY_FILES, MODEL_FILES, MODEL_ID } from "../src/assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("the built artifact contains every source asset intact and valid application code", () => {
  const html = fs.readFileSync(path.join(ROOT, "dist", "offline-speech.html"), "utf8");
  const expected = new Map([
    ...LIBRARY_FILES.map(({ name, file }) => [name, file]),
    ...MODEL_FILES.map((file) => [file.startsWith("voices/") ? file : `${MODEL_ID}/${file}`, `models/${file}`]),
  ]);
  const found = new Set();
  for (const match of html.matchAll(/<script type="application\/octet-stream" data-asset="([^"]+)" data-type="[^"]+" data-kind="(library|model)">([^<]+)<\/script>/g)) {
    assert.ok(expected.has(match[1]), `unexpected asset ${match[1]}`);
    assert.equal(match[2], expected.get(match[1]).startsWith("models/") ? "model" : "library");
    assert.ok(!found.has(match[1]), `duplicate asset ${match[1]}`);
    assert.deepEqual(zlib.gunzipSync(Buffer.from(match[3], "base64")), fs.readFileSync(path.join(ROOT, expected.get(match[1]))));
    found.add(match[1]);
  }
  assert.equal(found.size, expected.size);
  const app = /<script>\s*([\s\S]+?)<\/script>\s*<\/body>/.exec(html)?.[1];
  assert.ok(app, "missing application script");
  assert.doesNotThrow(() => new vm.Script(app));
  for (const marker of ["const MODEL_ID = __MODEL_ID__;", "const VOICES = __VOICES__;", "/*AUDIO_HELPERS*/", "/*UNPACK_HELPERS*/", "/*APP*/", "<!--LICENSES-->"]) {
    assert.ok(!html.includes(marker), `unreplaced marker ${marker}`);
  }
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  assert.ok(html.includes(escape(fs.readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.txt"), "utf8"))));
});

test("both distributions carry the shared license disclosure and complete offline notices", async () => {
  const { renderLicenses } = await import("../scripts/licenses.mjs");
  const disclosure = renderLicenses(ROOT);
  for (const file of ["dist/offline-speech.html", "dist/hosted/index.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(html.includes(disclosure), `${file} is missing the shared disclosure`);
    assert.ok(!html.includes("<!--LICENSES-->"));
  }
});
