import { MANIFEST } from "./manifest.js";

export const BASE = new URL(".", import.meta.url);
export const PREFIX = `offline-speech:${encodeURIComponent(BASE.pathname)}:`;
export const SHELL_CACHE = `${PREFIX}shell:${MANIFEST.id}`;
export const DATA_CACHE = `${PREFIX}data:${MANIFEST.dataId}`;
export const TOTAL_BYTES = MANIFEST.assets.reduce((n, asset) => n + asset.size, 0);
export const PARTS = MANIFEST.assets.flatMap((asset) => asset.parts.map((part) => ({ ...part, type: asset.parts.length === 1 ? asset.type : "application/octet-stream" })));
export const urlFor = (path) => new URL(path, BASE).href;
export const versioned = (path) => `${urlFor(path)}?v=${MANIFEST.id}`;
const dataNames = async () => (await caches.keys()).filter((name) => name.startsWith(`${PREFIX}data:`));
const validPart = (response, part) => response?.headers.get("X-Offline-Speech-SHA256") === part.sha256 && Number(response.headers.get("Content-Length")) === part.size;

export function resolveAsset(input) {
  const url = input instanceof Request ? input.url : String(input);
  return MANIFEST.assets.find((asset) => url === urlFor(asset.url))
    ?? MANIFEST.assets.find((asset) => asset.kind === "model" && url.endsWith(`/${asset.key}`));
}

export async function getUsage() {
  let dataBytes = 0, shellBytes = 0, savedBytes = 0, savedParts = 0;
  for (const name of (await caches.keys()).filter((name) => name.startsWith(PREFIX))) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const size = Number(response.headers.get("X-Offline-Speech-Bytes") ?? response.headers.get("Content-Length")) || 0;
      if (name.startsWith(`${PREFIX}data:`)) dataBytes += size;
      else shellBytes += size;
      if (name === DATA_CACHE) {
        const part = PARTS.find((part) => urlFor(part.url) === request.url);
        if (part && validPart(response, part)) { savedBytes += part.size; savedParts++; }
      }
    }
  }
  return { dataBytes, shellBytes, savedBytes, complete: savedParts === PARTS.length };
}

export async function installAssets(onProgress, signal) {
  const cache = await caches.open(DATA_CACHE);
  let saved = 0;
  for (const part of PARTS) if (validPart(await cache.match(urlFor(part.url)), part)) saved += part.size;
  onProgress({ received: saved, total: TOTAL_BYTES });
  for (const part of PARTS) {
    signal.throwIfAborted();
    if (validPart(await cache.match(urlFor(part.url)), part)) continue;
    const response = await fetch(urlFor(part.url), { cache: "no-store", signal });
    if (!response.ok || !response.body) throw new Error(`The download server returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > part.size) throw new Error("Download exceeded its expected size");
        chunks.push(value);
        onProgress({ received: saved + received, total: TOTAL_BYTES, file: part.url });
      }
    } finally { await reader.cancel().catch(() => {}); }
    signal.throwIfAborted();
    if (received !== part.size) throw new Error("Download was incomplete; choose Download to resume");
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
    if (digest !== part.sha256) throw new Error("Download failed its SHA-256 check; choose Download to retry");
    signal.throwIfAborted();
    await cache.put(urlFor(part.url), new Response(bytes, { headers: {
      "Content-Type": part.type, "Content-Length": String(part.size), "X-Offline-Speech-SHA256": digest, "Cache-Control": "no-store",
    } }));
    saved += received;
    onProgress({ received: saved, total: TOTAL_BYTES, file: part.url, saved: true });
  }
  onProgress({ received: TOTAL_BYTES, total: TOTAL_BYTES, saved: true });
}

export async function deleteAssets() {
  for (const name of await dataNames()) await caches.delete(name);
}

export async function readAsset(asset) {
  const cache = await caches.open(DATA_CACHE);
  let index = 0, reader;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (!reader) {
            if (index === asset.parts.length) { controller.close(); return; }
            const part = asset.parts[index++];
            const response = await cache.match(urlFor(part.url));
            if (!validPart(response, part)) throw new Error("Offline files are missing. Download them again.");
            reader = response.body.getReader();
          }
          const { value, done } = await reader.read();
          if (!done) { controller.enqueue(value); return; }
          reader.releaseLock();
          reader = null;
        }
      } catch (error) { controller.error(error); }
    },
    async cancel() { await reader?.cancel(); },
  });
  return new Response(body, { headers: { "Content-Type": asset.type, "Content-Length": String(asset.size), "Cache-Control": "no-store" } });
}

export async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  try {
    for (const file of MANIFEST.shell) {
      const response = await fetch(urlFor(file), { cache: "no-store" });
      if (!response.ok || response.redirected) throw new Error(`Could not save the offline page: ${file}`);
      const bytes = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("X-Offline-Speech-Bytes", String(bytes.byteLength));
      headers.set("Content-Length", String(bytes.byteLength));
      headers.set("Cache-Control", "no-store");
      headers.delete("Content-Encoding");
      headers.delete("Vary"); // Saved decoded bytes do not vary with network request headers.
      await cache.put(urlFor(file), new Response(bytes, { headers }));
    }
  } catch (error) { await caches.delete(SHELL_CACHE); throw error; }
}

export async function cachedResponse(request) {
  // Reuse versioned shell modules and the current payload across tabs.
  for (const name of (await caches.keys()).filter((name) => name.startsWith(PREFIX)).reverse()) {
    const response = await (await caches.open(name)).match(request);
    if (response) return response;
  }
}
