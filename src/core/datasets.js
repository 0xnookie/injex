// Benchmark datasets as seed prompts: where they live, which field holds the prompt, how rows are
// labelled and under which licence they are published. injex never bundles them; `injex import` reads a
// local file or — only with --fetch — the Hugging Face datasets-server JSON API (no Parquet parser
// needed), and every imported row carries its dataset, id and licence.

import { parseSeedYaml } from './seedyaml.js';

export const DATASETS = {
  jbb: { title: 'JailbreakBench JBB-Behaviors (harmful)', hf: 'JailbreakBench/JBB-Behaviors', config: 'behaviors', split: 'harmful', text: 'Goal', id: 'Index', meta: ['Behavior', 'Category', 'Source'], label: 1, license: 'MIT' },
  'jbb-benign': { title: 'JailbreakBench JBB-Behaviors (benign)', hf: 'JailbreakBench/JBB-Behaviors', config: 'behaviors', split: 'benign', text: 'Goal', id: 'Index', meta: ['Behavior', 'Category'], label: 0, license: 'MIT' },
  'cyberseceval-pi': { title: 'CyberSecEval prompt injection (PurpleLlama)', url: 'https://raw.githubusercontent.com/meta-llama/PurpleLlama/main/CybersecurityBenchmarks/datasets/prompt_injection/prompt_injection.json', text: 'user_input', meta: ['test_case_prompt', 'judge_question', 'injection_type', 'injection_variant', 'risk_category', 'speaking_language'], label: 1, license: 'MIT' },
  deepset: { title: 'deepset prompt-injections', hf: 'deepset/prompt-injections', config: 'default', split: 'train', text: 'text', labelField: 'label', license: 'Apache-2.0' },
  gandalf: { title: 'Lakera Gandalf ignore-instructions', hf: 'Lakera/gandalf_ignore_instructions', config: 'default', split: 'train', text: 'text', label: 1, license: 'MIT' },
  'llmail-inject': { title: 'Microsoft LLMail-Inject challenge', hf: 'microsoft/llmail-inject-challenge', config: 'default', split: 'Phase1', text: 'body', meta: ['subject', 'scenario', 'objectives'], label: 1, license: 'MIT' },
  notinject: { title: 'NotInject (benign text with trigger words)', hf: 'leolee99/NotInject', config: 'default', split: 'NotInject_one', text: 'prompt', label: 0, license: 'MIT' },
  promptshield: { title: 'PromptShield', hf: 'hendzh/PromptShield', config: 'default', split: 'train', text: 'prompt', labelField: 'label', license: 'Apache-2.0' },
  'jailbreak-classification': { title: 'jackhhao jailbreak-classification', hf: 'jackhhao/jailbreak-classification', config: 'default', split: 'train', text: 'prompt', labelField: 'type', positive: 'jailbreak', license: 'Apache-2.0' },
  strongreject: { title: 'StrongREJECT', hf: 'walledai/StrongREJECT', config: 'default', split: 'train', text: 'prompt', meta: ['category', 'source'], label: 1, license: 'MIT' },
  'tensor-trust': { title: 'Tensor Trust attacks', hf: 'qxcv/tensor-trust', config: 'default', split: 'train', text: 'attack', meta: ['pre_prompt', 'post_prompt'], label: 1, license: 'unknown' },
  wasp: { title: 'WASP web-agent prompt injection', license: 'CC-BY-NC-4.0', note: 'non-commercial: download it yourself from github.com/facebookresearch/wasp and import the file' },
};

const TEXT_FIELDS = ['text', 'prompt', 'goal', 'Goal', 'attack', 'user_input', 'body', 'input', 'question', 'instruction', 'content'];

/** Is a licence one that limits reuse (non-commercial / share-alike / unknown)? */
export function licenceWarning(license) {
  const l = String(license || 'unknown');
  if (/NC/i.test(l)) return `${l}: non-commercial use only`;
  if (/SA/i.test(l)) return `${l}: share-alike — derived data must keep the licence`;
  if (/unknown|other/i.test(l)) return `licence ${l}: check the terms before publishing derived data`;
  return '';
}

/** One raw record → an import row { text, id, dataset, license, label?, goal?, meta? } (or null). */
export function normalizeRecord(rec, spec = {}, index = 0) {
  if (rec == null) return null;
  if (typeof rec === 'string') rec = { text: rec };
  const field = spec.text || TEXT_FIELDS.find((f) => typeof rec[f] === 'string' && rec[f].trim());
  const text = field ? rec[field] : '';
  if (typeof text !== 'string' || !text.trim()) return null;
  let label = spec.label;
  if (spec.labelField !== undefined && rec[spec.labelField] !== undefined) {
    const v = rec[spec.labelField];
    label = spec.positive !== undefined ? Number(String(v) === String(spec.positive)) : Number(v === true || v === 1 || /^(1|true|injection|jailbreak|malicious|unsafe|attack)$/i.test(String(v)));
  }
  const meta = {};
  for (const k of spec.meta || []) if (rec[k] !== undefined) meta[k] = rec[k];
  return {
    text,
    id: String(rec[spec.id || 'id'] ?? rec.sample_id ?? rec.RowKey ?? index + 1),
    ...(spec.dataset ? { dataset: spec.dataset } : {}),
    license: spec.license || 'unknown',
    ...(label !== undefined ? { label } : {}),
    ...(rec.Behavior || rec.goal ? { goal: rec.Behavior || rec.goal } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
  };
}

/** Records from a local file's text: JSON (array or { rows / data }), JSONL, CSV / TSV, or plain lines. */
export function parseRecords(text, name = '') {
  if (/.(ya?ml|prompt)$/i.test(name)) return parseSeedYaml(String(text));
  const t = String(text).replace(/^\uFEFF/, '');
  if (/\.jsonl$/i.test(name) || (!/\.json$/i.test(name) && /^\s*\{/.test(t) &&t.trim().split('\n').every((l) => !l.trim() || /^\s*\{/.test(l)))) {
    try {
      return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch {
      /* fall through */
    }
  }
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(t)) {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return j;
    for (const k of ['rows', 'data', 'examples', 'payloads', 'prompts', 'items']) if (Array.isArray(j[k])) return j[k].map((x) => (x && x.row ? x.row : x));
    return [j];
  }
  if (/\.(csv|tsv)$/i.test(name)) return parseCsv(t, /\.tsv$/i.test(name) ? '\t' : ',');
  return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ text: l }));
}

/** RFC 4180 CSV → objects keyed by the header row. */
export function parseCsv(text, sep = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** Hugging Face datasets-server URLs (rows are fetched 100 at a time). */
export const HF_API = 'https://datasets-server.huggingface.co';
export const hfSplitsUrl = (ds) => `${HF_API}/splits?dataset=${encodeURIComponent(ds)}`;
export const hfRowsUrl = (ds, config, split, offset, length = 100) => `${HF_API}/rows?dataset=${encodeURIComponent(ds)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${length}`;
