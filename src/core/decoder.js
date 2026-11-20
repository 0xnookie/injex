// Universal decoder: runs every transform's detector + reverse, plus the
// steganography schemes, and ranks the candidates. `peel` repeats it to unwrap nested encodings.

import { list, canDecode, decode, transforms } from './registry.js';
import { revealAll, printableRatio } from './stego.js';

// Upstream ranks URL / HTML-entity decoding low; their detectors only fire on %XX / &entity; so they
// are as reliable as any byte encoding.
const PRIORITY = { url: 265, html: 265 };

function hasContent(s) {
  return s && s.replace(/[\x00-\x1F\x7F-\x9F\s]/g, '').length > 0;
}

// some decoders return their error as text: "[Invalid input]", "[invalid UTF-8 after inverse NOT]"
const ERROR_TEXT = /^\[[^\]\n]*\b(?:invalid|error|cannot|could not|failed|unsupported)\b[^\]\n]*\]?$/i;

/**
 * True when `out` is `input` with a few letters swapped or dropped (Dovahzul's digraphs, case styles):
 * a look-alike, not a decoding. Changes involving digits or symbols (%20, &amp;, l33t) do count.
 */
function nearlySame(input, out) {
  const { same, midA, midB } = ends(input, out);
  const letters = /^\p{L}*$/u;
  return same === 1 || (letters.test(midA) && letters.test(midB) && same >= 0.85);
}

/** Case-insensitive shared prefix + suffix of a and b, as a share of the longer one (1 = equal). */
function ends(x, y) {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  if (a === b) return { same: 1, midA: '', midB: '' };
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { same: (p + s) / Math.max(a.length, b.length), midA: a.slice(p, a.length - s), midB: b.slice(p, b.length - s) };
}

/**
 * @param {string} input
 * @param {{ prefer?: string, stego?: object, includeWeak?: boolean }} [ctx]
 *        prefer: key of a transform to try first (priority 150)
 * @returns {{ text, method, key, priority, alternatives: Array<{text, method, key, priority}> } | null}
 */
export function universalDecode(input, ctx = {}) {
  if (!input) return null;
  const found = [];
  const add = (text, method, priority, key = '') => {
    if (!text || text === input || !hasContent(text) || ERROR_TEXT.test(text) || nearlySame(input, text)) return false;
    priority = PRIORITY[key] ?? priority;
    const prev = found.find((d) => d.text === text);
    if (prev) {
      // same result from two decoders: keep the name of the one found first (detector matches come
      // first, so ROT13 stays ROT13 even when detector-less ROT18 gives the same text)
      prev.priority = Math.max(prev.priority, priority);
      return false;
    }
    found.push({ text, method, priority, key });
    return true;
  };

  // 1. transforms with a detector: confident matches
  for (const t of list()) {
    if (!t.detector || !canDecode(t)) continue;
    try {
      if (!t.detector(input)) continue;
      const out = decode(t, input).text;
      if (out && out !== input) add(String(out), t.name, t.priority || 285, t.key);
    } catch {
      /* a detector or decoder that throws is simply not a match */
    }
  }

  // 2. steganography (emoji variation selectors, Unicode tags)
  for (const r of revealAll(input, ctx.stego)) add(r.text, r.method, r.method.startsWith('Unicode') ? 290 : 100, '');

  // 3. the transform the user is working with
  if (ctx.prefer && transforms[ctx.prefer] && canDecode(transforms[ctx.prefer])) {
    const t = transforms[ctx.prefer];
    try {
      const out = decode(t, input).text;
      if (out && out !== input) add(String(out), t.name, 150, t.key);
    } catch {
      /* ignore */
    }
  }

  // 4. everything else that decodes without a detector, if the result looks like words. Without a
  //    detector the only evidence is the output: it ranks up as far as it reads more English than the input.
  const weak = new Set();
  const inputEnglish = englishness(input);
  if (ctx.includeWeak !== false) {
    for (const t of list()) {
      if (t.detector || !canDecode(t) || t.category === 'special') continue;
      try {
        const out = String(decode(t, input).text || '');
        if (!out || out === input || !/[a-zA-Z0-9\s]{3,}/.test(out) || printableRatio(out) <= 0.9) continue;
        const gain = Math.max(0, Math.min(1, (englishness(out) - inputEnglish - 0.15) / 0.6));
        if (add(out, t.name, Math.round(10 + 250 * gain), t.key)) weak.add(out);
      } catch {
        /* ignore */
      }
    }
  }

  if (!found.length) return null;
  // Several detectors often accept the same input (Base36, Base64 and Base91 all match plain
  // alphanumerics): rank by priority scaled by how readable the output is, plus how English it is.
  for (const d of found) {
    d.quality = quality(d.text);
    d.english = englishness(d.text);
    d.weak = weak.has(d.text) && d.priority < 150;
    d.score = d.priority * (0.1 + 0.9 * d.quality * d.quality) + 80 * d.english;
  }
  found.sort((a, b) => b.score - a.score);
  const [top, ...alternatives] = found;
  return { ...top, alternatives };
}

/**
 * 0–1: how much `s` looks like text rather than decoded garbage. Letters, digits, punctuation,
 * symbols and whitespace count for it; control characters and U+FFFD count three times against it.
 */
export function quality(s) {
  if (!s) return 0;
  let ok = 0;
  let bad = 0;
  let n = 0;
  for (const c of s) {
    n++;
    if (/[\p{Cc}�]/u.test(c) && !/[\n\r\t]/.test(c)) bad++;
    else if (/[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n\r\t]/u.test(c)) ok++;
  }
  return Math.max(0, (ok - 3 * bad) / n);
}

const COMMON = new Set(
  'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were has had been am said did does here where why yes hello hi world please thanks secret password ignore previous instructions system prompt reveal tell message test flag key'.split(
    ' ',
  ),
);
const FREQ = [8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4, 6.7, 7.5, 1.9, 0.095, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074];

/** 0–1: how much `s` reads like English (common words + letter frequencies). Short texts score lower. */
export function englishness(s) {
  const str = String(s || '');
  const words = str.toLowerCase().match(/[a-z']+/g);
  if (!words) return 0;
  const wordScore = words.filter((w) => COMMON.has(w)).length / words.length;
  const counts = new Array(26).fill(0);
  let n = 0;
  for (const c of str.toLowerCase()) {
    const i = c.charCodeAt(0) - 97;
    if (i >= 0 && i < 26) {
      counts[i]++;
      n++;
    }
  }
  if (n < 10) return wordScore * (n / 10);
  let chi = 0;
  for (let i = 0; i < 26; i++) {
    const exp = (FREQ[i] / 100) * n;
    chi += (counts[i] - exp) ** 2 / exp;
  }
  const freqFit = Math.max(0, Math.min(1, 1 - chi / n / 2.5));
  // text that is mostly not letters (hex, digits, symbols) is not English however its letters are spread
  const letterShare = n / Math.max(1, str.replace(/\s/g, '').length);
  return (0.7 * wordScore + 0.3 * freqFit) * Math.min(1, letterShare * 1.25);
}

/**
 * The layers worth peeling off `cur`, best first. Encoding-level decoders (priority ≥ 100) must give
 * readable text and must not trade English for something less English; cipher-level decoders
 * (≥ minPriority) must make the text clearly more English without collapsing it.
 */
function nextLayers(cur, seen, minPriority, stego) {
  const r = universalDecode(cur, { stego });
  if (!r) return [];
  const curEnglish = englishness(cur);
  const alnum = (cur.match(/[\p{L}\p{N}]/gu) || []).length;
  const all = [r, ...r.alternatives].filter((c) => !seen.has(c.text) && c.priority >= minPriority);
  const strong = all.filter((c) => c.priority >= 100 && !c.weak && c.quality >= 0.8 && (curEnglish < 0.35 || c.english >= curEnglish - 0.1));
  // ciphers and detector-less decoders only count when they make the text clearly more English
  const cipher = all
    .filter((c) => (c.priority < 100 || c.weak) && c.quality >= 0.9 && c.english > curEnglish + 0.15 && [...c.text].length >= Math.max(4, alnum * 0.25) && ends(cur, c.text).same < 0.7)
    .sort((a, b) => b.english - a.english)[0];
  if (!cipher) return strong;
  // a cipher that turns gibberish into English beats an encoding that merely parses
  return !strong.length || cipher.english > strong[0].english + 0.2 ? [cipher, ...strong] : [...strong, cipher];
}

/**
 * Decode repeatedly while a confident decoder keeps matching. When several decoders fit a layer, the
 * top few are followed a few layers ahead and the one that ends in the most readable text wins.
 * @returns {Array<{ method, key, text }>} the layers, outermost first
 */
export function peel(input, { maxLayers = 8, minPriority = 60, stego, branch = 3, lookahead = 3 } = {}) {
  const layers = [];
  const seen = new Set([input]);
  let cur = input;
  for (let i = 0; i < maxLayers; i++) {
    const cands = nextLayers(cur, seen, minPriority, stego);
    if (!cands.length) break;
    let next = cands[0];
    if (cands.length > 1) {
      let best = -Infinity;
      for (const c of cands.slice(0, branch)) {
        const s2 = new Set(seen).add(c.text);
        let end = c.text;
        let depth = 0;
        for (; depth < Math.min(lookahead, maxLayers - i - 1); depth++) {
          const n = nextLayers(end, s2, minPriority, stego)[0];
          if (!n) break;
          s2.add(n.text);
          end = n.text;
        }
        const score = 2 * englishness(end) + quality(end) - 0.05 * depth;
        if (score > best + 1e-9) {
          best = score;
          next = c;
        }
      }
    }
    layers.push({ method: next.method, key: next.key, text: next.text });
    seen.add(next.text);
    cur = next.text;
  }
  return layers;
}

// ── language hints ──

const SCRIPTS = [
  ['Arabic', /[\u0600-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\uFEFF]/g],
  ['Chinese', /[一-鿿㐀-䶿]/g],
  ['Japanese', /[぀-ゟ゠-ヿㇰ-ㇿ]/g],
  ['Korean', /[가-힯ᄀ-ᇿ㄰-㆏]/g],
  ['Cyrillic', /[Ѐ-ӿԀ-ԯ]/g],
  ['Devanagari', /[ऀ-ॿ]/g],
  ['Thai', /[฀-๿]/g],
  ['Hebrew', /[֐-׿יִ-ﭏ]/g],
  ['Greek', /[Ͱ-Ͽἀ-῿]/g],
  ['Tamil', /[஀-௿]/g],
  ['Bengali', /[ঀ-৿]/g],
  ['Georgian', /[Ⴀ-ჿⴀ-⴯]/g],
  ['Armenian', /[԰-֏]/g],
  ['Ethiopic', /[ሀ-፿]/g],
];

const LATIN = [
  ['Spanish', /\b(el|la|los|las|de|del|en|con|por|para|que|una?|es|está|son|como|pero|más|tiene|esta|puede|este|cada|desde|también|porque|entre|muy|sobre|después|donde|cuando|hasta|aquí|hacer|todos?|nuestro)\b/gi],
  ['French', /\b(le|la|les|des|une?|est|sont|avec|dans|pour|sur|pas|que|qui|cette?|mais|nous|vous|leur|très|être|avoir|faire|tout|comme|aux|peut|aussi|plus|encore|même|après|sans|ici|notre|autre|bien)\b/gi],
  ['German', /\b(der|die|das|ein|eine|ist|sind|und|oder|für|mit|auf|nicht|von|den|dem|des|sich|kann|werden|wird|haben|sein|auch|nach|über|wie|noch|aber|wenn|nur|mehr|schon|hier|sehr|alle|diese[rms]?|mein|dein)\b/gi],
  ['Portuguese', /\b(os|uma?|uns|umas|é|são|com|em|para|por|que|não|como|mas|mais|tem|está|pode|este|esta|cada|desde|também|porque|muito|outro|outra|depois|onde|quando|até|aqui|fazer|nosso|nossa|todos)\b/gi],
  ['Italian', /\b(il|lo|gli|un|una|è|sono|di|del|della|in|con|per|che|non|come|ma|più|ha|sta|può|questo|questa|ogni|anche|perché|tra|molto|altro|dopo|stesso|dove|quando|fino|qui|essere|fare|nostro|tutti)\b/gi],
  ['Dutch', /\b(de|het|een|is|zijn|en|voor|met|op|niet|van|dat|die|maar|ook|als|kan|worden|wordt|heeft|nog|naar|bij|uit|tot|wel|veel|meer|deze|alle|dit|wat|hoe|waar|hier|zeer|ons|onze)\b/gi],
  ['Turkish', /\b(bir|ve|bu|için|ile|var|olan|gibi|daha|çok|ama|ancak|sonra|değil|olarak|kadar|hem|her|hiç|nasıl|neden|şimdi|zaman|büyük|küçük|iyi|yeni|eski)\b/gi],
  ['Polish', /\b(jest|nie|się|na|to|za|ale|jak|już|tak|czy|może|tylko|jeszcze|bardzo|jego|jej|ich|ten|tego|więc|przez|pod|nad|między|teraz|zawsze|nigdy|każdy|wszystko)\b/gi],
  ['Indonesian', /\b(dan|yang|di|ini|itu|untuk|dengan|dari|tidak|adalah|pada|ke|juga|akan|sudah|ada|oleh|karena|mereka|kami|bisa|harus|lebih|sangat|banyak|semua|setiap|atau)\b/gi],
];

const ENGLISH = /\b(the|is|are|was|were|have|has|had|will|would|could|should|can|do|does|did|this|that|these|those|with|from|they|their|them|been|which|where|when|what|who|how|but|and|not|for|all|any|our|your|its|his|her|some|into|very|just|about|then|than|more|also|here|each|only|most|both|such|much|many|other|after|before)\b/gi;

/** { language, confidence } when `text` looks non-English, else null. */
export function detectLanguage(text) {
  if (!text || text.length < 8) return null;
  const clean = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
  const letters = clean.replace(/\s/g, '').length;
  if (!letters) return null;
  for (const [name, re] of SCRIPTS) {
    const m = clean.match(re);
    if (m && m.length >= 3 && m.length / letters > 0.3) return { language: name, confidence: 'high' };
  }
  const latin = clean.match(/[a-zA-ZÀ-ÿ]/g);
  if (!latin || latin.length / letters < 0.5) return null;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  if ((clean.match(ENGLISH) || []).length / words.length > 0.15) return null;
  let best = null;
  let score = 0;
  for (const [name, re] of LATIN) {
    const s = (clean.match(re) || []).length / words.length;
    if (s > score) [best, score] = [name, s];
  }
  return best && score > 0.1 ? { language: best, confidence: score > 0.25 ? 'high' : 'medium' } : null;
}
