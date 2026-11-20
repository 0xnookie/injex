// Scan a file's text: every line with a suspicious character goes through the page scanner's text
// checks (so findings get a line and column), and in Markdown / HTML files, comments that don't
// render but read like instructions to a model are reported too.

import { scanText, looksLikeInstructions } from '../src/core/scan.js';

// cheap pre-filter: lines without any of these can't produce a finding
const QUICK = /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}\u{180E}\u{034F}\u{061C}\u{FE00}-\u{FE0F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{E0000}-\u{E01EF}]|[A-Za-z][\u{0370}-\u{03FF}\u{0400}-\u{04FF}]|[\u{0370}-\u{03FF}\u{0400}-\u{04FF}][A-Za-z]/u;
const COMMENT_FILES = /\.(?:md|mdx|markdown|html?|xhtml|svg|xml|vue|svelte|astro)$/i;
const MARKDOWN = /\.(?:md|mdx|markdown)$/i;

function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function position(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo] + 1 };
}

function hiddenComment(starts, index, length, body, how) {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length < 12 || !looksLikeInstructions(text)) return null;
  const { line, column } = position(starts, index);
  return {
    kind: 'comment',
    severity: 'medium',
    line,
    column,
    endColumn: column + Math.min(length, 200),
    count: text.length,
    payload: text.slice(0, 2000),
    instructions: true,
    note: `${how} (not rendered)`,
    ctx: { before: '', match: text.slice(0, 160), after: text.length > 160 ? '…' : '' },
  };
}

/**
 * Findings for one file: { kind, severity, line, column, endColumn, count, payload, instructions, note, ctx }.
 * Columns count UTF-16 code units from 1 (what editors and GitHub use).
 */
export function scanFileText(text, { file = '', stego } = {}) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    if (!QUICK.test(line)) continue;
    for (const f of scanText(line, { stego })) {
      const { start, end, ...rest } = f;
      findings.push({ ...rest, line: i + 1, column: start + 1, endColumn: end + 1 });
    }
  }
  if (COMMENT_FILES.test(file)) {
    const starts = lineStarts(text);
    for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const f = hiddenComment(starts, m.index, m[0].length, m[1], 'HTML comment');
      if (f) findings.push(f);
    }
    // Markdown "comments": link reference definitions that point nowhere — [//]: # (text)
    if (MARKDOWN.test(file)) {
      for (const m of text.matchAll(/^[ \t]{0,3}\[[^\]\n]*\]:[ \t]*(?:#|<>)[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\))[ \t]*$/gm)) {
        const f = hiddenComment(starts, m.index, m[0].length, m[1] ?? m[2] ?? m[3] ?? '', 'Markdown comment');
        if (f) findings.push(f);
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
