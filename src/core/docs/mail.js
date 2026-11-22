// E-mail (.eml, .mbox) and calendar (.ics) files: the carriers of EchoLeak-style and "Invitation Is All
// You Need"-style injections. A line-by-line text scan misses what these formats hide — a tag-character
// run split across quoted-printable soft line breaks, a Base64 body, a folded iCalendar line — so they
// are decoded first: MIME parts (quoted-printable / Base64, charsets, RFC 2047 headers), multipart trees,
// attachments, iCalendar unfolding and unescaping. Returns plain parts for the scanner.

const td = (label) => {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return new TextDecoder('utf-8');
  }
};

/** Bytes → text with a charset (unknown charsets fall back to UTF-8). */
export function decodeBytes(bytes, charset = 'utf-8') {
  return td(String(charset || 'utf-8').toLowerCase().replace(/^us-ascii$/, 'utf-8')).decode(bytes);
}

const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** Quoted-printable → bytes (soft line breaks removed). */
export function qpDecode(s) {
  const t = String(s).replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(t.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Base64 (with line breaks and junk) → bytes. */
export function b64Decode(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
  try {
    return latin1(atob(clean + '='.repeat((4 - (clean.length % 4)) % 4)));
  } catch {
    return new Uint8Array(0);
  }
}

/** RFC 2047 encoded words in a header ("=?utf-8?B?…?=" / "=?…?Q?…?="). */
export function decodeHeader(v) {
  return String(v ?? '')
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, data) => {
      const bytes = /b/i.test(enc) ? b64Decode(data) : qpDecode(data.replace(/_/g, ' '));
      return decodeBytes(bytes, cs.replace(/\*.*$/, ''));
    });
}

/** Header block → { name (lower case): [values] } (folded lines unfolded). */
export function parseHeaders(block) {
  const out = {};
  for (const line of String(block).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    (out[k] ||= []).push(m[2]);
  }
  return out;
}

const param = (v, name) => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(v || '');
  return m ? decodeHeader((m[1] ?? m[2] ?? '').replace(/^[\w-]+''/, (x) => '')) : '';
};

/**
 * Parse a MIME message (bytes or a "binary" latin-1 string). Returns
 * { headers, parts: [{ type, charset, name, disposition, text?, bytes, path }] } — leaves only, depth-first.
 */
export function parseMime(input, path = '', depth = 0) {
  const raw = typeof input === 'string' ? input : binaryString(input instanceof Uint8Array ? input : new Uint8Array(input));
  const split = raw.search(/\r?\n\r?\n/);
  const headBlock = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? '' : raw.slice(raw.indexOf('\n', split + 1) + 1).replace(/^\r?\n/, '');
  const headers = parseHeaders(headBlock);
  const ctype = (headers['content-type']?.[0] || 'text/plain').trim();
  const type = ctype.split(';')[0].trim().toLowerCase();
  const parts = [];
  if (type.startsWith('multipart/') && depth < 12) {
    const boundary = param(ctype, 'boundary');
    if (boundary) {
      const pieces = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
      pieces.slice(1).forEach((p, i) => {
        if (!p.trim()) return;
        parts.push(...parseMime(p, `${path}${path ? '.' : ''}${i + 1}`, depth + 1).parts);
      });
      return { headers, parts };
    }
  }
  if (type === 'message/rfc822' && depth < 12) {
    const inner = parseMime(transferDecode(body, headers), `${path || '1'}`, depth + 1);
    parts.push({ type, path: path || '1', headers: inner.headers, nested: true, charset: '', name: '', disposition: '', bytes: new Uint8Array(0) });
    parts.push(...inner.parts);
    return { headers, parts };
  }
  const bytes = latin1(transferDecode(body, headers));
  const charset = param(ctype, 'charset') || 'utf-8';
  const disp = headers['content-disposition']?.[0] || '';
  const name = param(disp, 'filename') || param(ctype, 'name');
  const part = { type, charset, name, disposition: disp.split(';')[0].trim().toLowerCase(), bytes, path: path || '1' };
  if (type.startsWith('text/') || type === 'application/ics') part.text = decodeBytes(bytes, charset);
  parts.push(part);
  return { headers, parts };
}

function binaryString(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}

/** A body in its Content-Transfer-Encoding → "binary" string. */
function transferDecode(body, headers) {
  const enc = (headers['content-transfer-encoding']?.[0] || '').trim().toLowerCase();
  if (enc === 'base64') return binaryString(b64Decode(body));
  if (enc === 'quoted-printable') return binaryString(qpDecode(body));
  return body;
}

/** An mbox file → messages ("binary" strings), split on "From " lines. */
export function splitMbox(raw) {
  const s = typeof raw === 'string' ? raw : binaryString(raw);
  return s
    .split(/^From [^\r\n]*\r?\n/m)
    .filter((m) => m.trim())
    .map((m) => m.replace(/^>(>*From )/gm, '$1'));
}

/** Does this look like a raw e-mail (RFC 5322 headers at the top)? */
export function looksLikeEmail(head) {
  const first = String(head).slice(0, 4096);
  const n = (first.match(/^(?:Received|From|To|Subject|Date|Message-ID|MIME-Version|Return-Path|Delivered-To|Content-Type|X-[\w-]+):/gim) || []).length;
  return n >= 3;
}

// ── iCalendar ──

/** iCalendar text → components: [{ type: 'VEVENT', props: [{ name, params, value, line }] }]. */
export function parseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const stack = [];
  const out = [];
  lines.forEach((line, i) => {
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):([\s\S]*)$/.exec(line);
    if (!m) return;
    const name = m[1].toUpperCase();
    if (name === 'BEGIN') {
      stack.push({ type: m[3].trim().toUpperCase(), props: [] });
      return;
    }
    if (name === 'END') {
      const c = stack.pop();
      if (c) out.push(c);
      return;
    }
    const params = {};
    for (const p of m[2].split(';').filter(Boolean)) {
      const [k, ...v] = p.split('=');
      params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, '');
    }
    const value = m[3].replace(/\\([\\;,nN])/g, (x, c) => (c === 'n' || c === 'N' ? '\n' : c));
    (stack.at(-1) || { props: [] }).props.push({ name, params, value, line: i + 1 });
  });
  return out;
}

/** The text properties of a calendar that an assistant reads (titles, descriptions, places, people, links). */
export const ICS_TEXT = ['SUMMARY', 'DESCRIPTION', 'LOCATION', 'COMMENT', 'X-ALT-DESC', 'CONTACT', 'RESOURCES', 'CATEGORIES', 'URL', 'ATTACH', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-GOOGLE-CONFERENCE'];
