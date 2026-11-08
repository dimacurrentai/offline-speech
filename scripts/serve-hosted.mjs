#!/usr/bin/env node
// Local preview only; production is any HTTPS static host.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "hosted");
const types = { ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".txt": "text/plain", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400); res.end(); }
});
server.listen(Number(process.env.PORT ?? 8080), "127.0.0.1", () => console.log(`offline-speech preview: http://localhost:${server.address().port}/`));
