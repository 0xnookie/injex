#!/usr/bin/env node
// Optional packs for the "plus" builds: third-party code and data that the default extension does not ship.
//   ocr  Tesseract.js (Apache-2.0), its LSTM core (WASM, Apache-2.0) and English data (tessdata best_int,
//        Apache-2.0) — reading text in images, screenshots and scanned PDF pages
//   ml   ONNX Runtime Web (MIT) — runs a prompt-injection classifier you download separately (injex ml)
// Every file is pinned by SHA-256 in src/data/packs.json and lands in vendor/packs/<pack>/ (git-ignored).
//
//   node tools/fetch-packs.mjs [ocr] [ml]       fetch and verify (default: all packs)
//   node tools/fetch-packs.mjs --check          verify what is there, fetch nothing
//   node tools/fetch-packs.mjs --pin            maintainers: (re)compute the hashes in packs.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'src', 'data', 'packs.json');
export const PACKS_DIR = join(ROOT, 'vendor', 'packs');

export const readSpec = () => JSON.parse(readFileSync(SPEC, 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Whether a pack's files are all present with the pinned hashes. */
export function packReady(name, spec = readSpec()) {
  const p = spec.packs[name];
  return !!p && p.files.every((f) => {
    const path = join(PACKS_DIR, name, f.path);
    return existsSync(path) && sha256(readFileSync(path)) === f.sha256;
  });
}

async function fetchPack(name, spec, { pin = false, check = false, log = console.log } = {}) {
  const p = spec.packs[name];
  if (!p) throw new Error(`unknown pack "${name}" (${Object.keys(spec.packs).join(', ')})`);
  for (const f of p.files) {
    const path = join(PACKS_DIR, name, f.path);
    if (existsSync(path) && !pin) {
      const h = sha256(readFileSync(path));
      if (h === f.sha256) continue;
      if (check) throw new Error(`${name}/${f.path}: SHA-256 ${h} is not the pinned ${f.sha256}`);
    } else if (check) throw new Error(`${name}/${f.path}: missing (run node tools/fetch-packs.mjs ${name})`);
    log(`fetching ${f.url}`);
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const h = sha256(bytes);
    if (pin) f.sha256 = h;
    else if (h !== f.sha256) throw new Error(`${f.url}: SHA-256 ${h} is not the pinned ${f.sha256} — not written`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  writeFileSync(join(PACKS_DIR, name, 'PACK.json'), JSON.stringify({ pack: name, title: p.title, license: p.license, files: p.files.map(({ path, url, sha256: s, license }) => ({ path, url, sha256: s, license })) }, null, 2) + '\n');
  log(`${name}: ${p.files.length} files ready in vendor/packs/${name}/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const pin = args.includes('--pin');
  const check = args.includes('--check');
  const spec = readSpec();
  const names = args.filter((a) => !a.startsWith('--'));
  for (const n of names.length ? names : Object.keys(spec.packs)) await fetchPack(n, spec, { pin, check });
  if (pin) writeFileSync(SPEC, JSON.stringify(spec, null, 2) + '\n');
}
