import { MANIFEST } from "./manifest.js";
import { urlFor, readAsset, resolveAsset } from "./storage.js";
import { planSpeech, generateSpeechPieces, encodeWav } from "./audio.js";

let tts, busy = false, cancelled = false;
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (/^(blob|data):/.test(url)) return realFetch(input, init);
  const asset = resolveAsset(url);
  return asset ? readAsset(asset) : new Response(null, { status: 404 });
};
const assetUrl = (key) => urlFor(MANIFEST.assets.find((asset) => asset.key === key).url);
self.addEventListener("message", async ({ data }) => {
  if (data.type === "cancel") { cancelled = true; return; }
  if (busy) return;
  busy = true;
  cancelled = false;
  try {
    if (data.type === "load") {
      const { env } = await import(assetUrl("@huggingface/transformers"));
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = "/models/";
      env.useBrowserCache = false;
      env.backends.onnx.wasm.wasmPaths = { mjs: assetUrl("ort.mjs"), wasm: assetUrl("ort.wasm") };
      env.backends.onnx.wasm.numThreads = 1;
      const { KokoroTTS } = await import(assetUrl("kokoro-js"));
      tts = await KokoroTTS.from_pretrained(MANIFEST.modelId, { dtype: "q8", device: "wasm" });
      self.postMessage({ type: "ready" });
    } else if (data.type === "speak") {
      if (!tts) throw new Error("Load the model first");
      if (data.text.length > 20000) throw new Error("Please use at most 20,000 characters");
      const started = performance.now();
      const result = await generateSpeechPieces(tts, planSpeech(data.text), data.voice,
        progress => self.postMessage({ type: "progress", ...progress }), () => cancelled);
      if (!result) { self.postMessage({ type: "cancelled" }); return; }
      const { pieces, sampleRate: rate } = result;
      const wav = encodeWav(pieces, rate);
      self.postMessage({ type: "done", text: data.text, voice: data.voice, wav, sampleRate: rate, duration: (wav.size - 44) / 2 / rate, elapsed: (performance.now() - started) / 1000 });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message ?? String(error) });
  } finally { busy = false; }
});
