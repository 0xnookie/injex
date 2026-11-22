#!/usr/bin/env node
// The plus builds: the extension with the optional packs (src/data/packs.json) — OCR (Tesseract.js) and the ML
// runtime (ONNX Runtime Web) — for Chrome and Firefox. Same code as the default builds; the manifest adds
// 'wasm-unsafe-eval' to the extension pages' CSP (both engines are WebAssembly) and is named "injex plus".
// The default builds stay without the packs and without the CSP change.
//
//   node tools/fetch-packs.mjs && node tools/build-plus.mjs [--zip]
//   → dist/plus/chrome/, dist/plus/firefox/ (and injex-plus-<version>.zip, injex-plus-firefox-<version>.zip)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyShip, zipFolder, firefoxManifest, GECKO_ID } from './build-firefox.mjs';
import { packReady, readSpec } from './fetch-packs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PLUS_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";
export const PLUS_GECKO_ID = GECKO_ID.replace('@', '-plus@');

/** Default manifest → plus manifest (pure, tested). */
export function plusManifest(m) {
  return {
    ...structuredClone(m),
    name: `${m.name} plus`,
    short_name: `${m.short_name || m.name}+`,
    description: `${m.description} Plus: OCR for images, screenshots and scanned PDFs, and an optional ML classifier.`.slice(0, 132),
    content_security_policy: { ...(m.content_security_policy || {}), extension_pages: PLUS_CSP },
  };
}

export function buildPlus({ zip = false } = {}) {
  const spec = readSpec();
  const missing = Object.keys(spec.packs).filter((p) => !packReady(p, spec));
  if (missing.length) throw new Error(`packs missing or changed: ${missing.join(', ')} — run node tools/fetch-packs.mjs`);
  const base = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const out = [];
  for (const [target, manifest] of [
    ['chrome', plusManifest(base)],
    ['firefox', firefoxManifest(plusManifest(base), { id: PLUS_GECKO_ID })],
  ]) {
    const dir = join(ROOT, 'dist', 'plus', target);
    copyShip(dir, { packs: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    let zipPath = null;
    if (zip) {
      zipPath = `injex-plus${target === 'firefox' ? '-firefox' : ''}-${base.version}.zip`;
      zipFolder(dir, zipPath);
    }
    out.push({ target, dir, zip: zipPath });
  }
  return { version: base.version, builds: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  const r = buildPlus({ zip: process.argv.includes('--zip') });
  for (const b of r.builds) console.log(`plus ${b.target} ${r.version} → ${relative(ROOT, b.dir)}${b.zip ? ` and ${b.zip}` : ''}`);
}
