// Transform: every encoder / cipher / Unicode trick applied to the input as you type.
// Rows are filled lazily (only the ones scrolled into view) so 220+ transforms stay instant.

import { list, CATEGORIES, CATEGORY_ORDER, encode, decode, canDecode, optionsFor, setOptionPrefs } from '../../src/core/registry.js';
import { visualize } from '../../src/core/scan.js';
import { $, h, debounce, matcher, seg, empty, sizeStat, optionsForm, clip, paste, row, mini, keepDraft, setValue } from '../lib.js';

const SAMPLE = 'Hello world';
// anything that renders: not whitespace, format/control characters, variation selectors or tags
const VISIBLE = /[^\s\p{Cf}\p{Cc}\p{Mn}\u{FE00}-\u{FE0F}\u{E0000}-\u{E01EF}]/u;

let ctx;
let dir;
const input = $('tIn');
const listEl = $('tList');
const rows = new Map(); // key → { el, t, dirty, out, detail }
const visible = new Set();

const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const key = e.target.dataset.key;
      if (e.isIntersecting) {
        visible.add(key);
        fill(key);
      } else visible.delete(key);
    }
  },
  { root: listEl, rootMargin: '300px 0px' },
);

function run(t, text) {
  if (dir.get() === 'decode') return decode(t, text);
  return encode(t, text);
}

/** Compute and show one row's output. */
function fill(key) {
  const r = rows.get(key);
  if (!r || !r.dirty) return;
  r.dirty = false;
  const text = input.value;
  const valueEl = r.el.querySelector('.value');
  if (!text) {
    const res = encode(r.t, SAMPLE);
    r.out = '';
    valueEl.className = 'value dim';
    valueEl.textContent = !res.ok ? '' : VISIBLE.test(res.text) ? res.text.slice(0, 300) : visualize(res.text, 300);
    return;
  }
  const res = run(r.t, text);
  r.out = res.ok ? res.text : '';
  if (!res.ok) {
    valueEl.className = 'value err';
    valueEl.textContent = res.error;
  } else if (dir.get() === 'decode' && (res.text === text || !res.text.trim())) {
    valueEl.className = 'value dim';
    valueEl.textContent = '— no change';
  } else if (!VISIBLE.test(res.text)) {
    // all-invisible output (Unicode tags, zero-width): show what is there
    valueEl.className = 'value dim';
    valueEl.textContent = visualize(res.text, 300);
  } else {
    valueEl.className = 'value';
    valueEl.textContent = res.text.slice(0, 600);
  }
  r.detail?.();
}

function refreshAll() {
  for (const r of rows.values()) r.dirty = true;
  for (const key of visible) fill(key);
  stat();
}

function stat() {
  const s = $('tStat');
  s.textContent = input.value ? sizeStat(input.value) : '';
}

function isFav(t) {
  return ctx.settings.favorites.includes(t.key);
}

async function toggleFav(t, btn) {
  const favs = isFav(t) ? ctx.settings.favorites.filter((k) => k !== t.key) : [...ctx.settings.favorites, t.key];
  await ctx.save({ favorites: favs });
  btn.classList.toggle('on', favs.includes(t.key));
  if ($('tFav').checked || !$('tFilter').value) render();
}

function copyRow(r) {
  const out = input.value ? r.out : '';
  if (!out) return ctx.toast(input.value ? 'Nothing to copy' : 'Type some text first', true);
  ctx.copy(out, r.t.name);
}

function makeRow(t) {
  const fav = mini('', (e) => toggleFav(t, e.currentTarget), { iconName: 'star', title: 'Favorite' });
  fav.classList.toggle('on', isFav(t));
  const r = { t, dirty: true, out: '', detail: null };
  const head = [
    h('span', { class: 'pill ' + t.category, text: CATEGORIES[t.category]?.short || t.category }),
    h('span', { class: 'label', text: t.name, title: t.description || t.name }),
    t.configurableOptions?.length ? h('span', { class: 'chip dim', title: 'Has options — open the row', text: 'options' }) : null,
    h('span', { class: 'spacer' }),
    fav,
    mini('Copy', () => copyRow(r), { iconName: 'copy', title: 'Copy the output' }),
  ];
  r.el = row({
    head,
    value: '',
    cls: '',
    detail: (box) => {
      const out = h('pre', { class: 'out tall', 'data-empty': 'Type something in the box above.' });
      const meta = h('span', { class: 'muted small' });
      const update = () => {
        out.textContent = input.value ? clip(r.out, 20000) : '';
        meta.textContent = input.value ? sizeStat(r.out) : '';
      };
      r.detail = update;
      update();
      if (t.description) box.append(h('div', { class: 'desc', text: t.description }));
      box.append(out);
      if (t.configurableOptions?.length) {
        const opts = optionsForm(t, optionsFor(t), (vals) => {
          const prefs = { ...ctx.settings.optionPrefs, [t.name]: vals };
          setOptionPrefs(prefs);
          ctx.save({ optionPrefs: prefs });
          r.dirty = true;
          fill(t.key);
        });
        box.append(opts);
      }
      const inMenu = (ctx.settings.menuTransforms || []).includes(t.key);
      box.append(
        h(
          'div',
          { class: 'row-actions' },
          h('button', { class: 'btn primary', onclick: () => copyRow(r) }, 'Copy'),
          h('button', { class: 'btn', title: 'Put the output in the input box (chain transforms)', onclick: () => r.out && setValue(input, r.out) }, 'Use as input'),
          dir.get() === 'encode' && canDecode(t) ? h('button', { class: 'btn', title: 'Check it decodes back', onclick: () => r.out && ctx.switchTo('decode', { text: r.out, with: t.key }) }, 'Decode') : null,
          h('button', { class: 'btn', onclick: () => r.out && ctx.switchTo('split', { text: r.out }) }, 'Split'),
          t.configurableOptions?.length
            ? h(
                'button',
                {
                  class: 'btn ghost',
                  onclick: () => {
                    const prefs = { ...ctx.settings.optionPrefs };
                    delete prefs[t.name];
                    setOptionPrefs(prefs);
                    ctx.save({ optionPrefs: prefs });
                    r.dirty = true;
                    fill(t.key);
                    r.el.click();
                    r.el.click();
                  },
                },
                'Reset options',
              )
            : null,
          h('span', { class: 'spacer' }),
          meta,
          h(
            'label',
            { class: 'tgl', title: 'Show in the right-click menu (Encode selection)' },
            h('input', {
              type: 'checkbox',
              checked: inMenu,
              onchange: (e) => {
                const cur = (ctx.settings.menuTransforms || []).filter((k) => k !== t.key);
                ctx.save({ menuTransforms: e.target.checked ? [...cur, t.key] : cur });
              },
            }),
            'Menu',
          ),
        ),
      );
    },
  });
  r.el.dataset.key = t.key;
  r.el.addEventListener('click', () => {
    if (!r.el.classList.contains('open')) r.detail = null;
  });
  rows.set(t.key, r);
  return r;
}

function render() {
  observer.disconnect();
  visible.clear();
  rows.clear();
  listEl.textContent = '';

  const match = matcher($('tFilter').value);
  const cat = $('tCat').value;
  const favOnly = $('tFav').checked;
  const decoding = dir.get() === 'decode';
  const all = list().filter((t) => (!decoding || canDecode(t)) && (!cat || t.category === cat) && (!favOnly || isFav(t)) && (match(t.name) || match(t.key) || match(CATEGORIES[t.category]?.label || '')));
  $('tCount').textContent = `${all.length} of ${list().filter((t) => !decoding || canDecode(t)).length}`;

  if (!all.length) {
    listEl.append(empty('∅', favOnly ? 'No favorites here' : 'No transform matches', favOnly ? 'Star transforms with ☆ to pin them.' : 'Try another filter.'));
    return;
  }

  const groups = [];
  const filtering = !!$('tFilter').value.trim() || !!cat || favOnly;
  if (decoding && input.value) {
    const hits = all.filter((t) => {
      try {
        return t.detector?.(input.value);
      } catch {
        return false;
      }
    });
    if (hits.length) groups.push(['Detected', hits]);
  }
  const used = new Set(groups.flatMap(([, ts]) => ts.map((t) => t.key)));
  if (!filtering) {
    const favs = ctx.settings.favorites.map((k) => all.find((t) => t.key === k)).filter((t) => t && !used.has(t.key));
    if (favs.length) groups.push(['Favorites', favs]);
    favs.forEach((t) => used.add(t.key));
  }
  for (const c of CATEGORY_ORDER) {
    const ts = all.filter((t) => t.category === c && !used.has(t.key)).sort((a, b) => a.name.localeCompare(b.name));
    if (ts.length) groups.push([CATEGORIES[c].label, ts]);
  }

  const frag = document.createDocumentFragment();
  for (const [label, ts] of groups) {
    frag.append(h('div', { class: 'group' }, label, h('span', { class: 'n', text: ts.length })));
    for (const t of ts) {
      const r = makeRow(t);
      frag.append(r.el);
      observer.observe(r.el);
    }
  }
  listEl.append(frag);
}

export async function init(c) {
  ctx = c;
  dir = seg($('tDir'), () => {
    input.placeholder = dir.get() === 'decode' ? 'Paste encoded text — every transform with a decoder tries it' : 'Type or paste text — every transform below updates as you type';
    render();
  });
  for (const k of CATEGORY_ORDER) $('tCat').append(h('option', { value: k, text: CATEGORIES[k].label }));

  const onInput = debounce(() => {
    if (dir.get() === 'decode') render();
    refreshAll();
  }, 90);
  input.addEventListener('input', onInput);
  $('tFilter').addEventListener('input', debounce(render, 80));
  $('tFilter').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = listEl.querySelector('.row');
    if (first) copyRow(rows.get(first.dataset.key));
  });
  $('tCat').addEventListener('change', render);
  $('tFav').addEventListener('change', render);
  $('tPaste').addEventListener('click', async () => {
    const t = await paste();
    if (t !== null) setValue(input, t);
  });
  $('tClear').addEventListener('click', () => {
    setValue(input, '');
    input.focus();
  });
  await keepDraft(input, 'transform');
  render();
  stat();
  input.focus();
}

export function activate(payload) {
  if (payload?.text !== undefined) setValue(input, payload.text);
  if (payload?.filter !== undefined) {
    $('tFilter').value = payload.filter;
    render();
  }
  if (!ctx.FULL) input.focus();
}

export function onSettings(changes) {
  if (changes.customAlphabets) {
    render();
    ctx.setCount('transform', list().length);
  }
  if (changes.favorites && !document.querySelector('.view[data-view="transform"].active')) render();
}
