// injex run results files (JSON lines) without Node: parse, tell the line kinds apart, merge and dedup —
// shared by the CLI (`injex results`, `injex report`) and the extension's Results view.
//
//   injex.run/1     one header per `injex run` invocation: target, sampling, scorers, judge prompt hash
//   injex.result/2  one trial (injex.result/1 from injex 1.3–1.4 reads the same)
//   injex.label/1   a human label (injex review, the Results view)

import { resultKey } from './labels.js';

export const RESULT_SCHEMA = 'injex.result/2';
export const RUN_SCHEMA = 'injex.run/1';

/** JSON lines → objects (lines that don't parse, e.g. one cut off by an interrupted run, are skipped). */
export function parseJsonl(text) {
  const out = [];
  for (const l of String(text).split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* a partial line */
    }
  }
  return out;
}

export const isResult = (r) => !!r && typeof r === 'object' && (!r.schema || /^injex\.result\//.test(r.schema)) && r.row_id !== undefined;
export const isHeader = (r) => r?.schema === RUN_SCHEMA;
export const isLabel = (r) => r?.schema === 'injex.label/1';

/** Only the trial lines (no headers, no labels). */
export const onlyResults = (lines) => lines.filter(isResult);

/**
 * One answer per (model, row, trial, input): the last answer wins over earlier ones and over errors; an
 * error is kept only when the trial never got an answer. Header and label lines pass through untouched.
 */
export function dedupResults(lines) {
  const out = [];
  const at = new Map();
  for (const r of lines) {
    if (r?.schema && !/^injex\.result\//.test(r.schema)) {
      out.push(r);
      continue;
    }
    const k = resultKey(r);
    if (!at.has(k)) {
      at.set(k, out.length);
      out.push(r);
    } else if (!r.error || out[at.get(k)].error) out[at.get(k)] = r;
  }
  return out;
}
