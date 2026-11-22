// Spelling alphabets: your own NATO-style word lists. Saved ones become transforms (category Custom).

import { LETTERS, makeSpellingTransform, setCustomAlphabets, slug } from '../../src/core/registry.js';
import { chat, alphabetPrompt } from '../../src/core/openrouter.js';
import { aiConsent, AI_CONSENT_DECLINED } from '../../src/core/consent.js';
import { $, h, row, mini, twoClick, empty, busy } from '../lib.js';

let ctx;
let editing = null; // name of the alphabet being edited
const inputs = {};

function words() {
  return LETTERS.map((L) => inputs[L].value.trim());
}

function fill(alpha) {
  $('aName').value = alpha?.name || '';
  $('aTheme').value = alpha?.theme || '';
  LETTERS.forEach((L, i) => (inputs[L].value = alpha?.words?.[i] || ''));
  editing = alpha?.name || null;
  $('aTitle').textContent = editing ? `Edit “${editing}”` : 'New spelling alphabet';
  msg('');
}

function msg(text, err = false) {
  const m = $('aMsg');
  m.textContent = text;
  m.className = 'hint' + (err ? ' err' : '');
}

async function save() {
  const name = $('aName').value.trim();
  const w = words();
  if (!name) return msg('Give the alphabet a name.', true);
  const missing = LETTERS.filter((L, i) => !w[i]);
  if (missing.length === 26) return msg('Fill in at least one word.', true);
  const bad = LETTERS.filter((L, i) => w[i] && w[i][0].toUpperCase() !== L);
  const list = (ctx.settings.customAlphabets || []).filter((a) => a.name !== editing && a.name !== name);
  if (list.some((a) => slug(a.name) === slug(name))) return msg('An alphabet with a similar name exists.', true);
  const alpha = { name, theme: $('aTheme').value.trim(), words: w };
  const next = [...list, alpha].sort((a, b) => a.name.localeCompare(b.name));
  setCustomAlphabets(next);
  await ctx.save({ customAlphabets: next });
  editing = name;
  $('aTitle').textContent = `Edit “${name}”`;
  msg(`Saved${missing.length ? ` — ${missing.length} letter${missing.length === 1 ? '' : 's'} stay as-is` : ''}${bad.length ? ` · ${bad.join(', ')} don't start with their letter` : ''}. Find it under Transform → Custom.`);
  renderList();
}

async function generate() {
  const theme = $('aTheme').value.trim() || $('aName').value.trim();
  if (!theme) return msg('Enter a theme (or a name) first.', true);
  if (!ctx.settings.openrouterKey) {
    msg('Add an OpenRouter key in Settings to generate alphabets.', true);
    return;
  }
  if (!(await aiConsent())) return msg(AI_CONSENT_DECLINED, true);
  const btn = $('aGen');
  busy(btn, true);
  msg('Asking the model…');
  try {
    const text = await chat({ key: ctx.settings.openrouterKey, model: ctx.settings.models?.promptcraft, user: alphabetPrompt(theme), temperature: 0.8, maxTokens: 600 });
    let n = 0;
    for (const line of text.split('\n')) {
      const m = line.match(/^\W*([A-Za-z])\s*[:.)\-–—]\s*([^\s,;]+(?:[ -][^\s,;]+)?)/);
      if (m && inputs[m[1].toUpperCase()]) {
        inputs[m[1].toUpperCase()].value = m[2].replace(/[*_`"]/g, '').trim();
        n++;
      }
    }
    if (!$('aName').value.trim()) $('aName').value = theme.replace(/\b\w/g, (c) => c.toUpperCase()) + ' Alphabet';
    msg(n ? `Filled ${n} letters — review and save.` : 'The model answered in an unexpected format.', !n);
  } catch (e) {
    msg(e.message || String(e), true);
  } finally {
    busy(btn, false);
  }
}

function renderList() {
  const list = ctx.settings.customAlphabets || [];
  $('aCount').textContent = list.length;
  const box = $('aList');
  box.textContent = '';
  if (!list.length) {
    box.append(empty('A', 'No alphabets yet', 'Saved alphabets appear in the Transform and Decode tabs and in the right-click menu settings.'));
    return;
  }
  for (const a of list) {
    const t = makeSpellingTransform(a);
    const del = h('button', { class: 'mini', title: 'Delete' }, 'Delete');
    twoClick(del, async () => {
      const next = (ctx.settings.customAlphabets || []).filter((x) => x.name !== a.name);
      setCustomAlphabets(next);
      await ctx.save({ customAlphabets: next });
      if (editing === a.name) fill(null);
      renderList();
    });
    box.append(
      row({
        head: [
          h('span', { class: 'pill custom', text: 'CUSTOM' }),
          h('span', { class: 'label', text: a.name }),
          a.theme ? h('span', { class: 'src', text: a.theme }) : null,
          h('span', { class: 'spacer' }),
          mini('Use', () => ctx.switchTo('transform', { filter: a.name }), { iconName: 'use' }),
          mini('Edit', () => fill(a), { iconName: 'edit' }),
          del,
        ],
        value: t.func('HELLO WORLD'),
      }),
    );
  }
}

export function init(c) {
  ctx = c;
  for (const L of LETTERS) {
    inputs[L] = h('input', { type: 'text', placeholder: L === 'A' ? 'Alpha' : '', spellcheck: false });
    $('aGrid').append(h('label', {}, L, inputs[L]));
  }
  $('aSave').addEventListener('click', save);
  $('aReset').addEventListener('click', () => fill(null));
  $('aGen').addEventListener('click', generate);
  renderList();
}

export function onSettings(changes) {
  if (changes.customAlphabets) renderList();
}
