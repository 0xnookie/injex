// Optional OCR pack: read the text in images, screenshots and scanned PDF pages with Tesseract.js (bundled in
// the plus builds under vendor/packs/ocr/, fetched by tools/fetch-packs.mjs — never from a CDN at run time).
// What it adds to a scan:
//   image-text   text a vision model reads in an image that text extraction never sees (a screenshot's
//                text that is not in the page's DOM, a scanned page) — reported when it reads like
//                instructions
//   image-faint  text only visible after the image is contrast-enhanced: near-background colours that a
//                person overlooks and a model may still read ("faint-text differencing": OCR the image and
//                a copy where every pixel slightly off the background turns black, and keep the words
//                that only the copy has)
// The pixel maths and the comparison are pure functions (tested in Node); recognising needs a DOM.

import { looksLikeInstructions } from './scan.js';
import { packsAllowed } from './packs.js';

const PACK_DIR = 'vendor/packs/ocr/';

/** The pack's base URL inside the extension (or next to this module). */
export function ocrBase() {
  try {
    if (globalThis.chrome?.runtime?.getURL) return chrome.runtime.getURL(PACK_DIR);
  } catch {
    /* not an extension page */
  }
  return new URL('../../' + PACK_DIR, import.meta.url).href;
}

/** Whether this build has the OCR pack. */
export async function ocrAvailable() {
  if (!packsAllowed()) return false;
  try {
    const r = await fetch(ocrBase() + 'tesseract.min.js', { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

// ── pure parts ──

/**
 * A copy of an RGBA image in which every pixel that differs only slightly from the background (the most
 * common grey level) is black and everything else white — near-invisible text becomes black on white,
 * ordinary content disappears or keeps only its anti-aliased outline. → { pixels, background, revealed }
 * (revealed: the share of pixels turned black).
 */
export function revealPixels(rgba, width, height, { min = 4, max = 64 } = {}) {
  const n = width * height;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const l = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    lum[i] = l;
    hist[l]++;
  }
  let background = 0;
  for (let l = 1; l < 256; l++) if (hist[l] > hist[background]) background = l;
  // the anti-aliased edges of ordinary (high-contrast) content are slightly off the background too: a pixel
  // next to a strong one does not count, so visible text leaves no outline in the copy
  const strong = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(lum[i] - background) > max) strong[i] = 1;
  const nearStrong = (i) => {
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < width && strong[yy * width + xx]) return true;
      }
    }
    return false;
  };
  const out = new Uint8ClampedArray(n * 4);
  let black = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(lum[i] - background);
    const v = d >= min && d <= max && !nearStrong(i) ? 0 : 255;
    if (!v) black++;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { pixels: out, background, revealed: n ? black / n : 0 };
}

const norm = (w) => String(w).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

/** Lines (from the OCR blocks) as [{ text, words: [{ text, confidence }] }]. */
export function linesOf(data) {
  const out = [];
  for (const b of data?.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push({ text: String(l.text || '').trim(), words: (l.words || []).map((w) => ({ text: w.text, confidence: w.confidence ?? 0 })) });
  if (!out.length && data?.text) for (const t of String(data.text).split('\n')) if (t.trim()) out.push({ text: t.trim(), words: t.trim().split(/\s+/).map((w) => ({ text: w, confidence: 90 })) });
  return out;
}

/**
 * Faint-text differencing: the lines of the revealed copy whose words mostly do not occur in the original
 * reading (or in `known`, e.g. the page's DOM text). Words need confidence ≥ minConf and two letters.
 */
export function faintLines(originalText, revealed, { minConf = 55, known = '' } = {}) {
  const seen = new Set(`${originalText} ${known}`.split(/\s+/).map(norm).filter(Boolean));
  const out = [];
  for (const l of revealed) {
    const words = l.words.filter((w) => norm(w.text).length >= 2 && w.confidence >= minConf);
    if (words.length < 2) continue;
    const fresh = words.filter((w) => !seen.has(norm(w.text)));
    if (fresh.length >= Math.max(2, Math.ceil(words.length * 0.6))) out.push(words.map((w) => w.text).join(' '));
  }
  return out;
}

/** Lines of `text` (an OCR reading) that `known` (e.g. the DOM text) does not contain. */
export function unseenLines(text, known) {
  const k = new Set(String(known).split(/\s+/).map(norm).filter(Boolean));
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      const ws = l.split(/\s+/).map(norm).filter((w) => w.length >= 2);
      return ws.length >= 3 && ws.filter((w) => !k.has(w)).length >= Math.ceil(ws.length * 0.6);
    });
}

/**
 * Scan findings from one OCR reading. r: { text, faint: [lines], unseen?: [lines] }; where: "image", "page 3
 * image", "screenshot". Visible text is reported only when it reads like instructions; faint text always.
 */
export function ocrFindings(r, { where = 'image', loc = 'ocr', source = r.unseen ? 'screenshot' : 'image' } = {}) {
  const findings = [];
  const faint = (r.faint || []).join('\n').trim();
  if (faint) {
    const instr = looksLikeInstructions(faint);
    findings.push({ kind: 'image-faint', severity: instr ? 'high' : 'medium', count: faint.length, payload: faint.slice(0, 4000), instructions: instr, note: 'text in a colour barely different from the background — only visible after contrast enhancement', where, loc, ctx: { before: '', match: faint.slice(0, 160), after: '' } });
  }
  const visible = (r.unseen || [r.text || '']).join('\n').trim();
  if (visible && looksLikeInstructions(visible)) findings.push({ kind: 'image-text', severity: 'medium', count: visible.length, payload: visible.slice(0, 4000), instructions: true, note: { screenshot: 'text a screenshot shows that the page’s text does not contain (an image or canvas) — and it reads like instructions', pdf: 'text in a page image that the PDF’s text layer does not contain (a scan) — and it reads like instructions', image: 'text in the image (what a vision model reads) that reads like instructions' }[source] || 'text in an image that reads like instructions', where, loc, ctx: { before: '', match: visible.slice(0, 160), after: '' } });
  return findings;
}

// ── recognition (DOM) ──

let tesseract = null;
let worker = null;

function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  tesseract ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ocrBase() + 'tesseract.min.js';
    s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('the OCR pack did not load')));
    s.onerror = () => reject(new Error('this build has no OCR pack (the plus build has one)'));
    document.head.append(s);
  });
  return tesseract;
}

async function getWorker(onProgress) {
  if (worker) return worker;
  const T = await loadTesseract();
  const base = ocrBase();
  let failed;
  const fail = new Promise((_, reject) => (failed = reject));
  const timer = setTimeout(() => failed(new Error('the OCR engine did not start — WebAssembly may be blocked in this build (the plus build allows it)')), 60000);
  try {
    worker = await Promise.race([
      T.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'tesseract-core-simd-lstm.wasm.js',
        langPath: base + 'lang',
        workerBlobURL: false, // extension pages don't run blob: workers
        cacheMethod: 'none',
        gzip: true,
        logger: (m) => onProgress?.(m),
        errorHandler: (e) => failed(new Error(`OCR engine: ${e?.message || e}`)),
      }),
      fail,
    ]);
  } finally {
    clearTimeout(timer);
  }
  return worker;
}

/** Free the worker (about 150 MB). */
export async function ocrStop() {
  const w = worker;
  worker = null;
  await w?.terminate();
}

/** Something drawable → a canvas no larger than maxSide (small images are scaled up for OCR). */
async function toCanvas(src, maxSide = 3000) {
  let bmp;
  if (src instanceof Blob) bmp = await createImageBitmap(src);
  else if (typeof src === 'string') bmp = await createImageBitmap(await (await fetch(src)).blob());
  else if (src?.raw) {
    const { width, height, channels, pixels } = src.raw;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += channels) {
      rgba[i * 4] = pixels[j];
      rgba[i * 4 + 1] = pixels[channels >= 3 ? j + 1 : j];
      rgba[i * 4 + 2] = pixels[channels >= 3 ? j + 2 : j];
      rgba[i * 4 + 3] = 255;
    }
    bmp = await createImageBitmap(new ImageData(rgba, width, height));
  } else bmp = src;
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = Math.min(maxSide / Math.max(w0, h0), w0 < 900 ? 2 : 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * scale));
  c.height = Math.max(1, Math.round(h0 * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/**
 * Read an image (Blob, data URL, ImageBitmap / canvas, or { raw: { width, height, channels, pixels } }):
 * → { text, confidence, faint: [lines], unseen?: [lines], background, revealed }. known: text the reader
 * already has (the page's DOM text) — then `unseen` lists what only the image shows.
 */
export async function ocrImage(src, { known, onProgress } = {}) {
  const w = await getWorker(onProgress);
  const canvas = await toCanvas(src);
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const rv = revealPixels(img.data, canvas.width, canvas.height);
  let faint = [];
  // nothing slightly off the background (or noise everywhere, as in a photo): no second reading
  if (rv.revealed > 0.0005 && rv.revealed < 0.25) {
    const c2 = document.createElement('canvas');
    c2.width = canvas.width;
    c2.height = canvas.height;
    c2.getContext('2d').putImageData(new ImageData(rv.pixels, canvas.width, canvas.height), 0, 0);
    const second = (await w.recognize(c2, {}, { text: true, blocks: true })).data;
    faint = faintLines(data.text, linesOf(second), { known });
  }
  return { text: String(data.text || '').trim(), confidence: data.confidence, faint, ...(known !== undefined ? { unseen: unseenLines(data.text, known) } : {}), background: rv.background, revealed: rv.revealed };
}
