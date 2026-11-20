// Site lists for live scan (skip / only these sites) and the paste guard (which sites to watch).
// One entry per line: "example.com" matches the domain and its subdomains, "*" is a wildcard
// ("*.example.*"), a "# comment" is ignored. Pure JavaScript.

export const PASTE_SITES = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'copilot.microsoft.com',
  'perplexity.ai',
  'chat.deepseek.com',
  'grok.com',
  'chat.mistral.ai',
  'poe.com',
  'meta.ai',
  'huggingface.co',
];

/** Text area → clean list of host patterns (lowercase, no scheme / path / port / comments). */
export function parseSites(text) {
  const out = [];
  for (let line of String(text ?? '').split(/[\n,]+/)) {
    line = line.replace(/#.*/, '').trim().toLowerCase();
    if (!line) continue;
    line = line.replace(/^[a-z*]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
    if (/^[a-z0-9*.-]+$/.test(line) && /[a-z0-9]/.test(line) && !out.includes(line)) out.push(line);
  }
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Does `url`'s host match one of the patterns? */
export function siteMatches(url, sites) {
  const host = hostOf(url);
  if (!host) return false;
  return (sites || []).some((p) => {
    if (p.includes('*')) {
      const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      return re.test(host);
    }
    return host === p || host.endsWith('.' + p);
  });
}

/** Should live scan look at `url`? mode 'all' (every site except `sites`) or 'only' (only `sites`). */
export function liveScanAllowed(url, mode = 'all', sites = []) {
  if (!/^https?:/i.test(url || '')) return false;
  return mode === 'only' ? siteMatches(url, sites) : !siteMatches(url, sites);
}

/**
 * Host patterns → match patterns for chrome.permissions / registerContentScripts.
 * "example.com" → *://*.example.com/* (the domain and its subdomains); wildcard hosts that match
 * patterns can't express ("*.example.*") fall back to every site.
 */
export function matchPatterns(sites) {
  const out = new Set();
  for (const p of sites || []) {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(p)) out.add(`*://${p}/*`); // an IP address has no subdomains
    else if (!p.includes('*')) out.add(`*://*.${p}/*`);
    else if (/^\*\.[^*]+$/.test(p)) out.add(`*://${p}/*`);
    else out.add('<all_urls>');
  }
  return out.has('<all_urls>') ? ['<all_urls>'] : [...out];
}
