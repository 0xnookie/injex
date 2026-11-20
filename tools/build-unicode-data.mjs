#!/usr/bin/env node
// Builds src/data/unicode-data.js (character names, general categories, scripts and blocks) from the
// Unicode Character Database, for the Inspect tab and `injex inspect`:
//   node tools/build-unicode-data.mjs              → downloads UCD 17.0.0 from unicode.org
//   node tools/build-unicode-data.mjs <ucd dir>     → reads UnicodeData.txt, Blocks.txt, Scripts.txt there
//
// Names are front-coded (each line stores how many characters it shares with the previous name), and
// names that only spell their code point (CJK UNIFIED IDEOGRAPH-4E00, NUSHU CHARACTER-1B170 …) become
// ranges. Hangul syllable names are computed at runtime. See src/core/unicode.js for the reader.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '17.0.0';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'src', 'data', 'unicode-data.js');
// prefix lengths 0–63 as one character; never ',' (it marks a code point gap) or a template-literal character
export const PREFIX_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_.';

async function source(name, dir) {
  if (dir) return readFileSync(join(dir, name), 'utf8');
  const res = await fetch(`https://www.unicode.org/Public/${VERSION}/ucd/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

/** UnicodeData.txt → { names: [[cp, name]], ranges: [[start, end, prefix]], gc: [[start, gc]] } */
export function parseUnicodeData(text) {
  const names = [];
  const ranges = [];
  const gcRuns = [];
  let first = null;
  let lastCp = -1;
  const gcAt = (cp, gc) => {
    // unassigned gaps are Cn
    if (cp > lastCp + 1 && gcRuns.at(-1)?.[1] !== 'Cn') gcRuns.push([lastCp + 1, 'Cn']);
    if (gcRuns.at(-1)?.[1] !== gc) gcRuns.push([cp, gc]);
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split(';');
    const cp = parseInt(f[0], 16);
    let name = f[1];
    const gc = f[2];
    if (name.endsWith(', First>')) {
      first = { cp, label: name.slice(1, -8) };
      gcAt(cp, gc);
      lastCp = cp;
      continue;
    }
    if (name.endsWith(', Last>')) {
      gcAt(cp, gc);
      lastCp = cp;
      const label = first.label;
      // ideograph ranges have hex names; Hangul is computed; private use and surrogates have none
      if (/Ideograph/.test(label)) ranges.push([first.cp, cp, (label.startsWith('CJK') ? 'CJK UNIFIED IDEOGRAPH' : label.toUpperCase()) + '-']);
      first = null;
      continue;
    }
    gcAt(cp, gc);
    lastCp = cp;
    if (name === '<control>') name = f[10] ? f[10] : '';
    if (!name) continue;
    const suffix = '-' + hex(cp);
    if (name.endsWith(suffix)) {
      const prefix = name.slice(0, -hex(cp).length);
      const r = ranges.at(-1);
      if (r && r[2] === prefix && r[1] === cp - 1) r[1] = cp;
      else ranges.push([cp, cp, prefix]);
      continue;
    }
    names.push([cp, name]);
  }
  if (lastCp < 0x10ffff) gcAt(0x10ffff, 'Cn');
  ranges.sort((a, b) => a[0] - b[0]);
  return { names, ranges, gc: gcRuns };
}

/** Blocks.txt / Scripts.txt → [[start, end, value]] sorted. */
export function parseRanges(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.replace(/#.*/, '').match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\S.*?)\s*$/);
    if (m) out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16), m[3]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Front-code the names: "[gap36,]P suffix" per line, P = shared prefix length (PREFIX_CHARS). */
export function encodeNames(names) {
  let prevCp = -1;
  let prev = '';
  const lines = [];
  for (const [cp, name] of names) {
    let p = 0;
    const max = Math.min(prev.length, name.length, PREFIX_CHARS.length - 1);
    while (p < max && prev[p] === name[p]) p++;
    const gap = cp - prevCp;
    lines.push((gap === 1 ? '' : gap.toString(36) + ',') + PREFIX_CHARS[p] + name.slice(p));
    prevCp = cp;
    prev = name;
  }
  return lines.join('\n');
}

/** Script runs: consecutive ranges with the same script merged, gaps are Unknown ("Zzzz"). */
function runs(ranges, unknown) {
  const out = [];
  let next = 0;
  for (const [a, b, v] of ranges) {
    if (a > next && out.at(-1)?.[1] !== unknown) out.push([next, unknown]);
    if (out.at(-1)?.[1] !== v) out.push([a, v]);
    next = b + 1;
  }
  if (next <= 0x10ffff && out.at(-1)?.[1] !== unknown) out.push([next, unknown]);
  return out;
}

export async function build(dir) {
  const ud = parseUnicodeData(await source('UnicodeData.txt', dir));
  const blocks = parseRanges(await source('Blocks.txt', dir));
  const scripts = parseRanges(await source('Scripts.txt', dir));
  const scriptNames = [...new Set([...scripts.map((r) => r[2]), 'Unknown'])].sort();
  const scriptRuns = runs(scripts, 'Unknown');
  const names = encodeNames(ud.names);
  const js = `// Generated by tools/build-unicode-data.mjs from the Unicode Character Database ${VERSION}
// (https://www.unicode.org/Public/${VERSION}/ucd/). Unicode data © Unicode, Inc., Unicode License v3.
// ${ud.names.length} names, ${ud.ranges.length} code-point-named ranges, ${blocks.length} blocks, ${scriptNames.length} scripts.
// Read with src/core/unicode.js — do not edit by hand.

export const UNICODE_VERSION = '${VERSION}';

// [start, end, name prefix]: the name is the prefix followed by the code point in hex
export const NAMED_RANGES = ${JSON.stringify(ud.ranges.map(([a, b, p]) => [a, b, p]))};

// block start;end;name (hex)
export const BLOCKS = ${JSON.stringify(blocks.map(([a, b, n]) => `${a.toString(16)};${b.toString(16)};${n}`).join('\n'))};

// general category runs: start (base 36) and category, one per change
export const CATEGORY_RUNS = ${JSON.stringify(ud.gc.map(([a, g]) => a.toString(36) + g).join(' '))};

export const SCRIPTS = ${JSON.stringify(scriptNames)};
// script runs: start (base 36) and index into SCRIPTS
export const SCRIPT_RUNS = ${JSON.stringify(scriptRuns.map(([a, s]) => a.toString(36) + ':' + scriptNames.indexOf(s)).join(' '))};

// names, front-coded: [gap from the previous code point in base 36 + ','] + shared-prefix length + rest
export const NAMES = \`${names}\`;
`;
  writeFileSync(OUT, js);
  return { out: OUT, bytes: Buffer.byteLength(js), names: ud.names.length, ranges: ud.ranges.length, blocks: blocks.length, scripts: scriptNames.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await build(process.argv[2]);
  console.log(`unicode data → ${r.out}: ${(r.bytes / 1024).toFixed(0)} KB, ${r.names} names, ${r.ranges} ranges, ${r.blocks} blocks, ${r.scripts} scripts`);
}
