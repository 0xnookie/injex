// Exfiltration shapes: the few syntactic forms that 2025–2026 prompt-injection leaks ended in — an image
// or link whose URL carries data (inline or reference-style Markdown, HTML), a burst of per-character
// URLs on one host, links inside Mermaid diagrams, remote JSON-schema fetches, DNS / curl commands with
// secrets in them, known request-collector hosts, links whose text names another host, "save this to
// memory", instructions hidden in URL parameters, and requests to write data to a public place.
// Pure and deterministic: the collector list is data shipped here, never fetched.

import { looksLikeInstructions } from './instructions.js';

export const EXFIL_RULES = {
  'image-data': { label: 'image URL that carries data', severity: 'high' },
  'ref-image-data': { label: 'reference-style image URL that carries data', severity: 'high' },
  'html-url-data': { label: 'HTML resource URL that carries data', severity: 'high' },
  'link-data': { label: 'link URL that carries data', severity: 'medium' },
  'url-burst': { label: 'many URLs on one host that differ by one short segment (per-character leak)', severity: 'high' },
  mermaid: { label: 'link or image inside a Mermaid diagram', severity: 'medium' },
  'remote-schema': { label: 'JSON $schema / $ref fetched from a remote host', severity: 'medium' },
  'shell-exfil': { label: 'command that sends secrets or environment variables out (DNS, curl, wget)', severity: 'high' },
  collector: { label: 'known request-collector host', severity: 'medium' },
  'link-mismatch': { label: 'link text names a different host than the link', severity: 'medium' },
  memory: { label: 'asks to save something to the assistant’s memory', severity: 'medium' },
  'url-instructions': { label: 'instructions hidden in a URL parameter', severity: 'high' },
  'public-sink': { label: 'asks to write data to a public place (issue, PR, gist, public repo, BCC)', severity: 'high' },
};

/** Hosts that exist to receive requests (webhooks, OAST, tunnels): a link to one in untrusted content is a lead. */
export const COLLECTOR_HOSTS = [
  'webhook.site', 'requestbin.com', 'requestbin.net', 'pipedream.net', 'pipedream.com', 'm.pipedream.net', 'beeceptor.com', 'hookbin.com',
  'requestcatcher.com', 'requestinspector.com', 'webhook.cool', 'interact.sh', 'interactsh.com', 'oast.fun', 'oast.live', 'oast.me', 'oast.online',
  'oast.pro', 'oast.site', 'burpcollaborator.net', 'oastify.com', 'canarytokens.com', 'dnslog.cn', 'ceye.io', 'ngrok.io', 'ngrok.app', 'ngrok-free.app',
  'ngrok-free.dev', 'trycloudflare.com', 'loca.lt', 'localtunnel.me', 'serveo.net', 'localhost.run', 'pagekite.me', 'xip.io', 'nip.io', 'sslip.io',
  'requestrepo.com', 'postb.in', 'ptsv2.com', 'ptsv3.com', 'webhook.office.com',
];

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
const TLD = /\.(?:com|net|org|io|dev|app|ai|co|gov|edu|mil|int|info|biz|me|us|uk|de|fr|nl|be|ch|at|se|no|dk|fi|es|it|pt|pl|cz|ru|ua|cn|jp|kr|tw|hk|sg|in|au|nz|ca|br|mx|ar|za|eu|xyz|site|online|tech|cloud|sh|ly|gg|tv|to|so|page|link|live|store|shop|app|club|top|vip|work|pro|one|run|zone|world|today|news|blog|email|money|bank|finance|support|help|login|secure|account|services)$/i;
const PLACEHOLDER = /\{\{?[^{}\n]{1,60}\}\}?|%7B[^%\s]{1,60}%7D|\$\{[^}\n]{1,60}\}|\$[A-Z_]{3,}|<[A-Z_][A-Z0-9_ -]{2,40}>|\[(?:[A-Z_ ]{3,40})\]|%5B[A-Z_]{3,40}%5D/;
const DATA_WORD = /(?:^|[^A-Za-z])(INSERT|REPLACE|DATA|SECRETS?|TOKENS?|PASSWORDS?|CHAT|HISTORY|CONVERSATION|SUMMARY|EMAILS?|APIKEY|API_KEY|CREDENTIALS?|COOKIES?|SESSION|PRIVATE)(?:[^A-Za-z]|$)/;
const STRONG_PARAM = /^(data|payload|leak|exfil|secret|token|key|conv|history|chat|summary|cookie|session|pw|pass|password)$/i;
const DATA_PARAM = /[?&;](?:data|d|q|query|msg|message|m|c|content|text|t|info|secret|token|key|k|p|payload|leak|exfil|x|s|conv|history|chat|summary|email|pw|pass|password|cookie|session)=([^&#\s]*)/gi;
// a long Base64 / hex token: mixed case and digits, not a dashed slug like "Transforms-222-brightgreen"
function isBlob(v) {
  for (const raw of String(v).split(/[/.,;:]/)) {
    const seg = decodeSafe(raw);
    // (pure hex is left out: commit hashes and content digests in paths are everywhere)
    if (seg.length >= 32 && /^[A-Za-z0-9+_=-]+$/.test(seg) && /[A-Z].*[A-Z]/.test(seg) && /[a-z].*[a-z]/.test(seg) && /[0-9].*[0-9]/.test(seg) && (seg.match(/-/g) || []).length <= 2) return true;
  }
  return false;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isCollector(host, list = COLLECTOR_HOSTS) {
  return !!host && list.some((h) => host === h || host.endsWith('.' + h));
}

/** Does this URL look like it carries data out? { dataish, why } */
export function urlDatainess(url) {
  let decoded = url;
  try {
    decoded = decodeURI(url);
  } catch {
    /* keep raw */
  }
  const qIdx = url.search(/[?#]/);
  const tail = qIdx >= 0 ? url.slice(qIdx) : '';
  const lastSeg = url.replace(/[?#].*$/, '').split('/').slice(3).join('/');
  if (PLACEHOLDER.test(decoded)) return { dataish: true, why: 'template placeholder in the URL' };
  for (const m of tail.matchAll(DATA_PARAM)) {
    const v = m[1];
    if (!v) continue;
    const name = m[0].slice(1, m[0].indexOf('='));
    if (PLACEHOLDER.test(v) || DATA_WORD.test(decodeSafe(v)) || isBlob(v) || (STRONG_PARAM.test(name) && v.length >= 24)) return { dataish: true, why: `data in the “${name}” parameter` };
  }
  if (isBlob(lastSeg) && !/\.(png|jpe?g|gif|webp|svg|ico|css|js)$/i.test(lastSeg)) return { dataish: true, why: 'encoded blob in the URL path' };
  return { dataish: false, why: '' };
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function b64(s) {
  if (!/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(s)) return '';
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /^[\x20-\x7E\s]+$/.test(t) ? t : '';
  } catch {
    return '';
  }
}

/** Text hidden in a URL's parameters and fragment, decoded (percent-encoding, Base64). */
export function urlTexts(url) {
  const out = [];
  let u;
  try {
    u = new URL(url);
  } catch {
    return out;
  }
  for (const [, v] of u.searchParams) {
    if (v.length < 12) continue;
    out.push(v);
    const b = b64(v);
    if (b) out.push(b);
  }
  if (u.hash.length > 12) {
    const h = decodeSafe(u.hash.slice(1));
    out.push(h);
    const b = b64(h);
    if (b) out.push(b);
  }
  return out;
}

const MEMORY = /\b(remember|memori[sz]e|save|store|add|write|keep|record)\b.{0,40}\b(to|in|into|inside) (your |the )?(long[- ]term |persistent |permanent )?(memory|memories|bio|profile notes|custom instructions)\b|\bupdate (your|the) (memory|memories|bio|custom instructions)\b|\bremember (this|that|the following) (for|in) (all )?(future|later|every) (conversations?|chats?|sessions?)\b/i;
const PUBLIC_SINK = [
  /\b(create|open|post|file|write|add|leave)\b.{0,25}\b(a |an |new |public )*(issue|pull request|PR|gist|comment|discussion|review)\b.{0,80}\b(with|containing|including|that (includes|contains)|listing)\b.{0,50}\b(contents?|secrets?|keys?|tokens?|passwords?|env|\.env|private|credentials?|source code|data)\b/i,
  /\b(push|publish|upload|commit|copy)\b.{0,50}\b(to|into) (a |the |my )?(new )?public (repo|repository|bucket|gist|pastebin|paste)\b/i,
  /\b(add|include|put|set)\b.{0,30}\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b.{0,30}\b(bcc|cc|recipient|in copy)\b/i,
  /\b(bcc|cc)\b.{0,20}\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b.{0,60}\b(every|all|each) (e-?mails?|messages?)\b/i,
];
const SHELL = [
  /\b(nslookup|dig|host|ping|drill|resolvectl query)\b[^\n]{0,80}?(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\([^)\n]{1,80}\)|`[^`\n]{1,80}`)[\w-]*\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\b(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|nc|ncat|socat)\b[^\n]{0,160}?(--data(-binary|-raw|-urlencode)?|-d|-F|--upload-file|-T|--post-file|--body-file|-InFile|-Body)\s+["']?@?~?\/?[\w./$-]*(\.ssh|\.aws|\.env|\.netrc|\.git-credentials|\.npmrc|\.pypirc|\.docker\/config|\.kube\/config|id_rsa|id_ed25519|credentials|secrets?)\b/i,
  /\b(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b[^\n]{0,120}?https?:\/\/[^\s"']*(\$\{?(?:[A-Z_]*(?:TOKEN|KEY|SECRET|PASS|PASSWORD|CRED|AUTH|SESSION|COOKIE)[A-Z_]*)\}?|\$\((cat|env|printenv|base64)[^)\n]*\))/i,
  /\b(env|printenv|set|Get-ChildItem env:|gci env:|cat ~?\/?\.env)\b[^\n|]{0,40}\|\s*(base64[^|\n]*\|\s*)?(curl|wget|nc|ncat|socat|Invoke-WebRequest|iwr|irm)\b/i,
];

/**
 * Exfiltration-shaped content in `text`: [{ rule, severity, index, length, match, note, url? }].
 * `collectors`: host list (default COLLECTOR_HOSTS).
 */
export function findExfil(text, { collectors = COLLECTOR_HOSTS } = {}) {
  const s = String(text ?? '');
  const out = [];
  if (!s || s.length < 8) return out;
  const seen = new Set();
  const add = (rule, index, match, extra = {}) => {
    const key = rule + ':' + index;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ rule, severity: extra.severity || EXFIL_RULES[rule].severity, index, length: match.length, match: match.slice(0, 400), note: EXFIL_RULES[rule].label + (extra.why ? ` — ${extra.why}` : ''), ...(extra.url ? { url: extra.url } : {}) });
  };
  const quick = /https?:|\$schema|\$ref|memory|bcc|public|nslookup|dig |curl|wget|iwr|irm|mermaid|issue|gist|bio\b/i.test(s);
  if (!quick) return out;

  // 1. inline Markdown images
  for (const m of s.matchAll(/!\[[^\]\n]{0,200}\]\(\s*<?(https?:\/\/[^)\s>]+)/gi)) {
    const d = urlDatainess(m[1]);
    const col = isCollector(hostOf(m[1]), collectors);
    if (d.dataish || col) add('image-data', m.index, m[0], { url: m[1], why: d.why || 'collector host' });
  }
  // 2. reference-style images: ![x][ref] … [ref]: https://…
  const refs = new Map();
  for (const m of s.matchAll(/^[ \t]{0,3}\[([^\]\n]{1,100})\]:[ \t]*<?(https?:\/\/[^\s>]+)/gim)) refs.set(m[1].toLowerCase(), { url: m[2], index: m.index, text: m[0] });
  if (refs.size) {
    for (const m of s.matchAll(/!\[([^\]\n]{0,200})\]\[([^\]\n]{0,100})\]/g)) {
      const ref = refs.get((m[2] || m[1]).toLowerCase());
      if (!ref) continue;
      const d = urlDatainess(ref.url);
      if (d.dataish || isCollector(hostOf(ref.url), collectors)) add('ref-image-data', ref.index, ref.text, { url: ref.url, why: d.why || 'collector host' });
    }
  }
  // 3. HTML resources (img / iframe / script / link / source / video / object / CSS url())
  for (const m of s.matchAll(/<(img|iframe|script|link|source|video|audio|object|embed|image|use)\b[^>]{0,400}?\b(src|href|poster|data|xlink:href|srcset)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
    const d = urlDatainess(m[3]);
    if (d.dataish || isCollector(hostOf(m[3]), collectors)) add('html-url-data', m.index, m[0], { url: m[3], why: d.why || 'collector host' });
  }
  for (const m of s.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
    const d = urlDatainess(m[1]);
    if (d.dataish) add('html-url-data', m.index, m[0], { url: m[1], why: d.why });
  }

  // every URL: links with data, collectors, hidden instructions, per-character bursts
  const groups = new Map();
  for (const m of s.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    const host = hostOf(url);
    if (!host) continue;
    const inside = out.some((f) => m.index >= f.index && m.index < f.index + f.length);
    if (isCollector(host, collectors)) {
      if (!inside) add('collector', m.index, url, { url, severity: urlDatainess(url).dataish ? 'high' : 'medium' });
    } else {
      const d = urlDatainess(url);
      if (d.dataish && !inside) add('link-data', m.index, url, { url, why: d.why });
    }
    for (const t of urlTexts(url)) {
      if (looksLikeInstructions(t)) {
        add('url-instructions', m.index, url, { url, why: `“${t.slice(0, 120)}”` });
        break;
      }
    }
    const path = url.replace(/[?#].*$/, '');
    const cut = path.lastIndexOf('/');
    const base = path.slice(0, cut);
    const last = path.slice(cut + 1);
    if (cut > 8 && last.length && last.length <= 3) {
      if (!groups.has(base)) groups.set(base, { index: m.index, segs: new Set(), first: url });
      groups.get(base).segs.add(last);
    }
  }
  for (const [base, g] of groups) if (g.segs.size >= 8) add('url-burst', g.index, base + '/…', { url: g.first, why: `${g.segs.size} different endings on ${hostOf(base + '/')}` });

  // Mermaid diagrams with links or images
  for (const m of s.matchAll(/```\s*mermaid\b([\s\S]{0,20000}?)```/gi)) {
    if (/\bclick\b[^\n]*\b(href|call)\b|https?:\/\/|<img\b/i.test(m[1])) add('mermaid', m.index, m[0].slice(0, 200));
  }
  // remote JSON schema / $ref
  for (const m of s.matchAll(/["']?\$(schema|ref)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const host = hostOf(m[2]);
    if (/(^|\.)(json-schema\.org|schemastore\.org|json\.schemastore\.org|w3\.org|schemas\.microsoft\.com|raw\.githubusercontent\.com\/SchemaStore)$/i.test(host)) continue;
    const d = urlDatainess(m[2]);
    add('remote-schema', m.index, m[0], { url: m[2], severity: d.dataish ? 'high' : 'medium', why: host });
  }
  // shell commands that ship secrets
  for (const re of SHELL) for (const m of s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) add('shell-exfil', m.index, m[0]);
  // links whose text names another host (text with a scheme, or ending in a common top-level domain —
  // "CHANGELOG.md" or "cs.CR" are file names and categories, not hosts)
  const shownHost = (t) => (/^https?:/i.test(t) ? hostOf(t) : TLD.test(t.replace(/\/.*$/, '')) ? hostOf('https://' + t) : '');
  for (const m of s.matchAll(/\[((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\]\s]*)?)\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const shown = shownHost(m[1]);
    const real = hostOf(m[2]);
    if (shown && real && shown !== real && !real.endsWith('.' + shown)) add('link-mismatch', m.index, m[0], { url: m[2], why: `shows ${shown}, goes to ${real}` });
  }
  for (const m of s.matchAll(/<a\b[^>]{0,300}?href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]{0,200}>\s*((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}[^<\s]*)\s*<\/a>/gi)) {
    const shown = shownHost(m[2]);
    const real = hostOf(m[1]);
    if (shown && real && shown !== real && !real.endsWith('.' + shown)) add('link-mismatch', m.index, m[0], { url: m[1], why: `shows ${shown}, goes to ${real}` });
  }
  // memory writes and public sinks
  const mm = MEMORY.exec(s);
  if (mm) add('memory', mm.index, mm[0]);
  for (const re of PUBLIC_SINK) {
    const m = re.exec(s);
    if (m) add('public-sink', m.index, m[0]);
  }
  return out.sort((a, b) => a.index - b.index);
}
