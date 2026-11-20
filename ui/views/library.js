// Library: glitch tokens, model special tokens, end / delimiter sequences and invisible characters to copy.

import GLITCH from '../../src/data/glitch-tokens.js';
import { END_SEQUENCE_CATEGORIES } from '../../src/data/end-sequences.js';
import { $, h, debounce, seg, matcher, empty, row, mini, showWs } from '../lib.js';

let ctx;
let mode;

const SHORT = { UNSPEAKABLE: 'unspeak', POLYSEMANTIC: 'polysem', GLITCHED_SPELLING: 'spelling', CONTEXT_CORRUPTOR: 'corrupt', LOOP_INDUCER: 'loop', IDENTITY_DISRUPTOR: 'identity', FRAGMENT: 'fragment', UNREACHABLE: 'unreach' };
const SEV = { UNSPEAKABLE: 'critical', LOOP_INDUCER: 'high', CONTEXT_CORRUPTOR: 'high', IDENTITY_DISRUPTOR: 'high', POLYSEMANTIC: 'medium', GLITCHED_SPELLING: 'medium', FRAGMENT: 'low', UNREACHABLE: 'low' };

const cp = (n) => String.fromCodePoint(n);
const CHARS = [
  ['Zero-width', [
    [0x200b, 'ZWSP', 'Zero width space'],
    [0x200c, 'ZWNJ', 'Zero width non-joiner'],
    [0x200d, 'ZWJ', 'Zero width joiner (glues emoji sequences)'],
    [0x2060, 'WJ', 'Word joiner'],
    [0xfeff, 'BOM', 'Zero width no-break space / byte-order mark'],
    [0x180e, 'MVS', 'Mongolian vowel separator'],
    [0x034f, 'CGJ', 'Combining grapheme joiner'],
    [0x00ad, 'SHY', 'Soft hyphen — invisible unless the line breaks there'],
  ]],
  ['Invisible operators', [
    [0x2061, 'FA', 'Function application'],
    [0x2062, 'IT', 'Invisible times'],
    [0x2063, 'IS', 'Invisible separator'],
    [0x2064, 'IP', 'Invisible plus'],
  ]],
  ['Bidirectional controls', [
    [0x200e, 'LRM', 'Left-to-right mark'],
    [0x200f, 'RLM', 'Right-to-left mark'],
    [0x061c, 'ALM', 'Arabic letter mark'],
    [0x202a, 'LRE', 'Left-to-right embedding'],
    [0x202b, 'RLE', 'Right-to-left embedding'],
    [0x202c, 'PDF', 'Pop directional formatting'],
    [0x202d, 'LRO', 'Left-to-right override'],
    [0x202e, 'RLO', 'Right-to-left override — reverses what follows'],
    [0x2066, 'LRI', 'Left-to-right isolate'],
    [0x2067, 'RLI', 'Right-to-left isolate'],
    [0x2068, 'FSI', 'First strong isolate'],
    [0x2069, 'PDI', 'Pop directional isolate'],
  ]],
  ['Variation selectors & tags', [
    [0xfe0e, 'VS15', 'Text presentation selector'],
    [0xfe0f, 'VS16', 'Emoji presentation selector'],
    [0xfe00, 'VS1', 'Variation selector 1'],
    [0xe0100, 'VS17', 'Variation selector 17 (supplement)'],
    [0xe0001, 'TAG', 'Language tag (deprecated)'],
    [0xe0020, 'TAG SP', 'Tag space — first of the invisible ASCII tags'],
    [0xe007f, 'CANCEL', 'Cancel tag'],
  ]],
  ['Blank look-alikes', [
    [0x00a0, 'NBSP', 'No-break space'],
    [0x202f, 'NNBSP', 'Narrow no-break space'],
    [0x2007, 'FIGSP', 'Figure space'],
    [0x2009, 'THSP', 'Thin space'],
    [0x200a, 'HSP', 'Hair space'],
    [0x2003, 'EMSP', 'Em space'],
    [0x3000, 'IDSP', 'Ideographic space'],
    [0x3164, 'HF', 'Hangul filler — renders blank, counts as a letter'],
    [0x115f, 'HCF', 'Hangul choseong filler'],
    [0x2800, 'BRAILLE', 'Braille pattern blank'],
    [0x2028, 'LSEP', 'Line separator'],
    [0x2029, 'PSEP', 'Paragraph separator'],
  ]],
  ['Replacement & objects', [
    [0xfffc, 'OBJ', 'Object replacement character'],
    [0xfffd, 'REPL', 'Replacement character'],
    [0x0000, 'NUL', 'Null'],
    [0x001b, 'ESC', 'Escape (starts ANSI terminal sequences)'],
  ]],
];

function tokenRow({ text, pill, pillClass = 'wide', src, value, desc, copyLabel }) {
  return row({
    head: [h('span', { class: 'pill ' + pillClass, text: pill }), h('span', { class: 'label mono', style: 'font-family: var(--mono); font-weight: 500', text: showWs(text) }), src ? h('span', { class: 'src', text: src }) : null, h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(text, copyLabel || 'Library'), { iconName: 'copy' })],
    value,
    valueClass: 'dim',
    detail: desc
      ? (box) => {
          box.append(h('div', { class: 'desc', text: desc }), h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => ctx.copy(text, copyLabel || 'Library') }, 'Copy'), h('button', { class: 'btn', onclick: () => ctx.switchTo('tokens', { text }) }, 'Tokenize'), h('button', { class: 'btn', onclick: () => ctx.copy(text.repeat(20), copyLabel || 'Library') }, 'Copy ×20')));
        }
      : undefined,
  });
}

const title = (id) => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function render() {
  const out = $('lOut');
  out.textContent = '';
  const match = matcher($('lFilter').value);
  let n = 0;
  let total = 0;
  const m = mode.get();
  const frag = document.createDocumentFragment();

  if (m === 'glitch' || m === 'special') {
    if (m === 'glitch') frag.append(h('div', { class: 'hint', style: 'margin: 0 2px 6px' }, `${GLITCH.source} collection, updated ${GLITCH.updated}. Tokens models cannot repeat, spell or even perceive — useful to probe tokenizer-level behaviour.`));
    for (const g of m === 'glitch' ? GLITCH.groups : GLITCH.special) {
      total += g.tokens.length;
      const ts = g.tokens.filter((t) => match(t.token) || match(t.origin || '') || match(t.note || '') || match(t.behavior || '') || match(g.id) || match(String(t.id ?? '')));
      if (!ts.length) continue;
      n += ts.length;
      frag.append(h('div', { class: 'group', title: g.description }, title(g.id), h('span', { class: 'n', text: ts.length })));
      for (const t of ts) {
        frag.append(
          tokenRow({
            text: t.token,
            pill: t.behavior ? SHORT[t.behavior] || t.behavior : 'special',
            pillClass: t.behavior ? SEV[t.behavior] || 'low' : 'wide',
            src: t.id !== undefined ? `#${t.id}` : '',
            value: [t.origin, t.note].filter(Boolean).join(' — ') || g.description,
            desc: [t.behavior ? `${t.behavior}: ${GLITCH.behaviors[t.behavior] || ''}` : '', t.origin ? `Origin: ${t.origin}` : '', t.note || '', `Group: ${g.description}`].filter(Boolean).join('\n'),
            copyLabel: m === 'glitch' ? 'Glitch token' : 'Special token',
          }),
        );
      }
    }
  } else if (m === 'ends') {
    for (const c of END_SEQUENCE_CATEGORIES) {
      total += c.items.length;
      const items = c.items.filter((i) => match(i.label) || match(i.value) || match(c.title));
      if (!items.length) continue;
      n += items.length;
      frag.append(h('div', { class: 'group' }, c.title, h('span', { class: 'n', text: items.length })));
      for (const i of items) frag.append(tokenRow({ text: i.value, pill: 'end', src: i.label !== i.value ? i.label : '', copyLabel: 'End sequence' }));
    }
  } else {
    for (const [group, list] of CHARS) {
      total += list.length;
      const items = list.filter(([code, name, desc]) => match(name) || match(desc) || match(group) || match('U+' + code.toString(16).toUpperCase().padStart(4, '0')));
      if (!items.length) continue;
      n += items.length;
      frag.append(h('div', { class: 'group' }, group, h('span', { class: 'n', text: items.length })));
      for (const [code, name, desc] of items) {
        const ch = cp(code);
        frag.append(
          row({
            head: [h('span', { class: 'pill wide', text: name }), h('span', { class: 'label', text: desc }), h('span', { class: 'src', text: 'U+' + code.toString(16).toUpperCase().padStart(4, '0') }), h('span', { class: 'spacer' }), mini('×10', () => ctx.copy(ch.repeat(10), name), { title: 'Copy ten' }), mini('Copy', () => ctx.copy(ch, name), { iconName: 'copy' })],
          }),
        );
      }
    }
  }
  $('lCount').textContent = `${n} of ${total}`;
  if (!n) frag.append(empty('∅', 'Nothing matches', 'Try another filter.'));
  out.append(frag);
}

export function init(c) {
  ctx = c;
  mode = seg($('lMode'), render);
  $('lFilter').addEventListener('input', debounce(render, 100));
  render();
}

export function activate(payload) {
  if (payload?.mode) mode.set(payload.mode);
}
