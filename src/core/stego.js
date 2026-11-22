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

// ── invisible bits ("Sneaky Bits"): each UTF-8 bit as one of two invisible characters ──

export const SNEAKY_DEFAULTS = { zero: '\u2062', one: '\u2064' }; // INVISIBLE TIMES = 0, INVISIBLE PLUS = 1

/** Text → one invisible character per bit (MSB first): U+2062 for 0, U+2064 for 1 by default. */
export function encodeSneakyBits(text, options = {}) {
  const o = { ...SNEAKY_DEFAULTS, ...options };
  return Array.from(enc.encode(text || ''), (b) => [...b.toString(2).padStart(8, '0')].map((bit) => (bit === '0' ? o.zero : o.one)).join('')).join('');
}

function bitsToText(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return dec.decode(new Uint8Array(bytes));
}

/** Recover text hidden by encodeSneakyBits (the longest run of the two characters). */
export function decodeSneakyBits(text, options = {}) {
  const o = { ...SNEAKY_DEFAULTS, ...options };
  if (!text) return '';
  const esc = (c) => '\\u{' + c.codePointAt(0).toString(16) + '}';
  const runs = text.match(new RegExp(`[${esc(o.zero)}${esc(o.one)}]{8,}`, 'gu')) || [];
  let best = '';
  for (const r of runs) if (r.length > best.length) best = r;
  if (!best) return '';
  return bitsToText([...best].map((c) => (c === o.zero ? '0' : '1')).join(''));
}

// characters that render as nothing and can serve as a 0 / 1 pair
const INVISIBLE_BIT_CHARS = '\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF\u180E\u034F';

/**
 * A run made of exactly two invisible characters, read as bits (either assignment). Covers Sneaky Bits
 * and other two-symbol zero-width encodings. Returns { text, zero, one } or null.
 */
export function decodeInvisibleBinary(run) {
  const chars = [...(run || '')];
  if (chars.length < 16 || chars.length % 8 !== 0) return null;
  const set = [...new Set(chars)];
  if (set.length !== 2 || !set.every((c) => INVISIBLE_BIT_CHARS.includes(c))) return null;
  const known = set.includes(SNEAKY_DEFAULTS.zero) && set.includes(SNEAKY_DEFAULTS.one);
  const orders = known ? [[SNEAKY_DEFAULTS.zero, SNEAKY_DEFAULTS.one]] : [set, [set[1], set[0]]];
  let best = null;
  for (const [zero, one] of orders) {
    const s = bitsToText(chars.map((c) => (c === zero ? '0' : '1')).join(''));
    const r = printableRatio(s);
    if (r > 0.9 && s.trim().length >= 2 && (!best || r > best.r)) best = { text: s, zero, one, r };
  }
  return best && { text: best.text, zero: best.zero, one: best.one };
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
  add('Invisible bits (Sneaky Bits)', decodeSneakyBits(text));
  for (const run of text.match(/[\u200B-\u200D\u2060-\u2064\uFEFF\u180E\u034F]{16,}/g) || []) add('Invisible bits', decodeInvisibleBinary(run)?.text);
  return out;
}
