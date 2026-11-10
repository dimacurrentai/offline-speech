#!/usr/bin/env node
// Package the application, libraries, verified model, and voices into one HTML file.
import fs from "node:fs";
import { withPhonemeProgress } from "./kokoro.mjs";
import { renderLicenses } from "./licenses.mjs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIBRARY_FILES, MODEL_FILES, MODEL_ID, VOICES } from "../src/assets.mjs";
import { MODEL_INTEGRITY } from "../src/model-integrity.mjs";
import { checkSourceInputs, writeSourceArchives } from "./source.mjs";
import { verifyFile } from "./files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function atomicWrite(output, write) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporaryDir = fs.mkdtempSync(path.join(path.dirname(output), ".offline-speech-build-"));
  const temporary = path.join(temporaryDir, "page.html");
  let fd;
  try {
    fd = fs.openSync(temporary, "wx");
    write(fd);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, output);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function replaceOnce(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`Expected exactly one template marker: ${marker}`);
  return source.replace(marker, () => replacement);
}

export function inlineApp(root = ROOT) {
  let app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  app = replaceOnce(app, "const MODEL_ID = __MODEL_ID__;", `const MODEL_ID = ${JSON.stringify(MODEL_ID)};`);
  app = replaceOnce(app, "const VOICES = __VOICES__;", `const VOICES = ${JSON.stringify(VOICES)};`);
  const helpers = fs.readFileSync(path.join(root, "src", "audio.mjs"), "utf8").replace(/^export /gm, "");
  app = replaceOnce(app, "/*AUDIO_HELPERS*/", helpers);
  const unpack = fs.readFileSync(path.join(root, "src", "unpack.mjs"), "utf8").replace(/^export /gm, "");
  app = replaceOnce(app, "/*UNPACK_HELPERS*/", unpack);
  if (/<\/script\b/i.test(app)) throw new Error("Inlined application code contains a closing script tag");
  return app;
}

export async function build({ root = ROOT, output = path.join(root, "dist", "offline-speech.html") } = {}) {
  const assets = [
    ...LIBRARY_FILES.map(({ name, file, type }) => ({ name, file: path.join(root, file), type, kind: "library" })),
    ...MODEL_FILES.map((file) => ({
      name: file.startsWith("voices/") ? file : `${MODEL_ID}/${file}`,
      file: path.join(root, "models", file),
      type: "application/octet-stream",
      kind: "model",
    })),
  ];
  const missing = assets.filter(({ file }) => !fs.existsSync(file));
  if (missing.length) throw new Error(`Missing ${path.relative(root, missing[0].file)}. Run npm run download-assets first.`);
  for (const file of MODEL_FILES) {
    if (!(await verifyFile(path.join(root, "models", file), MODEL_INTEGRITY[file]))) {
      throw new Error(`Model integrity check failed: ${file}. Run npm run download-model to repair it.`);
    }
  }
  for (const asset of LIBRARY_FILES) {
    if (!(await verifyFile(path.join(root, asset.file), asset))) {
      throw new Error(`Library integrity check failed: ${asset.file}. ${asset.url ? "Run npm run download-libraries to repair it." : "Rebuild it with scripts/build-espeak-ng.sh."}`);
    }
  }
  await checkSourceInputs(root);
  const app = inlineApp(root);
  let template = fs.readFileSync(path.join(root, "src", "page.html"), "utf8");
  template = replaceOnce(template, "<!--LICENSES-->", renderLicenses(root));
  // Validate all markers before touching the destination.
  replaceOnce(template, "<!--ASSETS-->", "");
  replaceOnce(template, "/*APP*/", "");
  const [beforeAssets, afterAssets] = template.split("<!--ASSETS-->");
  const suffix = replaceOnce(afterAssets, "/*APP*/", app);

  atomicWrite(output, (fd) => {
    fs.writeFileSync(fd, beforeAssets);
    for (const { name, file, type, kind } of assets) {
      const original = fs.readFileSync(file);
      const bytes = name === "kokoro-js" ? Buffer.from(withPhonemeProgress(original.toString("utf8"))) : original;
      const gz = zlib.gzipSync(bytes, { level: 9 });
      fs.writeFileSync(fd, `<script type="application/octet-stream" data-asset="${name}" data-type="${type}" data-kind="${kind}">`);
      fs.writeFileSync(fd, gz.toString("base64"));
      fs.writeFileSync(fd, "</script>\n");
    }
    fs.writeFileSync(fd, suffix);
  });
  // The standalone file is distributed with both source archives beside it.
  await writeSourceArchives(root, path.dirname(output), { index: false });
  const mb = (fs.statSync(output).size / 2 ** 20).toFixed(1);
  console.log(`Wrote ${path.relative(root, output)} (${mb} MiB, ${assets.length} embedded files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
