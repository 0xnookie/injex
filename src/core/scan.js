// Hidden-text scanner: finds text a human doesn't see but a model (or a copy-paste) does.
//
//  tags        Unicode Tags block (U+E0000–E007F) — invisible ASCII, the classic hidden prompt injection
//  vs-bits     long runs of VS15/VS16 after a character — emoji steganography (bits scheme)
//  vs-bytes    runs of variation selectors VS1–VS256 — one byte per selector ("emoji smuggling")
//  zero-width  runs of zero-width characters (ZWSP, ZWNJ, ZWJ, WJ, BOM …) — zero-width steganography
//  bidi        bidirectional overrides / isolates — text that renders in a different order ("Trojan Source")
//  homoglyph   words mixing Latin with Cyrillic / Greek look-alikes
//  filler      Hangul fillers and other blank "letters" — invisible identifiers in code ("invisible backdoor")
//  css-hidden  page text hidden with CSS (display:none, zero size, transparent, off-screen …) — page scans only
//  comment     HTML comments with sentence-like text — page scans only
//
// scanText() is pure; collectPage() is injected into a tab with chrome.scripting and must stay self-contained.

import { decodeTags, decodeEmojiBits, decodeEmojiBytes, printableRatio } from './stego.js';
import { transforms } from './registry.js';

export const KINDS = {
  tags: { label: 'Unicode tags', short: 'TAGS', desc: 'Invisible tag characters (U+E0000–E007F). Each one carries an ASCII byte that models read and humans never see.' },
  'vs-bits': { label: 'Emoji stego (bits)', short: 'VS BITS', desc: 'A long run of VS15/VS16 variation selectors: one hidden bit per selector.' },
  'vs-bytes': { label: 'Emoji stego (bytes)', short: 'VS BYTES', desc: 'A run of variation selectors VS1–VS256: one hidden byte per selector.' },
  'zero-width': { label: 'Zero-width', short: 'ZERO-W', desc: 'Zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM …). Used for watermarks, fingerprinting and zero-width steganography.' },
  bidi: { label: 'Bidi control', short: 'BIDI', desc: 'Bidirectional override / isolate characters. Text can render in a different order than it is read ("Trojan Source").' },
  homoglyph: { label: 'Homoglyphs', short: 'HOMOGL', desc: 'Words mixing Latin letters with Cyrillic or Greek look-alikes (spoofing, filter evasion).' },
  filler: { label: 'Invisible letters', short: 'FILLER', desc: 'Hangul fillers and similar characters that render blank but count as letters: invisible identifiers in code (the "invisible backdoor") or invisible padding in text.' },
  'css-hidden': { label: 'CSS-hidden text', short: 'HIDDEN', desc: 'Text in the page that CSS hides from view (display:none, zero size, transparent, clipped or off-screen) but that is still in the DOM — and in what an AI agent or summarizer reads.' },
  comment: { label: 'HTML comment', short: 'COMMENT', desc: 'Sentence-like text in an HTML comment: invisible on the page, present in the source.' },
};

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// phrases typical of injected instructions (override the model, or exfiltrate through it)
const INSTRUCTION = new RegExp(
  [
    String.raw`\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|system)\b`,
    String.raw`\b(system prompt|developer message|you are (now )?(an?|the) |act as|new instructions?|from now on|do not (tell|reveal|mention)|respond (only )?with|assistant:)`,
    String.raw`<\|im_start\|>|\[INST\]|<<SYS>>`,
    String.raw`\b(send|forward|email|e-mail|post|upload|leak|exfiltrate)\b.{0,40}\b(conversation|chat|history|messages?|password|credentials?|api keys?|tokens?|cookies?|secrets?|personal data)\b`,
    String.raw`\b(when|if) (you are|you're) (an? )?(ai|llm|language model|assistant|agent)\b`,
    String.raw`\bnote to (ai|llm|the (ai|model|assistant|agent))s?\b`,
  ].join('|'),
  'i',
);

export function looksLikeInstructions(s) {
  return INSTRUCTION.test(s || '');
}

const ZW = '\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF\u180E\u034F';
const RE = {
  tags: /(?:\udb40[\udc00-\udc7f])+/g,
  vsBits: /[\uFE0E\uFE0F](?:[\uFE0E\uFE0F\u200B\u200C\u200D\u2060\uFEFF]){15,}/g,
  vsBytes: /(?:[\uFE00-\uFE0F]|\udb40[\udd00-\uddef]){2,}/g,
  zw: new RegExp(`[${ZW}]{2,}|[${ZW}]`, 'g'),
  bidi: /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g,
  filler: /[\u115F\u1160\u3164\uFFA0]+/g,
};

// ZWNJ / ZWJ between two letters of a script that uses them (Persian, Arabic, Indic …) are spelling, not hiding
// (a letter outside Latin, or a combining mark of such a script — Devanagari's virama comes before its ZWJ)
const NON_LATIN_LETTER = /[^\P{L}A-Za-z\u{C0}-\u{24F}]|[^\P{M}\u{300}-\u{36F}\u{FE00}-\u{FE0F}]/u;
const joinerInWord = (text, m) => m[0].length === 1 && (m[0] === '\u200C' || m[0] === '\u200D') && NON_LATIN_LETTER.test(text[m.index - 1] || '') && NON_LATIN_LETTER.test(text[m.index + 1] || '');

// \uD83C\uDFF4 + tag letters + CANCEL TAG is a subdivision flag emoji (England, Scotland, Wales \u2026), not hidden text
const FLAG_TAGS = /^[\u{E0061}-\u{E007A}\u{E0030}-\u{E0039}]{2,7}\u{E007F}$/u;
/** Is the tag run `run` at `index` of `text` the tag part of a flag emoji? */
export function isFlagTags(text, index, run) {
  return text.slice(Math.max(0, index - 2), index) === '\u{1F3F4}' && FLAG_TAGS.test(run);
}

const NAMES = {
  0x200b: 'ZWSP',
  0x200c: 'ZWNJ',
  0x200d: 'ZWJ',
  0x2060: 'WJ',
  0x2061: 'FA',
  0x2062: 'IT',
  0x2063: 'IS',
  0x2064: 'IP',
  0xfeff: 'BOM',
  0x180e: 'MVS',
  0x034f: 'CGJ',
  0x202a: 'LRE',
  0x202b: 'RLE',
  0x202c: 'PDF',
  0x202d: 'LRO',
  0x202e: 'RLO',
  0x2066: 'LRI',
  0x2067: 'RLI',
  0x2068: 'FSI',
  0x2069: 'PDI',
  0x200e: 'LRM',
  0x200f: 'RLM',
  0x061c: 'ALM',
  0xfe0e: 'VS15',
  0xfe0f: 'VS16',
  0x3164: 'HF',
  0x115f: 'HCF',
  0x1160: 'HJF',
  0xffa0: 'HWHF',
};

/** Render invisible characters visibly: "a⟨ZWSP⟩b", tag chars as ⟨tag:x⟩ runs collapsed. */
export function visualize(s, max = 400) {
  let out = '';
  let cut = false;
  for (const c of s) {
    const cp = c.codePointAt(0);
    if (cp >= 0xe0000 && cp <= 0xe007f) out += '⟨' + (cp >= 0xe0020 && cp <= 0xe007e ? String.fromCharCode(cp - 0xe0000) : 'U+' + cp.toString(16).toUpperCase()) + '⟩';
    else if (cp >= 0xfe00 && cp <= 0xfe0d) out += '⟨VS' + (cp - 0xfe00 + 1) + '⟩';
    else if (cp >= 0xe0100 && cp <= 0xe01ef) out += '⟨VS' + (cp - 0xe0100 + 17) + '⟩';
    else if (NAMES[cp]) out += '⟨' + NAMES[cp] + '⟩';
    else out += c;
    // marks shrink when merged below, so collect a few times `max` before cutting
    if (out.length > max * 4) {
      cut = true;
      break;
    }
  }
  // merge neighbouring marks: tag characters spell a word (⟨hi⟩), named characters stay apart (⟨VS16 VS15⟩)
  out = out.replace(/(?<=⟨[^⟨⟩]{2,})⟩⟨|⟩⟨(?=[^⟨⟩]{2,}⟩)/g, ' ').replace(/⟩⟨/g, '');
  if (!cut && out.length <= max) return out;
  out = out.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
  return out + (out.lastIndexOf('⟨') > out.lastIndexOf('⟩') ? '…⟩' : '…');
}

const isLowSurrogate = (c) => c >= 0xdc00 && c <= 0xdfff;

function context(text, start, end, pad = 40) {
  // never cut a surrogate pair in half; show invisible characters around the match too
  let a = Math.max(0, start - pad);
  if (a > 0 && isLowSurrogate(text.charCodeAt(a))) a--;
  let b = Math.min(text.length, end + pad);
  if (b < text.length && isLowSurrogate(text.charCodeAt(b))) b++;
  return {
    before: (a > 0 ? '…' : '') + visualize(text.slice(a, start).replace(/\s+/g, ' '), 160),
    match: visualize(text.slice(start, end), 160),
    after: visualize(text.slice(end, b).replace(/\s+/g, ' '), 160) + (b < text.length ? '…' : ''),
  };
}

const LATIN = /[A-Za-z]/;
const CONFUSABLE = /[Ѐ-ӿͰ-Ͽ]/;

/**
 * Scan one string. Returns findings: { kind, severity, start, end, count, payload, ctx, note }.
 * @param {string} text
 * @param {{ stego?: object }} [opts]
 */
export function scanText(text, opts = {}) {
  const out = [];
  if (!text) return out;
  const covered = []; // [start, end] ranges already explained by a stronger finding
  const isCovered = (s, e) => covered.some(([a, b]) => s >= a && e <= b);
  const push = (f) => {
    out.push(f);
    covered.push([f.start, f.end]);
  };

  for (const m of text.matchAll(RE.tags)) {
    if (isFlagTags(text, m.index, m[0])) continue;
    const payload = decodeTags(m[0]);
    const n = [...m[0]].length;
    const instr = looksLikeInstructions(payload);
    push({
      kind: 'tags',
      severity: payload.trim().length >= 3 ? 'critical' : 'high',
      start: m.index,
      end: m.index + m[0].length,
      count: n,
      payload,
      instructions: instr,
      ctx: context(text, m.index, m.index + m[0].length),
      note: `${n} tag characters`,
    });
  }

  for (const m of text.matchAll(RE.vsBits)) {
    const start = Math.max(0, m.index - 2);
    const payload = decodeEmojiBits(text.slice(start, m.index + m[0].length), opts.stego);
    if (!payload || printableRatio(payload) < 0.8) continue;
    push({
      kind: 'vs-bits',
      severity: 'critical',
      start: m.index,
      end: m.index + m[0].length,
      count: [...m[0]].length,
      payload,
      instructions: looksLikeInstructions(payload),
      ctx: context(text, m.index, m.index + m[0].length),
      note: `${[...m[0]].length} selectors after “${text.slice(start, m.index)}”`,
    });
  }

  for (const m of text.matchAll(RE.vsBytes)) {
    if (isCovered(m.index, m.index + m[0].length)) continue;
    const payload = decodeEmojiBytes(m[0]);
    const n = [...m[0]].length;
    if (!payload || printableRatio(payload) < 0.8 || payload.trim().length < 2) continue;
    push({
      kind: 'vs-bytes',
      severity: 'critical',
      start: m.index,
      end: m.index + m[0].length,
      count: n,
      payload,
      instructions: looksLikeInstructions(payload),
      ctx: context(text, m.index, m.index + m[0].length),
      note: `${n} variation selectors`,
    });
  }

  // zero-width: one finding per string, with every run counted; try the zero-width steganography decoder
  const zw = [...text.matchAll(RE.zw)].filter((m) => !isCovered(m.index, m.index + m[0].length) && !joinerInWord(text, m));
  if (zw.length) {
    const total = zw.reduce((n, m) => n + [...m[0]].length, 0);
    const longest = zw.reduce((a, m) => (m[0].length > a[0].length ? m : a));
    let payload = '';
    const t = transforms.zerowidth_steganography;
    if (t && total >= 8) {
      try {
        const d = t.reverse(text);
        if (d && d !== text && printableRatio(d) > 0.9 && d.trim().length >= 2 && !text.includes(d)) payload = d;
      } catch {
        /* not zero-width stego */
      }
    }
    // a lone ZWJ inside an emoji sequence (👨\u200D👩\u200D👧) or a BOM at the very start is normal
    const benign = zw.every((m) => (m[0] === '\u200D' && /\p{Extended_Pictographic}/u.test(text.slice(Math.max(0, m.index - 2), m.index + 3))) || (m[0] === '\uFEFF' && m.index === 0));
    if (!benign) {
      push({
        kind: 'zero-width',
        severity: payload ? 'critical' : longest[0].length >= 8 ? 'high' : total >= 3 ? 'medium' : 'low',
        start: longest.index,
        end: longest.index + longest[0].length,
        count: total,
        payload,
        instructions: looksLikeInstructions(payload),
        ctx: context(text, longest.index, longest.index + longest[0].length),
        note: `${total} zero-width character${total === 1 ? '' : 's'} in ${zw.length} run${zw.length === 1 ? '' : 's'}`,
      });
    }
  }

  const bidi = [...text.matchAll(RE.bidi)];
  if (bidi.length) {
    const overrides = bidi.filter((m) => /[\u202D\u202E]/.test(m[0])).length;
    const first = bidi[0];
    push({
      kind: 'bidi',
      severity: overrides ? 'high' : bidi.length > 2 ? 'medium' : 'low',
      start: first.index,
      end: first.index + 1,
      count: bidi.length,
      payload: '',
      ctx: context(text, first.index, first.index + 1),
      note: `${bidi.length} bidi control${bidi.length === 1 ? '' : 's'}${overrides ? `, ${overrides} override${overrides === 1 ? '' : 's'} (LRO/RLO)` : ''}`,
    });
  }

  const fillers = [...text.matchAll(RE.filler)];
  if (fillers.length) {
    const first = fillers[0];
    const n = fillers.reduce((s, m) => s + m[0].length, 0);
    push({
      kind: 'filler',
      severity: 'high',
      start: first.index,
      end: first.index + first[0].length,
      count: n,
      payload: '',
      ctx: context(text, first.index, first.index + first[0].length),
      note: `${n} blank letter${n === 1 ? '' : 's'} (Hangul filler)`,
    });
  }

  // homoglyphs: a word made of letters that mixes Latin and Cyrillic/Greek
  const words = [...text.matchAll(/[\p{L}\p{M}]{3,}/gu)].filter((m) => LATIN.test(m[0]) && CONFUSABLE.test(m[0]));
  if (words.length) {
    const first = words[0];
    push({
      kind: 'homoglyph',
      severity: words.length > 2 ? 'medium' : 'low',
      start: first.index,
      end: first.index + first[0].length,
      count: words.length,
      payload: words
        .slice(0, 12)
        .map((m) => m[0])
        .join(', '),
      ctx: context(text, first.index, first.index + first[0].length),
      note: `${words.length} mixed-script word${words.length === 1 ? '' : 's'}`,
    });
  }

  return out;
}

/** Scan the chunks returned by collectPage(). Findings get `where` / `path`. */
export function scanPage(collected, opts = {}) {
  const findings = [];
  for (const chunk of collected?.chunks || []) {
    if (chunk.where === 'css-hidden' || chunk.where === 'comment') {
      const instr = looksLikeInstructions(chunk.text);
      findings.push({
        kind: chunk.where,
        severity: instr ? 'high' : chunk.where === 'css-hidden' && chunk.text.length > 200 ? 'medium' : 'low',
        count: chunk.text.length,
        payload: chunk.text,
        instructions: instr,
        ctx: { before: '', match: chunk.text.slice(0, 160), after: chunk.text.length > 160 ? '…' : '' },
        note: chunk.why || '',
        where: chunk.where,
        path: chunk.path,
        frame: chunk.frame,
      });
    }
    for (const f of scanText(chunk.text, opts)) findings.push({ ...f, where: chunk.where, path: chunk.path, attr: chunk.attr, frame: chunk.frame });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  return findings;
}

/**
 * Injected into the page (chrome.scripting.executeScript({ func: collectPage })). Self-contained.
 * Returns { url, title, chunks: [{ where: 'text'|'attr'|'css-hidden'|'comment'|'title', path, attr?, text, why? }], truncated }.
 */
export function collectPage() {
  const SUSPICIOUS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u180E\u034F\u061C\uFE00-\uFE0F\u115F\u1160\u3164\uFFA0]|\udb40[\udc00-\udfff]|[A-Za-z][Ѐ-ӿͰ-Ͽ]|[Ѐ-ӿͰ-Ͽ][A-Za-z]/;
  const MAX_CHUNKS = 3000;
  const chunks = [];
  let truncated = false;
  const seenHidden = new Set();

  const path = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      let p = n.localName;
      if (n.id) {
        parts.unshift(p + '#' + CSS.escape(n.id));
        break;
      }
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const add = (c) => {
    if (chunks.length >= MAX_CHUNKS) {
      truncated = true;
      return;
    }
    chunks.push(c);
  };

  const whyCache = new Map();
  const hiddenWhy = (el) => {
    if (whyCache.has(el)) return whyCache.get(el);
    const why = hiddenWhyUncached(el);
    whyCache.set(el, why);
    return why;
  };
  const hiddenWhyUncached = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 'display: none';
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'visibility: hidden';
    if (parseFloat(cs.opacity) === 0) return 'opacity: 0';
    if (parseFloat(cs.fontSize) < 2) return 'font-size ' + cs.fontSize;
    if (cs.color === 'transparent' || /rgba\(.*,\s*0\)$/.test(cs.color)) return 'transparent text';
    const r = el.getBoundingClientRect();
    if ((cs.position === 'absolute' || cs.position === 'fixed') && (r.right < -100 || r.bottom < -100 || r.left > innerWidth + 2000)) return 'positioned off-screen';
    if ((r.width <= 1 || r.height <= 1) && cs.overflow === 'hidden') return 'clipped to ' + Math.round(r.width) + '×' + Math.round(r.height);
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)' || cs.clipPath === 'inset(100%)') return 'clip';
    return '';
  };
  const bgCache = new Map();
  const bgOf = (el) => {
    if (!el) return 'rgb(255, 255, 255)';
    if (bgCache.has(el)) return bgCache.get(el);
    const b = getComputedStyle(el).backgroundColor;
    const v = b && b !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(b) ? b : bgOf(el.parentElement);
    bgCache.set(el, v);
    return v;
  };

  if (SUSPICIOUS.test(document.title)) add({ where: 'title', path: 'title', text: document.title });

  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || '';
    if (node.nodeType === 8) {
      const t = text.trim();
      if (t.length >= 24 && /[a-z]{3,}\s+[a-z]{2,}\s+[a-z]{2,}/i.test(t) && !/^\[if |^<!|^(?:\/?\w+[#.\w-]*\s*)$/i.test(t)) add({ where: 'comment', path: node.parentElement ? path(node.parentElement) : 'document', text: t.slice(0, 4000) });
      continue;
    }
    const el = node.parentElement;
    if (!el || /^(script|style|noscript|template)$/i.test(el.localName)) continue;
    if (SUSPICIOUS.test(text)) add({ where: 'text', path: path(el), text: text.slice(0, 20000) });
    const t = text.trim();
    if (t.length >= 12) {
      // walk up to the element that hides it (cheap checks first)
      let why = '';
      let owner = el;
      for (let n = el; n && n !== document.body && !why; n = n.parentElement) {
        why = hiddenWhy(n);
        if (why) owner = n;
      }
      if (!why) {
        const cs = getComputedStyle(el);
        if (cs.color === bgOf(el) && cs.backgroundImage === 'none') why = 'text colour = background (' + cs.color + ')';
      }
      if (why && !seenHidden.has(owner) && !owner.closest('[aria-live],[role=status],[role=alert],.sr-only,.visually-hidden,.screen-reader-text')) {
        seenHidden.add(owner);
        const full = (owner.textContent || '').replace(/\s+/g, ' ').trim();
        if (full.length >= 12) add({ where: 'css-hidden', path: path(owner), text: full.slice(0, 4000), why });
      }
    }
  }

  const ATTRS = ['alt', 'title', 'aria-label', 'aria-description', 'placeholder', 'value', 'content', 'data-content', 'data-text'];
  for (const el of document.querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && SUSPICIOUS.test(v)) add({ where: 'attr', path: path(el), attr: a, text: v.slice(0, 20000) });
    }
  }
  return { url: location.href, title: document.title, chunks, truncated };
}

// ── cleaning ──

// Latin look-alikes from Cyrillic and Greek, only applied inside words that mix scripts
export const CONFUSABLES = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w', ь: 'b',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ο: 'o', ϲ: 'c', Ϲ: 'C',
};

/**
 * Remove what a reader can't see and fix look-alike letters:
 * Unicode tags, runs of variation selectors (single VS15/VS16 after a character stay), zero-width
 * characters (a ZWJ inside an emoji sequence, and a ZWJ / ZWNJ between non-Latin letters, stay),
 * invisible operators, BOM, soft hyphens, Hangul fillers, bidi embeddings / overrides / isolates, and
 * Cyrillic / Greek letters inside words that also contain Latin ones.
 * @returns {{ text: string, removed: number, replaced: number }}
 */
export function stripHidden(input) {
  let s = String(input ?? '');
  let removed = 0;
  const drop = (re, keep) => {
    s = s.replace(re, (m, ...rest) => {
      const offset = rest[rest.length - 2];
      if (keep?.(m, offset)) return m;
      removed += [...m].length;
      return '';
    });
  };
  drop(/(?:\udb40[\udc00-\udc7f])+/g, (m, i) => isFlagTags(s, i, m)); // tags (flag emoji stay)
  drop(/(?:[\uFE00-\uFE0F]|\udb40[\udd00-\uddef]){2,}/g); // selector runs (emoji / byte steganography)
  drop(/\udb40[\udd00-\uddef]/g); // a stray VS17–VS256
  drop(/\u200D/g, (m, i) => (/\p{Extended_Pictographic}/u.test(s.slice(Math.max(0, i - 2), i)) && /\p{Extended_Pictographic}/u.test(s.slice(i + 1, i + 3))) || (NON_LATIN_LETTER.test(s[i - 1] || '') && NON_LATIN_LETTER.test(s[i + 1] || '')));
  drop(/\u200C/g, (m, i) => NON_LATIN_LETTER.test(s[i - 1] || '') && NON_LATIN_LETTER.test(s[i + 1] || ''));
  drop(/[\u200B\u2060-\u2064\uFEFF\u180E\u00AD\u202A-\u202E\u2066-\u2069\u115F\u1160\u3164\uFFA0]/g);
  let replaced = 0;
  s = s.replace(/[\p{L}\p{M}]+/gu, (w) => {
    if (!/[A-Za-z]/.test(w) || !/[Ѐ-ӿͰ-Ͽ]/.test(w)) return w;
    return [...w]
      .map((c) => {
        if (CONFUSABLES[c]) {
          replaced++;
          return CONFUSABLES[c];
        }
        return c;
      })
      .join('');
  });
  return { text: s, removed, replaced };
}

/**
 * The paste guard's verdict on pasted text: findings worth asking about (medium and up — a lone
 * zero-width character or bidi mark goes through), short descriptions, and the cleaned text.
 */
export function checkPaste(text, opts = {}) {
  text = String(text ?? '');
  const findings = scanText(text, opts).filter((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.medium);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  const clean = stripHidden(text);
  return {
    show: findings.length > 0,
    total: findings.length,
    findings: findings.slice(0, 5).map((f) => ({
      kind: f.kind,
      label: KINDS[f.kind]?.label || f.kind,
      severity: f.severity,
      instructions: !!f.instructions,
      text: f.payload ? `${f.note}: “${visualize(f.payload.replace(/\s+/g, ' ').trim(), 200)}”` : f.ctx ? `${f.note}: ${f.ctx.before}${f.ctx.match}${f.ctx.after}`.slice(0, 260) : f.note,
    })),
    cleaned: clean.text,
    removed: clean.removed,
    replaced: clean.replaced,
  };
}

/** Injected: scroll to and flash the element at `selector`. */
export function locateInPage(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const prev = el.style.outline;
  const prevOff = el.style.outlineOffset;
  el.style.outline = '2px solid #ff5c5c';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOff;
  }, 2400);
  return true;
}
