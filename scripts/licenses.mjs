// One disclosure renderer for both distributions; npm tooling comes from the lockfile.
import fs from "node:fs";
import path from "node:path";
import { MODEL_REVISION } from "../src/model-integrity.mjs";
import { VOICES } from "../src/assets.mjs";
import { SOURCE_ARCHIVE_NAMES, sourceDirections, sourceLocation } from "./source.mjs";
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
// Embedded Jinja 0.5.3 matches the published Transformers.js 3.8.1 sourcemap
// sourcesContent byte-for-byte; onnxruntime-common/version.js declares 1.21.0.
export const RUNTIME_DEPENDENCIES = [
  ["PRN UI (adapted palette and button geometry)", "986d93b681cb49f28b8fcd3069e2b3a04dad1a3f", "MIT", "https://github.com/dkorolev/prnui/tree/986d93b681cb49f28b8fcd3069e2b3a04dad1a3f"],
  ["Kokoro-82M model and six voices", MODEL_REVISION, "Apache-2.0", `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/${MODEL_REVISION}`],
  ["kokoro-js", "1.2.1", "Apache-2.0", "https://github.com/hexgrad/kokoro/tree/664c76a704021239ba59c84dcbaa4d3dece01fe9"],
  ["@huggingface/transformers", "3.8.1", "Apache-2.0", "https://github.com/huggingface/transformers.js/tree/2ec882e739e4cb461f8d440d4d7394cbf5372429"],
  ["phonemizer JavaScript wrapper (adapted)", "1.2.1 (6835144b7ee9043129222549c1ed2f6a27216278)", "Apache-2.0", "https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278"],
  ["eSpeak NG code and language data (built by offline-speech)", "890071ff30231883d761e4d59edabd6d69faf159", "GPL-3.0-or-later", "https://github.com/espeak-ng/espeak-ng/tree/890071ff30231883d761e4d59edabd6d69faf159"],
  ["Emscripten runtime", "7.0.0 (777e6e5db7b4990bcaeb1b9998ed642cc84e6629)", "MIT OR NCSA", "https://github.com/emscripten-core/emscripten/tree/777e6e5db7b4990bcaeb1b9998ed642cc84e6629"],
  ["musl libc and LLVM libc++/libc++abi/compiler-rt", "Vendored by Emscripten 7.0.0", "musl: MIT and component notices; LLVM: Apache-2.0 WITH LLVM-exception", "https://github.com/emscripten-core/emscripten/tree/777e6e5db7b4990bcaeb1b9998ed642cc84e6629/system/lib"],
  ["Unicode character data in eSpeak NG ucd-tools", "eSpeak NG 890071ff30231883d761e4d59edabd6d69faf159", "Unicode data/software license (COPYING.UCD)", "https://github.com/espeak-ng/espeak-ng/blob/890071ff30231883d761e4d59edabd6d69faf159/COPYING.UCD"],
  ["ONNX Runtime Web (JavaScript and WASM)", "1.22.0-dev.20250409-89f8206ba4", "MIT", "https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0"],
  ["onnxruntime-common (inside Transformers.js)", "1.21.0", "MIT", "https://github.com/microsoft/onnxruntime/tree/e0b66cad282043d4377cea5269083f17771b6dfc"],
  ["@huggingface/jinja (inside Transformers.js)", "0.5.3", "MIT", "https://github.com/huggingface/huggingface.js/tree/c3f76b460cbfe5a9827123ab9e17a65998aeb70f"],
];
export function renderLicenses(root, { inlineTexts = true } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = [...new Map(Object.entries(lock.packages).filter(([key]) => key).map(([key, pkg]) => {
    const name = pkg.name || key.split("node_modules/").at(-1);
    return [`${name}@${pkg.version}`, [name, pkg.version, pkg.license || "See package license", `https://www.npmjs.com/package/${name}/v/${pkg.version}`]];
  })).values()].sort((a,b) => a[0].localeCompare(b[0]));
  const table = rows => `<div class="license-table"><table><thead><tr><th>Component</th><th>Version / revision</th><th>License</th></tr></thead><tbody>${rows.map(([name, version, license, url]) => `<tr><td><a href="${escape(url)}">${escape(name)}</a></td><td>${escape(version)}</td><td>${escape(license)}</td></tr>`).join("")}</tbody></table></div>`;
  const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  return `<section id="licenses" aria-labelledby="licenses-title"><h2 id="licenses-title">Licenses and dependencies</h2>
<p>Collated from Kokoro-82M, kokoro-js, Transformers.js, phonemizer/eSpeak NG, ONNX Runtime, Hugging Face Jinja, and PRN UI.</p>
<p><strong>offline-speech comes with no warranty; you may redistribute it under GPLv3 or later.</strong> offline-speech’s own code is licensed under GPL-3.0-or-later (GNU General Public License version 3 or later); third-party components retain their respective licenses. ${inlineTexts ? 'To read the GPL, open “offline-speech license — full GPL version 3 text” below.' : '<a href="./LICENSE.txt">View the GPL license text</a>.'}</p>
<p>eSpeak NG: Copyright (C) 2005 to 2014 by Jonathan Duddington; Copyright (C) 2015-2017 Reece H. Dunn. Additional upstream copyright and license notices are provided in the full notices.</p>
<ul><li><strong>Speech model: <a href="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX">onnx-community/Kokoro-82M-v1.0-ONNX</a> — Apache-2.0.</strong> Kokoro generates speech; the bundled model and six voice files use this license.</li>
<li><strong>Text-to-phoneme engine: <a href="https://github.com/espeak-ng/espeak-ng">espeak-ng/espeak-ng (eSpeak NG)</a> — GPL-3.0-or-later.</strong> offline-speech builds its code and English language data to WebAssembly from a pinned revision, with an adapted phonemizer JavaScript wrapper that separately uses Apache-2.0.</li></ul>
<details><summary>Browser code, model and voice dependencies</summary>${table(RUNTIME_DEPENDENCIES)}<p>Included voices: ${escape(VOICES.map(v => v.id).join(", "))}. Browser bundles are fetched with pinned SHA-256 hashes; the eSpeak NG module is built from pinned source by scripts/build-espeak-ng.sh. offline-speech changes packaging/imports, adds an explicit phoneme-progress callback, and manages hosted voice caching.</p><p>The full ONNX Runtime notices below include its upstream dependency inventory across runtime variants. They are a superset, not a claim that every listed native library ships in this browser build.</p></details>
<details><summary>Development and test dependencies (${packages.length} npm packages)</summary><p>These tools are not shipped to app visitors. Node.js 20 or later supplies build utilities; puppeteer-core, which needs Node.js 22.12 or later, and its complete locked dependency graph support browser tests. Tests use a separately installed Chrome/Chromium browser under that distribution’s own licenses.</p>${table(packages)}</details>
${inlineTexts ? `<details><summary>offline-speech license — full GPL version 3 text</summary><p>You may use version 3 or any later version of the GNU GPL for offline-speech’s own code.</p><pre>${escape(license)}</pre></details>
<details><summary>Third-party notices — full license texts and upstream dependency inventory</summary><pre>${escape(notices)}</pre></details>` : `<p><a href="./LICENSE.txt">Full offline-speech license</a> · <a href="./THIRD_PARTY_NOTICES.txt">Full third-party notices and license texts</a>. Both files are saved with the page for offline reading.</p>`}
<p id="source"><strong>Corresponding source for the program and its libraries.</strong> ${inlineTexts
  ? `This file is published together with ${SOURCE_ARCHIVE_NAMES.map(name => `<code>${name}</code>`).join(", ")}. The accompanying <code>SOURCE_README.txt</code> and the pinned source directions below cover ONNX Runtime, compiler/runtime components, the wrapper and PRN UI.`
  : `${SOURCE_ARCHIVE_NAMES.map(name => `<a href="./source/${name}">${name}</a>`).join(", ")}. The <a href="./source/index.html">source index</a> and <a href="./source/README.txt">source README</a> give pinned source locations and build directions for every library, including ONNX Runtime and compiler/runtime components.`} ${(({ prefix, url }) => `${escape(prefix)}<a href="${escape(url)}">${escape(url)}</a>.`)(sourceLocation(root))}</p>
${inlineTexts ? `<details><summary>Pinned source and build directions for every library</summary><pre>${escape(sourceDirections(root))}</pre></details>` : ""}
<p>When redistributing this app, preserve notices and pass on the source archives and pinned source directions, or otherwise meet GPL corresponding-source requirements. A separate HTML page does not by itself determine the license obligations of a containing site. <a href="https://www.gnu.org/licenses/gpl-faq.html#MereAggregation">GNU GPL guidance on separate and combined works</a>.</p></section>`;
}
