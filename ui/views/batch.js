// Batch: every prompt through every chosen transform (optionally wrapped in a template), exported for a
// red-team harness — JSONL, CSV, JSON, a promptfoo tests file or plain text.

import { list, canDecode, transforms as ALL, CATEGORIES, CATEGORY_ORDER } from '../../src/core/registry.js';
import { buildBatch, formatBatch, TEMPLATES, FORMATS, MAX_ROWS } from '../../src/core/batch.js';
import { visualize } from '../../src/core/scan.js';
import { $, h, debounce, seg, empty, row, mini, matcher, keepDraft, download, clip } from '../lib.js';

let ctx;
let fmt;
let result = { rows: [], errors: 0, capped: false };
const VISIBLE = /[^\s\p{Cf}\p{Cc}\p{Mn}\u{FE00}-\u{FE0F}\u{E0000}-\u{E01EF}]/u;
const PREVIEW = 80;

function prompts() {
  const text = $('batIn').value;
  if ($('batWhole').checked) return text.trim() ? [text] : [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function chosen() {
  const match = matcher($('batFilter').value);
  const cat = $('batCat').value;
  const fav = $('batFav').checked;
  const rev = $('batRev').checked;
  return list().filter((t) => t.category !== 'special' && t.category !== 'defense' && (!cat || t.category === cat) && (!fav || ctx.settings.favorites.includes(t.key)) && (!rev || canDecode(t)) && (match(t.name) || match(t.key) || match(CATEGORIES[t.category]?.label || '')));
}

// the template field is one line: "\n" in it stands for a line break
const template = () => $('batTplText').value.replace(/\\n/g, '\n') || '{payload}';
const shown = (text) => text.replace(/\n/g, '\\n');
const defenses = () => [...document.querySelectorAll('.batDef:checked')].map((c) => ALL[c.value]).filter(Boolean);

function build() {
  const ps = prompts();
  const ts = chosen();
  $('batTCount').textContent = `${ts.length} transform${ts.length === 1 ? '' : 's'}`;
  const ds = defenses();
  $('batStat').textContent = ps.length ? `${ps.length} prompt${ps.length === 1 ? '' : 's'} × ${ts.length}${ds.length ? ` × ${ds.length + 1}` : ''} = ${((ps.length * ts.length + ($('batOrig').checked ? ps.length : 0)) * (ds.length + 1)).toLocaleString()} rows` : '';
  const tpl = TEMPLATES.find((t) => t.text === template());
  result = ps.length && (ts.length || $('batOrig').checked) ? buildBatch({ prompts: ps, transforms: ts, template: template(), templateId: tpl?.id || 'custom', includeOriginal: $('batOrig').checked, defenses: ds, seed: $('batSeed').value.trim(), version: globalThis.chrome?.runtime?.getManifest?.().version || '' }) : { rows: [], errors: 0, capped: false };
  render();
}

function render() {
  const out = $('batOut');
  out.textContent = '';
  const { rows, errors, capped } = result;
  const size = rows.length ? new Blob([formatBatch(rows, fmt.get())]).size : 0;
  $('batMeta').textContent = rows.length ? `${rows.length.toLocaleString()} rows · ${size > 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.ceil(size / 1024) + ' KB'}${errors ? ` · ${errors} failed` : ''}${capped ? ` · capped at ${MAX_ROWS.toLocaleString()}` : ''}` : '';
  ctx.setCount('batch', rows.length || null);
  if (!rows.length) {
    out.append(
      empty(
        '⇉',
        'Test prompts in bulk',
        'Write a prompt or several (one per line). Each goes through every transform that matches the filters — optionally through a spotlighting defense and wrapped in a template — and you download the set as JSONL, CSV, JSON, a promptfoo tests file, an Inspect dataset, a garak payload file or text. Every row records its transform, seed, defense, tags and hashes (injex.row/1).',
      ),
    );
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of rows.slice(0, PREVIEW)) {
    frag.append(
      row({
        head: [h('span', { class: 'pill ' + (r.category || 'format'), text: CATEGORIES[r.category]?.short || 'PLAIN' }), h('span', { class: 'label', text: r.name + (r.defense && r.defense !== 'none' ? ' + ' + ALL[r.defense]?.name.replace('Spotlight: ', '') : '') }), h('span', { class: 'src', text: '#' + r.id }), h('span', { class: 'spacer' }), mini('Copy', () => ctx.copy(r.prompt, r.name), { iconName: 'copy', title: 'Copy this prompt' })],
        value: VISIBLE.test(r.payload) ? r.prompt.replace(/\s+/g, ' ').slice(0, 300) : visualize(r.prompt.replace(/\s+/g, ' '), 300),
        detail: (box) => {
          box.append(h('pre', { class: 'out tall' }, clip(r.prompt, 20000)));
          const dl = h('dl', { class: 'meta' });
          dl.append(h('dt', { text: 'Original' }), h('dd', { text: r.original.slice(0, 500) }), h('dt', { text: 'Transform' }), h('dd', { text: `${r.name} (${r.transform})` }), h('dt', { text: 'Defense' }), h('dd', { text: r.defense }), h('dt', { text: 'Tags' }), h('dd', { text: (r.tags || []).join(' · ') || '—' }));
          box.append(dl);
        },
      }),
    );
  }
  if (rows.length > PREVIEW) frag.append(h('div', { class: 'hint', text: `Preview of the first ${PREVIEW} — the export has all ${rows.length.toLocaleString()}.` }));
  out.append(frag);
}

function exported() {
  if (!result.rows.length) {
    ctx.toast('Nothing to export — add a prompt', true);
    return null;
  }
  return formatBatch(result.rows, fmt.get());
}

export async function init(c) {
  ctx = c;
  for (const k of CATEGORY_ORDER) if (k !== 'special' && k !== 'defense') $('batCat').append(h('option', { value: k, text: CATEGORIES[k].label }));
  for (const t of TEMPLATES) $('batTpl').append(h('option', { value: t.id, text: t.label }));
  $('batTpl').append(h('option', { value: 'custom', text: 'Custom' }));
  $('batTplText').value = shown(TEMPLATES[0].text);
  $('batTpl').addEventListener('change', () => {
    const t = TEMPLATES.find((x) => x.id === $('batTpl').value);
    if (t) $('batTplText').value = shown(t.text);
    build();
  });
  $('batTplText').addEventListener(
    'input',
    debounce(() => {
      $('batTpl').value = TEMPLATES.find((x) => x.text === template())?.id || 'custom';
      build();
    }, 200),
  );
  for (const [k, f] of Object.entries(FORMATS)) $('batFmt').append(h('button', { 'data-v': k, class: k === 'jsonl' ? 'on' : '', text: f.label }));
  fmt = seg($('batFmt'), render);
  const later = debounce(build, 250);
  $('batIn').addEventListener('input', later);
  $('batFilter').addEventListener('input', later);
  for (const id of ['batCat', 'batFav', 'batRev', 'batOrig', 'batWhole']) $(id).addEventListener('change', build);
  for (const c of document.querySelectorAll('.batDef')) c.addEventListener('change', build);
  $('batSeed').addEventListener('input', later);
  $('batCopy').addEventListener('click', () => {
    const data = exported();
    if (data) ctx.copy(data, `Batch (${FORMATS[fmt.get()].label})`);
  });
  $('batSave').addEventListener('click', () => {
    const data = exported();
    if (!data) return;
    const f = FORMATS[fmt.get()];
    download(`injex-batch-${new Date().toISOString().slice(0, 10)}.${f.ext}`, data, f.type + ';charset=utf-8');
    ctx.toast(`Downloaded ${result.rows.length.toLocaleString()} rows (${f.label})`);
  });
  await keepDraft($('batIn'), 'batch');
  build();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    $('batIn').value = payload.text;
    build();
  }
}

export function onSettings(changes) {
  if (changes.favorites || changes.recipes || changes.customAlphabets) build();
}
