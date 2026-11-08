// The complete list of files embedded into dist/offline-speech.html.
// Shared by the build and model downloader.

import { MODEL_REVISION } from "./model-integrity.mjs";

export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}`;

export const VOICES = [
  { id: "af_heart", label: "Heart (US, female)" },
  { id: "af_bella", label: "Bella (US, female)" },
  { id: "af_nicole", label: "Nicole (US, female)" },
  { id: "am_michael", label: "Michael (US, male)" },
  { id: "am_fenrir", label: "Fenrir (US, male)" },
  { id: "bf_emma", label: "Emma (UK, female)" },
];

// Model files, relative to the model repository root. The q8 (quantized) model is
// ~92 MB and runs well on CPU via WASM.
export const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
  ...VOICES.map(({ id }) => `voices/${id}.bin`),
];

// Browser assets fetched directly from versioned npm CDN URLs; no native packages.
// Hashes match the files in the original, pinned npm distributions.
export const LIBRARY_FILES = [
  {
    "name": "kokoro-js",
    "file": "vendor/kokoro.js",
    "type": "text/javascript",
    "url": "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.js",
    "size": 10979,
    "sha256": "31b1db2aa4a7411f55786900f0cbdd0351f1063859b107f9a99699a03b098b7d"
  },
  {
    "name": "@huggingface/transformers",
    "file": "vendor/transformers.min.js",
    "type": "text/javascript",
    "url": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js",
    "size": 888173,
    "sha256": "aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa"
  },
  {
    "name": "phonemizer",
    "file": "vendor/phonemizer.js",
    "type": "text/javascript",
    "url": "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js",
    "size": 1322380,
    "sha256": "193481f474f7c1ea81df3195d18b45df8ef7254dbdccb3f193d60215c4897bec"
  },
  {
    "name": "ort.mjs",
    "file": "vendor/ort-wasm-simd-threaded.jsep.mjs",
    "type": "text/javascript",
    "url": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.mjs",
    "size": 44484,
    "sha256": "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9"
  },
  {
    "name": "ort.wasm",
    "file": "vendor/ort-wasm-simd-threaded.jsep.wasm",
    "type": "application/wasm",
    "url": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm",
    "size": 21596019,
    "sha256": "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39"
  }
];
