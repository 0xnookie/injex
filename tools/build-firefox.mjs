#!/usr/bin/env node
// Builds the Firefox version of the extension into dist/firefox/ (and optionally a .zip):
//   node tools/build-firefox.mjs                     → dist/firefox/
//   node tools/build-firefox.mjs --zip out.zip       → also a ZIP for addons.mozilla.org / about:debugging
//
// The code is shared; only the manifest differs. Firefox runs MV3 background code as an event page
// (background.scripts, not service_worker), needs a gecko id and opens the settings via options_ui.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'firefox');
const SHIP = ['manifest.json', 'LICENSE', 'icons', 'fonts', 'src', 'ui', 'vendor'];
export const GECKO_ID = 'injex@0xnookie';
export const MIN_FIREFOX = '128.0'; // MV3 scripting + storage.session, Intl.Segmenter, CSS :has / color-mix

/** Chrome manifest → Firefox manifest (pure, tested). */
export function firefoxManifest(m) {
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
      id: GECKO_ID,
      strict_min_version: MIN_FIREFOX,
      // nothing is collected or sent anywhere by the extension itself (AI tools talk to the user's own
      // OpenRouter account, on request); Firefox < 140 ignores this key
      data_collection_permissions: { required: ['none'] },
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

export function build({ zip: zipPath = null } = {}) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const p of SHIP) cpSync(join(ROOT, p), join(OUT, p), { recursive: true });
  const manifest = firefoxManifest(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')));
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (zipPath) {
    const entries = files(OUT)
      .sort()
      .map((p) => ({ name: relative(OUT, p).split(sep).join('/'), data: readFileSync(p) }));
    writeFileSync(zipPath, zip(entries));
  }
  return { dir: OUT, version: manifest.version, zip: zipPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  const i = process.argv.indexOf('--zip');
  const r = build({ zip: i > 0 ? process.argv[i + 1] : null });
  console.log(`Firefox build ${r.version} → ${relative(ROOT, r.dir)}${r.zip ? ` and ${r.zip}` : ''}`);
}
