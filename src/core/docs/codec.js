// Decompression for the document readers. Node uses zlib (lenient with truncated streams, which PDFs
// often have); browsers use DecompressionStream, keeping whatever was decoded before an error.
// Output is capped so a crafted file can't exhaust memory.

// (not `typeof window`: registry.js defines a global window in Node for the transform modules)
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
let zlib = null;
async function nodeZlib() {
  if (!zlib) zlib = await import('node:zlib');
  return zlib;
}

export const MAX_INFLATE = 64 * 1024 * 1024;

function concat(chunks, n) {
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function streamInflate(bytes, format, max) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) {
        reader.cancel().catch(() => {});
        throw new Error('decompressed data is too large');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (/too large/.test(e.message) || !n) throw e;
    // truncated or trailing garbage: keep what was decoded
  }
  return concat(chunks, n);
}

/** zlib (raw = false) or raw deflate data → bytes. */
export async function inflate(bytes, { raw = false, max = MAX_INFLATE } = {}) {
  if (isNode) {
    const z = await nodeZlib();
    const opts = { finishFlush: z.constants.Z_SYNC_FLUSH, maxOutputLength: max };
    try {
      return new Uint8Array(raw ? z.inflateRawSync(bytes, opts) : z.inflateSync(bytes, opts));
    } catch (e) {
      if (raw || /maxOutputLength|buffer/i.test(e.message)) throw e;
      return new Uint8Array(z.inflateRawSync(bytes, opts)); // a stream without the zlib header
    }
  }
  try {
    return await streamInflate(bytes, raw ? 'deflate-raw' : 'deflate', max);
  } catch (e) {
    if (raw || /too large/.test(e.message)) throw e;
    return streamInflate(bytes, 'deflate-raw', max);
  }
}
