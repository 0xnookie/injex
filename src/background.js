// Service worker: right-click menu and keyboard shortcuts that work on the page you're on.
//   Encode selection → <transform>   replaces the selection in inputs / editors, otherwise shows + copies it
//   Decode selection                 universal decoder, unwraps nested layers and hidden text
//   Remove hidden characters         strips tags / selector runs / zero-width / bidi, fixes look-alikes
//   Hide selection in emoji          emoji steganography with the carrier from the popup
//   Scan page for hidden text        opens the dashboard with what the scanner found
//   Inspect characters               opens the Inspect tab with the selection
// plus two opt-in features that need host permissions:
//   live scan    pages are scanned as they load and again when new text settles; the toolbar badge
//                counts critical / high findings (all sites, minus or only the ones listed in Settings)
//   paste guard  a content script on AI chat sites holds pastes that hide text and asks what to do
// Everything runs locally; without them, activeTab (granted by the menu click / shortcut) is the only
// page access.

import { transforms, encode, setOptionPrefs, setCustomAlphabets, setRecipes } from './core/registry.js';
import { peel, universalDecode, englishness } from './core/decoder.js';
import { encodeEmojiBits, encodeTags } from './core/stego.js';
import { collectPage, scanPage, stripHidden, checkPaste } from './core/scan.js';
import { setScanBadge } from './core/badge.js';
import { scanDocument } from './core/docs/index.js';
import { liveScanAllowed, matchPatterns } from './core/sites.js';
import { captureSelection, applyResult, watchPage } from './page.js';
import * as store from './core/store.js';

async function loadPrefs() {
  const s = await store.get(['optionPrefs', 'customAlphabets', 'recipes', 'stego', 'menuTransforms', 'stegoCarrier']);
  setOptionPrefs(s.optionPrefs);
  setRecipes(s.recipes);
  setCustomAlphabets(s.customAlphabets);
  return s;
}

// ── menu ──

async function buildMenu() {
  const s = await loadPrefs();
  await chrome.contextMenus.removeAll();
  const sel = ['selection'];
  chrome.contextMenus.create({ id: 'root', title: 'injex', contexts: ['selection', 'page', 'editable'] });
  chrome.contextMenus.create({ id: 'decode', parentId: 'root', title: 'Decode selection', contexts: sel });
  chrome.contextMenus.create({ id: 'encode', parentId: 'root', title: 'Encode selection', contexts: sel });
  for (const key of s.menuTransforms || []) {
    const t = transforms[key];
    if (t) chrome.contextMenus.create({ id: 'enc:' + key, parentId: 'encode', title: t.name, contexts: sel });
  }
  chrome.contextMenus.create({ id: 'enc-sep', parentId: 'encode', type: 'separator', contexts: sel });
  chrome.contextMenus.create({ id: 'enc:__more', parentId: 'encode', title: 'Choose transforms…', contexts: sel });
  chrome.contextMenus.create({ id: 'clean', parentId: 'root', title: 'Remove hidden characters', contexts: sel });
  chrome.contextMenus.create({ id: 'inspect', parentId: 'root', title: 'Inspect characters', contexts: sel });
  chrome.contextMenus.create({ id: 'sep0', parentId: 'root', type: 'separator', contexts: sel });
  chrome.contextMenus.create({ id: 'stego', parentId: 'root', title: 'Hide selection in emoji', contexts: sel });
  chrome.contextMenus.create({ id: 'tags', parentId: 'root', title: 'Make selection invisible (Unicode tags)', contexts: sel });
  chrome.contextMenus.create({ id: 'sep1', parentId: 'root', type: 'separator', contexts: ['selection', 'page', 'editable'] });
  chrome.contextMenus.create({ id: 'scan', parentId: 'root', title: 'Scan page for hidden text', contexts: ['selection', 'page', 'editable'] });
  chrome.contextMenus.create({ id: 'open', parentId: 'root', title: 'Open dashboard', contexts: ['selection', 'page', 'editable'] });
}

chrome.runtime.onInstalled.addListener(() => {
  buildMenu();
  syncPasteGuard();
});
chrome.runtime.onStartup.addListener(() => {
  buildMenu();
  syncPasteGuard();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.menuTransforms || changes.customAlphabets || changes.recipes) buildMenu();
  if (changes.pasteGuard || changes.pasteSites) syncPasteGuard({ injectOpenTabs: !!changes.pasteGuard?.newValue || !!changes.pasteSites });
});
chrome.permissions.onAdded?.addListener(() => syncPasteGuard());
chrome.permissions.onRemoved?.addListener(() => syncPasteGuard());

// ── page helpers ──

async function exec(tabId, frameId, func, args = []) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId };
  const [r] = await chrome.scripting.executeScript({ target, func, args });
  return r?.result;
}

/** The selection in the clicked frame (or, for the shortcut, the first frame that has one). */
async function grabSelection(tabId, frameId, fallback = '') {
  try {
    if (frameId != null) return { frameId, sel: (await exec(tabId, frameId, captureSelection)) || (fallback ? { text: fallback, editable: false } : null) };
    let results = [];
    try {
      results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: captureSelection });
    } catch {
      results = await chrome.scripting.executeScript({ target: { tabId }, func: captureSelection });
    }
    const hit = results.find((r) => r.result?.text);
    return hit ? { frameId: hit.frameId, sel: hit.result } : { frameId: 0, sel: null };
  } catch {
    return { frameId: frameId ?? 0, sel: fallback ? { text: fallback, editable: false } : null };
  }
}

async function show(tabId, frameId, msg) {
  try {
    return await exec(tabId, frameId, applyResult, [msg]);
  } catch (e) {
    console.warn('injex: cannot show result on this page', e);
  }
}

// ── actions ──

async function doEncode(tab, frameId, key, selectionText) {
  await loadPrefs();
  const { frameId: fid, sel } = await grabSelection(tab.id, frameId, selectionText);
  if (!sel?.text) return show(tab.id, fid, { title: 'Nothing selected', result: 'Select some text first.', error: true });
  const t = transforms[key];
  const r = encode(t, sel.text);
  if (!r.ok) return show(tab.id, fid, { title: t.name + ' failed', result: r.error, error: true });
  await store.pushHistory(r.text, t.name);
  return show(tab.id, fid, { title: t.name, sub: `${[...sel.text].length} → ${[...r.text].length} chars`, result: r.text, replace: sel.editable });
}

async function doDecode(tab, frameId, selectionText) {
  const s = await loadPrefs();
  const { frameId: fid, sel } = await grabSelection(tab.id, frameId, selectionText);
  if (!sel?.text) return show(tab.id, fid, { title: 'Nothing selected', result: 'Select some text first.', error: true });
  const layers = peel(sel.text, { stego: s.stego });
  let result;
  let sub;
  if (layers.length) {
    result = layers[layers.length - 1].text;
    sub = layers.map((l) => l.method).join(' → ');
  } else {
    const r = universalDecode(sel.text, { stego: s.stego });
    const readable = englishness(sel.text);
    if (!r) return show(tab.id, fid, { title: 'Nothing to decode', result: 'No decoder recognised the selection.', error: true });
    if (readable >= 0.3 && r.english <= readable + 0.05) return show(tab.id, fid, { title: 'Already readable', result: 'No decoder makes this read better — it looks like plain text. Open the Decode tab for every reading.', error: true });
    result = r.text;
    sub = r.method + (r.score < 80 ? ' (weak guess)' : '') + (r.alternatives.length ? ` · ${r.alternatives.length} other readings in the popup` : '');
  }
  await store.pushHistory(result, 'Decoded');
  return show(tab.id, fid, { title: 'Decoded', sub, result, replace: false });
}

async function doStego(tab, frameId, selectionText, kind) {
  const s = await loadPrefs();
  const { frameId: fid, sel } = await grabSelection(tab.id, frameId, selectionText);
  if (!sel?.text) return show(tab.id, fid, { title: 'Nothing selected', result: 'Select some text first.', error: true });
  const carrier = s.stegoCarrier || '🐍';
  const out = kind === 'tags' ? encodeTags(sel.text) : encodeEmojiBits(carrier, sel.text, s.stego);
  await store.pushHistory(out, kind === 'tags' ? 'Unicode tags' : 'Emoji steganography');
  return show(tab.id, fid, {
    title: kind === 'tags' ? 'Invisible text (Unicode tags)' : `Hidden in ${carrier}`,
    sub: `${[...sel.text].length} chars hidden in ${[...out].length} code points`,
    result: out,
    replace: sel.editable,
  });
}

async function doClean(tab, frameId, selectionText) {
  const { frameId: fid, sel } = await grabSelection(tab.id, frameId, selectionText);
  if (!sel?.text) return show(tab.id, fid, { title: 'Nothing selected', result: 'Select some text first.', error: true });
  const r = stripHidden(sel.text);
  if (!r.removed && !r.replaced) return show(tab.id, fid, { title: 'Nothing hidden', result: 'The selection has no hidden characters or look-alike letters.', error: true });
  await store.pushHistory(r.text, 'Cleaned text');
  const sub = `${r.removed} hidden character${r.removed === 1 ? '' : 's'} removed` + (r.replaced ? `, ${r.replaced} look-alike${r.replaced === 1 ? '' : 's'} fixed` : '');
  return show(tab.id, fid, { title: 'Cleaned', sub, result: r.text, replace: sel.editable });
}

const isPdfUrl = (url) => {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
};

/** A tab showing a PDF: download it (activeTab or the live-scan permission allows that) and read it. */
async function runPdfScan(tab) {
  const res = await fetch(tab.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await scanDocument(new Uint8Array(await res.arrayBuffer()), tab.url);
  const scan = { url: tab.url, title: tab.title || tab.url.split('/').pop(), findings: d.findings, doc: d.stats, warnings: d.warnings, chunks: 0, frames: 0, at: Date.now(), tabId: tab.id };
  await chrome.storage.session.set({ ['scan:' + tab.id]: scan });
  await setScanBadge(tab.id, d.findings);
  return scan;
}

/** Collect the tab (all frames it allows) and scan it. Throws when the page can't be scripted. */
async function runScan(tab) {
  if (isPdfUrl(tab.url)) return runPdfScan(tab);
  const s = await loadPrefs();
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectPage });
  } catch {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPage });
  }
  const top = results.find((r) => r.frameId === 0)?.result || results[0]?.result || {};
  const chunks = results.flatMap((r) => (r.result?.chunks || []).map((c) => ({ ...c, frame: r.frameId })));
  const findings = scanPage({ chunks }, { stego: s.stego });
  const scan = { url: top.url || tab.url, title: top.title || tab.title, findings, chunks: chunks.length, frames: results.length, truncated: results.some((r) => r.result?.truncated), at: Date.now(), tabId: tab.id };
  await chrome.storage.session.set({ ['scan:' + tab.id]: scan });
  await setScanBadge(tab.id, findings);
  return scan;
}

async function doInspect(tab, frameId, selectionText) {
  const { sel } = await grabSelection(tab.id, frameId, selectionText);
  const text = sel?.text || selectionText || '';
  await chrome.storage.session.set({ inspectText: text });
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html?full=1#inspect'), index: tab.index + 1 });
}

async function doScan(tab) {
  let scan;
  try {
    scan = await runScan(tab);
  } catch (e) {
    scan = { error: e.message || String(e), url: tab.url, at: Date.now() };
  }
  await chrome.storage.session.set({ lastScan: scan });
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html?full=1#scan'), index: tab.index + 1 });
}

// ── live scan (opt-in in Settings; needs the optional permission to read all sites) ──

const ALL_SITES = { origins: ['<all_urls>'] };

/** Is live scan on, allowed for `url`, and do we have the permission? */
async function liveScanFor(url) {
  const s = await store.get(['autoScan', 'liveMode', 'liveSites']);
  return !!s.autoScan && liveScanAllowed(url, s.liveMode, s.liveSites) && (await chrome.permissions.contains(ALL_SITES));
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https?:/i.test(tab.url || '')) return;
  try {
    if (!(await liveScanFor(tab.url))) return;
    await runScan(tab);
    // pages keep adding text (chats, mail, feeds): rescan when it settles
    if (!isPdfUrl(tab.url)) await chrome.scripting.executeScript({ target: { tabId }, func: watchPage });
  } catch {
    /* pages that can't be scripted (web stores, PDFs, error pages) */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('scan:' + tabId).catch(() => {}));

const lastRescan = new Map(); // tabId → time, so a burst of messages costs one scan
async function rescan(tab) {
  if (!tab?.id || !(await liveScanFor(tab.url))) return { stop: true };
  const now = Date.now();
  if (now - (lastRescan.get(tab.id) || 0) < 3000) return {};
  lastRescan.set(tab.id, now);
  try {
    await runScan(tab);
  } catch {
    return { stop: true };
  }
  return {};
}

// ── paste guard (opt-in in Settings; needs permission for the listed sites) ──

const PASTE_SCRIPT = 'injex-paste-guard';
let pasteSync = Promise.resolve();

/** Register the paste-guard content script for the sites we have permission for (or remove it). */
function syncPasteGuard({ injectOpenTabs = false } = {}) {
  pasteSync = pasteSync
    .then(async () => {
      const { pasteGuard, pasteSites } = await store.get(['pasteGuard', 'pasteSites']);
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [PASTE_SCRIPT] }).catch(() => []);
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [PASTE_SCRIPT] });
      if (!pasteGuard) return;
      const matches = [];
      for (const p of matchPatterns(pasteSites)) if (await chrome.permissions.contains({ origins: [p] })) matches.push(p);
      if (!matches.length) return;
      const script = { id: PASTE_SCRIPT, js: ['src/content/paste-guard.js'], matches, runAt: 'document_start', allFrames: true };
      try {
        await chrome.scripting.registerContentScripts([{ ...script, persistAcrossSessions: true }]);
      } catch {
        await chrome.scripting.registerContentScripts([script]); // browsers without persistAcrossSessions (re-registered on startup)
      }
      if (!injectOpenTabs) return;
      // tabs that are already open get it now, not on their next load
      for (const tab of await chrome.tabs.query({ url: matches })) {
        chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/paste-guard.js'] }).catch(() => {});
      }
    })
    .catch((e) => console.warn('injex: paste guard', e));
  return pasteSync;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'injex:paste-check') {
    sendResponse(checkPaste(msg.text));
    return false;
  }
  if (msg?.type === 'injex:changed') {
    rescan(sender.tab).then(sendResponse, () => sendResponse({ stop: true }));
    return true;
  }
  return false;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  try {
    if (id === 'decode') return await doDecode(tab, info.frameId, info.selectionText);
    if (id === 'clean') return await doClean(tab, info.frameId, info.selectionText);
    if (id === 'inspect') return await doInspect(tab, info.frameId, info.selectionText);
    if (id === 'stego' || id === 'tags') return await doStego(tab, info.frameId, info.selectionText, id);
    if (id === 'scan') return await doScan(tab);
    if (id === 'open') return chrome.tabs.create({ url: chrome.runtime.getURL('ui/app.html?full=1') });
    if (id === 'enc:__more') return chrome.runtime.openOptionsPage();
    if (id.startsWith('enc:')) return await doEncode(tab, info.frameId, id.slice(4), info.selectionText);
  } catch (e) {
    console.warn('injex:', e);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  try {
    if (command === 'decode-selection') await doDecode(tab, null, '');
    if (command === 'scan-page') await doScan(tab);
  } catch (e) {
    console.warn('injex:', e);
  }
});
