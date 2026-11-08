// Decode bounded pieces directly from DOM text nodes, then stream gzip inflation.
// A multiple of four keeps base64 quartets intact, even across text-node boundaries.
const BASE64_CHUNK_CHARS = 64 * 1024;

export async function unpackAsset(el) {
  let node = el.firstChild;
  let offset = 0;
  el.remove();
  const compressed = new ReadableStream({
    pull(controller) {
      let encoded = "";
      while (node && encoded.length < BASE64_CHUNK_CHARS) {
        const count = Math.min(BASE64_CHUNK_CHARS - encoded.length, node.length - offset);
        encoded += node.substringData(offset, count);
        offset += count;
        if (offset === node.length) {
          const consumed = node;
          node = node.nextSibling;
          consumed.remove();
          offset = 0;
        }
      }
      if (!encoded) return controller.close();
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      controller.enqueue(bytes);
    },
  });
  try {
    return await new Response(compressed.pipeThrough(new DecompressionStream("gzip")), {
      headers: { "Content-Type": el.dataset.type },
    }).blob();
  } finally {
    node = null;
    el.replaceChildren();
  }
}
