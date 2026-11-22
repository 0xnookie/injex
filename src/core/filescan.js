// Scan a file's text: every line with a suspicious character goes through the page scanner's text
// checks (so findings get a line and column); in Markdown / HTML / SVG files, comments, hidden elements
// and attributes that don't render but read like instructions to a model are reported too; documents
// and agent files are checked for exfiltration shapes; agent instruction files (AGENTS.md, CLAUDE.md,
// .cursorrules, skills …) get higher severities and a check for risky plain-text instructions.

import { scanText, looksLikeInstructions, instructionSignals, SEVERITY_ORDER } from './scan.js';
import { findExfil } from './exfil.js';

// cheap pre-filter: lines without any of these can't produce a finding
const QUICK = /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}\u{180E}\u{034F}\u{061C}\u{FE00}-\u{FE0F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{E0000}-\u{E01EF}]|[A-Za-z][\u{0370}-\u{03FF}\u{0400}-\u{04FF}]|[\u{0370}-\u{03FF}\u{0400}-\u{04FF}][A-Za-z]|[^\x00-\x7F]{3}/u;
const COMMENT_FILES = /\.(?:md|mdx|mdc|markdown|html?|xhtml|svg|xml|vue|svelte|astro)$/i;
const MARKUP_FILES = /\.(?:html?|xhtml|svg|vue|svelte|astro|md|mdx|mdc|markdown)$/i;
const MARKDOWN = /\.(?:md|mdx|mdc|markdown)$/i;
const PROSE_FILES = /\.(?:md|mdx|markdown|txt|text|rst|adoc|html?|xhtml|svg|xml|org|eml|ics|vcf|csv|tsv|json|jsonl|ya?ml|toml|ipynb)$/i;

// Files an AI coding agent reads as instructions (or loads as skills / commands / prompts).
const AGENT_NAMES = /(?:^|\/)(?:agents?\.md|claude(?:\.local)?\.md|gemini\.md|qwen\.md|crush\.md|warp\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.roorules|\.goosehints|\.rules|\.augment-guidelines|copilot-instructions\.md|conventions\.md|skill\.md|[\w.-]+\.(?:instructions|prompt|chatmode|agent)\.md|\.mdc)$/i;
const AGENT_DIRS = /(?:^|\/)(?:\.cursor\/rules|\.windsurf\/rules|\.windsurf\/workflows|\.clinerules|\.roo|\.kiro\/steering|\.amazonq\/rules|\.github\/instructions|\.github\/prompts|\.github\/chatmodes|\.github\/agents|\.claude\/(?:commands|agents|skills|output-styles)|\.gemini\/commands|\.continue\/(?:rules|prompts)|\.junie|\.trae\/rules|\.augment\/rules|\.qoder\/rules|\.codex|\.opencode\/(?:agent|command)|\.agents|\.zed\/rules)\//i;

/** Is `file` (a "/"-separated path) one that AI coding agents read as instructions, skills or prompts? */
export function isAgentFile(file) {
  const f = String(file || '').replace(/\\/g, '/');
  return AGENT_NAMES.test(f) || (AGENT_DIRS.test(f) && !/\.(?:png|jpe?g|gif|svg|ico|lock)$/i.test(f)) || /(?:^|\/)skills\/[^/]+\/skill\.md$/i.test(f);
}

// Plain-text instructions that are dangerous for an agent to follow — reported in agent files only.
export const DANGER = [
  { id: 'pipe-to-shell', severity: 'high', label: 'pipes a download into a shell or interpreter', re: /\b(?:curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k|fi)?sh|iex|Invoke-Expression|python3?|node|perl|ruby|pwsh|powershell)\b/i },
  { id: 'decode-exec', severity: 'high', label: 'decodes and executes hidden code', re: /\bbase64\s+(?:-d|--decode|-D)\b[^\n|]{0,80}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\beval\s*\(?\s*["'`$(]*\s*(?:curl|wget|atob|base64|Buffer\.from)\b|\bFromBase64String\b[^\n]{0,120}\b(?:iex|Invoke-Expression)\b/i },
  { id: 'destructive', severity: 'high', label: 'deletes or wipes broadly', re: /\brm\s+-(?:rf|fr|r\s+-f|-recursive\s+--force)\s+(?:\/(?:\s|$|\*)|~\/?(?:\s|$)|\$HOME\b|\*(?:\s|$)|\/\*)|\bmkfs(?:\.\w+)?\s+\/dev\/|\bdd\s+if=[^\n]{0,60}\bof=\/dev\/(?:sd|nvme|disk)|\bformat\s+c:|\b(?:aws\s+s3\s+(?:rm|rb)\b[^\n]{0,40}--recursive|aws\s+(?:ec2\s+terminate-instances|iam\s+delete-\w+|rds\s+delete-db)|gcloud\s+(?:[\w-]+\s+){1,3}delete\b|az\s+(?:[\w-]+\s+){1,3}delete\b|kubectl\s+delete\s+(?:ns|namespace|all|--all)\b|terraform\s+destroy\b[^\n]{0,40}-auto-approve)|\bRemove-Item\b[^\n]{0,80}-Recurse\b[^\n]{0,40}-Force\b[^\n]{0,40}(?:[A-Z]:\\|\$env:USERPROFILE|~)/i },
  { id: 'bypass', severity: 'high', label: 'turns off permission prompts or the sandbox', re: /--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox|--yolo\b|--trust-all-tools|--allow-all-tools|--full-auto\b|--approval-mode[= ](?:yolo|full-auto|never)|\bbypassPermissions\b|"?chat\.tools\.autoApprove"?\s*[:=]\s*true|\bautoApprove\b\s*[:=]\s*(?:true|\[)|--sandbox[= ](?:none|off|danger-full-access)|\bdanger-full-access\b|\bYOLO mode\b/i },
  { id: 'secrecy', severity: 'high', label: 'tells the agent to keep something from the user', re: /\b(?:do not|don't|never)\s+(?:tell|inform|notify|show|mention|alert|ask|warn)\s+(?:the\s+)?(?:user|human|developer|operator|reviewer)\b|\bwithout\s+(?:asking|telling|informing|notifying|confirmation|approval|user (?:approval|confirmation))\b|\b(?:silently|quietly|secretly|covertly)\s+(?:run|execute|send|upload|delete|modify|install|add|commit|push)\b/i },
  { id: 'disable-safety', severity: 'high', label: 'tells the agent to ignore safety checks', re: /\b(?:disable|turn off|bypass|skip|ignore)\s+(?:the\s+|all\s+|any\s+)?(?:sandbox(?:ing)?|safety (?:checks|rules|guidelines)|security (?:checks|warnings|rules)|guardrails?|permission (?:checks|prompts|requests)|confirmations?|approval (?:prompts|steps))\b/i },
  { id: 'credentials', severity: 'medium', label: 'reads credentials or secrets', re: /(?:~|\$HOME|%USERPROFILE%|\$env:USERPROFILE)[\\/]\.(?:ssh|aws|gnupg|kube|docker|azure|config[\\/]gcloud)\b|\bid_(?:rsa|ed25519|ecdsa)\b|\.git-credentials\b|(?:^|[\s"'`/])\.(?:npmrc|pypirc|netrc)\b|\bcredentials\.json\b|\bcat\s+[^\n]{0,40}\.env\b|\bprintenv\b|\bGet-ChildItem\s+env:/i },
];

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

function hiddenText(starts, index, length, body, how, kind = 'comment', severity = 'medium') {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length < 12) return null;
  const sig = instructionSignals(text);
  const exfil = findExfil(text);
  if (!sig.instructions && !exfil.length) return null;
  const { line, column } = position(starts, index);
  return {
    kind,
    severity,
    line,
    column,
    endColumn: column + Math.min(length, 200),
    count: text.length,
    payload: text.slice(0, 2000),
    instructions: true,
    ...(sig.signals.length ? { signals: sig.signals } : {}),
    ...(exfil.length ? { exfil: exfil.map((e) => e.rule) } : {}),
    note: how,
    ctx: { before: '', match: text.slice(0, 160), after: text.length > 160 ? '…' : '' },
  };
}

const stripTags = (s) => s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

// inline styles that hide an element (the static subset of the page scanner's checks)
const HIDING_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|font-size\s*:\s*0(?:\.\d+)?(?:px|pt|em|rem)?\s*(?:;|$|!)|(?:height|width)\s*:\s*0(?:px)?\s*;[^"']*overflow\s*:\s*hidden|color\s*:\s*transparent|clip-path\s*:\s*inset\(\s*(?:50|100)%|text-indent\s*:\s*-\d{4,}|(?:left|top)\s*:\s*-\d{4,}px)/i;

// declarations of an inline style that hide without a keyword: white / near-white text with no dark
// background in the same style (the static check assumes a light page), or a box of a pixel or less
function styleHides(css) {
  const d = Object.fromEntries(
    css
      .split(';')
      .map((x) => x.split(':'))
      .filter((x) => x.length >= 2)
      .map(([k, ...v]) => [k.trim().toLowerCase(), v.join(':').trim().toLowerCase()]),
  );
  const px = (v) => (/^-?[\d.]+(px)?$/.test(v || '') ? parseFloat(v) : NaN);
  if (px(d.width) <= 1 && px(d.height) <= 1 && /hidden|clip/.test(d.overflow || '')) return true;
  const rgb = (c) => {
    if (!c) return null;
    if (c === 'white') return [255, 255, 255];
    let m = /^#([0-9a-f]{3})$/.exec(c);
    if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
    m = /^#([0-9a-f]{6})$/.exec(c);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const fg = rgb(d.color);
  const bg = rgb(d['background-color'] || d.background);
  return !!fg && Math.min(...fg) >= 235 && (!bg || Math.min(...bg) >= 200);
}

/** Hidden elements and instruction-like attributes in HTML / SVG / Markdown source. */
function markupFindings(text, starts, file) {
  const out = [];
  const push = (f) => f && out.push(f);
  // elements hidden with inline styles, the hidden attribute, or SVG presentation attributes
  // (opening tags first, so only hiding elements pay for the search for their closing tag)
  for (const m of text.matchAll(/<([a-z][\w:-]*)\b([^<>]*)>/gi)) {
    const attrs = m[2];
    if (!attrs || !/style|hidden|opacity|fill|font-size|visibility|display/i.test(attrs)) continue;
    const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const css = style ? style[1] ?? style[2] : '';
    let why = '';
    if (css && (HIDING_STYLE.test(css) || styleHides(css))) why = `inline style “${css.trim().slice(0, 80)}”`;
    else if (/(?:^|\s)hidden(?:\s|=|$)/i.test(attrs)) why = 'hidden attribute';
    else if (/^(?:text|tspan|g|textPath)$/i.test(m[1]) && /\b(?:opacity|fill-opacity)\s*=\s*["']?0(?:\.0+)?["'\s>]|\bfill\s*=\s*["']?none\b|\bfont-size\s*=\s*["']?0(?:\.\d+)?["'\s>]|\bvisibility\s*=\s*["']?hidden|\bdisplay\s*=\s*["']?none/i.test(attrs)) why = 'invisible SVG text';
    if (!why) continue;
    const from = m.index + m[0].length;
    const close = text.slice(from, from + 8000).search(new RegExp(`</${m[1].replace(/[^\w:-]/g, '')}\\s*>`, 'i'));
    if (close < 0) continue;
    push(hiddenText(starts, m.index, m[0].length + close, stripTags(text.slice(from, from + close)), `${why} (not rendered)`, 'css-hidden', 'high'));
  }
  // attributes a reader doesn't see but an agent reads
  for (const m of text.matchAll(/\b(alt|title|aria-label|aria-description|content|value|summary|data-[\w-]+)\s*=\s*(?:"([^"]{20,4000})"|'([^']{20,4000})')/gi)) {
    push(hiddenText(starts, m.index, m[0].length, (m[2] ?? m[3]).replace(/&quot;/g, '"').replace(/&amp;/g, '&'), `${m[1]} attribute (not shown)`, 'unrendered', 'high'));
  }
  // the page title (shown only in the tab strip, read by every agent)
  for (const m of text.matchAll(/<title\b[^>]*>([\s\S]{0,2000}?)<\/title>/gi)) push(hiddenText(starts, m.index, m[0].length, stripTags(m[1]), 'page title (not on the page)', 'unrendered', 'high'));
  // JSON-LD and noscript / template content
  for (const m of text.matchAll(/<script\b[^>]*ld\+json[^>]*>([\s\S]{0,20000}?)<\/script>/gi)) push(hiddenText(starts, m.index, m[0].length, m[1].replace(/[{}[\]",:]+/g, ' '), 'JSON-LD (not shown)', 'unrendered', 'high'));
  for (const m of text.matchAll(/<(noscript|template)\b[^>]*>([\s\S]{0,20000}?)<\/\1>/gi)) push(hiddenText(starts, m.index, m[0].length, stripTags(m[2]), `<${m[1].toLowerCase()}> (not shown)`, 'unrendered', 'high'));
  // Markdown image alt text is what an agent reads instead of the picture
  if (MARKDOWN.test(file)) for (const m of text.matchAll(/!\[([^\]\n]{20,500})\]\(/g)) push(hiddenText(starts, m.index, m[0].length, m[1], 'image alt text', 'unrendered', 'medium'));
  return out;
}

const BUMP = { low: 'medium', medium: 'high', high: 'high', critical: 'critical', info: 'info' };
// exfiltration rules that are common in ordinary docs: quieter outside agent files
const SOFT_EXFIL = new Set(['collector', 'link-mismatch', 'memory', 'mermaid', 'remote-schema', 'link-data']);

/**
 * Findings for one file: { kind, severity, line, column, endColumn, count, payload, instructions, note, ctx }.
 * Columns count UTF-16 code units from 1 (what editors and GitHub use).
 */
export function scanFileText(text, { file = '', stego } = {}) {
  if (/\.ipynb$/i.test(file)) {
    const nb = notebookFindings(text, stego);
    if (nb) return nb;
  }
  const findings = [];
  const agent = isAgentFile(file);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    if (!QUICK.test(line)) continue;
    for (const f of scanText(line, { stego, exfil: false })) {
      const { start, end, ...rest } = f;
      findings.push({ ...rest, line: i + 1, column: start + 1, endColumn: end + 1 });
    }
  }
  const starts = COMMENT_FILES.test(file) || PROSE_FILES.test(file) || agent ? lineStarts(text) : null;
  if (COMMENT_FILES.test(file)) {
    for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const f = hiddenText(starts, m.index, m[0].length, m[1], 'HTML comment (not rendered)');
      if (f) findings.push(f);
    }
    // Markdown "comments": link reference definitions that point nowhere — [//]: # (text)
    if (MARKDOWN.test(file)) {
      for (const m of text.matchAll(/^[ \t]{0,3}\[[^\]\n]*\]:[ \t]*(?:#|<>)[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\))[ \t]*$/gm)) {
        const f = hiddenText(starts, m.index, m[0].length, m[1] ?? m[2] ?? m[3] ?? '', 'Markdown comment (not rendered)');
        if (f) findings.push(f);
      }
    }
  }
  if (MARKUP_FILES.test(file)) findings.push(...markupFindings(text, starts, file));
  // exfiltration shapes in prose, markup, data files and agent files (not in code, where URLs with
  // variables are normal)
  if (agent || PROSE_FILES.test(file)) {
    for (const e of findExfil(text.length > 4 * 1024 * 1024 ? text.slice(0, 4 * 1024 * 1024) : text)) {
      if (e.rule === 'remote-schema' && /.json[c5]?$/i.test(file)) continue; // the audit's rule, with its CVEs
      const { line, column } = position(starts, e.index);
      const severity = !agent && SOFT_EXFIL.has(e.rule) && e.severity !== 'high' ? 'low' : e.severity;
      findings.push({ kind: 'exfil', rule: e.rule, severity, line, column, endColumn: column + Math.min(e.length, 200), count: 1, payload: e.url || e.match, note: e.note, ctx: { before: '', match: e.match.slice(0, 160), after: e.match.length > 160 ? '…' : '' } });
    }
  }
  if (agent) {
    for (const f of findings) {
      f.severity = BUMP[f.severity] || f.severity;
      f.agentFile = true;
    }
    for (const d of DANGER) {
      const lines = new Set();
      for (const m of text.matchAll(new RegExp(d.re.source, d.re.flags.includes('g') ? d.re.flags : d.re.flags + 'g'))) {
        const { line, column } = position(starts, m.index);
        if (lines.has(line)) continue; // one finding per rule and line
        lines.add(line);
        if (lines.size > 20) break;
        findings.push({ kind: 'agent-danger', rule: d.id, severity: d.severity, line, column, endColumn: column + Math.min(m[0].length, 200), count: 1, payload: m[0].slice(0, 400), agentFile: true, note: d.label, ctx: { before: '', match: m[0].slice(0, 160), after: '' } });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * A Jupyter notebook, cell by cell: Markdown cells as Markdown (comments, hidden HTML, alt text), code
 * cells as code, HTML outputs as HTML, text outputs as text. Findings point at the line where the cell
 * starts. null when the file isn't notebook JSON.
 */
function notebookFindings(text, stego) {
  let nb;
  try {
    nb = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(nb?.cells)) return null;
  const starts = lineStarts(text);
  const cellAt = [];
  for (let i = text.indexOf('"cell_type"'); i >= 0; i = text.indexOf('"cell_type"', i + 1)) cellAt.push(position(starts, i).line);
  const src = (s) => (Array.isArray(s) ? s.join('') : String(s ?? ''));
  const out = [];
  nb.cells.forEach((c, i) => {
    const line = cellAt[i] || 1;
    const add = (findings, where) => {
      for (const f of findings) out.push({ ...f, line, column: 1, endColumn: 2, where });
    };
    const kind = c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'code' ? 'code' : 'raw';
    add(scanFileText(src(c.source), { file: kind === 'markdown' ? 'cell.md' : kind === 'code' ? 'cell.py' : 'cell.txt', stego }), `cell ${i + 1} (${kind})`);
    for (const o of c.outputs || []) {
      if (o.data?.['text/html']) add(scanFileText(src(o.data['text/html']), { file: 'output.html', stego }), `cell ${i + 1} output`);
      if (o.data?.['text/markdown']) add(scanFileText(src(o.data['text/markdown']), { file: 'output.md', stego }), `cell ${i + 1} output`);
      const plain = o.text ?? o.data?.['text/plain'];
      if (plain) add(scanFileText(src(plain), { file: 'output.txt', stego }), `cell ${i + 1} output`);
    }
  });
  return out.sort((a, b) => a.line - b.line || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export { looksLikeInstructions };
