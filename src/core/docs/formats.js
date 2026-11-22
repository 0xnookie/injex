// More document formats for the hidden-text scanner, all reduced to the Word reader's shape
// ({ parts: [{ label, chunks: [{ text, hidden, para, ref? }] }], meta, comments, warnings }) so
// scanDocument() treats them alike:
//   XLSX  hidden and very-hidden sheets, hidden rows and columns, white / tiny fonts, the ";;;" number
//         format that hides a value, comments, defined names, document properties
//   PPTX  hidden slides, hidden shapes, shapes off the slide, white / transparent / tiny text, speaker
//         notes, comments, document properties
//   ODF   (odt / ods / odp) hidden paragraphs and text, display:none / white / tiny styles, collapsed rows
//         and hidden sheets, annotations, meta.xml
//   RTF   \v hidden text, white or tiny text, \info properties, annotations
//   Images  text in PNG (tEXt / zTXt / iTXt, XMP), JPEG (EXIF descriptions and comments, XMP, COM), WebP
//         (EXIF / XMP chunks) and GIF comments — nothing shown, everything handed to a vision model's
//         pipeline or an alt-text generator.

import { openZip } from './zip.js';
import { xmlTokens, xmlText, decodeEntities } from './xml.js';
import { inflate } from './codec.js';

const isWhite = (hex) => /^(?:FF)?F[A-F0-9]F[A-F0-9]F[A-F0-9]$/i.test(String(hex || '').replace(/^#/, '')) && parseInt(String(hex).replace(/^#/, '').slice(-6, -4), 16) >= 0xf5 && parseInt(String(hex).replace(/^#/, '').slice(-4, -2), 16) >= 0xf5 && parseInt(String(hex).replace(/^#/, '').slice(-2), 16) >= 0xf5;

async function officeProps(zip) {
  const meta = [];
  for (const [file, fields] of [
    ['docProps/core.xml', ['dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'dc:creator', 'cp:category', 'cp:contentStatus']],
    ['docProps/app.xml', ['Company', 'Manager']],
  ]) {
    const x = await zip.text(file);
    if (!x) continue;
    for (const f of fields) {
      const m = new RegExp(`<${f}[^>]*>([\\s\\S]*?)</${f}>`).exec(x);
      if (m && m[1].trim()) meta.push({ field: f.replace(/^\w+:/, ''), value: decodeEntities(m[1].trim()) });
    }
  }
  const custom = await zip.text('docProps/custom.xml');
  if (custom) for (const m of custom.matchAll(/<property[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) meta.push({ field: decodeEntities(m[1]), value: xmlText(m[2]) });
  return meta;
}

const rels = (xml) => Object.fromEntries([...String(xml || '').matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2]]));
const resolvePath = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};
const colIndex = (ref) => [...(/^[A-Z]+/.exec(ref)?.[0] || 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

// ── XLSX ──

export async function readXlsx(bytes) {
  const zip = openZip(bytes);
  const warnings = [];
  const wb = (await zip.text('xl/workbook.xml')) || '';
  const wbRels = rels(await zip.text('xl/_rels/workbook.xml.rels'));
  const shared = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1])).join(''));
  // styles: cellXfs index → { white, tiny, hiddenFormat }
  const st = (await zip.text('xl/styles.xml')) || '';
  const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(st)?.[1] || '').matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>|<font\b[^>]*\/>/g)].map((m) => ({ white: isWhite(/<color[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(m[1] || '')?.[1]), size: Number(/<sz[^>]*val="([\d.]+)"/.exec(m[1] || '')?.[1] || 11) }));
  const hiddenFmts = new Set([...st.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].filter((m) => /^(?:;;;|"?"?;"?"?;"?"?;"?"?)$/.test(decodeEntities(m[2]).replace(/\s/g, ''))).map((m) => m[1]));
  const fills = [...(/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(st)?.[1] || '').matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>|<fill\b[^>]*\/>/g)].map((m) => /<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(m[1] || '')?.[1] || '');
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st)?.[1] || '').matchAll(/<xf\b([^>]*)\/?>/g)].map((m) => {
    const a = (k) => new RegExp(`${k}="(\\d+)"`).exec(m[1])?.[1];
    const font = fonts[Number(a('fontId') || 0)] || {};
    const fill = fills[Number(a('fillId') || 0)] || '';
    return { white: font.white && !(fill && !isWhite(fill)), tiny: font.size > 0 && font.size < 2, fmt: hiddenFmts.has(a('numFmtId')) };
  });
  const parts = [];
  const meta = await officeProps(zip);
  for (const m of wb.matchAll(/<definedName\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/definedName>/g)) meta.push({ field: `defined name ${decodeEntities(m[1])}`, value: decodeEntities(m[2]) });
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeEntities(/name="([^"]*)"/.exec(m[1])?.[1] || 'Sheet');
    const state = /state="([^"]*)"/.exec(m[1])?.[1] || 'visible';
    const rid = /r:id="([^"]*)"/.exec(m[1])?.[1];
    const target = wbRels[rid];
    if (!target) continue;
    const path = resolvePath('xl/workbook.xml', target);
    const xml = await zip.text(path);
    if (!xml) continue;
    const hiddenCols = [];
    for (const c of xml.matchAll(/<col\b([^>]*)\/?>/g)) if (/hidden="(?:1|true)"/.test(c[1]) || /\bwidth="0(?:\.0+)?"/.test(c[1])) hiddenCols.push([Number(/min="(\d+)"/.exec(c[1])?.[1]), Number(/max="(\d+)"/.exec(c[1])?.[1])]);
    const chunks = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNo = Number(/\br="(\d+)"/.exec(r[1])?.[1] || chunks.length + 1);
      const rowHidden = /hidden="(?:1|true)"/.test(r[1]) || /\bht="0(?:\.0+)?"/.test(r[1]);
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1] || '';
        const t = /\bt="(\w+)"/.exec(c[1])?.[1];
        const s = Number(/\bs="(\d+)"/.exec(c[1])?.[1] || 0);
        const inner = c[2] || '';
        let text = '';
        if (t === 's') text = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? '';
        else if (t === 'inlineStr') text = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1])).join('');
        else if (t === 'str' || t === undefined) text = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || '');
        if (!text || !/\p{L}/u.test(text)) continue;
        const col = colIndex(ref);
        const x = xfs[s] || {};
        const hidden = state !== 'visible' ? `on a ${state === 'veryHidden' ? 'very hidden' : 'hidden'} sheet` : rowHidden ? 'in a hidden row' : hiddenCols.some(([a, b]) => col >= a && col <= b) ? 'in a hidden column' : x.fmt ? 'number format ";;;" hides the value' : x.white ? 'white text' : x.tiny ? 'tiny text' : '';
        chunks.push({ text: text + ' ', hidden, para: rowNo, ref: `${name}!${ref}` });
      }
    }
    parts.push({ label: `sheet ${name}`, chunks });
  }
  const comments = [];
  for (const n of zip.names.filter((x) => /^xl\/(?:comments\d*|threadedComments\/[^/]+)\.xml$/i.test(x))) {
    const x = await zip.text(n);
    for (const m of x.matchAll(/<(?:comment|threadedComment)\b[^>]*>([\s\S]*?)<\/(?:comment|threadedComment)>/g)) comments.push({ author: '', text: xmlText(m[1]) });
  }
  if (!parts.length) warnings.push('no worksheets found');
  return { parts, meta, comments, annotations: [], warnings };
}

// ── PPTX ──

export async function readPptx(bytes) {
  const zip = openZip(bytes);
  const warnings = [];
  const pres = (await zip.text('ppt/presentation.xml')) || '';
  const presRels = rels(await zip.text('ppt/_rels/presentation.xml.rels'));
  const W = Number(/<p:sldSz[^>]*cx="(\d+)"/.exec(pres)?.[1] || 12192000);
  const H = Number(/<p:sldSz[^>]*cy="(\d+)"/.exec(pres)?.[1] || 6858000);
  const parts = [];
  let n = 0;
  for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
    const path = presRels[m[1]] && resolvePath('ppt/presentation.xml', presRels[m[1]]);
    const xml = path && (await zip.text(path));
    if (!xml) continue;
    n++;
    const slideHidden = /<p:sld\b[^>]*\bshow="(?:0|false)"/.test(xml);
    const chunks = [];
    for (const sp of xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      const s = sp[0];
      const shapeHidden = /<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(s);
      const off = /<a:off\b[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/.exec(s);
      const ext = /<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(s);
      const outside = off && ext && (Number(off[1]) >= W || Number(off[2]) >= H || Number(off[1]) + Number(ext[1]) <= 0 || Number(off[2]) + Number(ext[2]) <= 0);
      for (const r of s.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
        const text = [...r[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => decodeEntities(x[1])).join('');
        if (!text) continue;
        const rpr = /<a:rPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:rPr>)/.exec(r[1]);
        const sz = Number(/\bsz="(\d+)"/.exec(rpr?.[1] || '')?.[1] || 1800);
        const fill = /<a:solidFill>\s*<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"(?:\/>|>([\s\S]*?)<\/a:srgbClr>)/.exec(rpr?.[2] || '');
        const alpha = Number(/<a:alpha\b[^>]*val="(\d+)"/.exec(fill?.[2] || '')?.[1] ?? 100000);
        const hidden = slideHidden ? 'on a hidden slide' : shapeHidden ? 'in a hidden shape' : outside ? 'in a shape outside the slide' : sz < 200 ? `${sz / 100}-point text` : alpha < 5000 ? 'transparent text' : fill && isWhite(fill[1]) ? 'white text' : /<a:noFill\/>/.test(rpr?.[2] || '') ? 'text without fill' : '';
        chunks.push({ text: text + ' ', hidden, para: n });
      }
    }
    parts.push({ label: `slide ${n}`, chunks });
    // speaker notes: never on the slide, read by every tool that ingests the deck
    const slideRels = rels(await zip.text(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')));
    const notes = Object.values(slideRels).find((t) => /notesSlide/.test(t));
    const nx = notes && (await zip.text(resolvePath(path, notes)));
    if (nx) {
      const text = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => decodeEntities(x[1])).join(' ').trim();
      if (text && !/^\d+$/.test(text)) parts.push({ label: `slide ${n} notes`, chunks: [{ text, hidden: 'speaker notes', para: n }] });
    }
  }
  const comments = [];
  for (const name of zip.names.filter((x) => /^ppt\/comments\/[^/]+\.xml$/i.test(x))) {
    const x = await zip.text(name);
    for (const m of x.matchAll(/<p:text>([\s\S]*?)<\/p:text>|<p188:txBody>([\s\S]*?)<\/p188:txBody>/g)) comments.push({ author: '', text: xmlText(m[1] || m[2] || '') });
  }
  if (!parts.length) warnings.push('no slides found');
  return { parts, meta: await officeProps(zip), comments, annotations: [], warnings };
}

// ── OpenDocument (odt / ods / odp) ──

export async function readOdf(bytes) {
  const zip = openZip(bytes);
  const content = (await zip.text('content.xml')) || '';
  const styles = ((await zip.text('styles.xml')) || '') + content;
  const hiddenStyle = new Map();
  for (const m of styles.matchAll(/<style:style\b([^>]*)>([\s\S]*?)<\/style:style>/g)) {
    const name = /style:name="([^"]*)"/.exec(m[1])?.[1];
    const p = m[2];
    const size = /fo:font-size="([\d.]+)pt"/.exec(p)?.[1];
    const why = /text:display="none"/.test(p) ? 'display: none' : isWhite(/fo:color="#([0-9a-fA-F]{6})"/.exec(p)?.[1]) ? 'white text' : size && Number(size) < 2 ? `${size}-point text` : /style:text-opacity="0%"|fo:opacity="0%"/.test(p) ? 'transparent text' : '';
    if (name && why) hiddenStyle.set(name, why);
  }
  const chunks = [];
  const comments = [];
  const stack = [];
  let para = 0;
  let inNote = 0;
  let noteText = '';
  for (const t of xmlTokens(content)) {
    if (t.type === 'open' || t.type === 'empty') {
      if (t.name === 'office:annotation') {
        inNote++;
        noteText = '';
      }
      if (/^text:(?:p|h)$/.test(t.name) && t.type === 'open') para++;
      let why = '';
      if (t.name === 'text:hidden-paragraph' || t.name === 'text:hidden-text') why = 'hidden text field';
      else if (t.attrs?.['text:is-hidden'] === 'true') why = 'hidden section';
      else if (t.attrs?.['table:visibility'] === 'collapse' || t.attrs?.['table:visibility'] === 'filter') why = 'hidden row or column';
      else if (t.name === 'table:table' && t.attrs?.['table:display'] === 'false') why = 'on a hidden sheet';
      else if (t.attrs?.['presentation:visibility'] === 'hidden' || t.attrs?.['draw:display'] === 'none') why = 'hidden shape or slide';
      else why = hiddenStyle.get(t.attrs?.['text:style-name'] || t.attrs?.['draw:text-style-name'] || t.attrs?.['table:style-name'] || '') || '';
      if (t.type === 'open') stack.push({ name: t.name, why });
      else if (why && t.attrs?.['text:string-value']) chunks.push({ text: t.attrs['text:string-value'] + ' ', hidden: why, para });
    } else if (t.type === 'close') {
      if (t.name === 'office:annotation') {
        inNote--;
        if (noteText.trim()) comments.push({ author: '', text: noteText.trim() });
      }
      const i = stack.map((s) => s.name).lastIndexOf(t.name);
      if (i >= 0) stack.length = i;
    } else if (t.type === 'text') {
      if (inNote) noteText += t.text;
      else if (t.text.trim()) chunks.push({ text: t.text, hidden: [...stack].reverse().find((s) => s.why)?.why || '', para });
    }
  }
  const metaXml = (await zip.text('meta.xml')) || '';
  const meta = [];
  for (const f of ['dc:title', 'dc:subject', 'dc:description', 'meta:keyword', 'meta:user-defined']) for (const m of metaXml.matchAll(new RegExp(`<${f}\\b([^>]*)>([\\s\\S]*?)</${f}>`, 'g'))) meta.push({ field: /meta:name="([^"]*)"/.exec(m[1])?.[1] || f.replace(/^\w+:/, ''), value: decodeEntities(m[2]) });
  return { parts: [{ label: 'body', chunks }], meta, comments, annotations: [], warnings: content ? [] : ['no content.xml'] };
}

// ── RTF ──

export function readRtf(bytes) {
  const s = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  const colors = [];
  const tbl = /\{\\colortbl;?([^}]*)\}/.exec(s);
  if (tbl) for (const c of tbl[1].split(';')) colors.push([+(/\\red(\d+)/.exec(c)?.[1] || 0), +(/\\green(\d+)/.exec(c)?.[1] || 0), +(/\\blue(\d+)/.exec(c)?.[1] || 0)]);
  if (tbl && !/^\s*;/.test(tbl[1])) colors.unshift(null); // index 0 = auto when the table starts with ";"
  const chunks = [];
  const meta = [];
  const comments = [];
  const stack = [];
  let st = { v: false, cf: 0, fs: 24, skip: false, dest: '' };
  let para = 1;
  let uc = 1;
  let buf = '';
  let destText = '';
  const flush = () => {
    if (!buf) return;
    const col = colors[st.cf];
    const hidden = st.v ? 'hidden text (\\v)' : col && col.every((x) => x >= 245) ? 'white text' : st.fs < 4 ? `${st.fs / 2}-point text` : '';
    chunks.push({ text: buf, hidden, para });
    buf = '';
  };
  const emit = (ch) => {
    if (st.dest) destText += ch;
    else if (!st.skip) buf += ch;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      flush();
      stack.push(st);
      st = { ...st };
      if (s.startsWith('{\\*', i)) {
        const word = /^\{\\\*\\([a-z]+)/.exec(s.slice(i, i + 40))?.[1] || '';
        if (word === 'annotation') {
          st.dest = 'annotation';
          destText = '';
        } else st.skip = true;
      }
      const w = /^\{\\(title|subject|author|keywords|doccomm|operator|category|comment)\b/.exec(s.slice(i, i + 20))?.[1];
      if (w) {
        st.dest = 'info:' + w;
        destText = '';
      } else if (/^\{\\(fonttbl|colortbl|stylesheet|pict|header|footer|info|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore)\b/.test(s.slice(i, i + 24)) && !/^\{\\(header|footer)/.test(s.slice(i, i + 10))) st.skip = true;
    } else if (c === '}') {
      flush();
      if (st.dest && st.dest !== (stack.at(-1)?.dest || '')) {
        if (st.dest === 'annotation') destText.trim() && comments.push({ author: '', text: destText.trim() });
        else if (st.dest.startsWith('info:')) destText.trim() && meta.push({ field: st.dest.slice(5), value: destText.trim() });
      }
      st = stack.pop() || st;
    } else if (c === '\\') {
      const m = /^\\(?:([a-z]{1,32})(-?\d{1,10})? ?|'([0-9a-f]{2})|(.))/i.exec(s.slice(i, i + 48));
      if (!m) continue;
      i += m[0].length - 1;
      if (m[3]) emit(String.fromCharCode(parseInt(m[3], 16)));
      else if (m[4]) emit(m[4] === '~' ? '\u{A0}' : /[\\{}]/.test(m[4]) ? m[4] : '');
      else {
        const word = m[1];
        const n = m[2] === undefined ? null : Number(m[2]);
        if (word === 'v') {
          flush();
          st.v = n !== 0;
        } else if (word === 'cf') {
          flush();
          st.cf = n || 0;
        } else if (word === 'fs') {
          flush();
          st.fs = n ?? 24;
        } else if (word === 'plain') {
          flush();
          st = { ...st, v: false, cf: 0, fs: 24 };
        } else if (word === 'par' || word === 'line') {
          emit('\n');
          if (word === 'par') {
            flush();
            para++;
          }
        } else if (word === 'tab') emit('\t');
        else if (word === 'uc') uc = n ?? 1;
        else if (word === 'u') {
          emit(String.fromCharCode(n < 0 ? n + 65536 : n));
          i += uc; // skip the fallback character(s)
        }
      }
    } else if (c !== '\r' && c !== '\n') emit(c);
  }
  flush();
  return { parts: [{ label: 'body', chunks }], meta, comments, annotations: [], warnings: [] };
}

// ── image metadata ──

const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/** Text fields of an image's metadata: [{ field, value }]. */
export async function readImageMeta(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const meta = [];
  const latin = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  const add = (field, value) => {
    const v = String(value || '').replace(/\u0000+$/g, '').trim();
    if (v) meta.push({ field, value: v.length > 20000 ? v.slice(0, 20000) : v });
  };
  const xmp = (xml, where) => {
    for (const m of xml.matchAll(/<(dc:description|dc:title|dc:subject|xmp:Label|photoshop:Headline|photoshop:Instructions|Iptc4xmpCore:ExtDescrAccessibility|Iptc4xmpCore:AltTextAccessibility|exif:UserComment|tiff:ImageDescription|xmpRights:UsageTerms)\b[^>]*>([\s\S]*?)<\/\1>/g)) add(`${where} ${m[1]}`, xmlText(m[2]));
    for (const m of xml.matchAll(/\b(dc:description|dc:title|photoshop:Instructions|photoshop:Headline)="([^"]*)"/g)) add(`${where} ${m[1]}`, decodeEntities(m[2]));
  };
  const exif = (t, where) => {
    // TIFF header, IFD0 and the Exif sub-IFD: descriptions, comments, artist, copyright, XP* (UTF-16)
    if (t.length < 8) return;
    const le = t[0] === 0x49;
    const u16 = (o) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
    const u32 = (o) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : u32be(t, o));
    const TAGS = { 0x010e: 'ImageDescription', 0x013b: 'Artist', 0x8298: 'Copyright', 0x9286: 'UserComment', 0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject', 0x010d: 'DocumentName' };
    const seen = new Set();
    const ifd = (off) => {
      if (!off || off + 2 > t.length || seen.has(off)) return;
      seen.add(off);
      const n = u16(off);
      for (let k = 0; k < n && off + 2 + k * 12 + 12 <= t.length; k++) {
        const e = off + 2 + k * 12;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        if (tag === 0x8769) ifd(u32(e + 8));
        if (!TAGS[tag]) continue;
        const size = count * ({ 1: 1, 2: 1, 7: 1, 3: 2, 4: 4 }[type] || 1);
        const at = size <= 4 ? e + 8 : u32(e + 8);
        const raw = t.subarray(at, Math.min(t.length, at + Math.min(size, 65536)));
        let value;
        if (tag >= 0x9c9b && tag <= 0x9c9f) value = new TextDecoder('utf-16le').decode(raw);
        else if (tag === 0x9286) {
          const code = latin.decode(raw.subarray(0, 8));
          value = /^UNICODE/.test(code) ? new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(raw.subarray(8)) : utf8.decode(raw.subarray(8));
        } else value = utf8.decode(raw);
        add(`${where} EXIF ${TAGS[tag]}`, value);
      }
    };
    ifd(u32(4));
  };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    for (let p = 8; p + 12 <= b.length; ) {
      const len = u32be(b, p);
      const type = latin.decode(b.subarray(p + 4, p + 8));
      const data = b.subarray(p + 8, Math.min(b.length, p + 8 + len));
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        add(`PNG ${latin.decode(data.subarray(0, z))}`, latin.decode(data.subarray(z + 1)));
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        try {
          add(`PNG ${latin.decode(data.subarray(0, z))}`, latin.decode(await inflate(data.subarray(z + 2))));
        } catch {
          /* damaged */
        }
      } else if (type === 'iTXt') {
        const z = data.indexOf(0);
        const key = latin.decode(data.subarray(0, z));
        const compressed = data[z + 1] === 1;
        let q = z + 3;
        q = data.indexOf(0, q) + 1; // language
        q = data.indexOf(0, q) + 1; // translated keyword
        let text = data.subarray(q);
        if (compressed) {
          try {
            text = await inflate(text);
          } catch {
            text = new Uint8Array(0);
          }
        }
        const s = utf8.decode(text);
        if (key === 'XML:com.adobe.xmp') xmp(s, 'PNG XMP');
        else add(`PNG ${key}`, s);
      } else if (type === 'eXIf') exif(data, 'PNG');
      else if (type === 'IEND') break;
      p += 12 + len;
    }
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    for (let p = 2; p + 4 <= b.length; ) {
      if (b[p] !== 0xff) break;
      const marker = b[p + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = (b[p + 2] << 8) | b[p + 3];
      const data = b.subarray(p + 4, Math.min(b.length, p + 2 + len));
      if (marker === 0xe1) {
        const head = latin.decode(data.subarray(0, 32));
        if (head.startsWith('Exif\u0000')) exif(data.subarray(6), 'JPEG');
        else if (head.startsWith('http://ns.adobe.com/xap/1.0/')) xmp(utf8.decode(data.subarray(data.indexOf(0) + 1)), 'JPEG XMP');
      } else if (marker === 0xfe) add('JPEG comment', utf8.decode(data));
      p += 2 + len;
    }
  } else if (latin.decode(b.subarray(0, 4)) === 'RIFF' && latin.decode(b.subarray(8, 12)) === 'WEBP') {
    for (let p = 12; p + 8 <= b.length; ) {
      const type = latin.decode(b.subarray(p, p + 4));
      const len = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
      const data = b.subarray(p + 8, Math.min(b.length, p + 8 + len));
      if (type === 'XMP ') xmp(utf8.decode(data), 'WebP XMP');
      else if (type === 'EXIF') exif(latin.decode(data.subarray(0, 6)) === 'Exif\u0000\u0000' ? data.subarray(6) : data, 'WebP');
      p += 8 + len + (len & 1);
    }
  } else if (latin.decode(b.subarray(0, 4)) === 'GIF8') {
    for (let p = 0; p + 2 < b.length; p++) {
      if (b[p] === 0x21 && b[p + 1] === 0xfe) {
        let q = p + 2;
        let text = '';
        while (q < b.length && b[q]) {
          text += latin.decode(b.subarray(q + 1, q + 1 + b[q]));
          q += 1 + b[q];
        }
        add('GIF comment', text);
        p = q;
      }
    }
  }
  return { parts: [], meta, comments: [], annotations: [], warnings: [] };
}
