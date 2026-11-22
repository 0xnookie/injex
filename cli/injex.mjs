#!/usr/bin/env node
// injex on the command line: scan files for hidden text (for CI), clean them, decode / encode, inspect
// characters and compare texts. Uses the extension's own modules; no dependencies. Node 20+.

import { readFileSync, writeFileSync, appendFileSync, statSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { expandPaths, readText, readIgnoreFile, toRel } from './files.mjs';
import { scanFileText } from '../src/core/filescan.js';
import { auditFile, isAuditFile } from '../src/core/audit.js';
import { scanDocument, DOC_EXT } from '../src/core/docs/index.js';
import { formatText, formatJson, formatSarif, formatGithub, githubSummary, safe, SEVERITIES } from './report.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `injex ${VERSION} — find, remove and decode hidden text

Usage
  injex scan [paths…]            scan files and folders for hidden text (default: .), PDF and Word too,
                                 and audit AI-agent configuration files (see injex audit)
  injex audit [paths…]           only the agent-configuration audit: auto-approve settings, project hooks,
                                 folder-open tasks, MCP servers, API base URLs, lifecycle scripts, AI CI
  injex event [event.json]       scan the issue / PR / comment text of a GitHub event (GITHUB_EVENT_PATH)
                                 before an AI agent in CI reads it
  injex clean [paths…]           remove hidden characters (stdin → stdout without paths)
  injex decode [text]            universal decoder: peels Base64 / ROT13 / hex / tags … layers
  injex encode <t1,t2…> [text]   encode with one or more transforms (see injex list)
  injex list [filter]            list the transforms
  injex batch [prompts]          prompts × transforms (× spotlighting defenses) as JSONL, CSV, JSON,
                                 promptfoo, Inspect or garak files, rows in the injex.row/1 schema
  injex url <url>                instructions, hidden characters and leak shapes in a link's parameters and
                                 fragment (what agents read, people rarely do)
  injex lab <folder>             a corpus of test carriers (web pages, Markdown, agent files, e-mail,
                                 calendar, MCP manifests, tool output, PDF, Word) hiding a canary, with a
                                 manifest and a self-check; --rows writes rows for injex run
  injex import <dataset|file>    benchmark prompts as JSONL seeds with dataset, id and licence (--list;
                                 Hugging Face datasets only with --fetch)
  injex jsonl                    JSON-lines request / response stream (encode, decode, peel, scan, clean,
                                 list) for bridges — contrib/python uses it
  injex lab serve|mcp <folder>   serve a lab on this machine (requests logged, canaries flagged) or run
                                 a mock MCP server whose tools carry its injections
  injex run <rows> --model M     send rows to a target (OpenRouter, OpenAI, Anthropic, Ollama, LM Studio,
                                 vLLM, the Responses API, any HTTP endpoint or a local command), with
                                 attachments, scripted turns and tools; score answers (canary, regex,
                                 decode-match, exfil, tool calls, refusal, optional judge); --repeat N;
                                 --search best-of-n; --target-type classifier for detector recall
  injex report <results.jsonl>   a Markdown report (bug bounty / paper appendix) from injex run results
  injex results <results…>       merge, filter, group and export results (csv, junit, sarif, jsonl, md);
                                 --fail-on-asr for CI
  injex review <results.jsonl>   label answers by hand (full, refuse-then-comply, partial, refusal …)
  injex judge-eval <results>     how well each automatic score agrees with the human labels
  injex inspect [text]           every character: code point, name, category, script, flags
  injex tokens [text]            how a tokenizer cuts the text: the bundled GPT encodings (--encoding) or a
                                 Hugging Face tokenizer.json (--tokenizer: Llama, Qwen, Mistral, Gemma, Phi,
                                 T5, BERT, DeBERTa …); --compare, --ids, --json; says what the normalizer drops
  injex diff <a> <b>             compare two files code point by code point
  injex mcp [--root <dir>]       MCP server on stdio: scan / clean / decode / encode / inspect / compare
                                 tools for AI agents (files limited to the working directory and --root)
  injex mcp-audit [configs…]     audit configured MCP servers and their tool definitions (--manifest
                                 tools.json, or --connect to ask the servers); --lock / --check pin them
  injex mcp-proxy -- <server>    run an MCP server behind injex: tool lists audited (and checked against
                                 --lock), hidden text removed from definitions and results, sampling
                                 requests inspected; --mode block withholds what is flagged
  injex canary new|check|listen  canary tokens: make one, find it (also encoded) in files or stdin,
                                 or log requests on 127.0.0.1 and report when a canary arrives

Text arguments can be left out to read stdin. injex <command> --help shows a command's options.

scan options
  --format <f>        text (default), json, sarif or github (annotations + job summary)
  --fail-on <sev>     exit 1 when a finding is at least: critical, high (default), medium, low, none
  --min-severity <s>  only report findings at least this severe (default: low)
  --sarif <file>      also write a SARIF report (for GitHub code scanning)
  --output <file>     write the report to a file instead of stdout
  --exclude <glob>    skip matching paths (repeatable); .injexignore in the current folder adds more
  --max-size <bytes>  skip larger text files (default 2 MB)
  --max-doc-size <b>  skip larger PDF / Word files (default 50 MB)
  --no-docs           don't open PDF and Word files (they are checked for hidden text by default)
  --no-git            walk folders instead of asking git which files belong to the project
  --no-audit          skip the agent-configuration rules
  --quiet             only the summary line (text format)
  --tag <tag>         only findings with this taxonomy tag or prefix (repeatable): owasp:llm01,
                      atlas:AML.T0068, owasp:asi, cwe:CWE-1427 …

clean options
  --write             rewrite the files in place
  --check             only report what would change; exit 1 if anything would

  -h, --help          this help        -v, --version   the version

Exit codes: 0 clean / identical, 1 findings at or above --fail-on / files would change / texts differ,
2 usage error. More: https://github.com/0xnookie/injex#-command-line-and-ci
`;

function fail(msg) {
  process.stderr.write(`injex: ${msg}\nRun "injex --help" for usage.\n`);
  process.exit(2);
}

async function stdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function textArg(positionals) {
  if (positionals.length && !(positionals.length === 1 && positionals[0] === '-')) return positionals.join(' ');
  const t = await stdin();
  if (!t) fail('no text: pass it as an argument or pipe it in');
  return t.replace(/\r?\n$/, '');
}

const useColor = (stream) => !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!stream.isTTY);

// ── scan ──

async function cmdScan(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: 'string', default: 'text' },
      'fail-on': { type: 'string', default: 'high' },
      'min-severity': { type: 'string', default: 'low' },
      sarif: { type: 'string' },
      output: { type: 'string' },
      exclude: { type: 'string', multiple: true, default: [] },
      'max-size': { type: 'string', default: String(2 * 1024 * 1024) },
      'max-doc-size': { type: 'string', default: String(50 * 1024 * 1024) },
      'no-docs': { type: 'boolean', default: false },
      'no-git': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      tag: { type: 'string', multiple: true, default: [] },
      'no-audit': { type: 'boolean', default: false },
      'audit-only': { type: 'boolean', default: false },
    },
  });
  if (!['text', 'json', 'sarif', 'github'].includes(o.format)) fail(`unknown --format ${o.format}`);
  if (o['fail-on'] !== 'none' && !SEVERITIES.includes(o['fail-on'])) fail(`unknown --fail-on ${o['fail-on']}`);
  if (!SEVERITIES.includes(o['min-severity'])) fail(`unknown --min-severity ${o['min-severity']}`);
  const maxSize = Number(o['max-size']);
  if (!(maxSize > 0)) fail('--max-size must be a positive number of bytes');
  const rank = (s) => SEVERITIES.indexOf(s);
  const minRank = rank(o['min-severity']);

  const result = { files: [], scanned: 0, skipped: { binary: 0, large: 0, unreadable: 0, ignored: 0 }, failOn: o['fail-on'], failing: 0 };
  if (positionals.length === 1 && positionals[0] === '-') {
    const text = await stdin();
    result.scanned = 1;
    result.files.push({ file: '<stdin>', findings: o['audit-only'] ? [] : scanFileText(text, { file: '<stdin>' }) });
  } else {
    const exclude = [...o.exclude, ...readIgnoreFile('.injexignore')];
    const { files, ignored, missing } = expandPaths(positionals, { exclude, git: !o['no-git'] });
    if (missing.length) fail(`not found: ${missing.join(', ')}`);
    result.skipped.ignored = ignored;
    const maxDoc = Number(o['max-doc-size']);
    for (const abs of files) {
      const file = toRel(abs);
      if (o['audit-only'] && !isAuditFile(file)) continue;
      if (DOC_EXT.test(abs) && !o['no-docs'] && !o['audit-only']) {
        // PDF / Word: hidden text the reader can't see, metadata, comments
        let bytes;
        try {
          if (statSync(abs).size > maxDoc) {
            result.skipped.large++;
            continue;
          }
          bytes = readFileSync(abs);
        } catch {
          result.skipped.unreadable++;
          continue;
        }
        try {
          const d = await scanDocument(bytes, abs);
          result.scanned++;
          result.files.push({ file, findings: d.findings.map((f) => ({ ...f, line: 1, column: 1, loc: f.loc || 'doc' })), warnings: d.warnings });
        } catch (e) {
          result.skipped.unreadable++;
          result.files.push({ file, findings: [], warnings: [`could not read: ${e.message}`] });
        }
        continue;
      }
      const r = readText(abs, maxSize);
      if (r.skip) {
        result.skipped[r.skip]++;
        continue;
      }
      result.scanned++;
      const findings = o['audit-only'] ? [] : scanFileText(r.text, { file });
      if (!o['no-audit'] && isAuditFile(file)) findings.push(...auditFile(file, r.text));
      result.files.push({ file, findings });
    }
  }
  const { tagsForFinding, hasTag } = await import('../src/core/taxonomy.js');
  for (const f of result.files) f.findings = f.findings.filter((x) => rank(x.severity) <= minRank && (!o.tag.length || o.tag.some((t) => hasTag(tagsForFinding(x), t))));
  const all = result.files.flatMap((f) => f.findings);
  result.failing = o['fail-on'] === 'none' ? 0 : all.filter((x) => rank(x.severity) <= rank(o['fail-on'])).length;

  let report;
  if (o.format === 'json') report = formatJson(result, VERSION);
  else if (o.format === 'sarif') report = formatSarif(result, VERSION);
  else if (o.format === 'github') report = formatGithub(result) + formatText(result, { color: false, quiet: true });
  else report = formatText(result, { color: !o.output && useColor(process.stdout), quiet: o.quiet });
  if (o.output) writeFileSync(o.output, report);
  else process.stdout.write(report);
  if (o.sarif) writeFileSync(o.sarif, formatSarif(result, VERSION));
  if (o.format === 'github') {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(result));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `findings=${all.length}\nfailing=${result.failing}\n`);
  }
  return result.failing ? 1 : 0;
}

// ── clean ──

function encodeLike(text, r) {
  if (r.encoding === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (r.encoding === 'utf-16be') {
    const le = Buffer.from(text, 'utf16le');
    for (let i = 0; i + 1 < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]];
    return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
  }
  return Buffer.concat([r.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
}

async function cmdClean(argv) {
  const { stripHidden } = await import('../src/core/scan.js');
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { write: { type: 'boolean', default: false }, check: { type: 'boolean', default: false }, exclude: { type: 'string', multiple: true, default: [] }, 'no-git': { type: 'boolean', default: false } },
  });
  const summary = (r, would = false) =>
    [r.removed && `${would ? 'would remove' : 'removed'} ${r.removed} hidden character${r.removed === 1 ? '' : 's'}`, r.replaced && `${would ? 'would fix' : 'fixed'} ${r.replaced} look-alike letter${r.replaced === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  if (!positionals.length || (positionals.length === 1 && positionals[0] === '-')) {
    if (o.write) fail('--write needs files');
    const text = await stdin();
    if (!positionals.length && !text) fail('no input: pass files or pipe text in');
    const r = stripHidden(text);
    if (!o.check) process.stdout.write(r.text);
    process.stderr.write(r.removed || r.replaced ? `injex: ${summary(r, o.check)}\n` : 'injex: nothing hidden\n');
    return o.check && (r.removed || r.replaced) ? 1 : 0;
  }
  const { files, missing } = expandPaths(positionals, { exclude: [...o.exclude, ...readIgnoreFile('.injexignore')], git: !o['no-git'] });
  if (missing.length) fail(`not found: ${missing.join(', ')}`);
  if (!o.write && !o.check) {
    if (files.length !== 1) fail('several files: use --write to clean them in place or --check to list what would change');
    const r = readText(files[0], Infinity);
    if (r.skip) fail(`${positionals[0]}: ${r.skip} file`);
    const c = stripHidden(r.text);
    process.stdout.write(c.text);
    process.stderr.write(c.removed || c.replaced ? `injex: ${summary(c)}\n` : 'injex: nothing hidden\n');
    return 0;
  }
  let changed = 0;
  for (const abs of files) {
    const r = readText(abs, 16 * 1024 * 1024);
    if (r.skip) continue;
    const c = stripHidden(r.text);
    if (!c.removed && !c.replaced) continue;
    changed++;
    process.stdout.write(`${safe(toRel(abs))}: ${summary(c, !o.write)}\n`);
    if (o.write) writeFileSync(abs, encodeLike(c.text, r));
  }
  process.stdout.write(changed ? `${changed} file${changed === 1 ? '' : 's'} ${o.write ? 'cleaned' : 'would change'}\n` : `Nothing hidden in ${files.length} file${files.length === 1 ? '' : 's'}\n`);
  return o.check && changed ? 1 : 0;
}

// ── decode / encode / list ──

async function cmdDecode(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { all: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  const { peel, universalDecode } = await import('../src/core/decoder.js');
  const text = await textArg(positionals);
  const layers = peel(text);
  const best = universalDecode(text);
  if (o.json) {
    process.stdout.write(JSON.stringify({ layers: layers.map((l) => ({ method: l.method, text: l.text })), readings: best ? [best, ...best.alternatives].map((r) => ({ method: r.method, text: r.text, score: Math.round(r.score) })) : [] }, null, 2) + '\n');
    return layers.length || best ? 0 : 1;
  }
  if (layers.length) {
    process.stderr.write(`injex: ${layers.map((l) => l.method).join(' → ')}\n`);
    process.stdout.write(layers.at(-1).text + '\n');
  } else if (best) {
    process.stderr.write(`injex: ${best.method}${best.score < 80 ? ' (weak guess)' : ''}\n`);
    process.stdout.write(best.text + '\n');
  } else {
    process.stderr.write('injex: no decoder recognised the input\n');
    return 1;
  }
  if (o.all && best?.alternatives.length) {
    process.stderr.write('\nOther readings:\n');
    for (const r of best.alternatives.slice(0, 15)) process.stderr.write(`  ${r.method.padEnd(24)} ${safe(r.text.replace(/\s+/g, ' ').slice(0, 100))}\n`);
  }
  return 0;
}

async function resolveTransform(name) {
  const { transforms, list, slug } = await import('../src/core/registry.js');
  const n = name.trim().toLowerCase();
  return transforms[n] || list().find((t) => t.name.toLowerCase() === n || slug(t.name) === slug(n)) || null;
}

async function cmdEncode(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { decode: { type: 'boolean', short: 'd', default: false }, jsonl: { type: 'boolean', default: false } } });
  if (o.jsonl) return cmdJsonl();
  const { encode, decode } = await import('../src/core/registry.js');
  if (!positionals.length) fail('which transform? e.g. injex encode base64 "text" (injex list shows them all)');
  const names = positionals[0].split(',');
  const steps = [];
  for (const n of names) {
    const t = await resolveTransform(n);
    if (!t) fail(`unknown transform "${n}" (injex list ${n} to search)`);
    steps.push(t);
  }
  let text = await textArg(positionals.slice(1));
  for (const t of o.decode ? steps.reverse() : steps) {
    const r = o.decode ? decode(t, text) : encode(t, text);
    if (!r.ok) {
      process.stderr.write(`injex: ${t.name}: ${r.error}\n`);
      return 1;
    }
    text = r.text;
  }
  process.stdout.write(text + '\n');
  return 0;
}

async function cmdList(argv) {
  const { list, canDecode, CATEGORIES } = await import('../src/core/registry.js');
  const q = argv.join(' ').toLowerCase();
  const rows = list().filter((t) => !q || t.key.includes(q) || t.name.toLowerCase().includes(q) || t.category.includes(q));
  const w = Math.max(...rows.map((t) => t.key.length), 3);
  for (const t of rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) process.stdout.write(`${t.key.padEnd(w)}  ${(CATEGORIES[t.category]?.short || t.category).padEnd(8)}  ${t.name}${canDecode(t) ? '' : '  (encode only)'}\n`);
  process.stderr.write(`${rows.length} transform${rows.length === 1 ? '' : 's'}\n`);
  return rows.length ? 0 : 1;
}

// ── inspect / diff ──

async function cmdInspect(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { all: { type: 'boolean', default: false }, json: { type: 'boolean', default: false }, limit: { type: 'string', default: '500' } } });
  const { loadUnicodeData, inspectText, FLAGS } = await import('../src/core/unicode.js');
  await loadUnicodeData();
  const text = await textArg(positionals);
  const r = inspectText(text, { unusual: !o.all, limit: Number(o.limit) || 500 });
  if (o.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return 0;
  }
  const color = useColor(process.stdout);
  const paint = (flags, s) => (!color || !flags.length ? s : (FLAGS[flags[0]]?.level === 'bad' ? '\x1b[31m' : FLAGS[flags[0]]?.level === 'warn' ? '\x1b[33m' : '\x1b[2m') + s + '\x1b[0m');
  const scripts = Object.entries(r.scripts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ');
  const flags = Object.entries(r.flags).map(([f, n]) => `${n} ${FLAGS[f]?.label || f}`).join(', ');
  process.stdout.write(`${r.codePoints} code points, ${r.graphemes} graphemes, ${r.utf16} UTF-16 units, ${r.utf8} UTF-8 bytes${scripts ? ` — ${scripts}` : ''}${flags ? ` — ${flags}` : ''}\n`);
  if (!r.chars.length) {
    process.stdout.write(o.all ? '' : 'Only printable ASCII (use --all to list every character).\n');
    return 0;
  }
  process.stdout.write('\n');
  for (const c of r.chars) {
    const glyph = safe(c.glyph).padEnd(6);
    process.stdout.write(paint(c.flags, `${String(c.index + 1).padStart(5)}  ${c.hex.padEnd(8)} ${glyph} ${c.category}  ${c.script.padEnd(10)} ${c.name}${c.flags.length ? '  [' + c.flags.map((f) => FLAGS[f]?.label || f).join(', ') + ']' : ''}${c.note ? '  ' + c.note : ''}`) + '\n');
  }
  if (r.truncated) process.stdout.write(`… more (raise --limit)\n`);
  return 0;
}

async function cmdDiff(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { text: { type: 'boolean', default: false } } });
  if (positionals.length !== 2) fail('diff needs two files (or --text "a" "b")');
  const { compareTexts } = await import('../src/core/diff.js');
  const { loadUnicodeData, charInfo } = await import('../src/core/unicode.js');
  await loadUnicodeData();
  const read = (p) => {
    if (o.text) return p;
    const r = readText(p, 16 * 1024 * 1024);
    if (r.skip) fail(`${p}: ${r.skip}`);
    return r.text;
  };
  const a = read(positionals[0]);
  const b = read(positionals[1]);
  const c = compareTexts(a, b);
  const verdicts = {
    identical: 'Identical.',
    normalized: 'Same text, different Unicode normalization (composed vs. decomposed accents).',
    hidden: 'They look the same but differ in what a reader can’t see: invisible characters, look-alike letters or compatibility forms.',
    visible: 'They differ in visible text.',
  };
  process.stdout.write(verdicts[c.verdict] + (c.verdict === 'identical' ? '' : ` ${c.removed} code point${c.removed === 1 ? '' : 's'} only in A, ${c.added} only in B.`) + '\n');
  if (c.verdict === 'identical') return 0;
  let line = 1;
  let col = 1;
  let shown = 0;
  // positions are line:column in A (where B's extra characters would go)
  for (const op of c.ops) {
    if (op.op !== '=' && shown < 60) {
      shown++;
      const cps = [...op.text].slice(0, 6).map((ch) => {
        const i = charInfo(ch.codePointAt(0));
        return `${i.hex} ${i.name}`;
      });
      const more = [...op.text].length > 6 ? ` … (${[...op.text].length} code points)` : '';
      process.stdout.write(`  ${op.op === '-' ? 'A only' : 'B only'}  ${line}:${col}  ${cps.join(', ')}${more}\n`);
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
  if (c.changes > shown) process.stdout.write(`  … ${c.changes - shown} more changes\n`);
  return 1;
}

// ── batch: prompts × transforms (× defenses) for evaluation harnesses ──

/** Prompts from text: JSONL rows ({ text | prompt | goal, id, dataset, license }), or one per line / the whole text. */
export function readPrompts(text, { whole = false } = {}) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length && lines.every((l) => /^\s*\{/.test(l))) {
    try {
      return lines.map((l) => {
        const o = JSON.parse(l);
        return { ...o, text: String(o.text ?? o.prompt ?? o.goal ?? o.input ?? '') };
      });
    } catch {
      /* not JSONL after all */
    }
  }
  if (whole) return t.trim() ? [t.replace(/\r?\n$/, '')] : [];
  return lines.map((l) => l.trim());
}

async function cmdBatch(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      transforms: { type: 'string', short: 't' },
      filter: { type: 'string' },
      category: { type: 'string' },
      reversible: { type: 'boolean', default: false },
      template: { type: 'string', default: 'none' },
      'template-file': { type: 'string' },
      original: { type: 'boolean', default: false },
      seed: { type: 'string', default: '' },
      defense: { type: 'string', default: '' },
      delivery: { type: 'string', default: '' },
      format: { type: 'string', short: 'f', default: 'jsonl' },
      output: { type: 'string', short: 'o' },
      manifest: { type: 'string' },
      max: { type: 'string', default: String(1000000) },
      whole: { type: 'boolean', default: false },
      name: { type: 'string', default: 'injex-batch' },
    },
  });
  const { buildBatch, formatBatch, batchManifest, TEMPLATES, FORMATS } = await import('../src/core/batch.js');
  const { list, canDecode, transforms } = await import('../src/core/registry.js');
  if (!FORMATS[o.format]) fail(`unknown --format ${o.format} (${Object.keys(FORMATS).join(', ')})`);
  if (o.delivery && !['direct', 'indirect'].includes(o.delivery)) fail('--delivery is direct or indirect');
  const src = positionals[0];
  const text = !src || src === '-' ? await stdin() : readFileSync(src, 'utf8');
  const prompts = readPrompts(text, { whole: o.whole });
  if (!prompts.length) fail('no prompts: pass a file (one per line, or JSONL from injex import) or pipe them in');
  let ts = [];
  if (o.transforms) for (const n of o.transforms.split(',')) {
    const t = await resolveTransform(n);
    if (!t) fail(`unknown transform "${n}" (injex list ${n} to search)`);
    ts.push(t);
  }
  if (o.filter || o.category || o.reversible) {
    const m = o.filter && /^\/(.+)\/([a-z]*)$/.exec(o.filter);
    const re = m ? new RegExp(m[1], m[2]) : null;
    const q = (o.filter || '').toLowerCase();
    ts.push(...list().filter((t) => t.category !== 'special' && t.category !== 'defense' && (!o.category || t.category === o.category) && (!o.reversible || canDecode(t)) && (!o.filter || (re ? re.test(t.name) || re.test(t.key) : t.key.includes(q) || t.name.toLowerCase().includes(q)))));
  }
  ts = [...new Set(ts)];
  if (!ts.length && !o.original) fail('which transforms? --transforms base64,rot13 or --filter / --category / --reversible (and --original for control rows)');
  const defenses = [];
  for (const n of o.defense ? o.defense.split(',') : []) {
    const key = n.trim().replace(/^spotlight[_-]?/, '');
    const t = transforms['spotlight_' + key] || (await resolveTransform(n));
    if (!t) fail(`unknown defense "${n}" (delimit, datamark, encode)`);
    defenses.push(t);
  }
  const preset = TEMPLATES.find((t) => t.id === o.template);
  const template = o['template-file'] ? readFileSync(o['template-file'], 'utf8') : preset ? preset.text : o.template.replace(/\\n/g, '\n');
  const templateId = o['template-file'] ? 'file' : preset ? preset.id : 'custom';
  const r = buildBatch({ prompts, transforms: ts, template, templateId, includeOriginal: o.original, seed: o.seed, defenses, delivery: o.delivery, version: VERSION, max: Number(o.max) || 1000000 });
  const out = formatBatch(r.rows, o.format, { name: o.name });
  if (o.output) writeFileSync(o.output, out);
  else process.stdout.write(out);
  if (o.manifest) writeFileSync(o.manifest, JSON.stringify(batchManifest(r.rows, { seed: o.seed, template, templateId, transforms: ts, defenses, delivery: o.delivery || preset?.delivery || 'direct', version: VERSION, source: src && src !== '-' ? src : 'stdin' }), null, 2) + '\n');
  process.stderr.write(`injex: ${r.rows.length} rows (${prompts.length} prompt${prompts.length === 1 ? '' : 's'} × ${ts.length} transform${ts.length === 1 ? '' : 's'}${o.original ? ' + controls' : ''}${defenses.length ? ` × ${defenses.length + 1} defense settings` : ''})${r.errors ? `, ${r.errors} failed` : ''}${r.capped ? ', capped' : ''}\n`);
  return 0;
}

// ── url: a link's parameters and fragment ──

async function cmdUrl(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean', default: false } } });
  const url = positionals.length ? positionals.join(' ') : (await stdin()).trim();
  if (!url) fail('injex url <url>');
  const { scanUrl } = await import('../src/core/agentview.js');
  const findings = scanUrl(url);
  if (o.json) process.stdout.write(JSON.stringify({ url, findings: findings.map(({ ctx, ...f }) => f) }, null, 2) + '\n');
  else if (!findings.length) process.stdout.write('Nothing hidden in this URL\n');
  else for (const f of findings) process.stdout.write(`${f.severity.padEnd(8)} ${(f.where || f.rule || f.kind).padEnd(34)} ${safe(f.note)}${f.payload ? `: ${safe(String(f.payload).slice(0, 160))}` : ''}\n`);
  return findings.some((f) => f.severity === 'high' || f.severity === 'critical') ? 1 : 0;
}

// ── lab: a corpus of test carriers with a canary ──

async function cmdLabServe(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { port: { type: 'string', default: '8788' }, host: { type: 'string', default: '127.0.0.1' }, token: { type: 'string', multiple: true, default: [] }, log: { type: 'string' }, 'max-requests': { type: 'string' } } });
  const dir = positionals[0];
  if (!dir) fail('injex lab serve <lab folder> [--port 8788] [--log requests.jsonl] [--token T]');
  if (!['127.0.0.1', '::1', 'localhost'].includes(o.host)) fail('the lab server only binds to this machine (127.0.0.1, ::1 or localhost)');
  const { createLabServer, readLabManifest } = await import('./labserve.mjs');
  let m;
  try {
    m = readLabManifest(dir);
  } catch (e) {
    fail(e.message);
  }
  const max = o['max-requests'] ? Number(o['max-requests']) : Infinity;
  let served = 0;
  await new Promise((done) => {
    const server = createLabServer(dir, {
      tokens: o.token,
      log: (e) => {
        process.stdout.write(JSON.stringify(e) + '\n');
        if (o.log) appendFileSync(o.log, JSON.stringify(e) + '\n');
        for (const c of e.canary || []) process.stderr.write(`injex: canary ${c.token} arrived (${c.how.join(', ')}) — ${e.method} ${safe(e.url).slice(0, 200)}\n`);
        if (++served >= max) server.close(done);
      },
    });
    server.listen(Number(o.port), o.host, () => {
      const base = `http://${o.host.includes(':') ? `[${o.host}]` : o.host}:${server.address().port}`;
      process.stderr.write(`injex: serving ${dir} on ${base}/ — canary ${m.canary}; requests are logged as JSON lines${m.collector && !m.collector.startsWith(base) ? ` (the exfil carriers point at ${m.collector}, not here)` : ''}\n`);
    });
  });
  return 0;
}

async function cmdLabMcp(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { technique: { type: 'string', default: 'mcp-line-jumping' }, output: { type: 'string', default: 'tool-json-hidden' }, sink: { type: 'boolean', default: false }, token: { type: 'string', multiple: true, default: [] }, log: { type: 'string' } } });
  const dir = positionals[0];
  if (!dir) fail('injex lab mcp <lab folder> [--technique mcp-line-jumping|mcp-hidden-tags|mcp-exfil-param|clean] [--output tool-json-hidden|tool-json-instruction|clean] [--sink]');
  const { serveLabMcp } = await import('./labserve.mjs');
  const log = (e) => {
    const line = JSON.stringify({ time: new Date().toISOString(), ...e }) + '\n';
    if (o.log) appendFileSync(o.log, line);
    else process.stderr.write('injex: ' + line);
    for (const c of e.canary || []) process.stderr.write(`injex: canary ${c.token} arrived in ${e.tool} arguments (${c.how.join(', ')})\n`);
  };
  try {
    return await serveLabMcp(dir, { technique: o.technique, output: o.output, sink: o.sink, tokens: o.token, version: VERSION, log });
  } catch (e) {
    fail(e.message);
  }
}

async function cmdLab(argv) {
  if (argv[0] === 'serve') return cmdLabServe(argv.slice(1));
  if (argv[0] === 'mcp') return cmdLabMcp(argv.slice(1));
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { canary: { type: 'string' }, payload: { type: 'string' }, channel: { type: 'string', multiple: true, default: [] }, rows: { type: 'string' }, template: { type: 'string' }, 'doc-template': { type: 'string' }, collector: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const dir = positionals[0];
  if (!dir) fail('injex lab <folder> [--canary T] [--channel web|markdown|agent-file|e-mail|calendar|mcp-manifest|tool-output|document] [--rows rows.jsonl] [--collector http://127.0.0.1:8788]');
  if (o.collector && !/^https?:\/\/[^\s"'<>]+$/.test(o.collector)) fail('--collector takes an http(s) URL, e.g. http://127.0.0.1:8788 (injex lab serve)');
  const { newCanary } = await import('../src/core/canary.js');
  const { writeLab } = await import('./lab.mjs');
  const canary = o.canary || newCanary();
  const m = await writeLab(dir, { canary, payload: o.payload, channels: o.channel, rows: o.rows, template: o.template, docTemplate: o['doc-template'], collector: o.collector });
  if (o.json) {
    process.stdout.write(JSON.stringify(m, null, 2) + '\n');
    return 0;
  }
  const w = Math.max(...m.items.map((i) => i.technique.length));
  for (const i of m.items) process.stdout.write(`${i.channel.padEnd(13)} ${i.technique.padEnd(w)}  ${i.detected === true ? 'detected' : i.detected === 'browser-only' ? 'needs a browser (Scan tab)' : i.detected === null ? 'visible (control for models)' : 'NOT detected'}  ${i.found.join(', ')}\n`);
  const det = m.items.filter((i) => i.detected === true).length;
  const scored = m.items.filter((i) => i.detected === true || i.detected === false).length;
  process.stdout.write(`\n${m.items.length} carriers in ${dir} — canary ${canary}; injex detects ${det}/${scored} statically${o.rows ? `; rows for injex run in ${o.rows}` : ''}\n`);
  return 0;
}

// ── import benchmark datasets as seed prompts ──

async function cmdImport(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { fetch: { type: 'boolean', default: false }, list: { type: 'boolean', default: false }, config: { type: 'string' }, split: { type: 'string' }, field: { type: 'string' }, 'label-field': { type: 'string' }, label: { type: 'string' }, license: { type: 'string' }, limit: { type: 'string', default: '1000' }, out: { type: 'string', short: 'o' } },
  });
  const D = await import('../src/core/datasets.js');
  if (o.list || !positionals.length) {
    for (const [k, d] of Object.entries(D.DATASETS)) process.stdout.write(`${k.padEnd(26)} ${d.license.padEnd(14)} ${d.title}${d.hf ? `  (hf:${d.hf})` : d.url ? '  (GitHub)' : `  — ${d.note}`}\n`);
    process.stdout.write('\nAlso: a local .jsonl / .json / .csv / .txt file, or hf:<owner>/<dataset> with --fetch.\n');
    return positionals.length || o.list ? 0 : 2;
  }
  const what = positionals[0];
  const limit = Math.max(1, Number(o.limit) || 1000);
  const known = D.DATASETS[what];
  const spec = { ...(known || {}), dataset: known ? what : what.replace(/^hf:/, ''), ...(o.field ? { text: o.field } : {}), ...(o['label-field'] ? { labelField: o['label-field'] } : {}), ...(o.label !== undefined ? { label: Number(o.label) } : {}), ...(o.license ? { license: o.license } : {}) };
  let records;
  if (existsSync(what) && !known) {
    records = D.parseRecords(readFileSync(what, 'utf8'), what);
    spec.dataset = what.split(/[\\/]/).pop();
  } else {
    const hf = known?.hf || (what.startsWith('hf:') ? what.slice(3) : '');
    if (!hf && !known?.url) fail(`unknown dataset "${what}" — injex import --list, a local file, or hf:<owner>/<dataset>`);
    if (!o.fetch) fail(`${what} is fetched from ${hf ? 'huggingface.co' : new URL(known.url).host}: add --fetch to allow the download (or download it yourself and import the file)`);
    if (known?.note && !known.hf && !known.url) fail(known.note);
    process.stderr.write(`injex: fetching ${hf ? `hf:${hf}` : known.url} …\n`);
    if (known?.url) {
      const res = await fetch(known.url);
      if (!res.ok) fail(`download failed: HTTP ${res.status}`);
      records = D.parseRecords(await res.text(), known.url);
    } else {
      const splits = await (await fetch(D.hfSplitsUrl(hf))).json();
      if (splits.error) fail(`${hf}: ${splits.error}`);
      const want = splits.splits?.find((s) => (!o.config && !spec.config ? true : s.config === (o.config || spec.config)) && (!o.split && !spec.split ? true : s.split === (o.split || spec.split))) || splits.splits?.[0];
      if (!want) fail(`${hf}: no splits found`);
      records = [];
      for (let off = 0; off < limit; off += 100) {
        const page = await (await fetch(D.hfRowsUrl(hf, want.config, want.split, off, Math.min(100, limit - off)))).json();
        if (page.error) fail(`${hf}: ${page.error}`);
        records.push(...(page.rows || []).map((r) => r.row));
        if (!page.rows?.length || records.length >= (page.num_rows_total ?? Infinity)) break;
      }
      process.stderr.write(`injex: ${hf} (${want.config}/${want.split})\n`);
    }
  }
  const rows = records
    .slice(0, limit)
    .map((r, i) => D.normalizeRecord(r, spec, i))
    .filter(Boolean);
  const out = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  if (o.out) writeFileSync(o.out, out);
  else process.stdout.write(out);
  const warn = D.licenceWarning(spec.license);
  process.stderr.write(`injex: ${rows.length} prompts from ${spec.dataset} (licence ${spec.license || 'unknown'})${warn ? ` — ${warn}` : ''}\n`);
  return rows.length ? 0 : 1;
}

// ── jsonl: a request / response stream for bridges (Python, other tools) ──

/**
 * One JSON object per line in, one per line out (same order). Requests:
 *   { id, op: 'encode', text, transforms: 'a,b' | [..], options?: { key: { … } } }   (op defaults to encode)
 *   { id, op: 'decode', text, transforms }      decode through a chain, in reverse
 *   { id, op: 'peel', text }                    universal decoder
 *   { id, op: 'scan', text }   { id, op: 'clean', text }   { id, op: 'list' }
 *   { id, op: 'score', response, original?, canary?, regex?, scorers?, tool_calls?, forbidden_tools?,
 *     success?, partial? }                     injex's deterministic scorers → { scores, outcome, success }
 * Answers: { id, ok: true, … } or { id, ok: false, error }.
 */
async function cmdJsonl() {
  const reg = await import('../src/core/registry.js');
  const { scanText, stripHidden } = await import('../src/core/scan.js');
  const { peel } = await import('../src/core/decoder.js');
  const { tagsForTransform } = await import('../src/core/taxonomy.js');
  const score = await import('../src/core/score.js');
  const peelOne = (x) => {
    const l = peel(x);
    return l.length ? { text: l.at(-1).text, method: l.map((y) => y.method).join(' → ') } : null;
  };
  const { createInterface } = await import('node:readline');
  const resolve = (n) => {
    const k = String(n).trim().toLowerCase();
    return reg.transforms[k] || reg.list().find((t) => t.name.toLowerCase() === k || reg.slug(t.name) === reg.slug(k)) || null;
  };
  const handle = (q) => {
    const op = q.op || 'encode';
    if (op === 'list') return { transforms: reg.list().map((t) => ({ key: t.key, name: t.name, category: t.category, decodes: reg.canDecode(t), tags: tagsForTransform(t) })) };
    const text = String(q.text ?? '');
    if (op === 'peel') {
      const l = peel(text);
      return { text: l.length ? l.at(-1).text : '', layers: l.map((x) => x.method) };
    }
    if (op === 'scan') return { findings: scanText(text).map(({ ctx, ...f }) => f) };
    if (op === 'score') {
      // injex's deterministic scorers for another framework's answers (PyRIT, garak, promptfoo …)
      let regex;
      if (q.regex) {
        const m = /^\/(.+)\/([a-z]*)$/s.exec(String(q.regex));
        regex = m ? new RegExp(m[1], m[2]) : new RegExp(String(q.regex), 'i');
      }
      const row = { original: q.original ?? '', ...(q.canary ? { canary: String(q.canary) } : {}), ...(q.forbidden_tools ? { forbidden_tools: q.forbidden_tools } : {}) };
      const scores = score.scoreResponse(row, String(q.response ?? ''), { regex, peel: peelOne, scorers: q.scorers, ...(Array.isArray(q.tool_calls) ? { toolCalls: q.tool_calls } : {}) });
      return { scores, outcome: scores.outcome, success: score.isSuccess(scores, q.success || 'auto', { partial: !!q.partial }) };
    }
    if (op === 'clean') return stripHidden(text);
    if (op !== 'encode' && op !== 'decode') throw new Error(`unknown op ${op}`);
    const names = Array.isArray(q.transforms) ? q.transforms : String(q.transforms || '').split(',').filter(Boolean);
    const steps = names.map((n) => resolve(n) || (() => { throw new Error(`unknown transform ${n}`); })());
    if (!steps.length) throw new Error('no transforms');
    let s = text;
    for (const t of op === 'decode' ? [...steps].reverse() : steps) {
      const r = op === 'decode' ? reg.decode(t, s, q.options?.[t.key]) : reg.encode(t, s, q.options?.[t.key]);
      if (!r.ok) throw new Error(`${t.key}: ${r.error}`);
      s = r.text;
    }
    return { text: s, chain: steps.map((t) => t.key) };
  };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let q;
    try {
      q = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, error: 'not JSON' }) + '\n');
      continue;
    }
    try {
      process.stdout.write(JSON.stringify({ id: q.id ?? null, ok: true, ...handle(q) }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: q.id ?? null, ok: false, error: e.message }) + '\n');
    }
  }
  return 0;
}

// ── run, report, results, review, judge-eval (cli/redteam.mjs) ──

const redteam = async (name, argv) => (await import('./redteam.mjs'))[name](argv, { parseArgs, fail, stdin, safe, VERSION });
const cmdRun = (argv) => redteam('cmdRun', argv);
const cmdReport = (argv) => redteam('cmdReport', argv);
const cmdResults = (argv) => redteam('cmdResults', argv);
const cmdReview = (argv) => redteam('cmdReview', argv);
const cmdJudgeEval = (argv) => redteam('cmdJudgeEval', argv);

// ── GitHub event text (issues, pull requests, comments) ──

/** The text fields of a GitHub webhook payload that an AI agent in CI would read: [{ field, text }]. */
export function eventFields(ev) {
  const out = [];
  const add = (field, v) => typeof v === 'string' && v.trim() && out.push({ field, text: v });
  const num = (o) => (o?.number ? ` #${o.number}` : '');
  add(`issue${num(ev.issue)} title`, ev.issue?.title);
  add(`issue${num(ev.issue)} body`, ev.issue?.body);
  add(`pull request${num(ev.pull_request)} title`, ev.pull_request?.title);
  add(`pull request${num(ev.pull_request)} body`, ev.pull_request?.body);
  add(`pull request${num(ev.pull_request)} branch`, ev.pull_request?.head?.ref);
  add('comment', ev.comment?.body);
  add('review', ev.review?.body);
  add(`discussion${num(ev.discussion)} title`, ev.discussion?.title);
  add(`discussion${num(ev.discussion)} body`, ev.discussion?.body);
  add('head commit message', ev.head_commit?.message);
  for (const [i, c] of (ev.commits || []).slice(0, 50).entries()) add(`commit ${i + 1} message`, c?.message);
  add('release notes', ev.release?.body);
  return out;
}

async function cmdEvent(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { format: { type: 'string', default: 'text' }, 'fail-on': { type: 'string', default: 'high' }, 'min-severity': { type: 'string', default: 'low' }, sarif: { type: 'string' } },
  });
  const path = positionals[0] || process.env.GITHUB_EVENT_PATH;
  if (!path) fail('no event: pass an event JSON file or set GITHUB_EVENT_PATH');
  let ev;
  try {
    ev = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read the event: ${e.message}`);
  }
  const { instructionSignals } = await import('../src/core/instructions.js');
  const rank = (s) => SEVERITIES.indexOf(s);
  const result = { files: [], scanned: 0, skipped: { binary: 0, large: 0, unreadable: 0, ignored: 0 }, failOn: o['fail-on'], failing: 0 };
  for (const { field, text } of eventFields(ev)) {
    result.scanned++;
    // Markdown rules (hidden comments, alt text, hidden HTML) plus every text check
    const findings = scanFileText(text, { file: 'event.md' });
    // hidden text in an issue or PR that reads like instructions is exactly what an agent in CI would obey
    for (const f of findings) if (f.instructions && f.severity === 'medium') f.severity = 'high';
    const sig = instructionSignals(text);
    if (sig.instructions && !findings.some((f) => f.instructions)) findings.push({ kind: 'event-text', severity: 'medium', line: 1, column: 1, endColumn: 2, count: text.length, payload: text.slice(0, 2000), instructions: true, signals: sig.signals, note: 'visible text that reads like instructions to an AI agent' });
    result.files.push({ file: `event: ${field}`, findings: findings.filter((f) => rank(f.severity) <= rank(o['min-severity'])) });
  }
  const all = result.files.flatMap((f) => f.findings);
  result.failing = o['fail-on'] === 'none' ? 0 : all.filter((x) => rank(x.severity) <= rank(o['fail-on'])).length;
  let report;
  if (o.format === 'json') report = formatJson(result, VERSION);
  else if (o.format === 'sarif') report = formatSarif(result, VERSION);
  else if (o.format === 'github') report = all.map((f) => `::${f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'notice'} title=injex event scan::${f.note}`.replace(/\r?\n/g, ' ')).join('\n') + (all.length ? '\n' : '') + formatText(result, { color: false, quiet: false });
  else report = formatText(result, { color: useColor(process.stdout) });
  process.stdout.write(report);
  if (o.sarif) writeFileSync(o.sarif, formatSarif(result, VERSION));
  if (process.env.GITHUB_OUTPUT && o.format === 'github') appendFileSync(process.env.GITHUB_OUTPUT, `event-findings=${all.length}\nevent-gate=${result.failing ? 'fail' : 'pass'}\n`);
  if (process.env.GITHUB_STEP_SUMMARY && o.format === 'github' && all.length) appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(result).replace('### injex hidden-text scan', '### injex event scan'));
  return result.failing ? 1 : 0;
}

// ── MCP supply-chain audit ──

async function cmdMcpAudit(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      manifest: { type: 'string', multiple: true, default: [] },
      connect: { type: 'boolean', default: false },
      'no-user': { type: 'boolean', default: false },
      timeout: { type: 'string', default: '20' },
      lock: { type: 'string' },
      check: { type: 'string' },
      format: { type: 'string', default: 'text' },
      'fail-on': { type: 'string', default: 'high' },
      sarif: { type: 'string' },
    },
  });
  if (!['text', 'json', 'sarif', 'github'].includes(o.format)) fail(`unknown --format ${o.format}`);
  if (o.lock && !o.connect && !o.manifest.length) fail('--lock needs definitions: --connect or --manifest <tools.json>');
  const { runMcpAudit } = await import('./mcpaudit.mjs');
  const r = await runMcpAudit({ configs: positionals, user: !o['no-user'] && !positionals.length, manifest: o.manifest, connect: o.connect, lock: o.lock, check: o.check, timeout: Number(o.timeout) * 1000 }, { log: (m) => process.stderr.write(`injex: ${m}
`) });
  const rank = (s) => SEVERITIES.indexOf(s);
  const result = { files: r.files, scanned: r.files.length, skipped: { binary: 0, large: 0, unreadable: 0, ignored: 0 }, failOn: o['fail-on'], failing: 0 };
  const all = result.files.flatMap((f) => f.findings);
  result.failing = o['fail-on'] === 'none' ? 0 : all.filter((x) => rank(x.severity) <= rank(o['fail-on'])).length;
  if (o.format === 'json') process.stdout.write(formatJson(result, VERSION));
  else if (o.format === 'sarif') process.stdout.write(formatSarif(result, VERSION));
  else if (o.format === 'github') process.stdout.write(formatGithub(result) + formatText(result, { color: false, quiet: true }));
  else {
    process.stderr.write(`injex: ${r.read.length} config file${r.read.length === 1 ? '' : 's'} read, ${r.servers.length} MCP server${r.servers.length === 1 ? '' : 's'}${r.manifests ? `, ${r.manifests} manifest${r.manifests === 1 ? '' : 's'} checked` : o.connect ? '' : ' (tool definitions not checked: add --connect or --manifest)'}
`);
    process.stdout.write(formatText(result, { color: useColor(process.stdout) }));
  }
  for (const e of r.errors) process.stderr.write(`injex: ${safe(e)}
`);
  if (r.lock) process.stderr.write(`injex: wrote ${o.lock} (${Object.keys(r.lock.servers).length} servers)
`);
  if (o.sarif) writeFileSync(o.sarif, formatSarif(result, VERSION));
  return result.failing ? 1 : 0;
}

// ── MCP runtime proxy ──

async function cmdMcpProxy(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { mode: { type: 'string', default: 'warn' }, lock: { type: 'string' }, log: { type: 'string' }, name: { type: 'string' }, inject: { type: 'string' }, 'inject-file': { type: 'string' }, 'inject-style': { type: 'string', default: 'plain' }, 'inject-tool': { type: 'string', multiple: true, default: [] }, canary: { type: 'string' } } });
  if (!['warn', 'block', 'inject'].includes(o.mode)) fail('--mode is warn, block or inject');
  if (!positionals.length) fail('injex mcp-proxy [--mode warn|block|inject] [--lock mcp.lock.json] -- <server command> [args…]');
  let inject = null;
  if (o.mode === 'inject') {
    if (!['plain', 'tags', 'note'].includes(o['inject-style'])) fail('--inject-style is plain, tags or note');
    let text = o['inject-file'] ? readFileSync(o['inject-file'], 'utf8') : o.inject;
    if (!text) {
      const { newCanary } = await import('../src/core/canary.js');
      const { labPayload } = await import('../src/core/lab.js');
      const canary = o.canary || newCanary();
      text = labPayload(canary);
      process.stderr.write(`injex: injecting the canary instruction for ${canary} into tool results — check the agent's answers with injex canary check ${canary}\n`);
    }
    inject = { text, style: o['inject-style'], tools: o['inject-tool'] };
  } else if (o.inject || o['inject-file']) fail('--inject needs --mode inject');
  const { runProxy } = await import('./mcpproxy.mjs');
  return runProxy(positionals, { mode: o.mode, lockPath: o.lock, logPath: o.log, server: o.name, inject });
}

// ── canary tokens ──

async function cmdCanary(argv) {
  const [sub, ...rest] = argv;
  const { newCanary, findCanary, canaryForms } = await import('../src/core/canary.js');
  if (sub === 'new') {
    const { values: o } = parseArgs({ args: rest, options: { prefix: { type: 'string', default: 'INJX' }, words: { type: 'boolean', default: false }, count: { type: 'string', default: '1' }, json: { type: 'boolean', default: false } } });
    const n = Math.max(1, Math.min(1000, Number(o.count) || 1));
    const tokens = Array.from({ length: n }, () => newCanary({ prefix: o.prefix, style: o.words ? 'words' : 'code' }));
    if (o.json) process.stdout.write(JSON.stringify(tokens.map((t) => ({ token: t, forms: canaryForms(t) })), null, 2) + '\n');
    else process.stdout.write(tokens.join('\n') + '\n');
    return 0;
  }
  if (sub === 'check') {
    const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: 'boolean', default: false } } });
    const [token, ...paths] = positionals;
    if (!token) fail('canary check needs the token: injex canary check <token> [files…]');
    const { peel } = await import('../src/core/decoder.js');
    const decode = (x) => {
      const l = peel(x);
      return l.length ? { text: l.at(-1).text, method: l.map((y) => y.method).join(' → ') } : null;
    };
    const inputs = [];
    if (!paths.length || (paths.length === 1 && paths[0] === '-')) inputs.push({ file: '<stdin>', text: await stdin() });
    else {
      const { files, missing } = expandPaths(paths, { git: false });
      if (missing.length) fail(`not found: ${missing.join(', ')}`);
      for (const abs of files) {
        const r = readText(abs, 64 * 1024 * 1024);
        if (!r.skip) inputs.push({ file: toRel(abs), text: r.text });
      }
    }
    const hits = inputs.map((i) => ({ file: i.file, ...findCanary(i.text, token, { decode }) })).filter((h) => h.found);
    if (o.json) process.stdout.write(JSON.stringify({ token, leaked: hits.length > 0, hits: hits.map((h) => ({ file: h.file, how: h.how })) }, null, 2) + '\n');
    else if (hits.length) for (const h of hits) process.stdout.write(`${safe(h.file)}: canary found (${h.how.join(', ')})\n`);
    else process.stdout.write(`Canary not found in ${inputs.length} input${inputs.length === 1 ? '' : 's'}\n`);
    return hits.length ? 1 : 0;
  }
  if (sub === 'listen') {
    const { values: o } = parseArgs({ args: rest, options: { port: { type: 'string', default: '8787' }, host: { type: 'string', default: '127.0.0.1' }, token: { type: 'string', multiple: true, default: [] }, log: { type: 'string' }, 'max-requests': { type: 'string' } } });
    if (!['127.0.0.1', '::1', 'localhost'].includes(o.host)) fail('the listener only binds to this machine (127.0.0.1, ::1 or localhost)');
    const { createServer } = await import('node:http');
    const max = o['max-requests'] ? Number(o['max-requests']) : Infinity;
    let served = 0;
    const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    await new Promise((done) => {
      const server = createServer((req, res) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
          size += c.length;
          if (size <= 64 * 1024) chunks.push(c);
        });
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let url = req.url || '/';
          try {
            url = decodeURIComponent(url);
          } catch {
            /* keep raw */
          }
          const seen = `${req.method} ${url}\n${body}`;
          const leaks = o.token.map((t) => ({ token: t, ...findCanary(seen, t) })).filter((h) => h.found).map((h) => ({ token: h.token, how: h.how }));
          const entry = { time: new Date().toISOString(), method: req.method, url: req.url, headers: { 'user-agent': req.headers['user-agent'] || '', referer: req.headers.referer || '', 'content-type': req.headers['content-type'] || '' }, body: body.slice(0, 8000), ...(leaks.length ? { canary: leaks } : {}) };
          process.stdout.write(JSON.stringify(entry) + '\n');
          if (o.log) appendFileSync(o.log, JSON.stringify(entry) + '\n');
          for (const l of leaks) process.stderr.write(`injex: canary ${l.token} arrived (${l.how.join(', ')}) — ${req.method} ${safe(req.url).slice(0, 200)}\n`);
          if (/\.(png|gif|jpe?g|webp|svg)(\?|$)/i.test(req.url || '') || /image/.test(req.headers.accept || '')) res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' }).end(GIF);
          else res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok\n');
          if (++served >= max) server.close(done);
        });
      });
      server.listen(Number(o.port), o.host, () => process.stderr.write(`injex: listening on http://${o.host.includes(':') ? `[${o.host}]` : o.host}:${server.address().port} — requests are logged as JSON lines${o.token.length ? `, ${o.token.length} canar${o.token.length === 1 ? 'y' : 'ies'} watched` : ''}\n`));
    });
    return 0;
  }
  fail('canary: new | check <token> [files…] | listen [--port 8787] [--token T]');
}

// ── MCP server ──

async function cmdMcp(argv) {
  const { values: o } = parseArgs({ args: argv, options: { root: { type: 'string', multiple: true, default: [] } } });
  const { serveStdio } = await import('./mcp.mjs');
  // an MCPB host passes "--root ${user_config.root}" even when no folder was picked: skip empty / unexpanded ones
  const roots = o.root.filter((r) => r && !r.includes('${'));
  await serveStdio({ version: VERSION, roots: [process.cwd(), ...roots] });
  return 0;
}

// ── main ──

const cmdAudit = (argv) => cmdScan(['--audit-only', ...argv]);

const COMMANDS = { scan: cmdScan, audit: cmdAudit, event: cmdEvent, 'mcp-audit': cmdMcpAudit, 'mcp-proxy': cmdMcpProxy, batch: cmdBatch, run: cmdRun, report: cmdReport, results: cmdResults, review: cmdReview, 'judge-eval': cmdJudgeEval, import: cmdImport, jsonl: cmdJsonl, lab: cmdLab, url: cmdUrl, clean: cmdClean, decode: cmdDecode, encode: cmdEncode, list: cmdList, inspect: cmdInspect, tokens: async (argv) => (await import('./tokens.mjs')).cmdTokens(argv, { parseArgs, textArg, fail, useColor }), diff: cmdDiff, mcp: cmdMcp, canary: cmdCanary };

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(HELP);
    return cmd ? 0 : 2;
  }
  if (cmd === '-v' || cmd === '--version') {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  const own = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest; // not the proxied server's
  if (own.includes('-h') || own.includes('--help')) {
    const { commandHelp } = await import('./help.mjs');
    process.stdout.write(commandHelp(cmd) || HELP);
    return 0;
  }
  const fn = COMMANDS[cmd];
  if (!fn) fail(`unknown command "${cmd}"`);
  try {
    return await fn(rest);
  } catch (e) {
    if (e?.code?.startsWith?.('ERR_PARSE_ARGS')) fail(e.message);
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2));
