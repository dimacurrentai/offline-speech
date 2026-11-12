// Published npm gitHead metadata pins Kokoro and Transformers.js. Jinja uses npm release provenance:
// https://registry.npmjs.org/-/npm/v1/attestations/@huggingface%2fjinja@0.5.3
export const LIBRARY_SOURCE_ARCHIVES = [
  {
    "name": "kokoro-js-1.2.1-source.tar.gz",
    "file": "vendor/source/kokoro-js-1.2.1-source.tar.gz",
    "url": "https://github.com/hexgrad/kokoro/archive/664c76a704021239ba59c84dcbaa4d3dece01fe9.tar.gz",
    "size": 26200864,
    "sha256": "7fb00d418195be678663f7844380abaf791aba4749137ed402d0da197bfa00cb",
    "type": "application/gzip"
  },
  {
    "name": "transformers-js-3.8.1-source.tar.gz",
    "file": "vendor/source/transformers-js-3.8.1-source.tar.gz",
    "url": "https://github.com/huggingface/transformers.js/archive/2ec882e739e4cb461f8d440d4d7394cbf5372429.tar.gz",
    "size": 20731121,
    "sha256": "8ce5ae4b5327892b72ac91c733583765ee12f70e596a30da6ea31cb51eeab55e",
    "type": "application/gzip"
  },
  {
    "name": "huggingface-jinja-0.5.3-source.tar.gz",
    "file": "vendor/source/huggingface-jinja-0.5.3-source.tar.gz",
    "url": "https://github.com/huggingface/huggingface.js/archive/c3f76b460cbfe5a9827123ab9e17a65998aeb70f.tar.gz",
    "size": 5065639,
    "sha256": "220cca4848b2fcfb8b82a964a1fd2d7d5f3e27e5ea961a4dc7e1547d079fc43a",
    "type": "application/gzip"
  }
];

export const PINNED_LIBRARY_SOURCES = [
  {
    "name": "kokoro-js",
    "version": "1.2.1",
    "revision": "664c76a704021239ba59c84dcbaa4d3dece01fe9",
    "repository": "https://github.com/hexgrad/kokoro",
    "archive": "kokoro-js-1.2.1-source.tar.gz",
    "instructions": "The kokoro.js directory contains the JavaScript library source, package metadata, and build scripts. offline-speech applies scripts/kokoro.mjs and hosted import/cache changes in scripts/build-hosted.mjs."
  },
  {
    "name": "Transformers.js",
    "version": "3.8.1",
    "revision": "2ec882e739e4cb461f8d440d4d7394cbf5372429",
    "repository": "https://github.com/huggingface/transformers.js",
    "archive": "transformers-js-3.8.1-source.tar.gz",
    "instructions": "src/, package.json, webpack.config.js, and upstream build documentation provide the source and build configuration for transformers.min.js. Bundled Jinja and ONNX Runtime sources are identified separately below."
  },
  {
    "name": "Hugging Face Jinja",
    "version": "0.5.3",
    "revision": "c3f76b460cbfe5a9827123ab9e17a65998aeb70f",
    "repository": "https://github.com/huggingface/huggingface.js",
    "archive": "huggingface-jinja-0.5.3-source.tar.gz",
    "instructions": "packages/jinja contains TypeScript source and build configuration. This commit is identified by the npm 0.5.3 release provenance; its dist/index.js matches the Transformers.js source map."
  },
  {
    "name": "ONNX Runtime Web, JavaScript glue and WASM",
    "version": "1.22.0-dev.20250409-89f8206ba4",
    "revision": "89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0",
    "repository": "https://github.com/microsoft/onnxruntime",
    "instructions": "js/web, onnxruntime, cmake, and tools/ci_build contain the source and build scripts. Follow the onnxruntime-web Build section in pinned js/README.md and tools/ci_build/build.py for the WASM/JSEP build; that revision also records the dependency revisions and build configuration in cmake/ and js/. This is the revision reported by the shipped ORT bundle."
  },
  {
    "name": "onnxruntime-common inside Transformers.js",
    "version": "1.21.0",
    "revision": "e0b66cad282043d4377cea5269083f17771b6dfc",
    "repository": "https://github.com/microsoft/onnxruntime",
    "instructions": "js/common contains the shared JavaScript/TypeScript source. Its version.js in the Transformers.js source map declares 1.21.0; this is the v1.21.0 release commit."
  },
  {
    "name": "phonemizer wrapper, adapted",
    "version": "1.2.1",
    "revision": "6835144b7ee9043129222549c1ed2f6a27216278",
    "repository": "https://github.com/xenova/phonemizer.js",
    "instructions": "src/phonemizer.js is the original wrapper. The adapted src/phonemizer-wrapper.js is included in offline-speech-source.tar.gz; the upstream precompiled engine is not used."
  },
  {
    "name": "eSpeak NG and Unicode character data",
    "version": "pinned source build",
    "revision": "890071ff30231883d761e4d59edabd6d69faf159",
    "repository": "https://github.com/espeak-ng/espeak-ng",
    "instructions": "The eSpeak archive is provided locally. offline-speech-source.tar.gz contains scripts/build-espeak-ng.sh, the dated patches, and the wrapper. Unicode data and its COPYING.UCD license are in this tree."
  },
  {
    "name": "Emscripten runtime, musl libc, LLVM libc++/libc++abi/compiler-rt",
    "version": "7.0.0",
    "revision": "777e6e5db7b4990bcaeb1b9998ed642cc84e6629",
    "repository": "https://github.com/emscripten-core/emscripten",
    "instructions": "src/ and system/lib/ contain the runtime sources, including libc/musl, libcxx, libcxxabi, and compiler-rt. scripts/build-espeak-ng.sh uses emsdk 7.0.0; the compiler is a general-purpose build tool. Runtime license texts are included in THIRD_PARTY_NOTICES.txt."
  },
  {
    "name": "PRN UI",
    "version": "pinned specimen",
    "revision": "8a11eb419d3c12f699c312068f622378d3307b50",
    "repository": "https://github.com/dkorolev/prnui",
    "instructions": "third_party/prnui is the unmodified specimen. The build copies its stylesheet into both pages and does not keep a second palette. This commit adds the light theme and is reachable from the light-theme branch until that change is on main. offline-speech-source.tar.gz includes prnui.html and LICENSE from that checkout."
  }
];
