// Inspect: every character of a text (code point, name, category, script, block, and what invisible
// ones hide), and a code-point diff of two texts that look alike.

import { loadUnicodeData, inspectText, escapesOf, FLAGS, charInfo } from '../../src/core/unicode.js';
import { compareTexts } from '../../src/core/diff.js';
import { visualize, stripHidden } from '../../src/core/scan.js';
import { decodeTags, decodeEmojiBytes, printableRatio } from '../../src/core/stego.js';
import { $, h, debounce, seg, empty, row, mini, keepDraft, setValue } from '../lib.js';

let ctx;
let mode;
let ready = false;
const MAX_ROWS = 1500;

const level = (flags) => (flags.some((f) => FLAGS[f]?.level === 'bad') ? 'bad' : flags.some((f) => FLAGS[f]?.level === 'warn') ? 'warn' : '');
const glyphEl = (c) => h('span', { class: `glyph ${c.glyph.length > 2 && !/\p{Extended_Pictographic}/u.test(c.glyph) ? 'word' : ''} ${level(c.flags)}`, title: c.hex, text: c.glyph });
const flagChips = (flags) => flags.map((f) => h('span', { class: 'chip ' + (FLAGS[f]?.level === 'bad' ? 'bad' : FLAGS[f]?.level === 'warn' ? 'warn' : 'dim'), title: FLAGS[f]?.desc, text: FLAGS[f]?.label || f }));

/** Runs of tags / selectors / one repeated character become one row. */
function groups(chars) {
  const out = [];
  const keyOf = (c) => (c.note === 'part of a flag emoji' ? 'flag' : c.flags.includes('tag') ? 'tag' : c.flags.includes('vs') ? 'vs' : 'cp' + c.cp);
  for (const c of chars) {
    const last = out.at(-1);
    if (last && last.key === keyOf(c) && last.items.at(-1).index === c.index - 1) last.items.push(c);
    else out.push({ key: keyOf(c), items: [c] });
  }
  // short runs of different characters stay single rows
  return out.flatMap((g) => (g.items.length >= 3 || (g.key.startsWith('cp') && g.items.length > 1) ? [g] : g.items.map((c) => ({ key: g.key, items: [c] }))));
}

function charRow(c) {
  return row({
    cls: 'char' + (c.flags.includes('tag') || c.flags.includes('bidi') ? ' sev-critical' : ''),
    head: [h('span', { class: 'idx', text: '#' + (c.index + 1) }), glyphEl(c), h('span', { class: 'hex', text: c.hex }), h('span', { class: 'label', text: c.name, title: c.name }), ...flagChips(c.flags), h('span', { class: 'spacer' }), mini('', () => ctx.copy(c.char, c.hex), { iconName: 'copy', title: 'Copy the character' })],
    value: `${c.categoryName} · ${c.script} · ${c.block}${c.note ? ' · ' + c.note : ''}`,
    valueClass: 'dim',
    detail: (box) => {
      const dl = h('dl', { class: 'meta' });
      const add = (k, v) => dl.append(h('dt', { text: k }), h('dd', { text: v }));
      add('Category', `${c.category} — ${c.categoryName}`);
      add('Script', c.script);
      add('Block', c.block);
      for (const [k, v] of Object.entries(escapesOf(c.cp))) add(k, v);
      if (c.flags.length) add('Why it matters', c.flags.map((f) => FLAGS[f]?.desc).filter(Boolean).join('. ') + '.');
      box.append(dl);
      box.append(h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => ctx.copy(c.char, c.hex) }, 'Copy character'), h('button', { class: 'btn', onclick: () => ctx.copy(escapesOf(c.cp).JavaScript, c.hex + ' escape') }, 'Copy JS escape')));
    },
  });
}

function runRow(g) {
  const first = g.items[0];
  const n = g.items.length;
  const run = g.items.map((c) => c.char).join('');
  let hidden = '';
  if (g.key === 'tag') hidden = decodeTags(run);
  if (g.key === 'vs') {
    const d = decodeEmojiBytes('x' + run);
    if (d && printableRatio(d) > 0.8) hidden = d;
  }
  if (g.key === 'flag') {
    // the tag letters of a subdivision flag spell its region code, e.g. gbeng = England
    return row({
      cls: 'char',
      head: [h('span', { class: 'idx', text: '#' + (first.index + 1) }), glyphEl(first), h('span', { class: 'hex', text: `${first.hex}…` }), h('span', { class: 'label', text: `Flag emoji tags “${decodeTags(run)}”` }), h('span', { class: 'chip ok', text: 'normal' })],
      value: `${n} tag characters after 🏴 that make a regional flag (England, Scotland, Wales …), not hidden text`,
      valueClass: 'dim',
      detail: (box) => {
        for (const c of g.items) box.append(charRow(c));
      },
    });
  }
  const label = g.key === 'tag' ? `${n} Unicode tag characters` : g.key === 'vs' ? `${n} variation selectors` : `${first.name} ×${n}`;
  return row({
    cls: 'char' + (level(first.flags) === 'bad' ? ' sev-critical' : ''),
    head: [h('span', { class: 'idx', text: '#' + (first.index + 1) }), glyphEl(first), h('span', { class: 'hex', text: `${first.hex}…` }), h('span', { class: 'label', text: label }), ...flagChips(first.flags), h('span', { class: 'spacer' }), hidden ? mini('Copy', () => ctx.copy(hidden, 'Hidden text'), { iconName: 'copy', title: 'Copy what the run hides' }) : null],
    value: hidden ? `hides “${hidden.replace(/\s+/g, ' ').slice(0, 300)}”` : `${first.categoryName} · ${first.script} · ${first.block}`,
    valueClass: hidden ? '' : 'dim',
    detail: (box) => {
      if (hidden) box.append(h('pre', { class: 'out' }, hidden));
      if (g.key !== 'tag') box.append(h('div', { class: 'ctx', text: visualize(run, 2000) }));
      const list = h('div', {});
      for (const c of g.items.slice(0, 200)) list.append(charRow(c));
      box.append(list);
    },
  });
}

function renderChars() {
  const out = $('insOut');
  out.textContent = '';
  const text = $('insIn').value;
  const banner = $('insBanner');
  banner.hidden = true;
  if (!text) {
    $('insCount').textContent = '';
    out.append(empty('U+', 'Inspect characters', 'Paste text to list every character with its code point and Unicode name — invisible ones, look-alike letters, and what Unicode tags and variation selectors hide. Right-click a selection → injex → Inspect characters works too.'));
    ctx.setCount('inspect', null);
    return;
  }
  const r = inspectText(text, { unusual: $('insUnusual').checked, limit: MAX_ROWS });
  $('insCount').textContent = `${r.codePoints.toLocaleString()} code points`;
  // tags, selectors and bidi controls are all "invisible" too: count each character once
  const hidden = r.flags.invisible || 0;
  const alike = r.flags.confusable || 0;
  ctx.setCount('inspect', hidden + alike || null, r.flags.tag || r.flags.bidi ? 'crit' : 'hot');

  const stats = h('div', { class: 'stats' });
  stats.append(h('span', { class: 'chip dim', text: `${r.graphemes.toLocaleString()} graphemes` }), h('span', { class: 'chip dim', text: `${r.utf16.toLocaleString()} UTF-16 units` }), h('span', { class: 'chip dim', text: `${r.utf8.toLocaleString()} UTF-8 bytes` }));
  for (const [s, n] of Object.entries(r.scripts).sort((a, b) => b[1] - a[1])) stats.append(h('span', { class: 'chip ' + (Object.keys(r.scripts).length > 1 ? 'warn' : 'dim'), text: `${s} ${n}` }));
  for (const [f, n] of Object.entries(r.flags)) stats.append(h('span', { class: 'chip ' + (FLAGS[f]?.level === 'bad' ? 'bad' : FLAGS[f]?.level === 'warn' ? 'warn' : 'dim'), title: FLAGS[f]?.desc, text: `${n} ${FLAGS[f]?.label || f}` }));
  out.append(stats);

  const clean = stripHidden(text);
  if (clean.removed || clean.replaced || r.nfkc) {
    banner.hidden = false;
    banner.className = 'banner ' + (r.flags.tag || r.flags.bidi ? 'bad' : '');
    banner.textContent = '';
    banner.append(
      h('span', { text: [clean.removed && `${clean.removed} hidden character${clean.removed === 1 ? '' : 's'}`, clean.replaced && `${clean.replaced} look-alike letter${clean.replaced === 1 ? '' : 's'}`, r.nfkc && 'compatibility forms (NFKC changes the text)'].filter(Boolean).join(' · ') }),
      h('span', { class: 'spacer' }),
      clean.removed || clean.replaced ? mini('Copy cleaned', () => ctx.copy(clean.text, 'Cleaned text'), { iconName: 'spark' }) : null,
      r.nfkc ? mini('Copy NFKC', () => ctx.copy(r.nfkc, 'NFKC'), { title: 'Fullwidth, mathematical and other compatibility letters folded to plain ones' }) : null,
    );
  }
  if (!r.chars.length) {
    out.append(empty('✓', 'Only plain ASCII', 'Every character is a printable ASCII letter, digit, punctuation mark or space. Untick “Unusual only” to list them anyway.'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const g of groups(r.chars)) frag.append(g.items.length > 1 ? runRow(g) : charRow(g.items[0]));
  out.append(frag);
  if (r.truncated) out.append(h('div', { class: 'hint', text: `Showing the first ${MAX_ROWS.toLocaleString()} characters.` }));
}

// ── compare ──

function renderCompare() {
  const out = $('insOut');
  out.textContent = '';
  const a = $('insA').value;
  const b = $('insB').value;
  const banner = $('insBanner');
  banner.hidden = true;
  if (!a && !b) {
    $('insCount').textContent = '';
    out.append(empty('≟', 'Compare two texts', 'Paste an original and a copy. You see every code point that differs — and whether the difference is something a reader could see at all, or only invisible characters and look-alike letters.'));
    return;
  }
  const c = compareTexts(a, b);
  const text = {
    identical: 'Identical — the same code points.',
    normalized: 'Same text, different Unicode normalization (é as one or two code points).',
    hidden: 'They look the same, but they are not: the difference is invisible characters, look-alike letters or compatibility forms.',
    visible: 'They differ in visible text.',
  }[c.verdict];
  banner.hidden = false;
  banner.className = 'banner ' + (c.verdict === 'identical' ? 'ok' : c.verdict === 'hidden' ? 'bad' : '');
  banner.textContent = '';
  banner.append(h('span', { text }), h('span', { class: 'spacer' }), c.verdict !== 'identical' ? h('span', { class: 'muted small', text: `${c.removed} only in A · ${c.added} only in B` }) : null);
  $('insCount').textContent = c.changes ? `${c.changes} change${c.changes === 1 ? '' : 's'}` : '';
  if (c.verdict === 'identical') return;

  // merged view: invisible characters shown as ⟨marks⟩
  const pre = h('div', { class: 'diff' });
  let budget = 20000;
  for (const op of c.ops) {
    if (budget <= 0) break;
    const shown = op.op === '=' && op.text.length > 400 ? op.text.slice(0, 180) + ' … ' + op.text.slice(-180) : op.text;
    const v = visualize(shown, 4000);
    budget -= v.length;
    if (op.op === '=') pre.append(v);
    else pre.append(h(op.op === '-' ? 'del' : 'ins', { title: op.op === '-' ? 'Only in A' : 'Only in B', text: v }));
  }
  out.append(pre);

  // every change, character by character
  let line = 1;
  let col = 1;
  let n = 0;
  for (const op of c.ops) {
    if (op.op !== '=' && n < 200) {
      n++;
      const cps = [...op.text];
      const infos = cps.slice(0, 40).map((ch) => charInfo(ch.codePointAt(0)));
      out.append(
        row({
          cls: 'char',
          head: [h('span', { class: 'pill wide ' + (op.op === '-' ? 'critical' : 'low'), text: op.op === '-' ? 'A only' : 'B only' }), h('span', { class: 'hex', text: `${line}:${col}` }), ...infos.slice(0, 6).map(glyphEl), h('span', { class: 'label', text: infos.length === 1 ? infos[0].name : `${cps.length} code points` }), ...flagChips([...new Set(infos.flatMap((i) => i.flags))])],
          value: infos.map((i) => `${i.hex} ${i.name}`).join(' · ').slice(0, 400),
          valueClass: 'dim',
          detail: (box) => {
            for (const i of infos) box.append(charRow({ ...i, index: -1 }));
          },
        }),
      );
    }
    if (op.op !== '+') {
      for (const ch of op.text) {
        if (ch === '\n') {
          line++;
          col = 1;
        } else col += ch.length;
      }
    }
  }
}

function render() {
  if (!ready) return;
  const compare = mode.get() === 'compare';
  $('insCharsIo').hidden = compare;
  $('insCompareIo').hidden = !compare;
  $('insUnusual').closest('label').hidden = compare;
  if (compare) renderCompare();
  else renderChars();
}

export async function init(c) {
  ctx = c;
  mode = seg($('insMode'), () => {
    render();
    (mode.get() === 'compare' ? $('insA') : $('insIn')).focus();
  });
  $('insOut').append(empty('…', 'Loading Unicode data', ''));
  await loadUnicodeData();
  ready = true;
  const later = debounce(render, 150);
  for (const id of ['insIn', 'insA', 'insB']) $(id).addEventListener('input', later);
  $('insUnusual').addEventListener('change', render);
  await Promise.all([keepDraft($('insIn'), 'inspect'), keepDraft($('insA'), 'inspectA'), keepDraft($('insB'), 'inspectB')]);
  // "Inspect characters" from the right-click menu
  try {
    const { inspectText: fromMenu } = (await chrome.storage?.session?.get('inspectText')) || {};
    if (fromMenu) {
      setValue($('insIn'), fromMenu);
      chrome.storage.session.remove('inspectText');
    }
  } catch {
    /* outside the extension */
  }
  render();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    mode.set('chars', false);
    setValue($('insIn'), payload.text);
    render();
  }
  if (payload?.a !== undefined) {
    mode.set('compare', false);
    setValue($('insA'), payload.a);
    setValue($('insB'), payload.b ?? '');
    render();
  }
}
