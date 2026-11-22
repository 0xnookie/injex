// Agent view: what a browsing agent reads on a page versus what a person sees. Modern web agents read
// the DOM text, the accessibility tree (names, labels, alt text) and the page's metadata, and often a
// screenshot; a person sees the rendered page. collectAgentView() (injected, self-contained) gathers each
// channel; agentDiff() (pure) lists the sentences only an agent gets — and the ones only a screenshot
// shows — with the instruction check on each. scanUrl() checks a URL's parameters and fragment, which
// agents read and people rarely do.

import { instructionSignals } from './instructions.js';
import { scanText } from './scan.js';
import { findExfil, urlTexts, hostOf } from './exfil.js';

/** Injected into the page. Returns the channels as plain data. */
export function collectAgentView() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const MAX = 400000;
  // text is grouped by its nearest block element, so sentences don't run across paragraphs
  const domBlocks = new Map();
  const a11yBlocks = new Map();
  const blockCache = new Map();
  const blockOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      if (blockCache.has(n)) return blockCache.get(n);
      const d = getComputedStyle(n).display;
      if (d !== 'inline' && d !== 'contents') {
        blockCache.set(n, n);
        return n;
      }
    }
    return el;
  };
  const names = [];
  const shadowRendered = [];
  let shadowRoots = 0;
  const hiddenForA11y = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement || n.getRootNode?.().host) {
      if (n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('hidden') || n.hasAttribute('inert')) return true;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  };
  const label = (el) => {
    const parts = [];
    const ids = el.getAttribute('aria-labelledby');
    if (ids) for (const id of ids.split(/\s+/)) parts.push(el.getRootNode().getElementById?.(id)?.textContent || '');
    for (const a of ['aria-label', 'aria-description', 'alt', 'title', 'placeholder', 'aria-placeholder', 'aria-valuetext']) if (el.hasAttribute(a)) parts.push(el.getAttribute(a));
    if (el.localName === 'input' && /^(button|submit|reset)$/i.test(el.type) && el.value) parts.push(el.value);
    return norm(parts.join(' '));
  };
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 1) {
        const l = label(n);
        if (l && !hiddenForA11y(n)) names.push({ tag: n.localName, text: l });
        const sr = n.shadowRoot || globalThis.chrome?.dom?.openOrClosedShadowRoot?.(n);
        if (sr) {
          shadowRoots++;
          // innerText does not reach into shadow roots: add their rendered text separately
          for (const c of sr.children) if (c.innerText) shadowRendered.push(c.innerText);
          walk(sr);
        }
        continue;
      }
      const el = n.parentElement;
      if (!el || /^(script|style|title)$/i.test(el.localName)) continue;
      const t = n.nodeValue;
      if (!t || !t.trim()) continue;
      const b = blockOf(el);
      (domBlocks.get(b) || domBlocks.set(b, []).get(b)).push(t);
      if (!hiddenForA11y(el)) (a11yBlocks.get(b) || a11yBlocks.set(b, []).get(b)).push(t);
    }
  };
  walk(document.documentElement);
  const blocks = (m) => [...m.values()].map((parts) => norm(parts.join(''))).filter(Boolean);
  const dom = blocks(domBlocks);
  const a11y = blocks(a11yBlocks);
  const meta = [];
  for (const m of document.querySelectorAll('meta[content]')) {
    const k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
    if (k && m.content.trim().length >= 12) meta.push({ name: k, text: norm(m.content) });
  }
  for (const s of document.querySelectorAll('script[type*="ld+json"]')) meta.push({ name: 'json-ld', text: norm(s.textContent).slice(0, 20000) });
  const links = [...document.querySelectorAll('a[href]')].slice(0, 500).map((a) => ({ text: norm(a.textContent).slice(0, 300), href: a.href }));
  return {
    url: location.href,
    title: document.title,
    dom: dom.slice(0, 20000),
    rendered: norm((document.body ? document.body.innerText : '') + '\n' + shadowRendered.join('\n')).slice(0, MAX),
    a11y: a11y.slice(0, 20000),
    names: names.slice(0, 2000),
    meta,
    links,
    shadowRoots,
  };
}

const key = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sentences = (s) =>
  String(s || '')
    .split(/(?<=[.!?。！？])\s+|\s{2,}|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12 && /\p{L}{3}/u.test(x));

/**
 * Compare the channels of collectAgentView(): sentences an agent gets but the rendered page doesn't show,
 * sentences the page shows but the accessibility tree hides (screenshot-only), and leaks in links / URLs.
 */
export function agentDiff(v) {
  const rendered = key(v.rendered || '');
  const a11yKey = key(`${[].concat(v.a11y || []).join(' ')} ${(v.names || []).map((n) => n.text).join(' ')}`);
  const agentOnly = new Map();
  const consider = (text, channel) => {
    for (const s of sentences(text)) {
      const k = key(s);
      if (k.length < 10 || rendered.includes(k)) continue;
      const cur = agentOnly.get(k) || { text: s, channels: new Set() };
      cur.channels.add(channel);
      agentOnly.set(k, cur);
    }
  };
  for (const b of [].concat(v.dom || [])) consider(b, 'DOM text');
  for (const b of [].concat(v.a11y || [])) consider(b, 'accessibility tree');
  for (const n of v.names || []) consider(n.text, `accessible name (<${n.tag}>)`);
  for (const m of v.meta || []) consider(m.text, `meta ${m.name}`);
  consider(v.title, 'page title');
  const humanOnly = sentences(v.rendered).filter((s) => !a11yKey.includes(key(s)));
  const flag = (text) => {
    const sig = instructionSignals(text);
    return { instructions: sig.instructions, ...(sig.signals.length ? { signals: sig.signals } : {}) };
  };
  const agent = [...agentOnly.values()].map((x) => ({ text: x.text, channels: [...x.channels], ...flag(x.text) })).sort((a, b) => (b.instructions ? 1 : 0) - (a.instructions ? 1 : 0));
  const human = humanOnly.map((text) => ({ text, ...flag(text) }));
  const linkMd = (v.links || []).map((l) => `[${l.text}](${l.href})`).join('\n');
  // ordinary links carry ids and tokens all the time: only the sharper rules apply to them
  const leaks = [...findExfil(linkMd).filter((f) => f.rule !== 'link-data'), ...scanUrl(v.url || '').filter((f) => f.kind !== 'exfil' || f.rule !== 'link-data')].map((f) => ({ rule: f.rule || f.kind, severity: f.severity, note: f.note, match: String(f.match || f.payload || '').slice(0, 300) }));
  return {
    url: v.url,
    channels: { dom: [].concat(v.dom || []).join(' ').length, rendered: (v.rendered || '').length, a11y: [].concat(v.a11y || []).join(' ').length, names: (v.names || []).length, meta: (v.meta || []).length, links: (v.links || []).length, shadowRoots: v.shadowRoots || 0 },
    agentOnly: agent,
    humanOnly: human,
    leaks,
    instructions: agent.filter((x) => x.instructions).length,
  };
}

/**
 * Findings for a URL: instructions or hidden characters in its decoded parameters and fragment (agents
 * read them, the fragment never reaches the server), exfiltration shapes, collector hosts.
 */
export function scanUrl(url) {
  const out = [];
  const u = String(url || '');
  if (!u) return out;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return [{ kind: 'exfil', severity: 'low', note: 'not a valid URL', payload: u.slice(0, 300) }];
  }
  for (const f of findExfil(u)) out.push({ kind: 'exfil', rule: f.rule, severity: f.severity, note: f.note, payload: f.url || f.match, match: f.match });
  const parts = [...parsed.searchParams].map(([k, v]) => [`parameter “${k}”`, v]);
  if (parsed.hash.length > 1) {
    let h = parsed.hash.slice(1);
    try {
      h = decodeURIComponent(h);
    } catch {
      /* keep */
    }
    parts.push(['fragment (never sent to the server)', h]);
  }
  for (const [where, value] of parts) {
    for (const f of scanText(value, { exfil: false })) out.push({ ...f, where: `URL ${where}` });
    const decoded = [value, ...urlTexts(`https://x/?q=${encodeURIComponent(value)}`)];
    for (const text of decoded) {
      const sig = instructionSignals(text);
      if (sig.instructions) {
        out.push({ kind: 'unrendered', severity: 'high', instructions: true, signals: sig.signals, payload: text.slice(0, 2000), note: `URL ${where} reads like instructions to an agent`, where: `URL ${where}` });
        break;
      }
    }
  }
  if (/[^\x00-\x7F]/.test(parsed.hostname) || /xn--/.test(parsed.hostname)) out.push({ kind: 'homoglyph', severity: 'medium', payload: hostOf(u), note: 'internationalised host name — check for look-alike letters' });
  return out;
}
