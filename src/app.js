// The page's runtime. It is a classic script, not a module, so it can register the
// import map before any module loads. The build replaces __MODEL_ID__, __VOICES__,
// and the AUDIO_HELPERS and UNPACK_HELPERS markers.
//
// Startup: unpack the embedded files into blob: URLs, point the libraries' bare
// imports at them with an import map, answer the libraries' model and voice fetches
// from memory, load the model, and only then enable Speak.

(async () => {
  const MODEL_ID = __MODEL_ID__;
  const VOICES = __VOICES__;
  const MAX_TEXT_CHARS = 20_000;
  const GAP_SECONDS = 0.15; // Silence between chunks.

  const $ = (id) => document.getElementById(id);
  const setStatus = (message) => { $("status").textContent = message; };

  for (const { id, label } of VOICES) $("voice").add(new Option(label, id));

  /*UNPACK_HELPERS*/

  // kokoro-js imports `path` and `fs/promises` but only uses them under Node.
  // An undefined default export sends it down its browser code path.
  const nodeShim = URL.createObjectURL(new Blob(["export default undefined;"], { type: "text/javascript" }));

  /*AUDIO_HELPERS*/
  setupTheme();

  let tts;
  try {
    setStatus("Unpacking the embedded model…");
    const libraryUrls = Object.create(null);
    const modelUrls = Object.create(null);
    for (const el of [...document.querySelectorAll("script[data-asset]")]) {
      const table = el.dataset.kind === "model" ? modelUrls : libraryUrls;
      table[el.dataset.asset] = URL.createObjectURL(await unpackAsset(el));
    }

    const importMap = document.createElement("script");
    importMap.type = "importmap";
    importMap.textContent = JSON.stringify({
      imports: {
        "kokoro-js": libraryUrls["kokoro-js"],
        "@huggingface/transformers": libraryUrls["@huggingface/transformers"],
        phonemizer: libraryUrls.phonemizer,
        path: nodeShim,
        "fs/promises": nodeShim,
      },
    });
    document.head.append(importMap);

    // Model files are requested as /models/<MODEL_ID>/<file>; kokoro-js requests voices from
    // a hardcoded huggingface.co URL ending in voices/<id>.bin. Both are served from memory.
    // Anything else gets a 404: this page never touches the network.
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("blob:") || url.startsWith("data:")) return realFetch(input, init);
      const name = Object.keys(modelUrls).find((key) => url.endsWith(`/${key}`));
      return name ? realFetch(modelUrls[name]) : new Response(null, { status: 404, statusText: "Not embedded" });
    };

    const { env } = await import("@huggingface/transformers");
    env.allowLocalModels = true; // Off by default in browsers.
    env.allowRemoteModels = false;
    env.localModelPath = "/models/";
    env.useBrowserCache = false;
    env.backends.onnx.wasm.wasmPaths = { mjs: libraryUrls["ort.mjs"], wasm: libraryUrls["ort.wasm"] };
    env.backends.onnx.wasm.numThreads = 1; // Threads need cross-origin isolation, which file:// lacks.

    setStatus("Loading the model…");
    const { KokoroTTS } = await import("kokoro-js");
    tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm" });
  } catch (err) {
    setStatus(`Error: ${err?.message ?? err}`);
    return;
  }

  let wavUrl = null;
  const speechCache = createSpeechCache();
  const player = createSpeechPlayer($("audio"), setStatus);
  renderSpeechCache(speechCache);
  let busy = false;
  let cancelled = false;
  async function speak() {
    if (busy) return;
    const text = $("text").value;
    if (text.length > MAX_TEXT_CHARS) return setStatus("Please use at most 20,000 characters at a time.");
    const plan = planSpeech(text);
    if (!plan.chunks.length) return setStatus("Type something to speak.");
    const voice = $("voice").value;
    const cachedUrl = speechCache.get(text, voice);
    if (cachedUrl) {
      renderSpeechCache(speechCache);
      $("speech-preparation").hidden = true;
      wavUrl = cachedUrl;
      $("download").href = cachedUrl;
      $("download").setAttribute("aria-disabled", "false");
      if ($("audio").src !== cachedUrl) $("audio").src = cachedUrl;
      void player.play({ restart: true });
      return;
    }
    player.stop();
    busy = true;
    $("clear-audio-cache").disabled = true;
    cancelled = false;
    $("speak").disabled = true;
    $("voice").disabled = true;
    $("cancel").disabled = false;
    $("cancel").textContent = "Cancel preparation";
    const started = performance.now();
    try {
      const result = await generateSpeechPieces(tts, plan, voice, event => {
        renderSpeechProgress(event);
        setStatus($("speech-stage").textContent);
      }, () => cancelled);
      if (!result) return setStatus("Cancelled.");
      const { pieces, sampleRate } = result;
      const wav = encodeWav(pieces, sampleRate, GAP_SECONDS);
      wavUrl = speechCache.put(text, voice, wav);
      $("audio").src = wavUrl;
      $("download").href = wavUrl;
      $("download").setAttribute("aria-disabled", "false");
      const took = ((performance.now() - started) / 1000).toFixed(1);
      const duration = (wav.size - 44) / 2 / sampleRate;
      setStatus(`Done — ${duration.toFixed(1)}s of audio at ${sampleRate} Hz, made in ${took}s.`);
      renderSpeechProgress({ stage: "done" });
      void player.play({ automatic: true });
    } catch (err) {
      renderSpeechProgress({ stage: cancelled ? "cancelled" : "error" });
      setStatus(cancelled ? "Cancelled." : `Error: ${err?.message ?? err}`);
    } finally {
      busy = false;
      renderSpeechCache(speechCache);
      $("speak").disabled = false;
      $("voice").disabled = false;
      $("cancel").disabled = $("audio").paused;
      $("cancel").textContent = "Stop";
    }
  }

  $("cancel").addEventListener("click", () => {
    if (!busy) { player.stop(); setStatus("Playback stopped. The WAV is still available to save."); return; }
    cancelled = true;
    $("cancel").disabled = true;
    setStatus("Stopping after the current chunk…");
  });
  for (const event of ["play", "pause", "ended"]) $("audio").addEventListener(event, () => {
    if (!busy) { $("cancel").disabled = $("audio").paused; $("cancel").textContent = "Stop"; }
  });
  $("clear-audio-cache").addEventListener("click", () => {
    if (busy) return;
    player.stop(); $("audio").removeAttribute("src"); $("audio").load();
    speechCache.clear(); wavUrl = null; renderSpeechCache(speechCache);
    $("download").removeAttribute("href"); $("download").setAttribute("aria-disabled", "true");
    $("speech-preparation").hidden = true;
    setStatus("Audio cache cleared. The model remains loaded.");
  });
  $("speak").addEventListener("click", speak);
  $("text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!e.repeat) speak();
    }
  });
  $("speak").disabled = false;
  setStatus("Ready. Click Speak, or press Ctrl/Cmd+Enter.");
})();
