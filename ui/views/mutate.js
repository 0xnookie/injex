// Mutation Lab: many variants of one payload (random transforms, zero-width noise, diacritics, casing …).

import { MUTATIONS, mutate } from '../../src/core/generators.js';
import { $, h, empty, row, mini, keepDraft, setValue, download, chars } from '../lib.js';

let ctx;
let variants = [];
const DEFAULT_ON = ['randomMix', 'zeroWidth', 'unicodeNoise', 'whitespace', 'casing'];

function selected() {
  return [...$('mToggles').querySelectorAll('input:checked')].map((i) => i.value);
}

function run() {
  const text = $('mIn').value;
  const out = $('mOut');
  out.textContent = '';
  if (!text.trim()) {
    $('mBar').hidden = true;
    out.append(empty('⚗', 'Fuzz a payload', 'Generate dozens of variants that read the same to a model but differ byte by byte — useful to test filters and classifiers. Use a seed for reproducible sets.'));
    return;
  }
  const on = selected();
  if (!on.length) return ctx.toast('Pick at least one mutation', true);
  variants = mutate(text, { count: Number($('mCount').value) || 20, seed: $('mSeed').value, on });
  $('mBar').hidden = false;
  $('mMeta').textContent = `${variants.length} variants · ${on.map((k) => MUTATIONS[k].label).join(', ')}`;
  variants.forEach((v, i) => {
    out.append(
      row({
        head: [h('span', { class: 'pill wide', text: `#${i + 1}` }), h('span', { class: 'value', style: 'margin: 0; flex: 1', text: v.slice(0, 400) }), h('span', { class: 'src', text: chars(v) + ' ch' }), mini('', () => ctx.copy(v, `Variant ${i + 1}`), { iconName: 'copy', title: 'Copy' })],
      }),
    );
  });
}

export async function init(c) {
  ctx = c;
  for (const [k, m] of Object.entries(MUTATIONS)) {
    $('mToggles').append(h('label', { class: 'tgl', title: m.desc }, h('input', { type: 'checkbox', value: k, checked: DEFAULT_ON.includes(k) }), m.label));
  }
  $('mGo').addEventListener('click', run);
  $('mIn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  });
  $('mCopy').addEventListener('click', () => variants.length && ctx.copy(variants.join('\n'), `${variants.length} variants`));
  $('mSave').addEventListener('click', () => variants.length && download('injex-mutations.txt', variants.join('\n')));
  await keepDraft($('mIn'), 'mutate');
  run();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    setValue($('mIn'), payload.text);
    run();
  }
}
