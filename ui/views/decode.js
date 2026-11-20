// Decode: universal decoder (every detector + reverse, steganography), layer peeling and language hints.

import { list, CATEGORIES, CATEGORY_ORDER, canDecode, decode, transforms } from '../../src/core/registry.js';
import { universalDecode, peel, detectLanguage, englishness } from '../../src/core/decoder.js';
import { scanText, KINDS } from '../../src/core/scan.js';
import { $, h, debounce, empty, sizeStat, clip, paste, row, mini, keepDraft, setValue } from '../lib.js';

let ctx;
const input = $('dIn');
const out = $('dOut');

function resultCard(title, text, { chain, hl = true, sub } = {}) {
  const lang = detectLanguage(text);
  return h(
    'div',
    { class: 'card' + (hl ? ' hl' : ''), style: 'margin-bottom: 12px' },
    h('div', { class: 'card-head' }, h('b', { text: title }), sub ? h('span', { class: 'muted small', text: sub }) : null, h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(text, 'Decoded'), { iconName: 'copy', primary: true })),
    chain || null,
    h('pre', { class: 'out tall', style: chain ? 'margin-top: 10px' : '' }, clip(text, 30000)),
    h(
      'div',
      { class: 'row-actions', style: 'margin-top: 10px' },
      h('span', { class: 'muted small', text: sizeStat(text) }),
      lang ? h('span', { class: 'chip blue', text: `${lang.language}?` }) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', title: 'Decode this result again', onclick: () => setValue(input, text) }, 'Decode further'),
      h('button', { class: 'btn', onclick: () => ctx.switchTo('transform', { text }) }, 'Transform'),
      lang ? h('button', { class: 'btn', onclick: () => ctx.switchTo('ai', { mode: 'translate', text, toEnglish: true }) }, 'Translate') : null,
    ),
  );
}

function chainEl(layers) {
  const el = h('div', { class: 'chain' }, h('span', { class: 'chip dim', text: 'input' }));
  for (const l of layers) el.append(h('span', { class: 'arrow', text: '→' }), h('span', { class: 'chip ok', text: l.method }));
  return el;
}

function altRow(a) {
  return row({
    head: [h('span', { class: 'pill wide ' + (transforms[a.key]?.category || 'concealment'), text: a.score >= 200 ? 'likely' : a.score >= 80 ? 'maybe' : 'weak' }), h('span', { class: 'label', text: a.method }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(a.text, a.method), { iconName: 'copy' })],
    value: a.text.slice(0, 400),
    detail: (box) => {
      box.append(
        h('pre', { class: 'out tall' }, clip(a.text, 20000)),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => ctx.copy(a.text, a.method) }, 'Copy'), h('button', { class: 'btn', onclick: () => setValue(input, a.text) }, 'Decode further'), h('span', { class: 'spacer' }), h('span', { class: 'muted small', text: sizeStat(a.text) })),
      );
    },
  });
}

function hiddenNote(text) {
  const found = scanText(text, { stego: ctx.settings.stego }).filter((f) => !f.payload || f.kind === 'zero-width' || f.kind === 'bidi' || f.kind === 'homoglyph');
  if (!found.length) return null;
  return h(
    'div',
    { class: 'card warn', style: 'margin-bottom: 12px' },
    h('div', { class: 'card-head' }, h('b', { text: 'Invisible characters in the input' }), h('span', { class: 'spacer' }), h('button', { class: 'mini', onclick: () => ctx.switchTo('scan', { text }) }, 'Open in scanner')),
    h('div', { class: 'row-actions' }, found.map((f) => h('span', { class: 'chip warn', title: KINDS[f.kind]?.desc, text: `${KINDS[f.kind]?.label}: ${f.note}` }))),
  );
}

function run() {
  const text = input.value;
  $('dStat').textContent = text ? sizeStat(text) : '';
  out.textContent = '';
  $('dLang').hidden = true;
  if (!text.trim()) {
    out.append(empty('?', 'Paste something to decode', 'Base64, hex, ROT13, Morse, Braille, invisible Unicode tags, emoji steganography and 180+ more are recognised automatically — even when nested.'));
    return;
  }

  const forced = $('dWith').value;
  if (forced) {
    const t = transforms[forced];
    const r = decode(t, text);
    if (!r.ok) out.append(h('div', { class: 'card bad' }, h('div', { class: 'card-head' }, h('b', { text: t.name + ' could not decode this' })), h('div', { class: 'hint', text: r.error })));
    else out.append(resultCard(t.name, r.text));
    showLang(r.text);
    return;
  }

  const stego = ctx.settings.stego;
  const layers = $('dPeel').checked ? peel(text, { stego }) : [];
  const result = universalDecode(text, { stego });
  const note = hiddenNote(text);
  if (note) out.append(note);

  const readable = englishness(text);
  if (layers.length > 1) {
    const final = layers[layers.length - 1].text;
    out.append(resultCard(`${layers.length} layers`, final, { chain: chainEl(layers) }));
    showLang(final);
  } else if (layers.length === 1) {
    out.append(resultCard(layers[0].method, layers[0].text, { sub: 'confident match' }));
    showLang(layers[0].text);
  } else if (result && result.english <= readable + 0.05 && readable >= 0.3) {
    out.append(
      h(
        'div',
        { class: 'card', style: 'margin-bottom: 12px' },
        h('div', { class: 'card-head' }, h('b', { text: 'Already readable' }), h('span', { class: 'muted small', text: 'No decoder makes this read better — it may be plain text.' })),
        h('div', { class: 'hint', text: 'The readings below are what each decoder makes of it anyway. Pick a decoder above to force one.' }),
      ),
    );
    showLang(text, true);
  } else if (result) {
    const conf = result.score >= 200 ? 'confident match' : result.score >= 80 ? 'probable' : 'weak guess — check the other readings';
    out.append(resultCard(result.method, result.text, { sub: conf, hl: result.score >= 80 }));
    showLang(result.text);
  } else {
    out.append(empty('∅', 'Nothing recognised', 'No detector matched and no decoder produced readable text. Pick a decoder above to force one.'));
    showLang(text, true);
    return;
  }

  const shownText = layers.length ? layers[0].text : result?.english <= readable + 0.05 && readable >= 0.3 ? null : result?.text;
  const alts = [result, ...(result?.alternatives || [])].filter((a) => a && a.text !== shownText);
  if (alts.length) {
    // weak guesses (a cipher run over anything) are noise unless asked for
    const strong = alts.filter((a) => a.score >= 80);
    const weak = alts.filter((a) => a.score < 80);
    out.append(h('div', { class: 'group' }, 'Other readings', h('span', { class: 'n', text: alts.length })));
    for (const a of strong.slice(0, 60)) out.append(altRow(a));
    if (weak.length) {
      const more = h('div', { class: 'row-actions', style: 'margin-top: 4px' });
      more.append(
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              more.replaceWith(...weak.slice(0, 60).map(altRow));
            },
          },
          `Show ${weak.length} weak reading${weak.length === 1 ? '' : 's'}`,
        ),
      );
      out.append(more);
    }
  }
}

function showLang(text, isInput = false) {
  const lang = detectLanguage(text);
  const b = $('dLang');
  if (!lang) return;
  b.hidden = false;
  b.className = 'banner';
  b.textContent = '';
  b.append(
    h('span', { text: `${isInput ? 'The input' : 'The result'} looks like ${lang.language} (${lang.confidence} confidence).` }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'mini', onclick: () => ctx.switchTo('ai', { mode: 'translate', text, toEnglish: true }) }, 'Translate to English'),
  );
}

export async function init(c) {
  ctx = c;
  const sel = $('dWith');
  for (const cat of CATEGORY_ORDER) {
    const ts = list()
      .filter((t) => t.category === cat && canDecode(t))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (ts.length) sel.append(h('optgroup', { label: CATEGORIES[cat].label }, ts.map((t) => h('option', { value: t.key, text: t.name }))));
  }
  const go = debounce(run, 160);
  input.addEventListener('input', go);
  sel.addEventListener('change', run);
  $('dPeel').addEventListener('change', run);
  $('dPaste').addEventListener('click', async () => {
    const t = await paste();
    if (t !== null) setValue(input, t);
  });
  $('dClear').addEventListener('click', () => {
    setValue(input, '');
    input.focus();
  });
  await keepDraft(input, 'decode');
  run();
}

export function activate(payload) {
  if (payload?.with !== undefined) $('dWith').value = payload.with || '';
  if (payload?.text !== undefined) setValue(input, payload.text);
  else if (payload?.with !== undefined) run();
  input.focus();
}

export function onSettings(changes) {
  if (changes.customAlphabets) {
    const sel = $('dWith');
    const v = sel.value;
    sel.querySelector('optgroup[label="Custom"]')?.remove();
    const ts = list().filter((t) => t.category === 'custom');
    if (ts.length) sel.append(h('optgroup', { label: 'Custom' }, ts.map((t) => h('option', { value: t.key, text: t.name }))));
    sel.value = transforms[v] ? v : '';
  }
}
