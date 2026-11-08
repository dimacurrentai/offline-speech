// One disclosure renderer for both distributions; npm tooling comes from the lockfile.
import fs from "node:fs";
import path from "node:path";
import { MODEL_REVISION } from "../src/model-integrity.mjs";
import { VOICES } from "../src/assets.mjs";
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
// Embedded Jinja 0.5.3 matches the published Transformers.js 3.8.1 sourcemap
// sourcesContent byte-for-byte; onnxruntime-common/version.js declares 1.21.0.
export const RUNTIME_DEPENDENCIES = [
  ["PRN UI (adapted palette and button geometry)", "986d93b681cb49f28b8fcd3069e2b3a04dad1a3f", "MIT", "https://github.com/dkorolev/prnui/tree/986d93b681cb49f28b8fcd3069e2b3a04dad1a3f"],
  ["Kokoro-82M model and six voices", MODEL_REVISION, "Apache-2.0", `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/${MODEL_REVISION}`],
  ["kokoro-js", "1.2.1", "Apache-2.0", "https://github.com/hexgrad/kokoro"],
  ["@huggingface/transformers", "3.8.1", "Apache-2.0", "https://github.com/huggingface/transformers.js"],
  ["phonemizer JavaScript wrapper", "1.2.1", "Apache-2.0", "https://github.com/xenova/phonemizer.js"],
  ["eSpeak NG code and language data", "Embedded in phonemizer 1.2.1; engine revision not identified upstream", "GPL-3.0-or-later", "https://github.com/espeak-ng/espeak-ng"],
  ["ONNX Runtime Web (JavaScript and WASM)", "1.22.0-dev.20250409-89f8206ba4", "MIT", "https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0"],
  ["onnxruntime-common (inside Transformers.js)", "1.21.0", "MIT", "https://github.com/microsoft/onnxruntime/tree/v1.21.0"],
  ["@huggingface/jinja (inside Transformers.js)", "0.5.3", "MIT", "https://github.com/huggingface/huggingface.js"],
];
export function renderLicenses(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = [...new Map(Object.entries(lock.packages).filter(([key]) => key).map(([key, pkg]) => {
    const name = pkg.name || key.split("node_modules/").at(-1);
    return [`${name}@${pkg.version}`, [name, pkg.version, pkg.license || "See package license", `https://www.npmjs.com/package/${name}/v/${pkg.version}`]];
  })).values()].sort((a,b) => a[0].localeCompare(b[0]));
  const table = rows => `<div class="license-table"><table><thead><tr><th>Component</th><th>Version / revision</th><th>License</th></tr></thead><tbody>${rows.map(([name, version, license, url]) => `<tr><td><a href="${escape(url)}">${escape(name)}</a></td><td>${escape(version)}</td><td>${escape(license)}</td></tr>`).join("")}</tbody></table></div>`;
  const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  return `<section id="licenses" aria-labelledby="licenses-title"><h2 id="licenses-title">Licenses and dependencies</h2>
<p><strong>offline-speech’s own code is licensed under GPL-3.0-or-later</strong> (GNU General Public License version 3 or later). Third-party components retain their respective licenses.</p>
<ul><li><strong>Speech model: <a href="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX">onnx-community/Kokoro-82M-v1.0-ONNX</a> — Apache-2.0.</strong> Kokoro generates speech; the bundled model and six voice files use this license.</li>
<li><strong>Text-to-phoneme engine: <a href="https://github.com/espeak-ng/espeak-ng">espeak-ng/espeak-ng (eSpeak NG)</a> — GPL-3.0-or-later.</strong> Its code and language data are embedded through phonemizer. The phonemizer JavaScript wrapper separately uses Apache-2.0.</li></ul>
<details><summary>Browser code, model and voice dependencies</summary>${table(RUNTIME_DEPENDENCIES)}<p>Included voices: ${escape(VOICES.map(v => v.id).join(", "))}. Browser bundles are fetched with pinned SHA-256 hashes. offline-speech changes packaging/imports and hosted voice caching.</p><p>The full ONNX Runtime notices below include its upstream dependency inventory across runtime variants. They are a superset, not a claim that every listed native library ships in this browser build. The exact embedded eSpeak NG engine revision is not identified by the published phonemizer bundle.</p></details>
<details><summary>Development and test dependencies (${packages.length} npm packages)</summary><p>These tools are not shipped to app visitors. Node.js 20 or later supplies build utilities; puppeteer-core and its complete locked dependency graph support browser tests. Tests use a separately installed Chrome/Chromium browser under that distribution’s own licenses.</p>${table(packages)}</details>
<details><summary>offline-speech license — full GPL version 3 text</summary><p>You may use version 3 or any later version of the GNU GPL for offline-speech’s own code.</p><pre>${escape(license)}</pre></details>
<details><summary>Third-party notices — full license texts and upstream dependency inventory</summary><pre>${escape(notices)}</pre></details>
<p>When redistributing this app, preserve notices and meet applicable GPL corresponding-source requirements. Source links identify upstream projects; notices alone do not supply corresponding source for a particular build. A separate HTML page does not by itself determine the license obligations of a containing site. <a href="https://www.gnu.org/licenses/gpl-faq.html#MereAggregation">GNU GPL guidance on separate and combined works</a>.</p></section>`;
}
