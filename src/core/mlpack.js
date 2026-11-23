// The ML second opinion in the extension (plus builds): ONNX Runtime Web from vendor/packs/ml and a model the
// person downloads once from Hugging Face (pinned revision, size and SHA-256 checked before it is kept) into
// the extension's IndexedDB. Nothing is downloaded or run until they ask.

import { ML_MODELS, DEFAULT_MODEL, hfUrl, createClassifier, scoreFindings } from './ml.js';
import { getFile, putFile, deleteFile } from './store.js';
import { packsAllowed } from './packs.js';

const PACK_DIR = 'vendor/packs/ml/';
const base = () => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(PACK_DIR) : new URL('../../' + PACK_DIR, import.meta.url).href);
const key = (id, part) => `ml:${id}${part ? ':' + part : ''}`;

/** Whether this build has the ML runtime. */
export async function mlRuntimeAvailable() {
  if (!packsAllowed()) return false;
  try {
    return (await fetch(base() + 'ort.wasm.min.mjs', { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/** { ready, size, at } for a model (a small record — the model itself is only read when it is used). */
export async function mlModelStatus(id = DEFAULT_MODEL) {
  const r = await getFile(key(id));
  return r?.ready ? r : { ready: false };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Fetch one pinned file into memory, reporting progress; refuse it unless size and SHA-256 match. */
async function fetchPinned(url, f, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  const out = new Uint8Array(f.size);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > f.size) throw new Error(`${f.path}: larger than the pinned ${f.size} bytes`);
    out.set(value, got);
    got += value.length;
    onProgress?.(got, f.size);
  }
  if (got !== f.size) throw new Error(`${f.path}: ${got} bytes, the pinned size is ${f.size}`);
  const h = hex(await crypto.subtle.digest('SHA-256', out));
  if (h !== f.sha256) throw new Error(`${f.path}: SHA-256 ${h} is not the pinned ${f.sha256}`);
  return out;
}

/** Download a pinned model into IndexedDB. onProgress(text). */
export async function downloadModel(id = DEFAULT_MODEL, onProgress) {
  const m = ML_MODELS[id];
  if (!m) throw new Error(`unknown model ${id}`);
  const pct = (label) => (got, total) => onProgress?.(`${label} ${Math.floor((got / total) * 100)}% of ${(total / 1e6).toFixed(0)} MB`);
  const tok = await fetchPinned(hfUrl(m, m.tokenizer), m.tokenizer, pct('tokenizer'));
  const model = await fetchPinned(hfUrl(m, m.model), m.model, pct('model'));
  onProgress?.('saving…');
  const a = await putFile(key(id, 'tokenizer'), { text: new TextDecoder().decode(tok) });
  const b = await putFile(key(id, 'model'), { bytes: model.buffer });
  await putFile(key(id), { ready: true, size: m.model.size + m.tokenizer.size, at: Date.now(), kept: a && b });
  classifier = null;
  return { kept: a && b };
}

export async function deleteModel(id = DEFAULT_MODEL) {
  classifier = null;
  for (const k of [key(id), key(id, 'model'), key(id, 'tokenizer')]) await deleteFile(k);
}

let classifier = null;
/** The classifier (ONNX Runtime and the stored model are loaded on first use). */
export async function getClassifier(id = DEFAULT_MODEL) {
  if (classifier?.name === id) return classifier;
  const m = ML_MODELS[id];
  const [tok, model] = await Promise.all([getFile(key(id, 'tokenizer')), getFile(key(id, 'model'))]);
  if (!tok?.text || !model?.bytes) throw new Error('the model is not downloaded (Settings → ML second opinion)');
  const ort = await import(base() + 'ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = base();
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
  classifier = await createClassifier({ ort, model: new Uint8Array(model.bytes), tokenizer: tok.text, labels: m.labels, positive: m.positive, maxLength: m.maxLength, name: id });
  return classifier;
}

/** Score findings in place (f.ml). → how many were scored. */
export async function mlScore(findings, id = DEFAULT_MODEL) {
  return scoreFindings(findings, await getClassifier(id));
}
