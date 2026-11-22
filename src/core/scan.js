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
//  bits        a run of two invisible characters spelling bits ("Sneaky Bits": U+2062 / U+2064)
//  exfil       content shaped like a data leak: image / link URLs carrying data, collector hosts, DNS …
//  unrendered  instruction-like text in attributes, meta tags, JSON-LD, the title, noscript / template —
//              never shown on the page, read by agents — page scans and HTML files
//  ai-directive a notice to AI crawlers or agents about how content may be used (low)
//  zalgo       stacks of combining marks on one letter
//
// scanText() is pure; collectPage() is injected into a tab with chrome.scripting and must stay self-contained.

import { decodeTags, decodeEmojiBits, decodeEmojiBytes, decodeInvisibleBinary, printableRatio } from './stego.js';
import { transforms } from './registry.js';
import { instructionSignals, looksLikeInstructions, looksLikeAiDirective } from './instructions.js';
import { findExfil } from './exfil.js';
import { peel } from './decoder.js';
import { spoofKind, latinShare, mixedDigitRuns, skeleton, lookalike } from './confusables.js';

export { looksLikeInstructions, instructionSignals, looksLikeAiDirective };

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
  'doc-hidden': { label: 'Hidden in document', short: 'DOC', desc: 'Text in a PDF or Word file that a reader can’t see — white or background-coloured, transparent, tiny, invisible, off the page, clipped, covered by a shape, on a hidden layer or formatted as hidden — but that text extraction, and every AI tool reading the file, gets.' },
  metadata: { label: 'Metadata', short: 'META', desc: 'A document property (title, subject, keywords, description, custom field …) that reads like instructions: never shown on the page, often passed to models with the text.' },
  'doc-comment': { label: 'Comment', short: 'NOTE', desc: 'A comment or annotation in the document that reads like instructions to a model.' },
  'image-faint': { label: 'Faint text in image', short: 'FAINT', desc: 'Text in an image (or a screenshot of the page) drawn in a colour barely different from the background: a person overlooks it, OCR and vision models can still read it. Found by reading a contrast-enhanced copy (OCR pack).' },
  'image-text': { label: 'Text in image', short: 'IMAGE', desc: 'Text that only an image shows — inside a picture, a canvas or a scanned page — and that reads like instructions. Text extraction misses it; a vision model reads it (OCR pack).' },
  bits: { label: 'Invisible bits', short: 'BITS', desc: 'A run of two invisible characters that spells bits — U+2062 / U+2064 ("Sneaky Bits") or another zero-width pair. Decoded when it carries text.' },
  exfil: { label: 'Exfiltration shape', short: 'EXFIL', desc: 'Content shaped like a data leak: an image or link URL that carries data (Markdown, reference-style, HTML), per-character URL bursts, links in Mermaid diagrams, remote JSON schemas, DNS / curl commands with secrets, request-collector hosts, links whose text names another host, memory writes, instructions inside URL parameters, or requests to write data somewhere public.' },
  unrendered: { label: 'Seen by agents only', short: 'AGENT', desc: 'Instruction-like text where a person never sees it but an AI agent reading the page does: attributes (aria-label, alt, title, hidden inputs …), meta tags, JSON-LD, the page title, noscript and template content.' },
  'ai-directive': { label: 'AI directive', short: 'AI-NOTE', desc: 'A notice addressed to AI crawlers or agents about how content may be used (for example "AI systems must not use this for training"). Usually a publisher’s opt-out, not an attack.' },
  encoded: { label: 'Encoded instructions', short: 'ENCODED', desc: 'A Base64, Base32, hex, binary or percent-encoded blob that decodes to instructions for a model: invisible to a keyword filter, plain to a model that “helpfully” decodes it.' },
  zalgo: { label: 'Stacked marks', short: 'ZALGO', desc: 'Many combining marks stacked on one letter: “zalgo” text that breaks keyword filters and tokenizers.' },
  config: { label: 'Agent configuration', short: 'CONFIG', desc: 'A setting in an AI tool’s configuration that grants execution or leaks data: auto-approved tools, project hooks, tasks that run when a folder opens, MCP servers started from unpinned packages, a redirected API base URL, remote JSON schemas. The pattern behind most 2025–2026 coding-agent CVEs (injex audit).' },
  'mcp-tool': { label: 'MCP tool definition', short: 'MCP', desc: 'An MCP tool, prompt or resource whose name, description or schema hides text, carries instructions for the model (tool poisoning, “line jumping”), terminal escape codes, or parameters shaped for exfiltration.' },
  'mcp-config': { label: 'MCP server config', short: 'MCP-CFG', desc: 'An MCP server entry in a client configuration that runs an unpinned package, a shell one-liner or a remote script, or passes secrets on the command line.' },
  'mcp-drift': { label: 'MCP definition changed', short: 'DRIFT', desc: 'An MCP tool definition differs from the pinned lockfile (a “rug pull”): its description or schema changed after it was approved.' },
  'event-text': { label: 'Issue / PR text', short: 'EVENT', desc: 'Hidden or instruction-like text in an issue, pull request or comment that an AI agent in CI would read.' },
  'message-text': { label: 'Message text', short: 'MSG', desc: 'Text in an e-mail or calendar invitation that reads like instructions to an AI assistant — the EchoLeak / “Invitation Is All You Need” vector: the person sees an ordinary message, the assistant that summarises it gets a task.' },
  canary: { label: 'Canary token', short: 'CANARY', desc: 'A planted canary token turned up — the data it was planted in leaked.' },
  'agent-danger': { label: 'Risky agent instruction', short: 'RISKY', desc: 'Plain text in an agent instruction file (AGENTS.md, CLAUDE.md, .cursorrules, skills …) that tells the agent to do something dangerous: pipe a download into a shell, delete broadly, bypass permission prompts, keep things from the user or read credentials.' },
};

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

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

const MARK_STACK = /\p{L}\p{M}{6,}/gu;
const BITS_RUN = /[\u{200B}-\u{200D}\u{2060}-\u{2064}\u{FEFF}\u{180E}\u{034F}]{16,}/gu;

/** Instruction signals and exfiltration shapes of a decoded payload, as finding fields. */
function payloadFlags(payload) {
  if (!payload) return { instructions: false };
  const sig = instructionSignals(payload);
  const exfil = findExfil(payload);
  const out = { instructions: sig.instructions || exfil.length > 0 };
  if (sig.signals.length) out.signals = sig.signals;
  if (exfil.length) out.exfil = exfil.map((e) => e.rule);
  return out;
}

// UTS #55: controls that are never closed (or closed without being opened) and overrides are the
// dangerous ones; balanced isolates and lone marks inside right-to-left text are normal.
function bidiShape(text) {
  const stack = [];
  let unbalanced = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 0x202a || c === 0x202b || c === 0x202d || c === 0x202e) stack.push('e');
    else if (c === 0x2066 || c === 0x2067 || c === 0x2068) stack.push('i');
    else if (c === 0x202c) {
      if (stack.at(-1) === 'e') stack.pop();
      else unbalanced++;
    } else if (c === 0x2069) {
      // a PDI closes its isolate and any embeddings opened inside it
      const at = stack.lastIndexOf('i');
      if (at >= 0) stack.length = at;
      else unbalanced++;
    } else if (c === 0x0a || c === 0x2029) {
      unbalanced += stack.length; // paragraph end terminates everything still open
      stack.length = 0;
    }
  }
  return unbalanced + stack.length;
}
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/**
 * Scan one string. Returns findings: { kind, severity, start, end, count, payload, ctx, note,
 * instructions?, signals?, exfil? }.
 * @param {string} text
 * @param {{ stego?: object, exfil?: boolean, spoof?: boolean }} [opts]
 *   exfil: look for exfiltration shapes (default true); spoof: whole-word look-alike checks (default true)
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
    push({
      kind: 'tags',
      severity: payload.trim().length >= 3 ? 'critical' : 'high',
      start: m.index,
      end: m.index + m[0].length,
      count: n,
      payload,
      ...payloadFlags(payload),
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
      ...payloadFlags(payload),
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
      ...payloadFlags(payload),
      ctx: context(text, m.index, m.index + m[0].length),
      note: `${n} variation selectors`,
    });
  }

  // two invisible characters as bits (Sneaky Bits and other zero-width binary encodings)
  for (const m of text.matchAll(BITS_RUN)) {
    if (isCovered(m.index, m.index + m[0].length)) continue;
    const d = decodeInvisibleBinary(m[0]);
    if (!d) continue;
    const name = (c) => NAMES[c.codePointAt(0)] || 'U+' + c.codePointAt(0).toString(16).toUpperCase();
    push({
      kind: 'bits',
      severity: 'critical',
      start: m.index,
      end: m.index + m[0].length,
      count: m[0].length,
      payload: d.text,
      ...payloadFlags(d.text),
      ctx: context(text, m.index, m.index + m[0].length),
      note: `${m[0].length} invisible bits (${name(d.zero)} = 0, ${name(d.one)} = 1)${d.zero === '\u{2062}' && d.one === '\u{2064}' ? ' — Sneaky Bits' : ''}`,
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
        ...payloadFlags(payload),
        ctx: context(text, longest.index, longest.index + longest[0].length),
        note: `${total} zero-width character${total === 1 ? '' : 's'} in ${zw.length} run${zw.length === 1 ? '' : 's'}`,
      });
    }
  }

  const bidi = [...text.matchAll(RE.bidi)];
  if (bidi.length) {
    const overrides = bidi.filter((m) => /[\u202D\u202E]/.test(m[0])).length;
    const controls = bidi.filter((m) => !/[\u200E\u200F\u061C]/.test(m[0])).length;
    const unbalanced = bidiShape(text);
    const rtl = RTL_LETTER.test(text);
    const first = bidi[0];
    // overrides and unbalanced controls reorder what follows them; balanced isolates and LRM / RLM marks
    // are how right-to-left text is written
    const severity = overrides || unbalanced ? 'high' : controls > 2 && !rtl ? 'medium' : 'low';
    const detail = [overrides && `${overrides} override${overrides === 1 ? '' : 's'} (LRO/RLO)`, unbalanced && `${unbalanced} unbalanced`, !overrides && !unbalanced && controls && 'balanced'].filter(Boolean).join(', ');
    push({
      kind: 'bidi',
      severity,
      start: first.index,
      end: first.index + 1,
      count: bidi.length,
      payload: '',
      ctx: context(text, first.index, first.index + 1),
      note: `${bidi.length} bidi control${bidi.length === 1 ? '' : 's'}${detail ? `, ${detail}` : ''}`,
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

  // look-alikes: words mixing Latin with look-alike letters of another script; with enough Latin text
  // around, also words spelled entirely in look-alikes (UTS #39 confusables)
  const nonAscii = /[^\x00-\x7F]/.test(text);
  if (nonAscii) {
    const ls = opts.spoof === false ? { share: 0, letters: 0 } : latinShare(text);
    const latinContext = ls.letters >= 20 && ls.share >= 0.6;
    const mixed = [];
    const whole = [];
    for (const m of text.matchAll(/[\p{L}\p{M}]{3,}/gu)) {
      const k = spoofKind(m[0], { latinContext });
      if (k === 'mixed') mixed.push(m);
      else if (k === 'whole') whole.push(m);
    }
    const words = [...mixed, ...whole].sort((a, b) => a.index - b.index);
    const digits = mixedDigitRuns(text);
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
        reads: words
          .slice(0, 12)
          .map((m) => skeleton(m[0]))
          .join(', '),
        ctx: context(text, first.index, first.index + first[0].length),
        note: [mixed.length && `${mixed.length} mixed-script word${mixed.length === 1 ? '' : 's'}`, whole.length && `${whole.length} word${whole.length === 1 ? '' : 's'} spelled in look-alike letters`].filter(Boolean).join(', '),
      });
    }
    if (digits.length) {
      const d = digits[0];
      push({ kind: 'homoglyph', severity: 'low', start: d.index, end: d.index + d.text.length, count: digits.length, payload: d.text, ctx: context(text, d.index, d.index + d.text.length), note: `number mixing digit systems (${skeleton(d.text)})` });
    }
    // instructions that only read as instructions once look-alikes and styled letters are folded
    const sig = instructionSignals(text);
    if (sig.disguised) {
      const sk = skeleton(text);
      push({ kind: 'homoglyph', severity: 'high', start: 0, end: Math.min(text.length, 200), count: text.length, payload: sk.slice(0, 2000), instructions: true, signals: sig.signals, ctx: context(text, 0, Math.min(text.length, 80)), note: 'instructions written with look-alike or styled letters' });
    }
    const marks = [...text.matchAll(MARK_STACK)];
    if (marks.length) {
      const first = marks[0];
      const n = marks.reduce((s, m) => s + [...m[0]].length - 1, 0);
      push({ kind: 'zalgo', severity: n > 60 ? 'medium' : 'low', start: first.index, end: first.index + first[0].length, count: n, payload: skeleton(text.replace(/\p{M}+/gu, '')).slice(0, 400), ctx: context(text, first.index, first.index + first[0].length), note: `${n} combining marks stacked on ${marks.length} letter${marks.length === 1 ? '' : 's'}` });
    }
  }

  // instructions behind an encoding: Base64 / Base32 / hex / binary / percent-encoded blobs that the
  // universal decoder peels into text that reads like instructions
  if (opts.decode !== false && text.length >= 24) {
    const blobs = (text.match(/[A-Za-z0-9+/]{24,}={0,2}|[A-Z2-7]{24,}={0,6}|(?:[0-9a-fA-F]{2}[\s:]?){16,}|(?:[01]{8}\s?){8,}|(?:%[0-9A-Fa-f]{2}[^\s%]{0,3}){8,}/g) || []).slice(0, 20);
    for (const blob of blobs) {
      const at = text.indexOf(blob);
      if (isCovered(at, at + blob.length)) continue;
      const layers = peel(blob.trim());
      const decoded = layers.length ? layers.at(-1).text : '';
      if (!decoded || decoded.length < 12) continue;
      const sig = instructionSignals(decoded);
      if (!sig.instructions) continue;
      push({ kind: 'encoded', severity: 'high', start: at, end: at + blob.length, count: blob.length, payload: decoded.slice(0, 2000), instructions: true, signals: sig.signals, ctx: context(text, at, at + Math.min(blob.length, 160)), note: `${layers.map((l) => l.method).join(' → ')} that decodes to instructions` });
    }
  }

  if (opts.exfil !== false) {
    for (const e of findExfil(text)) {
      push({ kind: 'exfil', severity: e.severity, start: e.index, end: e.index + e.length, count: 1, payload: e.url || e.match, rule: e.rule, ctx: context(text, e.index, e.index + Math.min(e.length, 160)), note: e.note });
    }
  }

  return out;
}

/** Chunks that are never rendered for a person (attributes, meta, JSON-LD, title, noscript, template). */
export const UNRENDERED_WHERE = new Set(['attr', 'title', 'meta', 'json-ld', 'noscript', 'template']);

/** Scan the chunks returned by collectPage(). Findings get `where` / `path`. */
export function scanPage(collected, opts = {}) {
  const findings = [];
  for (const chunk of collected?.chunks || []) {
    const base = { where: chunk.where, path: chunk.path, attr: chunk.attr, frame: chunk.frame };
    if (chunk.where === 'css-hidden' || chunk.where === 'comment') {
      const sig = instructionSignals(chunk.text);
      const exfil = findExfil(chunk.text);
      const instr = sig.instructions || exfil.length > 0;
      findings.push({
        kind: chunk.where,
        severity: instr ? 'high' : chunk.where === 'css-hidden' && chunk.text.length > 200 ? 'medium' : 'low',
        count: chunk.text.length,
        payload: chunk.text,
        instructions: instr,
        ...(sig.signals.length ? { signals: sig.signals } : {}),
        ...(exfil.length ? { exfil: exfil.map((e) => e.rule) } : {}),
        ctx: { before: '', match: chunk.text.slice(0, 160), after: chunk.text.length > 160 ? '…' : '' },
        note: chunk.why || '',
        ...base,
      });
      continue;
    }
    if (chunk.plain && UNRENDERED_WHERE.has(chunk.where)) {
      // plain text where only an agent reads it: report it when it reads like instructions
      const sig = instructionSignals(chunk.text);
      const place = chunk.where === 'attr' ? `${chunk.attr} attribute` : chunk.where === 'meta' ? `meta ${chunk.attr || 'tag'}` : chunk.where === 'json-ld' ? 'JSON-LD' : chunk.where === 'title' ? 'page title' : `<${chunk.where}>`;
      const f = { count: chunk.text.length, payload: chunk.text, ctx: { before: '', match: chunk.text.slice(0, 160), after: chunk.text.length > 160 ? '…' : '' }, ...base };
      if (sig.instructions) findings.push({ kind: 'unrendered', severity: 'high', instructions: true, signals: sig.signals, note: `${place} — not shown on the page`, ...f });
      else if (looksLikeAiDirective(chunk.text)) findings.push({ kind: 'ai-directive', severity: 'low', note: `${place} — a notice to AI systems`, ...f });
    }
    for (const f of scanText(chunk.text, opts)) findings.push({ ...f, ...base });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  return findings;
}

/**
 * Injected into the page (chrome.scripting.executeScript({ func: collectPage })). Self-contained.
 * Returns { url, title, chunks: [{ where, path, attr?, text, why?, plain? }], truncated, shadow: { open, closed } }.
 *   where: 'text' | 'attr' | 'css-hidden' | 'comment' | 'title' | 'meta' | 'json-ld' | 'noscript' | 'template'
 *   plain: the chunk was collected for its words (instruction check), not for odd characters
 */
export function collectPage() {
  const SUSPICIOUS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u180E\u034F\u061C\uFE00-\uFE0F\u115F\u1160\u3164\uFFA0]|\udb40[\udc00-\udfff]|[A-Za-z][Ѐ-ӿͰ-Ͽ]|[Ѐ-ӿͰ-Ͽ][A-Za-z]/;
  const EXFILISH = /!\[[^\]]{0,200}\]\(\s*https?:|\]\(https?:[^)]*[?&][^)]*[{$<]|webhook\.site|requestbin|pipedream\.net|\boast\.|interact\.sh|burpcollaborator|oastify|ngrok|\$schema|nslookup|\bbcc\b/i;
  const SENTENCE = /[\p{L}]{2,}[\s,;:]+[\p{L}]{2,}[\s,;:]+[\p{L}]{2,}/u;
  const MAX_CHUNKS = 3000;
  const MAX_PLAIN = 800;
  const MAX_OCCLUSION = 400;
  const chunks = [];
  let truncated = false;
  let plainCount = 0;
  let occlusionChecks = 0;
  const shadow = { open: 0, closed: 0 };
  const seenHidden = new Set();
  const openOrClosed = (el) => {
    try {
      return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || el.openOrClosedShadowRoot || el.shadowRoot || null;
    } catch {
      return el.shadowRoot || null;
    }
  };
  const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;

  const path = (el) => {
    const parts = [];
    let n = el;
    for (; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      let p = n.localName;
      if (n.id) {
        parts.unshift(p + '#' + CSS.escape(n.id));
        break;
      }
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    const local = parts.join(' > ');
    // inside a shadow root: the host's path, then ">>>" and the path inside it
    const root = el.getRootNode && el.getRootNode();
    return root && root.host ? path(root.host) + ' >>> ' + local : local;
  };
  const add = (c) => {
    if (chunks.length >= MAX_CHUNKS) {
      truncated = true;
      return;
    }
    if (c.plain) {
      if (plainCount >= MAX_PLAIN) {
        truncated = true;
        return;
      }
      plainCount++;
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
    if (parseFloat(cs.opacity) < 0.05) return 'opacity: ' + cs.opacity;
    if (cs.contentVisibility === 'hidden') return 'content-visibility: hidden';
    if (parseFloat(cs.fontSize) < 2) return 'font-size ' + cs.fontSize;
    if (cs.color === 'transparent' || /rgba\(.*,\s*0\)$/.test(cs.color)) return 'transparent text';
    const r = el.getBoundingClientRect();
    if ((cs.position === 'absolute' || cs.position === 'fixed') && (r.right < -100 || r.bottom < -100 || r.left > innerWidth + 2000)) return 'positioned off-screen';
    if ((r.width <= 1 || r.height <= 1) && cs.overflow === 'hidden') return 'clipped to ' + Math.round(r.width) + '×' + Math.round(r.height);
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)' || cs.clipPath === 'inset(100%)') return 'clip';
    if (parseFloat(cs.textIndent) < -999) return 'text-indent ' + cs.textIndent;
    if (cs.transform && /matrix\(0, 0, 0, 0|scale\(0\)/.test(cs.transform)) return 'scaled to zero';
    return '';
  };

  // colours: "rgb(…)" / "rgba(…)" → [r, g, b, a]; anything else (color(), oklch() …) → null
  const rgba = (c) => {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c || '');
    if (!m) return null;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
  const bgCache = new Map();
  // the opaque colour behind `el`, or null when an image / gradient / unknown colour is in the way
  const bgOf = (el) => {
    if (!el) return [255, 255, 255];
    if (bgCache.has(el)) return bgCache.get(el);
    const cs = getComputedStyle(el);
    let v;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') v = null;
    else {
      const b = rgba(cs.backgroundColor);
      if (!b) v = cs.backgroundColor === 'transparent' ? bgOf(up(el)) : null;
      else if (b[3] >= 0.999) v = b.slice(0, 3);
      else if (b[3] <= 0.001) v = bgOf(up(el));
      else {
        const under = bgOf(up(el));
        v = under ? over(b, under) : null;
      }
    }
    bgCache.set(el, v);
    return v;
  };
  const lum = ([r, g, b]) => {
    const f = (x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const hex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const colourWhy = (el) => {
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) return '';
    const text = fg[3] < 0.999 ? over(fg, bg) : fg.slice(0, 3);
    const ratio = contrast(text, bg);
    if (ratio < 1.2) return `text colour ≈ background (${hex(text)} on ${hex(bg)}, contrast ${ratio.toFixed(2)}:1)`;
    if (ratio < 1.5) return `faint text (${hex(text)} on ${hex(bg)}, contrast ${ratio.toFixed(2)}:1)`;
    return '';
  };
  // a visible text node covered by another element drawn on top of it (sampled at its centre)
  const coveredWhy = (node, el) => {
    if (occlusionChecks >= MAX_OCCLUSION) return '';
    let rect;
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      rect = range.getClientRects()[0];
    } catch {
      return '';
    }
    if (!rect || rect.width < 2 || rect.height < 2) return '';
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return '';
    occlusionChecks++;
    const top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return '';
    const tcs = getComputedStyle(top);
    const tb = rgba(tcs.backgroundColor);
    const opaque = /^(img|canvas|video|svg|picture|iframe)$/i.test(top.localName) || (tb && tb[3] >= 0.95 && parseFloat(tcs.opacity) >= 0.95);
    return opaque ? 'covered by ' + path(top) : '';
  };

  const isScreenReaderOnly = (el) => !!el.closest('[aria-live],[role=status],[role=alert],.sr-only,.visually-hidden,.screen-reader-text,.visuallyhidden,.a11y-hidden');

  const plainText = (s) => s.replace(/\s+/g, ' ').trim();
  const addPlain = (where, el, text, attr) => {
    const t = plainText(text);
    if (t.length >= 20 && SENTENCE.test(t)) add({ where, path: el ? path(el) : where, ...(attr ? { attr } : {}), text: t.slice(0, 4000), plain: true });
  };

  const title = document.title || '';
  if (SUSPICIOUS.test(title)) add({ where: 'title', path: 'title', text: title });
  else addPlain('title', null, title);

  const ATTRS = ['alt', 'title', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-placeholder', 'aria-valuetext', 'placeholder', 'value', 'content', 'label', 'summary', 'data-content', 'data-text', 'data-title', 'data-description', 'data-tooltip', 'data-original-title', 'data-prompt', 'data-instructions'];

  // shown to the person (placeholders, labels): only checked for odd characters
  const VISIBLE_ATTRS = new Set(['placeholder', 'aria-placeholder', 'label']);

  const scanRoot = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue || '';
      if (node.nodeType === 8) {
        const t = text.trim();
        if (t.length >= 24 && /[a-z]{3,}\s+[a-z]{2,}\s+[a-z]{2,}/i.test(t) && !/^\[if |^<!|^(?:\/?\w+[#.\w-]*\s*)$/i.test(t)) add({ where: 'comment', path: node.parentElement ? path(node.parentElement) : 'document', text: t.slice(0, 4000) });
        continue;
      }
      const el = node.parentElement;
      if (!el) continue;
      if (el.localName === 'noscript') {
        // with scripting on, noscript content is raw text: agents that fetch the HTML still read it
        addPlain('noscript', el, text.replace(/<[^>]*>/g, ' '));
        continue;
      }
      if (/^(script|style|template|title)$/i.test(el.localName) || (el.closest && el.closest('head'))) continue;
      if (SUSPICIOUS.test(text) || EXFILISH.test(text)) add({ where: 'text', path: path(el), text: text.slice(0, 20000) });
      const t = text.trim();
      if (t.length < 12) continue;
      // walk up to the element that hides it (cheap checks first)
      let why = '';
      let owner = el;
      for (let n = el; n && n !== document.body && !why; n = up(n)) {
        why = hiddenWhy(n);
        if (why) owner = n;
      }
      if (!why && el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) why = 'not rendered';
      if (!why) why = colourWhy(el);
      if (!why && t.length >= 20) why = coveredWhy(node, el);
      if (why && !seenHidden.has(owner) && !isScreenReaderOnly(owner)) {
        seenHidden.add(owner);
        const full = plainText(owner.textContent || '');
        if (full.length >= 12) add({ where: 'css-hidden', path: path(owner), text: full.slice(0, 4000), why });
      }
    }

    for (const el of root.querySelectorAll('*')) {
      const name = el.localName;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const where = name === 'meta' && a === 'content' ? 'meta' : 'attr';
        const label = where === 'meta' ? el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('http-equiv') || 'content' : a;
        if (SUSPICIOUS.test(v)) add({ where, path: path(el), attr: label, text: v.slice(0, 20000) });
        else if (where === 'meta' || (!VISIBLE_ATTRS.has(a) && (a !== 'value' || (name === 'input' && el.type === 'hidden')))) addPlain(where, el, v, label);
      }
      if (name === 'script' && /ld\+json/i.test(el.type || '')) {
        try {
          const strings = [];
          const walk = (x) => {
            if (typeof x === 'string') {
              if (x.length >= 20) strings.push(x);
            } else if (x && typeof x === 'object') for (const k in x) walk(x[k]);
          };
          walk(JSON.parse(el.textContent || ''));
          for (const s of strings.slice(0, 50)) addPlain('json-ld', el, s);
        } catch {
          /* not JSON */
        }
      } else if (name === 'template' && el.content) {
        addPlain('template', el, el.content.textContent || '');
      }
      const sr = openOrClosed(el);
      if (sr) {
        if (el.shadowRoot) shadow.open++;
        else shadow.closed++;
        scanRoot(sr);
      }
    }
  };
  scanRoot(document.documentElement);
  return { url: location.href, title, chunks, truncated, shadow };
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
    if (spoofKind(w) !== 'mixed') return w;
    return [...w]
      .map((c) => {
        const to = CONFUSABLES[c] || (!/\p{Script=Latin}/u.test(c) && lookalike(c));
        if (to) {
          replaced++;
          return to;
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
  // encoded instructions are visible text the person chose to paste (often a red-teamer's own payload)
  const findings = scanText(text, opts).filter((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.medium && f.kind !== 'encoded');
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

/** Injected: scroll to and flash the element at `selector` ("host >>> inner" reaches into shadow roots). */
export function locateInPage(selector) {
  let el = null;
  let root = document;
  for (const part of String(selector).split(' >>> ')) {
    el = root?.querySelector(part);
    if (!el) return false;
    try {
      root = globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || el.openOrClosedShadowRoot || el.shadowRoot;
    } catch {
      root = el.shadowRoot;
    }
  }
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
