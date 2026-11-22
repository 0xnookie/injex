// PDF reader for hidden text. Parses the file (incremental updates, object streams, Flate / LZW /
// ASCII85 / ASCIIHex / RunLength filters, PNG predictors), decodes text through ToUnicode CMaps or the
// font encoding, and runs each page's content stream to know, for every piece of text, whether a
// reader can see it: render mode 3 (invisible), white or background-coloured fill, transparency,
// sub-point size, zero horizontal scaling, outside the page, clipped away, on a hidden optional-
// content layer, or covered by an opaque shape drawn on top. An invisible text layer over a full-page
// image (OCR of a scan) is recognised as such. Also reads the document info, XMP metadata and
// annotation texts. No encryption support (encrypted files are reported as such).

import { inflate } from './codec.js';

const MAX_PAGES = 1000;
const MAX_OPS = 3_000_000;

// ── bytes ↔ binary strings ──

function toBinary(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}
function fromBinary(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}

// ── lexer / parser for PDF objects ──

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

class Name {
  constructor(n) {
    this.n = n;
  }
}
class Ref {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
}
class PStr {
  constructor(s) {
    this.s = s; // binary string (bytes)
  }
}
class Op {
  constructor(o) {
    this.o = o;
  }
}
const nameOf = (v) => (v instanceof Name ? v.n : null);

class Lexer {
  constructor(s, pos = 0, end = s.length) {
    this.s = s;
    this.p = pos;
    this.end = end;
  }
  skip() {
    const s = this.s;
    for (;;) {
      while (this.p < this.end && isWs(s.charCodeAt(this.p))) this.p++;
      if (s.charCodeAt(this.p) === 37) {
        while (this.p < this.end && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++;
      } else return;
    }
  }
  /** Next token: number, Name, PStr, '[', ']', '<<', '>>', Op, or null at the end. */
  token() {
    this.skip();
    if (this.p >= this.end) return null;
    const s = this.s;
    const c = s.charCodeAt(this.p);
    if (c === 47) {
      // name
      let q = this.p + 1;
      while (q < this.end && !isWs(s.charCodeAt(q)) && !isDelim(s.charCodeAt(q))) q++;
      const raw = s.slice(this.p + 1, q);
      this.p = q;
      return new Name(raw.replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === 40) return this.literal();
    if (c === 60) {
      if (s[this.p + 1] === '<') {
        this.p += 2;
        return '<<';
      }
      const q = s.indexOf('>', this.p);
      const hex = s.slice(this.p + 1, q < 0 ? this.end : q).replace(/[^0-9A-Fa-f]/g, '');
      this.p = q < 0 ? this.end : q + 1;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt((hex[i] + (hex[i + 1] || '0')), 16));
      return new PStr(out);
    }
    if (c === 62 && s[this.p + 1] === '>') {
      this.p += 2;
      return '>>';
    }
    if (c === 91 || c === 93 || c === 123 || c === 125) {
      this.p++;
      return String.fromCharCode(c);
    }
    let q = this.p;
    while (q < this.end && !isWs(s.charCodeAt(q)) && !isDelim(s.charCodeAt(q))) q++;
    if (q === this.p) {
      this.p++;
      return new Op(s[q]);
    }
    const word = s.slice(this.p, q);
    this.p = q;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    return new Op(word);
  }
  literal() {
    const s = this.s;
    let depth = 0;
    let out = '';
    let i = this.p + 1;
    for (; i < this.end; i++) {
      const ch = s[i];
      if (ch === '\\') {
        const n = s[++i];
        if (n === 'n') out += '\n';
        else if (n === 'r') out += '\r';
        else if (n === 't') out += '\t';
        else if (n === 'b') out += '\b';
        else if (n === 'f') out += '\f';
        else if (n === '\r') {
          if (s[i + 1] === '\n') i++;
        } else if (n === '\n');
        else if (n >= '0' && n <= '7') {
          let oct = n;
          while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else out += n ?? '';
      } else if (ch === '(') {
        depth++;
        out += ch;
      } else if (ch === ')') {
        if (depth === 0) break;
        depth--;
        out += ch;
      } else out += ch;
    }
    this.p = i + 1;
    return new PStr(out);
  }
  /** A full object (numbers followed by `R` become references). */
  value(tok = this.token()) {
    if (tok === '[') {
      const arr = [];
      for (;;) {
        const t = this.token();
        if (t === ']' || t === null) return this.refs(arr);
        arr.push(this.value(t));
      }
    }
    if (tok === '<<') {
      const items = [];
      for (;;) {
        const t = this.token();
        if (t === '>>' || t === null) break;
        items.push(this.value(t));
      }
      const flat = this.refs(items);
      const d = {};
      for (let i = 0; i + 1 < flat.length; i += 2) if (flat[i] instanceof Name) d[flat[i].n] = flat[i + 1];
      return d;
    }
    if (tok instanceof Op) {
      if (tok.o === 'true') return true;
      if (tok.o === 'false') return false;
      if (tok.o === 'null') return null;
    }
    return tok;
  }
  refs(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] === 'number' && typeof arr[i + 1] === 'number' && arr[i + 2] instanceof Op && arr[i + 2].o === 'R') {
        out.push(new Ref(arr[i], arr[i + 1]));
        i += 2;
      } else out.push(arr[i]);
    }
    return out;
  }
}

// ── filters ──

function pngUnpredict(data, parms) {
  const colors = parms?.Colors || 1;
  const bpc = parms?.BitsPerComponent || 8;
  const cols = parms?.Columns || 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * cols) / 8);
  const out = new Uint8Array(Math.floor(data.length / (rowLen + 1)) * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0, i = 0; i + rowLen < data.length + 1 && r * rowLen < out.length; r++) {
    const type = data[i++];
    const row = data.subarray(i, i + rowLen);
    i += rowLen;
    const cur = new Uint8Array(rowLen);
    for (let x = 0; x < rowLen; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x] || 0;
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev = cur;
  }
  return out;
}

function lzwDecode(data, early = 1) {
  const out = [];
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push(null, null);
  };
  reset();
  let bits = 9;
  let buf = 0;
  let n = 0;
  let prev = null;
  for (let i = 0; i < data.length; i++) {
    buf = (buf << 8) | data[i];
    n += 8;
    while (n >= bits) {
      const code = (buf >> (n - bits)) & ((1 << bits) - 1);
      n -= bits;
      if (code === 256) {
        reset();
        bits = 9;
        prev = null;
        continue;
      }
      if (code === 257) return new Uint8Array(out);
      let entry = dict[code];
      if (!entry && prev) entry = [...prev, prev[0]];
      if (!entry) return new Uint8Array(out);
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return new Uint8Array(out);
}

function ascii85(data) {
  const s = toBinary(data).replace(/\s+/g, '');
  const end = s.indexOf('~>');
  const body = (end >= 0 ? s.slice(0, end) : s).replace(/^<~/, '');
  const out = [];
  let group = [];
  for (const ch of body) {
    if (ch === 'z' && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    for (let i = 0; i < k - 1; i++) out.push((v >>> (24 - 8 * i)) & 255);
  }
  return new Uint8Array(out);
}

function asciiHex(data) {
  let hex = toBinary(data).replace(/>[\s\S]*$/, '').replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function runLength(data) {
  const out = [];
  for (let i = 0; i < data.length; ) {
    const len = data[i++];
    if (len === 128) break;
    if (len < 128) {
      for (let k = 0; k <= len && i < data.length; k++) out.push(data[i++]);
    } else {
      const b = data[i++];
      for (let k = 0; k < 257 - len; k++) out.push(b);
    }
  }
  return new Uint8Array(out);
}

// ── text encodings ──

// Windows-1252 0x80–0x9F (WinAnsiEncoding); the rest of WinAnsi is Latin-1
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
// (the PDF spec: unused WinAnsi codes above 0x20 — 0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D — are bullets)
const winAnsi = (b) => (b === 0x7f || b === 0x81 || b === 0x8d || b === 0x8f || b === 0x90 || b === 0x9d ? '•' : b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b));
// PDFDocEncoding differs from Latin-1 in 0x18–0x1F and 0x80–0xA0
const PDFDOC = { 0x80: '•', 0x81: '†', 0x82: '‡', 0x83: '…', 0x84: '—', 0x85: '–', 0x86: 'ƒ', 0x87: '⁄', 0x88: '‹', 0x89: '›', 0x8a: '−', 0x8b: '‰', 0x8c: '„', 0x8d: '“', 0x8e: '”', 0x8f: '‘', 0x90: '’', 0x91: '‚', 0x92: '™', 0x93: 'ﬁ', 0x94: 'ﬂ', 0x95: 'Ł', 0x96: 'Œ', 0x97: 'Š', 0x98: 'Ÿ', 0x99: 'Ž', 0x9a: 'ı', 0x9b: 'ł', 0x9c: 'œ', 0x9d: 'š', 0x9e: 'ž', 0xa0: '€' };

/** A PDF text string (Info, annotations): UTF-16BE / UTF-8 with BOM, or PDFDocEncoding. */
export function pdfTextString(bin) {
  if (bin.startsWith('\xfe\xff')) {
    let out = '';
    for (let i = 2; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return out;
  }
  if (bin.startsWith('\xef\xbb\xbf')) return new TextDecoder().decode(fromBinary(bin.slice(3)));
  let out = '';
  for (const ch of bin) out += PDFDOC[ch.charCodeAt(0)] || ch;
  return out;
}

// glyph names → characters for fonts without ToUnicode (common Latin names; uniXXXX / uXXXX handled)
const GLYPHS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„', endash: '–', emdash: '—', bullet: '•', ellipsis: '…', dagger: '†', daggerdbl: '‡', trademark: '™', copyright: '©', registered: '®', degree: '°', section: '§', paragraph: '¶',
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', oslash: 'ø', Oslash: 'Ø', dotlessi: 'ı', exclamdown: '¡', questiondown: '¿', euro: '€', sterling: '£', yen: '¥', cent: '¢', nbspace: '\u00A0', sfthyphen: '\u00AD',
};
const ACCENTS = { acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', tilde: '̃', ring: '̊', cedilla: '̧', caron: '̌' };
function glyphChar(name) {
  if (!name) return '';
  if (name.length === 1) return name;
  if (GLYPHS[name]) return GLYPHS[name];
  let m = name.match(/^uni([0-9A-Fa-f]{4})+$/);
  if (m) return name.slice(3).match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join('');
  m = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = name.match(/^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/);
  if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC');
  const base = name.split(/[._]/)[0];
  return base !== name ? glyphChar(base) : '';
}

/** A ToUnicode CMap stream → { ranges: codespace byte lengths, map: Map(code → string) }. */
function parseCMap(text) {
  const map = new Map();
  const lengths = new Set();
  const utf16 = (hex) => {
    let s = '';
    for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) s = String.fromCharCode(parseInt(hex, 16));
    return s;
  };
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) lengths.add(r[1].length / 2);
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(r[1], 16) + ':' + r[1].length / 2, utf16(r[2]));
      lengths.add(r[1].length / 2);
    }
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      const len = r[1].length / 2;
      lengths.add(len);
      if (hi - lo > 65535) continue;
      if (r[3][0] === '[') {
        const dsts = [...r[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => utf16(x[1]));
        for (let c = lo; c <= hi && c - lo < dsts.length; c++) map.set(c + ':' + len, dsts[c - lo]);
      } else {
        const hex = r[3].slice(1, -1);
        const base = utf16(hex);
        for (let c = lo; c <= hi; c++) {
          const last = base.charCodeAt(base.length - 1) + (c - lo);
          map.set(c + ':' + len, base.slice(0, -1) + String.fromCharCode(last));
        }
      }
    }
  }
  return { lengths: [...lengths].filter((n) => n >= 1 && n <= 4).sort((a, b) => a - b), map };
}

// ── document ──

class PdfDoc {
  constructor(u8) {
    this.s = toBinary(u8);
    this.objs = new Map(); // num → { value, stream: { start, end } | null }
    this.trailers = [];
    this.cache = new Map();
  }

  async load() {
    const s = this.s;
    if (!/^\s*%PDF-/.test(s.slice(0, 1024)) && !s.slice(0, 1024).includes('%PDF-')) throw new Error('not a PDF file');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const lx = new Lexer(s, re.lastIndex);
      let value;
      try {
        value = lx.value();
      } catch {
        continue;
      }
      let stream = null;
      lx.skip();
      if (s.startsWith('stream', lx.p) && value && typeof value === 'object' && !Array.isArray(value)) {
        let start = lx.p + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        let end = -1;
        const len = typeof value.Length === 'number' ? value.Length : -1;
        if (len >= 0 && /^\s*endstream/.test(s.slice(start + len, start + len + 32))) end = start + len;
        if (end < 0) {
          end = s.indexOf('endstream', start);
          if (end < 0) end = s.length;
          let e = end;
          if (s[e - 1] === '\n') e--;
          if (s[e - 1] === '\r') e--;
          end = e;
        }
        stream = { start, end };
        re.lastIndex = Math.max(re.lastIndex, end);
      } else re.lastIndex = Math.max(re.lastIndex, lx.p);
      this.objs.set(Number(m[1]), { value, stream });
    }
    // trailers: classic `trailer << >>` and cross-reference stream dictionaries
    let t = -1;
    while ((t = s.indexOf('trailer', t + 1)) >= 0) {
      const lx = new Lexer(s, t + 7);
      const v = lx.value();
      if (v && typeof v === 'object' && !Array.isArray(v)) this.trailers.push(v);
    }
    for (const o of this.objs.values()) if (nameOf(o.value?.Type) === 'XRef') this.trailers.push(o.value);
    // object streams (compressed objects); a plain object of the same number wins
    for (const [, o] of [...this.objs]) {
      if (nameOf(o.value?.Type) !== 'ObjStm' || !o.stream) continue;
      try {
        const data = toBinary(await this.streamBytes(o));
        const n = o.value.N || 0;
        const first = o.value.First || 0;
        const head = new Lexer(data, 0, first);
        const pairs = [];
        for (let i = 0; i < n; i++) pairs.push([head.token(), head.token()]);
        for (const [num, off] of pairs) {
          if (typeof num !== 'number' || this.objs.has(num)) continue;
          const lx = new Lexer(data, first + off);
          this.objs.set(num, { value: lx.value(), stream: null });
        }
      } catch {
        /* a damaged object stream */
      }
    }
    this.trailer = Object.assign({}, ...this.trailers);
    this.encrypted = !!this.trailers.find((x) => x.Encrypt);
    return this;
  }

  get(v) {
    for (let i = 0; v instanceof Ref && i < 32; i++) v = this.objs.get(v.num)?.value ?? null;
    return v instanceof Ref ? null : v;
  }

  entry(v) {
    return v instanceof Ref ? this.objs.get(v.num) || null : null;
  }

  async streamBytes(o) {
    if (!o?.stream) return new Uint8Array();
    const key = o.stream.start;
    if (this.cache.has(key)) return this.cache.get(key);
    let data = fromBinary(this.s.slice(o.stream.start, o.stream.end));
    const d = o.value || {};
    const filters = [].concat(this.get(d.Filter) ?? []).map((f) => nameOf(this.get(f)));
    const parmsList = [].concat(this.get(d.DecodeParms) ?? []).map((p) => this.get(p));
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      const parms = parmsList[i] || null;
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data);
      else if (f === 'LZWDecode' || f === 'LZW') data = lzwDecode(data, parms?.EarlyChange ?? 1);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else if (f === 'RunLengthDecode' || f === 'RL') data = runLength(data);
      else break; // images (DCT, JPX, JBIG2, CCITT): not text
      if ((f === 'FlateDecode' || f === 'Fl' || f === 'LZWDecode' || f === 'LZW') && parms?.Predictor >= 10) data = pngUnpredict(data, parms);
    }
    this.cache.set(key, data);
    return data;
  }

  async streamOf(ref) {
    const e = this.entry(ref);
    return e?.stream ? toBinary(await this.streamBytes(e)) : '';
  }

  catalog() {
    const root = this.get(this.trailer.Root);
    if (root) return root;
    for (const o of this.objs.values()) if (nameOf(o.value?.Type) === 'Catalog') return o.value;
    return null;
  }

  /** Pages in order, with inherited Resources / MediaBox / CropBox. */
  pages() {
    const out = [];
    const seen = new Set();
    const walk = (ref, inherited) => {
      const node = this.get(ref);
      if (!node || typeof node !== 'object' || out.length >= MAX_PAGES) return;
      const key = ref instanceof Ref ? ref.num : node;
      if (seen.has(key)) return;
      seen.add(key);
      const inh = { Resources: node.Resources ?? inherited.Resources, MediaBox: node.MediaBox ?? inherited.MediaBox, CropBox: node.CropBox ?? inherited.CropBox };
      if (nameOf(node.Type) === 'Pages' || Array.isArray(this.get(node.Kids))) for (const kid of this.get(node.Kids) || []) walk(kid, inh);
      else out.push({ node, ...inh });
    };
    const cat = this.catalog();
    if (cat) walk(cat.Pages, {});
    if (!out.length) for (const o of this.objs.values()) if (nameOf(o.value?.Type) === 'Page') out.push({ node: o.value, Resources: o.value.Resources, MediaBox: o.value.MediaBox, CropBox: o.value.CropBox });
    return out;
  }
}

// ── fonts ──

async function loadFont(doc, ref) {
  const key = ref instanceof Ref ? 'f' + ref.num : null;
  if (key && doc.cache.has(key)) return doc.cache.get(key);
  const f = doc.get(ref) || {};
  const sub = nameOf(doc.get(f.Subtype));
  const font = { type0: sub === 'Type0', toUnicode: null, enc: new Map(), widths: new Map(), dw: sub === 'Type0' ? 1000 : 500, scale: 0.001, lengths: [1] };
  if (f.ToUnicode) {
    try {
      font.toUnicode = parseCMap(await doc.streamOf(f.ToUnicode));
    } catch {
      /* unreadable CMap */
    }
  }
  if (font.type0) {
    font.lengths = font.toUnicode?.lengths.length ? font.toUnicode.lengths : [2];
    const encName = nameOf(doc.get(f.Encoding));
    if (encName && /^Identity|UCS2|UTF16/.test(encName)) font.lengths = [2];
    const desc = doc.get((doc.get(f.DescendantFonts) || [])[0]) || {};
    if (typeof desc.DW === 'number') font.dw = desc.DW;
    const W = doc.get(desc.W) || [];
    for (let i = 0; i < W.length; ) {
      const a = doc.get(W[i]);
      const b = doc.get(W[i + 1]);
      if (Array.isArray(b)) {
        b.forEach((w, k) => font.widths.set(a + k, doc.get(w)));
        i += 2;
      } else {
        const w = doc.get(W[i + 2]);
        for (let c = a; c <= b && c - a < 65536; c++) font.widths.set(c, w);
        i += 3;
      }
    }
  } else {
    const first = doc.get(f.FirstChar) || 0;
    (doc.get(f.Widths) || []).forEach((w, i) => font.widths.set(first + i, doc.get(w)));
    if (sub === 'Type3') {
      const fm = doc.get(f.FontMatrix);
      if (Array.isArray(fm)) font.scale = Math.abs(fm[0]) || 0.001;
    }
    let enc = doc.get(f.Encoding);
    const base = nameOf(enc) || nameOf(enc?.BaseEncoding);
    for (let b = 0; b < 256; b++) font.enc.set(b, base === 'MacRomanEncoding' && b >= 0x80 ? '' : winAnsi(b));
    if (enc && typeof enc === 'object' && !(enc instanceof Name)) {
      let code = 0;
      for (const d of doc.get(enc.Differences) || []) {
        if (typeof d === 'number') code = d;
        else if (d instanceof Name) font.enc.set(code++, glyphChar(d.n));
      }
    }
  }
  if (key) doc.cache.set(key, font);
  return font;
}

/** Bytes of a shown string → [{ text, width (text space units), space }] */
function decodeShow(font, bin) {
  const out = [];
  if (!font) {
    for (const ch of bin) out.push({ text: winAnsi(ch.charCodeAt(0)), width: 0.5, space: ch === ' ' });
    return out;
  }
  for (let i = 0; i < bin.length; ) {
    let len = font.lengths[0];
    let code = 0;
    let text;
    if (font.toUnicode && font.lengths.length > 1) {
      for (const L of font.lengths) {
        let c = 0;
        for (let k = 0; k < L; k++) c = (c << 8) | bin.charCodeAt(i + k);
        if (font.toUnicode.map.has(c + ':' + L)) {
          len = L;
          code = c;
          break;
        }
      }
    }
    if (!code) for (let k = 0; k < len; k++) code = (code << 8) | (bin.charCodeAt(i + k) || 0);
    i += len;
    text = font.toUnicode?.map.get(code + ':' + len);
    if (text === undefined) text = font.type0 ? (font.toUnicode ? '' : String.fromCharCode(code)) : (font.enc.get(code) ?? '');
    const w = font.widths.get(code);
    out.push({ text, width: (w ?? font.dw) * font.scale, space: len === 1 && code === 32 });
  }
  return out;
}

// ── geometry ──

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function bboxOf(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
const inside = (b, x, y, pad = 0) => b && x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
const intersect = (a, b) => (!a ? b : !b ? a : [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const boxOf = (v) => (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number') ? [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])] : null);

function cmykToRgb([c, m, y, k]) {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}
function toRgb(comps, space) {
  if (!comps || comps.some((n) => typeof n !== 'number')) return null;
  if (space === 1 || (!space && comps.length === 1)) return [comps[0], comps[0], comps[0]];
  if (space === 3 || (!space && comps.length === 3)) return comps.slice(0, 3);
  if (space === 4 || (!space && comps.length === 4)) return cmykToRgb(comps);
  return null;
}
const colorDist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// ── content streams ──

async function runPage(doc, page, pageNo, ocOff) {
  const items = [];
  const fills = []; // { box, color, order, image }
  const box = boxOf(doc.get(page.CropBox)) || boxOf(doc.get(page.MediaBox)) || [0, 0, 612, 792];
  let order = 0;
  let ops = 0;

  const csComps = (res, name) => {
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return 1;
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return 3;
    if (name === 'DeviceCMYK' || name === 'CMYK') return 4;
    const cs = doc.get((doc.get(res?.ColorSpace) || {})[name]);
    const family = Array.isArray(cs) ? nameOf(doc.get(cs[0])) : nameOf(cs);
    if (family === 'ICCBased') return doc.get(doc.get(cs[1])?.N) || 0;
    if (family === 'CalRGB' || family === 'DeviceRGB') return 3;
    if (family === 'CalGray' || family === 'DeviceGray') return 1;
    if (family === 'DeviceCMYK') return 4;
    return 0; // pattern, separation, indexed …: unknown colour
  };

  const exec = async (content, res, gsInit, depth) => {
    const resources = doc.get(res) || {};
    const fonts = doc.get(resources.Font) || {};
    const xobjects = doc.get(resources.XObject) || {};
    const extg = doc.get(resources.ExtGState) || {};
    const props = doc.get(resources.Properties) || {};
    let gs = { ...gsInit };
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];
    let path = [];
    let clipPending = false;
    const mc = []; // marked-content stack: true when hidden by optional content
    const operands = [];
    const lx = new Lexer(content);
    const show = async (bin) => {
      const font = gs.fontRef ? await loadFont(doc, gs.fontRef) : null;
      const glyphs = decodeShow(font, bin.s ?? bin);
      const trm = mul([gs.size * gs.hscale, 0, 0, gs.size, 0, gs.rise], mul(tm, gs.ctm));
      const [x, y] = [trm[4], trm[5]];
      const eff = Math.hypot(trm[2], trm[3]);
      let text = '';
      let adv = 0;
      for (const g of glyphs) {
        text += g.text;
        adv += (g.width * gs.size + gs.cs + (g.space ? gs.ws : 0)) * gs.hscale;
      }
      if (text) {
        const mode = gs.render;
        const paint = mode === 1 || mode === 5 ? gs.stroke : gs.fill;
        items.push({ text, x, y, size: eff, mode, color: paint, alpha: mode === 1 || mode === 5 ? gs.strokeAlpha : gs.fillAlpha, clip: gs.clip, hscale: gs.hscale, oc: mc.some(Boolean), order: order++, page: pageNo, width: adv * Math.hypot(gs.ctm[0], gs.ctm[1]) * Math.hypot(tm[0], tm[1]) });
      }
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    };
    for (let tok = lx.token(); tok !== null; tok = lx.token()) {
      if (++ops > MAX_OPS) break;
      if (!(tok instanceof Op)) {
        operands.push(tok === '[' || tok === '<<' ? lx.value(tok) : tok);
        continue;
      }
      const op = tok.o;
      const a = operands.splice(0);
      const n = (i) => (typeof a[i] === 'number' ? a[i] : 0);
      switch (op) {
        case 'q':
          stack.push({ ...gs });
          break;
        case 'Q':
          if (stack.length) gs = stack.pop();
          break;
        case 'cm':
          gs.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm);
          break;
        case 'gs': {
          const g = doc.get(extg[nameOf(a[0])]) || {};
          if (typeof g.ca === 'number') gs.fillAlpha = g.ca;
          if (typeof g.CA === 'number') gs.strokeAlpha = g.CA;
          break;
        }
        // colour
        case 'g':
          gs.fill = [n(0), n(0), n(0)];
          break;
        case 'G':
          gs.stroke = [n(0), n(0), n(0)];
          break;
        case 'rg':
          gs.fill = [n(0), n(1), n(2)];
          break;
        case 'RG':
          gs.stroke = [n(0), n(1), n(2)];
          break;
        case 'k':
          gs.fill = cmykToRgb([n(0), n(1), n(2), n(3)]);
          break;
        case 'K':
          gs.stroke = cmykToRgb([n(0), n(1), n(2), n(3)]);
          break;
        case 'cs':
          // the initial colour of Gray, RGB and CMYK spaces is black; other spaces: unknown
          gs.fillSpace = csComps(resources, nameOf(a[0]));
          gs.fill = gs.fillSpace ? [0, 0, 0] : null;
          break;
        case 'CS':
          gs.strokeSpace = csComps(resources, nameOf(a[0]));
          gs.stroke = gs.strokeSpace ? [0, 0, 0] : null;
          break;
        case 'sc':
        case 'scn':
          gs.fill = a.every((v) => typeof v === 'number') ? toRgb(a, gs.fillSpace) : null;
          break;
        case 'SC':
        case 'SCN':
          gs.stroke = a.every((v) => typeof v === 'number') ? toRgb(a, gs.strokeSpace) : null;
          break;
        // paths
        case 're': {
          const [x, y, w, h] = [n(0), n(1), n(2), n(3)];
          path.push(apply(gs.ctm, x, y), apply(gs.ctm, x + w, y), apply(gs.ctm, x, y + h), apply(gs.ctm, x + w, y + h));
          break;
        }
        case 'm':
        case 'l':
          path.push(apply(gs.ctm, n(0), n(1)));
          break;
        case 'c':
          path.push(apply(gs.ctm, n(0), n(1)), apply(gs.ctm, n(2), n(3)), apply(gs.ctm, n(4), n(5)));
          break;
        case 'v':
        case 'y':
          path.push(apply(gs.ctm, n(0), n(1)), apply(gs.ctm, n(2), n(3)));
          break;
        case 'W':
        case 'W*':
          clipPending = true;
          break;
        case 'f':
        case 'F':
        case 'f*':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
        case 'S':
        case 's':
        case 'n': {
          const filled = op !== 'S' && op !== 's' && op !== 'n';
          if (path.length) {
            const b = bboxOf(path);
            if (filled && gs.fill && gs.fillAlpha > 0.9 && !mc.some(Boolean)) fills.push({ box: b, color: gs.fill, order: order++ });
            if (clipPending) gs.clip = intersect(gs.clip, b);
          }
          clipPending = false;
          path = [];
          break;
        }
        // text
        case 'BT':
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
          break;
        case 'Tf':
          gs.fontRef = fonts[nameOf(a[0])];
          gs.size = n(1);
          break;
        case 'Tr':
          gs.render = n(0);
          break;
        case 'Tz':
          gs.hscale = n(0) / 100;
          break;
        case 'Tc':
          gs.cs = n(0);
          break;
        case 'Tw':
          gs.ws = n(0);
          break;
        case 'TL':
          gs.leading = n(0);
          break;
        case 'Ts':
          gs.rise = n(0);
          break;
        case 'Td':
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case 'TD':
          gs.leading = -n(1);
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case 'Tm':
          tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
          tm = tlm;
          break;
        case 'T*':
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          break;
        case 'Tj':
          if (a[0] instanceof PStr) await show(a[0]);
          break;
        case "'":
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          if (a[0] instanceof PStr) await show(a[0]);
          break;
        case '"':
          gs.ws = n(0);
          gs.cs = n(1);
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          if (a[2] instanceof PStr) await show(a[2]);
          break;
        case 'TJ':
          for (const part of Array.isArray(a[0]) ? a[0] : []) {
            if (part instanceof PStr) await show(part);
            else if (typeof part === 'number') {
              const dx = (-part / 1000) * gs.size * gs.hscale;
              if (part < -250 && items.length) items[items.length - 1].gapAfter = true; // a word space made with kerning
              tm = mul([1, 0, 0, 1, dx, 0], tm);
            }
          }
          break;
        // marked content / optional content
        case 'BMC':
          mc.push(false);
          break;
        case 'BDC': {
          let hidden = false;
          if (nameOf(a[0]) === 'OC') {
            const p = a[1] instanceof Name ? props[a[1].n] : a[1];
            hidden = ocOff(p);
          }
          mc.push(hidden);
          break;
        }
        case 'EMC':
          mc.pop();
          break;
        // images and forms
        case 'Do': {
          const ref = xobjects[nameOf(a[0])];
          const e = doc.entry(ref);
          const x = e?.value || doc.get(ref);
          const st = nameOf(x?.Subtype);
          if (st === 'Image') fills.push({ box: bboxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)]), image: true, order: order++, ref: e, res });
          else if (st === 'Form' && e && depth < 8) {
            const m = doc.get(x.Matrix);
            const fgs = { ...gs, ctm: Array.isArray(m) && m.length === 6 ? mul(m.map((v) => doc.get(v)), gs.ctm) : gs.ctm };
            const hiddenForm = x.OC ? ocOff(x.OC) : false;
            if (hiddenForm) mc.push(true);
            await exec(toBinary(await doc.streamBytes(e)), x.Resources ?? res, fgs, depth + 1);
            if (hiddenForm) mc.pop();
          }
          break;
        }
        case 'BI': {
          // inline image: skip its data
          const end = content.indexOf('EI', lx.p);
          lx.p = end < 0 ? content.length : end + 2;
          fills.push({ box: bboxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 1)]), image: true, order: order++ });
          break;
        }
        default:
      }
    }
  };

  // Contents: a stream, an array of streams, or a reference to such an array
  const c0 = page.node.Contents;
  const contents = Array.isArray(c0) ? c0 : c0 instanceof Ref && Array.isArray(doc.get(c0)) ? doc.get(c0) : c0 ? [c0] : [];
  let content = '';
  for (const c of contents) {
    const e = doc.entry(c);
    if (e) content += toBinary(await doc.streamBytes(e)) + '\n';
  }
  const gs0 = { ctm: [1, 0, 0, 1, 0, 0], fill: [0, 0, 0], stroke: [0, 0, 0], fillSpace: 1, strokeSpace: 1, fillAlpha: 1, strokeAlpha: 1, render: 0, fontRef: null, size: 0, hscale: 1, cs: 0, ws: 0, leading: 0, rise: 0, clip: null };
  await exec(content, page.Resources, gs0, 0);
  return { items, fills, box };
}

/** Why a text item can't be seen ('' when it can). */
function classify(it, page, ocr) {
  if (it.oc) return 'on a hidden layer (optional content switched off)';
  if (it.mode === 3 || it.mode === 7) return ocr ? 'ocr' : 'invisible text (render mode 3)';
  if (it.alpha !== undefined && it.alpha <= 0.02) return 'fully transparent text';
  if (it.size < 1) return `tiny text (${it.size < 0.01 ? it.size.toExponential(1) : it.size.toFixed(2)} pt)`;
  if (Math.abs(it.hscale) < 0.02) return 'squeezed to zero width';
  const b = page.box;
  const pad = Math.max(2, it.size);
  if (it.x > b[2] + pad || it.x + Math.max(it.width, 0) < b[0] - pad || it.y > b[3] + pad || it.y + it.size < b[1] - pad) return 'outside the page';
  if (it.clip && (area(it.clip) <= 1 || !inside(it.clip, it.x + Math.min(it.width, it.size) / 2, it.y + it.size * 0.3, 1))) return 'clipped away';
  if (it.color) {
    // what is underneath: the last filled shape or image drawn before the text at its position
    const px = it.x + Math.min(Math.max(it.width, 0), it.size) / 2;
    const py = it.y + it.size * 0.3;
    let under = null;
    for (const f of page.fills) if (f.order < it.order && inside(f.box, px, py)) under = f;
    if (!under?.image) {
      const bg = under?.color || [1, 1, 1];
      if (colorDist(it.color, bg) < 0.06) return !under && bg.every((v) => v > 0.985) ? 'white text on a white page' : 'text in the same colour as its background';
    }
    // an opaque shape drawn later right over the text
    for (const f of page.fills) {
      if (f.order > it.order && !f.image && f.box[3] - f.box[1] >= it.size * 0.6 && inside(f.box, px, py) && inside(f.box, it.x + Math.max(it.width, 0) * 0.9, py)) return 'covered by a shape drawn on top';
    }
  }
  return '';
}

/** One image XObject as JPEG bytes or raw 8-bit pixels (what the OCR pack can read), or null. */
async function imageData(doc, e, res) {
  const d = e?.value || {};
  if (doc.get(d.ImageMask) === true) return null;
  const width = doc.get(d.Width);
  const height = doc.get(d.Height);
  if (!(width > 0 && height > 0)) return null;
  const filters = [].concat(doc.get(d.Filter) ?? []).map((f) => nameOf(doc.get(f)));
  const last = filters.at(-1);
  if (last === 'DCTDecode' || last === 'DCT') return { mime: 'image/jpeg', data: await doc.streamBytes(e), width, height };
  if (filters.some((f) => !['FlateDecode', 'Fl', 'LZWDecode', 'LZW', 'ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx', 'RunLengthDecode', 'RL'].includes(f))) return null; // JPX, JBIG2, CCITT
  const bpc = doc.get(d.BitsPerComponent) ?? 8;
  let cs = doc.get(d.ColorSpace);
  if (typeof nameOf(cs) === 'string' && !Array.isArray(cs)) cs = doc.get((doc.get(doc.get(res)?.ColorSpace) || {})[nameOf(cs)]) ?? cs;
  const family = Array.isArray(cs) ? nameOf(doc.get(cs[0])) : nameOf(cs);
  const channels = family === 'DeviceGray' || family === 'G' || family === 'CalGray' ? 1 : family === 'DeviceRGB' || family === 'RGB' || family === 'CalRGB' ? 3 : family === 'ICCBased' ? doc.get(doc.get(cs[1])?.N) : 0;
  if (channels !== 1 && channels !== 3) return null;
  const raw = await doc.streamBytes(e);
  const decode = doc.get(d.Decode);
  const invert = Array.isArray(decode) && doc.get(decode[0]) === 1;
  if (bpc === 8 && raw.length >= width * height * channels) return { raw: { width, height, channels, pixels: invert ? raw.map((v) => 255 - v) : raw.subarray(0, width * height * channels) } };
  if (bpc === 1 && channels === 1) {
    // 1-bit scans: 0 is black unless /Decode [1 0]
    const row = Math.ceil(width / 8);
    if (raw.length < row * height) return null;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = (raw[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? (invert ? 0 : 255) : invert ? 255 : 0;
    return { raw: { width, height, channels: 1, pixels } };
  }
  return null;
}

/**
 * The images drawn on a PDF's pages that the OCR pack can read: [{ page, width, height, mime?, data?, raw? }]
 * (JPEG and 8-bit / 1-bit grey or RGB images; JPEG 2000, JBIG2 and CCITT are skipped and counted).
 */
export async function readPdfImages(bytes, { maxPages = 30, maxImages = 40, minPixels = 60000 } = {}) {
  const doc = await new PdfDoc(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).load();
  if (doc.encrypted) return { images: [], skipped: 0, encrypted: true };
  const pages = doc.pages().slice(0, maxPages);
  const images = [];
  const seen = new Set();
  let skipped = 0;
  for (let i = 0; i < pages.length && images.length < maxImages; i++) {
    let r;
    try {
      r = await runPage(doc, pages[i], i + 1, () => false);
    } catch {
      continue;
    }
    for (const f of r.fills.filter((x) => x.image && x.ref)) {
      if (seen.has(f.ref) || images.length >= maxImages) continue;
      seen.add(f.ref);
      const w = doc.get(f.ref.value?.Width) || 0;
      const h = doc.get(f.ref.value?.Height) || 0;
      if (w * h < minPixels) continue;
      const img = await imageData(doc, f.ref, f.res).catch(() => null);
      if (img) images.push({ page: i + 1, ...img });
      else skipped++;
    }
  }
  return { images, skipped, pages: doc.pages().length };
}

/**
 * Read a PDF. Returns { type: 'pdf', pages, chunks: [{ page, text, hidden }], annotations: [{ page, text, hidden }],
 * meta: [{ field, value }], ocrPages: [n], warnings: [] }.
 */
export async function readPdf(bytes) {
  const doc = await new PdfDoc(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).load();
  const warnings = [];
  const meta = [];
  const info = doc.get(doc.trailer.Info);
  if (info && typeof info === 'object') for (const [k, v] of Object.entries(info)) if (doc.get(v) instanceof PStr) meta.push({ field: k, value: pdfTextString(doc.get(v).s) });
  if (doc.encrypted) {
    warnings.push('The PDF is encrypted: its text can’t be read without decrypting it first.');
    return { type: 'pdf', pages: doc.pages().length, chunks: [], annotations: [], meta: [], ocrPages: [], warnings };
  }
  const cat = doc.catalog() || {};
  if (cat.Metadata) {
    try {
      const xmp = new TextDecoder().decode(fromBinary(await doc.streamOf(cat.Metadata)));
      for (const m of xmp.matchAll(/<(dc:title|dc:description|dc:subject|pdf:Keywords|dc:creator|xmp:CreatorTool|pdf:Producer)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
        const v = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (v) meta.push({ field: 'XMP ' + m[1], value: v });
      }
    } catch {
      /* unreadable XMP */
    }
  }
  // optional content groups switched off by default
  const ocp = doc.get(cat.OCProperties);
  const off = new Set((doc.get(doc.get(ocp?.D)?.OFF) || []).map((r) => (r instanceof Ref ? r.num : null)));
  const ocOff = (p) => {
    if (p instanceof Ref) {
      if (off.has(p.num)) return true;
      const d = doc.get(p);
      if (nameOf(d?.Type) === 'OCMD') return [].concat(doc.get(d.OCGs) ?? []).some((g) => g instanceof Ref && off.has(g.num)) && nameOf(d.P) !== 'AnyOn';
    }
    return false;
  };

  const pages = doc.pages();
  if (pages.length >= MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} pages were read.`);
  const chunks = [];
  const annotations = [];
  const ocrPages = [];
  for (let i = 0; i < pages.length; i++) {
    let r;
    try {
      r = await runPage(doc, pages[i], i + 1, ocOff);
    } catch (e) {
      warnings.push(`Page ${i + 1}: ${e.message}`);
      continue;
    }
    const pageArea = area(r.box);
    const imageArea = r.fills.filter((f) => f.image).reduce((s, f) => s + area(intersect(f.box, r.box)), 0);
    const invisible = r.items.filter((it) => it.mode === 3 || it.mode === 7).length;
    const ocr = pageArea > 0 && imageArea >= pageArea * 0.5 && invisible >= r.items.length * 0.8;
    if (ocr && invisible) ocrPages.push(i + 1);
    let prev = null;
    for (const it of r.items) {
      let hidden = classify(it, r, ocr);
      if (hidden === 'ocr') hidden = '';
      // spacing between show operations: a new line, or a gap on the same line
      let sep = '';
      if (prev) {
        const dy = Math.abs(it.y - prev.y);
        const gap = it.x - (prev.x + prev.width);
        if (dy > Math.max(prev.size, it.size) * 0.6) sep = '\n';
        else if (prev.gapAfter || gap > it.size * 0.2) sep = ' ';
      }
      chunks.push({ page: i + 1, text: sep + it.text, hidden, size: it.size });
      prev = it;
    }
    chunks.push({ page: i + 1, text: '\n', hidden: '' });
    for (const a of doc.get(pages[i].node.Annots) || []) {
      const an = doc.get(a);
      if (!an || typeof an !== 'object') continue;
      const flags = doc.get(an.F) || 0;
      for (const key of ['Contents', 'RC', 'TU', 'V']) {
        const v = doc.get(an[key]);
        if (v instanceof PStr) {
          const text = pdfTextString(v.s).replace(/<[^>]+>/g, ' ').trim();
          if (text) annotations.push({ page: i + 1, field: key, subtype: nameOf(doc.get(an.Subtype)) || '', text, hidden: !!(flags & 2 || flags & 1 || flags & 32) });
        }
      }
    }
  }
  return { type: 'pdf', pages: pages.length, chunks, annotations, meta: meta.filter((m) => m.value.trim()), ocrPages, warnings };
}
