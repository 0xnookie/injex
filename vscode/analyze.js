// What the VS Code extension shows, without VS Code: findings of injex's scanner as editor ranges
// (0-based, UTF-16 like VS Code positions), diagnostic messages, hover Markdown and whether the "remove
// hidden characters" fix applies. injex's core modules are passed in (they are ES modules; extension.js
// loads them), so this file has no imports and is tested in Node (test/vscode-tests.mjs).

'use strict';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const rank = (s) => (SEVERITIES.indexOf(s) < 0 ? SEVERITIES.length : SEVERITIES.indexOf(s));

/** Escape text for VS Code Markdown (hovers). */
function md(s) {
  return String(s ?? '').replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function createAnalyzer(core) {
  const { scanFileText, auditFile, isAuditFile, stripHidden, visualize, KINDS = {}, tagsForFinding, tagLabel } = core;

  const lineStarts = (text) => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  };

  /** One scanner / audit finding → an editor range and what to show for it. */
  function toEditorFinding(f, text, starts, source) {
    const line0 = Math.max(0, (f.line || 1) - 1);
    const endLine0 = Math.max(line0, (f.endLine || f.line || 1) - 1);
    const lineLen = (l) => (l + 1 < starts.length ? starts[l + 1] - 1 : text.length) - (starts[l] ?? text.length);
    const col0 = Math.min(Math.max(0, (f.column || 1) - 1), Math.max(0, lineLen(line0)));
    let endCol0 = f.endColumn ? f.endColumn - 1 : col0 + 1;
    if (endLine0 === line0 && endCol0 <= col0) endCol0 = Math.min(col0 + 1, lineLen(line0));
    endCol0 = Math.min(endCol0, Math.max(0, lineLen(endLine0)));
    const startOff = (starts[line0] ?? 0) + col0;
    const endOff = (starts[endLine0] ?? 0) + endCol0;
    const slice = text.slice(startOff, endOff);
    const cleaned = stripHidden(slice);
    const label = f.rule ? `agent config (${f.rule})` : KINDS[f.kind]?.label || f.kind;
    const decoded = f.payload && f.kind !== 'config' ? visualize(String(f.payload), 160) : '';
    let message = `${label}: ${f.note}`;
    if (decoded) message += ` — hidden text: “${decoded}”`;
    if (f.instructions) message += ' — reads like instructions to a model';
    return {
      source,
      kind: f.kind,
      rule: f.rule || null,
      severity: f.severity,
      range: { line: line0, character: col0, endLine: endLine0, endCharacter: endCol0 },
      offsets: [startOff, endOff],
      message,
      payload: f.payload || '',
      shown: f.ctx?.match || '',
      decoded,
      instructions: !!f.instructions,
      refs: f.refs || [],
      tags: tagsForFinding ? tagsForFinding(f) : [],
      fixable: cleaned.text !== slice,
      finding: f,
    };
  }

  /** Findings for a document's text. `file` is its workspace-relative path (agent files are judged harder). */
  function analyze(text, file = '', { minSeverity = 'low', audit = true } = {}) {
    const t = String(text ?? '');
    const starts = lineStarts(t);
    const out = scanFileText(t, { file }).map((f) => toEditorFinding(f, t, starts, 'scan'));
    if (audit && file && isAuditFile(file)) out.push(...auditFile(file, t).map((f) => toEditorFinding(f, t, starts, 'audit')));
    return out.filter((f) => rank(f.severity) <= rank(minSeverity)).sort((a, b) => a.offsets[0] - b.offsets[0] || rank(a.severity) - rank(b.severity));
  }

  /** Hover Markdown for one finding. */
  function hover(f) {
    const parts = [`**injex · ${md(f.severity)}** · ${md(f.rule ? 'agent configuration' : KINDS[f.kind]?.label || f.kind)}`, md(f.finding.note)];
    if (KINDS[f.kind]?.desc) parts.push(`_${md(KINDS[f.kind].desc)}_`);
    if (f.decoded) parts.push('Hidden text, decoded:\n\n```text\n' + f.decoded.replace(/`{3,}/g, (m) => m.split('').join(' ')) + '\n```');
    if (f.instructions) parts.push('⚠ Reads like instructions to a model' + (f.finding.signals?.length ? ` (${md(f.finding.signals.join(', '))})` : '') + '.');
    if (f.refs.length) parts.push('See ' + f.refs.map((r) => (/^CVE-/.test(r) ? `[${r}](https://nvd.nist.gov/vuln/detail/${r})` : md(r))).join(', '));
    if (f.tags.length && tagLabel) parts.push(f.tags.map((t) => '`' + tagLabel(t).replace(/`/g, "'") + '`').join(' '));
    if (f.fixable) parts.push('Quick fix: **Remove hidden characters** (Ctrl+.)');
    return parts.join('\n\n');
  }

  /** Text without hidden characters (the quick fix and "injex: Remove hidden characters"). */
  function clean(text) {
    return stripHidden(String(text ?? ''));
  }

  return { analyze, hover, clean, SEVERITIES };
}

module.exports = { createAnalyzer, SEVERITIES, md };
