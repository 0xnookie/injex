// Results: open `injex run` results files (JSON lines) — attack success per variant with Wilson intervals,
// the answers behind each number, and human labels that override the automatic score (saved as
// labels.jsonl for `injex report --labels` / `injex judge-eval`). Files are read locally; nothing is
// uploaded or stored.

import { summarize } from '../../src/core/score.js';
import { parseJsonl, dedupResults, onlyResults, isHeader, isLabel } from '../../src/core/results.js';
import { LABELS, makeLabel, applyLabels, agreement, resultKey } from '../../src/core/labels.js';
import { resultsCsv } from '../../src/core/resultsfmt.js';
import { visualize } from '../../src/core/scan.js';
import { $, h, seg, empty, row, download, clip } from '../lib.js';

let ctx;
let by;
let lines = []; // everything loaded: headers, results, labels
let labels = []; // labels loaded plus labels made here
let made = 0; // labels made here (not yet saved)
let files = [];

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const sevOf = (rate) => (rate >= 0.5 ? 'high' : rate >= 0.2 ? 'medium' : rate > 0 ? 'low' : 'ok');
const OUTCOME_SEV = { full: 'high', refuse_then_comply: 'high', partial: 'medium', refusal: 'ok', evasion: 'low' };

function stat(label, value) {
  return h('div', { class: 'stat-box' }, h('b', { text: value }), h('span', { text: label }));
}

async function load(list) {
  const added = [];
  for (const f of list) {
    try {
      const got = parseJsonl(await f.text());
      if (!got.some((x) => isHeader(x) || isLabel(x) || x?.row_id !== undefined)) {
        ctx.toast(`${f.name}: no injex run results or labels in it`, true);
        continue;
      }
      added.push(...got);
      files.push(f.name);
    } catch (e) {
      ctx.toast(`${f.name}: ${e.message || e}`, true);
    }
  }
  lines = dedupResults([...lines.filter((l) => !isLabel(l)), ...added.filter((l) => !isLabel(l))]);
  labels.push(...added.filter(isLabel));
  render();
}

function current() {
  const results = onlyResults(lines);
  return labels.length ? applyLabels(results, labels) : results;
}

function label(r, name) {
  labels.push(makeLabel(r, name, { rater: ctx.settings.rater || 'extension' }));
  made++;
  render();
}

function trialRow(r) {
  const el = trialRowEl(r);
  el.dataset.key = 't:' + resultKey(r);
  return el;
}

function trialRowEl(r) {
  const oc = r.error ? 'error' : r.outcome || r.scores?.outcome || (r.success ? 'success' : 'failure');
  const s = r.scores || {};
  return row({
    cls: r.success ? 'sev-high' : '',
    head: [
      h('span', { class: `pill wide ${r.error ? 'medium' : OUTCOME_SEV[oc] || (r.success ? 'high' : 'ok')}`, text: oc.replace(/_/g, ' ') }),
      h('span', { class: 'label', text: `row ${r.row_id} · trial ${r.trial}` }),
      h('span', { class: 'src', text: [r.model_reported || r.model, s.human ? 'labelled' : '', r.turns > 1 ? `${r.turns} turns` : ''].filter(Boolean).join(' · ') }),
    ],
    value: r.error ? r.error : clip(String(r.response ?? '').replace(/\s+/g, ' '), 220),
    valueClass: 'mono',
    detail: (box) => {
      const meta = h('dl', { class: 'meta' });
      const add = (dt, dd) => dd !== undefined && dd !== '' && meta.append(h('dt', { text: dt }), h('dd', { text: String(dd) }));
      add('Injected', r.original ? clip(r.original, 600) : '');
      add('Variant', `${r.transform_name || r.transform}${r.defense && r.defense !== 'none' ? ' + ' + r.defense : ''}`);
      add('Model', r.model_reported || r.model);
      add('Latency', r.latency_ms ? `${r.latency_ms} ms` : '');
      add('Tokens', r.usage?.input_tokens !== undefined ? `${r.usage.input_tokens} in · ${r.usage.output_tokens} out${r.usage.cost ? ` · $${r.usage.cost}` : ''}` : '');
      box.append(meta);
      if (!r.error) box.append(h('div', { class: 'desc', text: 'Answer (invisible characters shown as ⟨…⟩)' }), h('pre', { class: 'out tall', text: visualize(String(r.response ?? ''), 6000) }));
      const auto = [s.canary !== undefined && `canary ${s.canary ? 'yes' : 'no'}`, s.decode_match !== undefined && `decode-match ${s.decode_match ? 'yes' : 'no'} (${s.decode_score})`, s.refused !== undefined && `refusal ${s.refused ? 'yes' : 'no'}`, s.exfil && 'exfil shape', s.tool_call && `tool call ${(s.tool_call_bad || []).join(', ')}`, s.judge !== undefined && `judge ${s.judge ? 'YES' : 'NO'}`, s.judge_label && `judge ${s.judge_label}`, s.human && `human ${s.human}${s.human_raters > 1 ? ` (${s.human_raters} raters)` : ''}`].filter(Boolean);
      if (auto.length) box.append(h('div', { class: 'desc', text: auto.join(' · ') }));
      if (!r.error)
        box.append(
          h(
            'div',
            { class: 'row-actions' },
            Object.entries(LABELS).map(([k, v]) => h('button', { class: 'btn' + (s.human === k ? ' primary' : ''), title: `Label: ${v.desc}`, onclick: () => label(r, k) }, k.replace(/_/g, ' '))),
          ),
        );
    },
  });
}

/** Open the rows that were open before a re-render (by data-key). */
function reopen(keys) {
  for (const k of keys) document.querySelector(`#rsOut .row[data-key="${CSS.escape(k)}"]:not(.open) > .row-head`)?.click();
}

function render() {
  const out = $('rsOut');
  const wasOpen = [...out.querySelectorAll('.row.open[data-key]')].map((r) => r.dataset.key);
  const scroll = out.scrollTop;
  const stats = $('rsStats');
  out.replaceChildren();
  stats.replaceChildren();
  $('rsSave').hidden = !labels.length;
  $('rsCsv').hidden = $('rsClear').hidden = !lines.length;
  const all = current();
  if (!all.length) {
    $('rsCount').textContent = '';
    out.append(empty('▤', 'No results loaded', 'Drop the results file of injex run (-o results.jsonl) — and labels.jsonl from injex review, if you have one. Label answers here and save the labels for injex report --labels.'));
    return;
  }
  const filter = $('rsFilter').value;
  const shown = all.filter((r) => (filter === 'success' ? r.success && !r.error : filter === 'failure' ? !r.success && !r.error : filter === 'error' ? !!r.error : filter === 'unlabelled' ? !r.error && !r.scores?.human : true));
  const keys = by.get() === 'model' ? ['model'] : by.get() === 'outcome' ? ['outcome'] : by.get() === 'defense' ? ['defense'] : ['transform', 'defense'];
  const groups = summarize(shown, { by: keys });
  const ok = all.filter((r) => !r.error);
  const attacks = ok.filter((r) => !r.control);
  const headers = lines.filter(isHeader);
  stats.append(
    stat('answers', ok.length.toLocaleString()),
    stat('attack success', attacks.length ? pct(attacks.filter((r) => r.success).length / attacks.length) : '—'),
    stat('errors', String(all.length - ok.length)),
    stat('models', String(new Set(ok.map((r) => r.model_reported || r.model)).size)),
    stat('runs', String(headers.length || new Set(all.map((r) => r.run_id).filter(Boolean)).size || 1)),
    stat('labels', `${ok.filter((r) => r.scores?.human).length}${made ? ` (${made} new)` : ''}`),
  );
  if (labels.length) {
    const ag = agreement(onlyResults(lines), labels);
    const dm = ag.signals.find((s) => s.signal === 'decode-match');
    const jd = ag.signals.find((s) => s.signal === 'judge');
    if (dm && dm.n >= 10) stats.append(stat(`decode-match κ vs human (n=${dm.n})`, String(dm.kappa ?? '—')));
    if (jd && jd.n >= 10) stats.append(stat(`judge κ vs human (n=${jd.n})`, String(jd.kappa ?? '—')));
  }
  $('rsCount').textContent = `${shown.length.toLocaleString()} of ${all.length.toLocaleString()} trials · ${files.length} file${files.length === 1 ? '' : 's'}`;
  for (const g of groups) {
    const name = keys.includes('transform') ? `${g.control ? 'control · ' : ''}${g.transform_name}${g.defense && g.defense !== 'none' ? ' + ' + g.defense : ''}` : keys.map((k) => g[k]).join(' · ');
    const members = shown.filter((r) => keys.every((k) => (k === 'model' ? (r.model_reported || r.model || r.target?.model || '—') === g.model : k === 'defense' ? (r.defense || 'none') === g.defense : k === 'outcome' ? (r.outcome || r.scores?.outcome || '—') === g.outcome : r[k] === g[k])));
    const groupEl = (
      row({
        head: [
          h('span', { class: `pill wide ${g.trials ? sevOf(g.asr.rate) : 'low'}`, text: g.trials ? pct(g.asr.rate) : 'errors' }),
          h('span', { class: 'label', text: name }),
          h('span', { class: 'src', text: `${g.successes}/${g.trials}${g.trials ? ` · 95% CI ${pct(g.asr.low)}–${pct(g.asr.high)}` : ''}${g.uplift !== null && g.uplift !== undefined ? ` · ${g.uplift >= 0 ? '+' : ''}${pct(g.uplift)} vs control` : ''}${g.errors ? ` · ${g.errors} errors` : ''}` }),
        ],
        value: Object.entries(g.outcomes || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') || ' ',
        detail: (box) => {
          if (g.asr_rows) box.append(h('div', { class: 'desc', text: `Rows were repeated: counting rows, ${pct(g.asr_rows.rate)} (95% CI ${pct(g.asr_rows.low)}–${pct(g.asr_rows.high)}, cluster bootstrap)${g.hit_at_k ? `; hit@${g.hit_at_k.k} ${pct(g.hit_at_k.rate)}` : ''}${g.tokens ? ` · ${g.tokens.toLocaleString()} tokens` : ''}${g.cost ? ` · $${g.cost}` : ''}` }));
          const list = h('div', { class: 'list' });
          for (const r of members.slice(0, 200)) list.append(trialRow(r));
          if (members.length > 200) list.append(h('div', { class: 'desc', text: `… ${members.length - 200} more — narrow the filter` }));
          box.append(list);
        },
      })
    );
    groupEl.dataset.key = 'g:' + keys.map((k) => g[k]).join('|');
    out.append(groupEl);
  }
  // groups first, then the trials inside them
  reopen(wasOpen.filter((k) => k.startsWith('g:')));
  reopen(wasOpen.filter((k) => k.startsWith('t:')));
  out.scrollTop = scroll;
}

export async function init(c) {
  ctx = c;
  by = seg($('rsBy'), render);
  const drop = $('rsDrop');
  const pick = () => $('rsFile').click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && pick());
  $('rsFile').addEventListener('change', (e) => {
    load([...e.target.files]);
    e.target.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    load([...e.dataTransfer.files]);
  });
  $('rsFilter').addEventListener('change', render);
  $('rsCsv').addEventListener('click', () => download('injex-results.csv', resultsCsv(current()), 'text/csv;charset=utf-8'));
  $('rsSave').addEventListener('click', () => {
    download('labels.jsonl', labels.map((l) => JSON.stringify(l)).join('\n') + '\n', 'application/jsonl;charset=utf-8');
    made = 0;
    render();
  });
  $('rsClear').addEventListener('click', () => {
    if (made && !confirm(`Discard ${made} label${made === 1 ? '' : 's'} you haven't saved?`)) return;
    lines = [];
    labels = [];
    files = [];
    made = 0;
    render();
  });
  render();
}

export function activate() {}

