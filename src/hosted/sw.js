import { MANIFEST } from "./manifest.js";
import { BASE, SHELL_CACHE, cacheShell, cachedResponse, urlFor } from "./storage.js";

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Open tabs still use their original manifest. Keep their shell and payload;
    // only the user's Delete action removes downloaded speech files.
    await self.clients.claim();
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "build-id") event.ports[0]?.postMessage(MANIFEST.id);
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(BASE.href) || request.cache === "no-store") return;
  event.respondWith((async () => {
    const url = new URL(request.url);
    if (request.mode === "navigate" && [BASE.pathname, `${BASE.pathname}index.html`].includes(url.pathname)) {
      const page = await (await caches.open(SHELL_CACHE)).match(urlFor("index.html"));
      if (page) return page;
    }
    return await cachedResponse(request) ?? fetch(request);
  })());
});
