// Transform registry: wires the transform modules into one keyed table, adds categories,
// option handling and safe encode / decode wrappers. Pure JavaScript: works in extension pages, the
// service worker and Node (tests).

import { TRANSFORM_ENTRIES } from '../transforms/index.js';
import BaseTransformer from '../transforms/BaseTransformer.js';
import { EMOJI_GROUPS, EMOJI_ROWS } from '../data/emoji-data.js';

const g = globalThis;
// The upstream modules read a few browser globals at call time (window.transforms for Random Mix,
// window.emojiData for Emoji Speak, window.EmojiUtils for the combining-mark styles).
if (!g.window) g.window = g;

export const EMOJI = EMOJI_ROWS.map(([emoji, name, group, keywords]) => ({ emoji, name, group: EMOJI_GROUPS[group], keywords }));
export { EMOJI_GROUPS };

const emojiData = {};
for (const e of EMOJI) emojiData[e.emoji] = { official: e.name, keywords: e.keywords.split(' '), category: e.group };
g.window.emojiData = emojiData;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
export function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}
g.window.EmojiUtils = {
  splitEmojis: graphemes,
  joinEmojis: (list) => list.join(''),
  getAllEmojis: () => EMOJI.map((e) => e.emoji),
};

export const CATEGORIES = {
  encoding: { label: 'Encoding', short: 'ENCODE', desc: 'Byte encodings: Base64 family, hex, binary, URL, HTML, uuencode …' },
  cipher: { label: 'Cipher', short: 'CIPHER', desc: 'Classical and keyed ciphers: ROT, Caesar, Vigenère, Playfair, XOR …' },
  concealment: { label: 'Concealment', short: 'HIDDEN', desc: 'Steganography: invisible Unicode tags, zero-width, whitespace, homoglyphs …' },
  unicode: { label: 'Unicode', short: 'UNICODE', desc: 'Unicode styles: bold, fraktur, upside-down, zalgo, combining marks …' },
  symbol: { label: 'Symbol', short: 'SYMBOL', desc: 'Alphabets and scripts: runes, braille, Klingon, Aurebesh, pigpen …' },
  technical: { label: 'Technical', short: 'SIGNAL', desc: 'Signalling codes: Morse, NATO, semaphore, DTMF, T9 …' },
  visual: { label: 'Visual', short: 'VISUAL', desc: 'Word games: leetspeak, Pig Latin, disemvowel, emoji speak …' },
  case: { label: 'Case', short: 'CASE', desc: 'Letter case: camelCase, snake_case, title, alternating, random …' },
  format: { label: 'Format', short: 'FORMAT', desc: 'Text formatting: reverse, shuffle, wrap, strip, deduplicate …' },
  signwriting: { label: 'SignWriting', short: 'SIGN', desc: 'Sign-language fingerspelling and lip-reading notation' },
  special: { label: 'Special', short: 'MIX', desc: 'Random Mix: chains random transforms per word' },
  custom: { label: 'Custom', short: 'CUSTOM', desc: 'Your own spelling alphabets (Alphabets tab)' },
  recipe: { label: 'Recipes', short: 'RECIPE', desc: 'Your saved chains of transforms (Transform tab → Recipe)' },
};
export const CATEGORY_ORDER = Object.keys(CATEGORIES);

/** key → transformer */
export const transforms = {};
for (const [key, category, t] of TRANSFORM_ENTRIES) {
  t.key = key;
  t.category = category;
  transforms[key] = t;
}
g.window.transforms = transforms;

export function list() {
  return Object.values(transforms);
}

export function byName(name) {
  return list().find((t) => t.name === name) || null;
}

export function canDecode(t) {
  return !!(t && t.canDecode !== false && typeof t.reverse === 'function');
}

// ── options (gear) ──

let optionPrefs = {}; // { [transform name]: { [option id]: value } }

export function setOptionPrefs(prefs) {
  optionPrefs = prefs && typeof prefs === 'object' ? prefs : {};
}

export function getOptionPrefs() {
  return optionPrefs;
}

export function defaultOptions(t) {
  const out = {};
  for (const opt of (t && t.configurableOptions) || []) {
    const id = optionId(opt);
    let v = opt.default;
    if (v === undefined || v === null) {
      if (opt.type === 'boolean') v = false;
      else if (opt.type === 'select' && opt.options?.length) v = opt.options[0].value;
      else if (opt.type === 'number') v = 0;
      else v = '';
    }
    out[id] = v;
  }
  return out;
}

/** Upstream options use `id`; one (Base256Emoji) uses `key`. */
export function optionId(opt) {
  return opt.id ?? opt.key;
}

/** Defaults merged with what the user saved for this transform. */
export function optionsFor(t) {
  if (!t?.configurableOptions?.length) return {};
  return { ...defaultOptions(t), ...(optionPrefs[t.name] || {}) };
}

// ── safe wrappers ──

function resolve(t) {
  return typeof t === 'string' ? transforms[t] || byName(t) : t;
}

// Like upstream, options are only passed to transforms that declare them: some take a different
// second parameter (Morse's func(text, decode)).
function args(t, text, opts) {
  return t.configurableOptions?.length ? [String(text ?? ''), opts ?? optionsFor(t)] : [String(text ?? '')];
}

/** Encode `text`. Returns { ok, text, error }. */
export function encode(t, text, opts) {
  t = resolve(t);
  if (!t) return { ok: false, text: '', error: 'Unknown transform' };
  try {
    const out = t.func(...args(t, text, opts));
    return { ok: true, text: out == null ? '' : String(out) };
  } catch (e) {
    return { ok: false, text: '', error: e?.message || String(e) };
  }
}

/** Decode `text` with the transform's reverse. Returns { ok, text, error }. */
export function decode(t, text, opts) {
  t = resolve(t);
  if (!canDecode(t)) return { ok: false, text: '', error: 'This transform has no decoder' };
  try {
    const out = t.reverse(...args(t, text, opts));
    return { ok: true, text: out == null ? '' : String(out) };
  } catch (e) {
    return { ok: false, text: '', error: e?.message || String(e) };
  }
}

// ── custom spelling alphabets ──

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'alphabet';
}

/** A spelling alphabet (one word per letter) as a transformer: "HI" → "Hotel India". */
export function makeSpellingTransform(alpha) {
  const words = {};
  const back = {};
  LETTERS.forEach((L, i) => {
    const w = String(alpha.words?.[i] || L).trim() || L;
    words[L] = w;
    back[w.toLowerCase()] = L;
  });
  return new BaseTransformer({
    name: alpha.name,
    description: alpha.theme ? `Spelling alphabet: ${alpha.theme}` : 'Custom spelling alphabet',
    priority: 40,
    canDecode: true,
    func(text) {
      return text
        .split(/(\s+)/)
        .map((part) => {
          if (/^\s+$/.test(part)) return ' / ';
          return [...part].map((c) => words[c.toUpperCase()] || c).join(' ');
        })
        .join('')
        .replace(/ {2,}/g, ' ')
        .trim();
    },
    reverse(text) {
      return text
        .split(/\s*\/\s*/)
        .map((word) =>
          word
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => back[w.toLowerCase()] || (w.length === 1 ? w : ''))
            .join(''),
        )
        .join(' ');
    },
  });
}

/** Replace all custom alphabets with `alphabets` ([{ name, theme, words[26] }]). */
export function setCustomAlphabets(alphabets) {
  for (const [k, t] of Object.entries(transforms)) if (t.category === 'custom') delete transforms[k];
  for (const a of alphabets || []) {
    if (!a?.name) continue;
    const t = makeSpellingTransform(a);
    t.key = 'custom_' + slug(a.name);
    t.category = 'custom';
    t.custom = true;
    transforms[t.key] = t;
  }
  setRecipes(currentRecipes); // recipes may use the alphabets
}

// ── recipes: saved chains of transforms ──

let currentRecipes = [];

/** Steps of a recipe that exist (recipes can't contain recipes). */
export function recipeSteps(recipe) {
  return (recipe?.steps || []).filter((k) => transforms[k] && transforms[k].category !== 'recipe');
}

/**
 * A recipe ({ name, steps: [transform keys] }) as a transformer: encodes through every step in order
 * (each with the user's saved options) and decodes in reverse order when every step can decode.
 */
export function makeRecipeTransform(recipe) {
  const steps = recipeSteps(recipe);
  return new BaseTransformer({
    name: recipe.name,
    description: 'Recipe: ' + (steps.map((k) => transforms[k].name).join(' → ') || 'empty'),
    priority: 30,
    canDecode: steps.length > 0 && steps.every((k) => canDecode(transforms[k])),
    steps,
    func(text) {
      let s = text;
      for (const k of steps) {
        const r = encode(k, s);
        if (!r.ok) throw new Error(`${transforms[k]?.name || k}: ${r.error}`);
        s = r.text;
      }
      return s;
    },
    reverse(text) {
      let s = text;
      for (const k of [...steps].reverse()) {
        const r = decode(k, s);
        if (!r.ok) throw new Error(`${transforms[k]?.name || k}: ${r.error}`);
        s = r.text;
      }
      return s;
    },
  });
}

/** Replace all recipes with `recipes` ([{ name, steps }]). */
export function setRecipes(recipes) {
  currentRecipes = Array.isArray(recipes) ? recipes : [];
  for (const [k, t] of Object.entries(transforms)) if (t.category === 'recipe') delete transforms[k];
  for (const r of currentRecipes) {
    // a recipe with a missing step (a deleted alphabet) would silently produce something else: skip it
    const steps = recipeSteps(r);
    if (!r?.name || !steps.length || steps.length !== r.steps.length) continue;
    const t = makeRecipeTransform(r);
    t.key = 'recipe_' + slug(r.name);
    t.category = 'recipe';
    t.custom = true;
    transforms[t.key] = t;
  }
}
