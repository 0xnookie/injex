// Splitter: cut text into several messages, optionally transform each piece and wrap it.

import { transforms, encode } from './registry.js';

export const SPLIT_MODES = {
  word: 'Split words',
  chunk: 'Character chunks',
  sentence: 'Sentences',
  line: 'Lines',
  pattern: 'Regex pattern',
  token: 'Tokens',
};

export const WRAP_PRESETS = [
  { label: 'none', start: '', end: '' },
  { label: '"…"', start: '"', end: '"' },
  { label: '`…`', start: '`', end: '`' },
  { label: '```', start: '```\n', end: '\n```' },
  { label: '[…]', start: '[', end: ']' },
  { label: '(…)', start: '(', end: ')' },
  { label: '<part n>', start: '<part{n}>', end: '</part{n}>' },
  { label: 'Part n:', start: 'Part {n}: ', end: '' },
  { label: '{n}/…', start: '{n}/ ', end: '' },
];

/**
 * @param {string} input
 * @param {object} o  mode, chunkSize, wordSkip, minWordLength, splitFirstWord, splitSide ('left'|'right'),
 *                    pattern, keepDelimiter, preserveEmpty, tokenCount, tokenizer ({ encode, decode })
 * @returns {string[]}
 */
export function split(input, o = {}) {
  const text = String(input || '');
  if (!text) return [];
  const mode = o.mode || 'word';

  if (mode === 'chunk') {
    const size = Math.max(1, Math.min(500, Number(o.chunkSize) || 6));
    const chars = [...text];
    const out = [];
    for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
    return out;
  }
  if (mode === 'sentence') {
    return (text.match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
  }
  if (mode === 'line') {
    return text.split(/\r?\n/).filter((l) => l.trim().length > 0 || o.preserveEmpty);
  }
  if (mode === 'pattern') {
    const re = new RegExp(o.pattern || '\\s+', 'g'); // throws on a bad pattern; the UI reports it
    if (o.keepDelimiter) {
      const parts = [];
      let last = 0;
      for (const m of text.matchAll(re)) {
        if (m[0] === '') break;
        parts.push(text.slice(last, m.index + m[0].length));
        last = m.index + m[0].length;
      }
      parts.push(text.slice(last));
      return parts.filter((p) => p.length > 0);
    }
    return text.split(re).filter((p) => p.trim().length > 0);
  }
  if (mode === 'token') {
    if (!o.tokenizer) throw new Error('Tokenizer not loaded');
    const ids = o.tokenizer.encode(text);
    const n = Math.max(1, Math.min(1000, Number(o.tokenCount) || 3));
    const out = [];
    for (let i = 0; i < ids.length; i += n) out.push(o.tokenizer.decode(ids.slice(i, i + n)));
    return out;
  }

  // word mode: cut words in half so every message ends mid-word ("secondHalf + whole words + firstHalf")
  const words = text.match(/\S+/g) || [];
  if (!words.length) return [];
  const skip = Math.max(0, Math.min(20, Number(o.wordSkip) || 0));
  const minLen = Math.max(1, Number(o.minWordLength) || 2);
  let rest = words;
  let current = [];
  if (o.splitFirstWord === false) {
    current = [words[0]];
    rest = words.slice(1);
  }
  const data = rest.map((w, i) => ({ w, i, can: w.length >= minLen && w.length > 1 }));
  const splittable = data.filter((d) => d.can);
  if (!splittable.length) return [[...current, ...rest].join(' ')];
  const cut = new Set(splittable.filter((_, i) => i % (skip + 1) === 0).map((d) => d.i));
  const out = [];
  for (const d of data) {
    if (!cut.has(d.i)) {
      current.push(d.w);
      continue;
    }
    const pos = d.w.length % 2 === 0 ? d.w.length / 2 : o.splitSide === 'right' ? Math.floor(d.w.length / 2) : Math.ceil(d.w.length / 2);
    current.push(d.w.slice(0, pos));
    out.push(current.join(' '));
    current = [d.w.slice(pos)];
  }
  if (current.length) out.push(current.join(' '));
  return out;
}

/** Apply a chain of transform keys to every piece, then wrap with start / end ({n} = piece number). */
export function finish(pieces, { chain = [], start = '', end = '', marker = '{n}' } = {}) {
  let out = pieces;
  for (const key of chain) {
    if (!transforms[key]) continue;
    out = out.map((p) => {
      const r = encode(key, p);
      return r.ok ? r.text : p;
    });
  }
  const m = marker || '{n}';
  return out.map((p, i) => start.split(m).join(String(i + 1)) + p + end.split(m).join(String(i + 1)));
}
