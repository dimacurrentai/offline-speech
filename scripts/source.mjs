// Corresponding source for every build: offline-speech's own source, which includes the eSpeak NG
// build script, patches and wrapper, and the pinned eSpeak NG source that the module is built from.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ESPEAK_NG_COMMIT, ESPEAK_NG_SOURCE } from "../src/assets.mjs";
import { verifyFile } from "./files.mjs";

export const OWN_SOURCE_ARCHIVE = "offline-speech-source.tar.gz";
export const ESPEAK_NG_SOURCE_ARCHIVE = path.basename(ESPEAK_NG_SOURCE.file);

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
  if (!(await verifyFile(path.join(root, ESPEAK_NG_SOURCE.file), ESPEAK_NG_SOURCE))) {
    throw new Error(`Missing or corrupt ${ESPEAK_NG_SOURCE.file}; run npm run download-assets`);
  }
}

const ARCHIVES = `${OWN_SOURCE_ARCHIVE}
  offline-speech's own source (GPL-3.0-or-later), including scripts/build-espeak-ng.sh,
  third_party/espeak-ng/patches/ and src/phonemizer-wrapper.js. Run npm run download-assets and
  npm run build to rebuild the app; scripts/build-espeak-ng.sh rebuilds the eSpeak NG module,
  third_party/espeak-ng/phonemizer.js, with Emscripten 7.0.0.

${ESPEAK_NG_SOURCE_ARCHIVE}
  eSpeak NG (GPL-3.0-or-later) at commit ${ESPEAK_NG_COMMIT}, as published at
  ${ESPEAK_NG_SOURCE.url}
  sha256 ${ESPEAK_NG_SOURCE.sha256}
`;

const INDEX = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>offline-speech source</title></head>
<body><h1>Corresponding source for this offline-speech build</h1>
<ul><li><a href="./${OWN_SOURCE_ARCHIVE}">${OWN_SOURCE_ARCHIVE}</a>: offline-speech’s own source (GPL-3.0-or-later), including the eSpeak NG build script, patches and wrapper.</li>
<li><a href="./${ESPEAK_NG_SOURCE_ARCHIVE}">${ESPEAK_NG_SOURCE_ARCHIVE}</a>: eSpeak NG (GPL-3.0-or-later) at commit ${ESPEAK_NG_COMMIT}, sha256 ${ESPEAK_NG_SOURCE.sha256}.</li></ul>
<p><a href="./README.txt">README.txt</a> explains how to rebuild from them.</p></body></html>
`;

// Writes both archives into `output`. With `index`, also writes README.txt and an index.html,
// so a static host serves the directory as a page without relying on directory listings.
export async function writeSourceArchives(root, output, { index = true } = {}) {
  await checkSourceInputs(root);
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(root, ESPEAK_NG_SOURCE.file), path.join(output, ESPEAK_NG_SOURCE_ARCHIVE));
  execFileSync("tar", ["--no-xattrs", "-czf", path.join(output, OWN_SOURCE_ARCHIVE), "-C", root, "--null", "-T", "-"],
    { input: sourceFiles(root).join("\0") + "\0", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (index) {
    fs.writeFileSync(path.join(output, "README.txt"), `Corresponding source for this offline-speech build\n\n${ARCHIVES}`);
    fs.writeFileSync(path.join(output, "index.html"), INDEX);
  }
}
