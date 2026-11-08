import { renderSpeechProgress } from "./audio.js";
import { MANIFEST } from "./manifest.js";
import { BASE, PREFIX, SHELL_CACHE, TOTAL_BYTES, getUsage, installAssets, deleteAssets, versioned } from "./storage.js";

const $ = (id) => document.getElementById(id);
const format = (bytes) => bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const setStatus = (text) => { $("status").textContent = text; };
let usage = { dataBytes: 0, shellBytes: 0, savedBytes: 0, complete: false };
let refreshSequence = 0;
let shellReady = false, deleting = false, worker, ready = false, speaking = false, installation, abortDownload, wavUrl, pendingPlayback;
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(PREFIX) : null;
for (const { id, label } of MANIFEST.voices) $("voice").add(new Option(label, id));

function controls() {
  $("save-offline").disabled = !shellReady || !!installation || deleting || usage.complete;
  $("save-offline").textContent = usage.complete ? "Saved for offline use" : `Download for offline use · ${format(TOTAL_BYTES)}`;
  $("cancel-download").hidden = !installation;
  $("load-model").disabled = !usage.complete || !!worker || deleting || !!installation;
  $("unload-model").disabled = !worker;
  $("delete-offline").disabled = deleting || (!usage.dataBytes && !installation);
  $("speak").disabled = !ready || speaking || deleting;
  $("voice").disabled = speaking;
  $("cancel").disabled = !speaking && $("audio").paused;
  $("cancel").textContent = speaking ? "Cancel preparation" : "Stop";
  const step = !usage.complete ? 1 : !ready ? 2 : 3;
  for (const [index, id] of ["offline-files", "model", "speech"].entries()) {
    if (index + 1 === step) $(id).setAttribute("aria-current", "step");
    else $(id).removeAttribute("aria-current");
  }
  $("next-step").textContent = deleting ? "Removing saved files and unloading the model…"
    : installation ? "Step 1 of 3 · Downloading speech files. Progress is shown below; loading comes next."
    : !shellReady ? "Preparing offline storage. Download will become available shortly."
    : !usage.complete ? "Step 1 of 3 · Press Download for offline use. Then load the model, then press Speak."
    : !worker ? "Step 2 of 3 · Download complete. Press Load model to prepare speech in RAM."
    : !ready ? "Step 2 of 3 · Loading the model into RAM. Wait for Ready before speaking."
    : speaking ? "Step 3 of 3 · Generating speech. Audio will play when it is ready."
    : "Step 3 of 3 · Ready. Type text, choose a voice, and press Speak to hear it.";
}
function ramEstimate() {
  $("ram-label").textContent = "RAM · model and runtime";
  $("ram-usage").textContent = worker ? "~1 GiB · estimate" : "Model unloaded";
  $("ram-detail").textContent = worker
    ? "Estimate from desktop tests, excluding the browser baseline; actual use varies. This browser does not expose an exact total app RAM reading here."
    : "The model worker is stopped. The page and any generated audio still use memory. Loading speech typically needs about 1 GiB of RAM on a desktop (estimate).";
}
async function measureRam() {
  ramEstimate();
  if (!crossOriginIsolated || typeof performance.measureUserAgentSpecificMemory !== "function") return;
  const current = worker;
  try {
    const result = await performance.measureUserAgentSpecificMemory();
    if (worker !== current) return;
    $("ram-label").textContent = "RAM · browser estimate for this app";
    $("ram-usage").textContent = format(result.bytes);
    $("ram-detail").textContent = "Browser-reported estimate, including this page and its worker. This is not the browser's total process memory.";
  } catch { /* The model-state estimate above remains explicitly labeled. */ }
}
async function refreshUsage() {
  const sequence = ++refreshSequence;
  const next = await getUsage();
  if (sequence !== refreshSequence) return;
  usage = next;
  $("disk-usage").textContent = format(usage.dataBytes + usage.shellBytes);
  $("storage-detail").textContent = `${format(usage.dataBytes)} of model/library/voice files + ${format(usage.shellBytes)} of page files. These are saved file bytes; physical disk usage and browser overhead can differ.`;
  $("offline-state").textContent = usage.complete && shellReady && !installation
    ? "Ready offline on this device. Bookmark this page; you can reopen it and load the model without internet."
    : usage.savedBytes ? `${format(usage.savedBytes)} saved. Finish the download to enable offline speech.`
    : `Download ${format(TOTAL_BYTES)} once to enable offline speech.`;
  controls();
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    $("origin-usage").textContent = `Browser storage estimate for this entire origin: ${format(estimate.usage ?? 0)}. This may include other apps on the same host and is not this app's exact disk usage.`;
  }
  if (navigator.storage?.persisted) {
    $("persistence").textContent = await navigator.storage.persisted()
      ? "Persistent storage is enabled. Offline files remain in this browser profile until you remove them or clear site data."
      : "Saved in this browser profile. Persistent storage was not granted; the browser may clear files under storage pressure or through site-data settings.";
  }
  controls();
}
function unload(message = "Model unloaded. Offline files and your last WAV are kept.") {
  if (speaking) renderSpeechProgress({ stage: "cancelled" });
  worker?.terminate();
  worker = undefined;
  ready = speaking = false;
  ramEstimate();
  controls();
  setStatus(message);
  void measureRam();
}
async function loadModel() {
  if (worker || !usage.complete || installation || deleting) return;
  ready = false;
  setStatus("Loading the model into RAM…");
  worker = new Worker(versioned("tts-worker.js"), { type: "module" });
  const current = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== current) return;
    if (data.type === "ready") { ready = true; setStatus("Ready. Click Speak, or press Ctrl/Cmd+Enter."); void measureRam(); }
    else if (data.type === "progress") { renderSpeechProgress(data); setStatus($("speech-stage").textContent); }
    else if (data.type === "cancelled") { speaking = false; setStatus("Cancelled."); }
    else if (data.type === "error") {
      if (!ready) { unload(`Error: ${data.message}`); void refreshUsage(); }
      else { speaking = false; renderSpeechProgress({ stage: "error" }); setStatus(`Error: ${data.message}`); }
    } else if (data.type === "done") {
      speaking = false;
      renderSpeechProgress({ stage: "done" });
      const previous = wavUrl;
      wavUrl = URL.createObjectURL(data.wav);
      $("audio").src = wavUrl;
      $("download").href = wavUrl;
      $("download").setAttribute("aria-disabled", "false");
      if (previous) URL.revokeObjectURL(previous);
      setStatus(`Done — ${data.duration.toFixed(1)}s of audio at ${data.sampleRate} Hz, made in ${data.elapsed.toFixed(1)}s.`);
      const currentAudio = wavUrl;
      $("audio").play().catch(() => {
        if (wavUrl === currentAudio) { pendingPlayback = { text: data.text ?? $("text").value, voice: data.voice ?? $("voice").value }; setStatus("Done — audio ready. Press Speak again to hear the prepared audio, or Save WAV. Automatic playback was blocked."); }
      });
    }
    controls();
  };
  worker.onerror = (event) => { if (worker === current) { unload(`Error loading speech: ${event.message}`); void refreshUsage(); } };
  worker.postMessage({ type: "load" });
  ramEstimate();
  controls();
}
function speak() {
  if (!ready || speaking || deleting) return;
  const text = $("text").value;
  if (pendingPlayback && wavUrl && pendingPlayback.text === text && pendingPlayback.voice === $("voice").value) {
    $("audio").play().then(() => { pendingPlayback = undefined; setStatus("Done — playing the prepared speech."); })
      .catch(() => setStatus("Error: audio playback is blocked. Choose Save WAV to hear the saved file."));
    return;
  }
  pendingPlayback = undefined;
  $("audio").pause();
  if (!/[\p{L}\p{N}]/u.test(text)) return setStatus("Type something to speak.");
  if (text.length > 20000) return setStatus("Please use at most 20,000 characters at a time.");
  speaking = true;
  controls();
  setStatus("Speaking…");
  worker.postMessage({ type: "speak", text, voice: $("voice").value });
}
$("save-offline").addEventListener("click", () => {
  if (installation || deleting || !shellReady || usage.complete) return;
  abortDownload = new AbortController();
  const signal = abortDownload.signal;
  $("download-progress").hidden = false;
  $("download-progress").max = TOTAL_BYTES;
  $("download-progress").value = usage.savedBytes;
  setStatus("Downloading offline files. You can cancel and resume completed pieces.");
  installation = (async () => {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      await installAssets(({ received, total, saved }) => {
        $("download-progress").value = received;
        $("download-status").textContent = `${Math.floor(received / total * 100)}% · ${format(received)} of ${format(total)}`;
        if (saved) void refreshUsage();
      }, signal);
      setStatus("Saved for offline use. Bookmark this page, then choose Load model to speak.");
    } catch (error) {
      setStatus(signal.aborted ? "Download cancelled. Completed pieces are saved; choose Download to resume." : `Download failed: ${error.message}`);
    } finally {
      installation = undefined;
      abortDownload = undefined;
      await refreshUsage();
      $("download-progress").value = usage.savedBytes;
      if (!usage.complete) $("download-status").textContent = `${format(usage.savedBytes)} verified and saved of ${format(TOTAL_BYTES)}. Choose Download to resume.`;
      channel?.postMessage({ type: "data-changed" });
    }
  })();
  controls();
});
$("cancel-download").addEventListener("click", () => abortDownload?.abort());
$("load-model").addEventListener("click", loadModel);
$("unload-model").addEventListener("click", () => unload());
$("delete-offline").addEventListener("click", async () => {
  if (deleting) return;
  deleting = true;
  channel?.postMessage({ type: "deleting" });
  unload("Removing offline files…");
  abortDownload?.abort();
  await installation;
  try {
    await deleteAssets();
    $("download-progress").hidden = true;
    $("download-status").textContent = "";
    setStatus("Offline files deleted and model RAM unloaded. The small page shell remains; download again when online to restore speech.");
  } catch (error) { setStatus(`Could not remove offline files: ${error.message}`); }
  finally { deleting = false; await refreshUsage(); channel?.postMessage({ type: "deleted" }); }
});
channel?.addEventListener("message", ({ data }) => {
  if (data.type === "deleting") { deleting = true; abortDownload?.abort(); unload("Offline files are being removed in another tab."); }
  if (data.type === "deleted") { deleting = false; void refreshUsage(); }
  if (data.type === "data-changed") void refreshUsage();
});
$("speak").addEventListener("click", speak);
$("cancel").addEventListener("click", () => {
  if (speaking) { worker?.postMessage({ type: "cancel" }); setStatus("Stopping after the current chunk…"); }
  else { $("audio").pause(); setStatus("Playback stopped. The WAV is still available to save."); controls(); }
});
for (const event of ["play", "pause", "ended"]) $("audio").addEventListener(event, controls);
$("text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!event.repeat) speak(); }
});

try {
  if (!isSecureContext || !("serviceWorker" in navigator) || !("caches" in window)) {
    throw new Error("Offline bookmarks require HTTPS (or localhost for development) and service-worker support.");
  }
  try {
    const registration = await navigator.serviceWorker.register(versioned("sw.js"), { type: "module", scope: BASE.pathname, updateViaCache: "none" });
    const candidate = registration.installing ?? registration.waiting ?? registration.active;
    if (candidate?.state !== "activated") await new Promise((resolve, reject) => {
      if (!candidate || candidate.state === "redundant") return reject(new Error("Could not install the offline page"));
      candidate.addEventListener("statechange", () => {
        if (candidate.state === "activated") resolve();
        else if (candidate.state === "redundant") reject(new Error("Could not save the offline page"));
      });
    });
    shellReady = true;
  } catch (error) {
    if (navigator.serviceWorker.controller && await caches.has(SHELL_CACHE)) shellReady = true;
    else throw error;
  }
  await refreshUsage();
  setStatus(usage.complete ? "Offline files are saved. Choose Load model to speak." : "Download the speech files once to use this bookmark offline.");
} catch (error) { setStatus(`Error: ${error.message}`); }
controls();
