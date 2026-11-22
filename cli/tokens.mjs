// injex tokens: how a tokenizer cuts text — the bundled GPT encodings (vendor/gpt-tokenizer) or a Hugging
// Face tokenizer.json the person gives (Llama, Qwen, Mistral, Gemma, Phi, DeepSeek, T5, BERT, DeBERTa
// classifiers …). Shows what hidden characters cost in tokens, and what a model's normalizer throws away
// before the model ever sees it.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import vm from 'node:vm';
import { ENGINES, gptPiece, tokenNotes, hiddenCount } from '../src/core/tokenizer.js';
import { loadHfTokenizer } from '../src/core/hftokenizer.js';
import { visualize } from '../src/core/scan.js';
import { safe } from './report.mjs';

export const GPT_ENCODINGS = Object.keys(ENGINES).filter((k) => ENGINES[k].bpe);
const VENDOR = new URL('../vendor/gpt-tokenizer/', import.meta.url);

/** A bundled gpt-tokenizer encoding (the UMD bundle sets globalThis.GPTTokenizer_<name>). */
export function gptEncoding(name) {
  if (!GPT_ENCODINGS.includes(name)) throw new Error(`unknown encoding "${name}" (bundled: ${GPT_ENCODINGS.join(', ')})`);
  const key = 'GPTTokenizer_' + name;
  if (!globalThis[key]) vm.runInThisContext(readFileSync(new URL(name + '.js', VENDOR), 'utf8'), { filename: name + '.js' });
  const enc = globalThis[key];
  const ids = (text) => enc.encode(text, { allowedSpecial: 'all' });
  return {
    name,
    kind: 'tiktoken BPE (bundled)',
    encode: (text) => ids(text).map((id) => ({ id, ...gptPiece(enc, id) })),
    count: (text) => ids(text).length,
  };
}

/** A Hugging Face tokenizer.json from disk. */
export function hfTokenizerFile(file) {
  const tok = loadHfTokenizer(readFileSync(file, 'utf8'), file);
  const name = tok.name === file ? relative(process.cwd(), file).replace(/\\/g, '/') || file : tok.name;
  return { ...tok, name };
}

/** Counts and notes for one tokenizer over `text`. */
export function tokenReport(tok, text) {
  const tokens = tok.encode(text);
  const notes = tokenNotes(text, tokens, tok.normalize);
  return { tokenizer: tok.name, kind: tok.kind, tokens: tokens.length, chars: Array.from(text).length, bytes: new TextEncoder().encode(text).length, hidden: hiddenCount(text), notes, list: tokens };
}

const shown = (s) => safe(visualize(String(s).replace(/ /g, '·').replace(/\t/g, '→').replace(/\n/g, '↵').replace(/\r/g, '␍'), 200));

export async function cmdTokens(argv, { parseArgs, textArg, fail, useColor }) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      encoding: { type: 'string', short: 'e', multiple: true, default: [] },
      tokenizer: { type: 'string', short: 't', multiple: true, default: [] },
      compare: { type: 'boolean', default: false },
      ids: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      limit: { type: 'string', default: '2000' },
    },
  });
  const text = await textArg(positionals);
  const encs = o.compare ? [...new Set([...o.encoding, ...GPT_ENCODINGS])] : o.encoding.length || o.tokenizer.length ? o.encoding : ['o200k_base'];
  const toks = [];
  try {
    for (const e of encs) toks.push(gptEncoding(e));
    for (const f of o.tokenizer) toks.push(hfTokenizerFile(f));
  } catch (e) {
    fail(e.message);
  }
  const reports = toks.map((t) => tokenReport(t, text));
  if (o.json) {
    const out = reports.map(({ list, ...r }) => (o.compare ? r : { ...r, list: list.map((t) => ({ id: t.id, text: t.text, ...(t.partial && { partial: true }), ...(t.unk && { unk: true }), ...(t.special && { special: true }) })) }));
    process.stdout.write(JSON.stringify(out.length === 1 ? out[0] : out, null, 2) + '\n');
    return 0;
  }
  if (o.ids && !o.compare) {
    for (const r of reports) process.stdout.write((reports.length > 1 ? r.tokenizer + ': ' : '') + JSON.stringify(r.list.map((t) => t.id)) + '\n');
    return 0;
  }
  const color = useColor(process.stdout);
  const w = Math.max(...reports.map((r) => r.tokenizer.length));
  for (const r of reports) {
    const ratio = r.tokens ? (r.chars / r.tokens).toFixed(2) : '—';
    process.stdout.write(`${r.tokenizer.padEnd(o.compare ? w : 0)}  ${String(r.tokens).padStart(o.compare ? 7 : 0)} tokens  ${r.chars} chars  ${r.bytes} bytes  ${ratio} chars/token${o.compare ? '' : `  (${r.kind})`}\n`);
    if (o.compare) continue;
    const max = Math.max(1, Number(o.limit) || 2000);
    const parts = r.list.slice(0, max).map((t, i) => {
      const s = shown(t.text) || '∅';
      if (!color) return s;
      const style = t.unk ? '\x1b[41;97m' : t.special ? '\x1b[45;97m' : t.partial ? '\x1b[43;30m' : i % 2 ? '\x1b[46;30m' : '\x1b[47;30m';
      return style + s + '\x1b[0m';
    });
    process.stdout.write((color ? parts.join('') : parts.join('|')) + (r.list.length > max ? ` … ${r.list.length - max} more` : '') + '\n');
    for (const n of r.notes) process.stdout.write(`  ${n.level === 'warn' ? 'note' : 'info'}: ${n.text}\n`);
    if (reports.length > 1) process.stdout.write('\n');
  }
  return 0;
}
