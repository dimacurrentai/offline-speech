import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESPEAK_NG_COMMIT, ESPEAK_NG_SOURCE, LIBRARY_FILES } from "../src/assets.mjs";
import { verifyFile } from "../scripts/files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = LIBRARY_FILES.find((asset) => asset.name === "phonemizer");

test("the committed eSpeak NG module matches its pinned build and source revision", async () => {
  assert.equal(MODULE.file, "third_party/espeak-ng/phonemizer.js");
  assert.equal(MODULE.url, undefined);
  assert.ok(await verifyFile(path.join(ROOT, MODULE.file), MODULE));
  const script = fs.readFileSync(path.join(ROOT, "scripts", "build-espeak-ng.sh"), "utf8");
  assert.match(script, new RegExp(`^ESPEAK_NG_COMMIT=${ESPEAK_NG_COMMIT}$`, "m"));
  assert.ok(ESPEAK_NG_SOURCE.url.endsWith(`/${ESPEAK_NG_COMMIT}.tar.gz`));
  const header = fs.readFileSync(path.join(ROOT, MODULE.file), "latin1").slice(0, 400);
  assert.ok(header.includes(`eSpeak NG ${ESPEAK_NG_COMMIT}`));
  // One modification date, kept in the build script, dates the module and every patch.
  const date = /^MODIFIED_DATE=(\d{4}-\d{2}-\d{2})$/m.exec(script)?.[1];
  assert.ok(date, "build-espeak-ng.sh must set MODIFIED_DATE");
  assert.ok(header.includes(`with Emscripten 7.0.0.\n// Modified by offline-speech, ${date}: patches 0001-0003`));
  for (const patch of fs.readdirSync(path.join(ROOT, "third_party/espeak-ng/patches"))) {
    assert.ok(fs.readFileSync(path.join(ROOT, "third_party/espeak-ng/patches", patch), "utf8").startsWith(`Modified by offline-speech, ${date}.\n`), patch);
  }
  const wrapper = fs.readFileSync(path.join(ROOT, "src", "phonemizer-wrapper.js"), "utf8");
  assert.ok(fs.readFileSync(path.join(ROOT, MODULE.file), "utf8").endsWith(wrapper), "the module must end with the wrapper");
});

// Expected output is phonemizer 1.2.1's, which kokoro-js 1.2.1 was built against.
const EXPECTED = {
  "en-us": [
    ["Hello from the offline bookmark.", ["həlˈoʊ fɹʌmðɪ ˈɔflaɪn bˈʊkmɑːɹk"]],
    ["The quick brown fox jumps over the lazy dog.", ["ðə kwˈɪk bɹˈaʊn fˈɑːks dʒˈʌmps ˌoʊvɚ ðə lˈeɪzi dˈɑːɡ"]],
    ["I read 42 books in 2024, didn't I?", ["aɪ ɹˈiːd fˈoːɹɾi tˈuː bˈʊks ɪn tˈuː θˈaʊzənd twˈɛnti fˈoːɹ", "dˈɪdnt ˈaɪ"]],
    ["Our horse was hoarse at the door.", ["ˌaʊɚ hˈɔːɹs wʌz hˈoːɹs æt ðə dˈoːɹ"]],
  ],
  "en": [
    ["Hello from the offline bookmark.", ["həlˈəʊ fɹʌmðɪ ˈɒflaɪn bˈʊkmɑːk"]],
    ["The quick brown fox jumps over the lazy dog.", ["ðə kwˈɪk bɹˈaʊn fˈɒks dʒˈʌmps ˌəʊvə ðə lˈeɪzi dˈɒɡ"]],
    ["I read 42 books in 2024, didn't I?", ["aɪ ɹˈiːd fˈɔːti tˈuː bˈʊks ɪn tˈuː θˈaʊzənd ən twˈɛnti fˈɔː", "dˈɪdnt ˈaɪ"]],
    ["Our horse was hoarse at the door.", ["ˌaʊə hˈɔːs wɒz hˈɔːs at ðə dˈɔː"]],
  ],
};

test("the eSpeak NG module phonemizes English exactly like phonemizer 1.2.1", async () => {
  const { phonemize, list_voices } = await import(pathToFileURL(path.join(ROOT, MODULE.file)));
  for (const [language, cases] of Object.entries(EXPECTED)) {
    for (const [text, phonemes] of cases) assert.deepEqual(await phonemize(text, language), phonemes, `${language}: ${text}`);
  }
  assert.equal((await list_voices("en")).length, 8);
  await assert.rejects(phonemize("Bonjour", "fr"), /Invalid language identifier/);
});
