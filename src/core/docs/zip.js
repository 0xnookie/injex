// Minimal ZIP reader for Office files: central directory, stored and deflated entries (no ZIP64, no
// encryption). Entries are inflated on demand.

import { inflate } from './codec.js';

/** Open a ZIP archive. Returns { names, has(name), bytes(name), text(name) }. */
export function openZip(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (local + 30 > u8.length || dv.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    entries.set(name, { method, encrypted: !!(flags & 1), data: u8.subarray(start, Math.min(u8.length, start + csize)) });
  }
  const bytes = async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.encrypted) throw new Error(`${name} is encrypted`);
    if (e.method === 0) return e.data;
    if (e.method === 8) return inflate(e.data, { raw: true });
    throw new Error(`${name}: unsupported compression ${e.method}`);
  };
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    bytes,
    async text(name) {
      const b = await bytes(name);
      return b ? new TextDecoder().decode(b) : null;
    },
  };
}
