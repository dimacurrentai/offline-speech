# offline-speech

Browser text-to-speech with two build targets: a small hosted page that saves its speech files for offline use, and a standalone HTML file that opens directly from disk. Speech runs on the user's device; text and generated audio are never sent to a server.

Collated from Kokoro-82M, kokoro-js, Transformers.js, phonemizer/eSpeak NG, ONNX Runtime, Hugging Face Jinja, and PRN UI.

offline-speech’s own code: **GPL-3.0-or-later** ([LICENSE](LICENSE)). Bundled dependencies keep their own licenses; see the disclosure in each built page and the inventory below.

## Deploy from a Git submodule

Requires Node 20+. The build uses only Node's built-ins; no npm install is needed. The initial asset download needs internet access.

```bash
git submodule add https://github.com/dimacurrentai/offline-speech.git third_party/offline-speech
node third_party/offline-speech/scripts/download-assets.mjs
node third_party/offline-speech/scripts/build-hosted.mjs
```

When cloning a parent repository that already contains this submodule, run `git submodule update --init --recursive` before building. The build then checks out the pinned PRN UI specimen at `third_party/prnui`. `git submodule update` skips that checkout (`update = none`) so a parent recursive update still succeeds while the pin is the light-theme commit, before it is on PRN UI `main`. The build fetches that commit itself.

Copy the **contents** of `third_party/offline-speech/dist/hosted/` to your site's static directory, for example `public/tools/speech/`. Add the generated directory to the **parent repository's** `.gitignore`:

```gitignore
/public/tools/speech/
```

Generate these files during the deployment build rather than committing the roughly 114 MiB payload. If the folder was already tracked, remove it from the parent's index with `git rm -r --cached -- public/tools/speech/`; this keeps the local files. The submodule's `.gitignore` does not cover an output directory in the parent repository.

Serve it at `https://your-site.example/tools/speech/`. All module and asset URLs are relative; there is no build-time base-URL setting. Keep the whole output directory together and preserve filenames. No server API, hosting provider SDK, runtime environment variables, or external CDN access is needed by visitors.

Use HTTPS, or localhost for development. Serve `.js` and `.mjs` as JavaScript and `.html` as HTML; do not rewrite missing asset requests to a parent SPA's HTML. The service worker is scoped to the app's own directory and caches are scoped to that URL path. Removing this app's files leaves other apps on the same origin alone.

If the parent site sets a Content Security Policy, allow same-origin scripts, styles, workers and downloads (and `blob:` in `connect-src` for integrations that read generated WAV blobs); allow WebAssembly with `script-src 'self' 'wasm-unsafe-eval'` and WAV playback with `media-src 'self' blob:`. The hosted app uses no inline scripts or styles and needs no external script origins.

To generate directly into a dedicated folder during the parent project’s build:

```js
import { buildHosted } from "./third_party/offline-speech/scripts/build-hosted.mjs";
await buildHosted({ output: "public/tools/speech" });
```

Run the asset downloader before this step. Choose a dedicated empty folder. The build marks its output and replaces it on rebuild; it refuses to replace a non-empty directory owned by another application.

The hosted output contains approximately 114 MiB of model, voices, and browser libraries. Individual payload files are at most 8 MiB, including the split model and WASM. The build verifies upstream hashes and records hashes for every hosted piece. The only npm dependency is `puppeteer-core`, used for tests; native `onnxruntime-node` and `sharp` are not installed.

## The offline experience

1. Open the hosted app and choose **Download for offline use**. A progress bar shows the percentage and received/total bytes. Every piece is verified before it is saved.
2. Wait for **Ready offline on this device**, then bookmark the app's own URL. Bookmarking a different parent page that embeds this app does not make that parent page available offline.
3. Choose **Load model**, type text, and click **Speak** (or Ctrl/Cmd+Enter). Output is 24 kHz mono 16-bit PCM WAV.
4. Later, reopen the bookmark in the same browser profile with the network completely unavailable. The cached page, libraries, model and all six voices work without contacting a server. Installing the page as a PWA is not required.

When a model or library update changes the payload version, the updated service worker automatically removes this app’s obsolete model/library caches on activation. UI-only updates retain the current model files; caches belonging to other apps are untouched.

Cancelled or failed downloads retain completed, verified pieces. Choose Download again to resume; an unfinished piece downloads again. The app requests persistent storage when downloading, and reports whether the browser grants it. Browser settings, private browsing, quota pressure, or clearing site data can still remove offline availability. A bookmark alone does not save the speech files. See [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) and [browser storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Disk and RAM controls

The page shows saved offline payload and shell bytes. Storage details also show the browser's estimate for the **entire origin**, which can include other apps, bookkeeping, and browser-managed files. Saved file sizes are measurable; exact per-app physical disk allocation is not exposed by the browser.

- **Unload model · free RAM** terminates the dedicated inference worker. Downloaded files remain available for loading offline again, and cached WAVs are preserved. The same unload action is shown beside the saved-files status while the model worker is running. Browser/OS memory reclamation may be gradual.
- **Delete offline files** aborts any download, terminates inference, and deletes this app's cached model, voices and libraries, including partial downloads and older versions. Other open tabs of the same app are notified to stop their workers. Only the small page shell (under 1 MiB) remains, so the bookmark can explain that another download is needed. Other applications' storage is untouched.

RAM is shown as a browser estimate when `performance.measureUserAgentSpecificMemory()` is available and the page is cross-origin isolated. Otherwise the page explicitly labels its roughly 1 GiB desktop model/runtime figure as an **estimate**, not a device measurement. It never presents `performance.memory` as total RAM. When unloaded, the page says the model is stopped; the UI and generated audio still use some memory. The runtime's actual RAM varies by browser and device.

Hosts that want to enable the [browser memory-measurement API](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory) can configure `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for the app. These headers are optional; offline speech and all deletion/unloading controls work without them. Consider the parent site's embedding and authentication needs before applying isolation headers globally.

## Build and preview this repository

```bash
npm run download-assets
npm run build             # both targets
npm run preview:hosted    # http://localhost:8080/; PORT can override
```

Or build one target:

```bash
npm run build:hosted      # dist/hosted/
npm run build:standalone  # dist/offline-speech.html
```

`models/`, `vendor/`, `node_modules/` and `dist/` are gitignored. The shared build-time downloader uses a 60-second inactivity timeout, resets its retry budget when data arrives, and resumes partial files. Completed files must match pinned sizes and SHA-256 hashes. Use `npm run download-model` or `npm run download-libraries` to fetch just one group.

The standalone HTML remains a separate, portable alternative (approximately 90 MiB). It embeds all six voices and runs from `file://`, using bounded base64 decoding. It does not use a service worker or persistent browser model storage, and does not offer the hosted app's disk-management controls. Hosted disk deletion cannot delete a standalone file the user downloaded.

## Tests and CI

```bash
npm run test:unit         # no npm installation, model files, or Chrome required
npm ci                   # installs only browser-test tooling
npm test                 # after downloading and building both targets
```

Set `CHROME_PATH` when Chrome/Chromium is not found automatically. In containers that cannot launch Chrome's sandbox, explicitly set `CHROME_NO_SANDBOX=1`. CI runs unit tests on Node 20 and the browser suites on Node 22; Puppeteer 25 needs Node 22.12 or later.

The standalone suite checks all six voices with external requests blocked. Hosted tests use a nested deployment path, interrupt and resume a download, verify progress and payload hashes, unload real workers, close the browser, stop the HTTP server, reopen the bookmark in a new offline browser process, and synthesize a real WAV. They also delete files offline, verify that the small shell still opens, check that a foreign app's cache survives, reinstall files, and verify cross-tab unloading.

The included workflow already caches `models/` and `vendor/` separately. For a parent repository that uses this project as a submodule, cache its downloaded files before the download/build steps:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      third_party/offline-speech/models/
      third_party/offline-speech/vendor/
    key: offline-speech-assets-${{ runner.os }}-${{ hashFiles('third_party/offline-speech/src/assets.mjs', 'third_party/offline-speech/src/model-integrity.mjs') }}
- run: node third_party/offline-speech/scripts/download-assets.mjs
- run: node third_party/offline-speech/scripts/build-hosted.mjs
```

Adjust the submodule path to match your checkout. Do not cache generated output in Git; downloads are still verified against pinned SHA-256 hashes after restoration.

Successful CI runs retain builds for 30 days. A `v*` tag publishes the tested standalone HTML, a deployable hosted archive, all corresponding-source archives, checksums, and notices as a GitHub release. Release assets will appear on the [releases page](https://github.com/dimacurrentai/offline-speech/releases) when a version tag is published.

## Implementation

- `src/assets.mjs` and `src/model-integrity.mjs` pin the source libraries, voices and model.
- `scripts/build-hosted.mjs` writes a fully static, relocatable app, rewrites browser-library imports to local content-addressed files, and splits large payloads.
- `src/hosted/storage.js` owns verified payload caching, storage accounting and deletion. It avoids the upstream library's separate voice cache so deletion removes every app-managed model/voice copy.
- `src/hosted/sw.js` caches the small page shell and serves saved files offline within the deployment directory.
- `src/hosted/tts-worker.js` owns ONNX Runtime and Kokoro. The page can terminate it to release the model without reloading the UI.
- `src/hosted/app.js` handles downloads, progress, resource reporting, controls and WAV playback.
- `scripts/build.mjs`, `src/app.js`, `src/audio.mjs` and `src/unpack.mjs` preserve the standalone HTML target.

Both pages use the unmodified [PRN UI](https://github.com/dkorolev/prnui/tree/8a11eb419d3c12f699c312068f622378d3307b50) specimen (MIT). The build copies its stylesheet, and this repository's stylesheet is layout only. Orange chamfered buttons mark the main actions. The hosted page explains Download → Load model → Speak and shows the current step. Download, cancel, and unload stay in place: a disabled control is how an action waits, and button labels do not change.

Both builds offer System, Light, and Dark themes, remember the choice when browser settings allow, and use Speak and Save WAV without a player bar. Speak caches the ten most recently used exact text-and-voice combinations and replays hits from the beginning without inference, including after the hosted model is unloaded. New combinations generate new audio. Replay history is limited to **10 clips and 64 MiB of WAV data**; least recently used clips are evicted until both limits hold. A single WAV larger than 64 MiB stays available as the current playback/save result outside history, and is released when another clip is selected or created, or the cache is cleared. Its size is shown separately. The page shows cached WAV bytes and offers Clear audio cache to release them. This cache lives only in tab memory, uses no persistent disk storage, and clears on tab close or reload.

Preparation shows sentence breaks, real phoneme-generation stages through an explicit callback added to the pinned Kokoro build, phoneme text, and completed-word counts. Counts advance when a sentence or long-sentence chunk completes; Kokoro does not expose individual-word completion. The build rejects a changed Kokoro implementation until its adapter is reviewed, and a missing callback raises an explicit error instead of silently dropping progress.

## Third-party components

| Component | Version / revision | License |
| --- | --- | --- |
| [PRN UI](https://github.com/dkorolev/prnui/tree/8a11eb419d3c12f699c312068f622378d3307b50) | 8a11eb419d3c12f699c312068f622378d3307b50 | **MIT** |
| [Kokoro-82M model and six voices](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231) | 1939ad2a8e416c0acfeecc08a694d14ef25f2231 | **Apache-2.0** |
| [kokoro-js](https://github.com/hexgrad/kokoro/tree/664c76a704021239ba59c84dcbaa4d3dece01fe9) | 1.2.1 | **Apache-2.0** |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js/tree/2ec882e739e4cb461f8d440d4d7394cbf5372429) | 3.8.1 | **Apache-2.0** |
| [phonemizer JavaScript wrapper (adapted)](https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278) | 1.2.1 (6835144b7ee9043129222549c1ed2f6a27216278) | **Apache-2.0** |
| [eSpeak NG code and language data (built by offline-speech)](https://github.com/espeak-ng/espeak-ng/tree/890071ff30231883d761e4d59edabd6d69faf159) | 890071ff30231883d761e4d59edabd6d69faf159 | **GPL-3.0-or-later** |
| [Emscripten runtime](https://github.com/emscripten-core/emscripten/tree/777e6e5db7b4990bcaeb1b9998ed642cc84e6629) | 7.0.0 (777e6e5db7b4990bcaeb1b9998ed642cc84e6629) | **MIT OR NCSA** |
| [musl libc and LLVM libc++/libc++abi/compiler-rt](https://github.com/emscripten-core/emscripten/tree/777e6e5db7b4990bcaeb1b9998ed642cc84e6629/system/lib) | Vendored by Emscripten 7.0.0 | **musl: MIT and component notices; LLVM: Apache-2.0 WITH LLVM-exception** |
| [Unicode character data in eSpeak NG ucd-tools](https://github.com/espeak-ng/espeak-ng/blob/890071ff30231883d761e4d59edabd6d69faf159/COPYING.UCD) | eSpeak NG 890071ff30231883d761e4d59edabd6d69faf159 | **Unicode data/software license (COPYING.UCD)** |
| [ONNX Runtime Web (JavaScript and WASM)](https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0) | 1.22.0-dev.20250409-89f8206ba4 | **MIT** |
| [onnxruntime-common (inside Transformers.js)](https://github.com/microsoft/onnxruntime/tree/e0b66cad282043d4377cea5269083f17771b6dfc) | 1.21.0 | **MIT** |
| [@huggingface/jinja (inside Transformers.js)](https://github.com/huggingface/huggingface.js/tree/c3f76b460cbfe5a9827123ab9e17a65998aeb70f) | 0.5.3 | **MIT** |

Kokoro is the speech model; eSpeak NG is the text-to-phoneme engine. These are separate components with separate licenses. The phonemizer JavaScript wrapper itself is Apache-2.0. Both names, roles, repository links, and licenses appear directly in each HTML page’s visible license summary, without opening the detailed inventory.

**Development/test tooling:** `puppeteer-core` 25.16.0 is **Apache-2.0** and is not shipped to visitors. Its complete transitive npm dependency inventory, with each package’s version and license, is included in both HTML builds and recorded in [package-lock.json](package-lock.json). Builds use Node’s built-ins; no npm runtime dependency is installed for production.

**The built HTML includes eSpeak NG code licensed under GPL-3.0-or-later (GNU General Public License version 3 or later).** This GPL-covered code is part of the HTML you share. offline-speech builds it from pinned source, as described under [eSpeak NG build](#espeak-ng-build); the adapted phonemizer wrapper's Apache-2.0 license is separate from the eSpeak NG license. The full GPL text is included in the HTML's notices.

`THIRD_PARTY_NOTICES.txt` contains upstream attributions, licenses, and ONNX Runtime dependency notices. The same text is embedded in the standalone HTML under **Licenses and dependencies**, so it travels with the file. The phonemizer wrapper and its embedded eSpeak NG code have different licenses; both are identified there. offline-speech’s own code is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). Third-party licenses remain unchanged. Both HTML builds include a visible license summary, browser dependency inventory, all locked npm development/test dependencies, and full license texts available offline. The hosted page links to separately cached `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` files to keep its HTML small; the standalone HTML embeds the full texts for portability. The npm tools are not shipped to app visitors.

Every build carries integration source and source for the bundled libraries, and names where its source is published: a build from an unmodified checkout links its exact commit on GitHub, while a build with local changes or from an unpacked source archive links the repository and points to the archives as the exact match. `npm run build:standalone` writes all source archives beside `offline-speech.html`, the hosted build writes them to `source/` with an `index.html` that the page links to, and CI artifacts and releases include all source archives and SOURCE_README.txt next to the HTML. Distributors must preserve notices and pass on that source and the pinned source directions, or otherwise meet GPL corresponding-source obligations. A separate HTML page does not automatically settle whether other code is a separate or combined work; see the [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation). ONNX Runtime’s full upstream notices cover multiple runtime variants, so their native dependency inventory is a superset of this browser build.

## eSpeak NG build

`third_party/espeak-ng/phonemizer.js` is committed and pinned by SHA-256 in `src/assets.mjs`. [`scripts/build-espeak-ng.sh`](scripts/build-espeak-ng.sh) rebuilds it byte-for-byte from eSpeak NG commit `890071ff30231883d761e4d59edabd6d69faf159` with Emscripten 7.0.0, applying the build fixes in [`third_party/espeak-ng/patches/`](third_party/espeak-ng/patches/) and appending [`src/phonemizer-wrapper.js`](src/phonemizer-wrapper.js), an adaptation of phonemizer 1.2.1's wrapper. That revision's English dictionary, phoneme tables, intonations, language and voice files are byte-identical to the data in phonemizer 1.2.1, which kokoro-js 1.2.1 was built against, so pronunciation is unchanged.

```sh
emsdk install 7.0.0 && emsdk activate 7.0.0 && source ./emsdk_env.sh
scripts/build-espeak-ng.sh
```

The script needs Git, CMake and a native C/C++ compiler; the `emscripten/emsdk:7.0.0` container provides all of them. CI rebuilds the module that way and fails if it differs from the committed file.

Builds write five corresponding-source archives: `offline-speech-source.tar.gz` for this repository’s tracked integration source; `espeak-ng-890071ff30231883d761e4d59edabd6d69faf159.tar.gz`; `kokoro-js-1.2.1-source.tar.gz`; `transformers-js-3.8.1-source.tar.gz`; and `huggingface-jinja-0.5.3-source.tar.gz`. Upstream archives are downloaded by `npm run download-assets` and checked against pinned SHA-256 hashes. The integration archive includes only the tracked paths listed in `scripts/source.mjs`, never untracked local files.

## Library source and legal notices

The source index and README identify every shipped library by a fixed upstream commit and give its source archive and build directions. Kokoro and Transformers.js use their published npm gitHead commits. Jinja 0.5.3 uses commit c3f76b460cbfe5a9827123ab9e17a65998aeb70f, identified by its npm release provenance. The embedded Jinja code matches that release, and the ONNX common code identifies itself as 1.21.0.

Both build targets bundle SHA-256-verified source archives for kokoro-js 1.2.1, Transformers.js 3.8.1, Jinja 0.5.3, and eSpeak NG, plus this repository’s integration source. The source index links directly to pinned ONNX Runtime, compiler/runtime, wrapper and PRN UI source trees and archives. It also includes the pinned Kokoro model/voice revision. Standalone output includes SOURCE_README.txt beside the HTML and inlines the same directions in its license section. Hosted output places all of these under source/; those source archives are not part of the offline speech download.

Both pages visibly state that offline-speech comes with no warranty and may be redistributed under GPLv3 or later, and show eSpeak NG’s upstream copyright notices with directions to the full GPL. This preserves the distinct licenses of the bundled components without asserting a personal project copyright.

The eSpeak module and patches declare the offline-speech modifications dated 2026-11-10. THIRD_PARTY_NOTICES.txt includes upstream eSpeak copyright notices, COPYING.UCD, Emscripten’s license and AUTHORS, musl’s COPYRIGHT, and LLVM libc++/libc++abi/compiler-rt license texts for the pinned Emscripten 7.0.0 source. These are identified separately from ONNX Runtime’s broader notices.

## Publication

The repository is public. The license cleanup, the Puppeteer upgrade, the pinned eSpeak NG build and corresponding-source packaging are complete, and CI rebuilds the eSpeak NG module byte-for-byte on Linux. A hosted copy, such as `dima.ai/tts/`, updates only when it is rebuilt from a newer commit.

### Updating an installed bookmark

Updates keep saved model, voice, and runtime files, including the payload caches
created by older releases. New builds reuse parts with matching content hashes and
sizes; Download fetches only missing or changed parts. Old tabs keep their own
versioned modules and cached payload until you choose to update. Files and earlier
page shells remain in browser storage so those tabs keep working; the storage
display includes them. Delete offline files removes all saved payload versions
for this app, while leaving page shells and other apps' caches alone. Clearing
this site's browser data also removes retained page shells.

An open tab shows **Update available** when a new worker takes control or when the
tab returns to the foreground online. **Update page** keeps the typed text and
selected voice, but clears generated audio and unloads the model. It waits for
playback to stop; an interrupted download retains completed parts. A tab opened
before this update notice existed needs one manual reload to gain the notice.
Already-saved files remain available during that transition.

The page uses PRN UI's cards, numbered section references, accent classes,
callouts, buttons, fields, metrics, and license tables. Application CSS owns
layout adjustments; theme palettes and component styling stay in PRN UI.

Run `node --test test/updates.test.mjs` for the small-payload Chrome regression:
two releases, a legacy payload cache, two open tabs, reused files, retained text,
offline reload, and explicit deletion. It creates and tears down its own HTTP
server and browser. `npm run test:e2e` includes this test alongside real speech.
