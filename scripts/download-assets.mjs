#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIBRARY_FILES, MODEL_FILES, MODEL_URL } from "../src/assets.mjs";
import { MODEL_INTEGRITY } from "../src/model-integrity.mjs";
import { downloadFile } from "./download.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (process.argv.length > 3 || (mode && !["--model", "--libraries"].includes(mode))) {
  console.error("Usage: node scripts/download-assets.mjs [--model|--libraries]");
  process.exit(1);
}
const assets = [
  ...(mode === "--model" ? [] : LIBRARY_FILES),
  ...(mode === "--libraries" ? [] : MODEL_FILES.map((file) => ({
    file: `models/${file}`, url: `${MODEL_URL}/${file}`, ...MODEL_INTEGRITY[file],
  }))),
];
try {
  for (const asset of assets) await downloadFile(asset.url, path.join(root, asset.file), asset);
  console.log("Assets ready (all files verified).");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
