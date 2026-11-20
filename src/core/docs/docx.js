// Word (.docx) reader for hidden text: every run of text with the reason a reader can't see it —
// formatted hidden, white or transparent, the same colour as its shading or the page, or tiny —
// resolved through document defaults, paragraph and character styles. Also headers, footers, notes,
// text boxes, comments, tracked deletions, document properties and custom XML.

import { openZip } from './zip.js';
import { xmlTokens, xmlText } from './xml.js';

const W = 'w:';
const HIGHLIGHT = { black: '000000', white: 'FFFFFF', yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0' };
const on = (a) => !a || !/^(0|false|off)$/i.test(a[W + 'val'] ?? '');

const rgb = (hex) => (/^[0-9a-f]{6}$/i.test(hex || '') ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) : null);
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Run properties from the children of a <w:rPr>. */
function readRPr(tokens) {
  const p = {};
  for (const t of tokens) {
    if (t.type !== 'open' && t.type !== 'empty') continue;
    const a = t.attrs;
    switch (t.name) {
      case 'w:vanish':
      case 'w:specVanish':
        p.vanish = on(a);
        break;
      case 'w:webHidden':
        p.webHidden = on(a);
        break;
      case 'w:color':
        if (a['w:val']) p.color = a['w:val'];
        break;
      case 'w:sz':
        if (a['w:val']) p.sz = Number(a['w:val']);
        break;
      case 'w:shd':
        if (a['w:fill'] && a['w:fill'] !== 'auto') p.shd = a['w:fill'];
        break;
      case 'w:highlight':
        if (a['w:val'] && a['w:val'] !== 'none') p.highlight = HIGHLIGHT[a['w:val']] || null;
        break;
      case 'w:rStyle':
        p.rStyle = a['w:val'];
        break;
      case 'w14:srgbClr':
        p.fill = a['w14:val'];
        break;
      case 'w14:alpha':
        p.alpha = Number(a['w14:val']); // 0 = opaque, 100000 = fully transparent
        break;
      case 'w14:noFill':
        p.noFill = true;
        break;
      default:
    }
  }
  return p;
}

/** styles.xml → { defaults: rPr, styles: { id: { type, basedOn, rPr, isDefault } } } */
function readStyles(xml) {
  const styles = {};
  let defaults = {};
  if (!xml) return { defaults, styles };
  let cur = null;
  let inDefaults = false;
  let collecting = null;
  for (const t of xmlTokens(xml)) {
    if (t.type === 'open' && t.name === 'w:rPrDefault') inDefaults = true;
    else if (t.type === 'close' && t.name === 'w:rPrDefault') inDefaults = false;
    else if (t.type === 'open' && t.name === 'w:style') cur = { id: t.attrs['w:styleId'], type: t.attrs['w:type'], isDefault: on({ 'w:val': t.attrs['w:default'] || '0' }), rPr: {} };
    else if (t.type === 'close' && t.name === 'w:style') {
      if (cur?.id) styles[cur.id] = cur;
      cur = null;
    } else if (cur && (t.type === 'empty' || t.type === 'open') && t.name === 'w:basedOn') cur.basedOn = t.attrs['w:val'];
    else if (t.type === 'open' && t.name === 'w:rPr' && (cur || inDefaults)) collecting = [];
    else if (t.type === 'close' && t.name === 'w:rPr' && collecting) {
      const p = readRPr(collecting);
      if (cur) cur.rPr = p;
      else defaults = p;
      collecting = null;
    } else if (collecting) collecting.push(t);
  }
  return { defaults, styles };
}

function styleChain(styles, id, seen = new Set()) {
  const s = styles[id];
  if (!s || seen.has(id)) return {};
  seen.add(id);
  return { ...styleChain(styles, s.basedOn, seen), ...s.rPr };
}

/** Why a run with these effective properties can't be seen ('' if it can). */
function hiddenReason(p, pageBg) {
  if (p.vanish) return 'formatted as hidden text';
  if (p.webHidden) return 'hidden in web layout';
  if (p.noFill || (p.alpha !== undefined && p.alpha >= 95000)) return 'fully transparent text';
  if (p.sz !== undefined && p.sz > 0 && p.sz <= 2) return `tiny text (${p.sz / 2} pt)`;
  const color = rgb(p.fill) || (p.color && p.color !== 'auto' ? rgb(p.color) : [0, 0, 0]);
  const bg = rgb(p.highlight) || rgb(p.shd) || pageBg;
  if (color && bg && dist(color, bg) < 0.07) return bg.every((v) => v > 0.93) ? 'white text on a white page' : 'text in the same colour as its background';
  return '';
}

/** One XML part → [{ text, hidden, deleted, para }] (para = paragraph number in the part). */
function readPart(xml, styles, pageBg) {
  const chunks = [];
  const stack = [];
  let para = 0;
  const paras = []; // paragraph style per open <w:p> (text boxes nest paragraphs inside runs)
  const runs = []; // run properties per open <w:r>
  let rPrTokens = null;
  let inDel = 0;
  let fallback = 0; // <mc:Fallback> repeats a text box for old readers: skip it
  let textKind = null;
  const defaultPara = Object.values(styles.styles).find((s) => s.type === 'paragraph' && s.isDefault)?.id;
  const effective = () => {
    const run = runs.at(-1) || {};
    return {
      ...styles.defaults,
      ...styleChain(styles.styles, paras.at(-1)?.style || defaultPara),
      ...(run.rStyle ? styleChain(styles.styles, run.rStyle) : {}),
      ...run,
    };
  };
  const emit = (text, deleted = false) => chunks.push({ text, hidden: hiddenReason(effective(), pageBg), deleted, para });
  for (const t of xmlTokens(xml)) {
    if (t.type === 'open' || t.type === 'empty') {
      if (t.name === 'mc:Fallback' && t.type === 'open') fallback++;
      if (fallback) {
        if (t.type === 'open') stack.push(t.name);
        continue;
      }
    }
    if (t.type === 'open') {
      const parent = stack.at(-1);
      stack.push(t.name);
      if (rPrTokens) rPrTokens.push(t);
      else if (t.name === 'w:p') {
        para++;
        paras.push({ style: null });
      } else if (t.name === 'w:r') runs.push({});
      else if (t.name === 'w:rPr' && parent === 'w:r') rPrTokens = [];
      else if (t.name === 'w:del' || t.name === 'w:moveFrom') inDel++;
      else if (t.name === 'w:t' || t.name === 'w:delText' || t.name === 'w:instrText') textKind = t.name;
    } else if (t.type === 'empty') {
      if (rPrTokens) rPrTokens.push(t);
      else if (t.name === 'w:pStyle' && stack.at(-1) === 'w:pPr' && paras.length) paras.at(-1).style = t.attrs['w:val'];
      else if (runs.length && (t.name === 'w:tab' || t.name === 'w:ptab')) emit('\t', inDel > 0);
      else if (runs.length && (t.name === 'w:br' || t.name === 'w:cr')) emit('\n', inDel > 0);
    } else if (t.type === 'close') {
      stack.pop();
      if (fallback) {
        if (t.name === 'mc:Fallback') fallback--;
        continue;
      }
      if (t.name === 'w:rPr' && rPrTokens) {
        if (runs.length) runs[runs.length - 1] = readRPr(rPrTokens);
        rPrTokens = null;
      } else if (rPrTokens) rPrTokens.push(t);
      else if (t.name === 'w:r') runs.pop();
      else if (t.name === 'w:p') {
        paras.pop();
        chunks.push({ text: '\n', hidden: '', deleted: false, para });
      } else if (t.name === 'w:del' || t.name === 'w:moveFrom') inDel--;
      else if (t.name === textKind) textKind = null;
    } else if (t.type === 'text' && textKind && runs.length && !fallback) {
      if (textKind !== 'w:instrText') emit(t.text, inDel > 0 || textKind === 'w:delText');
    }
  }
  return chunks;
}

const PART_LABEL = (name) => {
  if (name === 'word/document.xml') return 'body';
  const m = name.match(/word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/);
  return m ? { header: 'header', footer: 'footer', footnotes: 'footnote', endnotes: 'endnote', comments: 'comment' }[m[1]] : name;
};

/**
 * Read a .docx. Returns { type: 'docx', parts: [{ name, label, chunks }], comments: [{ author, text }],
 * meta: [{ field, value }] }.
 */
export async function readDocx(bytes) {
  const zip = openZip(bytes);
  if (!zip.has('word/document.xml')) throw new Error('not a Word document (no word/document.xml)');
  const styles = readStyles(await zip.text('word/styles.xml'));
  const doc = await zip.text('word/document.xml');
  const bg = doc.match(/<w:background\b[^>]*w:color="([0-9A-Fa-f]{6})"/);
  const pageBg = rgb(bg?.[1]) || [1, 1, 1];
  const names = ['word/document.xml', ...zip.names.filter((n) => /^word\/(header|footer)\d*\.xml$|^word\/(footnotes|endnotes)\.xml$/.test(n)).sort()];
  const parts = [];
  for (const name of names) parts.push({ name, label: PART_LABEL(name), chunks: readPart(name === 'word/document.xml' ? doc : await zip.text(name), styles, pageBg) });

  const comments = [];
  const cx = await zip.text('word/comments.xml');
  if (cx) {
    for (const m of cx.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
      const author = m[1].match(/w:author="([^"]*)"/)?.[1] || '';
      const text = readPart(m[2], styles, pageBg)
        .filter((c) => !c.deleted)
        .map((c) => c.text)
        .join('')
        .trim();
      if (text) comments.push({ author, text });
    }
  }

  const meta = [];
  const core = await zip.text('docProps/core.xml');
  if (core) for (const m of core.matchAll(/<(dc:title|dc:subject|dc:creator|dc:description|cp:keywords|cp:category|cp:lastModifiedBy|cp:contentStatus)\b[^>]*>([\s\S]*?)<\/\1>/g)) meta.push({ field: m[1].split(':')[1], value: xmlText(m[2]) });
  const app = await zip.text('docProps/app.xml');
  if (app) for (const m of app.matchAll(/<(Company|Manager|Template)\b[^>]*>([\s\S]*?)<\/\1>/g)) meta.push({ field: m[1], value: xmlText(m[2]) });
  const custom = await zip.text('docProps/custom.xml');
  if (custom) for (const m of custom.matchAll(/<property\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) meta.push({ field: m[1], value: xmlText(m[2]) });
  for (const n of zip.names.filter((x) => /^customXml\/item\d+\.xml$/.test(x))) {
    const v = xmlText(await zip.text(n));
    if (v) meta.push({ field: n, value: v.slice(0, 20000) });
  }
  return { type: 'docx', parts, comments, meta: meta.filter((m) => m.value) };
}
