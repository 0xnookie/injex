// Splitter: cut a payload into several messages, transform each piece and wrap it.

import { SPLIT_MODES, WRAP_PRESETS, split, finish } from '../../src/core/splitter.js';
import { encoder, ENGINES } from '../../src/core/tokenizer.js';
import { list, transforms, CATEGORIES, CATEGORY_ORDER } from '../../src/core/registry.js';
import { $, h, debounce, empty, row, mini, keepDraft, setValue, chars } from '../lib.js';

let ctx;
let pieces = [];
const o = { mode: 'word', chunkSize: 6, wordSkip: 0, minWordLength: 2, splitSide: 'left', splitFirstWord: true, pattern: '\\s+', keepDelimiter: false, preserveEmpty: false, tokenCount: 3, engine: 'o200k_base' };
const chain = [];

function num(label, key, min, max, title) {
  return h('label', { class: 'muted small', title }, label + ' ', h('input', { type: 'number', min, max, value: o[key], oninput: (e) => ((o[key] = Number(e.target.value)), go()) }));
}

function check(label, key, title) {
  return h('label', { class: 'tgl', title }, h('input', { type: 'checkbox', checked: o[key], onchange: (e) => ((o[key] = e.target.checked), go()) }), label);
}

function modeOpts() {
  const box = $('pModeOpts');
  box.textContent = '';
  if (o.mode === 'word') {
    box.append(
      num('Skip', 'wordSkip', 0, 20, 'Split every (n+1)-th splittable word'),
      num('Min length', 'minWordLength', 1, 20, 'Only split words at least this long'),
      h('select', { title: 'Odd-length words: which half gets the extra letter', onchange: (e) => ((o.splitSide = e.target.value), go()) }, h('option', { value: 'left', text: 'Extra letter left' }), h('option', { value: 'right', text: 'Extra letter right', selected: o.splitSide === 'right' })),
      check('Split first word', 'splitFirstWord'),
    );
  } else if (o.mode === 'chunk') box.append(num('Characters', 'chunkSize', 1, 500));
  else if (o.mode === 'pattern') {
    box.append(h('input', { type: 'text', class: 'mono', value: o.pattern, style: 'width: 140px', placeholder: 'regex', title: 'JavaScript regular expression', oninput: (e) => ((o.pattern = e.target.value), go()) }), check('Keep delimiter', 'keepDelimiter'));
  } else if (o.mode === 'line') box.append(check('Keep empty lines', 'preserveEmpty'));
  else if (o.mode === 'token') {
    box.append(
      num('Tokens', 'tokenCount', 1, 1000),
      h(
        'select',
        { onchange: (e) => ((o.engine = e.target.value), go()) },
        Object.entries(ENGINES)
          .filter(([, e]) => e.bpe)
          .map(([k, e]) => h('option', { value: k, text: e.label, selected: k === o.engine })),
      ),
    );
  }
}

function chainUi() {
  const box = $('pChain');
  box.textContent = '';
  chain.forEach((key, i) => {
    box.append(h('button', { class: 'chip blue', title: 'Remove', onclick: () => (chain.splice(i, 1), chainUi(), go()) }, transforms[key]?.name || key, ' ×'));
  });
  const sel = h('select', { title: 'Apply a transform to every piece', onchange: (e) => e.target.value && (chain.push(e.target.value), chainUi(), go()) }, h('option', { value: '', text: chain.length ? '+ then…' : 'none' }));
  for (const cat of CATEGORY_ORDER) {
    const ts = list()
      .filter((t) => t.category === cat)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (ts.length) sel.append(h('optgroup', { label: CATEGORIES[cat].label }, ts.map((t) => h('option', { value: t.key, text: t.name }))));
  }
  box.append(sel);
}

async function run() {
  const text = $('pIn').value;
  const out = $('pOut');
  out.textContent = '';
  pieces = [];
  if (!text) {
    out.append(empty('✂', 'Split a payload into messages', 'Word mode cuts every word in half across messages, so no single message contains a full keyword. Each piece can be transformed and wrapped.'));
    return;
  }
  let raw;
  try {
    raw = split(text, { ...o, tokenizer: o.mode === 'token' ? await encoder(o.engine, ctx.vendorBase + 'gpt-tokenizer/') : undefined });
  } catch (e) {
    out.append(h('div', { class: 'hint err', text: e.message || String(e) }));
    return;
  }
  pieces = finish(raw, { chain, start: $('pStart').value, end: $('pEnd').value });
  out.append(h('div', { class: 'group' }, 'Messages', h('span', { class: 'n', text: pieces.length })));
  pieces.slice(0, 500).forEach((p, i) => {
    out.append(
      row({
        head: [h('span', { class: 'pill wide', text: `#${i + 1}` }), h('span', { class: 'value', style: 'margin: 0; flex: 1', text: p.replace(/\n/g, '↵ ') }), h('span', { class: 'src', text: chars(p) + ' ch' }), mini('', () => ctx.copy(p, `Part ${i + 1}`), { iconName: 'copy', title: 'Copy this message' })],
      }),
    );
  });
  if (pieces.length > 500) out.append(h('div', { class: 'hint', text: `… ${pieces.length - 500} more (included in Copy all)` }));
}
const go = debounce(run, 120);

export async function init(c) {
  ctx = c;
  const mode = $('pMode');
  for (const [k, label] of Object.entries(SPLIT_MODES)) mode.append(h('option', { value: k, text: label }));
  mode.addEventListener('change', () => {
    o.mode = mode.value;
    modeOpts();
    go();
  });
  const wrap = $('pWrapPreset');
  WRAP_PRESETS.forEach((p, i) => wrap.append(h('option', { value: i, text: p.label })));
  wrap.addEventListener('change', () => {
    const p = WRAP_PRESETS[wrap.value];
    $('pStart').value = p.start;
    $('pEnd').value = p.end;
    go();
  });
  $('pStart').addEventListener('input', go);
  $('pEnd').addEventListener('input', go);
  $('pIn').addEventListener('input', go);
  $('pCopyAll').addEventListener('click', () => {
    if (!pieces.length) return ctx.toast('Nothing to copy', true);
    ctx.copy(pieces.join($('pOneLine').checked ? ' ' : '\n'), `${pieces.length} messages`);
  });
  modeOpts();
  chainUi();
  await keepDraft($('pIn'), 'split');
  run();
}

export function activate(payload) {
  if (payload?.text !== undefined) setValue($('pIn'), payload.text);
}

export function onSettings(changes) {
  if (changes.customAlphabets) chainUi();
}
