import fs from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function verifyFile(file, { size, sha256 }) {
  try {
    if ((await stat(file)).size !== size) return false;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex") === sha256;
}
