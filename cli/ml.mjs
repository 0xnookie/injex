// `injex ml`: the optional ML second opinion on the command line. Nothing is downloaded until you run
// `injex ml fetch`: the ONNX Runtime Web files (pinned in src/data/packs.json; a clone with
// `node tools/fetch-packs.mjs ml` already has them) and a model (pinned in src/core/ml.js) go into the cache
// folder ($INJEX_CACHE, else %LOCALAPPDATA%\injex or ~/.cache/injex), every file checked against its SHA-256.
//
//   injex ml status                 what is there
//   injex ml fetch [--model id]     download the runtime and the model (the default model is 739 MB)
//   injex ml score [text]           the injection probability of a text
//   injex scan --ml …               adds the score to findings that carry hidden text (see injex scan --help)
//   injex run rows --target-type classifier --classifier ml   recall at a fixed false-positive rate

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ML_MODELS, DEFAULT_MODEL, hfUrl, createClassifier } from '../src/core/ml.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function cacheDir(env = process.env) {
  if (env.INJEX_CACHE) return env.INJEX_CACHE;
  if (process.platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'injex');
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'injex');
}

const packSpec = () => JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'packs.json'), 'utf8')).packs.ml;
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Where the ONNX Runtime files are: the repository's vendor/packs/ml, else the cache. null when missing. */
export function runtimeDir() {
  const spec = packSpec();
  for (const dir of [join(ROOT, 'vendor', 'packs', 'ml'), join(cacheDir(), 'packs', 'ml')]) if (spec.files.every((f) => existsSync(join(dir, f.path)) && statSync(join(dir, f.path)).size > 0)) return dir;
  return null;
}

export const modelDir = (id) => join(cacheDir(), 'models', id);

/** Whether a pinned model is in the cache (sizes checked; hashes are checked when it is fetched). */
export function modelReady(id) {
  const m = ML_MODELS[id];
  return !!m && [m.model, m.tokenizer].every((f) => existsSync(join(modelDir(id), f.path.split('/').pop())) && statSync(join(modelDir(id), f.path.split('/').pop())).size === f.size);
}

/** Download a URL to `path`, hashing on the way; nothing stays behind unless the SHA-256 matches. */
async function download(url, path, sha256, { size, log }) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.part';
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    const code = e.cause?.code || '';
    throw new Error(/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code) ? `${new URL(url).host}: ${code} — something on this network replaces TLS certificates (a proxy or antivirus); point Node at its CA with NODE_EXTRA_CA_CERTS=<file.pem> (or download the file with a browser into ${dirname(path)} — injex ml fetch then only checks its SHA-256)` : `${url}: ${e.cause?.message || e.message}`);
  }
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  const hash = createHash('sha256');
  let got = 0;
  let shown = 0;
  const counted = Readable.fromWeb(res.body).on('data', (c) => {
    hash.update(c);
    got += c.length;
    if (total && log && got - shown > total / 20) {
      shown = got;
      log(`  ${Math.round((got / total) * 100)}% of ${(total / 1e6).toFixed(0)} MB`);
    }
  });
  await pipeline(counted, createWriteStream(tmp));
  const h = hash.digest('hex');
  if (h !== sha256) {
    rmSync(tmp, { force: true });
    throw new Error(`${url}: SHA-256 ${h} is not the pinned ${sha256} — discarded`);
  }
  renameSync(tmp, path);
}

/** Fetch the runtime (unless the repository has it) and a pinned model into the cache. */
export async function fetchMl(id = DEFAULT_MODEL, { log = () => {} } = {}) {
  const m = ML_MODELS[id];
  if (!m) throw new Error(`unknown model "${id}" (${Object.keys(ML_MODELS).join(', ')})`);
  if (!runtimeDir()) {
    const dir = join(cacheDir(), 'packs', 'ml');
    for (const f of packSpec().files) {
      const p = join(dir, f.path);
      if (existsSync(p) && sha256File(p) === f.sha256) continue;
      log(`fetching ${f.url}`);
      await download(f.url, p, f.sha256, { log });
    }
  }
  for (const f of [m.tokenizer, m.model]) {
    const p = join(modelDir(id), f.path.split('/').pop());
    if (existsSync(p) && statSync(p).size === f.size && sha256File(p) === f.sha256) continue;
    log(`fetching ${hfUrl(m, f)} (${(f.size / 1e6).toFixed(0)} MB)`);
    await download(hfUrl(m, f), p, f.sha256, { size: f.size, log });
  }
  return { runtime: runtimeDir(), model: modelDir(id) };
}

let ortPromise = null;
/** ONNX Runtime Web from the ML pack, single-threaded WASM. */
export function loadOrt() {
  const dir = runtimeDir();
  if (!dir) return Promise.reject(new Error('the ML runtime is not here: run injex ml fetch (or node tools/fetch-packs.mjs ml in a clone)'));
  ortPromise ||= import(pathToFileURL(join(dir, 'ort.wasm.min.mjs')).href).then((ort) => {
    ort.env.wasm.wasmPaths = pathToFileURL(dir).href + '/';
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    return ort;
  });
  return ortPromise;
}

/**
 * A classifier from a pinned model id (fetched with injex ml fetch) or from your own files:
 * { model: id | path to .onnx, tokenizer: path to tokenizer.json, positive: label index }.
 */
export async function loadClassifier({ model = DEFAULT_MODEL, tokenizer, positive } = {}) {
  const ort = await loadOrt();
  if (ML_MODELS[model]) {
    const m = ML_MODELS[model];
    if (!modelReady(model)) throw new Error(`model ${model} is not downloaded: injex ml fetch --model ${model} (${(m.model.size / 1e6).toFixed(0)} MB)`);
    const dir = modelDir(model);
    return createClassifier({ ort, model: readFileSync(join(dir, m.model.path.split('/').pop())), tokenizer: readFileSync(join(dir, m.tokenizer.path.split('/').pop()), 'utf8'), labels: m.labels, positive: m.positive, maxLength: m.maxLength, name: model });
  }
  if (!existsSync(model)) throw new Error(`no model "${model}": a pinned id (${Object.keys(ML_MODELS).join(', ')}) or an .onnx file`);
  if (!tokenizer || !existsSync(tokenizer)) throw new Error('your own model needs its tokenizer.json: --ml-tokenizer <file>');
  return createClassifier({ ort, model: readFileSync(model), tokenizer: readFileSync(tokenizer, 'utf8'), positive: positive ?? 1, name: model.split(/[\\/]/).pop() });
}

export async function cmdMl(argv, { parseArgs, fail, textArg }) {
  const [sub, ...rest] = argv;
  const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { model: { type: 'string', default: DEFAULT_MODEL }, tokenizer: { type: 'string' }, positive: { type: 'string' }, json: { type: 'boolean', default: false } } });
  if (sub === 'status' || !sub) {
    const rt = runtimeDir();
    process.stdout.write(`runtime  ${rt ? `ONNX Runtime Web (${rt})` : 'missing — injex ml fetch'}\ncache    ${cacheDir()}\n`);
    for (const [id, m] of Object.entries(ML_MODELS)) process.stdout.write(`model    ${id.padEnd(14)} ${modelReady(id) ? 'ready' : `not downloaded (${(m.model.size / 1e6).toFixed(0)} MB)`}  ${m.title}, ${m.license}\n`);
    return 0;
  }
  if (sub === 'fetch') {
    if (!ML_MODELS[o.model]) fail(`unknown --model ${o.model} (${Object.keys(ML_MODELS).join(', ')})`);
    const r = await fetchMl(o.model, { log: (m) => process.stderr.write(`injex: ${m}\n`) });
    process.stderr.write(`injex: ready — runtime in ${r.runtime}, model in ${r.model}\n`);
    return 0;
  }
  if (sub === 'score') {
    const text = await textArg(positionals);
    let c;
    try {
      c = await loadClassifier({ model: o.model, tokenizer: o.tokenizer, positive: o.positive !== undefined ? Number(o.positive) : undefined });
    } catch (e) {
      fail(e.message);
    }
    const r = await c.classify(text);
    process.stdout.write(o.json ? JSON.stringify({ model: c.name, ...r }) + '\n' : `${r.score.toFixed(4)}  ${r.label}  (${c.name}${r.windows > 1 ? `, ${r.windows} windows` : ''})\n`);
    return 0;
  }
  fail('injex ml status | fetch [--model id] | score [text]');
}
