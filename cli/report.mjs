// Output formats for `injex scan`: text (terminal), json, sarif (GitHub code scanning and other SARIF
// viewers) and github (workflow-command annotations plus a job summary).

import { KINDS, SEVERITY_ORDER, visualize } from '../src/core/scan.js';
import { tagsForFinding, TAGS } from '../src/core/taxonomy.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const LEVEL = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SECURITY_SEVERITY = { tags: '9.0', 'vs-bits': '9.0', 'vs-bytes': '9.0', bits: '9.0', bidi: '7.5', filler: '7.5', 'zero-width': '6.0', comment: '5.0', homoglyph: '4.0', zalgo: '3.0', encoded: '7.0', 'css-hidden': '6.0', 'doc-hidden': '7.0', metadata: '6.0', 'doc-comment': '5.0', unrendered: '7.0', 'ai-directive': '1.0', exfil: '8.0', 'agent-danger': '8.0', config: '8.0', 'mcp-tool': '8.5', 'mcp-config': '7.5', 'mcp-drift': '8.0', 'event-text': '7.0', canary: '9.0' };
export const HOME = 'https://github.com/0xnookie/injex';

/** Printable in a terminal / log: no control characters (a hidden payload can carry ESC sequences). */
export function safe(s) {
  return String(s ?? '').replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

const one = (s, max) => safe(visualize(String(s ?? '').replace(/\s+/g, ' ').trim(), max));

/** One-line description of a finding (`where` adds the place inside a document: "page 2"). */
export function message(f, max = 120, { where = false } = {}) {
  const note = where && f.where ? `${f.note} (${safe(f.where)})` : f.note;
  const ml = f.ml ? ` [ML ${f.ml.score.toFixed(2)}]` : '';
  if (f.payload) return `${note}: “${one(f.payload, max)}”${f.instructions ? ' — reads like instructions to a model' : ''}${ml}`;
  const ctx = f.ctx ? `${f.ctx.before}⟦${f.ctx.match}⟧${f.ctx.after}` : '';
  return ctx ? `${note} in “${safe(ctx.replace(/\s+/g, ' ').trim())}”` : note;
}

/** "12:5" in a text file, "p.2" / "¶14" / "meta" in a document. */
export const locOf = (f) => (f.loc ? safe(f.loc) : `${f.line}:${f.column}`);

export function countBySeverity(findings) {
  const out = {};
  for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1;
  return out;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ── text ──

const ANSI = { critical: '\x1b[1;31m', high: '\x1b[31m', medium: '\x1b[33m', low: '\x1b[2m', info: '\x1b[2m', dim: '\x1b[2m', bold: '\x1b[1m', ok: '\x1b[32m', reset: '\x1b[0m' };

export function formatText(result, { color = false, quiet = false } = {}) {
  const c = (k, s) => (color ? ANSI[k] + s + ANSI.reset : s);
  const out = [];
  const all = result.files.flatMap((f) => f.findings);
  if (!quiet) {
    for (const { file, findings, warnings = [] } of result.files) {
      if (!findings.length && !warnings.length) continue;
      out.push(c('bold', safe(file)));
      for (const w of warnings) out.push(c('dim', `  ! ${safe(w)}`));
      const shown = findings.slice(0, 50);
      const width = Math.max(0, ...shown.map((f) => locOf(f).length));
      for (const f of shown) {
        const label = KINDS[f.kind]?.label || f.kind;
        out.push(`  ${c('dim', locOf(f).padEnd(width))}  ${c(f.severity, f.severity.padEnd(8))}  ${label.padEnd(19)} ${message(f)}`);
      }
      if (findings.length > shown.length) out.push(c('dim', `  … ${findings.length - shown.length} more in this file (use --format json for all)`));
      out.push('');
    }
  }
  const sk = result.skipped;
  const skipped = [sk.binary && `${sk.binary} binary`, sk.large && `${sk.large} too large`, sk.unreadable && `${sk.unreadable} unreadable`, sk.ignored && `${sk.ignored} excluded`].filter(Boolean).join(', ');
  const scanned = `${plural(result.scanned, 'file')} scanned${skipped ? ` (skipped: ${skipped})` : ''}`;
  if (!all.length) out.push(c('ok', '✓ ') + `No hidden text found — ${scanned}`);
  else {
    const by = countBySeverity(all);
    const sev = SEVERITIES.filter((s) => by[s]).map((s) => c(s, `${by[s]} ${s}`)).join(', ');
    const files = result.files.filter((f) => f.findings.length).length;
    out.push(`${result.failing ? c('critical', '✖ ') : c('medium', '! ')}${plural(all.length, 'finding')} in ${plural(files, 'file')}: ${sev} — ${scanned}`);
    if (result.failOn !== 'none') out.push(c('dim', result.failing ? `Failing: ${plural(result.failing, 'finding')} at or above “${result.failOn}”.` : `Nothing at or above “${result.failOn}”, so this passes.`));
  }
  return out.join('\n') + '\n';
}

// ── json ──

export function formatJson(result, version) {
  const findings = result.files.flatMap(({ file, findings }) =>
    findings.map((f) => ({ file, line: f.line, column: f.column, endColumn: f.endColumn, ...(f.loc ? { location: f.loc, where: f.where } : {}), kind: f.kind, ...(f.rule ? { rule: f.rule } : {}), label: KINDS[f.kind]?.label || f.kind, severity: f.severity, instructions: !!f.instructions, ...(f.signals?.length ? { signals: f.signals } : {}), ...(f.exfil?.length ? { exfil: f.exfil } : {}), ...(f.agentFile ? { agentFile: true } : {}), ...(f.ml ? { ml: f.ml } : {}), count: f.count, note: f.note, payload: f.payload || '', context: f.ctx ? `${f.ctx.before}⟦${f.ctx.match}⟧${f.ctx.after}` : '', tags: tagsForFinding(f) })),
  );
  return JSON.stringify({ tool: 'injex', version, scanned: result.scanned, skipped: result.skipped, failOn: result.failOn, failing: result.failing, summary: countBySeverity(findings), findings }, null, 2) + '\n';
}

// ── SARIF 2.1.0 ──

export function formatSarif(result, version) {
  const kinds = Object.keys(KINDS);
  const rules = kinds.map((k) => ({
    id: 'injex/' + k,
    name: KINDS[k].label.replace(/[^A-Za-z0-9]+(.)?/g, (m, ch) => (ch ? ch.toUpperCase() : '')),
    shortDescription: { text: KINDS[k].label },
    fullDescription: { text: KINDS[k].desc },
    helpUri: HOME + '#-command-line-and-ci',
    help: { text: KINDS[k].desc + ' Run `injex clean --write <file>` to remove hidden characters.' },
    defaultConfiguration: { level: k === 'homoglyph' || k === 'comment' ? 'warning' : 'error' },
    properties: { tags: ['security', 'prompt-injection', ...tagsForFinding({ kind: k })], 'security-severity': SECURITY_SEVERITY[k] || '5.0', precision: k === 'css-hidden' || k === 'homoglyph' || k === 'ai-directive' ? 'medium' : 'high' },
  }));
  const results = result.files.flatMap(({ file, findings }) =>
    findings.map((f) => ({
      ruleId: 'injex/' + f.kind,
      ruleIndex: Math.max(0, kinds.indexOf(f.kind)),
      level: LEVEL[f.severity] || 'warning',
      message: { text: `${KINDS[f.kind]?.label || f.kind} (${f.severity}): ${message(f, 300, { where: true })}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: encodeURI(file), uriBaseId: '%SRCROOT%' }, region: { startLine: f.line, startColumn: f.column, endColumn: Math.max(f.endColumn || f.column + 1, f.column + 1) } } }],
      properties: { severity: f.severity, instructions: !!f.instructions, count: f.count, ...(f.rule ? { rule: f.rule } : {}), ...(f.agentFile ? { agentFile: true } : {}), ...(f.ml ? { ml: f.ml } : {}), tags: tagsForFinding(f) },
    })),
  );
  return (
    JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [{ tool: { driver: { name: 'injex', version, semanticVersion: version, informationUri: HOME, rules } }, columnKind: 'utf16CodeUnits', results }],
      },
      null,
      2,
    ) + '\n'
  );
}

// ── GitHub Actions ──

const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const COMMAND = { critical: 'error', high: 'error', medium: 'warning', low: 'notice', info: 'notice' };

/** Workflow commands (one annotation per finding). */
export function formatGithub(result) {
  const lines = [];
  for (const { file, findings } of result.files) {
    for (const f of findings) {
      const props = [`file=${escProp(file)}`, `line=${f.line}`, `col=${f.column}`, f.endColumn ? `endColumn=${f.endColumn}` : '', `title=${escProp(`injex: ${KINDS[f.kind]?.label || f.kind} (${f.severity})`)}`].filter(Boolean).join(',');
      lines.push(`::${COMMAND[f.severity] || 'warning'} ${props}::${escData(message(f, 200, { where: true }))}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function githubSummary(result) {
  const all = result.files.flatMap(({ file, findings }) => findings.map((f) => ({ file, ...f })));
  const md = ['### injex hidden-text scan', ''];
  if (!all.length) return md.concat([`✅ No hidden text in ${plural(result.scanned, 'file')}.`, '']).join('\n');
  const by = countBySeverity(all);
  md.push(`${result.failing ? '❌' : '⚠️'} ${plural(all.length, 'finding')} in ${plural(result.scanned, 'scanned file')}: ${SEVERITIES.filter((s) => by[s]).map((s) => `${by[s]} ${s}`).join(', ')}`, '');
  md.push('| Severity | Kind | Location | Details |', '|---|---|---|---|');
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
  for (const f of all.slice(0, 100)) md.push(`| ${f.severity} | ${KINDS[f.kind]?.label || f.kind} | \`${cell(f.file)}:${f.line}:${f.column}\` | ${cell(message(f, 100))} |`);
  if (all.length > 100) md.push('', `… and ${all.length - 100} more.`);
  md.push('', `Remove hidden characters with \`npx github:0xnookie/injex clean --write <file>\`.`, '');
  return md.join('\n');
}

export function sortFindings(findings) {
  return findings.sort((a, b) => a.line - b.line || a.column - b.column || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
