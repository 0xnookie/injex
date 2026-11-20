// Steganography: hide a message after an emoji (variation selectors) or as invisible Unicode tags,
// and reveal what a pasted text hides.

import { encodeEmojiBits, encodeEmojiBytes, encodeTags, revealAll, CARRIERS } from '../../src/core/stego.js';
import { scanText, visualize, KINDS } from '../../src/core/scan.js';
import { EMOJI } from '../../src/core/registry.js';
import { $, h, debounce, seg, sizeStat, clip, mini, keepDraft, setValue, matcher } from '../lib.js';

let ctx;
let mode;
let output = '';

const HINTS = {
  bits: '8 invisible selectors per byte — survives most chat apps',
  bytes: '1 selector per byte — compact, needs VS17–VS256 support',
  tags: 'no carrier needed — the whole message is invisible',
};

function carrier() {
  return $('sCarrier').value.trim() || ctx.settings.stegoCarrier || '🐍';
}

function encode() {
  const msg = $('sMsg').value;
  const m = mode.get();
  $('sModeHint').textContent = HINTS[m];
  $('sCarrierBox').hidden = m === 'tags';
  if (!msg) {
    output = '';
    $('sOut').textContent = '';
    $('sOutMeta').textContent = '';
    return;
  }
  output = m === 'tags' ? encodeTags(msg) : m === 'bytes' ? encodeEmojiBytes(carrier(), msg) : encodeEmojiBits(carrier(), msg, ctx.settings.stego);
  const pre = $('sOut');
  pre.textContent = '';
  pre.append(h('span', { text: output }));
  if (m === 'tags') pre.append(h('span', { class: 'muted', text: '(invisible)' }));
  pre.append(h('div', { class: 'ctx', style: 'margin-top: 8px' }, visualize(output, 600)));
  $('sOutMeta').textContent = `${[...output].length.toLocaleString()} code points · ${sizeStat(output).split(' · ')[1]}`;
}

function reveal() {
  const text = $('sDec').value;
  const box = $('sReveal');
  box.textContent = '';
  if (!text) return;
  const found = revealAll(text, ctx.settings.stego);
  for (const f of scanText(text, { stego: ctx.settings.stego })) {
    if (f.payload && (f.kind === 'zero-width' || f.kind === 'tags') && !found.some((x) => x.text === f.payload)) found.push({ method: KINDS[f.kind].label, text: f.payload });
  }
  if (!found.length) {
    const marks = scanText(text);
    box.append(
      h(
        'div',
        { class: 'hint' },
        marks.length ? `No hidden message decoded, but: ${marks.map((m) => `${KINDS[m.kind].label} (${m.note})`).join(' · ')}.` : 'Nothing hidden found — no tag characters, variation-selector runs or zero-width steganography.',
      ),
    );
    return;
  }
  for (const f of found) {
    box.append(
      h(
        'div',
        { class: 'card hl', style: 'margin-bottom: 8px; padding: 10px 12px' },
        h('div', { class: 'card-head', style: 'margin-bottom: 6px' }, h('span', { class: 'chip ok', text: f.method }), h('span', { class: 'spacer' }), mini('Decode', () => ctx.switchTo('decode', { text: f.text })), mini('Copy', () => ctx.copy(f.text, 'Revealed'), { iconName: 'copy', primary: true })),
        h('pre', { class: 'out' }, clip(f.text, 20000)),
      ),
    );
  }
}

function setCarrier(c, save = true) {
  $('sCarrier').value = c;
  for (const b of $('sCarriers').children) b.classList.toggle('on', b.textContent === c);
  for (const b of $('sGrid').children) b.classList.toggle('on', b.textContent === c);
  if (save && c && c !== ctx.settings.stegoCarrier) ctx.save({ stegoCarrier: c });
  encode();
}

function emojiGrid() {
  const q = $('sEmojiFilter').value.trim();
  const grid = $('sGrid');
  grid.hidden = !q;
  grid.textContent = '';
  if (!q) return;
  const match = matcher(q);
  const hits = EMOJI.filter((e) => match(e.name) || match(e.keywords) || match(e.group)).slice(0, 240);
  for (const e of hits) grid.append(h('button', { title: e.name, text: e.emoji, class: e.emoji === carrier() ? 'on' : '', onclick: () => setCarrier(e.emoji) }));
  if (!hits.length) grid.append(h('span', { class: 'muted small', style: 'grid-column: 1 / -1; padding: 6px', text: 'No emoji found' }));
}

export async function init(c) {
  ctx = c;
  mode = seg($('sMode'), encode);
  for (const cr of CARRIERS) $('sCarriers').append(h('button', { title: cr.name, text: cr.emoji, onclick: () => setCarrier(cr.emoji) }));
  setCarrier(ctx.settings.stegoCarrier || '🐍', false);
  $('sCarrier').addEventListener('input', debounce(() => setCarrier($('sCarrier').value.trim()), 300));
  $('sEmojiFilter').addEventListener('input', debounce(emojiGrid, 100));
  $('sMsg').addEventListener('input', debounce(encode, 60));
  $('sDec').addEventListener('input', debounce(reveal, 120));
  $('sCopy').addEventListener('click', () => ctx.copy(output, mode.get() === 'tags' ? 'Unicode tags' : 'Emoji steganography'));
  $('sMeta').textContent = '';
  $('sMeta').append(h('button', { class: 'mini', title: 'Bit order, selectors and padding', onclick: () => ctx.openOptions('#stego') }, 'Encoding options'));
  await keepDraft($('sMsg'), 'stego');
  await keepDraft($('sDec'), 'stego-reveal');
  encode();
  reveal();
}

export function activate(payload) {
  if (payload?.reveal !== undefined) setValue($('sDec'), payload.reveal);
  if (payload?.text !== undefined) setValue($('sMsg'), payload.text);
}

export function onSettings(changes) {
  if (changes.stego) {
    encode();
    reveal();
  }
  if (changes.stegoCarrier && changes.stegoCarrier.newValue !== $('sCarrier').value) setCarrier(changes.stegoCarrier.newValue, false);
}
