// The pinned PRN UI specimen is the stylesheet. offline-speech does not keep a second palette.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PINNED_LIBRARY_SOURCES } from "../src/library-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PRNUI_DIR = "third_party/prnui";
export const PRNUI_SOURCE_FILES = ["third_party/prnui/prnui.html", "third_party/prnui/LICENSE"];

export function prnuiSource() {
  const item = PINNED_LIBRARY_SOURCES.find((source) => source.repository === "https://github.com/dkorolev/prnui");
  if (!item) throw new Error("PRN UI is missing from the pinned library sources");
  return item;
}

function head(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// `git submodule update` skips this pin (`update = none`): it is the light-theme commit,
// and a parent repository's recursive update must not fail before that commit is on main.
export function ensurePrnui(root = ROOT) {
  const item = prnuiSource();
  const dir = path.join(root, PRNUI_DIR);
  const specimen = path.join(dir, "prnui.html");
  if (fs.existsSync(specimen) && head(dir) === item.revision) return item;
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", `${item.repository}.git`, dir], { stdio: ["ignore", "inherit", "inherit"] });
  }
  if (head(dir) !== item.revision) {
    execFileSync("git", ["-C", dir, "fetch", "--depth", "1", "origin", item.revision], { stdio: ["ignore", "inherit", "inherit"] });
    execFileSync("git", ["-C", dir, "checkout", "--detach", item.revision], { stdio: ["ignore", "inherit", "inherit"] });
  }
  if (head(dir) !== item.revision || !fs.existsSync(specimen)) {
    throw new Error(`Could not check out PRN UI ${item.revision} at ${PRNUI_DIR}`);
  }
  return item;
}

export function prnuiCss(root = ROOT) {
  ensurePrnui(root);
  const source = fs.readFileSync(path.join(root, PRNUI_DIR, "prnui.html"), "utf8");
  const styles = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1].trim());
  if (styles.length !== 1) throw new Error("The PRN UI specimen must contain exactly one style block");
  if (/<\/style/i.test(styles[0])) throw new Error("The PRN UI stylesheet contains a style end tag");
  return `${styles[0]}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) ensurePrnui();
