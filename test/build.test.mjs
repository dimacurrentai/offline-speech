import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildHosted } from "../scripts/build-hosted.mjs";
import { atomicWrite, build, inlineApp } from "../scripts/build.mjs";

test("failed writes preserve the previous build and clean up temporary files", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "offline-speech.html");
  fs.writeFileSync(output, "previous working build");
  assert.throws(() => atomicWrite(output, (fd) => {
    fs.writeFileSync(fd, "partial new build");
    throw new Error("disk failure");
  }), /disk failure/);
  assert.equal(fs.readFileSync(output, "utf8"), "previous working build");
  assert.deepEqual(fs.readdirSync(dir), ["offline-speech.html"]);
  atomicWrite(output, (fd) => fs.writeFileSync(fd, "complete new build"));
  assert.equal(fs.readFileSync(output, "utf8"), "complete new build");
  assert.deepEqual(fs.readdirSync(dir), ["offline-speech.html"]);
});

test("missing build inputs leave the previous output untouched", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "offline-speech.html");
  fs.writeFileSync(output, "previous");
  await assert.rejects(build({ root, output }), /Missing/);
  assert.equal(fs.readFileSync(output, "utf8"), "previous");
});

test("corrupt model inputs are rejected before replacing the previous build", async (t) => {
  const { LIBRARY_FILES, MODEL_FILES } = await import("../src/assets.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-corrupt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...LIBRARY_FILES.map((asset) => asset.file), ...MODEL_FILES.map((file) => `models/${file}`)]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "corrupt");
  }
  const output = path.join(root, "offline-speech.html");
  fs.writeFileSync(output, "previous");
  await assert.rejects(build({ root, output }), /integrity check failed: config.json/);
  assert.equal(fs.readFileSync(output, "utf8"), "previous");
});

test("all inlined sources reject case-insensitive closing script tags", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-script-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  const app = "const MODEL_ID = __MODEL_ID__;\nconst VOICES = __VOICES__;\n/*AUDIO_HELPERS*/\n/*UNPACK_HELPERS*/";
  for (const file of ["app.js", "audio.mjs", "unpack.mjs"]) {
    fs.writeFileSync(path.join(root, "src", "app.js"), app);
    fs.writeFileSync(path.join(root, "src", "audio.mjs"), "");
    fs.writeFileSync(path.join(root, "src", "unpack.mjs"), "");
    fs.appendFileSync(path.join(root, "src", file), '\n// </ScRiPt >');
    assert.throws(() => inlineApp(root), /closing script tag/);
  }
  fs.writeFileSync(path.join(root, "src", "app.js"), app);
  fs.writeFileSync(path.join(root, "src", "audio.mjs"), '// </scripture>');
  fs.writeFileSync(path.join(root, "src", "unpack.mjs"), "");
  assert.doesNotThrow(() => inlineApp(root));
});


test("hosted builds cannot replace a parent application's non-empty directory", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-parent-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "parent.txt"), "keep me");
  await assert.rejects(buildHosted({ output: directory }), /Refusing to replace/);
  assert.equal(fs.readFileSync(path.join(directory, "parent.txt"), "utf8"), "keep me");
});

test("license disclosure includes browser components, the entire tooling graph and safely escaped notices", async () => {
  const { renderLicenses, RUNTIME_DEPENDENCIES } = await import("../scripts/licenses.mjs");
  const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), "..");
  const html = renderLicenses(root);
  assert.match(html, /offline-speech’s own code is licensed under GPL-3\.0-or-later/);
  for (const [name, version, license] of RUNTIME_DEPENDENCIES) {
    for (const value of [name, version, license]) assert.ok(html.includes(value));
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (!key) continue;
    assert.ok(html.includes(pkg.name || key.split("node_modules/").at(-1)));
    assert.ok(html.includes(pkg.version));
  }
  assert.match(html, /not shipped to app visitors/);
  assert.match(html, /corresponding-source requirements/);
  assert.ok(!html.includes("<script"));
});


test("an unsupported Kokoro build requires an explicit adapter review", async () => {
  const { withPhonemeProgress } = await import("../scripts/kokoro.mjs");
  assert.throws(() => withPhonemeProgress("changed upstream implementation"), /review the phoneme-progress adapter/);
});

test("source archives list only tracked source files, never local untracked ones", async (t) => {
  const { SOURCE_PATHS, sourceFiles } = await import("../scripts/source.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-speech-source-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "app.js"), "app");
  fs.writeFileSync(path.join(root, "README.md"), "readme");
  // Without Git metadata, as in an unpacked source archive, only the listed source paths count.
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(root, "notes.txt"), "local");
  assert.ok(!SOURCE_PATHS.includes(".env"));
  assert.deepEqual(sourceFiles(root), ["README.md", path.join("src", "app.js")]);
  // In a Git checkout, unignored but untracked files inside source paths stay out too.
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("add", "README.md", "src/app.js");
  fs.writeFileSync(path.join(root, "src", "local.env"), "SECRET=1");
  assert.deepEqual(sourceFiles(root), ["README.md", "src/app.js"]);
});
