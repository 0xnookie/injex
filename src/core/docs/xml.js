// A small streaming XML tokenizer — enough for machine-written Office XML (no DTDs).

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] !== '#') return ENT[e];
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

export function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeEntities(m[2] ?? m[3]);
  return out;
}

/**
 * Tokens of an XML string: { type: 'open' | 'close' | 'empty', name, attrs } and { type: 'text', text }.
 * Comments, processing instructions and CDATA markers are skipped (CDATA content is kept as text).
 */
export function* xmlTokens(xml) {
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) yield { type: 'text', text: m[1] };
    else if (m[3]) {
      if (m[2]) yield { type: 'close', name: m[3] };
      else yield { type: m[5] ? 'empty' : 'open', name: m[3], attrs: parseAttrs(m[4] || '') };
    } else if (m[6] !== undefined) yield { type: 'text', text: decodeEntities(m[6]) };
  }
}

/** All text content of an XML string, whitespace-collapsed. */
export function xmlText(xml) {
  let out = '';
  for (const t of xmlTokens(xml)) {
    if (t.type === 'text') out += t.text;
    else if (t.type !== 'text') out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}
