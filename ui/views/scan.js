// Hidden-text scanner: the current page (all frames) or pasted text. Findings are ranked by severity and
// flagged when the hidden text reads like instructions to a model.

import { scanText, scanPage, collectPage, locateInPage, stripHidden, KINDS, SEVERITY_ORDER } from '../../src/core/scan.js';
import { setScanBadge } from '../../src/core/badge.js';
import { liveScanAllowed, siteMatches } from '../../src/core/sites.js';
import { $, h, icon, debounce, seg, empty, clip, row, mini, ago, keepDraft, setValue, busy } from '../lib.js';

let ctx;
let src;
let last = null; // { url, title, findings, chunks, frames, truncated, at, tabId, error }
let textFindings = [];
const hasTabs = typeof chrome !== 'undefined' && !!chrome.scripting;

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
      h('span', { class: 'src', title: where(f), text: where(f) || f.note }),
      h('span', { class: 'spacer' }),
      f.payload ? mini('Copy', () => ctx.copy(f.payload, k.label), { iconName: 'copy', title: 'Copy the hidden text' }) : null,
    ],
    value: f.payload ? f.payload.replace(/\s+/g, ' ').slice(0, 300) : f.ctx ? `${f.ctx.before}${f.ctx.match}${f.ctx.after}`.slice(0, 300) : f.note,
    valueClass: f.payload ? '' : 'dim',
    detail: (box) => {
      if (k.desc) box.append(h('div', { class: 'desc', text: k.desc }));
      if (f.ctx && f.kind !== 'css-hidden' && f.kind !== 'comment') box.append(h('div', { class: 'ctx' }, f.ctx.before, h('mark', { text: f.ctx.match }), f.ctx.after));
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

function render() {
  const list = $('scList');
  list.textContent = '';
  const banner = $('scBanner');
  banner.hidden = true;
  const isText = src.get() === 'text';
  $('scTextWrap').hidden = !isText;
  $('scClean').hidden = !isText || !textFindings.length;
  $('scGo').hidden = isText || (ctx.FULL && !(last?.tabId && hasTabs));
  $('scGo').classList.toggle('popup-only', !ctx.FULL || !last?.tabId);

  const all = isText ? textFindings : last?.findings || [];
  const shown = filtered(all);
  $('scCount').textContent = all.length ? `${shown.length} of ${all.length}` : '';

  if (!isText) {
    if (last?.error) {
      banner.hidden = false;
      banner.className = 'banner bad';
      banner.textContent = '';
      banner.append(h('span', { text: `Could not scan ${last.url || 'this page'}: ${last.error}` }));
    } else if (last) {
      banner.hidden = false;
      banner.className = 'banner ' + (all.some((f) => f.severity === 'critical') ? 'bad' : all.length ? '' : 'ok');
      banner.textContent = '';
      banner.append(
        h('span', { title: last.url, text: `${last.title || last.url} — ${last.chunks.toLocaleString()} suspicious chunk${last.chunks === 1 ? '' : 's'} in ${last.frames} frame${last.frames === 1 ? '' : 's'}${last.truncated ? ' (truncated)' : ''}` }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small', text: ago(last.at) }),
        liveSiteButton(),
      );
    }
  }

  if (!isText && !last) {
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
    if (!last?.error || isText) list.append(empty('✓', 'Nothing hidden found', isText ? 'No invisible or deceptive characters in this text.' : 'No hidden text on this page (in the frames the extension can read).'));
    return;
  }
  if (!shown.length) {
    list.append(empty('∅', 'All findings filtered out', 'Lower the severity filter or turn off “Instructions”.'));
    return;
  }
  shown.forEach((f, i) => list.append(findingRow(f, i)));
}

function updateCount() {
  const all = src.get() === 'text' ? textFindings : last?.findings || [];
  const crit = all.some((f) => f.severity === 'critical');
  ctx.setCount('scan', all.length || null, crit ? 'crit' : all.some((f) => f.severity === 'high') ? 'hot' : '');
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
  const isText = src.get() === 'text';
  const all = filtered(isText ? textFindings : last?.findings || []);
  if (!all.length) return ctx.toast('No findings to copy', true);
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300);
  const lines = ['# injex hidden-text scan', ''];
  if (!isText && last) lines.push(`- Page: ${last.title ? `${last.title} — ` : ''}${last.url}`, `- Scanned: ${new Date(last.at).toISOString()}`, '');
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
