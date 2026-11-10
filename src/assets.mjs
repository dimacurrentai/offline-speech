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
// Hashes match the files in the original, pinned npm distributions. The exception is the eSpeak NG
// text-to-phoneme module: it is built from pinned source by scripts/build-espeak-ng.sh and committed,
// so it has no URL, and its hash pins that build.
// Corresponding source of the eSpeak NG module: the pinned upstream revision, as GitHub archives it.
// Builds publish it beside offline-speech's own source archive, which holds the build script and patches.
export const ESPEAK_NG_COMMIT = "890071ff30231883d761e4d59edabd6d69faf159";
export const ESPEAK_NG_SOURCE = {
  "name": "eSpeak NG source",
  "file": `vendor/source/espeak-ng-${ESPEAK_NG_COMMIT}.tar.gz`,
  "type": "application/gzip",
  "url": `https://github.com/espeak-ng/espeak-ng/archive/${ESPEAK_NG_COMMIT}.tar.gz`,
  "size": 16321798,
  "sha256": "5da62c4d6af424cf8236dd4952326f28b328eb37c83f423a1c889435a97b5bc8",
};

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
    "file": "third_party/espeak-ng/phonemizer.js",
    "type": "text/javascript",
    "size": 1552431,
    "sha256": "1c8622bd1568bb4bfc987121baae32141535a3d78798ca47051967fcf6a3bc5e"
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
