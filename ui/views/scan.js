// Hidden-text scanner: the current page (all frames), pasted text, or a file (PDF, Word, text). A tab
// showing a PDF is fetched and read as a PDF. Findings are ranked by severity and flagged when the
// hidden text reads like instructions to a model.

import { scanText, scanPage, collectPage, locateInPage, stripHidden, KINDS, SEVERITY_ORDER } from '../../src/core/scan.js';
import { setScanBadge } from '../../src/core/badge.js';
import { liveScanAllowed, siteMatches } from '../../src/core/sites.js';
import { $, h, icon, debounce, seg, empty, clip, row, mini, ago, keepDraft, setValue, busy } from '../lib.js';

let ctx;
let src;
let last = null; // { url, title, findings, chunks, frames, truncated, at, tabId, error, doc, pdfAccess }
let textFindings = [];
let fileResult = null; // { name, size, findings, stats, warnings, error }
const hasTabs = typeof chrome !== 'undefined' && !!chrome.scripting;
const isPdfUrl = (url) => {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
};
const docs = () => import('../../src/core/docs/index.js');

function where(f) {
  if (!f.where) return '';
  const w = { text: 'text', attr: `@${f.attr}`, 'css-hidden': 'hidden element', comment: 'comment', title: '<title>' }[f.where] || f.where;
  return `${w}${f.path ? ' · ' + f.path : ''}${f.frame ? ` · frame ${f.frame}` : ''}`;
}

function sevClass(s) {
  return s === 'info' ? 'low' : s;
}

function findingRow(f, i) {
  const k = KINDS[f.kind] || { label: f.kind };
  return row({
    cls: f.severity === 'critical' ? 'sev-critical' : '',
    head: [
      h('span', { class: 'pill ' + sevClass(f.severity), text: f.severity }),
      h('span', { class: 'label', text: k.label }),
      f.instructions ? h('span', { class: 'chip bad', title: 'The hidden text reads like instructions to an AI model', text: 'instructions' }) : null,
      // in documents the reason matters most: "white text on a white page · page 2"
      h('span', { class: 'src', title: where(f), text: f.loc && f.note ? `${f.note} · ${where(f)}` : where(f) || f.note }),
      h('span', { class: 'spacer' }),
      f.payload ? mini('Copy', () => ctx.copy(f.payload, k.label), { iconName: 'copy', title: 'Copy the hidden text' }) : null,
    ],
    value: f.payload ? f.payload.replace(/\s+/g, ' ').slice(0, 300) : f.ctx ? `${f.ctx.before}${f.ctx.match}${f.ctx.after}`.slice(0, 300) : f.note,
    valueClass: f.payload ? '' : 'dim',
    detail: (box) => {
      if (k.desc) box.append(h('div', { class: 'desc', text: k.desc }));
      if (f.ctx && !['css-hidden', 'comment', 'doc-hidden', 'metadata', 'doc-comment'].includes(f.kind)) box.append(h('div', { class: 'ctx' }, f.ctx.before, h('mark', { text: f.ctx.match }), f.ctx.after));
      const meta = h('dl', { class: 'meta' });
      const add = (dt, dd) => dd !== undefined && dd !== '' && meta.append(h('dt', { text: dt }), h('dd', { text: String(dd) }));
      add('Found', f.note);
      add('Where', f.where ? where(f) : '');
      add('Characters', f.count?.toLocaleString());
      box.append(meta);
      if (f.payload) box.append(h('pre', { class: 'out tall' }, clip(f.payload, 20000)));
      const actions = h('div', { class: 'row-actions' });
      if (f.payload) actions.append(h('button', { class: 'btn primary', onclick: () => ctx.copy(f.payload, k.label) }, 'Copy hidden text'), h('button', { class: 'btn', onclick: () => ctx.switchTo('decode', { text: f.payload }) }, 'Decode'));
      if (f.path && last?.tabId && hasTabs && src.get() === 'page') actions.append(h('button', { class: 'btn', onclick: () => locate(f) }, 'Show on page'));
      box.append(actions);
    },
  });
}

/** With live scan on: a button to take this site out of it (or put it back). */
function liveSiteButton() {
  const s = ctx.settings;
  if (!s.autoScan || !/^https?:/i.test(last?.url || '')) return null;
  let host;
  try {
    host = new URL(last.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const mode = s.liveMode === 'only' ? 'only' : 'all';
  const sites = s.liveSites || [];
  const on = liveScanAllowed(last.url, mode, sites);
  const drop = sites.filter((p) => !siteMatches(last.url, [p]));
  const next = (mode === 'all') === on ? [...sites, host] : drop;
  return mini(
    on ? 'Don’t live-scan this site' : 'Live-scan this site',
    async () => {
      await ctx.save({ liveSites: next });
      ctx.toast(on ? `Live scan skips ${host} now` : `Live scan covers ${host} again`);
      render();
    },
    { title: on ? `Add ${host} to the live-scan exceptions (Settings → Live scan)` : `Live-scan ${host} again` },
  );
}

/** Copy the pasted text without hidden characters and with look-alike letters fixed. */
function copyCleaned() {
  const r = stripHidden($('scText').value);
  if (!r.removed && !r.replaced) return ctx.toast('Nothing hidden to remove');
  ctx.copy(r.text, `Cleaned: ${r.removed} hidden removed${r.replaced ? `, ${r.replaced} look-alike${r.replaced === 1 ? '' : 's'} fixed` : ''}`);
}

async function locate(f) {
  try {
    const target = { tabId: last.tabId, ...(f.frame ? { frameIds: [f.frame] } : {}) };
    const [r] = await chrome.scripting.executeScript({ target, func: locateInPage, args: [f.path] });
    if (!r?.result) ctx.toast('Element not found — the page changed', true);
    else if (ctx.FULL) chrome.tabs.update(last.tabId, { active: true });
  } catch (e) {
    ctx.toast('Cannot reach the page: ' + (e.message || e), true);
  }
}

function filtered(findings) {
  const min = SEVERITY_ORDER[$('scSev').value] ?? 4;
  return findings.filter((f) => SEVERITY_ORDER[f.severity] <= min && (!$('scInstr').checked || f.instructions));
}

/** "PDF, 3 pages, 412 of 2,180 characters hidden · OCR on page 1" */
function docSummary(stats) {
  if (!stats) return '';
  const parts = [stats.type === 'pdf' ? `PDF, ${stats.pages} page${stats.pages === 1 ? '' : 's'}` : 'Word document'];
  parts.push(`${stats.hiddenChars.toLocaleString()} of ${stats.chars.toLocaleString()} characters hidden`);
  if (stats.ocrPages?.length) parts.push(`invisible OCR text layer on page${stats.ocrPages.length === 1 ? '' : 's'} ${stats.ocrPages.join(', ')} (normal for scans)`);
  return parts.join(' · ');
}

function current() {
  const s = src.get();
  return s === 'text' ? textFindings : s === 'file' ? fileResult?.findings || [] : last?.findings || [];
}

function render() {
  const list = $('scList');
  list.textContent = '';
  const banner = $('scBanner');
  banner.hidden = true;
  const mode = src.get();
  const isText = mode === 'text';
  const isFile = mode === 'file';
  $('scTextWrap').hidden = !isText;
  $('scFileWrap').hidden = !isFile;
  $('scClean').hidden = !isText || !textFindings.length;
  $('scGo').hidden = isText || isFile || (ctx.FULL && !(last?.tabId && hasTabs));
  $('scGo').classList.toggle('popup-only', !ctx.FULL || !last?.tabId);

  const all = current();
  const shown = filtered(all);
  $('scCount').textContent = all.length ? `${shown.length} of ${all.length}` : '';
  const setBanner = (cls, ...nodes) => {
    banner.hidden = false;
    banner.className = 'banner ' + cls;
    banner.textContent = '';
    banner.append(...nodes.filter(Boolean));
  };

  if (isFile) {
    if (!fileResult) {
      list.append(empty('⌕', 'Check a file for hidden text', 'PDFs: white, background-coloured, transparent, tiny or invisible text, text off the page, clipped, covered by a shape or on a hidden layer. Word: hidden-formatted, white, transparent and tiny runs, tracked deletions, comments. Both: metadata that reads like instructions and every invisible-character check. Text files are scanned line by line.'));
      return;
    }
    if (fileResult.loading) {
      setBanner('', h('span', { text: `Reading ${fileResult.name}…` }));
      return;
    }
    if (fileResult.error) setBanner('bad', h('span', { text: `${fileResult.name}: ${fileResult.error}` }));
    else {
      setBanner(all.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'bad' : all.length ? '' : 'ok', h('span', { title: fileResult.name, text: `${fileResult.name} — ${fileResult.stats ? docSummary(fileResult.stats) : `${fileResult.lines.toLocaleString()} lines`}` }));
      for (const w of fileResult.warnings || []) list.append(h('div', { class: 'hint', text: w }));
    }
    if (fileResult.error) return;
  } else if (!isText) {
    if (last?.error) {
      setBanner('bad', h('span', { text: `Could not scan ${last.url || 'this page'}: ${last.error}` }), h('span', { class: 'spacer' }), last.pdfAccess ? h('button', { class: 'mini primary', onclick: () => scanPdfTab(last.pdfAccess, true) }, `Allow ${new URL(last.pdfAccess.url).host || 'file'} and scan`) : null);
    } else if (last) {
      setBanner(
        all.some((f) => f.severity === 'critical') ? 'bad' : all.length ? '' : 'ok',
        h('span', { title: last.url, text: `${last.title || last.url} — ${last.doc ? docSummary(last.doc) : `${last.chunks.toLocaleString()} suspicious chunk${last.chunks === 1 ? '' : 's'} in ${last.frames} frame${last.frames === 1 ? '' : 's'}${last.truncated ? ' (truncated)' : ''}`}` }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small', text: ago(last.at) }),
        last.doc ? null : liveSiteButton(),
      );
    }
  }

  if (!isText && !isFile && !last) {
    list.append(
      empty(
        '⌕',
        'Scan a page for hidden text',
        'Finds invisible Unicode tags, emoji steganography, zero-width and bidi characters, homoglyphs, CSS-hidden text and HTML comments — what an AI agent reads but you don’t see.',
        ctx.FULL ? h('div', { class: 'hint', text: 'Right-click a page → injex → Scan page for hidden text, or use the popup.' }) : h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: scanPageNow }, 'Scan this page')),
      ),
    );
    return;
  }
  if (isText && !$('scText').value) {
    list.append(empty('⌕', 'Paste text to check', 'An e-mail, a document, a model answer or a prompt — hidden characters are listed with what they decode to.'));
    return;
  }
  if (!all.length) {
    if (!last?.error || isText || isFile) list.append(empty('✓', 'Nothing hidden found', isText ? 'No invisible or deceptive characters in this text.' : isFile ? 'No hidden text, instruction-like metadata or comments, and no invisible characters in this file.' : last?.doc ? 'No hidden text in this PDF.' : 'No hidden text on this page (in the frames the extension can read).'));
    return;
  }
  if (!shown.length) {
    list.append(empty('∅', 'All findings filtered out', 'Lower the severity filter or turn off “Instructions”.'));
    return;
  }
  shown.forEach((f, i) => list.append(findingRow(f, i)));
}

function updateCount() {
  const all = current();
  const crit = all.some((f) => f.severity === 'critical');
  ctx.setCount('scan', all.length || null, crit ? 'crit' : all.some((f) => f.severity === 'high') ? 'hot' : '');
}

/** A tab showing a PDF: fetch the file and read it (the browser's PDF viewer can't be scripted). */
async function scanPdfTab(tab, askAccess = false) {
  const url = tab.url;
  try {
    if (askAccess) {
      // first await: still inside the click
      const origin = /^file:/.test(url) ? 'file:///*' : new URL(url).origin + '/*';
      if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error('access was not granted');
    }
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { scanDocument } = await docs();
    const d = await scanDocument(bytes, url);
    last = { url, title: tab.title || url.split('/').pop(), findings: d.findings, doc: d.stats, warnings: d.warnings, chunks: 0, frames: 0, at: Date.now(), tabId: tab.id };
    chrome.storage.session?.set({ lastScan: last, ['scan:' + tab.id]: last });
    setScanBadge(tab.id, last.findings);
  } catch (e) {
    const denied = /Failed to fetch|NetworkError|not granted|CORS/i.test(String(e.message || e));
    last = {
      url,
      error: /^file:/.test(url) && denied ? 'local PDFs need “Allow access to file URLs” in the extension’s details — or open the File tab and drop the PDF there' : denied && !askAccess ? 'the extension needs permission to download this PDF' : String(e.message || e),
      pdfAccess: denied && !askAccess && !/^file:/.test(url) ? { url, title: tab.title, id: tab.id } : null,
      findings: [],
      chunks: 0,
      frames: 0,
      at: Date.now(),
    };
  }
  render();
  updateCount();
}

/** Scan a dropped / chosen file: PDF and Word as documents, anything else line by line as text. */
async function scanFile(file) {
  if (!file) return;
  src.set('file', false);
  fileResult = { name: file.name, size: file.size, findings: [], loading: true };
  render();
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('larger than 100 MB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { scanDocument, documentType } = await docs();
    if (documentType(bytes, file.name)) {
      const d = await scanDocument(bytes, file.name);
      fileResult = { name: file.name, size: file.size, findings: d.findings, stats: d.stats, warnings: d.warnings };
    } else {
      if (bytes.subarray(0, 8000).includes(0)) throw new Error('a binary file — PDF, Word (.docx) and text files can be checked');
      const text = new TextDecoder().decode(bytes);
      const { scanFileText } = await import('../../src/core/filescan.js');
      const findings = scanFileText(text, { file: file.name }).map((f) => ({ ...f, where: `line ${f.line}, column ${f.column}` }));
      findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
      fileResult = { name: file.name, size: file.size, findings, lines: text.split('\n').length };
    }
  } catch (e) {
    fileResult = { name: file.name, size: file.size, findings: [], error: e.message || String(e) };
  }
  render();
  updateCount();
}

async function scanPageNow() {
  src.set('page', false);
  const btn = $('scGo');
  busy(btn, true);
  try {
    if (!hasTabs) {
      // outside the extension: scan this document (useful for development)
      const collected = collectPage();
      last = { url: collected.url, title: collected.title, findings: scanPage(collected, { stego: ctx.settings.stego }), chunks: collected.chunks.length, frames: 1, truncated: collected.truncated, at: Date.now() };
    } else {
      const tabId = ctx.FULL && last?.tabId ? last.tabId : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      const tab = await chrome.tabs.get(tabId);
      if (isPdfUrl(tab.url)) {
        busy(btn, false);
        return scanPdfTab(tab);
      }
      let results;
      try {
        results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: collectPage });
      } catch {
        results = await chrome.scripting.executeScript({ target: { tabId }, func: collectPage });
      }
      const chunks = results.flatMap((r) => (r.result?.chunks || []).map((c) => ({ ...c, frame: r.frameId })));
      last = {
        url: tab.url,
        title: tab.title,
        findings: scanPage({ chunks }, { stego: ctx.settings.stego }),
        chunks: chunks.length,
        frames: results.length,
        truncated: results.some((r) => r.result?.truncated),
        at: Date.now(),
        tabId,
      };
      chrome.storage.session?.set({ lastScan: last, ['scan:' + tabId]: last });
      setScanBadge(tabId, last.findings);
    }
  } catch (e) {
    const msg = String(e.message || e);
    last = { error: /cannot be scripted|chrome:\/\/|Cannot access|extensions gallery/i.test(msg) ? 'browser pages and the Web Store cannot be scanned' : msg, findings: [], chunks: 0, frames: 0, at: Date.now() };
  } finally {
    busy(btn, false);
  }
  render();
  updateCount();
}

function scanTextNow() {
  textFindings = scanText($('scText').value, { stego: ctx.settings.stego }).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  render();
  updateCount();
}

function report() {
  const mode = src.get();
  const all = filtered(current());
  if (!all.length) return ctx.toast('No findings to copy', true);
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300);
  const lines = ['# injex hidden-text scan', ''];
  if (mode === 'page' && last) lines.push(`- Page: ${last.title ? `${last.title} — ` : ''}${last.url}`, `- Scanned: ${new Date(last.at).toISOString()}`, '');
  if (mode === 'file' && fileResult) lines.push(`- File: ${fileResult.name}${fileResult.stats ? ` (${docSummary(fileResult.stats)})` : ''}`, `- Scanned: ${new Date().toISOString()}`, '');
  lines.push('| Severity | Kind | Where | Hidden text |', '|---|---|---|---|');
  for (const f of all) lines.push(`| ${f.severity}${f.instructions ? ' ⚠ instructions' : ''} | ${KINDS[f.kind]?.label || f.kind} | ${esc(where(f) || f.note)} | ${esc(f.payload || f.ctx?.match || f.note)} |`);
  ctx.copy(lines.join('\n'), 'Scan report');
}

export async function init(c) {
  ctx = c;
  src = seg($('scSrc'), () => {
    render();
    updateCount();
    if (src.get() === 'text') $('scText').focus();
  });
  const drop = $('scDrop');
  drop.addEventListener('click', () => $('scFile').click());
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && $('scFile').click());
  $('scFile').addEventListener('change', (e) => {
    scanFile(e.target.files[0]);
    e.target.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    scanFile(e.dataTransfer.files[0]);
  });
  $('scGo').addEventListener('click', scanPageNow);
  $('scSev').addEventListener('change', render);
  $('scInstr').addEventListener('change', render);
  $('scInstr').closest('label').after(h('button', { class: 'btn', id: 'scClean', hidden: true, title: 'Copy the text without hidden characters, with look-alike letters fixed', onclick: copyCleaned }, icon('spark'), 'Copy cleaned'));
  $('scCopy').addEventListener('click', report);
  $('scText').addEventListener('input', debounce(scanTextNow, 150));
  await keepDraft($('scText'), 'scan');
  if ($('scText').value) textFindings = scanText($('scText').value, { stego: ctx.settings.stego });
  if (ctx.FULL && typeof chrome !== 'undefined' && chrome.storage?.session) {
    const { lastScan } = await chrome.storage.session.get('lastScan');
    if (lastScan) last = lastScan;
  } else if (hasTabs && chrome.storage?.session) {
    // popup: show what the live scan (or an earlier scan) found on this tab, if the page hasn't changed
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const key = 'scan:' + tab?.id;
      const saved = tab && (await chrome.storage.session.get(key))[key];
      if (saved && saved.url === tab.url) last = saved;
    } catch {
      /* no tab */
    }
  }
  render();
  updateCount();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    src.set('text', false);
    setValue($('scText'), payload.text);
    scanTextNow();
  } else if (payload?.run) scanPageNow();
}

export function onSettings(changes) {
  if (changes.stego) {
    if ($('scText').value) scanTextNow();
  }
}
