#!/usr/bin/env node
// Build a relocatable static app. Every payload is below 8 MiB for static hosts.
import fs from "node:fs";
import { renderLicenses } from "./licenses.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIBRARY_FILES, MODEL_FILES, MODEL_ID, VOICES } from "../src/assets.mjs";
import { MODEL_INTEGRITY } from "../src/model-integrity.mjs";
import { verifyFile } from "./files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CHUNK_BYTES = 8 * 1024 * 1024;
const SHELL = ["index.html", "app.js", "storage.js", "tts-worker.js", "audio.js", "manifest.js", "style.css", "favicon.svg", "THIRD_PARTY_NOTICES.txt"];

export async function buildHosted({ root = ROOT, output = path.join(root, "dist", "hosted") } = {}) {
  output = path.resolve(output);
  if (fs.existsSync(output) && fs.readdirSync(output).length && !fs.existsSync(path.join(output, ".offline-speech-output"))) {
    throw new Error("Refusing to replace a non-offline-speech directory; choose a dedicated empty output folder");
  }
  const sources = [
    ...LIBRARY_FILES.map((asset) => ({ ...asset, key: asset.name, kind: "library" })),
    ...MODEL_FILES.map((file) => ({ file: `models/${file}`, kind: "model", key: file.startsWith("voices/") ? file : `${MODEL_ID}/${file}`,
      type: "application/octet-stream", ...MODEL_INTEGRITY[file] })),
  ];
  for (const source of sources) {
    if (!(await verifyFile(path.join(root, source.file), source))) throw new Error(`Missing or corrupt ${source.file}; run npm run download-assets`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(output), ".offline-speech-build-"));
  fs.mkdirSync(path.join(temporary, "assets"), { recursive: true });
  const assets = [];
  const writeAsset = (key, bytes, type, basename, kind = "library") => {
    const sha256 = hash(bytes);
    const url = `assets/${sha256.slice(0, 16)}-${basename}`;
    const parts = [];
    for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
      const partUrl = bytes.length <= CHUNK_BYTES ? url : `${url}.part-${index}`;
      fs.writeFileSync(path.join(temporary, partUrl), chunk);
      parts.push({ url: partUrl, size: chunk.length, sha256: hash(chunk) });
    }
    const asset = { key, kind, url, type, size: bytes.length, sha256, parts };
    assets.push(asset);
    return asset;
  };
  try {
    const shim = writeAsset("node-shim", Buffer.from("export default undefined;"), "text/javascript", "node-shim.js");
    for (const source of sources.filter((source) => source.key !== "kokoro-js")) {
      writeAsset(source.key, fs.readFileSync(path.join(root, source.file)), source.type, path.basename(source.file), source.kind);
    }
    let kokoro = fs.readFileSync(path.join(root, LIBRARY_FILES.find((asset) => asset.name === "kokoro-js").file), "utf8");
    for (const [specifier, asset] of [
      ["@huggingface/transformers", assets.find((asset) => asset.key === "@huggingface/transformers")],
      ["phonemizer", assets.find((asset) => asset.key === "phonemizer")], ["path", shim], ["fs/promises", shim],
    ]) {
      const marker = JSON.stringify(specifier);
      if (!kokoro.includes(marker)) throw new Error(`Kokoro import changed: ${specifier}`);
      kokoro = kokoro.replaceAll(marker, JSON.stringify(`./${path.basename(asset.url)}`));
    }
    // The app owns the voice cache so Delete offline files can remove every copy.
    const voiceCache = 'caches.open("kokoro-voices")';
    if (!kokoro.includes(voiceCache)) throw new Error("Kokoro voice cache adapter changed");
    kokoro = kokoro.replace(voiceCache, 'Promise.resolve({match:async()=>undefined,put:async()=>{}})');
    writeAsset("kokoro-js", Buffer.from("// Modified for offline-speech: local ESM imports and app-managed voice caching.\n" + kokoro), "text/javascript", "kokoro.js");
    const sourceNames = ["index.html", "style.css", "favicon.svg", "app.js", "storage.js", "tts-worker.js", "sw.js"];
    const files = Object.fromEntries(sourceNames.map((name) => [name, fs.readFileSync(path.join(root, "src", "hosted", name), "utf8")]));
    files["audio.js"] = fs.readFileSync(path.join(root, "src", "audio.mjs"), "utf8");
    files["THIRD_PARTY_NOTICES.txt"] = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
    files["index.html"] = files["index.html"].replace("<!--LICENSES-->", () => renderLicenses(root));
    const id = hash(JSON.stringify({ files, assets })).slice(0, 16);
    const shell = SHELL.map((name) => name.endsWith(".js") ? `${name}?v=${id}` : name);
    files["manifest.js"] = `export const MANIFEST = ${JSON.stringify({ id, dataId: hash(JSON.stringify(assets)).slice(0, 16), modelId: MODEL_ID, voices: VOICES, assets, shell }, null, 2)};\n`;
    for (const [name, source] of Object.entries(files)) {
      const rendered = name.endsWith(".js") ? source.replace(/from "(\.\/[^"?]+\.js)"/g, (_, url) => `from "${url}?v=${id}"`)
        : name === "index.html" ? source.replace('./app.js"', `./app.js?v=${id}"`) : source;
      fs.writeFileSync(path.join(temporary, name), rendered);
    }
    fs.writeFileSync(path.join(temporary, ".offline-speech-output"), "Generated by offline-speech.\n");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(temporary, output);
    console.log(`Wrote ${path.relative(process.cwd(), output) || "."} (${(assets.reduce((n, asset) => n + asset.size, 0) / 2 ** 20).toFixed(1)} MiB offline payload).`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildHosted().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
