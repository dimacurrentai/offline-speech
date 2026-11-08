// Shared by model and browser-library downloads: resume, verify, retry.
import fs from "node:fs";
import { mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { verifyFile } from "./files.mjs";

export async function downloadFile(url, target, expected, {
  attempts = 20, retryDelayMs = 3000, idleTimeoutMs = 60_000, log = console.log,
} = {}) {
  if (await verifyFile(target, expected)) return log(`have  ${path.basename(target)} (verified)`);
  await mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  let invalidDownloads = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const idleTimer = setTimeout(() => controller.abort(new Error("Download stalled: no data received")), idleTimeoutMs);
    try {
      if (!(await verifyFile(part, expected))) {
        const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
        const response = await fetch(url, {
          headers: have ? { Range: `bytes=${have}-` } : {}, signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 416) await rm(part, { force: true });
          throw new Error(`HTTP ${response.status}`);
        }
        const progress = new Transform({ transform(chunk, _encoding, done) {
          if (chunk.length) { idleTimer.refresh(); attempt = 0; }
          done(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(part, {
          flags: response.status === 206 ? "a" : "w",
        }), { signal: controller.signal });
        if (!(await verifyFile(part, expected))) {
          attempt = ++invalidDownloads; // Corrupt downloads have their own retry budget.
          await rm(part, { force: true });
          throw new Error("Downloaded file failed size/SHA-256 verification");
        }
      }
      await rename(part, target);
      log(`got   ${path.basename(target)} (verified)`);
      return;
    } catch (error) {
      if (attempt === attempts) throw new Error(`Failed to download ${target}: ${error.message}`, { cause: error });
      log(`retry ${path.basename(target)}: ${error.message}`);
    } finally {
      clearTimeout(idleTimer);
    }
    await delay(retryDelayMs);
  }
}
