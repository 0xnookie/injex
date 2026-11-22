// The red-team commands of the CLI: `injex run`, `injex report`, `injex results`, `injex review` and
// `injex judge-eval`. Network traffic happens only in `run`, only to the target given on the command line;
// keys come from the environment (or ${VAR} references in --header values), never from arguments.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, relative } from 'node:path';

export const TARGET_OPTIONS = {
  provider: { type: 'string', default: '' },
  endpoint: { type: 'string', default: '' },
  model: { type: 'string', short: 'm' },
  'target-type': { type: 'string', default: '' },
  header: { type: 'string', multiple: true, default: [] },
  body: { type: 'string' },
  'body-file': { type: 'string' },
  'response-path': { type: 'string' },
  method: { type: 'string' },
  command: { type: 'string' },
  price: { type: 'string' },
  retries: { type: 'string', default: '3' },
  timeout: { type: 'string', default: '60' },
};

const TYPE_ALIASES = { chat: 'openai-chat', openai: 'openai-chat', 'openai-chat': 'openai-chat', anthropic: 'anthropic', responses: 'responses', http: 'http', command: 'command' };

/**
 * A target from command-line options. Returns { target, key, label }. `fail` exits with a usage error.
 * With `judge` the --judge-provider / --judge-endpoint options apply, falling back to the main target's.
 */
export async function targetFromOptions(o, { fail, env = process.env, judge = false }) {
  const T = await import('../src/core/targets.js');
  const { makeTarget } = await import('./run.mjs');
  const pick = (k) => (judge ? o[`judge-${k}`] : o[k]);
  const model = judge ? o['judge-model'] : o.model;
  let type = TYPE_ALIASES[o['target-type'] || ''];
  if (o['target-type'] && !type) fail(`unknown --target-type ${o['target-type']} (${Object.keys(T.TARGET_TYPES).join(', ')}, command, classifier)`);
  let provider = pick('provider') || '';
  let endpoint = pick('endpoint') || '';
  if (judge) {
    // the judge talks to a chat API: its own provider / endpoint, else the main one when that is a chat API
    if (!provider && !endpoint) {
      if (type === 'http' || type === 'command') fail('the judge needs a chat API: add --judge-provider or --judge-endpoint');
      provider = o.provider || '';
      endpoint = o.endpoint || '';
    } else type = undefined;
    if (type === 'http' || type === 'command') type = undefined;
  }
  if (!provider && !endpoint && type !== 'http' && type !== 'command') provider = 'openrouter';
  if (provider && !T.PROVIDERS[provider]) fail(`unknown ${judge ? '--judge-provider' : '--provider'} ${provider} (${Object.keys(T.PROVIDERS).join(', ')}) — or ${judge ? '--judge-endpoint' : '--endpoint'} <base URL>`);
  type ||= provider === 'anthropic' ? 'anthropic' : 'openai-chat';
  const key = type === 'http' || type === 'command' ? '' : T.apiKey(provider, env);
  if (!key && ['openrouter', 'openai', 'anthropic'].includes(provider)) fail(`set ${{ openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }[provider]} (or INJEX_API_KEY) in the environment — keys are never read from arguments`);
  if (!model && type !== 'http' && type !== 'command') fail(`${judge ? '--judge-model' : '--model'} is required (e.g. llama3.2 for Ollama, openai/gpt-4.1-mini for OpenRouter)`);
  const headers = {};
  for (const h of judge ? [] : o.header || []) {
    const m = /^([^:]+):\s*(.*)$/.exec(h);
    if (!m) fail(`--header takes "Name: value", not "${h}"`);
    headers[m[1].trim()] = type === 'http' ? m[2] : T.expandEnv(m[2], env);
  }
  let price;
  if (!judge && o.price) {
    const [pin, pout] = o.price.split(/[,/]/).map(Number);
    if (!Number.isFinite(pin)) fail('--price takes input,output dollars per million tokens, e.g. 0.15,0.60');
    price = { in: pin, out: Number.isFinite(pout) ? pout : pin };
  }
  const url = type === 'http' ? endpoint : type === 'command' ? '' : endpoint || T.PROVIDERS[provider || (type === 'responses' ? 'openai' : 'openrouter')];
  if (type === 'http' && !url) fail('--target-type http needs --endpoint <URL> (and usually --body and --response-path)');
  if (type === 'command' && !o.command) fail('--target-type command needs --command "<program and arguments>"');
  const cfg = {
    type,
    url,
    key,
    model,
    headers,
    timeout: Number(o.timeout || 60) * 1000,
    retries: Math.max(0, Number(o.retries ?? 3) || 0),
    ...(price ? { price } : {}),
    ...(type === 'http' ? { body: o['body-file'] ? readFileSync(o['body-file'], 'utf8') : o.body, responsePath: o['response-path'], method: o.method } : {}),
    ...(type === 'command' ? { command: o.command } : {}),
  };
  const target = makeTarget(cfg);
  const d = target.describe();
  return { target, key, label: type === 'command' ? `a local command (${d.model})` : `${d.host || url} (${model || type})` };
}

const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1) + '%';

/** The summary table of `run` / `results`. */
export function summaryTable(summary, by = ['transform', 'defense']) {
  const name = (g) => (by.includes('transform') ? g.transform_name + (by.includes('defense') && g.defense !== 'none' ? ' + ' + g.defense : '') : '') + by.filter((k) => k !== 'transform' && k !== 'defense').map((k) => (by.includes('transform') ? ' · ' : '') + g[k]).join(' · ') + (!by.includes('transform') && by.includes('defense') ? g.defense : '') + (g.control && by.includes('transform') ? ' *' : '');
  const w = Math.max(10, ...summary.map((g) => name(g).length));
  const lines = [`${'variant'.padEnd(w)}  trials  success  rate (95% CI)          vs control`];
  for (const g of summary) lines.push(`${name(g).padEnd(w)}  ${String(g.trials).padStart(6)}  ${String(g.successes).padStart(7)}  ${pct(g.asr.rate).padStart(6)} (${pct(g.asr.low)}–${pct(g.asr.high)})`.padEnd(w + 45) + `${g.uplift === null ? '' : (g.uplift >= 0 ? '+' : '') + pct(g.uplift)}`);
  return lines.join('\n') + '\n';
}

/**
 * The command line as recorded in the run header: values that may carry credentials (headers, body
 * templates, commands, anything that looks like a key) are replaced, and URL query strings dropped.
 */
export function redactArgv(argv) {
  const SECRET_OPTS = new Set(['--header', '--body', '--command', '--inject']);
  const out = [];
  for (let i = 0; i < argv.length && out.length < 80; i++) {
    const a = String(argv[i]);
    const [name, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), true] : [a, false];
    if (SECRET_OPTS.has(name)) {
      out.push(inline ? `${name}=<redacted>` : name);
      if (!inline && i + 1 < argv.length) {
        out.push('<redacted>');
        i++;
      }
      continue;
    }
    if (/key|token|secret|authorization|bearer|password|passwd/i.test(a)) out.push('<redacted>');
    else out.push(a.replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, '$1?…'));
  }
  return out;
}

const parseBy = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : ['transform', 'defense']);

function parseRegex(s) {
  if (!s) return undefined;
  const m = /^\/(.+)\/([a-z]*)$/s.exec(s);
  return m ? new RegExp(m[1], m[2]) : new RegExp(s, 'i');
}

// ── run ──

export async function cmdRun(argv, { parseArgs, fail, stdin, safe, VERSION }) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...TARGET_OPTIONS,
      system: { type: 'string' },
      'system-file': { type: 'string' },
      temperature: { type: 'string', default: '0' },
      'max-tokens': { type: 'string', default: '512' },
      seed: { type: 'string', default: '' },
      repeat: { type: 'string', short: 'n', default: '1' },
      concurrency: { type: 'string', default: '2' },
      canary: { type: 'string' },
      regex: { type: 'string' },
      scorer: { type: 'string' },
      success: { type: 'string', default: 'auto' },
      partial: { type: 'boolean', default: false },
      'judge-model': { type: 'string' },
      'judge-provider': { type: 'string' },
      'judge-endpoint': { type: 'string' },
      'judge-prompt': { type: 'string' },
      'judge-max-tokens': { type: 'string', default: '16' },
      attach: { type: 'string', default: 'file' },
      out: { type: 'string', short: 'o' },
      resume: { type: 'boolean', default: false },
      search: { type: 'string' },
      budget: { type: 'string', default: '20' },
      transforms: { type: 'string', short: 't' },
      classifier: { type: 'string', default: 'injex' },
      negatives: { type: 'string' },
      json: { type: 'boolean', default: false },
      limit: { type: 'string' },
      by: { type: 'string' },
    },
  });
  const run = await import('./run.mjs');
  const { SUCCESS_RULES, SCORERS } = await import('../src/core/score.js');
  const src = positionals[0];
  if (!src) fail('which rows? injex run rows.jsonl --provider ollama --model llama3.2 (rows from injex batch or injex lab --rows, or one prompt per line)');
  let rows = run.readRows(src === '-' ? await stdin() : readFileSync(src, 'utf8'), { base: src === '-' ? '.' : dirname(src) });
  if (o.limit) rows = rows.slice(0, Number(o.limit));
  if (!SUCCESS_RULES.includes(o.success)) fail(`unknown --success ${o.success} (${SUCCESS_RULES.join(', ')})`);
  if (!['file', 'text'].includes(o.attach)) fail('--attach is file (PDF and images as files, other documents as their text) or text (everything as extracted text)');
  const scorers = o.scorer ? o.scorer.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  for (const s of scorers || []) if (!SCORERS[s]) fail(`unknown --scorer ${s} (${Object.keys(SCORERS).join(', ')})`);
  const { peel } = await import('../src/core/decoder.js');
  const peelOne = (x) => {
    const l = peel(x);
    return l.length ? { text: l.at(-1).text, method: l.map((y) => y.method).join(' → ') } : null;
  };

  // detector evaluation: no chat model involved
  if (o['target-type'] === 'classifier') {
    const negatives = o.negatives ? readFileSync(o.negatives, 'utf8').split(/\r?\n/).filter((l) => l.trim()) : [];
    let detect;
    if (o.classifier === 'injex') {
      const { scanText } = await import('../src/core/scan.js');
      const { instructionSignals } = await import('../src/core/instructions.js');
      const W = { critical: 1, high: 0.9, medium: 0.6, low: 0.3, info: 0.1 };
      detect = (t) => Math.max(instructionSignals(t).score, ...scanText(t).map((f) => W[f.severity] || 0), 0);
    } else {
      detect = async (t) => {
        const res = await fetch(o.classifier, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }), signal: AbortSignal.timeout(Number(o.timeout) * 1000) });
        const b = await res.json();
        if (typeof b.score === 'number') return b.score;
        if (typeof b.probability === 'number') return b.probability;
        const label = String(b.label ?? b[0]?.label ?? '');
        return /inject|unsafe|malicious|jailbreak|attack|positive|^1$/i.test(label) ? 1 : 0;
      };
    }
    const ev = await run.evaluateDetector(rows, negatives, detect);
    process.stdout.write(JSON.stringify({ detector: o.classifier, rows: rows.length, negatives: negatives.length, recall_at_fpr: ev.recall, by_transform: ev.byTransform }, null, 2) + '\n');
    if (!negatives.length) process.stderr.write('injex: no --negatives given: false-positive rates are undefined, thresholds fall back to 0.5\n');
    return 0;
  }

  const { target, key, label } = await targetFromOptions(o, { fail });
  let judge = null;
  if (o['judge-model']) {
    const j = await targetFromOptions(o, { fail, judge: true });
    judge = { target: j.target, key: j.key, model: o['judge-model'], template: o['judge-prompt'] ? readFileSync(o['judge-prompt'], 'utf8') : null, maxTokens: Math.max(1, Number(o['judge-max-tokens']) || 16) };
    if (judge.template && !/\{response\}/.test(judge.template)) fail('--judge-prompt must contain {response} (and usually {original}); see injex run --help');
  } else if (o['judge-prompt']) fail('--judge-prompt needs --judge-model');
  const cfg = {
    target,
    key,
    model: o.model || target.describe().model,
    system: o['system-file'] ? readFileSync(o['system-file'], 'utf8') : o.system,
    temperature: Number(o.temperature),
    maxTokens: Number(o['max-tokens']),
    seed: o.seed,
    repeat: Math.max(1, Number(o.repeat) || 1),
    concurrency: Math.max(1, Math.min(32, Number(o.concurrency) || 2)),
    canary: o.canary,
    regex: parseRegex(o.regex),
    scorers,
    success: o.success,
    partial: o.partial,
    judge,
    attach: o.attach,
    out: o.out,
    resume: o.resume,
    timeout: Number(o.timeout) * 1000,
    peel: peelOne,
    version: VERSION,
    argv: redactArgv(argv),
    log: (m) => process.stderr.write(`injex: ${m}\n`),
  };
  process.stderr.write(`injex: sending to ${label}${key ? ', key from the environment' : ''}${judge ? `; judge ${o['judge-model']}${judge.template ? ' with your prompt' : ''}` : ''}\n`);

  if (o.search) {
    if (o.search !== 'best-of-n') fail('--search best-of-n is the only search mode');
    const { list, canDecode, encode, transforms: all, slug } = await import('../src/core/registry.js');
    const { TEMPLATES, fillTemplate } = await import('../src/core/batch.js');
    const { seeded } = await import('../src/core/generators.js');
    let ts = list().filter((t) => canDecode(t) && !['special', 'defense', 'custom', 'recipe', 'case', 'format'].includes(t.category));
    if (o.transforms) {
      ts = [];
      for (const n of o.transforms.split(',')) {
        const k = n.trim().toLowerCase();
        const t = all[k] || list().find((x) => x.name.toLowerCase() === k || slug(x.name) === slug(k));
        if (!t) fail(`unknown transform "${n}"`);
        ts.push(t);
      }
    }
    const prompts = [...new Set(rows.map((r) => r.original))];
    const res = await run.searchBestOfN(prompts, { ...cfg, budget: Number(o.budget) || 20 }, { transforms: ts, templates: TEMPLATES.filter((t) => !t.delivery), encode, rng: seeded(o.seed || 'injex'), fillTemplate });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.stderr.write(`injex: ${res.filter((r) => r.success).length}/${res.length} prompts found a working variant within ${o.budget} attempts\n`);
    return 0;
  }

  const { results, runId } = await run.runRows(rows, cfg);
  const { summarize } = await import('../src/core/score.js');
  const by = parseBy(o.by);
  const summary = summarize(results, { by });
  if (o.json) process.stdout.write(JSON.stringify({ run_id: runId, summary }, null, 2) + '\n');
  else {
    process.stdout.write(summaryTable(summary, by));
    process.stdout.write('* control row (the unmodified prompt)\n');
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) process.stderr.write(`injex: ${errors.length} request${errors.length === 1 ? '' : 's'} failed (not counted): ${safe(errors[0].error).slice(0, 200)}\n`);
  const cost = results.reduce((a, r) => a + (r.usage?.cost || 0), 0);
  if (cost) process.stderr.write(`injex: cost $${cost.toFixed(4)}\n`);
  return 0;
}

// ── report / results / review / judge-eval ──

async function loadAll(paths, labelsPath, fail) {
  const run = await import('./run.mjs');
  const lines = [];
  for (const p of paths) {
    if (!existsSync(p)) fail(`not found: ${p}`);
    lines.push(...run.readResults(p));
  }
  const labels = [];
  for (const p of [].concat(labelsPath || [])) if (existsSync(p)) labels.push(...run.readResults(p));
  // labels may also sit in the results files themselves
  labels.push(...lines.filter((l) => l?.schema === 'injex.label/1'));
  return { run, lines: run.dedupResults(lines), labels };
}

export async function cmdReport(argv, { parseArgs, fail }) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { rows: { type: 'string' }, labels: { type: 'string', multiple: true }, format: { type: 'string', default: 'md' }, title: { type: 'string' }, by: { type: 'string' }, success: { type: 'string', default: 'auto' }, partial: { type: 'boolean', default: false }, output: { type: 'string', short: 'o' } } });
  if (!positionals.length) fail('injex report results.jsonl [--rows rows.jsonl] [--labels labels.jsonl]');
  const { run, lines, labels } = await loadAll(positionals, o.labels, fail);
  const { summarize } = await import('../src/core/score.js');
  const L = await import('../src/core/labels.js');
  const results = run.onlyResults(lines);
  const ag = labels.length ? L.agreement(results, labels, { partial: o.partial }) : null;
  const merged = labels.length ? L.applyLabels(results, labels, { success: o.success, partial: o.partial }) : results;
  const rows = o.rows ? run.readRows(readFileSync(o.rows, 'utf8'), { base: dirname(o.rows) }) : [];
  const by = parseBy(o.by);
  const out = o.format === 'json' ? JSON.stringify({ summary: summarize(merged, { by }), results: merged.length, ...(ag ? { agreement: ag } : {}) }, null, 2) + '\n' : run.reportMarkdown([...lines.filter((l) => l?.schema === run.RUN_SCHEMA), ...merged], { rows, title: o.title, by, agreement: ag });
  if (o.output) writeFileSync(o.output, out);
  else process.stdout.write(out);
  return 0;
}

export async function cmdResults(argv, { parseArgs, fail, VERSION }) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { by: { type: 'string' }, where: { type: 'string', multiple: true, default: [] }, labels: { type: 'string', multiple: true }, format: { type: 'string', short: 'f', default: 'table' }, rows: { type: 'string' }, success: { type: 'string', default: 'auto' }, partial: { type: 'boolean', default: false }, 'fail-on-asr': { type: 'string' }, output: { type: 'string', short: 'o' } },
  });
  if (!positionals.length) fail('injex results <results.jsonl…> [--by transform,defense,model] [--where key=value] [--format table|json|csv|junit|sarif|jsonl|md]');
  const { run, lines, labels } = await loadAll(positionals, o.labels, fail);
  const { summarize } = await import('../src/core/score.js');
  const L = await import('../src/core/labels.js');
  const F = await import('../src/core/resultsfmt.js');
  let results = run.onlyResults(lines);
  if (labels.length) results = L.applyLabels(results, labels, { success: o.success, partial: o.partial });
  try {
    results = results.filter(F.whereFilter(o.where));
  } catch (e) {
    fail(e.message);
  }
  const by = parseBy(o.by);
  const summary = summarize(results, { by });
  let out;
  if (o.format === 'table') out = summaryTable(summary, by) + `${results.length} results from ${positionals.length} file${positionals.length === 1 ? '' : 's'}${labels.length ? `, ${labels.length} labels` : ''}\n`;
  else if (o.format === 'json') out = JSON.stringify({ by, summary }, null, 2) + '\n';
  else if (o.format === 'csv') out = F.resultsCsv(results);
  else if (o.format === 'junit') out = F.resultsJunit(results);
  else if (o.format === 'sarif') {
    const rowLines = new Map();
    if (o.rows) readFileSync(o.rows, 'utf8').split(/\r?\n/).forEach((l, i) => {
      try {
        if (l.trim()) rowLines.set(String(JSON.parse(l).id ?? i + 1), i + 1);
      } catch {
        rowLines.set(String(i + 1), i + 1);
      }
    });
    out = F.resultsSarif(results, { version: VERSION, rowsUri: o.rows ? relative(process.cwd(), o.rows).replace(/\\/g, '/') : '', rowLines });
  } else if (o.format === 'jsonl') out = [...lines.filter((l) => l?.schema === run.RUN_SCHEMA), ...results].map((r) => JSON.stringify(r)).join('\n') + '\n';
  else if (o.format === 'md') out = run.reportMarkdown([...lines.filter((l) => l?.schema === run.RUN_SCHEMA), ...results], { by, rows: o.rows ? run.readRows(readFileSync(o.rows, 'utf8')) : [] });
  else fail(`unknown --format ${o.format} (table, json, csv, junit, sarif, jsonl, md)`);
  if (o.output) writeFileSync(o.output, out);
  else process.stdout.write(out);
  if (o['fail-on-asr'] !== undefined) {
    const limit = Number(o['fail-on-asr']);
    if (!Number.isFinite(limit)) fail('--fail-on-asr takes a rate between 0 and 1');
    const over = summary.filter((g) => g.trials && g.asr.rate > limit);
    if (over.length) {
      process.stderr.write(`injex: ${over.length} variant${over.length === 1 ? '' : 's'} above an attack success rate of ${pct(limit)}: ${over.slice(0, 5).map((g) => `${g.transform_name} ${pct(g.asr.rate)}`).join(', ')}\n`);
      return 1;
    }
  }
  return 0;
}

export async function cmdReview(argv, { parseArgs, fail, safe }) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { labels: { type: 'string' }, rows: { type: 'string' }, rater: { type: 'string', default: process.env.INJEX_RATER || 'anonymous' }, only: { type: 'string', default: 'unlabelled' }, sample: { type: 'string' }, seed: { type: 'string', default: 'injex' }, where: { type: 'string', multiple: true, default: [] } },
  });
  if (!positionals[0]) fail('injex review results.jsonl [--labels labels.jsonl] [--only unlabelled|disagree|success|failure|all] [--sample N] [--rater NAME]');
  const labelsPath = o.labels || positionals[0].replace(/(\.jsonl?)?$/i, '.labels.jsonl');
  const { run, lines, labels } = await loadAll(positionals, labelsPath, fail);
  const L = await import('../src/core/labels.js');
  const F = await import('../src/core/resultsfmt.js');
  const { seeded } = await import('../src/core/generators.js');
  const { visualize } = await import('../src/core/scan.js');
  let queue;
  try {
    queue = L.reviewQueue(run.onlyResults(lines).filter(F.whereFilter(o.where)), labels, { only: o.only, rater: o.rater, sample: Number(o.sample) || 0, rng: seeded(o.seed) });
  } catch (e) {
    fail(e.message);
  }
  if (!queue.length) {
    process.stdout.write('Nothing to review.\n');
    return 0;
  }
  const rows = o.rows ? new Map(run.readRows(readFileSync(o.rows, 'utf8')).map((r) => [String(r.id), r])) : new Map();
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const it = rl[Symbol.asyncIterator]();
  const yn = (v) => (v === undefined ? null : v ? 'yes' : 'no');
  let n = 0;
  const counts = {};
  for (const [i, r] of queue.entries()) {
    const s = r.scores || {};
    const auto = [`outcome ${r.outcome || s.outcome || '—'}`, `success ${r.success ? 'yes' : 'no'}`, s.canary !== undefined && `canary ${yn(s.canary)}`, s.decode_match !== undefined && `decode-match ${yn(s.decode_match)} (${s.decode_score})`, s.judge !== undefined && `judge ${yn(s.judge)}`, s.judge_label && `judge ${s.judge_label}`, s.human && `human ${s.human}`].filter(Boolean).join(' · ');
    const row = rows.get(String(r.row_id));
    process.stdout.write(`\n── ${i + 1} / ${queue.length} ── row ${r.row_id} · trial ${r.trial} · ${r.transform_name || r.transform}${r.defense && r.defense !== 'none' ? ' + ' + r.defense : ''} · ${r.model_reported || r.model}\n`);
    if (r.original || row?.original) process.stdout.write(`Injected instruction: ${safe(String(r.original || row.original)).slice(0, 600)}\n`);
    if (row?.prompt) process.stdout.write(`Input (invisible characters as ⟨…⟩):\n${visualize(row.prompt, 1500)}\n`);
    process.stdout.write(`Answer:\n${visualize(String(r.response ?? ''), 3000)}\n${auto}\n`);
    process.stdout.write(`[f] full  [t] refused, then complied  [p] partial  [r] refusal  [e] evasion  [s] skip  [q] quit — a note may follow: "p only the first step"\n> `);
    const { value, done } = await it.next();
    if (done) break;
    const ans = String(value).trim();
    const k = ans[0]?.toLowerCase();
    if (k === 'q') break;
    if (!k || k === 's') continue;
    const label = L.LABEL_KEYS[k];
    if (!label) {
      process.stdout.write(`(“${safe(ans).slice(0, 20)}” is not a label — skipped)\n`);
      continue;
    }
    appendFileSync(labelsPath, JSON.stringify(L.makeLabel(r, label, { rater: o.rater, note: ans.slice(1).trim() || undefined })) + '\n');
    counts[label] = (counts[label] || 0) + 1;
    n++;
  }
  rl.close();
  process.stdout.write(`\n${n} label${n === 1 ? '' : 's'} written to ${labelsPath}${n ? ` (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}\n`);
  return 0;
}

export async function cmdJudgeEval(argv, { parseArgs, fail }) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { labels: { type: 'string', multiple: true }, partial: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  if (!positionals.length) fail('injex judge-eval results.jsonl --labels labels.jsonl — how well each automatic score agrees with human labels');
  const labelsPath = o.labels || [positionals[0].replace(/(\.jsonl?)?$/i, '.labels.jsonl')];
  const { run, lines, labels } = await loadAll(positionals, labelsPath, fail);
  if (!labels.length) fail(`no labels found (${[].concat(labelsPath).join(', ')}): label answers first with injex review`);
  const L = await import('../src/core/labels.js');
  const ag = L.agreement(run.onlyResults(lines), labels, { partial: o.partial });
  if (o.json) {
    process.stdout.write(JSON.stringify(ag, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${ag.labelled} labelled answers (truth: the label is full or refuse_then_comply${o.partial ? ' or partial' : ''})\n\n`);
  process.stdout.write(`${'signal'.padEnd(18)}  ${'n'.padStart(5)}  ${'precision'.padEnd(22)}  ${'recall'.padEnd(22)}  ${'F1'.padStart(5)}  ${'kappa'.padStart(6)}\n`);
  const ci = (w) => `${pct(w.rate)} (${pct(w.low)}–${pct(w.high)})`;
  for (const s of ag.signals) process.stdout.write(`${s.signal.padEnd(18)}  ${String(s.n).padStart(5)}  ${ci(s.precision).padEnd(22)}  ${ci(s.recall).padEnd(22)}  ${String(s.f1).padStart(5)}  ${String(s.kappa ?? '—').padStart(6)}\n`);
  if (ag.outcome_kappa !== null) process.stdout.write(`\nautomatic outcome class vs human label: Cohen's kappa ${ag.outcome_kappa}\n`);
  if (ag.alpha !== null) process.stdout.write(`${ag.raters} raters, ${ag.multiRated} answers labelled more than once: Krippendorff's alpha ${ag.alpha}\n`);
  return 0;
}
