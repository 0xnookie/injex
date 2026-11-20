// Tokenade: token bombs (nested emoji + variation selectors + zero-width noise) and text payloads.

import { TOKENADE_PRESETS, SEPARATORS, DANGER_TOKENS, tokenade, estimateTokenade, textPayload } from '../../src/core/generators.js';
import { CARRIERS } from '../../src/core/stego.js';
import { $, h, seg, clip, download, sizeStat } from '../lib.js';

let ctx;
let preset;
let bomb = '';
let payload = '';
const o = { ...TOKENADE_PRESETS.middle, singleCarrier: false, carrier: '💥' };

const FIELDS = [
  ['depth', 'Depth', 1, 8, 'Nesting levels'],
  ['breadth', 'Breadth', 1, 10, 'Items per level'],
  ['repeats', 'Repeats', 1, 50, 'How many top-level blocks'],
];
const FLAGS = [
  ['vs', 'Variation selectors', 'Alternate VS16 / VS15 after every emoji'],
  ['noise', 'Zero-width noise', 'Random ZWSP / ZWNJ / ZWJ / WJ between items'],
  ['randomize', 'Randomize emoji', 'Pick emoji at random instead of cycling'],
  ['singleCarrier', 'Single carrier', 'One visible emoji; the payload is invisible tag sequences'],
];

function form() {
  const f = $('bForm');
  f.textContent = '';
  for (const [k, label, min, max, hint] of FIELDS) {
    f.append(h('div', { class: 'field' }, h('label', { text: label }), h('input', { type: 'number', min, max, value: o[k], oninput: (e) => ((o[k] = Number(e.target.value)), custom()) }), h('small', { text: hint })));
  }
  f.append(
    h(
      'div',
      { class: 'field' },
      h('label', { text: 'Separator' }),
      h(
        'select',
        { onchange: (e) => ((o.separator = e.target.value), custom()) },
        Object.keys(SEPARATORS).map((k) => h('option', { value: k, text: { zwnj: 'ZWNJ (U+200C)', zwj: 'ZWJ (U+200D)', zwsp: 'ZWSP (U+200B)', none: 'None' }[k], selected: o.separator === k })),
      ),
      h('small', { text: 'Joins items and blocks' }),
    ),
  );
  for (const [k, label, hint] of FLAGS) f.append(h('div', { class: 'field inline' }, h('label', { class: 'chk', title: hint }, h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => ((o[k] = e.target.checked), custom()) }), label)));
  estimate();
}

function custom() {
  if (preset.get() !== 'custom') preset.set('custom', false);
  estimate();
}

function estimate() {
  const n = estimateTokenade(o);
  const chip = $('bEst');
  chip.className = 'chip ' + (n > DANGER_TOKENS ? 'bad' : n > 1e6 ? 'warn' : 'dim');
  chip.textContent = `≈ ${n.toLocaleString()} code units${n > DANGER_TOKENS ? ' — will likely freeze the tab' : n > 1e6 ? ' — large' : ''}`;
  $('bCarriers').parentElement.style.display = o.singleCarrier ? '' : 'none';
}

function generate() {
  const n = estimateTokenade(o);
  const btn = $('bGo');
  if (n > DANGER_TOKENS && !btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Generate anyway?';
    setTimeout(() => {
      btn.classList.remove('armed');
      btn.textContent = 'Generate';
    }, 3000);
    return;
  }
  btn.classList.remove('armed');
  btn.textContent = 'Generate';
  bomb = tokenade({ ...o, carrier: $('bCarrier').value || o.carrier });
  $('bOutCard').hidden = false;
  $('bOutMeta').textContent = sizeStat(bomb);
  $('bOut').textContent = clip(bomb, 6000);
}

function presetChanged(v) {
  if (v !== 'custom') Object.assign(o, TOKENADE_PRESETS[v]);
  form();
}

export function init(c) {
  ctx = c;
  const p = $('bPreset');
  for (const k of [...Object.keys(TOKENADE_PRESETS), 'custom']) p.append(h('button', { 'data-v': k, class: k === 'middle' ? 'on' : '', text: k[0].toUpperCase() + k.slice(1) }));
  preset = seg(p, presetChanged);
  for (const cr of CARRIERS) {
    $('bCarriers').append(
      h('button', {
        title: cr.name,
        text: cr.emoji,
        onclick: (e) => {
          $('bCarrier').value = cr.emoji;
          for (const b of $('bCarriers').children) b.classList.toggle('on', b === e.currentTarget);
        },
      }),
    );
  }
  $('bCarrier').value = o.carrier;
  form();
  $('bGo').addEventListener('click', generate);
  $('bCopy').addEventListener('click', () => ctx.copy(bomb, 'Tokenade'));
  $('bSave').addEventListener('click', () => bomb && download('injex-tokenade.txt', bomb));

  const text = () => {
    payload = textPayload({ base: $('xBase').value || 'A', repeat: Number($('xRepeat').value) || 100, combining: $('xComb').checked, zeroWidth: $('xZW').checked });
    $('xOut').hidden = false;
    $('xCopy').hidden = false;
    $('xOut').textContent = clip(payload, 6000);
  };
  $('xGo').addEventListener('click', text);
  $('xCopy').addEventListener('click', () => ctx.copy(payload, 'Text payload'));
}
