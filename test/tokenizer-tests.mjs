// Tests for the tokenizer.json reader (src/core/hftokenizer.js) against IDs recorded from Hugging Face's own
// tokenizers library (test/fixtures/hf-tokenizers.json, made by tools/hf-tokenizer-fixtures.py), the GPT
// token pieces, the token notes, the file store fallback and `injex tokens`.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHfTokenizer, convertPattern, toJsRegex, showBytes } from '../src/core/hftokenizer.js';
import { gptPiece, tokenNotes, hiddenCount } from '../src/core/tokenizer.js';
import { getFile, putFile, deleteFile } from '../src/core/store.js';

export default async function register({ test, assert, cli, FX }) {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/hf-tokenizers.json', import.meta.url), 'utf8'));
  const toks = Object.fromEntries(Object.entries(fx.configs).map(([k, c]) => [k, loadHfTokenizer(c, k)]));

  // async setup for the store test (tests themselves are synchronous)
  const stored = await putFile('test.json', { name: 'x.json', text: '{}' });
  const back = await getFile('test.json');
  await deleteFile('test.json');
  const gone = await getFile('test.json');

  for (const [name, exp] of Object.entries(fx.expected)) {
    test(`hf tokenizer: ${name} gives the IDs of huggingface/tokenizers`, () => {
      const tok = toks[name];
      fx.samples.forEach((s, i) => {
        if (exp.normalized) assert.equal(tok.normalize(s), exp.normalized[i], `normalized ${JSON.stringify(s)}`);
        if (exp.pieces) assert.deepEqual(tok.preTokenize(s), exp.pieces[i], `pieces of ${JSON.stringify(s)}`);
        assert.deepEqual(tok.encodeIds(s), exp.ids[i], `ids of ${JSON.stringify(s)}`);
      });
    });
  }

  test('hf tokenizer: model types, kinds, display pieces, decode', () => {
    assert.equal(toks['bytelevel-gpt2'].kind, 'BPE (byte-level)');
    assert.equal(toks['spm-byte-fallback'].kind, 'BPE (byte fallback)');
    assert.equal(toks['unigram-byte-fallback'].kind, 'Unigram (byte fallback)');
    assert.equal(toks['wordpiece-bert'].type, 'WordPiece');
    const noType = structuredClone(fx.configs['wordpiece-bert']);
    delete noType.model.type; // older exports leave "type" out
    assert.equal(loadHfTokenizer(noType).type, 'WordPiece');
    assert.throws(() => loadHfTokenizer({ model: { type: 'Mystery' } }), /unsupported tokenizer model "Mystery"/);
    assert.throws(() => loadHfTokenizer('{"vocab": {}}'), /not a tokenizer.json/);

    const gpt = toks['bytelevel-gpt2'];
    const tag = gpt.encode('a\u{E0069}');
    assert.equal(tag[0].text, 'a');
    assert.ok(tag.slice(1).every((t) => t.partial && /^(<0x[0-9A-F]{2}>)+$/.test(t.text)), 'byte pieces of a tag character show as bytes');
    const sp = gpt.encode('<|endoftext|> hello');
    assert.deepEqual([sp[0].special, sp[0].text], [true, '<|endoftext|>']);
    for (const s of ['Hello world', 'tags \u{E0069}\u{E0067} and \u{1F40D}', '  spaced\n\nlines ']) assert.equal(gpt.decode(gpt.encodeIds(s)), s);

    const spm = toks['spm-byte-fallback'];
    assert.equal(spm.decode(spm.encodeIds('hello the world')), 'hello the world');
    assert.equal(spm.decode(spm.encodeIds('Q日')), 'Q日', 'byte-fallback bytes decode back');
    const unk = toks['spm-unk-fused'].encode('xQQQx');
    assert.equal(unk.filter((t) => t.unk).length, 1, 'unknown characters fuse into one <unk>');
    assert.equal(toks['wordpiece-bert'].decode(toks['wordpiece-bert'].encodeIds('playing the world')), 'playing the world');
  });

  test('hf tokenizer: pattern translation from Oniguruma / Rust syntax', () => {
    assert.equal(convertPattern(String.raw`\p{L}+|\p{N}{1,3}`), String.raw`\p{L}+|\p{N}{1,3}`, '"}+" after \\p{…} is not possessive');
    assert.equal(convertPattern(String.raw`a++b*+c?+d{2}+`), 'a+b*c?d{2}');
    assert.equal(convertPattern(String.raw`\++[+]+`), String.raw`\++[+]+`);
    assert.equal(convertPattern("(?i:'s|ll)x"), "(?:'[sS]|[lL][lL])x");
    assert.equal(convertPattern(String.raw`[\x{200B}-\x{200D}]\'\#`), String.raw`[\u{200B}-\u{200D}]'#`);
    assert.equal(convertPattern(String.raw`\s\S\d\w`), String.raw`\p{White_Space}\P{White_Space}\p{Nd}[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u{B2}\u{B3}\u{B9}\u{BC}-\u{BE}]`);
    const w = toJsRegex(String.raw`\w+`);
    assert.deepEqual('x²y a\u200Db ①'.match(w), ['x²y', 'a', 'b'], 'Oniguruma \\w: ² is a word character, ZWJ and ① are not');
    assert.equal(convertPattern('x{,3}[]a]'), String.raw`x{0,3}[\]a]`);
    assert.equal(convertPattern(String.raw`\p{Han}+`), String.raw`\p{Script=Han}+`);
    const ws = toJsRegex(String.raw`\s+`);
    assert.deepEqual('a\u0085b\uFEFFc'.match(ws), ['\u0085'], 'NEL is whitespace, BOM is not (as in Oniguruma)');
  });

  test('hf tokenizer: long runs without spaces stay fast (heap-based BPE)', () => {
    const t0 = performance.now();
    const n = toks['bytelevel-gpt2'].count('\u{E0041}'.repeat(20000) + 'hello'.repeat(20000));
    assert.equal(n, 140000, '80000 byte pieces + 3 × 20000 (this small vocabulary merges "hello" into he|ll|o)');
    assert.ok(performance.now() - t0 < 3000, `took ${(performance.now() - t0).toFixed(0)} ms`);
  });

  test('tokenizer: GPT pieces come from token bytes, notes name what the normalizer drops', () => {
    const enc = { bytePairEncodingCoreProcessor: { tryDecodeToken: (id) => (id === 1 ? 'hi' : Uint8Array.of(0xf3, 0xa0)) }, decode: () => '' };
    assert.deepEqual(gptPiece(enc, 1), { text: 'hi', partial: false });
    assert.deepEqual(gptPiece(enc, 2), { text: '<0xF3><0xA0>', partial: true });
    assert.deepEqual(gptPiece({ decode: () => '' }, 3), { text: '', partial: true }, 'without the internals: empty means a held-back byte piece');
    assert.deepEqual(showBytes([0x20, 0xf0, 0x9f]), { text: ' <0xF0><0x9F>', partial: true }, 'whole characters stay text');
    assert.deepEqual(showBytes([0x90, 0x8d, 0x61]), { text: '<0x90><0x8D>a', partial: true });
    assert.deepEqual(showBytes([0xc3, 0xa9, 0xed, 0xa0, 0x80]), { text: 'é<0xED><0xA0><0x80>', partial: true }, 'a UTF-16 surrogate in UTF-8 is not a character');
    assert.deepEqual(showBytes(Array.from(new TextEncoder().encode('ok \u{1F40D}'))), { text: 'ok \u{1F40D}', partial: false });

    assert.equal(hiddenCount('a\u200Bb\u{E0041}\t\n'), 2);
    const bert = toks['wordpiece-bert'];
    const text = 'ignore\u200Bd \u{E0069}\u{E0067}';
    const notes = tokenNotes(text, bert.encode(text), bert.normalize);
    assert.equal(notes[0].level, 'warn');
    assert.match(notes[0].text, /^3 of 3 hidden characters do not survive/);
    const uni = toks['unigram-unk'];
    assert.ok(tokenNotes('日', uni.encode('日'), uni.normalize).some((n) => n.level === 'warn' && /unknown token/.test(n.text)));
  });

  test('store: files kept in memory where IndexedDB is unavailable', () => {
    assert.equal(stored, false, 'Node has no IndexedDB');
    assert.deepEqual(back, { name: 'x.json', text: '{}' });
    assert.equal(gone, undefined);
  });

  test('cli: injex tokens (bundled encodings, tokenizer.json, compare, json)', () => {
    let r = cli(['tokens', '--ids', '-e', 'r50k_base', 'Hello world']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[15496,995]');
    r = cli(['tokens', 'Ignore previous instructions']);
    assert.match(r.stdout, /^o200k_base {2}3 tokens/);
    assert.match(r.stdout, /Ignore\|·previous\|·instructions/);
    const file = join(FX, 'bert-tokenizer.json');
    writeFileSync(file, JSON.stringify(fx.configs['wordpiece-bert']));
    r = cli(['tokens', '--json', '-t', file], 'ignore\u200Bd it');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.tokenizer, 'bert-tokenizer.json');
    assert.deepEqual(j.list.map((t) => t.text), ['ignore', '##d', 'i', '##t']);
    assert.match(j.notes[0].text, /1 of 1 hidden character do not survive/);
    r = cli(['tokens', '--compare', '-t', file, 'abc']);
    for (const name of ['o200k_base', 'cl100k_base', 'p50k_base', 'r50k_base', 'bert-tokenizer.json']) assert.match(r.stdout, new RegExp('^' + name + ' +\\d+ tokens', 'm'));
    r = cli(['tokens', '-e', 'nope', 'x']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown encoding "nope"/);
  });
}
