// A new worker may serve old tabs: keep their working files, and let the user
// choose when to reload instead of interrupting speech or discarding typed text.
import { MANIFEST } from "./manifest.js";
import { BASE, PREFIX } from "./storage.js";

export function watchUpdates(onUpdate) {
  const service = navigator.serviceWorker;
  const check = () => {
    if (!service.controller) return;
    const channel = new MessageChannel();
    const timeout = setTimeout(() => channel.port1.close(), 3000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (data !== MANIFEST.id) onUpdate();
    };
    service.controller.postMessage({ type: "build-id" }, [channel.port2]);
  };
  service.addEventListener("controllerchange", check);
  check();
  // A long-lived tab should discover updates without requiring a navigation.
  const refresh = async () => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    try { await (await service.getRegistration(BASE.href))?.update(); } catch { /* Offline use continues. */ }
    check();
  };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("online", refresh);
}

const draftKey = `${PREFIX}update-draft`;
export function restoreUpdateDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey));
    sessionStorage.removeItem(draftKey);
    if (typeof draft?.text === "string") document.getElementById("text").value = draft.text;
    if (typeof draft?.voice === "string" && [...document.getElementById("voice").options].some(option => option.value === draft.voice)) {
      document.getElementById("voice").value = draft.voice;
    }
  } catch { /* Storage can be unavailable; the current page still works. */ }
}

export function reloadUpdate() {
  // Do not reload if the browser refuses to save the draft.
  sessionStorage.setItem(draftKey, JSON.stringify({
    text: document.getElementById("text").value,
    voice: document.getElementById("voice").value,
  }));
  location.reload();
}
