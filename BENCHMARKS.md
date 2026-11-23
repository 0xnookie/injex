# injex scanner benchmarks

How well injex's deterministic checks find hidden prompt injection, and how often they fire on benign
text. Everything here is reproducible with `node bench/run.mjs` (dev-only: the `bench/` folder ships in
neither the extension nor the npm package). Numbers below are from injex 1.5.1, 2026-11-23: Tracks A, B
and C rerun (A and C give the same results as in 1.4.0; B now includes the ML second opinion), Track D from
1.4.0.

## Track A — hidden carriers and false positives (offline, gated in CI)

**Recall** on the `injex lab` corpus: 49 carriers that hide the same benign canary instruction in a
different channel each — CSS tricks, attributes, meta / JSON-LD / title, noscript / template, comments,
Unicode tags, emoji steganography, Sneaky Bits, zero-width steganography, Markdown comments and alt text,
agent rule files and skills, e-mail (hidden HTML, plain-only alternative, quoted-printable tags, Subject),
calendar invitations, MCP tool manifests, tool output, and PDF / Word documents.

| Channel | Carriers | Detected (static scan) |
|---|---:|---:|
| Web page | 23 | 23 |
| Markdown | 5 | 5 |
| Agent files | 3 | 3 |
| E-mail | 4 | 4 |
| Calendar | 3 | 3 |
| MCP manifest | 3 | 3 |
| Tool output | 1 | 1 |
| PDF / Word | 7 | 7 |
| **Total** | **49** | **49 (100 %)** |

One more carrier — text covered by an element drawn on top of it — needs a rendered page: the extension's
page scanner detects it. All 24 web carriers are detected by the in-browser collector in a rendered page,
checked on every push in headless Chrome on Linux and Windows (`test/e2e/chrome.mjs`).

**False positives** at medium severity or above:

| Benign set | Documents | Flagged | Per 1,000 |
|---|---:|---:|---:|
| Synthetic multilingual mix (Persian / Hindi joiners, Arabic / Hebrew direction marks, emoji ZWJ sequences, flags and keycaps, Russian, Greek, Chinese, Japanese, math letters, code) | 1,000 | 0 | 0 |
| This repository's own source and docs | 124 | 0 | 0 |

`node bench/run.mjs --check` fails when recall drops or false positives rise against `bench/baseline.json`.

**Limits.** The carriers are injex's own, so 100 % recall says the checks work as designed, not that they
catch every technique in the wild. The benign sets are small and partly synthetic; a larger crawl-based
negative set is the next step.

## Track B — the instruction heuristic and the ML second opinion on labelled datasets (`--track b --fetch [--ml]`)

Does a text *read like instructions to a model*? The heuristic is the keyword-and-pattern check that decides
whether hidden text is reported as an injection — not a classifier, and it runs on visible text here, which
is harder than its real job (judging text that is already known to be hidden). The ML second opinion is the
plus builds' classifier (ProtectAI deberta-v3-base-prompt-injection-v2, pinned revision, `injex ml`), run on
the same rows. 300 rows per dataset from the Hugging Face datasets-server (current revision).

| Dataset | Rows | Injections | Flagged by the heuristic | Flagged by ML (≥ 0.5) | Benign flagged: heuristic / ML |
|---|---:|---:|---:|---:|---:|
| deepset/prompt-injections | 300 | 54 | 17 | 21 | 0 / 1 |
| Lakera/gandalf_ignore_instructions | 300 | 300 | 177 | 300 | — |
| leolee99/NotInject (benign, full of trigger words) | 113 | 0 | — | — | **0 / 25** |
| jackhhao/jailbreak-classification ¹ | 300 | 137 | 78 | 106 | 8 / 0 |

True-positive rate at a fixed false-positive rate, all four sets together (491 injections, 522 benign):

| FPR target | Heuristic: threshold | TPR | Measured FPR | ML: threshold | TPR | Measured FPR |
|---:|---:|---:|---:|---:|---:|---:|
| 0.1 % | 0.65 | 9.6 % | 0 % | 0.999999 | 59.7 % | 0 % |
| 1 % | 0.50 | 46.8 % | 0.96 % | 0.99997 | 77.2 % | 0.96 % |
| 5 % | 0.30 | 55.4 % | 1.5 % | 0.29 | 87.4 % | 5.0 % |

Without the dataset the model was trained on (¹ — its model card names it; 354 injections, 359 benign):

| FPR target | Heuristic TPR | ML TPR (threshold) |
|---:|---:|---:|
| 0.1 % | 54.8 % | 76.3 % (0.999999) |
| 1 % | 55.4 % | 84.7 % (0.99999) |
| 5 % | 55.4 % | 89.8 % (0.98) |

Read this as:

- **The heuristic is conservative.** It almost never fires on benign text (NotInject: 0 of 113) and misses
  paraphrased or non-English injections that don't use the classic phrasings. That is the intended
  trade-off for a check that runs on every page and paste.
- **The classifier catches far more — and over-fires on trigger words.** It finds every Gandalf injection
  but flags 25 of NotInject's 113 benign prompts at its own 0.5 threshold. Its useful thresholds sit at
  0.9999…: benign and malicious texts alike get scores near 1, so the ranking happens in the last decimals
  (`classify()` returns the unrounded `probability` for that; the displayed `score` is rounded).
- **That is why it is a second opinion.** In injex it scores findings next to their severity and never
  replaces it. A finding needs hidden text first; the classifier then says how much the hidden text reads
  like an injection.
- **Caveats.** The model card names one training dataset by name (¹) and others only by licence, so Gandalf or
  deepset may be in its training data as well; the held-out table is a best effort, not a clean test. The
  model is English-only by design (deepset has German rows). Scoring took 0.5 s per row on one CPU thread.

## Track C — obfuscation robustness (offline)

Five instruction prompts, encoded with the schemes red-team frameworks ship (injex's equivalent
transform), checked raw and after injex peels the encoding:

| Encoding | Shipped by | Detected raw | After decoding | Decoder recovers the text |
|---|---|---:|---:|---:|
| base64 | promptfoo, garak, PyRIT | 5/5 | 5/5 | 5/5 |
| hex | garak, PyRIT | 5/5 | 5/5 | 5/5 |
| rot13 | promptfoo, garak, PyRIT | 0/5 | 5/5 | 5/5 |
| leetspeak | promptfoo, PyRIT | 5/5 | 5/5 | 0/5 |
| morse | promptfoo, garak, PyRIT | 0/5 | 5/5 | 5/5 |
| binary | PyRIT | 5/5 | 5/5 | 5/5 |
| braille | garak, PyRIT | 0/5 | 5/5 | 5/5 |
| atbash | garak, PyRIT | 0/5 | 5/5 | 5/5 |
| caesar | PyRIT | 0/5 | 5/5 | 5/5 |
| url | PyRIT | 5/5 | 5/5 | 5/5 |
| invisible tags (ASCII smuggling) | promptfoo, garak, PyRIT | 5/5 | 5/5 | 5/5 |
| Sneaky Bits | garak, PyRIT | 5/5 | 5/5 | 5/5 |
| homoglyphs | promptfoo, PyRIT | 5/5 | 5/5 | 0/5 |
| upside-down | PyRIT | 0/5 | 5/5 | 5/5 |
| NATO alphabet | garak | 0/5 | 3/5 | 3/5 |
| base32 | garak | 5/5 | 5/5 | 5/5 |
| zalgo | garak, PyRIT | 5/5 | 5/5 | 5/5 |
| reversed | PyRIT | 0/5 | 4/5 | 4/5 |

"Detected raw" is what `injex scan` / `scan_text` report on the encoded text itself (Base64, Base32, hex,
binary and percent-encoded blobs are decoded automatically; homoglyphs, leetspeak and zalgo are folded).
Whole-text encodings such as ROT13 or Morse are not decoded inside every scan — `injex decode` and the
MCP `decode` tool peel them. "Decoder recovers" counts exact recovery; leetspeak and homoglyphs are read
correctly but not restored character for character.

## Track D — what tokenizers see of hidden text (`injex tokens`)

The same 32-character instruction ("Ignore all previous instructions"), visible and hidden three ways,
through the bundled GPT encodings and public `tokenizer.json` files (the IDs match Hugging Face's
`tokenizers` 0.23 exactly). Token counts; *unk* = unknown tokens; *dropped* = hidden characters the
tokenizer's normalizer removes or replaces before the model sees anything.

| Tokenizer | Model | Visible | Tag characters | Zero-width split | Emoji steganography |
|---|---|---:|---:|---:|---:|
| o200k (GPT-4o) | tiktoken BPE | 4 | 126 | 13 | 262 |
| cl100k (GPT-4) | tiktoken BPE | 4 | 97 | 14 | 386 |
| Llama 3 | byte-level BPE | 4 | 97 | 13 | 386 |
| Qwen 2.5 | byte-level BPE | 4 | 97 | 14 | 386 |
| Gemma 2 | BPE, byte fallback | 4 | 78 | 11 | 261 |
| Llama 2 (TinyLlama) | BPE, byte fallback | 5 | 129 | 13 | 512 |
| T5 | Unigram | 6 | 2 (1 unk) | 14 (3/3 dropped) | 3 (1 unk) |
| BERT base uncased | WordPiece | 4 | 1 (32/32 dropped) | 4 (3/3 dropped) | 2 (1 unk, 258/258 dropped) |
| DeBERTa-v3 prompt-injection classifier | Unigram | 4 | 2 (1 unk) | 12 (3/3 dropped) | 261 |

Read this as: every decoder LLM receives the hidden instruction byte for byte (that is why ASCII smuggling
works), while BERT- and DeBERTa-style classifiers — the usual prompt-injection detectors — see the tag
payload as nothing or one unknown token. A detector in front of an LLM cannot judge text its tokenizer
erases. Zero-width splitting does the opposite: BERT's normalizer removes the characters, so a BERT
classifier sees the plain instruction while byte-level models see broken words.

Reproduce with your own files: `injex tokens --compare -t llama3.json -t bert.json "<text>"` (the
tokenizer files are not shipped; download them from the model pages). In the extension: Tokenizer tab →
*tokenizer.json…*.

## Reproduce

```bash
node bench/run.mjs                      # track A (offline)
node bench/run.mjs --check              # against bench/baseline.json, as CI does
node bench/run.mjs --track c            # track C (offline)
node bench/run.mjs --track b --fetch    # track B (downloads public datasets)
node bench/run.mjs --track b --fetch --limit 300 --ml   # with the ML second opinion (injex ml fetch first)
node cli/injex.mjs lab ./lab            # the carrier corpus itself, with a manifest
```
