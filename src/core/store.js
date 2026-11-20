// Settings and user data in chrome.storage.local (falls back to localStorage outside the extension,
// e.g. when the UI is opened from a dev server for screenshots).

export const DEFAULTS = {
  theme: 'auto', // 'auto' | 'dark' | 'light'
  favorites: ['base64', 'hex', 'binary', 'rot13', 'invisible_text', 'zerowidth_steganography', 'leetspeak', 'upside_down'],
  optionPrefs: {}, // { [transform name]: { [option id]: value } }
  menuTransforms: ['base64', 'hex', 'binary', 'url', 'rot13', 'morse', 'leetspeak', 'upside_down', 'fullwidth', 'zalgo', 'invisible_text', 'zerowidth_steganography'],
  stego: {
    bitZeroVS: '︎',
    bitOneVS: '️',
    initialPresentation: 'emoji',
    trailingZW: '​',
    interBitZW: '',
    interBitEvery: 1,
    bitOrder: 'msb',
  },
  stegoCarrier: '🐍',
  customAlphabets: [], // [{ name, theme, words: [26] }]
  recipes: [], // [{ name, steps: [transform keys] }]
  autoScan: false, // live scan of every page (needs the optional host permission)
  history: [], // [{ text, source, at }]
  historyEnabled: true,
  historyLimit: 100,
  openrouterKey: '',
  models: {
    promptcraft: 'openrouter/auto',
    anticlassifier: 'openrouter/auto',
    translate: 'google/gemma-3-27b-it',
  },
  temperature: 0.9,
  tokenizer: 'o200k_base',
  lastTab: 'transform',
};

export const hasChrome = !!(typeof chrome !== 'undefined' && chrome.storage?.local);
const LS_PREFIX = 'injex:';

export async function get(keys = Object.keys(DEFAULTS)) {
  const list = Array.isArray(keys) ? keys : [keys];
  let raw = {};
  if (hasChrome) raw = await chrome.storage.local.get(list);
  else {
    for (const k of list) {
      try {
        const v = localStorage.getItem(LS_PREFIX + k);
        if (v !== null) raw[k] = JSON.parse(v);
      } catch {
        /* storage unavailable */
      }
    }
  }
  const out = {};
  for (const k of list) out[k] = raw[k] !== undefined ? raw[k] : structuredClone(DEFAULTS[k]);
  return Array.isArray(keys) ? out : out[keys];
}

// outside the extension there is no storage.onChanged: notify listeners in this page ourselves
const localListeners = [];

export async function set(obj) {
  if (hasChrome) return chrome.storage.local.set(obj);
  const changes = {};
  for (const [k, v] of Object.entries(obj)) {
    changes[k] = { newValue: structuredClone(v) };
    try {
      localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }
  for (const fn of localListeners) fn(changes);
}

export function onChange(fn) {
  if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => area === 'local' && fn(changes));
  else localListeners.push(fn);
}

/** Prepend a copied text to the history (deduplicated, capped). */
export async function pushHistory(text, source = '') {
  const { history, historyEnabled, historyLimit } = await get(['history', 'historyEnabled', 'historyLimit']);
  if (!historyEnabled || !text) return;
  const next = [{ text: String(text).slice(0, 200000), source, at: Date.now() }, ...history.filter((h) => h.text !== text)].slice(0, Math.max(1, Number(historyLimit) || 100));
  await set({ history: next });
}
