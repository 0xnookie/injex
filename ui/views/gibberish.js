// Gibberish: consistent word → nonsense dictionary, random letter removal, or removal of specific characters.

import { gibberish, randomRemovals, removeChars } from '../../src/core/generators.js';
import { $, h, debounce, seg, empty, clip, row, mini, keepDraft, setValue } from '../lib.js';

let ctx;
let mode;
const o = { chars: 'abcdefghijklmnopqrstuvwxyz', seed: '', variations: 10, min: 1, max: 3, remove: 'aeiou' };

function input(key, attrs) {
  return h('input', { value: o[key], oninput: (e) => ((o[key] = attrs.type === 'number' ? Number(e.target.value) : e.target.value), go()), ...attrs });
}

function opts() {
  const box = $('gOpts');
  box.textContent = '';
  const m = mode.get();
  if (m === 'dict') box.append(input('chars', { type: 'text', class: 'mono', style: 'width: 170px', title: 'Characters the made-up words are built from', placeholder: 'alphabet' }), input('seed', { type: 'text', class: 'mono', style: 'width: 80px', placeholder: 'seed', title: 'Same seed → same dictionary' }));
  if (m === 'random') {
    box.append(
      h('label', { class: 'muted small' }, 'Variations ', input('variations', { type: 'number', min: 1, max: 200 })),
      h('label', { class: 'muted small' }, 'Remove ', input('min', { type: 'number', min: 0, max: 10 })),
      h('label', { class: 'muted small' }, '– ', input('max', { type: 'number', min: 0, max: 10 })),
      input('seed', { type: 'text', class: 'mono', style: 'width: 80px', placeholder: 'seed' }),
    );
  }
  if (m === 'specific') box.append(h('label', { class: 'muted small' }, 'Remove ', input('remove', { type: 'text', class: 'mono', style: 'width: 140px', title: 'Every one of these characters is removed' })));
}

function run() {
  const text = $('gIn').value;
  const out = $('gOut');
  out.textContent = '';
  if (!text.trim()) {
    out.append(empty('¿', 'Gibberish', 'Dictionary mode swaps every word for a consistent nonsense word and gives you the key — send both and ask the model to decode. Removal modes drop letters while staying readable.'));
    return;
  }
  const m = mode.get();
  if (m === 'dict') {
    const { text: g, dictionary } = gibberish(text, { chars: o.chars, seed: o.seed });
    const key = Object.entries(dictionary)
      .map(([w, x]) => `${x} = ${w}`)
      .join('\n');
    out.append(
      h('div', { class: 'card', style: 'margin-bottom: 12px' }, h('div', { class: 'card-head' }, h('b', { text: 'Gibberish' }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(g, 'Gibberish'), { iconName: 'copy', primary: true })), h('pre', { class: 'out tall' }, clip(g, 20000))),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          h('b', { text: 'Dictionary' }),
          h('span', { class: 'muted small', text: `${Object.keys(dictionary).length} words` }),
          h('span', { class: 'spacer' }),
          mini('Copy key', () => ctx.copy(key, 'Gibberish dictionary')),
          mini('Copy with prompt', () => ctx.copy(`Decode this message with the dictionary below, then answer it.\n\nMessage:\n${g}\n\nDictionary:\n${key}`, 'Gibberish prompt'), { primary: true }),
        ),
        h('div', { class: 'kv-grid' }, Object.entries(dictionary).map(([w, x]) => h('div', { class: 'kv', title: `${x} = ${w}` }, h('b', { text: x }), h('span', { text: w })))),
      ),
    );
  } else if (m === 'random') {
    const vs = randomRemovals(text, { variations: o.variations, min: o.min, max: o.max, seed: o.seed });
    out.append(h('div', { class: 'row-actions', style: 'margin-bottom: 8px' }, h('span', { class: 'muted small', text: `${vs.length} variations` }), h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => ctx.copy(vs.join('\n'), `${vs.length} variations`) }, 'Copy all')));
    vs.forEach((v, i) => out.append(row({ head: [h('span', { class: 'pill wide', text: `#${i + 1}` }), h('span', { class: 'value', style: 'margin: 0; flex: 1', text: v }), mini('', () => ctx.copy(v, 'Variation'), { iconName: 'copy', title: 'Copy' })] })));
  } else {
    const r = removeChars(text, o.remove);
    out.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', { text: 'Result' }), h('span', { class: 'muted small', text: `${[...text].length - [...r].length} characters removed` }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(r, 'Character removal'), { iconName: 'copy', primary: true })), h('pre', { class: 'out tall' }, clip(r, 20000))));
  }
}
const go = debounce(run, 120);

export async function init(c) {
  ctx = c;
  mode = seg($('gMode'), () => {
    opts();
    run();
  });
  opts();
  $('gIn').addEventListener('input', go);
  await keepDraft($('gIn'), 'gibberish');
  run();
}

export function activate(payload) {
  if (payload?.text !== undefined) setValue($('gIn'), payload.text);
}
