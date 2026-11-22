// Tokenizer: how a tokenizer cuts the text, with IDs and counts — the bundled GPT encodings (offline) or a
// Hugging Face tokenizer.json the person loads (Llama, Qwen, Mistral, Gemma, BERT …), kept in IndexedDB.

import { ENGINES, tokenize, loadEncoding, tokenNotes } from '../../src/core/tokenizer.js';
import { loadHfTokenizer } from '../../src/core/hftokenizer.js';
import { getFile, putFile, deleteFile } from '../../src/core/store.js';
import { visualize } from '../../src/core/scan.js';
import { $, h, debounce, empty, bytes, chars, mini, keepDraft, setValue, showWs } from '../lib.js';

const VISIBLE = /[^\s\p{Cf}\p{Cc}\p{Mn}\u{FE00}-\u{FE0F}\u{E0000}-\u{E01EF}]/u;
const HF_KEY = 'tokenizer.json';

let ctx;
let seq = 0;
let lastTokens = [];
let hf = null; // the parsed tokenizer.json
let hfLoading = null;

function stat(label, value) {
  return h('div', { class: 'stat-box' }, h('b', { text: value }), h('span', { text: label }));
}

/** The stored tokenizer.json, parsed on first use (a 17 MB Llama 3 file takes a moment). */
function storedHf() {
  if (hf) return Promise.resolve(hf);
  hfLoading ||= (async () => {
    const f = await getFile(HF_KEY);
    if (!f?.text) return null;
    hf = loadHfTokenizer(f.text, f.name);
    return hf;
  })().finally(() => (hfLoading = null));
  return hfLoading;
}

function syncEngineUi() {
  const opt = $('kEngine').querySelector('option[value="hf"]');
  const name = ctx.settings.hfTokenizer;
  opt.textContent = name ? `tokenizer.json: ${name}` : 'Your tokenizer.json…';
  $('kForget').hidden = !(name && $('kEngine').value === 'hf');
}

async function loadFile(file) {
  if (!file) return;
  $('kStat').textContent = 'reading tokenizer.json…';
  let tok;
  let text;
  try {
    text = await file.text();
    tok = loadHfTokenizer(text, file.name);
  } catch (e) {
    $('kStat').textContent = '';
    ctx.toast(`Not a usable tokenizer.json: ${e.message || e}`, true);
    return;
  }
  hf = tok;
  const kept = await putFile(HF_KEY, { name: file.name, text, size: file.size, at: Date.now() });
  await ctx.save({ tokenizer: 'hf', hfTokenizer: file.name });
  $('kEngine').value = 'hf';
  syncEngineUi();
  ctx.toast(`${file.name}: ${tok.kind}, ${tok.vocabSize.toLocaleString()} tokens${kept ? '' : ' (kept for this window only)'}`);
  run();
}

async function forget() {
  await deleteFile(HF_KEY);
  hf = null;
  await ctx.save({ tokenizer: 'o200k_base', hfTokenizer: '' });
  $('kEngine').value = 'o200k_base';
  syncEngineUi();
  run();
}

async function run() {
  const text = $('kIn').value;
  const engine = $('kEngine').value;
  const out = $('kOut');
  const my = ++seq;
  if (!text) {
    out.textContent = '';
    $('kStat').textContent = '';
    out.append(empty('▦', 'See how a model reads your text', 'Each coloured block is one token. Unicode tricks, emoji and invisible characters usually cost far more tokens than they look. Load a tokenizer.json to see an open model or a classifier (BERT, DeBERTa) — and what its normalizer throws away.'));
    return;
  }
  let toks;
  try {
    if (engine === 'hf' && !hf) {
      $('kStat').textContent = 'loading tokenizer.json…';
      if (!(await storedHf())) throw new Error('No tokenizer.json is loaded: use “tokenizer.json…” to pick one (it stays on this computer).');
    }
    if (ENGINES[engine]?.bpe && !globalThis['GPTTokenizer_' + engine]) $('kStat').textContent = 'loading tokenizer…';
    toks = await tokenize(text, engine, ctx.vendorBase + 'gpt-tokenizer/', { hf });
  } catch (e) {
    if (my === seq) {
      out.textContent = '';
      $('kStat').textContent = '';
      out.append(h('div', { class: 'card bad' }, h('b', { text: 'Tokenizer failed' }), h('div', { class: 'hint', text: e.message || String(e) })));
    }
    return;
  }
  if (my !== seq) return;
  lastTokens = toks;
  const n = toks.length;
  $('kStat').textContent = `${n.toLocaleString()} token${n === 1 ? '' : 's'}`;
  out.textContent = '';
  out.append(
    h(
      'div',
      { class: 'stats', style: 'margin-bottom: 12px' },
      stat('tokens', n.toLocaleString()),
      stat('characters', chars(text).toLocaleString()),
      stat('UTF-8 bytes', bytes(text).toLocaleString()),
      stat('chars / token', n ? (chars(text) / n).toFixed(2) : '—'),
    ),
  );
  if (engine === 'hf') out.append(h('div', { class: 'hint', style: 'margin: -4px 2px 10px' }, `${hf.name} · ${hf.kind} · ${hf.vocabSize.toLocaleString()} tokens in the vocabulary · IDs as encode(text) without BOS / EOS`));
  for (const note of tokenNotes(text, toks, engine === 'hf' ? hf.normalize : null)) {
    out.append(note.level === 'warn' ? h('div', { class: 'card warn', style: 'margin-bottom: 8px; padding: 8px 12px' }, note.text) : h('div', { class: 'hint', style: 'margin: -4px 2px 10px' }, note.text));
  }
  const box = h('div', { class: 'tokens' });
  const MAX = 6000;
  for (const t of toks.slice(0, MAX)) {
    const flags = [t.partial && 'part of a multi-byte character', t.unk && 'unknown token', t.special && 'special token'].filter(Boolean);
    // an unknown token is often also a special one ([UNK]); unknown is what matters
    const el = h('span', { class: 'tok' + (t.partial ? ' partial' : '') + (t.unk ? ' unk' : t.special ? ' special' : ''), title: [t.id !== undefined ? `#${t.id}` : '', ...flags].filter(Boolean).join(' · ') });
    // whitespace drawn as dim marks (· → ↵), the rest as is
    for (const part of t.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) el.append(h('span', { class: 'ws', text: showWs(part) }), part.includes('\n') ? '\n' : '');
      // invisible characters (tags, selectors, zero-width) would draw an empty token: name them
      else if (!VISIBLE.test(part)) el.append(h('span', { class: 'ws', text: visualize(part, 80) }));
      else el.append(part);
    }
    box.append(el);
  }
  if (toks.length > MAX) box.append(h('div', { class: 'muted small', text: `… ${(toks.length - MAX).toLocaleString()} more tokens not drawn` }));
  out.append(box);
  if ($('kIds').checked && toks[0]?.id !== undefined) {
    const ids = toks.map((t) => t.id).join(', ');
    out.append(
      h('div', { class: 'card-head', style: 'margin: 14px 0 6px' }, h('b', { text: 'Token IDs' }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy('[' + ids + ']', 'Token IDs'), { iconName: 'copy' })),
      h('div', { class: 'ids' }, ids.length > 60000 ? ids.slice(0, 60000) + ' …' : ids),
    );
  }
  out.append(h('div', { class: 'row-actions', style: 'margin-top: 14px' }, h('button', { class: 'btn', onclick: compare }, 'Compare tokenizers'), h('span', { class: 'hint', id: 'kCompare' })));
}

async function compare() {
  const text = $('kIn').value;
  const hint = $('kCompare');
  hint.textContent = 'counting…';
  const parts = [];
  for (const [name, e] of Object.entries(ENGINES)) {
    if (!e.bpe) continue;
    try {
      const enc = await loadEncoding(name, ctx.vendorBase + 'gpt-tokenizer/');
      parts.push(`${name.replace('_base', '')}: ${enc.encode(text, { allowedSpecial: 'all' }).length.toLocaleString()}`);
    } catch {
      parts.push(`${name}: failed`);
    }
  }
  if (ctx.settings.hfTokenizer) {
    try {
      const tok = await storedHf();
      if (tok) parts.push(`${ctx.settings.hfTokenizer}: ${tok.count(text).toLocaleString()}`);
    } catch {
      parts.push(`${ctx.settings.hfTokenizer}: failed`);
    }
  }
  hint.textContent = parts.join(' · ');
}

export async function init(c) {
  ctx = c;
  const sel = $('kEngine');
  for (const [k, e] of Object.entries(ENGINES)) sel.append(h('option', { value: k, text: e.label }));
  sel.append(h('option', { value: 'hf', text: 'Your tokenizer.json…' }));
  const saved = ctx.settings.tokenizer;
  sel.value = ENGINES[saved] || (saved === 'hf' && ctx.settings.hfTokenizer) ? saved : 'o200k_base';
  let previous = sel.value;
  syncEngineUi();
  sel.addEventListener('change', () => {
    if (sel.value === 'hf' && !ctx.settings.hfTokenizer) {
      sel.value = previous; // until a file is picked
      $('kFile').click();
      return;
    }
    previous = sel.value;
    ctx.save({ tokenizer: sel.value });
    syncEngineUi();
    run();
  });
  $('kLoad').addEventListener('click', () => $('kFile').click());
  $('kForget').addEventListener('click', forget);
  $('kFile').addEventListener('change', (e) => {
    loadFile(e.target.files[0]).then(() => (previous = sel.value));
    e.target.value = '';
  });
  $('kIds').addEventListener('change', run);
  $('kIn').addEventListener('input', debounce(run, 200));
  await keepDraft($('kIn'), 'tokens');
  run();
}

export function activate(payload) {
  if (payload?.text !== undefined) setValue($('kIn'), payload.text);
}
