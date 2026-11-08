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
  const tts = { tokenizer, async generate(text, { onPhonemes }) {
    onPhonemes(`phonemes:${text}`);
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

test("failed and cancelled generation leaves the tokenizer untouched and stops subsequent sentences", async () => {
  const { planSpeech, generateSpeechPieces } = await import("../src/audio.mjs");
  const tokenizer = text => text, events = [];
  const tts = { tokenizer, async generate() { throw new Error("inference failed"); } };
  await assert.rejects(generateSpeechPieces(tts, planSpeech("Hello."), "af_heart", e => events.push(e)), /inference failed/);
  assert.equal(tts.tokenizer, tokenizer);
  assert.equal(events.at(-1).stage, "error");
  let calls = 0;
  tts.generate = async (text, { onPhonemes }) => { onPhonemes("test phonemes"); calls++; return { audio: new Float32Array([0.1]), sampling_rate: 24000 }; };
  assert.equal(await generateSpeechPieces(tts, planSpeech("Hello. Another sentence."), "af_heart", () => {}, () => calls > 0), null);
  assert.equal(calls, 1);
});


test("generation fails clearly when a library upgrade drops the phoneme callback", async () => {
  const { planSpeech, generateSpeechPieces } = await import("../src/audio.mjs");
  const tts = { async generate() { return { audio: new Float32Array([0.1]), sampling_rate: 24000 }; } };
  await assert.rejects(generateSpeechPieces(tts, planSpeech("Hello."), "af_heart", () => {}), /did not report phoneme progress/);
});


test("the ten-entry audio cache keys text and voice, keeps recently replayed clips, and releases evicted WAVs", async () => {
  const { createSpeechCache } = await import("../src/audio.mjs");
  const cache = createSpeechCache(), urls = [];
  const usage = () => { const { count, bytes } = cache.stats(); return { count, bytes }; };
  try {
    for (let i = 0; i < 10; i++) urls.push(cache.put(`phrase${i}`, "voiceA", new Blob([String(i)])));
    assert.deepEqual(usage(), { count: 10, bytes: 10 });
    assert.equal(cache.get("phrase0", "voiceA"), urls[0]);
    cache.put("phrase0", "voiceB", new Blob(["other"]));
    assert.equal(cache.has("phrase0", "voiceA"), true);
    assert.equal(cache.has("phrase0", "voiceB"), true);
    assert.equal(cache.has("phrase0 ", "voiceA"), false);
    assert.equal(cache.has("phrase1", "voiceA"), false);
    assert.deepEqual(usage(), { count: 10, bytes: 14 });
    assert.equal(await (await fetch(urls[0])).text(), "0");
    await assert.rejects(fetch(urls[1]));
    cache.clear();
    assert.deepEqual(usage(), { count: 0, bytes: 0 });
    await assert.rejects(fetch(urls[0]));
  } finally { cache.clear(); }
});


test("audio history obeys the byte budget, releases evicted URLs, and handles an oversized current file", async () => {
  const { createSpeechCache } = await import("../src/audio.mjs");
  const cache = createSpeechCache(10, 6);
  try {
    const a = cache.put("a", "voice", new Blob(["aa"]));
    const b = cache.put("b", "voice", new Blob(["bb"]));
    const c = cache.put("c", "voice", new Blob(["cc"]));
    cache.get("a", "voice");
    const d = cache.put("d", "voice", new Blob(["ddd"]));
    assert.equal(cache.stats().bytes, 5);
    assert.equal(cache.has("a", "voice"), true);
    assert.equal(cache.has("b", "voice"), false);
    assert.equal(cache.has("c", "voice"), false);
    await assert.rejects(fetch(b)); await assert.rejects(fetch(c));
    cache.put("d", "voice", new Blob(["d"]));
    assert.equal(cache.stats().bytes, 3);
    await assert.rejects(fetch(d));
    const large = cache.put("large", "voice", new Blob(["1234567"]));
    assert.equal(cache.stats().bytes, 3, "oversized current output does not enter replay history");
    assert.equal(cache.stats().currentUncachedBytes, 7);
    assert.equal(cache.get("large", "voice"), large, "current output can still replay");
    assert.equal(await (await fetch(large)).text(), "1234567");
    assert.equal(cache.get("a", "voice"), a);
    assert.equal(cache.stats().currentUncachedBytes, 0);
    assert.equal(cache.has("large", "voice"), false);
    await assert.rejects(fetch(large));
    cache.clear();
    assert.equal(cache.stats().bytes, 0);
    await assert.rejects(fetch(a));
  } finally { cache.clear(); }
});

test("cancelled and superseded playback never produces a false block message", async () => {
  const { createSpeechPlayer } = await import("../src/audio.mjs");
  const reports = [], pending = [];
  const audio = { currentTime: 8, pause() {}, play() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); } };
  const player = createSpeechPlayer(audio, message => reports.push(message));
  const first = player.play({ automatic: true });
  const replay = player.play({ restart: true });
  assert.equal(audio.currentTime, 0);
  pending[0].reject(new DOMException("Interrupted by replay", "AbortError"));
  pending[1].resolve(); await Promise.all([first, replay]);
  assert.deepEqual(reports, ["Done — playing the prepared speech."]);
  reports.length = 0;
  const stale = player.play({ automatic: true });
  player.stop();
  pending[2].reject(new DOMException("Old block result", "NotAllowedError"));
  await stale;
  assert.deepEqual(reports, []);
  const aborted = player.play({ automatic: true });
  pending[3].reject(new DOMException("Stopped", "AbortError")); await aborted;
  assert.deepEqual(reports, []);
});

test("playback reports genuine policy blocks separately from unsupported audio", async () => {
  const { createSpeechPlayer } = await import("../src/audio.mjs");
  const reports = [];
  let error = new DOMException("Policy denied", "NotAllowedError");
  const player = createSpeechPlayer({ pause() {}, play() { return Promise.reject(error); } }, message => reports.push(message));
  await player.play({ automatic: true });
  assert.match(reports.pop(), /Automatic playback was blocked/);
  await player.play({ restart: true });
  assert.match(reports.pop(), /playback is blocked/);
  error = new DOMException("Unsupported audio format", "NotSupportedError");
  await player.play({ automatic: true });
  const message = reports.pop();
  assert.match(message, /playback failed: Unsupported audio format/);
  assert.ok(!message.includes("blocked"));
});
