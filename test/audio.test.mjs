import { test } from "node:test";
import assert from "node:assert/strict";
import { splitIntoChunks, encodeWav } from "../src/audio.mjs";

const withoutSpace = (text) => text.replace(/\s/gu, "");
test("chunking preserves long words, punctuation, Unicode, and every non-space character", () => {
  for (const text of [
    "x".repeat(950),
    "https://example.test/" + "path".repeat(150),
    "𐐀".repeat(450),
    "Hello! This is another sentence. ".repeat(40),
    "ééé 日本語 العربية 123",
    "a ".repeat(149) + "😀𐐀".repeat(100),
    "hello " + ".".repeat(620) + " world",
  ]) {
    const chunks = splitIntoChunks(text);
    assert.ok(chunks.length);
    assert.equal(withoutSpace(chunks.join("")), withoutSpace(text));
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 300);
      assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk), "split surrogate pair");
    }
  }
  assert.deepEqual(splitIntoChunks(" \n\t"), []);
  assert.deepEqual(splitIntoChunks("...!? 😀"), []);
  assert.deepEqual(splitIntoChunks("ééé"), ["ééé"]);
});

test("WAV contains correct PCM metadata, clipped samples, and exact inter-chunk silence", async () => {
  const wav = encodeWav([new Float32Array([-2, -1, 0, 1, 2]), new Float32Array([0.5])], 24000);
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(wav.type, "audio/wav");
  assert.equal(wav.size, 44 + (6 + 3600) * 2);
  assert.equal(view.getUint32(4, true), wav.size - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(28, true), 48000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), wav.size - 44);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767]);
  for (let i = 5; i < 3605; i++) assert.equal(view.getInt16(44 + i * 2, true), 0);
  assert.equal(view.getInt16(wav.size - 2, true), 16383);
  assert.equal(encodeWav([new Float32Array([0])], 24000).size, 46, "no trailing gap");
});

test("invalid audio is rejected instead of producing a corrupt WAV", () => {
  assert.throws(() => encodeWav([new Float32Array([NaN])], 24000), /invalid audio/);
  assert.throws(() => encodeWav([], 0), /sample rate/);
  assert.throws(() => encodeWav([], 24000, -1), /gap/);
  assert.throws(() => encodeWav([{ length: 2 ** 31 }], 24000), /too large/);
});

test("speech planning preserves sentence breaks and counts a split long word only when complete", async () => {
  const { planSpeech } = await import("../src/audio.mjs");
  const plan = planSpeech(`Hello world. ${"X".repeat(450)}!`);
  assert.equal(plan.sentences.length, 2);
  assert.equal(plan.totalWords, 3);
  assert.deepEqual(plan.chunks.map(chunk => chunk.words), [2, 0, 1]);
  assert.equal(plan.chunks.map(chunk => chunk.text).join("").replace(/\s/g, ""), `Helloworld.${"X".repeat(450)}!`);
});

test("speech progress observes actual phonemization and never counts in-flight inference words", async () => {
  const { planSpeech, generateSpeechPieces } = await import("../src/audio.mjs");
  const events = [], tokenizer = value => value;
  let release;
  const tts = { tokenizer, async generate(text) {
    this.tokenizer(`phonemes:${text}`);
    await new Promise(resolve => { release = resolve; });
    return { audio: new Float32Array([0.2]), sampling_rate: 24000 };
  } };
  const pending = generateSpeechPieces(tts, planSpeech("Hello world."), "af_heart", event => events.push(event));
  assert.deepEqual(events.map(event => event.stage), ["split", "phonemes", "generating"]);
  assert.equal(events.at(-1).completedWords, 0);
  assert.equal(events.at(-1).phonemes, "phonemes:Hello world.");
  release(); await pending;
  assert.equal(events.find(event => event.stage === "completed").completedWords, 2);
  assert.equal(events.at(-1).stage, "encoding");
  assert.equal(tts.tokenizer, tokenizer);
});

test("failed and cancelled generation restores the tokenizer and stops subsequent sentences", async () => {
  const { planSpeech, generateSpeechPieces } = await import("../src/audio.mjs");
  const tokenizer = text => text, events = [];
  const tts = { tokenizer, async generate() { throw new Error("inference failed"); } };
  await assert.rejects(generateSpeechPieces(tts, planSpeech("Hello."), "af_heart", e => events.push(e)), /inference failed/);
  assert.equal(tts.tokenizer, tokenizer);
  assert.equal(events.at(-1).stage, "error");
  let calls = 0;
  tts.generate = async () => { calls++; return { audio: new Float32Array([0.1]), sampling_rate: 24000 }; };
  assert.equal(await generateSpeechPieces(tts, planSpeech("Hello. Another sentence."), "af_heart", () => {}, () => calls > 0), null);
  assert.equal(calls, 1);
});
