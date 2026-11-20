// Character inspector: name, category, script and block of every code point (Unicode Character
// Database, src/data/unicode-data.js, loaded on first use), plus what matters for prompt injection —
// invisible, bidi, tag and variation-selector characters, unusual spaces and look-alike letters.
// Pure JavaScript: works in extension pages and Node (`injex inspect`).

import { CONFUSABLES } from './scan.js';

const PREFIX_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_.';

export const CATEGORY_NAMES = {
  Lu: 'Uppercase letter', Ll: 'Lowercase letter', Lt: 'Titlecase letter', Lm: 'Modifier letter', Lo: 'Other letter',
  Mn: 'Non-spacing mark', Mc: 'Spacing mark', Me: 'Enclosing mark',
  Nd: 'Decimal digit', Nl: 'Letter number', No: 'Other number',
  Pc: 'Connector punctuation', Pd: 'Dash', Ps: 'Open punctuation', Pe: 'Close punctuation', Pi: 'Initial quote', Pf: 'Final quote', Po: 'Other punctuation',
  Sm: 'Math symbol', Sc: 'Currency symbol', Sk: 'Modifier symbol', So: 'Other symbol',
  Zs: 'Space', Zl: 'Line separator', Zp: 'Paragraph separator',
  Cc: 'Control', Cf: 'Format', Cs: 'Surrogate', Co: 'Private use', Cn: 'Unassigned',
};

// what each flag means, most serious first (the UI colours them; the CLI prints them)
export const FLAGS = {
  tag: { label: 'tag', level: 'bad', desc: 'Unicode tag character: invisible ASCII that models read' },
  bidi: { label: 'bidi', level: 'bad', desc: 'Bidirectional control: changes the order text is displayed in' },
  invisible: { label: 'invisible', level: 'bad', desc: 'Renders as nothing' },
  vs: { label: 'selector', level: 'warn', desc: 'Variation selector: picks a glyph style; runs of them carry hidden bytes' },
  confusable: { label: 'look-alike', level: 'warn', desc: 'Looks like a Latin letter or digit' },
  space: { label: 'odd space', level: 'warn', desc: 'A space or separator other than U+0020' },
  control: { label: 'control', level: 'warn', desc: 'Control character' },
  private: { label: 'private use', level: 'warn', desc: 'Private-use code point: no standard meaning or glyph' },
  unassigned: { label: 'unassigned', level: 'warn', desc: 'Not assigned in Unicode 17' },
  surrogate: { label: 'lone surrogate', level: 'bad', desc: 'Half of a UTF-16 pair: invalid text' },
  combining: { label: 'combining', level: 'info', desc: 'Combining mark: stacks on the previous character' },
};

// ── data ──

let D = null;

function runs(str, parse) {
  const starts = [];
  const values = [];
  for (const part of str.split(' ')) {
    const [a, v] = parse(part);
    starts.push(a);
    values.push(v);
  }
  return { starts, values };
}

function find(r, cp) {
  let lo = 0;
  let hi = r.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.starts[mid] <= cp) lo = mid;
    else hi = mid - 1;
  }
  return r.values[lo];
}

/** Decode the front-coded name list into a Map (code point → name). */
export function decodeNames(text) {
  const names = new Map();
  let cp = -1;
  let prev = '';
  for (const line of text.split('\n')) {
    if (!line) continue;
    let rest = line;
    const comma = line.indexOf(',');
    if (comma >= 0) {
      cp += parseInt(line.slice(0, comma), 36);
      rest = line.slice(comma + 1);
    } else cp += 1;
    prev = prev.slice(0, PREFIX_CHARS.indexOf(rest[0])) + rest.slice(1);
    names.set(cp, prev);
  }
  return names;
}

/** Load (once) and index the Unicode data. */
export async function loadUnicodeData() {
  if (D) return D;
  const m = await import('../data/unicode-data.js');
  D = {
    version: m.UNICODE_VERSION,
    names: decodeNames(m.NAMES),
    ranges: m.NAMED_RANGES,
    blocks: m.BLOCKS.split('\n').map((l) => {
      const [a, b, n] = l.split(';');
      return [parseInt(a, 16), parseInt(b, 16), n];
    }),
    gc: runs(m.CATEGORY_RUNS, (p) => [parseInt(p.slice(0, -2), 36), p.slice(-2)]),
    sc: runs(m.SCRIPT_RUNS, (p) => {
      const [a, i] = p.split(':');
      return [parseInt(a, 36), m.SCRIPTS[Number(i)]];
    }),
  };
  return D;
}

export function unicodeLoaded() {
  return !!D;
}

const JAMO_L = ['G', 'GG', 'N', 'D', 'DD', 'R', 'M', 'B', 'BB', 'S', 'SS', '', 'J', 'JJ', 'C', 'K', 'T', 'P', 'H'];
const JAMO_V = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WEO', 'WE', 'WI', 'YU', 'EU', 'YI', 'I'];
const JAMO_T = ['', 'G', 'GG', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'C', 'K', 'T', 'P', 'H'];

export const hexOf = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

/** The character's Unicode name ('' when it has none: private use, surrogates, unassigned). */
export function nameOf(cp) {
  if (!D) throw new Error('call loadUnicodeData() first');
  const n = D.names.get(cp);
  if (n) return n;
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    const s = cp - 0xac00;
    return 'HANGUL SYLLABLE ' + JAMO_L[Math.floor(s / 588)] + JAMO_V[Math.floor((s % 588) / 28)] + JAMO_T[s % 28];
  }
  for (const [a, b, p] of D.ranges) if (cp >= a && cp <= b) return p + hexOf(cp);
  return '';
}

export function categoryOf(cp) {
  return find(D.gc, cp);
}

export function scriptOf(cp) {
  return find(D.sc, cp);
}

export function blockOf(cp) {
  let lo = 0;
  let hi = D.blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b, n] = D.blocks[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return n;
  }
  return 'No block';
}

const BIDI = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
// render as nothing although their category says otherwise
const BLANK = new Set([0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180e, 0x180f, 0x2800, 0x3164, 0xffa0]);
const SHORT = { 0x09: 'TAB', 0x0a: 'LF', 0x0d: 'CR', 0x20: 'SP', 0xa0: 'NBSP', 0xad: 'SHY', 0x200b: 'ZWSP', 0x200c: 'ZWNJ', 0x200d: 'ZWJ', 0x2060: 'WJ', 0xfeff: 'BOM', 0x202e: 'RLO', 0x202d: 'LRO', 0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI', 0x2069: 'PDI', 0x200e: 'LRM', 0x200f: 'RLM', 0x061c: 'ALM', 0x034f: 'CGJ', 0x180e: 'MVS', 0x3164: 'HF', 0x115f: 'HCF', 0x1160: 'HJF', 0xffa0: 'HWHF', 0x2800: 'BRAILLE BLANK' };

/** How to show the character in a table: itself, or a short label for what can't be seen. */
export function glyphOf(cp, flags) {
  if (cp >= 0xe0020 && cp <= 0xe007e) return 'TAG ' + String.fromCharCode(cp - 0xe0000);
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 'VS' + (cp - 0xfe00 + 1);
  if (cp >= 0xe0100 && cp <= 0xe01ef) return 'VS' + (cp - 0xe0100 + 17);
  if (SHORT[cp]) return SHORT[cp];
  if (['invisible', 'control', 'space', 'surrogate', 'unassigned', 'private'].some((f) => flags.includes(f))) return 'U+' + hexOf(cp);
  const c = String.fromCodePoint(cp);
  return flags.includes('combining') ? '◌' + c : c;
}

/** Latin letter / digit the character can be mistaken for ('' if none). */
export function looksLike(cp) {
  const c = String.fromCodePoint(cp);
  if (CONFUSABLES[c]) return CONFUSABLES[c];
  if (cp < 0x80) return '';
  const n = c.normalize('NFKC');
  return /^[A-Za-z0-9]$/.test(n) ? n : '';
}

/** Everything about one code point. */
export function charInfo(cp) {
  if (!D) throw new Error('call loadUnicodeData() first');
  const category = categoryOf(cp);
  const flags = [];
  let note = '';
  if (cp >= 0xe0000 && cp <= 0xe007f) {
    flags.push('tag', 'invisible');
    if (cp >= 0xe0020 && cp <= 0xe007e) note = `hides “${String.fromCharCode(cp - 0xe0000)}”`;
  } else if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) {
    flags.push('vs', 'invisible');
    const n = cp <= 0xfe0f ? cp - 0xfe00 + 1 : cp - 0xe0100 + 17;
    note = `VS${n}` + (cp === 0xfe0e ? ' — text style' : cp === 0xfe0f ? ' — emoji style' : '') + `; byte ${n - 1} in emoji-byte steganography`;
  } else if (BIDI.has(cp)) flags.push('bidi', 'invisible');
  else if (category === 'Cf' || BLANK.has(cp)) flags.push('invisible');
  if (category === 'Cc' && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) flags.push('control');
  if ((category === 'Zs' && cp !== 0x20) || category === 'Zl' || category === 'Zp') flags.push('space');
  if (category === 'Co') flags.push('private');
  if (category === 'Cn') flags.push('unassigned');
  if (category === 'Cs') flags.push('surrogate');
  if ((category === 'Mn' || category === 'Me') && !flags.includes('vs') && !flags.includes('invisible')) flags.push('combining');
  const like = looksLike(cp);
  if (like) {
    flags.push('confusable');
    note ||= `looks like “${like}”`;
  }
  return {
    cp,
    char: String.fromCodePoint(cp),
    hex: 'U+' + hexOf(cp),
    name: nameOf(cp) || (category === 'Co' ? '<private use>' : category === 'Cs' ? '<surrogate>' : category === 'Cn' ? '<unassigned>' : '<no name>'),
    category,
    categoryName: CATEGORY_NAMES[category] || category,
    script: scriptOf(cp),
    block: blockOf(cp),
    flags,
    note,
    like,
    glyph: glyphOf(cp, flags),
  };
}

/** Escapes for one code point in common notations. */
export function escapesOf(cp) {
  const c = String.fromCodePoint(cp);
  const utf8 = [...new TextEncoder().encode(c)];
  const units = c.length === 2 ? [c.charCodeAt(0), c.charCodeAt(1)] : [cp];
  return {
    'UTF-8': utf8.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    'UTF-16': units.map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join(' '),
    JavaScript: cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${hexOf(cp)}`,
    Python: cp > 0xffff ? `\\U${cp.toString(16).padStart(8, '0')}` : `\\u${hexOf(cp).toLowerCase()}`,
    HTML: `&#x${cp.toString(16).toUpperCase()};`,
    CSS: `\\${cp.toString(16)} `,
    URL: utf8.map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''),
    Decimal: String(cp),
  };
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/**
 * Inspect a text: totals, scripts, flag counts and per-character info (the first `limit` code points,
 * or with `unusual` only those that aren't plain printable ASCII).
 */
export function inspectText(text, { limit = 2000, unusual = false } = {}) {
  text = String(text ?? '');
  const cps = [];
  // keep lone surrogates (for…of on a string yields them as single units)
  for (const c of text) cps.push(c.codePointAt(0));
  const scripts = {};
  const flagCounts = {};
  const chars = [];
  let shown = 0;
  let index = 0;
  const pictographic = (cp) => cp !== undefined && /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp));
  // tag letters between 🏴 and CANCEL TAG spell a subdivision flag (England, Scotland, Wales …)
  const flagTags = new Set();
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] !== 0x1f3f4) continue;
    let j = i + 1;
    while (j < cps.length && ((cps[j] >= 0xe0061 && cps[j] <= 0xe007a) || (cps[j] >= 0xe0030 && cps[j] <= 0xe0039))) j++;
    if (cps[j] === 0xe007f && j - i - 1 >= 2 && j - i - 1 <= 7) for (let k = i + 1; k <= j; k++) flagTags.add(k);
  }
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const info = charInfo(cp);
    if (flagTags.has(i)) {
      info.flags = [];
      info.note = 'part of a flag emoji';
    }
    // a ZWJ between two emoji builds one emoji (👨\u200D👩\u200D👧): normal, not hidden
    if (cp === 0x200d && pictographic(cps[i - 1] === 0xfe0f ? cps[i - 2] : cps[i - 1]) && pictographic(cps[i + 1])) {
      info.flags = [];
      info.note = 'joins the emoji around it';
    }
    info.index = i;
    info.offset = index;
    index += cp > 0xffff ? 2 : 1;
    if (info.script !== 'Common' && info.script !== 'Inherited' && info.script !== 'Unknown') scripts[info.script] = (scripts[info.script] || 0) + 1;
    for (const f of info.flags) flagCounts[f] = (flagCounts[f] || 0) + 1;
    const plain = cp >= 0x20 && cp < 0x7f;
    if ((!unusual || !plain) && shown < limit) {
      chars.push(info);
      shown++;
    }
  }
  const nfc = text.normalize('NFC');
  const nfkc = text.normalize('NFKC');
  return {
    codePoints: cps.length,
    utf16: text.length,
    utf8: new TextEncoder().encode(text).length,
    graphemes: segmenter ? [...segmenter.segment(text)].length : cps.length,
    scripts,
    flags: flagCounts,
    nfc: nfc !== text,
    nfkc: nfkc !== text ? nfkc : null,
    chars,
    truncated: chars.length < (unusual ? cps.filter((c) => !(c >= 0x20 && c < 0x7f)).length : cps.length),
  };
}
