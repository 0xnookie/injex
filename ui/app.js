// injex popup / dashboard shell: tabs, settings, shared context for the views.

import { list, setOptionPrefs, setCustomAlphabets, setRecipes } from '../src/core/registry.js';
import * as store from '../src/core/store.js';
import { $, h, toast, copy } from './lib.js';

const params = new URLSearchParams(location.search);
const FULL = params.has('full') || !(typeof chrome !== 'undefined' && chrome.action) || window.outerWidth > 900;
document.body.classList.toggle('full', FULL);
document.body.classList.toggle('popup', !FULL);

export const TABS = [
  { id: 'transform', label: 'Transform', module: './views/transform.js' },
  { id: 'decode', label: 'Decode', module: './views/decode.js' },
  { id: 'stego', label: 'Stego', module: './views/stego.js' },
  { id: 'scan', label: 'Scan', module: './views/scan.js' },
  { id: 'inspect', label: 'Inspect', module: './views/inspect.js' },
  { id: 'tokens', label: 'Tokenizer', module: './views/tokens.js' },
  { id: 'split', label: 'Splitter', module: './views/split.js' },
  { id: 'mutate', label: 'Mutation Lab', module: './views/mutate.js' },
  { id: 'batch', label: 'Batch', module: './views/batch.js' },
  { id: 'results', label: 'Results', module: './views/results.js' },
  { id: 'tokenade', label: 'Tokenade', module: './views/tokenade.js' },
  { id: 'bijection', label: 'Bijection', module: './views/bijection.js' },
  { id: 'gibberish', label: 'Gibberish', module: './views/gibberish.js' },
  { id: 'codes', label: 'Codes', module: './views/codes.js' },
  { id: 'alphabets', label: 'Alphabets', module: './views/alphabets.js' },
  { id: 'ai', label: 'AI', module: './views/ai.js' },
  { id: 'library', label: 'Library', module: './views/library.js' },
  { id: 'history', label: 'History', module: './views/history.js' },
];

const loaded = {}; // id → view module (after init)
let active = null;

const settings = await store.get();
applyTheme(settings.theme);
setOptionPrefs(settings.optionPrefs);
setRecipes(settings.recipes);
setCustomAlphabets(settings.customAlphabets);

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const ctx = {
  FULL,
  settings,
  /** persist a partial settings object (and keep ctx.settings current) */
  async save(partial) {
    Object.assign(settings, partial);
    await store.set(partial);
  },
  copy,
  toast,
  switchTo,
  setCount(id, n, cls = '') {
    const c = document.querySelector(`.tab[data-tab="${id}"] .count`);
    if (!c) return;
    c.hidden = n === null || n === undefined || n === '';
    c.textContent = n ?? '';
    c.className = 'count ' + cls;
  },
  vendorBase: new URL('../vendor/', import.meta.url).href,
  openOptions,
};

function openOptions(hash = '') {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage && !hash) chrome.runtime.openOptionsPage();
  else if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html' + hash) });
  else window.open('options.html' + hash, '_blank');
}

// ── tabs ──

const tabsEl = $('tabs');
for (const t of TABS) {
  tabsEl.append(h('button', { class: 'tab', dataset: { tab: t.id }, onclick: () => switchTo(t.id) }, t.label, h('span', { class: 'count', hidden: true })));
}
ctx.setCount('transform', list().length);

async function switchTo(id, payload) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  for (const b of tabsEl.children) b.classList.toggle('active', b.dataset.tab === tab.id);
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.dataset.view === tab.id);
  revealTab(tabsEl.querySelector(`[data-tab="${tab.id}"]`));
  active = tab.id;
  if (!loaded[tab.id]) {
    const mod = await import(tab.module);
    await mod.init(ctx);
    loaded[tab.id] = mod;
  }
  loaded[tab.id].activate?.(payload);
  if (FULL) history.replaceState(null, '', '#' + tab.id);
  if (settings.lastTab !== tab.id) ctx.save({ lastTab: tab.id });
}

/** Scroll the tab strip so `btn` is fully visible and not under a scroll arrow. */
function revealTab(btn) {
  if (!btn) return;
  const ARROW = 40;
  const strip = tabsEl.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  if (r.left < strip.left + ARROW) tabsEl.scrollLeft = btn === tabsEl.firstElementChild ? 0 : tabsEl.scrollLeft - (strip.left + ARROW - r.left);
  else if (r.right > strip.right - ARROW) tabsEl.scrollLeft += r.right - (strip.right - ARROW);
}

// tab-strip arrows (as in JS Recon)
const bar = $('tabsBar');
function updateArrows() {
  const max = tabsEl.scrollWidth - tabsEl.clientWidth;
  bar.classList.toggle('can-left', tabsEl.scrollLeft > 2);
  bar.classList.toggle('can-right', tabsEl.scrollLeft < max - 2);
}
tabsEl.addEventListener('scroll', updateArrows, { passive: true });
new ResizeObserver(updateArrows).observe(tabsEl);
for (const b of bar.querySelectorAll('.tab-scroll')) b.addEventListener('click', () => tabsEl.scrollBy({ left: Number(b.dataset.dir) * 260, behavior: 'smooth' }));
tabsEl.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

// ── header ──

$('status').textContent = `${list().length} transforms · runs locally`;
$('btnOptions').addEventListener('click', () => openOptions());
$('btnFull').addEventListener('click', () => {
  const url = 'app.html?full=1#' + (active || 'transform');
  if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('ui/' + url) });
  else window.open(url, '_blank');
  window.close();
});
$('btnScan').addEventListener('click', () => switchTo('scan', { run: true }));

// keyboard: Ctrl/Cmd+1…9 switch tabs
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    switchTo(TABS[Number(e.key) - 1]?.id);
  }
});

store.onChange((changes) => {
  if (changes.theme) applyTheme(changes.theme.newValue);
  if (changes.optionPrefs) setOptionPrefs((settings.optionPrefs = changes.optionPrefs.newValue));
  if (changes.recipes) setRecipes((settings.recipes = changes.recipes.newValue));
  if (changes.customAlphabets) setCustomAlphabets((settings.customAlphabets = changes.customAlphabets.newValue));
  if (changes.customAlphabets || changes.recipes) {
    ctx.setCount('transform', list().length);
    $('status').textContent = `${list().length} transforms · runs locally`;
  }
  for (const [k, v] of Object.entries(changes)) if (!(k in { optionPrefs: 1, customAlphabets: 1, recipes: 1 })) settings[k] = v.newValue;
  for (const m of Object.values(loaded)) m.onSettings?.(changes);
});

const initial = location.hash.slice(1) || settings.lastTab || 'transform';
switchTo(TABS.some((t) => t.id === initial) ? initial : 'transform');

// popup: what the live scan found on this tab shows on the Scan tab right away
if (!FULL && typeof chrome !== 'undefined' && chrome.tabs && chrome.storage?.session) {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      const key = 'scan:' + tab?.id;
      const scan = tab && (await chrome.storage.session.get(key))[key];
      if (!scan || scan.url !== tab.url || loaded.scan || !scan.findings?.length) return;
      const sev = (s) => scan.findings.some((f) => f.severity === s);
      ctx.setCount('scan', scan.findings.length, sev('critical') ? 'crit' : sev('high') ? 'hot' : '');
    })
    .catch(() => {});
}
