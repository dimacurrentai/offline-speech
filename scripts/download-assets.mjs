#!/usr/bin/env node
import path from "node:path";
import { LIBRARY_SOURCE_ARCHIVES } from "../src/library-sources.mjs";
import { fileURLToPath } from "node:url";
import { ESPEAK_NG_SOURCE, LIBRARY_FILES, MODEL_FILES, MODEL_URL } from "../src/assets.mjs";
import { MODEL_INTEGRITY } from "../src/model-integrity.mjs";
import { downloadFile } from "./download.mjs";
import { verifyFile } from "./files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (process.argv.length > 3 || (mode && !["--model", "--libraries"].includes(mode))) {
  console.error("Usage: node scripts/download-assets.mjs [--model|--libraries]");
  process.exit(1);
}
const assets = [
  ...(mode === "--model" ? [] : [...LIBRARY_FILES, ESPEAK_NG_SOURCE, ...LIBRARY_SOURCE_ARCHIVES]),
  ...(mode === "--libraries" ? [] : MODEL_FILES.map((file) => ({
    file: `models/${file}`, url: `${MODEL_URL}/${file}`, ...MODEL_INTEGRITY[file],
  }))),
];
try {
  for (const asset of assets) {
    if (asset.url) await downloadFile(asset.url, path.join(root, asset.file), asset);
    // Committed build outputs have no URL; check that they still match their pinned build.
    else if (!(await verifyFile(path.join(root, asset.file), asset))) {
      throw new Error(`${asset.file} does not match its pinned hash; rebuild it with scripts/build-espeak-ng.sh.`);
    }
  }
  console.log("Assets ready (all files verified).");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
