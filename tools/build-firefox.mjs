#!/usr/bin/env node
// Builds the Firefox version of the extension into dist/firefox/ (and optionally a .zip):
//   node tools/build-firefox.mjs                     → dist/firefox/
//   node tools/build-firefox.mjs --zip out.zip       → also a ZIP for addons.mozilla.org / about:debugging
//
// The code is shared; only the manifest differs. Firefox runs MV3 background code as an event page
// (background.scripts, not service_worker), needs a gecko id and opens the settings via options_ui.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { AI_DATA } from '../src/core/consent.js';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'firefox');
const SHIP = ['manifest.json', 'LICENSE', 'icons', 'fonts', 'src', 'ui', 'vendor'];
export const GECKO_ID = 'injex@0xnookie';
export const MIN_FIREFOX = '140.0'; // built-in data consent (data_collection_permissions); MV3 scripting, storage.session …

/** Chrome manifest → Firefox manifest (pure, tested). opts.id: another gecko id (the plus build). */
export function firefoxManifest(m, { id = GECKO_ID } = {}) {
  const f = structuredClone(m);
  f.background = { scripts: [m.background.service_worker], type: m.background.type || 'module' };
  delete f.minimum_chrome_version;
  // Firefox has no chrome.debugger (the Agent view's full accessibility tree is Chrome-only)
  if (f.optional_permissions) {
    f.optional_permissions = f.optional_permissions.filter((p) => p !== 'debugger');
    if (!f.optional_permissions.length) delete f.optional_permissions;
  }
  if (f.options_page) {
    f.options_ui = { page: f.options_page, open_in_tab: true };
    delete f.options_page;
  }
  f.browser_specific_settings = {
    gecko: {
      id,
      strict_min_version: MIN_FIREFOX,
      // injex collects nothing; the optional AI tools send what the person types (and their OpenRouter key)
      // to openrouter.ai when they click — Firefox asks for these categories the first time (src/core/consent.js)
      data_collection_permissions: { required: ['none'], optional: [...AI_DATA] },
    },
  };
  return f;
}

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (!/^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(n)) out.push(p);
  }
  return out;
}

/** Copy what the extension loads into `out`; the optional packs (vendor/packs) only when asked for. */
export function copyShip(out, { packs = false } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const packsDir = join(ROOT, 'vendor', 'packs');
  for (const p of SHIP) cpSync(join(ROOT, p), join(out, p), { recursive: true, filter: (src) => packs || !(src === packsDir || src.startsWith(packsDir + sep)) });
}

/** The files of a folder as ZIP entries (sorted, forward slashes). */
export function zipFolder(dir, zipPath) {
  const entries = files(dir)
    .sort()
    .map((p) => ({ name: relative(dir, p).split(sep).join('/'), data: readFileSync(p) }));
  writeFileSync(zipPath, zip(entries));
}

export function build({ zip: zipPath = null } = {}) {
  copyShip(OUT);
  const manifest = firefoxManifest(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')));
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (zipPath) zipFolder(OUT, zipPath);
  return { dir: OUT, version: manifest.version, zip: zipPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  const i = process.argv.indexOf('--zip');
  const r = build({ zip: i > 0 ? process.argv[i + 1] : null });
  console.log(`Firefox build ${r.version} → ${relative(ROOT, r.dir)}${r.zip ? ` and ${r.zip}` : ''}`);
}
