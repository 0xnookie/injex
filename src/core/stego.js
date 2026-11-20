// Steganography: text hidden after an emoji in variation selectors, or as invisible Unicode tag characters.
//
//  - bits:  each UTF-8 bit becomes VS15 (0) or VS16 (1) after a carrier emoji.
//           Selectors, bit order, presentation selector and zero-width padding are configurable.
//  - bytes: one variation selector per byte (VS1–VS16 = 0–15, VS17–VS256 = 16–255). Eight times shorter.
//  - tags:  each UTF-8 byte as U+E0000 + byte (Unicode Tags block; ASCII lands on the real tag characters).

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export const STEG_DEFAULTS = {
  bitZeroVS: '\uFE0E',
  bitOneVS: '\uFE0F',
  initialPresentation: 'emoji', // 'emoji' | 'text' | 'none'
  trailingZW: '\u200B', // '' for none
  interBitZW: '', // e.g. '\u200C'
  interBitEvery: 1,
  bitOrder: 'msb', // 'msb' | 'lsb'
};

export const CARRIERS = [
  { emoji: '🐍', name: 'Snake' },
  { emoji: '🐉', name: 'Dragon' },
  { emoji: '🦎', name: 'Lizard' },
  { emoji: '🐊', name: 'Crocodile' },
  { emoji: '🔥', name: 'Fire' },
  { emoji: '💀', name: 'Skull' },
  { emoji: '🗿', name: 'Moai' },
  { emoji: '👀', name: 'Eyes' },
  { emoji: '✨', name: 'Sparkles' },
  { emoji: '🚀', name: 'Rocket' },
  { emoji: '🔮', name: 'Crystal ball' },
  { emoji: '😊', name: 'Smile' },
];

function byteBits(byte, order) {
  const s = byte.toString(2).padStart(8, '0');
  return order === 'lsb' ? [...s].reverse().join('') : s;
}

/** Hide `text` after `carrier` as VS15/VS16 bits. */
export function encodeEmojiBits(carrier, text, options = {}) {
  const o = { ...STEG_DEFAULTS, ...options };
  if (!text) return carrier;
  const bits = Array.from(enc.encode(text), (b) => byteBits(b, o.bitOrder)).join('');
  let out = carrier;
  if (o.initialPresentation === 'emoji') out += '\uFE0F';
  else if (o.initialPresentation === 'text') out += '\uFE0E';
  const every = Math.max(1, Number(o.interBitEvery) || 1);
  for (let i = 0; i < bits.length; i++) {
    out += bits[i] === '0' ? o.bitZeroVS : o.bitOneVS;
    if (o.interBitZW && i < bits.length - 1 && (i + 1) % every === 0) out += o.interBitZW;
  }
  if (o.trailingZW) out += o.trailingZW;
  return out;
}

/** Recover text hidden by encodeEmojiBits (first run of selectors found). */
export function decodeEmojiBits(text, options = {}) {
  const o = { ...STEG_DEFAULTS, ...options };
  if (!text) return '';
  const zero = o.bitZeroVS;
  const one = o.bitOneVS;
  // the longest run of selectors (optionally interleaved with zero-width padding)
  const runs = text.match(/[\uFE0E\uFE0F][\uFE0E\uFE0F\u200B\u200C\u200D\u2060\uFEFF]*/g) || [];
  let best = '';
  for (const r of runs) if (r.length > best.length) best = r;
  const sel = [...best].filter((c) => c === zero || c === one);
  if (sel.length < 8) return '';
  // the presentation selector is not data; try with and without skipping it, keep the cleaner result
  const tries = o.initialPresentation === 'none' ? [0, 1] : [1, 0];
  let fallback = '';
  for (const skip of tries) {
    const bits = sel.slice(skip).map((c) => (c === zero ? '0' : '1'));
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      let b = bits.slice(i, i + 8).join('');
      if (o.bitOrder === 'lsb') b = [...b].reverse().join('');
      bytes.push(parseInt(b, 2));
    }
    const s = dec.decode(new Uint8Array(bytes));
    if (!fallback) fallback = s;
    if ((bits.length % 8 === 0 || skip === tries[0]) && printableRatio(s) > 0.85) return s;
  }
  return fallback;
}

function vsForByte(b) {
  return b < 16 ? String.fromCodePoint(0xfe00 + b) : String.fromCodePoint(0xe0100 + b - 16);
}

function byteForVs(cp) {
  if (cp >= 0xfe00 && cp <= 0xfe0f) return cp - 0xfe00;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return cp - 0xe0100 + 16;
  return -1;
}

/** Hide `text` after `carrier`, one variation selector per byte. */
export function encodeEmojiBytes(carrier, text) {
  return carrier + Array.from(enc.encode(text || ''), vsForByte).join('');
}

/** Recover text hidden by encodeEmojiBytes (longest selector run). */
export function decodeEmojiBytes(text) {
  if (!text) return '';
  const runs = text.match(/(?:[\uFE00-\uFE0F]|\udb40[\udd00-\uddef])+/g) || [];
  let best = '';
  for (const r of runs) if ([...r].length > [...best].length) best = r;
  const bytes = [...best].map((c) => byteForVs(c.codePointAt(0))).filter((b) => b >= 0);
  if (bytes.length < 2) return '';
  return dec.decode(new Uint8Array(bytes));
}

/** Text → invisible Unicode tag characters. */
export function encodeTags(text) {
  return Array.from(enc.encode(text || ''), (b) => String.fromCodePoint(0xe0000 + b)).join('');
}

/** Every U+E0000–U+E00FF character in `text` back to bytes → text. */
export function decodeTags(text) {
  const bytes = [];
  for (const c of text || '') {
    const cp = c.codePointAt(0);
    if (cp >= 0xe0000 && cp <= 0xe00ff) bytes.push(cp - 0xe0000);
  }
  if (!bytes.length) return '';
  return dec.decode(new Uint8Array(bytes.filter((b) => b !== 0x7f && b !== 0x01)));
}

export function printableRatio(s) {
  if (!s) return 0;
  const chars = [...s];
  const ok = chars.filter((c) => !/[\u0000-\u0008\u000e-\u001f\u007f-\u009f�]/.test(c)).length;
  return ok / chars.length;
}

/** Try every scheme on `text`. Returns [{ method, text }] best first. */
export function revealAll(text, options = {}) {
  const out = [];
  const add = (method, s) => {
    if (s && printableRatio(s) > 0.6 && !out.some((o) => o.text === s)) out.push({ method, text: s });
  };
  add('Unicode tags', decodeTags(text));
  add('Emoji steganography (VS bits)', decodeEmojiBits(text, options));
  add('Emoji steganography (VS bytes)', decodeEmojiBytes(text));
  return out;
}
