// Findings for e-mail (.eml / .mbox) and calendar (.ics) files, after mail.js has decoded them:
//   every part goes through the file scanner (hidden characters, hidden HTML, comments, exfiltration
//   shapes), headers and calendar properties through the instruction check, text that only one of the
//   text/plain and text/html alternatives carries is reported (people see the HTML, many AI pipelines
//   read the plain text), and attachments are opened as documents.

import { scanText, SEVERITY_ORDER } from '../scan.js';
import { instructionSignals } from '../instructions.js';
import { scanFileText } from '../filescan.js';
import { parseMime, splitMbox, decodeHeader, parseIcs, ICS_TEXT } from './mail.js';


const short = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '…' : s);
const stripTags = (s) => String(s).replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const sentences = (s) =>
  String(s)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12);
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function fromFile(findings, where, loc) {
  return findings.map(({ line, column, endColumn, ...f }) => ({ ...f, where, loc: `${loc} l.${line}` }));
}

function textFindings(text, where, loc, { kindIfInstructions = 'message-text', severity = 'medium' } = {}) {
  const out = [];
  const sig = instructionSignals(text);
  if (sig.instructions) out.push({ kind: kindIfInstructions, severity, count: text.length, payload: short(text.trim()), instructions: true, signals: sig.signals, note: `${where} reads like instructions to an AI assistant`, where, loc, ctx: { before: '', match: text.trim().slice(0, 160), after: text.length > 160 ? '…' : '' } });
  for (const line of String(text).split('\n')) for (const f of scanText(line)) out.push({ ...f, where, loc });
  return out;
}

/** Scan an e-mail or an mbox. opts: { mbox, name, scanDocument (for attachments), depth } */
export async function scanMail(bytes, { mbox = false, scanDocument, depth = 0 } = {}) {
  const raws = mbox ? splitMbox(bytes) : [bytes];
  const findings = [];
  const warnings = [];
  let parts = 0;
  let attachments = 0;
  for (const [i, raw] of raws.entries()) {
    const label = mbox ? `message ${i + 1}` : 'message';
    let msg;
    try {
      msg = parseMime(raw);
    } catch (e) {
      warnings.push(`${label}: ${e.message}`);
      continue;
    }
    for (const h of ['subject', 'from', 'to', 'reply-to', 'cc', 'x-mailer', 'thread-topic']) {
      for (const v of msg.headers[h] || []) {
        const value = decodeHeader(v);
        findings.push(...textFindings(value, `${label} ${h} header`, `${label} ${h}`, { kindIfInstructions: 'metadata', severity: 'high' }));
      }
    }
    let plain = '';
    let html = '';
    for (const p of msg.parts) {
      if (p.nested) continue;
      parts++;
      const isAttachment = p.disposition === 'attachment' || (p.name && !/^text\/(plain|html)$/.test(p.type));
      const plabel = `${label} part ${p.path} (${p.name || p.type})`;
      if (isAttachment) {
        attachments++;
        if (scanDocument && depth < 3 && p.bytes.length) {
          try {
            const d = await scanDocument(p.bytes, p.name || '', { depth: depth + 1 });
            for (const f of d.findings) findings.push({ ...f, where: `${label} attachment ${p.name || p.path}: ${f.where || ''}`.trim(), loc: `${p.name || 'attachment'} ${f.loc || ''}`.trim() });
            continue;
          } catch {
            /* not a document: scan as text below when it is text */
          }
        }
        if (p.text !== undefined) findings.push(...fromFile(scanFileText(p.text, { file: p.name || 'attachment.txt' }), `${label} attachment ${p.name || p.path}`, p.name || 'attachment'));
        continue;
      }
      if (p.type === 'text/html') {
        html += p.text || '';
        findings.push(...fromFile(scanFileText(p.text || '', { file: 'body.html' }), `${label} HTML body`, 'html'));
      } else if (p.type === 'text/calendar' || p.type === 'application/ics') {
        const c = scanCalendar(p.text || '');
        for (const f of c.findings) findings.push({ ...f, where: `${label} invitation: ${f.where}`, loc: `ics ${f.loc}` });
      } else if (p.type === 'text/plain' || p.type.startsWith('text/')) {
        plain += p.text || '';
        findings.push(...fromFile(scanFileText(p.text || '', { file: 'body.txt' }), `${label} text body`, 'text'));
      }
    }
    // visible text that addresses the assistant
    const visible = plain || stripTags(html);
    const sig = instructionSignals(visible);
    if (sig.instructions) findings.push({ kind: 'message-text', severity: 'medium', count: visible.length, payload: short(sentences(visible).find((s) => instructionSignals(s).instructions) || visible.trim()), instructions: true, signals: sig.signals, note: 'the message reads like instructions to an AI assistant', where: `${label} body`, loc: label, ctx: { before: '', match: visible.trim().slice(0, 160), after: '' } });
    // what only one alternative says
    if (plain.trim() && html.trim()) {
      const inHtml = new Set(sentences(stripTags(html)).map(norm));
      const inPlain = new Set(sentences(plain).map(norm));
      const onlyPlain = sentences(plain).filter((s) => !inHtml.has(norm(s)) && ![...inHtml].some((h) => h.includes(norm(s))));
      const onlyHtml = sentences(stripTags(html)).filter((s) => !inPlain.has(norm(s)) && ![...inPlain].some((h) => h.includes(norm(s))));
      const report = (list, note, loc) => {
        const text = list.join(' ');
        const s = instructionSignals(text);
        if (text.length >= 12 && s.instructions) findings.push({ kind: 'doc-hidden', severity: 'high', count: text.length, payload: short(text), instructions: true, signals: s.signals, note, where: `${label} ${loc}`, loc: `${label} ${loc}`, ctx: { before: '', match: text.slice(0, 160), after: '' } });
      };
      report(onlyPlain, 'only in the text/plain part — mail clients show the HTML part, AI pipelines often read the plain text', 'text/plain only');
      report(onlyHtml, 'only in the text/html part — readers of the plain-text part never see it', 'text/html only');
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  return { type: mbox ? 'mbox' : 'eml', findings, stats: { type: mbox ? 'mbox' : 'eml', messages: raws.length, parts, attachments }, warnings };
}

/** Scan a calendar file (.ics) or an invitation part. */
export function scanCalendar(text) {
  const findings = [];
  const comps = parseIcs(text);
  let n = 0;
  for (const c of comps) {
    if (!['VEVENT', 'VTODO', 'VJOURNAL', 'VALARM', 'VCALENDAR'].includes(c.type)) continue;
    if (c.type === 'VEVENT') n++;
    for (const p of c.props) {
      const where = `${c.type === 'VEVENT' ? `event ${n}` : c.type.toLowerCase()} ${p.name}`;
      const loc = `l.${p.line}`;
      if (p.name === 'ATTENDEE' || p.name === 'ORGANIZER') {
        if (p.params.CN) findings.push(...textFindings(p.params.CN, `${where} name`, loc, { kindIfInstructions: 'message-text', severity: 'high' }));
        continue;
      }
      if (!ICS_TEXT.includes(p.name) && !/^X-/.test(p.name)) continue;
      if (p.name === 'X-ALT-DESC' || /html/i.test(p.params.FMTTYPE || '')) {
        findings.push(...fromFile(scanFileText(p.value, { file: 'description.html' }), where, `${loc}+`));
        continue;
      }
      // a title or description that addresses the assistant is the "Invitation Is All You Need" vector
      findings.push(...textFindings(p.value, where, loc, { severity: p.name === 'SUMMARY' || p.name === 'LOCATION' ? 'high' : 'medium' }));
      findings.push(...fromFile(scanFileText(p.value, { file: 'description.txt' }).filter((f) => f.kind === 'exfil'), where, loc));
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { type: 'ics', findings, stats: { type: 'ics', events: n }, warnings: comps.length ? [] : ['no calendar components found'] };
}
