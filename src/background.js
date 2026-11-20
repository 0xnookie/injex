// Service worker: right-click menu and keyboard shortcuts that work on the page you're on.
//   Encode selection → <transform>   replaces the selection in inputs / editors, otherwise shows + copies it
//   Decode selection                 universal decoder, unwraps nested layers and hidden text
//   Remove hidden characters         strips tags / selector runs / zero-width / bidi, fixes look-alikes
//   Hide selection in emoji          emoji steganography with the carrier from the popup
//   Scan page for hidden text        opens the dashboard with what the scanner found
// plus the opt-in live scan: every page that finishes loading is scanned and the toolbar badge counts
// critical / high findings. Everything runs locally; without live scan, activeTab (granted by the menu
// click / shortcut) is the only page access.

import { transforms, encode, setOptionPrefs, setCustomAlphabets, setRecipes } from './core/registry.js';
import { peel, universalDecode, englishness } from './core/decoder.js';
import { encodeEmojiBits, encodeTags } from './core/stego.js';
import { collectPage, scanPage, stripHidden } from './core/scan.js';
import { setScanBadge } from './core/badge.js';
import { captureSelection, applyResult } from './page.js';
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
  chrome.contextMenus.create({ id: 'sep0', parentId: 'root', type: 'separator', contexts: sel });
  chrome.contextMenus.create({ id: 'stego', parentId: 'root', title: 'Hide selection in emoji', contexts: sel });
  chrome.contextMenus.create({ id: 'tags', parentId: 'root', title: 'Make selection invisible (Unicode tags)', contexts: sel });
  chrome.contextMenus.create({ id: 'sep1', parentId: 'root', type: 'separator', contexts: ['selection', 'page', 'editable'] });
  chrome.contextMenus.create({ id: 'scan', parentId: 'root', title: 'Scan page for hidden text', contexts: ['selection', 'page', 'editable'] });
  chrome.contextMenus.create({ id: 'open', parentId: 'root', title: 'Open dashboard', contexts: ['selection', 'page', 'editable'] });
}

chrome.runtime.onInstalled.addListener(buildMenu);
chrome.runtime.onStartup.addListener(buildMenu);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.menuTransforms || changes.customAlphabets || changes.recipes)) buildMenu();
});

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

/** Collect the tab (all frames it allows) and scan it. Throws when the page can't be scripted. */
async function runScan(tab) {
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

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https?:/i.test(tab.url || '')) return;
  try {
    const { autoScan } = await store.get(['autoScan']);
    if (!autoScan || !(await chrome.permissions.contains(ALL_SITES))) return;
    await runScan(tab);
  } catch {
    /* pages that can't be scripted (web stores, PDFs, error pages) */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('scan:' + tabId).catch(() => {}));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  try {
    if (id === 'decode') return await doDecode(tab, info.frameId, info.selectionText);
    if (id === 'clean') return await doClean(tab, info.frameId, info.selectionText);
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
