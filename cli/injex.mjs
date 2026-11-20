#!/usr/bin/env node
// injex on the command line: scan files for hidden text (for CI), clean them, decode / encode, inspect
// characters and compare texts. Uses the extension's own modules; no dependencies. Node 20+.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { expandPaths, readText, readIgnoreFile, toRel } from './files.mjs';
import { scanFileText } from './scan-files.mjs';
import { formatText, formatJson, formatSarif, formatGithub, githubSummary, safe, SEVERITIES } from './report.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `injex ${VERSION} — find, remove and decode hidden text

Usage
  injex scan [paths…]            scan files and folders for hidden text (default: .)
  injex clean [paths…]           remove hidden characters (stdin → stdout without paths)
  injex decode [text]            universal decoder: peels Base64 / ROT13 / hex / tags … layers
  injex encode <t1,t2…> [text]   encode with one or more transforms (see injex list)
  injex list [filter]            list the transforms
  injex inspect [text]           every character: code point, name, category, script, flags
  injex diff <a> <b>             compare two files code point by code point

Text arguments can be left out to read stdin.

scan options
  --format <f>        text (default), json, sarif or github (annotations + job summary)
  --fail-on <sev>     exit 1 when a finding is at least: critical, high (default), medium, low, none
  --min-severity <s>  only report findings at least this severe (default: low)
  --sarif <file>      also write a SARIF report (for GitHub code scanning)
  --output <file>     write the report to a file instead of stdout
  --exclude <glob>    skip matching paths (repeatable); .injexignore in the current folder adds more
  --max-size <bytes>  skip larger files (default 2 MB)
  --no-git            walk folders instead of asking git which files belong to the project
  --quiet             only the summary line (text format)

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
      'no-git': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
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
    result.files.push({ file: '<stdin>', findings: scanFileText(text, { file: '<stdin>' }) });
  } else {
    const exclude = [...o.exclude, ...readIgnoreFile('.injexignore')];
    const { files, ignored, missing } = expandPaths(positionals, { exclude, git: !o['no-git'] });
    if (missing.length) fail(`not found: ${missing.join(', ')}`);
    result.skipped.ignored = ignored;
    for (const abs of files) {
      const r = readText(abs, maxSize);
      if (r.skip) {
        result.skipped[r.skip]++;
        continue;
      }
      result.scanned++;
      const file = toRel(abs);
      result.files.push({ file, findings: scanFileText(r.text, { file }) });
    }
  }
  for (const f of result.files) f.findings = f.findings.filter((x) => rank(x.severity) <= minRank);
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
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { decode: { type: 'boolean', short: 'd', default: false } } });
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

// ── main ──

const COMMANDS = { scan: cmdScan, clean: cmdClean, decode: cmdDecode, encode: cmdEncode, list: cmdList, inspect: cmdInspect, diff: cmdDiff };

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
  if (rest.includes('-h') || rest.includes('--help')) {
    process.stdout.write(HELP);
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
