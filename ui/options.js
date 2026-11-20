// Settings page.

import * as store from '../src/core/store.js';
import { list, CATEGORIES, CATEGORY_ORDER, setCustomAlphabets } from '../src/core/registry.js';
import { STEG_DEFAULTS, CARRIERS, encodeEmojiBits } from '../src/core/stego.js';
import { MODEL_SUGGESTIONS, keyInfo, listModels } from '../src/core/openrouter.js';
import { visualize } from '../src/core/scan.js';
import { $, h, debounce, matcher, twoClick, download } from './lib.js';

const ext = typeof chrome !== 'undefined' && chrome.runtime?.id;
let s = await store.get();
setCustomAlphabets(s.customAlphabets);

let savedTimer;
async function save(partial) {
  Object.assign(s, partial);
  await store.set(partial);
  const el = $('saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// ── appearance ──

applyTheme(s.theme);
for (const r of document.querySelectorAll('input[name="theme"]')) {
  r.checked = r.value === (s.theme || 'auto');
  r.addEventListener('change', () => {
    applyTheme(r.value);
    save({ theme: r.value });
  });
}

// ── AI ──

const key = $('orKey');
key.value = s.openrouterKey || '';
key.addEventListener('input', debounce(() => save({ openrouterKey: key.value.trim() }), 400));
$('orShow').addEventListener('click', () => {
  key.type = key.type === 'password' ? 'text' : 'password';
  $('orShow').textContent = key.type === 'password' ? 'Show' : 'Hide';
});
$('orTest').addEventListener('click', async () => {
  const st = $('orStatus');
  if (!key.value.trim()) return (st.textContent = 'Enter a key first.');
  st.textContent = 'Checking…';
  st.style.color = '';
  try {
    const d = await keyInfo(key.value.trim());
    const usage = d.usage !== undefined ? `$${Number(d.usage).toFixed(2)} used` : '';
    const limit = d.limit === null || d.limit === undefined ? 'no limit' : `limit $${Number(d.limit).toFixed(2)}`;
    st.textContent = `Key works${d.label ? ` (${d.label})` : ''} — ${[usage, limit, d.is_free_tier ? 'free tier' : ''].filter(Boolean).join(' · ')}`;
    st.style.color = 'var(--ok)';
  } catch (e) {
    st.textContent = e.message || String(e);
    st.style.color = 'var(--critical)';
  }
});
for (const [id, name] of MODEL_SUGGESTIONS) $('orModels').append(h('option', { value: id, text: name }));
for (const [id, m] of [
  ['mPromptcraft', 'promptcraft'],
  ['mAnticlassifier', 'anticlassifier'],
  ['mTranslate', 'translate'],
]) {
  $(id).value = s.models?.[m] || '';
  $(id).addEventListener('change', () => {
    const v = $(id).value.trim();
    if (v) save({ models: { ...s.models, [m]: v } });
  });
}
$('temp').value = s.temperature;
$('temp').addEventListener('change', () => {
  const v = Math.max(0, Math.min(2, Number($('temp').value)));
  if (Number.isFinite(v)) save({ temperature: v });
});
$('orLoad').addEventListener('click', async () => {
  const msg = $('orLoadMsg');
  msg.textContent = 'Loading…';
  try {
    const models = await listModels();
    const dl = $('orModels');
    dl.textContent = '';
    for (const m of models) dl.append(h('option', { value: m.id, text: m.name }));
    msg.textContent = `${models.length} models available in the model fields.`;
  } catch (e) {
    msg.textContent = 'Could not load: ' + (e.message || e);
  }
});

// ── steganography ──

const VS = { '︎': 'VS15 (U+FE0E)', '️': 'VS16 (U+FE0F)' };
const ZW = { '': 'None', '​': 'ZWSP (U+200B)', '‌': 'ZWNJ (U+200C)', '‍': 'ZWJ (U+200D)', '⁠': 'Word joiner (U+2060)' };
const STEGO_FIELDS = [
  ['bitZeroVS', 'Bit 0', VS],
  ['bitOneVS', 'Bit 1', VS],
  ['initialPresentation', 'Selector after the carrier', { emoji: 'VS16 (emoji presentation)', text: 'VS15 (text presentation)', none: 'None' }],
  ['bitOrder', 'Bit order', { msb: 'Most significant bit first', lsb: 'Least significant bit first' }],
  ['trailingZW', 'Trailing character', ZW],
  ['interBitZW', 'Padding between bits', ZW],
];

function stegoForm() {
  const f = $('stegoForm');
  f.textContent = '';
  const st = { ...STEG_DEFAULTS, ...s.stego };
  for (const [k, label, opts] of STEGO_FIELDS) {
    f.append(
      h(
        'div',
        { class: 'field' },
        h('label', { text: label }),
        h('select', { onchange: (e) => setStego(k, e.target.value) }, Object.entries(opts).map(([v, l]) => h('option', { value: v, text: l, selected: st[k] === v }))),
      ),
    );
  }
  f.append(h('div', { class: 'field' }, h('label', { text: 'Pad every n bits' }), h('input', { type: 'number', min: 1, max: 64, value: st.interBitEvery, onchange: (e) => setStego('interBitEvery', Math.max(1, Number(e.target.value) || 1)) }), h('small', { text: 'Only with padding between bits' })));
  preview();
}

function setStego(k, v) {
  save({ stego: { ...STEG_DEFAULTS, ...s.stego, [k]: v } });
  preview();
}

function preview() {
  const out = encodeEmojiBits(s.stegoCarrier || '🐍', 'hi', { ...STEG_DEFAULTS, ...s.stego });
  $('stegoPreview').textContent = visualize(out, 2000);
}

function carriers() {
  const box = $('carriers');
  box.textContent = '';
  for (const c of CARRIERS) box.append(h('button', { type: 'button', title: c.name, text: c.emoji, class: c.emoji === s.stegoCarrier ? 'on' : '', onclick: () => setCarrier(c.emoji) }));
  $('carrier').value = s.stegoCarrier || '';
}

function setCarrier(c) {
  if (!c) return;
  save({ stegoCarrier: c });
  carriers();
  preview();
}

$('carrier').addEventListener('change', () => setCarrier($('carrier').value.trim()));
$('stegoReset').addEventListener('click', () => {
  save({ stego: { ...STEG_DEFAULTS }, stegoCarrier: store.DEFAULTS.stegoCarrier });
  stegoForm();
  carriers();
});

// ── context menu ──

function menu() {
  const box = $('menuList');
  box.textContent = '';
  const match = matcher($('menuFilter').value);
  const chosen = new Set(s.menuTransforms || []);
  $('menuCount').textContent = `${chosen.size} selected`;
  for (const cat of CATEGORY_ORDER) {
    const ts = list()
      .filter((t) => t.category === cat && (match(t.name) || match(CATEGORIES[cat].label)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!ts.length) continue;
    box.append(h('div', { class: 'rule-cat' }, CATEGORIES[cat].label));
    box.append(
      h(
        'div',
        { class: 'rule-grid' },
        ts.map((t) =>
          h(
            'label',
            { class: 'rule-item' },
            h('input', {
              type: 'checkbox',
              checked: chosen.has(t.key),
              onchange: (e) => {
                const cur = (s.menuTransforms || []).filter((k) => k !== t.key);
                save({ menuTransforms: e.target.checked ? [...cur, t.key] : cur });
                $('menuCount').textContent = `${(s.menuTransforms || []).length} selected`;
              },
            }),
            h('span', { class: 'name', text: t.name }),
          ),
        ),
      ),
    );
  }
}
$('menuFilter').addEventListener('input', debounce(menu, 100));
$('menuReset').addEventListener('click', () => {
  save({ menuTransforms: [...store.DEFAULTS.menuTransforms] });
  menu();
});
$('menuNone').addEventListener('click', () => {
  save({ menuTransforms: [] });
  menu();
});

// ── history ──

$('histOn').checked = s.historyEnabled;
$('histOn').addEventListener('change', () => save({ historyEnabled: $('histOn').checked }));
$('histLimit').value = s.historyLimit;
$('histLimit').addEventListener('change', async () => {
  const n = Math.max(1, Math.min(1000, Number($('histLimit').value) || 100));
  $('histLimit').value = n;
  const { history } = await store.get(['history']);
  save({ historyLimit: n, history: history.slice(0, n) });
});
function histCount() {
  $('histCount').textContent = `${(s.history || []).length} entries stored`;
}
twoClick($('histClear'), async () => {
  await save({ history: [] });
  histCount();
}, 'Clear all?');

// ── shortcuts ──

async function shortcuts() {
  const dl = $('shortcutList');
  dl.textContent = '';
  const cmds = ext && chrome.commands?.getAll ? await chrome.commands.getAll() : [];
  const label = { _execute_action: 'Open injex', 'decode-selection': 'Decode the selection', 'scan-page': 'Scan the page for hidden text' };
  for (const c of cmds) dl.append(h('dt', { text: label[c.name] || c.description || c.name }), h('dd', { text: c.shortcut || 'not set' }));
  if (!cmds.length) dl.append(h('dt', { text: 'Open injex' }), h('dd', { text: 'Alt+Shift+I' }), h('dt', { text: 'Decode the selection' }), h('dd', { text: 'Alt+Shift+D' }));
}
$('shortcutsBtn').addEventListener('click', () => {
  if (ext) chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ── backup ──

const SKIP = ['history', 'openrouterKey', 'lastTab'];
$('exportBtn').addEventListener('click', async () => {
  const all = await store.get();
  const out = {};
  for (const [k, v] of Object.entries(all)) if ($('exportAll').checked ? k !== 'lastTab' : !SKIP.includes(k)) out[k] = v;
  download(`injex-settings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ injex: 1, settings: out }, null, 2), 'application/json');
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const msg = $('dataMsg');
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const incoming = data?.settings || data;
    const clean = {};
    for (const [k, v] of Object.entries(incoming || {})) if (k in store.DEFAULTS && typeof v === typeof store.DEFAULTS[k]) clean[k] = v;
    if (!Object.keys(clean).length) throw new Error('No injex settings in this file.');
    await save(clean);
    msg.textContent = `Imported ${Object.keys(clean).length} settings.`;
    s = await store.get();
    renderAll();
  } catch (err) {
    msg.textContent = 'Import failed: ' + (err.message || err);
  }
  e.target.value = '';
});
twoClick($('resetAll'), async () => {
  if (ext) await chrome.storage.local.clear();
  else for (const k of Object.keys(store.DEFAULTS)) localStorage.removeItem('injex:' + k);
  s = await store.get();
  renderAll();
  $('dataMsg').textContent = 'Everything reset to defaults.';
}, 'Reset everything?');

// ── about ──

const version = ext ? chrome.runtime.getManifest().version : 'dev';
$('aboutText').textContent = `injex ${version} — a prompt-injection text toolkit. ${list().length} transforms, all local.`;
if (ext) $('openDash').href = chrome.runtime.getURL('ui/app.html?full=1');

function renderAll() {
  applyTheme(s.theme);
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === (s.theme || 'auto');
  key.value = s.openrouterKey || '';
  $('mPromptcraft').value = s.models?.promptcraft || '';
  $('mAnticlassifier').value = s.models?.anticlassifier || '';
  $('mTranslate').value = s.models?.translate || '';
  $('temp').value = s.temperature;
  $('histOn').checked = s.historyEnabled;
  $('histLimit').value = s.historyLimit;
  setCustomAlphabets(s.customAlphabets);
  stegoForm();
  carriers();
  menu();
  histCount();
}

store.onChange((changes) => {
  for (const [k, v] of Object.entries(changes)) s[k] = v.newValue;
  if (changes.history) histCount();
  if (changes.customAlphabets) {
    setCustomAlphabets(s.customAlphabets);
    menu();
  }
});

renderAll();
shortcuts();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
