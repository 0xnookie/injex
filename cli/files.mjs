// Which files `injex scan` / `injex clean` look at: the files git tracks or would track (so .gitignore
// applies) when a folder is in a git work tree, otherwise a walk that skips dependency and build
// folders. Binary files, files over --max-size and paths matching --exclude / .injexignore are skipped.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'bower_components', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage', 'dist', 'build', 'out', 'target']);
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?|psd|heic|pdf|zip|gz|tgz|bz2|xz|zst|7z|rar|jar|war|class|dll|exe|so|dylib|o|a|lib|bin|wasm|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|opus|webm|mov|avi|mkv|flac|sqlite3?|db|pyc|node|crx|xpi|pem|der|p12|keystore)$/i;

/** gitignore-style glob → RegExp over a "/"-separated relative path (matches the path or anything below it). */
export function globToRegExp(glob) {
  let g = String(glob).trim().replace(/\\/g, '/');
  const anchored = g.startsWith('/');
  if (anchored) g = g.slice(1);
  if (g.endsWith('/')) g = g.slice(0, -1);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp((anchored || g.includes('/') ? '^' : '^(?:.*/)?') + re + '(?:/.*)?$');
}

/** Patterns from an ignore file (one glob per line, # comments). */
export function readIgnoreFile(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*/, '').trim())
    .filter(Boolean);
}

function gitFiles(dir) {
  try {
    const inside = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (inside !== 'true') return null;
    const out = execFileSync('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
    return [...new Set(out.split('\0').filter(Boolean))].map((p) => join(dir, p));
  } catch {
    return null;
  }
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (e.isFile()) out.push(join(dir, e.name));
  }
  return out;
}

export const toRel = (abs, cwd = process.cwd()) => relative(cwd, abs).split(sep).join('/') || '.';

/**
 * Expand paths to files. Explicit files are always included (unless excluded); folders use git or a walk.
 * @returns {{ files: string[], ignored: number, missing: string[] }} absolute paths
 */
export function expandPaths(paths, { exclude = [], cwd = process.cwd(), git = true } = {}) {
  const res = exclude.map(globToRegExp);
  const isExcluded = (abs) => {
    const rel = toRel(abs, cwd);
    return res.some((re) => re.test(rel));
  };
  const seen = new Set();
  const files = [];
  const missing = [];
  let ignored = 0;
  for (const p of paths.length ? paths : ['.']) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      missing.push(p);
      continue;
    }
    const list = statSync(abs).isDirectory() ? ((git && gitFiles(abs)) || walk(abs, [])) : [abs];
    for (const f of list) {
      if (seen.has(f)) continue;
      seen.add(f);
      if (isExcluded(f)) {
        ignored++;
        continue;
      }
      files.push(f);
    }
  }
  return { files: files.sort(), ignored, missing };
}

/**
 * Read a file as text. Returns { text } or { skip: 'binary' | 'large' | 'unreadable' }.
 * UTF-16 files with a byte-order mark are decoded; anything else with a NUL byte counts as binary.
 */
export function readText(abs, maxSize = 2 * 1024 * 1024) {
  if (BINARY_EXT.test(abs)) return { skip: 'binary' };
  let buf;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { skip: 'unreadable' };
    if (st.size > maxSize) return { skip: 'large' };
    buf = readFileSync(abs);
  } catch {
    return { skip: 'unreadable' };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  if (buf.subarray(0, 8000).includes(0)) return { skip: 'binary' };
  // TextDecoder drops a leading UTF-8 BOM; remember it so `clean --write` keeps it
  return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8', bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf };
}
