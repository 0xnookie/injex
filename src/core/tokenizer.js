// Tokenizers for extension pages. GPT BPE encodings come from the bundled gpt-tokenizer (MIT, vendor/),
// loaded on first use as a classic script — nothing is fetched from a CDN.

import { showBytes } from './hftokenizer.js';

export const ENGINES = {
  o200k_base: { label: 'o200k (GPT-4o, o-series)', bpe: true },
  cl100k_base: { label: 'cl100k (GPT-4, GPT-3.5)', bpe: true },
  p50k_base: { label: 'p50k (Codex, davinci-002/3)', bpe: true },
  r50k_base: { label: 'r50k (GPT-3, GPT-2)', bpe: true },
  bytes: { label: 'UTF-8 bytes' },
  chars: { label: 'Code points' },
  words: { label: 'Words' },
};

const loading = {};

/** Load a gpt-tokenizer encoding. `base` is the URL of the vendor/gpt-tokenizer/ directory. */
export function loadEncoding(name, base) {
  const global = 'GPTTokenizer_' + name;
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  if (!loading[name]) {
    loading[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${base}${name}.js`;
      s.onload = () => (globalThis[global] ? resolve(globalThis[global]) : reject(new Error(name + ' did not load')));
      s.onerror = () => {
        delete loading[name];
        reject(new Error('Could not load ' + name));
      };
      document.head.appendChild(s);
    });
  }
  return loading[name];
}

/**
 * Display text of one token of a gpt-tokenizer encoding, from the token's own bytes: enc.decode([id]) is
 * stateful (it holds back an incomplete character), so a byte piece of a character would show as nothing.
 */
export function gptPiece(enc, id) {
  const t = enc.bytePairEncodingCoreProcessor?.tryDecodeToken?.(id);
  if (typeof t === 'string') return { text: t, partial: false };
  if (t && typeof t === 'object' && typeof t.length === 'number') return showBytes(Array.from(t));
  const s = enc.decode([id]);
  return { text: s, partial: s === '' || s.includes('\u{FFFD}') };
}

/**
 * [{ id?, text, partial?, unk?, special? }] for `text` under `engine`. Engine "hf" is a tokenizer.json the
 * person loaded (src/core/hftokenizer.js), passed as `hf`.
 */
export async function tokenize(text, engine, base, { hf } = {}) {
  if (!text) return [];
  if (engine === 'bytes') return Array.from(new TextEncoder().encode(text), (b) => ({ id: b, text: '0x' + b.toString(16).padStart(2, '0') }));
  if (engine === 'chars') return Array.from(text, (c) => ({ id: c.codePointAt(0), text: c }));
  if (engine === 'words') return (text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []).map((t) => ({ text: t }));
  if (engine === 'hf') {
    if (!hf) throw new Error('No tokenizer.json loaded');
    return hf.encode(text);
  }
  const enc = await loadEncoding(engine, base);
  return enc.encode(text, { allowedSpecial: 'all' }).map((id) => ({ id, ...gptPiece(enc, id) }));
}

const HIDDEN = /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{115F}\u{1160}\u{3164}\u{FFA0}]|(?![\t\n\r])\p{Cc}/gu;
export const hiddenCount = (s) => (String(s ?? '').match(HIDDEN) || []).length;

/**
 * What a tokenizer does to the text that matters for hidden-text attacks: hidden characters its normalizer
 * removes or replaces before the model sees them, unknown tokens (level "warn"), byte pieces ("info").
 * `normalize` is optional. → [{ level, text }]
 */
export function tokenNotes(text, tokens, normalize) {
  const notes = [];
  const hidden = hiddenCount(text);
  if (normalize && hidden) {
    const kept = hiddenCount(normalize(text));
    if (kept < hidden) notes.push({ level: 'warn', text: `${hidden - kept} of ${hidden} hidden character${hidden === 1 ? '' : 's'} do not survive this tokenizer's normalizer (removed or replaced before the model sees them)` });
  }
  const unk = tokens.filter((t) => t.unk).length;
  if (unk) notes.push({ level: 'warn', text: `${unk} token${unk === 1 ? ' is' : 's are'} the unknown token: the model cannot tell what was there` });
  const partial = tokens.filter((t) => t.partial).length;
  if (partial) notes.push({ level: 'info', text: `${partial} token${partial === 1 ? ' holds' : 's hold'} only part of a character (byte pieces)` });
  return notes;
}

/** Lazily loaded { encode, decode } for the Splitter's token mode. */
export async function encoder(engine, base) {
  const enc = await loadEncoding(engine, base);
  return { encode: (t) => enc.encode(t, { allowedSpecial: 'all' }), decode: (ids) => enc.decode(ids) };
}
