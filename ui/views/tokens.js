// Tokenizer: how a GPT tokenizer (bundled, offline) cuts the text, with IDs and counts.

import { ENGINES, tokenize, loadEncoding } from '../../src/core/tokenizer.js';
import { visualize } from '../../src/core/scan.js';
import { $, h, debounce, empty, bytes, chars, mini, keepDraft, setValue, showWs } from '../lib.js';

const VISIBLE = /[^\s\p{Cf}\p{Cc}\p{Mn}\u{FE00}-\u{FE0F}\u{E0000}-\u{E01EF}]/u;

let ctx;
let seq = 0;
let lastTokens = [];

function stat(label, value) {
  return h('div', { class: 'stat-box' }, h('b', { text: value }), h('span', { text: label }));
}

async function run() {
  const text = $('kIn').value;
  const engine = $('kEngine').value;
  const out = $('kOut');
  const my = ++seq;
  if (!text) {
    out.textContent = '';
    $('kStat').textContent = '';
    out.append(empty('▦', 'See how a model reads your text', 'Each coloured block is one token. Unicode tricks, emoji and invisible characters usually cost far more tokens than they look.'));
    return;
  }
  let toks;
  try {
    if (ENGINES[engine]?.bpe && !globalThis['GPTTokenizer_' + engine]) $('kStat').textContent = 'loading tokenizer…';
    toks = await tokenize(text, engine, ctx.vendorBase + 'gpt-tokenizer/');
  } catch (e) {
    if (my === seq) {
      out.textContent = '';
      out.append(h('div', { class: 'card bad' }, h('b', { text: 'Tokenizer failed' }), h('div', { class: 'hint', text: e.message || String(e) })));
    }
    return;
  }
  if (my !== seq) return;
  lastTokens = toks;
  const n = toks.length;
  $('kStat').textContent = `${n.toLocaleString()} token${n === 1 ? '' : 's'}`;
  out.textContent = '';
  out.append(
    h(
      'div',
      { class: 'stats', style: 'margin-bottom: 12px' },
      stat('tokens', n.toLocaleString()),
      stat('characters', chars(text).toLocaleString()),
      stat('UTF-8 bytes', bytes(text).toLocaleString()),
      stat('chars / token', n ? (chars(text) / n).toFixed(2) : '—'),
    ),
  );
  const box = h('div', { class: 'tokens' });
  const MAX = 6000;
  for (const t of toks.slice(0, MAX)) {
    const el = h('span', { class: 'tok' + (t.partial ? ' partial' : ''), title: (t.id !== undefined ? `#${t.id}` : '') + (t.partial ? ' · part of a multi-byte character' : '') });
    // whitespace drawn as dim marks (· → ↵), the rest as is
    for (const part of t.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) el.append(h('span', { class: 'ws', text: showWs(part) }), part.includes('\n') ? '\n' : '');
      // invisible characters (tags, selectors, zero-width) would draw an empty token: name them
      else if (!VISIBLE.test(part)) el.append(h('span', { class: 'ws', text: visualize(part, 80) }));
      else el.append(part);
    }
    box.append(el);
  }
  if (toks.length > MAX) box.append(h('div', { class: 'muted small', text: `… ${(toks.length - MAX).toLocaleString()} more tokens not drawn` }));
  out.append(box);
  if ($('kIds').checked && toks[0]?.id !== undefined) {
    const ids = toks.map((t) => t.id).join(', ');
    out.append(
      h('div', { class: 'card-head', style: 'margin: 14px 0 6px' }, h('b', { text: 'Token IDs' }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy('[' + ids + ']', 'Token IDs'), { iconName: 'copy' })),
      h('div', { class: 'ids' }, ids.length > 60000 ? ids.slice(0, 60000) + ' …' : ids),
    );
  }
  out.append(h('div', { class: 'row-actions', style: 'margin-top: 14px' }, h('button', { class: 'btn', onclick: compare }, 'Compare tokenizers'), h('span', { class: 'hint', id: 'kCompare' })));
}

async function compare() {
  const text = $('kIn').value;
  const hint = $('kCompare');
  hint.textContent = 'counting…';
  const parts = [];
  for (const [name, e] of Object.entries(ENGINES)) {
    if (!e.bpe) continue;
    try {
      const enc = await loadEncoding(name, ctx.vendorBase + 'gpt-tokenizer/');
      parts.push(`${name.replace('_base', '')}: ${enc.encode(text, { allowedSpecial: 'all' }).length.toLocaleString()}`);
    } catch {
      parts.push(`${name}: failed`);
    }
  }
  hint.textContent = parts.join(' · ');
}

export async function init(c) {
  ctx = c;
  const sel = $('kEngine');
  for (const [k, e] of Object.entries(ENGINES)) sel.append(h('option', { value: k, text: e.label }));
  sel.value = ENGINES[ctx.settings.tokenizer] ? ctx.settings.tokenizer : 'o200k_base';
  sel.addEventListener('change', () => {
    ctx.save({ tokenizer: sel.value });
    run();
  });
  $('kIds').addEventListener('change', run);
  $('kIn').addEventListener('input', debounce(run, 200));
  await keepDraft($('kIn'), 'tokens');
  run();
}

export function activate(payload) {
  if (payload?.text !== undefined) setValue($('kIn'), payload.text);
}
