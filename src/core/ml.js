// Optional ML second opinion: a prompt-injection classifier (a Hugging Face sequence-classification model in
// ONNX) run with ONNX Runtime Web — the ML pack in the plus builds (vendor/packs/ml), or fetched by
// `injex ml fetch` for the CLI. Text is tokenized with injex's own tokenizer.json reader (hftokenizer.js),
// so no Python and no tokenizer library. It scores hidden spans and metadata, never decides on its own:
// findings keep their severity and get an `ml` score next to it.
//
// Models are pinned by revision and SHA-256; injex ships none of them. The default is ProtectAI's
// deberta-v3-base-prompt-injection-v2 (Apache-2.0, the official ONNX export, 739 MB). Any other
// sequence-classification ONNX export works with its tokenizer.json (for example an int8 export of
// PIGuard, MIT, that you make yourself): give the model and tokenizer files and the label index that means
// "injection".

import { loadHfTokenizer } from './hftokenizer.js';

export const ML_MODELS = {
  'protectai-v2': {
    title: 'ProtectAI deberta-v3-base-prompt-injection-v2',
    license: 'Apache-2.0',
    repo: 'protectai/deberta-v3-base-prompt-injection-v2',
    revision: '90c9989b1a342275dd0d1a95aad283c04e075671',
    model: { path: 'onnx/model.onnx', size: 738563188, sha256: 'f0ea7f239f765aedbde7c9e163a7cb38a79c5b8853d3f76db5152172047b228c' },
    tokenizer: { path: 'onnx/tokenizer.json', size: 8648886, sha256: '752fe5f0d5678ad563e1bd2ecc1ddf7a3ba7e2024d0ac1dba1a72975e26dff2f' },
    labels: ['SAFE', 'INJECTION'],
    positive: 1,
    maxLength: 512,
  },
};
export const DEFAULT_MODEL = 'protectai-v2';

/** The pinned download URL of a model file on Hugging Face (m.base: another host with the same layout, for tests). */
export const hfUrl = (m, file) => `${m.base || 'https://huggingface.co'}/${m.repo}/resolve/${m.revision}/${file.path}`;

/**
 * Token IDs with the special tokens the tokenizer's post-processor adds for one sequence
 * (TemplateProcessing, BertProcessing, RobertaProcessing; Sequence of them).
 */
export function specialsFor(post, vocabOf) {
  const id = (tok) => {
    const v = vocabOf(tok);
    if (v === undefined) throw new Error(`special token ${tok} is not in the vocabulary`);
    return v;
  };
  if (!post) return { before: [], after: [] };
  if (post.type === 'Sequence') {
    for (const p of post.processors || []) {
      const r = specialsFor(p, vocabOf);
      if (r.before.length || r.after.length) return r;
    }
    return { before: [], after: [] };
  }
  if (post.type === 'TemplateProcessing') {
    const before = [];
    const after = [];
    let seen = false;
    for (const piece of post.single || []) {
      if (piece.Sequence) seen = true;
      else if (piece.SpecialToken) {
        const st = post.special_tokens?.[piece.SpecialToken.id];
        const ids = st?.ids?.length ? st.ids : [id(piece.SpecialToken.id)];
        (seen ? after : before).push(...ids);
      }
    }
    return { before, after };
  }
  if (post.type === 'BertProcessing' || post.type === 'RobertaProcessing') return { before: [post.cls[1]], after: [post.sep[1]] };
  return { before: [], after: [] };
}

/**
 * Windows of token IDs for a text: [specials + up to maxLength - specials tokens + specials], overlapping by
 * a quarter, at most maxWindows (long payloads are scored where the injection is, not only at the start).
 */
export function windows(ids, { before, after }, { maxLength = 512, maxWindows = 8 } = {}) {
  const room = Math.max(8, maxLength - before.length - after.length);
  if (ids.length <= room) return [[...before, ...ids, ...after]];
  const step = Math.max(1, Math.floor(room * 0.75));
  const out = [];
  for (let s = 0; s < ids.length && out.length < maxWindows; s += step) {
    out.push([...before, ...ids.slice(s, s + room), ...after]);
    if (s + room >= ids.length) break;
  }
  return out;
}

const softmax = (xs) => {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
};

/**
 * A classifier. o: { ort (the onnxruntime-web module), model (bytes), tokenizer (tokenizer.json text),
 * labels, positive (label index meaning injection), maxLength, name }.
 * → { name, classify(text) → { score, label, windows } }
 */
export async function createClassifier(o) {
  const tok = loadHfTokenizer(o.tokenizer, o.name || 'tokenizer.json');
  const json = JSON.parse(o.tokenizer);
  const vocab = new Map();
  if (Array.isArray(json.model?.vocab)) json.model.vocab.forEach(([piece], i) => vocab.set(piece, i));
  else for (const [k, v] of Object.entries(json.model?.vocab || {})) vocab.set(k, v);
  for (const a of json.added_tokens || []) vocab.set(a.content, a.id);
  const specials = specialsFor(json.post_processor, (t) => vocab.get(t));
  const session = await o.ort.InferenceSession.create(o.model instanceof Uint8Array ? o.model : new Uint8Array(o.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const names = session.inputNames;
  const positive = o.positive ?? 1;
  const labels = o.labels || [];
  const run = async (ids) => {
    const n = ids.length;
    const feeds = {};
    const t = (arr) => new o.ort.Tensor('int64', BigInt64Array.from(arr, (x) => BigInt(x)), [1, n]);
    for (const name of names) {
      if (/input_ids/.test(name)) feeds[name] = t(ids);
      else if (/attention_mask/.test(name)) feeds[name] = t(ids.map(() => 1));
      else if (/token_type_ids/.test(name)) feeds[name] = t(ids.map(() => 0));
      else throw new Error(`the model wants an input "${name}" injex doesn't know`);
    }
    const out = await session.run(feeds);
    const logits = Array.from(out[session.outputNames[0]].data, Number);
    return softmax(logits);
  };
  return {
    name: o.name || 'model',
    inputNames: names,
    async classify(text) {
      const ids = tok.encodeIds(String(text ?? ''));
      const ws = windows(ids, specials, { maxLength: o.maxLength || 512 });
      let best = null;
      for (const w of ws) {
        const p = await run(w);
        if (!best || p[positive] > best[positive]) best = p;
      }
      const label = best.indexOf(Math.max(...best));
      return { score: Math.round(best[positive] * 10000) / 10000, label: labels[label] ?? String(label), windows: ws.length };
    },
  };
}

/** Findings with a payload get `ml: { score, model }` — what the classifier makes of the hidden text. */
export async function scoreFindings(findings, classifier, { minChars = 12, max = 200 } = {}) {
  let n = 0;
  for (const f of findings) {
    const text = f.payload ?? f.decoded ?? f.ctx?.match;
    if (!text || String(text).trim().length < minChars || n >= max) continue;
    const r = await classifier.classify(text);
    f.ml = { score: r.score, model: classifier.name };
    n++;
  }
  return n;
}
