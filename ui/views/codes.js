// Codes: QR and barcodes from text, and decoding them from an image. All libraries are bundled (vendor/codes).

import { $, h, debounce, seg, clip, mini, loadScript, keepDraft, setValue, download } from '../lib.js';

let ctx;
let mode;
let canvas = null;
const o = { format: 'qr', ecl: 'M', scale: 8, margin: 2, height: 80, width: 2, text: true };

const FORMATS = {
  qr: { label: 'QR code' },
  CODE128: { label: 'Code 128', hint: 'Any ASCII text' },
  EAN13: { label: 'EAN-13', hint: '12 or 13 digits' },
  CODE39: { label: 'Code 39', hint: 'A–Z, 0–9, space and - . $ / + %' },
};

const lib = (name, global) => loadScript(ctx.vendorBase + 'codes/' + name, global);

function form() {
  const f = $('cForm');
  f.textContent = '';
  const field = (label, control, hint) => h('div', { class: 'field' }, h('label', { text: label }), control, hint ? h('small', { text: hint }) : null);
  const sel = (key, options) => h('select', { onchange: (e) => ((o[key] = e.target.value), key === 'format' && form(), draw()) }, Object.entries(options).map(([v, l]) => h('option', { value: v, text: l, selected: String(o[key]) === v })));
  const num = (key, min, max) => h('input', { type: 'number', min, max, value: o[key], oninput: (e) => ((o[key] = Number(e.target.value)), draw()) });
  f.append(field('Format', sel('format', Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label]))), FORMATS[o.format].hint));
  if (o.format === 'qr') {
    f.append(field('Error correction', sel('ecl', { L: 'L — 7 %', M: 'M — 15 %', Q: 'Q — 25 %', H: 'H — 30 %' })), field('Module size (px)', num('scale', 2, 20)), field('Quiet zone (modules)', num('margin', 0, 10)));
  } else {
    f.append(field('Bar height (px)', num('height', 20, 300)), field('Bar width (px)', num('width', 1, 6)), h('div', { class: 'field inline' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: o.text, onchange: (e) => ((o.text = e.target.checked), draw()) }), 'Show text')));
  }
}

async function draw() {
  const text = $('cIn').value;
  const box = $('cPreview');
  box.textContent = '';
  canvas = null;
  $('cMeta').textContent = '';
  if (!text) {
    box.append(h('span', { style: 'color: #737373', text: 'Type something to encode' }));
    return;
  }
  const c = document.createElement('canvas');
  try {
    if (o.format === 'qr') {
      const QR = await lib('qrcode.min.js', 'QRCode');
      await QR.toCanvas(c, text, { errorCorrectionLevel: o.ecl, scale: o.scale, margin: o.margin, color: { dark: '#000000', light: '#ffffff' } });
      const q = QR.create(text, { errorCorrectionLevel: o.ecl });
      $('cMeta').textContent = `version ${q.version} · ${q.modules.size}×${q.modules.size} modules`;
    } else {
      const JsBarcode = await lib('JsBarcode.min.js', 'JsBarcode');
      let valid = true;
      JsBarcode(c, text, { format: o.format, height: o.height, width: o.width, displayValue: o.text, margin: 10, font: 'JetBrains Mono, monospace', valid: (v) => (valid = v) });
      if (!valid) throw new Error(`Not valid for ${FORMATS[o.format].label}${FORMATS[o.format].hint ? ' — ' + FORMATS[o.format].hint : ''}`);
      $('cMeta').textContent = `${c.width}×${c.height} px`;
    }
  } catch (e) {
    box.append(h('span', { style: 'color: #d33', text: e.message || String(e) }));
    return;
  }
  canvas = c;
  box.append(c);
}

function blob() {
  return new Promise((r) => canvas.toBlob(r, 'image/png'));
}

// ── decode ──

async function readImage(file) {
  const res = $('cResult');
  res.textContent = '';
  if (!file || !file.type.startsWith('image/')) return ctx.toast('That is not an image', true);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    return ctx.toast('Could not read the image', true);
  }
  const drop = $('cDrop');
  drop.querySelector('img')?.remove();
  drop.prepend(h('img', { src: url, alt: '' }));
  let text = null;
  let format = '';
  try {
    if ('BarcodeDetector' in globalThis) {
      const found = await new globalThis.BarcodeDetector().detect(img);
      if (found.length) [text, format] = [found[0].rawValue, found[0].format];
    }
  } catch {
    /* fall back to ZXing */
  }
  if (text === null) {
    try {
      const ZXing = await lib('zxing.min.js', 'ZXing');
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const source = new ZXing.HTMLCanvasElementLuminanceSource(c);
      const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
      const r = new ZXing.MultiFormatReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source)), hints);
      text = r.getText();
      format = ZXing.BarcodeFormat[r.getBarcodeFormat()] || '';
    } catch {
      text = null;
    }
  }
  if (text === null) {
    res.append(h('div', { class: 'card warn', style: 'margin-top: 12px' }, h('b', { text: 'No code found' }), h('div', { class: 'hint', text: 'Try a sharper or larger image, with the whole code visible.' })));
    return;
  }
  res.append(
    h(
      'div',
      { class: 'card hl', style: 'margin-top: 12px' },
      h('div', { class: 'card-head' }, h('b', { text: 'Decoded' }), h('span', { class: 'chip ok', text: String(format).replace(/_/g, ' ').toLowerCase() }), h('span', { class: 'spacer' }), mini('Decode', () => ctx.switchTo('decode', { text })), mini('Copy', () => ctx.copy(text, 'Code'), { iconName: 'copy', primary: true })),
      h('pre', { class: 'out' }, clip(text, 20000)),
    ),
  );
}

export async function init(c) {
  ctx = c;
  mode = seg($('cMode'), (v) => {
    $('cMake').hidden = v !== 'make';
    $('cRead').hidden = v !== 'read';
  });
  form();
  $('cIn').addEventListener('input', debounce(draw, 150));
  $('cSave').addEventListener('click', async () => canvas && download(`injex-${o.format.toLowerCase()}.png`, await blob()));
  $('cCopyImg').addEventListener('click', async () => {
    if (!canvas) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
      ctx.toast('Image copied');
    } catch {
      ctx.toast('Copying images is blocked here — use Download', true);
    }
  });
  const drop = $('cDrop');
  drop.addEventListener('click', () => $('cFile').click());
  drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && $('cFile').click());
  $('cFile').addEventListener('change', (e) => readImage(e.target.files[0]));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readImage(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (!document.querySelector('.view[data-view="codes"].active')) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    mode.set('read');
    readImage(file);
  });
  await keepDraft($('cIn'), 'codes');
  draw();
}

export function activate(payload) {
  if (payload?.text !== undefined) {
    mode.set('make');
    setValue($('cIn'), payload.text);
  }
}
