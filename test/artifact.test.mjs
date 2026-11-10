import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { withPhonemeProgress } from "../scripts/kokoro.mjs";
import { ESPEAK_NG_SOURCE, LIBRARY_FILES, MODEL_FILES, MODEL_ID } from "../src/assets.mjs";
import { verifyFile } from "../scripts/files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("the built artifact contains verified assets and the explicit Kokoro adapter", () => {
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
    const original = fs.readFileSync(path.join(ROOT, expected.get(match[1])));
    const bytes = match[1] === "kokoro-js" ? Buffer.from(withPhonemeProgress(original.toString("utf8"))) : original;
    assert.deepEqual(zlib.gunzipSync(Buffer.from(match[3], "base64")), bytes);
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
  for (const file of ["dist/offline-speech.html", "dist/hosted/index.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const disclosure = renderLicenses(ROOT, { inlineTexts: !file.includes("hosted/") });
    assert.ok(html.includes(disclosure), `${file} is missing the shared disclosure`);
    assert.ok(!html.includes("<!--LICENSES-->"));
  }
});


test("hosted HTML stays small while full licenses remain in the offline shell", async () => {
  const { MANIFEST } = await import("../dist/hosted/manifest.js");
  assert.ok(fs.statSync(path.join(ROOT, "dist/hosted/index.html")).size < 64 * 1024);
  for (const file of ["LICENSE.txt", "THIRD_PARTY_NOTICES.txt"]) {
    assert.ok(MANIFEST.shell.includes(file));
    assert.deepEqual(fs.readFileSync(path.join(ROOT, "dist/hosted", file)), fs.readFileSync(path.join(ROOT, file === "LICENSE.txt" ? "LICENSE" : file)));
  }
});

test("the standalone build writes all library source archives and pinned directions beside the HTML", async () => {
  const { SOURCE_ARCHIVES } = await import("../scripts/source.mjs");
  const dist = path.join(ROOT, "dist");
  for (const asset of SOURCE_ARCHIVES) assert.ok(await verifyFile(path.join(dist, path.basename(asset.file)), asset));
  assert.ok(fs.readFileSync(path.join(dist, "SOURCE_README.txt"), "utf8").includes("ONNX Runtime"));
  assert.ok(await verifyFile(path.join(dist, path.basename(ESPEAK_NG_SOURCE.file)), ESPEAK_NG_SOURCE));
  const own = path.join(dist, "offline-speech-source.tar.gz");
  assert.ok(fs.statSync(own).size > 0);
  const html = fs.readFileSync(path.join(dist, "offline-speech.html"), "utf8");
  assert.ok(html.includes(`<code>${path.basename(ESPEAK_NG_SOURCE.file)}</code>`));
  assert.ok(html.includes("<code>offline-speech-source.tar.gz</code>"));
});


test("both pages show warranty and upstream copyright notices outside collapsed details", () => {
  for (const file of ["dist/offline-speech.html", "dist/hosted/index.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const start = html.indexOf('<section id="licenses"');
    const visible = html.slice(start, html.indexOf("<details>", start));
    assert.match(visible, /comes with no warranty; you may redistribute it under GPLv3 or later/);
    assert.match(visible, /Copyright \(C\) 2005 to 2014 by Jonathan Duddington/);
    assert.match(visible, /Copyright \(C\) 2015-2017 Reece H\. Dunn/);
  }
  const notices = fs.readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.txt"), "utf8");
  for (const expected of ["Emscripten AUTHORS", "musl libc notices", "COPYING.UCD", "LLVM libcxx", "LLVM libcxxabi", "LLVM compiler-rt", "eSpeak NG upstream copyright"]) assert.ok(notices.includes(expected));
});

test("both builds name where their source is published", async () => {
  const { sourceLocation } = await import("../scripts/source.mjs");
  const { prefix, url } = sourceLocation(ROOT);
  const link = `${prefix}<a href="${url}">${url}</a>.`;
  for (const file of ["offline-speech.html", "hosted/index.html", "hosted/source/index.html"]) {
    assert.ok(fs.readFileSync(path.join(ROOT, "dist", file), "utf8").includes(link), file);
  }
  for (const file of ["SOURCE_README.txt", "hosted/source/README.txt"]) {
    assert.ok(fs.readFileSync(path.join(ROOT, "dist", file), "utf8").includes(`${prefix}${url}.`), file);
  }
});
