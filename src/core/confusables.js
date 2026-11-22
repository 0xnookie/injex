// Look-alike letters from Unicode's confusables data (UTS #39, generated into src/data/confusables.js):
// which characters a reader takes for an ASCII letter or digit, the "skeleton" of a text (what it reads
// as), and the spoofing checks the scanner runs — words that mix Latin with look-alikes from another
// script, and words spelled entirely in look-alikes inside Latin text.

import { CONFUSABLES_DATA } from '../data/confusables.js';

const MAP = new Map();
for (const e of CONFUSABLES_DATA.split(' ')) MAP.set(parseInt(e.slice(0, -1), 16), e.slice(-1));

const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;

/** The ASCII letter or digit `ch` looks like, or ''. ASCII characters map to nothing. */
export function lookalike(ch) {
  return MAP.get(ch.codePointAt(0)) || '';
}

/** Number of characters in the table. */
export const lookalikeCount = MAP.size;

/**
 * What `s` reads as: compatibility forms folded (NFKC: fullwidth, mathematical, ligatures), then every
 * look-alike replaced by the ASCII letter it imitates. Invisible characters are not removed here.
 */
export function skeleton(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFKC')) out += MAP.get(ch.codePointAt(0)) || ch;
  return out;
}

/**
 * A word that is a spoof: it mixes Latin letters with look-alikes from another script ("paypal" with a
 * Cyrillic a), or — when `latinContext` — every letter is a non-Latin look-alike (a Cyrillic-only
 * "scope" in English text).
 * Returns 'mixed', 'whole' or ''.
 */
export function spoofKind(word, { latinContext = false } = {}) {
  let latin = 0;
  let foreignLookalike = 0;
  let foreignOther = 0;
  for (const ch of word) {
    if (!LETTER.test(ch)) continue;
    if (LATIN.test(ch)) latin++;
    else if (MAP.has(ch.codePointAt(0))) foreignLookalike++;
    else foreignOther++;
  }
  if (latin && foreignLookalike) return 'mixed';
  if (latinContext && !latin && !foreignOther && foreignLookalike >= 3) return 'whole';
  return '';
}

/** Share of letters in `s` that are Latin (0–1), and the letter count. */
export function latinShare(s) {
  let letters = 0;
  let latin = 0;
  for (const ch of String(s ?? '')) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (LATIN.test(ch)) latin++;
  }
  return { share: letters ? latin / letters : 0, letters };
}

// ── digits: a number written with digits from more than one numbering system ──

const MATH_DIGITS = [0x1d7ce, 0x1d7ff];
const ND = /\p{Nd}/u;
function digitZero(cp) {
  if (cp >= MATH_DIGITS[0] && cp <= MATH_DIGITS[1]) return MATH_DIGITS[0] + 10 * Math.floor((cp - MATH_DIGITS[0]) / 10);
  const z = cp - (cp % 16);
  return cp - z <= 9 && ND.test(String.fromCodePoint(z)) ? z : z + 6;
}

/** Numbers (digit runs) in `s` that mix numbering systems: [{ index, text }]. */
export function mixedDigitRuns(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(/\p{Nd}{2,}/gu)) {
    const zeros = new Set([...m[0]].map((c) => digitZero(c.codePointAt(0))));
    if (zeros.size > 1) out.push({ index: m.index, text: m[0] });
  }
  return out;
}
