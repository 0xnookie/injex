// Bijection: teach a model a made-up character mapping ("alphapr") and send the payload in it.

import { BIJECTION_TYPES, bijectionMapping, shuffleMapping, bijectionEncode, bijectionPrompt, seeded } from '../../src/core/generators.js';
import { $, h, empty, clip, mini, keepDraft, setValue, download } from '../lib.js';

let ctx;
let prompts = [];
let shuffleSeed = '';

function build() {
  const text = $('jIn').value;
  if (!text.trim()) return [];
  const base = bijectionMapping($('jType').value, Number($('jFixed').value));
  const n = Math.max(1, Math.min(50, Number($('jBudget').value) || 1));
  const rnd = seeded(shuffleSeed || undefined);
  return Array.from({ length: n }, (_, i) => {
    const map = n === 1 && !shuffleSeed ? base : shuffleMapping(base, rnd);
    return { map, encoded: bijectionEncode(text, map), prompt: bijectionPrompt(text, map, { examples: $('jEx').checked }) };
  });
}

function render() {
  const out = $('jOut');
  out.textContent = '';
  prompts = build();
  if (!prompts.length) {
    out.append(empty('⇄', 'Bijection learning', 'Generates a prompt that teaches the model a character mapping, then asks it to answer a message written in that mapping. Several prompts get differently shuffled mappings.'));
    return;
  }
  if (prompts.length > 1) {
    out.append(
      h(
        'div',
        { class: 'row-actions', style: 'margin-bottom: 10px' },
        h('span', { class: 'muted small', text: `${prompts.length} prompts, each with its own mapping` }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => ctx.copy(prompts.map((p) => p.prompt).join('\n\n---\n\n'), `${prompts.length} prompts`) }, 'Copy all'),
        h('button', { class: 'btn', onclick: () => download('injex-bijection.txt', prompts.map((p) => p.prompt).join('\n\n---\n\n')) }, 'Download'),
      ),
    );
  }
  prompts.forEach((p, i) => {
    const grid = h(
      'div',
      { class: 'kv-grid', hidden: true, style: 'margin: 10px 0' },
      Object.entries(p.map).map(([k, v]) => h('div', { class: 'kv' }, h('b', { text: k }), h('span', { text: v }))),
    );
    out.append(
      h(
        'div',
        { class: 'card', style: 'margin-bottom: 12px' },
        h(
          'div',
          { class: 'card-head' },
          h('b', { text: prompts.length > 1 ? `Prompt ${i + 1}` : 'Prompt' }),
          h('span', { class: 'muted small', text: BIJECTION_TYPES[$('jType').value] }),
          h('span', { class: 'spacer' }),
          mini('Mapping', (e) => ((grid.hidden = !grid.hidden), e.currentTarget.classList.toggle('on', !grid.hidden))),
          mini('Encoded', () => ctx.copy(p.encoded, 'Bijection message')),
          mini('Copy', () => ctx.copy(p.prompt, 'Bijection prompt'), { iconName: 'copy', primary: true }),
        ),
        h('div', { class: 'ctx', style: 'margin-bottom: 8px' }, p.encoded.slice(0, 400)),
        grid,
        h('pre', { class: 'out tall' }, clip(p.prompt, 20000)),
      ),
    );
  });
}

export async function init(c) {
  ctx = c;
  for (const [k, label] of Object.entries(BIJECTION_TYPES)) $('jType').append(h('option', { value: k, text: label }));
  $('jGo').addEventListener('click', render);
  $('jShuffle').addEventListener('click', () => {
    shuffleSeed = Math.random().toString(36).slice(2);
    render();
  });
  for (const id of ['jType', 'jFixed', 'jBudget', 'jEx']) $(id).addEventListener('change', render);
  $('jIn').addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && render());
  await keepDraft($('jIn'), 'bijection');
  render();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    setValue($('jIn'), payload.text);
    render();
  }
}
