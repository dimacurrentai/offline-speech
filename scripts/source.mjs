// Corresponding source for every build: offline-speech's own source, which includes the eSpeak NG
// build script, patches and wrapper, and the pinned eSpeak NG source that the module is built from.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ESPEAK_NG_COMMIT, ESPEAK_NG_SOURCE } from "../src/assets.mjs";
import { LIBRARY_SOURCE_ARCHIVES, PINNED_LIBRARY_SOURCES } from "../src/library-sources.mjs";
import { MODEL_ID } from "../src/assets.mjs";
import { MODEL_REVISION } from "../src/model-integrity.mjs";
import { verifyFile } from "./files.mjs";

export const OWN_SOURCE_ARCHIVE = "offline-speech-source.tar.gz";
export const ESPEAK_NG_SOURCE_ARCHIVE = path.basename(ESPEAK_NG_SOURCE.file);
export const SOURCE_ARCHIVES = [ESPEAK_NG_SOURCE, ...LIBRARY_SOURCE_ARCHIVES];
export const SOURCE_ARCHIVE_NAMES = [OWN_SOURCE_ARCHIVE, ...SOURCE_ARCHIVES.map(asset => path.basename(asset.file))];

// The repository's source paths. Only these are archived, so local files such as .env never are.
export const SOURCE_PATHS = [".github", ".gitignore", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.txt",
  "package-lock.json", "package.json", "scripts", "src", "test", "third_party"];

function walk(root, relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  if (!fs.statSync(full).isDirectory()) return [relative];
  return fs.readdirSync(full).flatMap((name) => walk(root, path.join(relative, name)));
}

export function sourceFiles(root) {
  let tracked;
  try {
    // A Git checkout: tracked files only, as they are in the working tree that is being built.
    tracked = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--", ...SOURCE_PATHS],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch {
    // An unpacked source archive, which has no Git metadata: the same source paths, walked.
    return SOURCE_PATHS.flatMap((entry) => walk(root, entry)).sort();
  }
  return tracked.filter((file) => fs.existsSync(path.join(root, file))).sort();
}

export async function checkSourceInputs(root) {
  for (const asset of SOURCE_ARCHIVES) {
    if (!(await verifyFile(path.join(root, asset.file), asset))) {
      throw new Error(`Missing or corrupt ${asset.file}; run npm run download-assets`);
    }
  }
}

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function sourceDirections() {
  return `${OWN_SOURCE_ARCHIVE}: offline-speech integration source, build scripts, dated eSpeak patches, and wrapper.
Rebuild with npm run download-assets and npm run build; scripts/build-espeak-ng.sh rebuilds eSpeak with Emscripten 7.0.0.

` +
    SOURCE_ARCHIVES.map(asset => `${path.basename(asset.file)}
  ${asset.url}
  sha256 ${asset.sha256}`).join("\n\n") + "\n\nPinned source and build directions for every library:\n\n" +
    PINNED_LIBRARY_SOURCES.map(item => `${item.name} ${item.version}
  commit ${item.revision}
  ${item.repository}/tree/${item.revision}
  archive: ${item.archive ?? `${item.repository}/archive/${item.revision}.tar.gz`}
  ${item.instructions}`).join("\n\n") +
    `\n\nKokoro model and six voices: ${MODEL_ID}, revision ${MODEL_REVISION}.
https://huggingface.co/${MODEL_ID}/tree/${MODEL_REVISION}
The pinned model/voice files are listed in src/assets.mjs and src/model-integrity.mjs.
`;
}
function sourceIndex() {
  const bundled = SOURCE_ARCHIVE_NAMES.map(name => `<li><a href="./${escape(name)}">${escape(name)}</a></li>`).join("\n");
  const upstream = PINNED_LIBRARY_SOURCES.map(item => `<li><a href="${escape(item.repository)}/tree/${item.revision}">${escape(item.name)} ${escape(item.version)} — ${item.revision}</a><p>${escape(item.instructions)}</p><a href="${escape(item.repository)}/archive/${item.revision}.tar.gz">Pinned upstream source archive</a></li>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>offline-speech source</title><link rel="stylesheet" href="../style.css"></head><body><main id="source"><h1>Corresponding source for this offline-speech build</h1><h2>Included source archives</h2><ul>${bundled}</ul><h2>Pinned library sources and build directions</h2><ul>${upstream}</ul><h2>Model and voices</h2><p><a href="https://huggingface.co/${MODEL_ID}/tree/${MODEL_REVISION}">${MODEL_ID}, revision ${MODEL_REVISION}</a></p><p><a href="./README.txt">README.txt</a> includes archive SHA-256 hashes and rebuild directions.</p></main></body></html>\n`;
}

// Writes the integration and bundled library source archives into `output`. With `index`, also writes README.txt and an index.html,
// so a static host serves the directory as a page without relying on directory listings.
export async function writeSourceArchives(root, output, { index = true } = {}) {
  await checkSourceInputs(root);
  fs.mkdirSync(output, { recursive: true });
  for (const asset of SOURCE_ARCHIVES) fs.copyFileSync(path.join(root, asset.file), path.join(output, path.basename(asset.file)));
  execFileSync("tar", ["--no-xattrs", "-czf", path.join(output, OWN_SOURCE_ARCHIVE), "-C", root, "--null", "-T", "-"],
    { input: sourceFiles(root).join("\0") + "\0", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  fs.writeFileSync(path.join(output, index ? "README.txt" : "SOURCE_README.txt"), `Corresponding source for this offline-speech build\n\n${sourceDirections()}`);
  if (index) fs.writeFileSync(path.join(output, "index.html"), sourceIndex());
}
