// Small DOM helpers shared by the views.

import * as store from '../src/core/store.js';
import { optionId } from '../src/core/registry.js';

export const $ = (id) => document.getElementById(id);

/** h('div', { class: 'row', onclick }, child, 'text', …) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.58L12 16.6l-5.01 2.63.96-5.58L3.9 9.7l5.6-.8z"/>',
  gear: '<path d="M4 7h9"/><path d="M18 7h2"/><circle cx="15.5" cy="7" r="2.3"/><path d="M4 17h3"/><path d="M12 17h8"/><circle cx="9.5" cy="17" r="2.3"/>',
  use: '<path d="M5 12h12"/><path d="m13 7 5 5-5 5"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8"/><path d="m16 7 2.5 2.5"/>',
  down: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/>',
  locate: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/>',
  spark: '<path d="M12 3.5 13.8 9l5.7.2-4.5 3.4 1.6 5.4L12 14.8 7.4 18l1.6-5.4L4.5 9.2l5.7-.2z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2"/>',
};

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || '';
  return s;
}

let toastTimer;
export function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!err);
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), err ? 3200 : 1600);
}

/** Copy to the clipboard, record it in the history, confirm with a toast. */
export async function copy(text, source = '') {
  if (text === undefined || text === null || text === '') return toast('Nothing to copy', true);
  try {
    await navigator.clipboard.writeText(String(text));
  } catch {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = String(text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  store.pushHistory(String(text), source);
  const n = [...String(text)].length;
  toast(`Copied ${n.toLocaleString()} char${n === 1 ? '' : 's'}${source ? ' · ' + source : ''}`);
}

export async function paste() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast('Clipboard access was blocked — paste with Ctrl+V', true);
    return null;
  }
}

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(name, data, type = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/** Text filter: plain substring (case-insensitive) or /regex/flags. Returns a predicate. */
export function matcher(q) {
  q = (q || '').trim();
  if (!q) return () => true;
  const m = q.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2].replace('g', '') || 'i');
      return (s) => re.test(s);
    } catch {
      /* fall back to plain text */
    }
  }
  const low = q.toLowerCase();
  return (s) => String(s).toLowerCase().includes(low);
}

/** Wire a .seg control. Returns { get, set }. */
export function seg(el, onChange) {
  let value = el.querySelector('button.on')?.dataset.v;
  const set = (v, fire = true) => {
    value = v;
    for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v);
    if (fire) onChange?.(v);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b && b.dataset.v !== value) set(b.dataset.v);
  });
  return { get: () => value, set };
}

/** Two clicks to run `fn` (first click arms the button for 3 s). */
export function twoClick(btn, fn, armedLabel = 'Sure?') {
  let timer;
  const label = btn.innerHTML;
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = armedLabel;
      timer = setTimeout(() => {
        btn.classList.remove('armed');
        btn.innerHTML = label;
      }, 3000);
      return;
    }
    clearTimeout(timer);
    btn.classList.remove('armed');
    btn.innerHTML = label;
    fn();
  });
}

export function empty(mark, title, text, ...extra) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-mark', text: mark }), h('b', { text: title }), text ? h('p', { text }) : null, ...extra);
}

export function chars(s) {
  return [...String(s || '')].length;
}

export function bytes(s) {
  return new TextEncoder().encode(String(s || '')).length;
}

/** "12 chars · 14 bytes" for a meta line. */
export function sizeStat(s) {
  const c = chars(s);
  const b = bytes(s);
  return `${c.toLocaleString()} char${c === 1 ? '' : 's'} · ${b.toLocaleString()} byte${b === 1 ? '' : 's'}`;
}

/** A form for a transform's configurableOptions. `onChange(values)` after each edit. */
export function optionsForm(t, values, onChange) {
  const form = h('div', { class: 'form' });
  const vals = { ...values };
  for (const opt of t.configurableOptions || []) {
    const id = optionId(opt);
    const help = opt.description || opt.hint || opt.help;
    let control;
    const fire = (v) => {
      vals[id] = v;
      onChange({ ...vals });
    };
    if (opt.type === 'boolean') {
      control = h('label', { class: 'chk', title: help || '' }, h('input', { type: 'checkbox', checked: !!vals[id], onchange: (e) => fire(e.target.checked) }), opt.label);
      form.append(h('div', { class: 'field inline' }, control));
      continue;
    }
    if (opt.type === 'select') {
      control = h('select', { onchange: (e) => fire(e.target.value) }, (opt.options || []).map((o) => h('option', { value: o.value, text: o.label ?? o.value, selected: String(o.value) === String(vals[id]) })));
    } else if (opt.type === 'number') {
      control = h('input', { type: 'number', value: vals[id], min: opt.min, max: opt.max, step: opt.step, oninput: (e) => fire(e.target.value === '' ? '' : Number(e.target.value)) });
    } else {
      control = h('input', { type: 'text', class: 'mono', value: vals[id] ?? '', placeholder: opt.placeholder || '', oninput: (e) => fire(e.target.value) });
    }
    form.append(h('div', { class: 'field' }, h('label', { text: opt.label }), control, help ? h('small', { text: help }) : null));
  }
  return form;
}

/** Long outputs: keep the DOM responsive by rendering a slice. */
export function clip(s, max = 4000) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max) + `\n… (${(s.length - max).toLocaleString()} more characters — use Copy)` : s;
}

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(ts).toLocaleDateString();
}

/**
 * An expandable result row (JS Recon style).
 * head: nodes for the row head; value: one-line preview (string or node); detail(el): fills the expanded part.
 */
export function row({ head = [], value, valueClass = '', cls = '', detail, title } = {}) {
  const el = h('div', { class: 'row ' + cls, title });
  const headEl = h('div', { class: 'row-head' }, ...head);
  el.append(headEl);
  if (value !== undefined && value !== null) el.append(h('div', { class: 'value ' + valueClass }, value));
  if (detail) {
    let box = null;
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select, textarea, label')) return;
      // clicks in this row's own detail don't toggle it (a row nested in another row's detail still opens)
      const d = e.target.closest('.detail');
      if (d && el.contains(d)) return;
      if (el.classList.toggle('open')) {
        box = h('div', { class: 'detail' });
        detail(box, el);
        el.append(box);
      } else {
        box?.remove();
        box = null;
      }
    });
  } else el.classList.add('plain');
  return el;
}

/** A mini button with an icon and/or label. */
export function mini(label, onclick, { iconName, title, primary } = {}) {
  return h('button', { class: 'mini' + (primary ? ' primary' : '') + (label ? '' : ' icon'), title: title || label, onclick: (e) => (e.stopPropagation(), onclick(e)) }, iconName ? icon(iconName) : null, label || null);
}

/** Load a classic script from vendor/ once. Resolves with window[global]. */
const scripts = {};
export function loadScript(src, global) {
  if (global && globalThis[global]) return Promise.resolve(globalThis[global]);
  scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(global ? globalThis[global] : true);
    s.onerror = () => {
      delete scripts[src];
      reject(new Error('Could not load ' + src.split('/').pop()));
    };
    document.head.append(s);
  });
  return scripts[src];
}

/** Toggle a busy state on a button (spinner when it has an icon). */
export function busy(btn, on) {
  btn.classList.toggle('busy', on);
  btn.disabled = on;
}

/** Visible marks for whitespace in token / glitch displays. */
export function showWs(s) {
  return String(s).replace(/ /g, '·').replace(/\t/g, '→').replace(/\n/g, '↵').replace(/\r/g, '␍');
}

/**
 * Keep a textarea's text across popup opens (chrome.storage.session, else sessionStorage).
 * Resolves true when a draft was restored.
 */
export async function keepDraft(el, key) {
  const k = 'draft:' + key;
  const area = typeof chrome !== 'undefined' ? chrome.storage?.session : null;
  let restored = false;
  try {
    const v = area ? (await area.get(k))[k] : sessionStorage.getItem(k);
    if (v && !el.value) {
      el.value = v;
      restored = true;
    }
  } catch {
    /* no session storage */
  }
  const save = debounce(() => {
    const v = el.value.length > 200000 ? '' : el.value;
    try {
      if (area) area.set({ [k]: v });
      else sessionStorage.setItem(k, v);
    } catch {
      /* quota or unavailable */
    }
  }, 300);
  el.addEventListener('input', save);
  el.addEventListener('injex:set', save);
  return restored;
}

/** Set a textarea's value from code and let listeners (drafts, live views) know. */
export function setValue(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
