// Hidden text in documents (PDF, Word): what a reader can't see but text extraction — and every AI tool
// that reads the file — does. Turns the readers' output into scanner findings:
//   doc-hidden   white / same-colour / transparent / tiny / invisible / off-page / clipped / covered /
//                hidden-layer / hidden-formatted text, and tracked deletions that read like instructions
//   metadata     document properties and XMP that read like instructions
//   doc-comment  comments and annotations that read like instructions
// plus every check of scanText() (Unicode tags, emoji steganography, zero-width, bidi …) on all text.

import { scanText, looksLikeInstructions, SEVERITY_ORDER } from '../scan.js';
import { readPdf } from './pdf.js';
import { readDocx } from './docx.js';

export const DOC_EXT = /\.(?:pdf|docx|docm|dotx|dotm)$/i;

/** 'pdf', 'docx' or null, from the bytes (and the file name for Office files). */
export function documentType(bytes, name = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = String.fromCharCode(...u8.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04 && (/\.(docx|docm|dotx|dotm)$/i.test(name) || head.includes('word/'))) return 'docx';
  return null;
}

const short = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '…' : s);
const clean = (s) => s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** Consecutive chunks with the same hidden reason (in the same unit) → spans. */
function hiddenSpans(chunks, unitOf) {
  const spans = [];
  let cur = null;
  for (const c of chunks) {
    const unit = unitOf(c);
    if (c.hidden && cur && cur.reason === c.hidden && cur.unit === unit) cur.text += c.text;
    else if (c.hidden) spans.push((cur = { reason: c.hidden, unit, at: c, text: c.text }));
    else if (cur && !c.text.trim() && cur.unit === unit) cur.text += c.text; // whitespace between hidden runs
    else cur = null;
  }
  return spans.map((s) => ({ ...s, text: clean(s.text) })).filter((s) => s.text.replace(/\s/g, '').length >= 3);
}

function unicodeFindings(text, where, loc) {
  const out = [];
  for (const line of text.split('\n')) for (const f of scanText(line)) out.push({ ...f, where, loc });
  return out;
}

/**
 * Scan a PDF or Word file. Returns { type, findings, stats, warnings }. Findings have the fields of
 * scanText() findings plus `where` ("page 2", "body ¶14", "metadata: Keywords") and `loc` ("p.2", "¶14").
 */
export async function scanDocument(bytes, name = '') {
  const type = documentType(bytes, name);
  if (!type) throw new Error('not a PDF or Word (.docx) file');
  const findings = [];
  const add = (f) => findings.push(f);
  let doc;
  let units; // [{ where, loc, chunks }]
  if (type === 'pdf') {
    doc = await readPdf(bytes);
    const byPage = new Map();
    for (const c of doc.chunks) {
      if (!byPage.has(c.page)) byPage.set(c.page, []);
      byPage.get(c.page).push(c);
    }
    units = [...byPage].map(([p, chunks]) => ({ where: `page ${p}`, loc: `p.${p}`, chunks }));
  } else {
    doc = await readDocx(bytes);
    units = doc.parts.map((p) => ({ where: p.label, loc: p.label === 'body' ? '' : p.label, chunks: p.chunks, docx: true }));
  }

  let chars = 0;
  let hiddenChars = 0;
  for (const u of units) {
    const visible = u.chunks.filter((c) => !c.deleted);
    chars += visible.reduce((n, c) => n + c.text.length, 0);
    hiddenChars += visible.filter((c) => c.hidden).reduce((n, c) => n + c.text.trim().length, 0);
    for (const s of hiddenSpans(visible, (c) => (u.docx ? c.para : c.page))) {
      const instr = looksLikeInstructions(s.text);
      const para = u.docx ? `¶${s.at.para}` : '';
      add({
        kind: 'doc-hidden',
        severity: instr ? 'high' : s.text.length >= 40 ? 'medium' : 'low',
        count: s.text.length,
        payload: short(s.text),
        instructions: instr,
        note: s.reason,
        where: [u.where, para].filter(Boolean).join(' '),
        loc: u.docx ? (u.loc ? `${u.loc} ${para}` : para) : u.loc,
        ctx: { before: '', match: s.text.slice(0, 160), after: s.text.length > 160 ? '…' : '' },
      });
    }
    // tracked deletions are still in the file
    const deleted = clean(u.chunks.filter((c) => c.deleted).map((c) => c.text).join(' '));
    if (deleted && looksLikeInstructions(deleted)) add({ kind: 'doc-hidden', severity: 'medium', count: deleted.length, payload: short(deleted), instructions: true, note: 'deleted text that is still in the file (tracked change)', where: u.where, loc: u.loc || 'body', ctx: { before: '', match: deleted.slice(0, 160), after: '' } });
    // Unicode tricks anywhere in the text, visible or not
    const text = visible.map((c) => c.text).join('');
    findings.push(...unicodeFindings(text, u.where, u.loc || 'body'));
  }

  for (const m of doc.meta || []) {
    const where = `metadata: ${m.field}`;
    if (looksLikeInstructions(m.value)) add({ kind: 'metadata', severity: 'high', count: m.value.length, payload: short(m.value), instructions: true, note: `document property “${m.field}” — not shown on the page`, where, loc: 'meta', ctx: { before: '', match: m.value.slice(0, 160), after: '' } });
    findings.push(...unicodeFindings(m.value, where, 'meta'));
  }
  for (const c of doc.comments || []) {
    if (looksLikeInstructions(c.text)) add({ kind: 'doc-comment', severity: 'medium', count: c.text.length, payload: short(c.text), instructions: true, note: `comment${c.author ? ' by ' + c.author : ''}`, where: 'comments', loc: 'comment', ctx: { before: '', match: c.text.slice(0, 160), after: '' } });
    findings.push(...unicodeFindings(c.text, 'comments', 'comment'));
  }
  for (const a of doc.annotations || []) {
    const instr = looksLikeInstructions(a.text);
    if (instr) add({ kind: 'doc-comment', severity: a.hidden ? 'high' : 'medium', count: a.text.length, payload: short(a.text), instructions: true, note: `${a.hidden ? 'hidden ' : ''}${a.subtype || 'annotation'} on page ${a.page}`, where: `page ${a.page} annotation`, loc: `p.${a.page}`, ctx: { before: '', match: a.text.slice(0, 160), after: '' } });
    findings.push(...unicodeFindings(a.text, `page ${a.page} annotation`, `p.${a.page}`));
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  const stats = { type, chars, hiddenChars, ...(type === 'pdf' ? { pages: doc.pages, ocrPages: doc.ocrPages } : { parts: units.length }) };
  return { type, findings, stats, warnings: doc.warnings || [] };
}
