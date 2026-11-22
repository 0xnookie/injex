// Settings and user data in chrome.storage.local (falls back to localStorage outside the extension,
// e.g. when the UI is opened from a dev server for screenshots).

import { PASTE_SITES } from './sites.js';

export const DEFAULTS = {
  theme: 'auto', // 'auto' | 'dark' | 'light'
  favorites: ['base64', 'hex', 'binary', 'rot13', 'invisible_text', 'zerowidth_steganography', 'leetspeak', 'upside_down'],
  optionPrefs: {}, // { [transform name]: { [option id]: value } }
  menuTransforms: ['base64', 'hex', 'binary', 'url', 'rot13', 'morse', 'leetspeak', 'upside_down', 'fullwidth', 'zalgo', 'invisible_text', 'zerowidth_steganography'],
  stego: {
    bitZeroVS: '\uFE0E',
    bitOneVS: '\uFE0F',
    initialPresentation: 'emoji',
    trailingZW: '\u200B',
    interBitZW: '',
    interBitEvery: 1,
    bitOrder: 'msb',
  },
  stegoCarrier: '🐍',
  customAlphabets: [], // [{ name, theme, words: [26] }]
  recipes: [], // [{ name, steps: [transform keys] }]
  autoScan: false, // live scan of every page (needs the optional host permission)
  liveMode: 'all', // 'all': every site except liveSites · 'only': just liveSites
  liveSites: [], // host patterns (core/sites.js)
  pasteGuard: false, // check pastes into AI chats for hidden text (needs permission for pasteSites)
  pasteSites: [...PASTE_SITES],
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
  tokenizer: 'o200k_base', // or 'hf': the tokenizer.json in IndexedDB (getFile('tokenizer.json'))
  hfTokenizer: '', // file name of that tokenizer.json
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

// ── large files the person loads (a tokenizer.json is 2–20 MB, past chrome.storage.local's quota) ──
// IndexedDB of the extension origin; where it is unavailable (private windows, tests) only for this page.

const memFiles = new Map();

function openFiles() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const r = indexedDB.open('injex', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function filesTx(mode, fn) {
  const db = await openFiles();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getFile(key) {
  try {
    return (await filesTx('readonly', (s) => s.get(key))) ?? memFiles.get(key);
  } catch {
    return memFiles.get(key);
  }
}

/** Resolves false when the file is kept for this page only (IndexedDB unavailable or full). */
export async function putFile(key, value) {
  memFiles.set(key, value);
  try {
    await filesTx('readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(key) {
  memFiles.delete(key);
  try {
    await filesTx('readwrite', (s) => s.delete(key));
  } catch {
    /* nothing stored */
  }
}
