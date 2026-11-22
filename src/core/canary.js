// Canary tokens: plant a unique token in a document, page, tool output or system prompt, then check
// whether it turns up somewhere it shouldn't (a model's answer, a request log, a tool call). This detects
// leaks, not injections — a planted token says nothing about whether an injection was attempted — but it
// is unambiguous, and injex can find it after it has been encoded: Base64, hex, URL or HTML encoding,
// ROT13, reversed, spelled out with separators, in tag characters, zero-width or emoji steganography,
// with look-alike letters, or nested several layers deep.

import { skeleton } from './confusables.js';
import { revealAll } from './stego.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O, 1/I/L, U: survives retyping
const WORDS = ['amber', 'basalt', 'cobalt', 'delta', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen', 'meadow', 'nimbus', 'onyx', 'pylon', 'quartz', 'raven', 'sierra', 'tundra', 'umber', 'vortex', 'willow', 'xenon', 'yarrow', 'zephyr'];

function randomInts(n, max) {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => x % max);
}

/**
 * A new canary token. style 'code' → "INJX-7F3K-Q9ZB"; 'words' → "zephyr-quartz-4821" (looks like a
 * normal identifier, for places where a code would stand out).
 */
export function newCanary({ prefix = 'INJX', style = 'code' } = {}) {
  if (style === 'words') {
    const [a, b] = randomInts(2, WORDS.length);
    const n = randomInts(1, 9000)[0] + 1000;
    return `${WORDS[a]}-${WORDS[b]}-${n}`;
  }
  const c = randomInts(8, ALPHABET.length).map((i) => ALPHABET[i]).join('');
  return `${prefix ? prefix + '-' : ''}${c.slice(0, 4)}-${c.slice(4)}`;
}

const core = (token) => String(token).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const rot13 = (s) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.charCodeAt(0) - (c <= 'Z' ? 65 : 97) + 13) % 26) + (c <= 'Z' ? 65 : 97)));

function b64decode(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''));
    return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
}
function hexdecode(s) {
  const h = s.replace(/[^0-9a-f]/gi, '');
  if (h.length < 8 || h.length % 2) return '';
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)));
}
function urldecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return '';
  }
}
const htmldecode = (s) => s.replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);?/g, (m, d) => String.fromCodePoint(+d));

/**
 * Where `token` appears in `text`, however it was encoded.
 * @returns {{ found: boolean, how: string[], matches: { how: string, index: number }[] }}
 *   index: position in `text` when known (-1 when only a decoding contains it)
 */
export function findCanary(text, token, { decode } = {}) {
  const s = String(text ?? '');
  const want = core(token);
  const matches = [];
  if (!s || want.length < 4) return { found: false, how: [], matches };
  const seen = new Set();
  const hit = (how, index = -1) => {
    if (seen.has(how)) return;
    seen.add(how);
    matches.push({ how, index });
  };
  const exact = s.toLowerCase().indexOf(String(token).toLowerCase());
  if (exact >= 0) hit('as is', exact);
  const flat = (x) => core(x);
  // separators, case, look-alike letters, invisible characters in between
  const sk = skeleton(s.replace(/[\u{200B}-\u{200F}\u{2060}-\u{2064}\u{FEFF}\u{00AD}\u{034F}\u{180E}]/gu, ''));
  if (!seen.size && flat(sk).includes(want)) hit(sk !== s ? 'with look-alikes, separators or invisible characters' : 'with separators');
  if (flat([...sk].reverse().join('')).includes(want)) hit('reversed');
  if (flat(rot13(sk)).includes(want)) hit('ROT13');
  // hidden in the text: tags, emoji / zero-width steganography
  for (const r of revealAll(s)) if (flat(r.text).includes(want)) hit(r.method);
  // encoded tokens in the text
  const cands = s.match(/[A-Za-z0-9+/_-]{8,}={0,2}|(?:%[0-9A-Fa-f]{2}|[\w.~-]){8,}|(?:&#x?[0-9a-f]+;?){4,}|(?:[0-9a-f]{2}[\s:]?){6,}/gi) || [];
  for (const c of cands.slice(0, 5000)) {
    // Base64 (up to three layers deep, then hex / URL inside)
    let layer = c;
    for (let depth = 1; depth <= 3; depth++) {
      layer = b64decode(layer).trim();
      if (!layer || /[\u{0}-\u{8}\u{E}-\u{1F}\u{FFFD}]/u.test(layer)) break;
      const name = Array(depth).fill('Base64').join(' → ');
      if (flat(layer).includes(want)) {
        hit(name, s.indexOf(c));
        break;
      }
      if (flat(hexdecode(layer)).includes(want)) {
        hit(name + ' → hex', s.indexOf(c));
        break;
      }
      if (!/^[A-Za-z0-9+/_=-]{8,}$/.test(layer)) break;
    }
    if (flat(hexdecode(c)).includes(want)) hit('hex', s.indexOf(c));
    if (c.includes('%') && flat(urldecode(c)).includes(want)) hit('URL encoding', s.indexOf(c));
    if (c.includes('&#') && flat(htmldecode(c)).includes(want)) hit('HTML entities', s.indexOf(c));
  }
  // anything else the universal decoder can peel (several layers), when given
  if (decode && !matches.length) {
    for (const piece of [s, ...cands.slice(0, 200)]) {
      const layers = decode(piece);
      if (layers && flat(layers.text).includes(want)) {
        hit(layers.method || 'decoded');
        break;
      }
    }
  }
  return { found: matches.length > 0, how: matches.map((m) => m.how), matches };
}

/** The token in forms useful for planting tests: plain, Base64, hex, URL-encoded, reversed, spaced out. */
export function canaryForms(token) {
  const t = String(token);
  const bytes = new TextEncoder().encode(t);
  return {
    plain: t,
    base64: btoa(String.fromCharCode(...bytes)),
    hex: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
    url: encodeURIComponent(t),
    reversed: [...t].reverse().join(''),
    spaced: [...t].join(' '),
  };
}
