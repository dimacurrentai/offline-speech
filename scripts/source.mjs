// Corresponding source for every build: offline-speech's own source, which includes the eSpeak NG
// build script, patches and wrapper, and the pinned eSpeak NG source that the module is built from.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ESPEAK_NG_COMMIT, ESPEAK_NG_SOURCE } from "../src/assets.mjs";
import { verifyFile } from "./files.mjs";

export const OWN_SOURCE_ARCHIVE = "offline-speech-source.tar.gz";
export const ESPEAK_NG_SOURCE_ARCHIVE = path.basename(ESPEAK_NG_SOURCE.file);

// Downloads, models, build outputs and dependencies are not source; everything else in the tree is.
const NOT_SOURCE = new Set([".git", "node_modules", "models", "dist", "vendor"]);

function sourceFiles(root) {
  try {
    // A Git checkout: its tracked and untracked-but-not-ignored files, so stray secrets stay out.
    const listed = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return listed.split("\0").filter((file) => file && fs.existsSync(path.join(root, file)));
  } catch {
    // An unpacked source archive: every file outside the generated directories.
    return fs.readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
      .filter((file) => !NOT_SOURCE.has(file.split(path.sep)[0]));
  }
}

export async function writeSourceArchives(root, output) {
  const espeak = path.join(root, ESPEAK_NG_SOURCE.file);
  if (!(await verifyFile(espeak, ESPEAK_NG_SOURCE))) {
    throw new Error(`Missing or corrupt ${ESPEAK_NG_SOURCE.file}; run npm run download-libraries`);
  }
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(espeak, path.join(output, ESPEAK_NG_SOURCE_ARCHIVE));
  const files = sourceFiles(root).sort();
  execFileSync("tar", ["--no-xattrs", "-czf", path.join(output, OWN_SOURCE_ARCHIVE), "-C", root, "--null", "-T", "-"],
    { input: files.join("\0") + "\0", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  fs.writeFileSync(path.join(output, "README.txt"), `Corresponding source for this offline-speech build

${OWN_SOURCE_ARCHIVE}
  offline-speech's own source (GPL-3.0-or-later), including scripts/build-espeak-ng.sh,
  third_party/espeak-ng/patches/ and src/phonemizer-wrapper.js. Run npm run download-assets and
  npm run build to rebuild the app; scripts/build-espeak-ng.sh rebuilds the eSpeak NG module,
  third_party/espeak-ng/phonemizer.js, with Emscripten 7.0.0.

${ESPEAK_NG_SOURCE_ARCHIVE}
  eSpeak NG (GPL-3.0-or-later) at commit ${ESPEAK_NG_COMMIT}, as published at
  ${ESPEAK_NG_SOURCE.url}
  sha256 ${ESPEAK_NG_SOURCE.sha256}
`);
}
