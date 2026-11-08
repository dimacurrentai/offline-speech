// Shared speech preparation, progress, and WAV helpers, also inlined by the build.
export function splitIntoChunks(text, maxLength = 300) {
  if (!Number.isInteger(maxLength) || maxLength < 2) throw new Error("Invalid chunk length");
  if (!/[\p{L}\p{N}]/u.test(text)) return [];
  const chunks = [];
  let current = "";
  const push = (piece) => {
    if (current && current.length + 1 + piece.length > maxLength) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${piece}` : piece;
  };
  for (const sentence of text.trim().split(/(?<=[.!?…;:])\s+/)) {
    if (sentence.length <= maxLength) {
      push(sentence);
      continue;
    }
    for (const word of sentence.split(/\s+/)) {
      // Iterate code points so a boundary never splits a surrogate pair.
      let piece = "";
      for (const character of word) {
        if (piece.length + character.length > maxLength) {
          push(piece);
          piece = "";
        }
        piece += character;
      }
      if (piece) push(piece);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Encode each piece directly, avoiding a second, combined Float32 audio buffer.
export function encodeWav(pieces, sampleRate, gapSeconds = 0.15) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0x7fffffff) {
    throw new Error("Invalid sample rate");
  }
  if (!Number.isFinite(gapSeconds) || gapSeconds < 0) throw new Error("Invalid audio gap");
  const gap = Math.round(gapSeconds * sampleRate);
  const sampleCount = pieces.reduce((n, piece) => n + piece.length, 0) + gap * Math.max(0, pieces.length - 1);
  const dataBytes = sampleCount * 2;
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffffffff - 36) throw new Error("Audio is too large for WAV");
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  header.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, dataBytes, true);
  const parts = [header.buffer];
  const silence = new Uint8Array(pieces.length > 1 ? gap * 2 : 0);
  for (let p = 0; p < pieces.length; p++) {
    const samples = pieces[p];
    const pcm = new DataView(new ArrayBuffer(samples.length * 2));
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw new Error("The model returned invalid audio samples");
      const value = Math.max(-1, Math.min(1, samples[i]));
      pcm.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    if (p) parts.push(silence);
    parts.push(pcm.buffer);
  }
  return new Blob(parts, { type: "audio/wav" });
}

// Kokoro returns one waveform per inference call, not per-word callbacks.
// Count words only after the corresponding sentence/chunk has really completed.
export function planSpeech(text) {
  const words = new Intl.Segmenter("en", { granularity: "word" });
  const compactLength = value => value.replace(/\s/gu, "").length;
  const sentences = [], chunks = [];
  for (const { segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text.trim())) {
    const parts = splitIntoChunks(segment.trim());
    if (!parts.length) continue;
    const sentence = sentences.length;
    const source = segment.trim();
    const wordEnds = [];
    let position = 0;
    for (const part of words.segment(source)) {
      position += compactLength(part.segment);
      if (part.isWordLike) wordEnds.push(position);
    }
    sentences.push({ text: source, words: wordEnds.length });
    let offset = 0, completed = 0;
    for (const part of parts) {
      offset += compactLength(part);
      let count = completed;
      while (count < wordEnds.length && wordEnds[count] <= offset) count++;
      chunks.push({ text: part, words: count - completed, sentence });
      completed = count;
    }
  }
  return { sentences, chunks, totalWords: chunks.reduce((sum, chunk) => sum + chunk.words, 0) };
}

export async function generateSpeechPieces(tts, plan, voice, report, isCancelled = () => false) {
  const { sentences, chunks, totalWords } = plan;
  if (!chunks.length) throw new Error("Type something to speak");
  const pieces = [], sentenceWords = sentences.map(() => 0);
  let sampleRate, completedWords = 0, phonemized = 0;
  const emit = (stage, extra = {}) => report({ stage, totalWords, completedWords, phonemized, totalChunks: chunks.length, totalSentences: sentences.length, ...extra });
  emit("split", { sentences });
  try {
    for (let index = 0; index < chunks.length; index++) {
      if (isCancelled()) { emit("cancelled"); return null; }
      const chunk = chunks[index];
      const position = { current: index + 1, sentence: chunk.sentence };
      emit("phonemes", position);
      // The tokenizer is called after Kokoro's own normalization + phonemization.
      // Observe that real boundary rather than duplicating its phonemizer logic.
      const tokenizer = tts.tokenizer;
      if (typeof tokenizer === "function") tts.tokenizer = new Proxy(tokenizer, {
        apply(target, receiver, args) {
          const result = Reflect.apply(target, receiver, args);
          phonemized++;
          emit("generating", { ...position, phonemes: args[0] });
          return result;
        },
      });
      let output;
      try { output = await tts.generate(chunk.text, { voice }); }
      finally { tts.tokenizer = tokenizer; }
      if (!output.audio?.length) throw new Error("The model returned empty audio");
      if (sampleRate !== undefined && sampleRate !== output.sampling_rate) throw new Error("The model changed sample rate between chunks");
      sampleRate = output.sampling_rate;
      pieces.push(output.audio);
      completedWords += chunk.words;
      sentenceWords[chunk.sentence] += chunk.words;
      emit("completed", { ...position, sentenceWords: sentenceWords[chunk.sentence] });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (isCancelled()) { emit("cancelled"); return null; }
    emit("encoding");
    return { pieces, sampleRate };
  } catch (error) { emit("error"); throw error; }
}

// Shared by the hosted page and the standalone HTML; every value is text, not HTML.
export function renderSpeechProgress(event) {
  const $ = id => document.getElementById(id);
  $("speech-preparation").hidden = false;
  const { stage, totalWords, completedWords, sentence, totalSentences, phonemized, totalChunks } = event;
  if (stage === "split") {
    $("sentence-progress").replaceChildren(...event.sentences.map(item => {
      const li = document.createElement("li");
      const text = document.createElement("span"), state = document.createElement("small");
      text.textContent = item.text; state.textContent = `0 / ${item.words} words · waiting`;
      li.append(text, state); li.dataset.words = item.words;
      return li;
    }));
    $("split-state").textContent = `Sentence breaks · ${totalSentences} sentence${totalSentences === 1 ? "" : "s"}, ${totalChunks} model chunk${totalChunks === 1 ? "" : "s"}`;
    $("phoneme-text").textContent = "Waiting for phonemes…";
  }
  if (Number.isFinite(totalWords)) {
    $("speech-progress").max = Math.max(1, totalWords);
    $("speech-progress").value = completedWords;
    $("generation-state").textContent = `Speech generation · ${completedWords} / ${totalWords} words complete`;
    $("phoneme-state").textContent = `Phoneme generation · ${phonemized} / ${totalChunks} chunk${totalChunks === 1 ? "" : "s"} prepared`;
  }
  const labels = { split: "Sentence breaks ready", phonemes: `Generating phonemes · sentence ${sentence + 1} of ${totalSentences}`, generating: `Generating speech · sentence ${sentence + 1} of ${totalSentences}`, completed: `Generated sentence chunk ${event.current} of ${totalChunks}`, encoding: "Preparing WAV file…", cancelled: "Preparation stopped", error: "Preparation failed", done: "WAV ready · speech generation complete" };
  $("speech-stage").textContent = labels[stage];
  if (event.phonemes !== undefined) $("phoneme-text").textContent = event.phonemes;
  const row = $("sentence-progress").children[sentence];
  if (row) {
    row.setAttribute("aria-current", stage === "completed" ? "false" : "step");
    row.lastChild.textContent = stage === "completed" ? `${event.sentenceWords} / ${row.dataset.words} words complete` : stage === "phonemes" ? "Generating phonemes…" : "Generating speech…";
  }
}
