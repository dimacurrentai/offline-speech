import { BASE, SHELL_CACHE, DATA_CACHE, PREFIX, cacheShell, cachedResponse, urlFor } from "./storage.js";

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const oldShells = (await caches.keys()).filter((name) => name.startsWith(`${PREFIX}shell:`) && name !== SHELL_CACHE);
    for (const name of oldShells.slice(0, -1)) await caches.delete(name);
    const oldData = (await caches.keys()).filter((name) => name.startsWith(`${PREFIX}data:`) && name !== DATA_CACHE);
    await Promise.all(oldData.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
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
