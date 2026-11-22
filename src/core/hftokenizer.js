// Bring-your-own tokenizer: a Hugging Face tokenizer.json (Llama 2/3/4, Qwen, Mistral, Gemma, Phi, DeepSeek,
// T5, BERT, DeBERTa prompt-injection classifiers …) read without dependencies. It follows the reference
// implementation (huggingface/tokenizers) so the IDs match it:
//   models          BPE (byte-level or with byte fallback, unk fusing, subword prefix / word suffix),
//                   Unigram (Viterbi with the unk penalty, byte fallback), WordPiece, WordLevel
//   normalizers     NFC/NFD/NFKC/NFKD, Lowercase, Strip, StripAccents, Prepend, Replace, Nmt, BertNormalizer,
//                   Precompiled (SentencePiece charsmaps), ByteLevel, Sequence
//   pre-tokenizers  ByteLevel, Split (every delimiter behaviour, invert), Metaspace (prepend schemes),
//                   Digits, Whitespace, WhitespaceSplit, Punctuation, CharDelimiterSplit, BertPreTokenizer,
//                   Sequence
//   added tokens    special and normal, lstrip / rstrip / single_word / normalized
// Post-processors (BOS / EOS templates) are left out: the IDs are those of encode(text,
// add_special_tokens=False). Nothing is fetched — the person gives the file.

const TE = new TextEncoder();
const TD = new TextDecoder('utf-8', { fatal: false });

// GPT-2's byte ↔ printable-character table used by ByteLevel tokenizers
const BYTE_TO_CHAR = (() => {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const map = new Array(256);
  bs.forEach((b, i) => (map[b] = String.fromCodePoint(cs[i])));
  return map;
})();
const CHAR_TO_BYTE = new Map(BYTE_TO_CHAR.map((c, b) => [c, b]));
const toByteChars = (s) => Array.from(TE.encode(s), (b) => BYTE_TO_CHAR[b]).join('');

/**
 * Display text of a token's bytes: complete UTF-8 characters as text, the bytes of a character cut by the
 * token boundary as <0xF0>. → { text, partial }
 */
export function showBytes(bytes) {
  let text = '';
  let partial = false;
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    const n = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
    const seq = n ? bytes.slice(i, i + n) : [];
    const ok = n && seq.length === n && seq.slice(1).every((c) => (c & 0xc0) === 0x80);
    const s = ok ? TD.decode(Uint8Array.from(seq)) : '';
    if (ok && !s.includes('\u{FFFD}')) {
      text += s;
      i += n;
    } else {
      text += `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`;
      partial = true;
      i++;
    }
  }
  return { text, partial };
}
const GPT2_SPLIT = String.raw`'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+`;

// tokenizers runs tokenizer.json patterns through Oniguruma, whose Unicode \w is this set (checked against
// tokenizers 0.23 for every code point to U+2FFFF; ² ³ ¹ ¼ ½ ¾ come from its Latin-1 table). JS \w is ASCII.
const WORD = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u{B2}\u{B3}\u{B9}\u{BC}-\u{BE}`;
// the built-in Whitespace pre-tokenizer uses the Rust regex crate instead: Join_Control counts, ² does not
const RUST_WORD = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}`;
const SYNTAX = '^$\\.*+?()[]{}|/';
const LETTER = /\p{L}/u;

function propertyEscape(neg, name) {
  try {
    new RegExp(`\\p{${name}}`, 'u');
    return `\\${neg ? 'P' : 'p'}{${name}}`;
  } catch {
    return `\\${neg ? 'P' : 'p'}{Script=${name}}`; // \p{Han}, \p{Greek} … are scripts in JS
  }
}

/**
 * A pattern from tokenizer.json (Oniguruma / Rust regex syntax) as a JS u-flag pattern: possessive
 * quantifiers made greedy, inline case-insensitive groups "(?i:…)" spelled out, Unicode \w and \d,
 * \x{…}, script names, and identity escapes that the u flag rejects.
 */
export function convertPattern(src) {
  let out = '';
  let inClass = false;
  let quant = false; // the previous token was a quantifier (a following "+" makes it possessive)
  let icase = false;
  const groups = [];
  const caseLit = (c) => (icase && LETTER.test(c) && c.toLowerCase() !== c.toUpperCase() ? (inClass ? c.toLowerCase() + c.toUpperCase() : `[${c.toLowerCase()}${c.toUpperCase()}]`) : c);
  const cps = Array.from(String(src));
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === '\\') {
      const d = cps[i + 1] ?? '';
      i++;
      quant = false;
      if ((d === 'p' || d === 'P') && cps[i + 1] === '{') {
        const end = cps.indexOf('}', i);
        out += propertyEscape(d === 'P', cps.slice(i + 2, end).join(''));
        i = end;
      } else if (d === 'p' || d === 'P') {
        out += propertyEscape(d === 'P', cps[i + 1]);
        i++;
      } else if ((d === 'x' || d === 'u' || d === 'U') && cps[i + 1] === '{') {
        const end = cps.indexOf('}', i);
        out += `\\u{${cps.slice(i + 2, end).join('')}}`;
        i = end;
      } else if (d === 'U' && /^[0-9a-fA-F]{8}$/.test(cps.slice(i + 1, i + 9).join(''))) {
        out += `\\u{${cps.slice(i + 1, i + 9).join('')}}`;
        i += 8;
      } else if (d === 'w') out += inClass ? WORD : `[${WORD}]`;
      else if (d === 'W') out += inClass ? '\\W' : `[^${WORD}]`;
      else if (d === 's') out += '\\p{White_Space}'; // Oniguruma's \s has U+0085 and not U+FEFF, JS's the reverse
      else if (d === 'S') out += '\\P{White_Space}';
      else if (d === 'd') out += '\\p{Nd}';
      else if (d === 'D') out += '\\P{Nd}';
      else if (d === 'A') out += '^';
      else if (d === 'z') out += '$';
      else if (d === 'h') out += inClass ? '\\t ' : '[\\t ]';
      else if (/[0-9A-Za-z]/.test(d)) out += '\\' + d;
      else if (SYNTAX.includes(d) || (inClass && d === '-')) out += '\\' + d;
      else out += d; // "\'" "\ " "\#" …: a literal character
      continue;
    }
    if (inClass) {
      if (c === ']') {
        inClass = false;
        out += c;
      } else if (icase && LETTER.test(c) && cps[i + 1] === '-' && cps[i + 2] && cps[i + 2] !== ']' && LETTER.test(cps[i + 2])) {
        const b = cps[i + 2];
        out += `${c}-${b}`;
        const sc = (x) => (x === x.toLowerCase() ? x.toUpperCase() : x.toLowerCase());
        if (sc(c) !== c && sc(b) !== b) out += `${sc(c)}-${sc(b)}`;
        i += 2;
      } else if (c === '[') out += '\\[';
      else out += caseLit(c);
      continue;
    }
    if (c === '[') {
      inClass = true;
      quant = false;
      out += c;
      if (cps[i + 1] === '^') out += cps[++i];
      if (cps[i + 1] === ']') {
        out += '\\]';
        i++;
      }
      continue;
    }
    if (c === '(') {
      quant = false;
      groups.push(icase);
      const ahead = cps.slice(i, i + 5).join('');
      if (ahead.startsWith('(?i:')) {
        icase = true;
        out += '(?:';
        i += 3;
      } else if (ahead.startsWith('(?-i:')) {
        icase = false;
        out += '(?:';
        i += 4;
      } else if (ahead.startsWith('(?i)')) {
        groups.pop();
        icase = true;
        i += 3;
      } else if (ahead.startsWith('(?P<')) {
        out += '(?<';
        i += 3;
      } else out += c;
      continue;
    }
    if (c === ')') {
      quant = false;
      icase = groups.length ? groups.pop() : false;
      out += c;
      continue;
    }
    if (c === '+' && quant) {
      quant = false; // possessive → greedy
      continue;
    }
    if (c === '{') {
      const rest = cps.slice(i, i + 24).join('');
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(rest);
      if (m && (m[1] || m[3])) {
        out += `{${m[1] || '0'}${m[2]}${m[3]}}`;
        i += m[0].length - 1;
        quant = true;
      } else out += '\\{';
      continue;
    }
    if (c === '}') {
      out += '\\}';
      quant = false;
      continue;
    }
    if (c === '*' || c === '+' || c === '?') {
      const isQuant = !(c === '?' && out.endsWith('('));
      out += c;
      quant = isQuant && !quant; // "*?" / "+?" (lazy) end the quantifier
      continue;
    }
    quant = false;
    out += caseLit(c);
  }
  return out;
}

/** Pattern from tokenizer.json → global u-flag RegExp. */
export function toJsRegex(src) {
  return new RegExp(convertPattern(src), 'gu');
}

// ── normalizers ──

const lowerChars = (s) => Array.from(s, (c) => c.toLowerCase()).join(''); // per character, like Rust
const CJK = /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B920}-\u{2CEAF}\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}]/gu;
const NMT_DROP = /[\u{1}-\u{8}\u{B}\u{E}-\u{1F}\u{7F}\u{8F}\u{9F}]/gu;
const NMT_SPACE = /[\u{9}\u{A}\u{C}\u{D}\u{1680}\u{200B}-\u{200F}\u{2028}\u{2029}\u{2581}\u{FEFF}\u{FFFD}]/gu;

/** SentencePiece's precompiled charsmap: a darts-clone double-array trie over UTF-8 → replacement strings. */
function precompiled(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.length < 4) return (s) => s;
  const dv = new DataView(bytes.buffer);
  const trieSize = dv.getUint32(0, true);
  const trie = new Uint32Array(trieSize >>> 2);
  for (let i = 0; i < trie.length; i++) trie[i] = dv.getUint32(4 + i * 4, true);
  const norm = bytes.subarray(4 + trieSize);
  const offset = (u) => (u >>> 10) * (u & 0x200 ? 256 : 1);
  // like spm_precompiled: the first (shortest) prefix match of the chunk
  const transform = (chunk) => {
    let pos = offset(trie[0]);
    for (const c of TE.encode(chunk)) {
      if (c === 0) break;
      pos ^= c;
      const unit = trie[pos];
      if (unit === undefined || (unit & 0x800000ff) >>> 0 !== c) return null;
      pos ^= offset(unit);
      if ((unit >>> 8) & 1) {
        const v = trie[pos] & 0x7fffffff;
        let e = v;
        while (e < norm.length && norm[e] !== 0) e++;
        return TD.decode(norm.subarray(v, e));
      }
    }
    return null;
  };
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
  return (s) => {
    let out = '';
    const graphemes = seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);
    for (const g of graphemes) {
      if (TE.encode(g).length < 6) {
        const t = transform(g);
        if (t !== null) {
          out += t;
          continue;
        }
      }
      for (const c of g) out += transform(c) ?? c;
    }
    return out;
  };
}

function normalizer(spec) {
  if (!spec) return (s) => s;
  switch (spec.type) {
    case 'Sequence': {
      const fs = (spec.normalizers || []).map(normalizer);
      return (s) => fs.reduce((x, f) => f(x), s);
    }
    case 'NFC':
    case 'NFD':
    case 'NFKC':
    case 'NFKD':
      return (s) => s.normalize(spec.type);
    case 'Lowercase':
      return lowerChars;
    case 'Strip':
      return (s) => {
        let t = s;
        if (spec.strip_left !== false) t = t.replace(/^\p{White_Space}+/u, '');
        if (spec.strip_right !== false) t = t.replace(/\p{White_Space}+$/u, '');
        return t;
      };
    case 'StripAccents':
      return (s) => s.replace(/\p{Mn}/gu, '');
    case 'Prepend':
      return (s) => (s ? spec.prepend + s : s);
    case 'Replace': {
      const content = spec.content ?? '';
      if (spec.pattern?.String !== undefined) return (s) => s.split(spec.pattern.String).join(content);
      const re = toJsRegex(spec.pattern?.Regex ?? '(?!)');
      return (s) => s.replace(re, () => content);
    }
    case 'Nmt':
      return (s) => s.replace(NMT_DROP, '').replace(NMT_SPACE, ' ');
    case 'BertNormalizer':
      return (s) => {
        let t = s;
        if (spec.clean_text !== false) t = t.replace(/\p{C}|\u{FFFD}/gu, (c) => ('\t\n\r'.includes(c) ? c : '')).replace(/\p{White_Space}/gu, ' ');
        if (spec.handle_chinese_chars !== false) t = t.replace(CJK, ' $& ');
        if (spec.strip_accents ?? spec.lowercase !== false) t = t.normalize('NFD').replace(/\p{Mn}/gu, '');
        if (spec.lowercase !== false) t = lowerChars(t);
        return t;
      };
    case 'Precompiled':
      return spec.precompiled_charsmap ? precompiled(spec.precompiled_charsmap) : (s) => s;
    case 'ByteLevel':
      return toByteChars;
    default:
      return (s) => s;
  }
}

// ── pre-tokenizers: [{ s, o }] pieces (o = offset of the piece in its segment) ──

/** Delimiter spans → pieces, with tokenizers' SplitDelimiterBehavior. */
function splitPiece(piece, spans, behavior = 'Isolated', invert = false) {
  const { s, o } = piece;
  let parts = [];
  let last = 0;
  for (const [a, b] of spans) {
    if (a > last) parts.push([last, a, false]);
    parts.push([a, b, true]);
    last = b;
  }
  if (last < s.length) parts.push([last, s.length, false]);
  if (invert) parts = parts.map(([a, b, m]) => [a, b, !m]);
  let out;
  if (behavior === 'Removed') out = parts.filter((p) => !p[2]);
  else if (behavior === 'MergedWithPrevious' || behavior === 'Contiguous') {
    out = [];
    let prev = false;
    for (const p of parts) {
      const merge = behavior === 'Contiguous' ? p[2] === prev : p[2] && !prev;
      if (merge && out.length) out[out.length - 1][1] = p[1];
      else out.push([p[0], p[1], false]);
      prev = p[2];
    }
  } else if (behavior === 'MergedWithNext') {
    out = [];
    let prev = false;
    for (const p of [...parts].reverse()) {
      if (p[2] && !prev && out.length) out[out.length - 1][0] = p[0];
      else out.push([p[0], p[1], false]);
      prev = p[2];
    }
    out.reverse();
  } else out = parts;
  return out.filter(([a, b]) => b > a).map(([a, b]) => ({ s: s.slice(a, b), o: o + a }));
}
const regexSpans = (s, re) => Array.from(s.matchAll(re), (m) => [m.index, m.index + m[0].length]).filter(([a, b]) => b > a);
const charSpans = (s, test) => {
  const out = [];
  let i = 0;
  for (const c of s) {
    if (test(c)) out.push([i, i + c.length]);
    i += c.length;
  }
  return out;
};
const isWs = (c) => /\p{White_Space}/u.test(c);
const isPunct = (c) => /[\p{P}!-/:-@[-`{-~]/u.test(c); // Unicode punctuation + ASCII punctuation (incl. symbols)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); // "-" stays: "\-" is an error outside a class

/** tokenizers drops empty splits before every pre-tokenizer (Metaspace would otherwise turn "" into "▁"). */
function preTokenizer(spec) {
  const f = preTokenizerOf(spec);
  return (p) => (p.s ? f(p) : []);
}

function preTokenizerOf(spec) {
  if (!spec) return (p) => [p];
  switch (spec.type) {
    case 'Sequence': {
      const ps = (spec.pretokenizers || []).map(preTokenizer);
      return (p) => ps.reduce((pieces, f) => pieces.flatMap(f), [p]);
    }
    case 'ByteLevel': {
      const re = spec.use_regex === false ? null : toJsRegex(GPT2_SPLIT);
      return (p) => {
        const q = spec.add_prefix_space && !p.s.startsWith(' ') ? { s: ' ' + p.s, o: p.o } : p;
        return (re ? splitPiece(q, regexSpans(q.s, re)) : [q]).map((x) => ({ s: toByteChars(x.s), o: x.o, bytes: true }));
      };
    }
    case 'Split': {
      const re = spec.pattern?.Regex !== undefined ? toJsRegex(spec.pattern.Regex) : new RegExp(escapeRe(String(spec.pattern?.String ?? ' ')), 'gu');
      return (p) => splitPiece(p, regexSpans(p.s, re), spec.behavior, !!spec.invert);
    }
    case 'Metaspace': {
      const rep = spec.replacement || '▁';
      const scheme = spec.prepend_scheme || (spec.add_prefix_space === false ? 'never' : 'always');
      return (p) => {
        let s = p.s.replace(/ /g, rep);
        if (!s.startsWith(rep) && (scheme === 'always' || (scheme === 'first' && p.o === 0))) s = rep + s;
        const q = { s, o: p.o };
        return spec.split === false ? [q] : splitPiece(q, charSpans(s, (c) => c === rep), 'MergedWithNext');
      };
    }
    case 'Digits':
      return (p) => splitPiece(p, charSpans(p.s, (c) => /\p{N}/u.test(c)), spec.individual_digits ? 'Isolated' : 'Contiguous');
    case 'Whitespace': {
      const re = new RegExp(`[${RUST_WORD}]+|[^${RUST_WORD}\\p{White_Space}]+`, 'gu');
      return (p) => splitPiece(p, regexSpans(p.s, re), 'Removed', true);
    }
    case 'WhitespaceSplit':
      return (p) => splitPiece(p, charSpans(p.s, isWs), 'Removed');
    case 'CharDelimiterSplit':
      return (p) => splitPiece(p, charSpans(p.s, (c) => c === spec.delimiter), 'Removed');
    case 'Punctuation':
      return (p) => splitPiece(p, charSpans(p.s, isPunct), spec.behavior || 'Isolated');
    case 'BertPreTokenizer':
      return (p) => splitPiece(p, charSpans(p.s, isWs), 'Removed').flatMap((q) => splitPiece(q, charSpans(q.s, isPunct), 'Isolated'));
    default:
      return (p) => [p];
  }
}

// ── models ──

/**
 * Apply BPE merges the way tokenizers does (lowest rank first, leftmost on ties) with a heap over a
 * linked list of symbols, so long runs without spaces stay O(n log n). `join` builds the merged symbol.
 */
function bpeMerge(syms, ranks, join) {
  const n = syms.length;
  if (n < 2) return syms;
  const next = Array.from({ length: n }, (_, i) => (i + 1 < n ? i + 1 : -1));
  const prev = Array.from({ length: n }, (_, i) => i - 1);
  const heap = []; // [rank, pos, left, right]
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const pair = (i) => {
    const j = next[i];
    if (j < 0 || syms[i] === null || syms[j] === null) return;
    const r = ranks.get(syms[i] + ' ' + syms[j]);
    if (r !== undefined) push([r, i, syms[i], syms[j]]);
  };
  for (let i = 0; i < n - 1; i++) pair(i);
  while (heap.length) {
    const [, i, a, b] = pop();
    const j = next[i];
    if (syms[i] !== a || j < 0 || syms[j] !== b) continue; // stale entry
    syms[i] = join(a, b);
    syms[j] = undefined;
    next[i] = next[j];
    if (next[j] >= 0) prev[next[j]] = i;
    if (prev[i] >= 0) pair(prev[i]);
    pair(i);
  }
  const out = [];
  for (let i = 0; i >= 0; i = next[i]) out.push(syms[i]);
  return out;
}

const byteToken = (b) => `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`;
const UNK = Symbol('unk');

function bpeModel(model) {
  const vocab = new Map(Object.entries(model.vocab || {}));
  const prefix = model.continuing_subword_prefix || '';
  const suffix = model.end_of_word_suffix || '';
  const ranks = new Map();
  (model.merges || []).forEach((m, i) => {
    const key = Array.isArray(m) ? m.join(' ') : m;
    if (!ranks.has(key)) ranks.set(key, i);
  });
  const join = (a, b) => a + (prefix && b.startsWith(prefix) ? b.slice(prefix.length) : b);
  const unkId = model.unk_token != null ? vocab.get(model.unk_token) : undefined;
  const fuse = !!model.fuse_unk;
  const cache = new Map();
  const encodeWord = (word) => {
    const hit = cache.get(word);
    if (hit) return hit;
    if (model.ignore_merges && vocab.has(word)) return [vocab.get(word)];
    // symbols: vocabulary strings, byte-fallback tokens, or null for an unknown character (never merges)
    const syms = [];
    const chars = Array.from(word);
    chars.forEach((c, k) => {
      const s = (k > 0 ? prefix : '') + c + (k === chars.length - 1 ? suffix : '');
      if (vocab.has(s)) syms.push(s);
      else if (model.byte_fallback && Array.from(TE.encode(s)).every((b) => vocab.has(byteToken(b)))) for (const b of TE.encode(s)) syms.push(byteToken(b));
      else if (unkId !== undefined && !(fuse && syms[syms.length - 1] === null)) syms.push(null);
    });
    const ids = bpeMerge(syms, ranks, join).map((s) => (s === null ? unkId : vocab.get(s)));
    if (cache.size < 50000) cache.set(word, ids);
    return ids;
  };
  return { vocab, encodeWord, unkId };
}

function unigramModel(model) {
  const pieces = model.vocab || [];
  const vocab = new Map();
  let minScore = Infinity;
  let maxLen = 1;
  pieces.forEach(([p, score], i) => {
    if (!vocab.has(p)) vocab.set(p, i);
    if (score < minScore) minScore = score;
    const len = Array.from(p).length;
    if (len > maxLen) maxLen = len;
  });
  const unkId = model.unk_id ?? undefined;
  const unkScore = minScore - 10; // tokenizers' kUnkPenalty
  const cache = new Map();
  const encodeWord = (word) => {
    const hit = cache.get(word);
    if (hit) return hit;
    const chars = Array.from(word);
    const n = chars.length;
    const best = Array.from({ length: n + 1 }, () => ({ score: 0, from: -1, id: -1 }));
    best[0].from = 0;
    for (let s = 0; s < n; s++) {
      if (best[s].from < 0) continue;
      const base = best[s].score;
      let single = false;
      let str = '';
      for (let e = s + 1; e <= Math.min(n, s + maxLen); e++) {
        str += chars[e - 1];
        const id = vocab.get(str);
        if (id === undefined) continue;
        const sc = base + pieces[id][1];
        if (best[e].from < 0 || sc > best[e].score) best[e] = { score: sc, from: s, id };
        if (e === s + 1) single = true;
      }
      if (!single) {
        const sc = base + unkScore;
        if (best[s + 1].from < 0 || sc > best[s + 1].score) best[s + 1] = { score: sc, from: s, id: UNK };
      }
    }
    // back-track; consecutive unknown characters fuse into one piece
    const parts = [];
    for (let e = n; e > 0; e = best[e].from) {
      const { from, id } = best[e];
      const text = chars.slice(from, e).join('');
      if (id === UNK && parts.length && parts[parts.length - 1].unk) parts[parts.length - 1].text = text + parts[parts.length - 1].text;
      else parts.push({ text, unk: id === UNK, id });
    }
    parts.reverse();
    const ids = [];
    for (const p of parts) {
      if (!p.unk) ids.push(p.id);
      else if (model.byte_fallback && Array.from(TE.encode(p.text)).every((b) => vocab.has(byteToken(b)))) for (const b of TE.encode(p.text)) ids.push(vocab.get(byteToken(b)));
      else ids.push(unkId ?? 0);
    }
    if (cache.size < 50000) cache.set(word, ids);
    return ids;
  };
  return { vocab, encodeWord, unkId, idToToken: pieces.map(([p]) => p) };
}

function wordPieceModel(model) {
  const vocab = new Map(Object.entries(model.vocab || {}));
  const prefix = model.continuing_subword_prefix ?? '##';
  const maxChars = model.max_input_chars_per_word ?? 100;
  const unkId = vocab.get(model.unk_token ?? '[UNK]');
  const encodeWord = (word) => {
    const chars = Array.from(word);
    if (chars.length > maxChars) return [unkId ?? 0];
    const ids = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let found;
      for (; end > start; end--) {
        const sub = (start > 0 ? prefix : '') + chars.slice(start, end).join('');
        found = vocab.get(sub);
        if (found !== undefined) break;
      }
      if (found === undefined) return [unkId ?? 0];
      ids.push(found);
      start = end;
    }
    return ids;
  };
  return { vocab, encodeWord, unkId, prefix };
}

function wordLevelModel(model) {
  const vocab = new Map(Object.entries(model.vocab || {}));
  const unkId = model.unk_token != null ? vocab.get(model.unk_token) : undefined;
  return { vocab, unkId, encodeWord: (w) => (vocab.has(w) ? [vocab.get(w)] : unkId !== undefined ? [unkId] : []) };
}

/** The model type, also for files that leave "type" out (older exports of T5, BERT …). */
function modelType(model) {
  if (model.type) return model.type;
  if (Array.isArray(model.vocab)) return 'Unigram';
  if (model.merges) return 'BPE';
  if (model.max_input_chars_per_word !== undefined || model.continuing_subword_prefix) return 'WordPiece';
  if (model.vocab) return 'WordLevel';
  return '?';
}

// ── added tokens ──

const WORD_CHAR = /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]/u;

/** Split [{ s, o }] around added tokens → [{ s, o } | { id, o }]. */
function addedSplitter(tokens, mapContent = (c) => c) {
  if (!tokens.length) return (seg) => [seg];
  const list = tokens.map((a) => ({ ...a, match: mapContent(a.content) })).filter((a) => a.match);
  const byText = new Map();
  for (const a of list) if (!byText.has(a.match)) byText.set(a.match, a);
  const re = new RegExp([...byText.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'gu');
  return (seg) => {
    const s = seg.s;
    const out = [];
    let last = 0;
    re.lastIndex = 0;
    for (let m; (m = re.exec(s)); ) {
      const a = byText.get(m[0]);
      let start = m.index;
      let end = start + m[0].length;
      if (a.single_word && ((start > 0 && WORD_CHAR.test(Array.from(s.slice(0, start)).pop())) || (end < s.length && WORD_CHAR.test(String.fromCodePoint(s.codePointAt(end)))))) continue;
      if (a.lstrip) while (start > last && isWs(s[start - 1])) start--;
      if (a.rstrip) while (end < s.length && isWs(s[end])) end++;
      if (start > last) out.push({ s: s.slice(last, start), o: seg.o + last });
      out.push({ id: a.id, o: seg.o + start });
      last = end;
      re.lastIndex = end;
    }
    if (last < s.length) out.push({ s: s.slice(last), o: seg.o + last });
    return out;
  };
}

/**
 * Load a tokenizer.json (object or JSON text). Returns { name, kind, vocabSize, encodeIds(text),
 * encode(text) → [{ id, text, partial, unk?, special? }], count(text), decode(ids), normalize(text) }.
 */
export function loadHfTokenizer(json, name = 'tokenizer.json') {
  const t = typeof json === 'string' ? JSON.parse(json) : json;
  if (!t || typeof t !== 'object' || !t.model) throw new Error('not a tokenizer.json (no "model")');
  const type = modelType(t.model);
  const m = type === 'BPE' ? bpeModel(t.model) : type === 'Unigram' ? unigramModel(t.model) : type === 'WordPiece' ? wordPieceModel(t.model) : type === 'WordLevel' ? wordLevelModel(t.model) : null;
  if (!m) throw new Error(`unsupported tokenizer model "${type}" (BPE, Unigram, WordPiece and WordLevel are supported)`);
  const norm = normalizer(t.normalizer);
  const pre = preTokenizer(t.pre_tokenizer);
  const specs = JSON.stringify([t.pre_tokenizer, t.decoder, t.normalizer]);
  const byteLevel = specs.includes('"ByteLevel"');
  const metaspace = specs.includes('▁');

  const idToToken = m.idToToken ? [...m.idToToken] : [];
  if (!m.idToToken) for (const [k, id] of m.vocab) idToToken[id] = k;
  const added = (t.added_tokens || []).filter((a) => a && a.content && Number.isInteger(a.id));
  for (const a of added) idToToken[a.id] = a.content;
  const addedIds = new Set(added.map((a) => a.id));
  const specialIds = new Set(added.filter((a) => a.special).map((a) => a.id));
  const splitRaw = addedSplitter(added.filter((a) => !a.normalized));
  const splitNorm = addedSplitter(
    added.filter((a) => a.normalized),
    (c) => norm(c),
  );

  const encodeIds = (input) => {
    const text = String(input ?? '');
    const ids = [];
    for (const seg of splitRaw({ s: text, o: 0 })) {
      if (seg.id !== undefined) {
        ids.push(seg.id);
        continue;
      }
      for (const part of splitNorm({ s: norm(seg.s), o: seg.o })) {
        if (part.id !== undefined) ids.push(part.id);
        else if (part.s) for (const w of pre(part)) if (w.s) ids.push(...m.encodeWord(w.s));
      }
    }
    return ids;
  };

  /** Display text of one token, and whether it holds only part of a character. */
  const piece = (id) => {
    const tok = idToToken[id] ?? '';
    const info = {};
    if (id === m.unkId) info.unk = true;
    if (specialIds.has(id)) info.special = true;
    if (addedIds.has(id)) return { text: tok, partial: false, ...info };
    const fb = /^<0x([0-9A-F]{2})>$/i.exec(tok);
    if (fb) return { text: `<0x${fb[1].toUpperCase()}>`, partial: parseInt(fb[1], 16) >= 0x80, ...info };
    if (byteLevel) {
      // a piece of a character shows its bytes, like byte-fallback tokens
      return { ...showBytes(Array.from(tok, (c) => CHAR_TO_BYTE.get(c) ?? 63)), ...info };
    }
    return { text: metaspace ? tok.replace(/▁/g, ' ') : tok, partial: false, ...info };
  };

  /** Text of a list of IDs (byte-level bytes, byte-fallback bytes, "▁" → space, WordPiece "##" joined). */
  const decode = (ids) => {
    const bytes = [];
    const pushStr = (s) => bytes.push(...TE.encode(s));
    ids.forEach((id, k) => {
      const tok = idToToken[id] ?? '';
      if (addedIds.has(id)) return pushStr(tok);
      const fb = /^<0x([0-9A-F]{2})>$/i.exec(tok);
      if (fb) return bytes.push(parseInt(fb[1], 16));
      if (byteLevel) return bytes.push(...Array.from(tok, (c) => CHAR_TO_BYTE.get(c) ?? 63));
      if (type === 'WordPiece') return pushStr(tok.startsWith(m.prefix) ? tok.slice(m.prefix.length) : (k ? ' ' : '') + tok);
      pushStr(metaspace ? tok.replace(/▁/g, ' ') : tok);
    });
    const s = TD.decode(Uint8Array.from(bytes));
    return metaspace && s.startsWith(' ') ? s.slice(1) : s;
  };

  return {
    name: t.name || name,
    type,
    kind: type + (byteLevel ? ' (byte-level)' : t.model.byte_fallback ? ' (byte fallback)' : ''),
    vocabSize: idToToken.length,
    encodeIds,
    encode: (text) => encodeIds(text).map((id) => ({ id, ...piece(id) })),
    count: (text) => encodeIds(text).length,
    decode,
    normalize: (text) => norm(String(text ?? '')),
    /** Pieces of the pre-tokenizer alone (like tokenizers' pre_tokenize_str). */
    preTokenize: (text) => pre({ s: String(text ?? ''), o: 0 }).map((p) => p.s),
  };
}
