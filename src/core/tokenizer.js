// Tokenizers for extension pages. GPT BPE encodings come from the bundled gpt-tokenizer (MIT, vendor/),
// loaded on first use as a classic script — nothing is fetched from a CDN.

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

/** [{ id?, text }] for `text` under `engine`. */
export async function tokenize(text, engine, base) {
  if (!text) return [];
  if (engine === 'bytes') return Array.from(new TextEncoder().encode(text), (b) => ({ id: b, text: '0x' + b.toString(16).padStart(2, '0') }));
  if (engine === 'chars') return Array.from(text, (c) => ({ id: c.codePointAt(0), text: c }));
  if (engine === 'words') return (text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []).map((t) => ({ text: t }));
  const enc = await loadEncoding(engine, base);
  const ids = enc.encode(text, { allowedSpecial: 'all' });
  // decode per token; a token holding part of a multi-byte character decodes to U+FFFD on its own
  return ids.map((id) => {
    const piece = enc.decode([id]);
    return { id, text: piece, partial: piece.includes('�') };
  });
}

/** Lazily loaded { encode, decode } for the Splitter's token mode. */
export async function encoder(engine, base) {
  const enc = await loadEncoding(engine, base);
  return { encode: (t) => enc.encode(t, { allowedSpecial: 'all' }), decode: (ids) => enc.decode(ids) };
}
