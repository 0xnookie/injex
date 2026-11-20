// History: everything copied from injex (and the right-click menu), newest first.

import * as store from '../../src/core/store.js';
import { $, h, debounce, matcher, empty, row, mini, ago, twoClick, clip, sizeStat, download } from '../lib.js';

let ctx;

async function render() {
  const out = $('hOut');
  out.textContent = '';
  const { history, historyEnabled } = await store.get(['history', 'historyEnabled']);
  const match = matcher($('hFilter').value);
  const items = history.filter((x) => match(x.text) || match(x.source || ''));
  $('hCount').textContent = history.length ? `${items.length} of ${history.length}` : '';
  ctx.setCount('history', null);
  if (!historyEnabled) {
    out.append(h('div', { class: 'banner', style: 'margin: -10px -12px 10px' }, h('span', { text: 'History is off — copies are not recorded.' }), h('span', { class: 'spacer' }), h('button', { class: 'mini', onclick: () => ctx.openOptions('#history') }, 'Settings')));
  }
  if (!history.length) {
    out.append(empty('↺', 'Nothing copied yet', 'Everything you copy from injex — including right-click results on pages — lands here, so you can get back to it.'));
    return;
  }
  if (!items.length) {
    out.append(empty('∅', 'Nothing matches', 'Try another filter.'));
    return;
  }
  for (const it of items) {
    const del = async () => {
      const cur = await store.get('history');
      await store.set({ history: cur.filter((x) => !(x.at === it.at && x.text === it.text)) });
    };
    out.append(
      row({
        head: [h('span', { class: 'pill wide', title: it.source, text: (it.source || 'copy').slice(0, 18) }), h('span', { class: 'value', style: 'margin: 0; flex: 1', text: it.text.replace(/\s+/g, ' ').slice(0, 300) }), h('span', { class: 'src', text: ago(it.at) }), mini('', () => ctx.copy(it.text, it.source), { iconName: 'copy', title: 'Copy again' })],
        detail: (box) => {
          box.append(
            h('pre', { class: 'out tall' }, clip(it.text, 30000)),
            h(
              'div',
              { class: 'row-actions' },
              h('button', { class: 'btn primary', onclick: () => ctx.copy(it.text, it.source) }, 'Copy'),
              h('button', { class: 'btn', onclick: () => ctx.switchTo('decode', { text: it.text }) }, 'Decode'),
              h('button', { class: 'btn', onclick: () => ctx.switchTo('transform', { text: it.text }) }, 'Transform'),
              h('button', { class: 'btn', onclick: () => ctx.switchTo('scan', { text: it.text }) }, 'Scan'),
              h('button', { class: 'btn ghost', onclick: del }, 'Delete'),
              h('span', { class: 'spacer' }),
              h('span', { class: 'muted small', text: `${sizeStat(it.text)} · ${new Date(it.at).toLocaleString()}` }),
            ),
          );
        },
      }),
    );
  }
  out.append(h('div', { class: 'row-actions', style: 'margin-top: 10px' }, h('button', { class: 'btn ghost', onclick: () => download('injex-history.json', JSON.stringify(history, null, 2), 'application/json') }, 'Export JSON')));
}

export function init(c) {
  ctx = c;
  $('hFilter').addEventListener('input', debounce(render, 100));
  twoClick($('hClear'), async () => {
    await store.set({ history: [] });
    ctx.toast('History cleared');
  }, 'Clear all?');
  return render();
}

export function activate() {
  render();
}

export function onSettings(changes) {
  if (changes.history || changes.historyEnabled) render();
}
