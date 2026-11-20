<div align="center">

<img src="assets/banner.png" alt="injex — prompt-injection text toolkit in your browser" width="100%" />

injex
=====

### Prompt-Injection Text Toolkit for Red Teamers & AI Security Testing

**A Chrome / Edge / Firefox extension that encodes, hides and decodes text the way prompt-injection payloads do — 222 encoders, ciphers and Unicode tricks, a universal decoder that peels nested layers, emoji and Unicode-tag steganography, a character inspector, token tools, payload generators and batch export for test harnesses — and finds the text a model reads but you don't see: invisible tag characters, emoji steganography, zero-width, bidi and blank characters, homoglyphs, CSS-hidden text and HTML comments. On the page you're on, in what you paste into an AI chat, and — with the command-line tool and GitHub Action — in your repositories. Everything runs locally.**

🎯 [What is it](#-what-is-injex) • ✨ [Features](#-features) • 🖥️ [Screenshots](#️-screenshots) • 💻 [CLI & CI](#-command-line-and-ci) • 🏗️ [How it works](#️-how-it-works) • 🚀 [Install](#-install) • 🕹️ [Usage](#️-usage) • ⚙️ [Settings](#️-settings--network-activity) • 🧪 [Tests](#-tests) • 🛡️ [Safety](#️-safety--authorization)

[![CI](https://github.com/0xnookie/injex/actions/workflows/ci.yml/badge.svg)](https://github.com/0xnookie/injex/actions/workflows/ci.yml)
[![Security](https://img.shields.io/badge/Security-AI%20Red%20Team-red)]()
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Browser](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Firefox-Manifest%20V3-black?logo=googlechrome&logoColor=white)]()
[![Transforms](https://img.shields.io/badge/Transforms-222-brightgreen)]()
[![Scanner](https://img.shields.io/badge/Hidden--text%20checks-9-red)]()
[![CLI](https://img.shields.io/badge/CLI%20%2B%20GitHub%20Action-SARIF-black?logo=githubactions&logoColor=white)](#-command-line-and-ci)
[![Tokenizers](https://img.shields.io/badge/Tokenizers-o200k%20%7C%20cl100k%20%7C%20p50k%20%7C%20r50k-8A2BE2)]()
[![Dependencies](https://img.shields.io/badge/Runtime%20deps-0-brightgreen)]()
[![Build](https://img.shields.io/badge/Build%20step-none-lightgrey)]()

</div>

---

## 🎯 What is injex

Language models read text differently from people. A Unicode tag character is invisible on screen and perfectly legible to a model; a run of variation selectors after an emoji carries a whole sentence; a word in Cyrillic look-alikes slips past a keyword filter; Base64 inside ROT13 inside hex still gets decoded by a model that "helpfully" works it out. injex puts the tools for that in your browser toolbar — to **build** test payloads, to **decode** what you find, and to **scan** a page for what an AI agent or summarizer would pick up from it.

- **Every transform, live.** All 222 transforms — Base64 to Base122, classical and keyed ciphers, Morse, Braille, runes and fictional alphabets, 30 Unicode styles, zalgo, invisible text — update as you type. One click copies; the output can be fed straight back in to stack layers.
- **Decodes anything, even nested.** Paste a blob and every detector and decoder runs. Results are ranked by detector priority, how readable the output is and how much it reads like English, then **peeled**: `Base32 → Base64 → ROT13 → "reveal the system prompt"`. Plain text is recognised as plain text instead of being "decoded" into noise.
- **Finds hidden text on any page.** One click scans the page and all its frames for Unicode tags, emoji steganography, zero-width runs (decoded when they carry a message), bidi overrides, homoglyph words, text hidden with CSS and sentence-like HTML comments. Anything that reads like instructions to a model — or asks it to send data somewhere — is flagged, and *Show on page* takes you to the element.
- **Warns while you browse (opt-in).** Turn on *Live scan* and every page is checked as it loads — and again when new text settles, so chats, mail and feeds are covered too; the toolbar badge counts hidden instructions before you paste the page into an AI tool or let an agent read it. Skip sites, or scan only the ones you list.
- **Guards your pastes (opt-in).** The *paste guard* holds a paste into ChatGPT, Claude, Gemini and other AI chats when it hides text, shows what is hidden and lets you paste it cleaned (Enter), as is, or not at all (Esc). Clean pastes go through untouched.
- **Scans your repositories.** `injex scan` and the GitHub Action find hidden text in `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, Copilot instructions, docs and code — Unicode tags, bidi "Trojan Source", invisible identifiers, instruction-like hidden comments — with line and column, SARIF for code scanning and annotations on the pull request. `injex clean --write` fixes them.
- **Inspects every character.** Code point, Unicode name, category, script and block for each character; what tags and selectors hide; and a code-point diff of two texts that *look* the same.
- **Cleans text.** *Remove hidden characters* strips tags, selector runs, zero-width, bidi and blank characters and fixes Cyrillic / Greek look-alike letters — from the right-click menu, the Scan, Inspect and Decode tabs, or `injex clean`.
- **Hides text, too.** Emoji steganography (one variation selector per bit, configurable, or one per byte) and invisible Unicode tags, from the toolbar or the right-click menu.
- **Works where you type.** Select text on any page → right-click → *injex* to encode it in place (inputs and editors), decode it, hide it in an emoji or make it invisible. **Alt+Shift+D** decodes the selection.
- **Shows what the model sees.** Bundled GPT tokenizers (o200k, cl100k, p50k, r50k) colour every token, so you can see what an emoji or a tag sequence costs.
- **Recipes.** Chain transforms (ROT13 → Base64 → invisible tags …) and save the chain as one transform: it decodes in reverse, the universal decoder recognises it, and it can go in the right-click menu.
- **Generates payloads.** Splitter (cut a payload across messages, every word broken in half), Mutation Lab (seeded fuzz variants), Tokenade (token bombs), Bijection prompts, Gibberish dictionaries, QR / barcodes, your own spelling alphabets.
- **Exports test sets.** *Batch* runs your prompts through every transform you pick, wraps them in a template and downloads JSONL, CSV, JSON, a promptfoo tests file or text for your evaluation harness.
- **Bring your own model.** PromptCraft rewrites, Anti-Classifier and translation (including dead and constructed languages) through OpenRouter with your key — the only feature that touches the network.
- **Private.** No telemetry, no remote code, no host permissions: page access only happens through `activeTab`, when you click — unless you switch on Live scan or the paste guard, which ask for it.

---

## ✨ Features

| Tab | What you get |
|---|---|
| **Transform** | 222 transforms in 11 categories — **Encoding** (Base16/32/36/45/58/62/64/85/91/122, Z85, uuencode, yEnc, quoted-printable, URL, HTML entities, hex, binary, octal …), **Cipher** (ROT13/18/47/8000, Caesar, Atbash, Vigenère, Beaufort, Autokey, Playfair, Bifid, Trifid, ADFGVX, Hill, Rail Fence, XOR …), **Concealment** (invisible Unicode tags, zero-width and whitespace steganography, homoglyphs, null cipher, acrostic, Cardan grille …), **Unicode** (bold, italic, fraktur, script, double-struck, small caps, bubble, squared, upside-down, zalgo, combining underlines …), **Symbol** (Braille, runes, Ogham, hieroglyphs, Aurebesh, Klingon, Tengwar, Daedric, pigpen …), **Technical** (Morse, NATO/ICAO, semaphore, DTMF, T9, tap code …), **Visual**, **Case**, **Format**, **SignWriting** and **Random Mix**. Encode or decode with every transform at once; filter by name, category or `/regex/`; star favorites; per-transform options (gear) are remembered; *Use as input* chains layers; *Menu* adds a transform to the right-click menu. **Recipes**: click **+** on transforms to chain them, see the output live, save the chain under a name — it becomes a transform (category *Recipes*) that decodes in reverse and can be edited, deleted or put in the right-click menu. Rows are filled lazily, so it stays instant with long inputs. |
| **Decode** | Universal decoder: all detectors and decoders plus every steganography scheme, ranked by priority × output readability + English-likeness. **Peel layers** unwraps nested encodings with a short look-ahead (it follows the top candidates a few layers deep and keeps the branch that ends in readable text). Cipher-level layers only count when they make the text more English; look-alike outputs (a decoder that only swaps a few letters) and decoders that return their error message are discarded. Force a specific decoder from the list. Language hints (14 scripts, 9 Latin-script languages) with one-click translation. Other readings are listed with *likely* / *maybe* / *weak*. |
| **Stego** | Hide a message after any emoji — **bits** (VS15/VS16 per bit; selectors, bit order, presentation selector and zero-width padding configurable) or **bytes** (VS1–VS256 per byte, 8× shorter) — or as **invisible Unicode tags**. 1,894 emoji to pick a carrier from. **Reveal** tries every scheme on pasted text. |
| **Scan** | Hidden-text scanner for **this page** (all frames, via `activeTab`) or **pasted text**. 9 checks: Unicode tags · emoji stego (bits / bytes) · zero-width runs · bidi overrides / isolates ("Trojan Source") · homoglyph words · invisible letters (Hangul fillers — blank identifiers in code) · CSS-hidden text (`display:none`, `visibility`, `opacity:0`, tiny font, transparent or same-as-background colour, clipped, off-screen) · sentence-like HTML comments · attributes (`alt`, `title`, `aria-*`, `placeholder`, `content` …). Each finding has a severity, the decoded payload, its context with invisible characters made visible, the element path and an **instructions** flag when it reads like a prompt injection or an exfiltration request. Normal text stays quiet: emoji ZWJ sequences, flag emoji built from tag characters (🏴 England, Scotland, Wales), and the zero-width joiners Persian, Arabic and Indic scripts spell with. *Show on page*, *Decode*, **Copy cleaned** (hidden characters removed, look-alike letters fixed), Markdown report. The tab badge counts findings (red for critical). **Live scan** (opt-in, Settings): every page is scanned as it finishes loading and again when new text has settled (chats, mail, feeds), and the toolbar badge shows the number of critical and high findings; the popup opens with that tab's results and can take the site out of live scan. |
| **Inspect** | **Characters**: every code point with its glyph (invisible ones as labels — `ZWSP`, `RLO`, `TAG i`, `VS17`), Unicode name, category, script and block, flags (*invisible*, *bidi*, *tag*, *selector*, *look-alike*, *odd space*, *private use* …) and escapes (UTF-8, UTF-16, JS, Python, HTML, CSS, URL). Runs of tags or selectors collapse into one row with what they hide. Totals for graphemes, UTF-16 units, UTF-8 bytes and scripts; *Copy cleaned* and *Copy NFKC*. Unicode 17 names, bundled. **Compare**: a code-point diff of two texts with a verdict — identical, normalization only, **looks the same but isn't** (invisible characters, look-alike letters, fullwidth / mathematical forms) or visibly different — and every difference named. Right-click → *Inspect characters* opens it with the selection. |
| **Tokenizer** | o200k (GPT-4o, o-series), cl100k (GPT-4, GPT-3.5), p50k, r50k — bundled, offline — plus UTF-8 bytes, code points and words. Coloured tokens with visible whitespace, partial-character tokens outlined, token IDs, chars-per-token, and a count across all four encodings. |
| **Splitter** | Cut a payload into messages: **word** mode breaks every word across two messages (so no message holds a full keyword), or chunks, sentences, lines, a regex, or N tokens. Transform each piece through a chain of transforms and wrap it (`<part{n}>…</part{n}>`, code fences, quotes …). |
| **Mutation Lab** | Up to 500 variants of a payload: Random Mix, zero-width noise, diacritics, zalgo, whitespace swaps, random casing, homoglyphs. A seed makes the set reproducible. Copy all or download. |
| **Batch** | Prompts (one per line) × the transforms you filter for (name, `/regex/`, category, favorites, only reversible ones), each optionally wrapped in a template (`{payload}`, `{prompt}`, `{transform}`, `{category}`, `{n}`; presets like *Decode, then respond*) plus the unchanged prompt as a control row. Export **JSONL**, **CSV**, **JSON**, a **promptfoo** tests file (`prompt`, `original`, `transform` vars) or text — up to 20,000 rows, every row with its original so a harness can grade the answer. |
| **Tokenade** | Token bombs: nested emoji with variation selectors and zero-width noise, presets from *feather* to *super*, or a single visible carrier with the payload as invisible tag sequences. Size estimate before generating, and a second click required above 25 M code units. Plus a text payload of combining marks / zero-width characters. |
| **Bijection** | "Learn my language *alphapr*" prompts: 8 mapping types (numbers, symbols, hex, emoji, Greek, mixes, ROT variant), fixed characters, one or many prompts with differently shuffled mappings, optional example exchange. |
| **Gibberish** | Every word swapped for a consistent nonsense word, with the dictionary (and a ready prompt to decode it); random letter removal across many variations; removal of chosen characters. |
| **Codes** | QR (error-correction level, module size, quiet zone), Code 128, EAN-13, Code 39 — download PNG or copy the image. **Decode image**: drop, paste or pick a picture; `BarcodeDetector` where available, bundled ZXing otherwise. |
| **Alphabets** | Your own NATO-style spelling alphabets (one word per letter), or generated on a theme by your OpenRouter model. Saved ones become transforms (category *Custom*) and decoders. |
| **AI** | Through OpenRouter, with your key: **PromptCraft** (rephrase, obfuscate, role-play, multi-language, expand, compress, metaphor, fragment, or your own instruction — up to 6 variants in parallel), **Anti-Classifier** (trigger words swapped for circumlocutions, with an explanation) and **Translate** into 23 living, dead and constructed languages, or back to English. A model per tool. |
| **Library** | 177 **glitch tokens** (AGGREGLITCH: unspeakable, polysemantic, loop-inducing …) with their token IDs and origin, model **special tokens** (OpenAI, Llama, Gemma, Mistral, Qwen, Phi, Command …), 37 **end / delimiter sequences**, and a table of 47 **invisible and look-alike characters** to copy. |
| **History** | Everything you copied from injex — including right-click results on pages — searchable, re-copyable, sendable to Decode / Transform / Scan, exportable as JSON. |

**Right-click menu** (on a selection): *Decode selection* · *Encode selection →* your chosen transforms and recipes · *Remove hidden characters* · *Inspect characters* · *Hide selection in emoji* · *Make selection invisible (Unicode tags)* · *Scan page for hidden text* · *Open dashboard*. In inputs, textareas and rich editors the selection is **replaced in place**; elsewhere a small panel shows the result and copies it.

**Paste guard** (opt-in, Settings): on the AI chat sites you list — ChatGPT, Claude, Gemini, AI Studio, Copilot, Perplexity, DeepSeek, Grok, Le Chat, Poe, Meta AI and Hugging Face by default — a paste that hides text (medium severity and up: tags, emoji steganography, zero-width runs, bidi overrides, invisible letters, several look-alike words) is held, and a panel above the input shows what is hidden: **Paste cleaned** (Enter), **Paste as is** or **Cancel** (Esc). Pastes without suspicious characters go through untouched, typing is never watched, and nothing leaves the browser.

---

## 🖥️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/popup-transform.png" alt="Transform" width="100%" /><br/><sub><b>Transform</b>: 222 transforms update as you type; favorites first, one click copies</sub></td>
    <td width="50%"><img src="assets/screenshots/popup-decode.png" alt="Decode" width="100%" /><br/><sub><b>Decode</b>: three nested layers peeled automatically — Base32 → Base64 → ROT13</sub></td>
  </tr>
</table>

<p align="center">
  <img src="assets/screenshots/dashboard-scan.png" alt="Hidden-text scan in the dashboard" width="100%" />
  <br/><sub><b>Scan</b>: a product page with an invisible Unicode-tag injection, emoji steganography, CSS-hidden instructions, white-on-white text, a comment aimed at AI agents, zero-width characters and a homoglyph domain — each decoded, ranked and flagged when it reads like instructions</sub>
</p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/popup-stego.png" alt="Steganography" width="100%" /><br/><sub><b>Stego</b>: a sentence hidden in variation selectors after an emoji, shown with its invisible characters made visible</sub></td>
    <td width="50%"><img src="assets/screenshots/popup-tokens.png" alt="Tokenizer" width="100%" /><br/><sub><b>Tokenizer</b>: what invisible tags and Unicode styles cost in o200k tokens</sub></td>
  </tr>
</table>

<p align="center">
  <img src="assets/screenshots/dashboard-recipe.png" alt="Recipe builder in the dashboard" width="100%" />
  <br/><sub><b>Recipes</b>: ROT13 → Base64 → invisible tags, saved as one transform that decodes in reverse — the universal decoder recognises it too</sub>
</p>

<p align="center">
  <img src="assets/screenshots/dashboard-inspect.png" alt="Character inspector" width="100%" />
  <br/><sub><b>Inspect</b>: a review with a Cyrillic “а” in a domain, a zero-width space and 73 invisible tag characters — named, flagged and decoded; the flag emoji at the end is recognised as a normal emoji</sub>
</p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/paste-guard.png" alt="Paste guard" width="100%" /><br/><sub><b>Paste guard</b>: a review with an invisible instruction is held before it reaches the chat</sub></td>
    <td width="50%"><img src="assets/screenshots/popup-batch.png" alt="Batch export" width="100%" /><br/><sub><b>Batch</b>: two prompts × eight transforms in a template, ready as JSONL, CSV, JSON, promptfoo or text</sub></td>
  </tr>
</table>

<p align="center">
  <img src="assets/screenshots/dashboard-compare.png" alt="Compare two texts" width="100%" />
  <br/><sub><b>Compare</b>: two payment instructions that look identical — one has a Cyrillic “о”, a zero-width space and an invisible extra sentence</sub>
</p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/popup-split.png" alt="Splitter" width="100%" /><br/><sub><b>Splitter</b>: every word cut across two messages, so no single message carries a keyword</sub></td>
    <td width="50%"><img src="assets/screenshots/popup-library.png" alt="Library" width="100%" /><br/><sub><b>Library</b>: glitch tokens with their IDs and behaviour, special tokens, end sequences, invisible characters</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/popup-light.png" alt="Light theme" width="100%" /><br/><sub><b>Light theme</b>: follows the system, or set it in Settings</sub></td>
    <td width="50%"><img src="assets/screenshots/settings-stego.png" alt="Settings" width="100%" /><br/><sub><b>Settings</b>: steganography encoding with a live preview, OpenRouter models, right-click menu, history, backup</sub></td>
  </tr>
</table>

> Black-and-white chrome, colour reserved for meaning: transform category, severity, state. Inter and JetBrains Mono are bundled, so the extension makes no font requests.

---

## 💻 Command line and CI

The scanner, the cleaner, the decoder and the inspector also run in Node (20+), with no dependencies — for repositories, where hidden text increasingly targets AI coding assistants through `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, MCP tool descriptions, docs and code.

<p align="center">
  <img src="assets/screenshots/cli-scan.png" alt="injex scan in a terminal" width="100%" />
</p>

```bash
npx github:0xnookie/injex scan              # the current folder (in a git repo: the files git tracks or would track)
npx github:0xnookie/injex scan docs AGENTS.md --fail-on medium
npx github:0xnookie/injex clean --write .   # remove hidden characters in place (keeps BOMs and UTF-16)
```

| Command | What it does |
|---|---|
| `injex scan [paths…]` | Every line with a suspicious character goes through the extension's checks — Unicode tags, emoji steganography, zero-width runs, bidi controls, invisible letters, homoglyph words — plus HTML and Markdown comments (`<!-- … -->`, `[//]: # (…)`) that read like instructions to a model. Findings have a line and column, a severity and the decoded payload. Skips binary files, `node_modules` / build folders outside git, files over 2 MB, and whatever `--exclude` or a `.injexignore` file lists. `--format text` (default), `json`, `sarif` or `github`; `--sarif <file>` writes SARIF next to any format. Exit code 1 when a finding reaches `--fail-on` (default `high`). |
| `injex clean [paths…]` | Removes hidden characters and fixes look-alike letters, with the same rules as the extension (emoji sequences, flag emoji and joiners in non-Latin words stay). `--check` lists what would change and exits 1; `--write` rewrites the files. Without paths: stdin to stdout. |
| `injex decode [text]` | The universal decoder: prints the peeled result, the layers on stderr (`Base32 → Base64 → ROT13`); `--all` lists other readings. |
| `injex encode <t1,t2…> [text]` | One or more transforms in a row (`injex encode rot13,base64 "…"`); `-d` decodes the chain backwards. `injex list [filter]` shows the 222 keys. |
| `injex inspect [text]` | Every unusual character with code point, name, category, script and flags (`--all` for every character, `--json`). |
| `injex diff <a> <b>` | Compares two files code point by code point: identical, normalization only, *looks the same but isn't*, or visibly different, with each difference named. Exit code 1 when they differ. |

Text arguments can be left out to read stdin, so `pbpaste | injex inspect` or `cat prompt.txt | injex decode` work too.

**GitHub Action** — fails the check, annotates the lines in the pull request and writes a job summary:

```yaml
# .github/workflows/hidden-text.yml
name: Hidden text
on: [push, pull_request]
jobs:
  injex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: 0xnookie/injex@v1.2.0
        with:
          path: .                 # files or folders, space- or newline-separated
          fail-on: high           # critical | high | medium | low | none
          exclude: |              # globs, one per line (or a .injexignore file)
            test/fixtures/**
```

For GitHub code scanning, write SARIF and upload it (`permissions: security-events: write`):

```yaml
      - uses: 0xnookie/injex@v1.2.0
        with:
          fail-on: none
          sarif: injex.sarif
      - uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: injex.sarif
```

The action's outputs `findings` and `failing` count what was reported. This repository runs it on itself in CI.

---

## 🏗️ How it works

```
           ┌──────────── popup / dashboard (ui/) ────────────┐        ┌── options.html ──┐
 you ────▶ │ 17 tabs, lazy-loaded view modules (ui/views/)   │ ◀────▶ │ settings, menu,  │
           └───────┬─────────────────────────────────────────┘        │ live scan, paste │
                   │ imports                                           │ guard, backup    │
                   ▼                                                   └────────┬─────────┘
   src/core/ ─ registry.js   222 transforms (src/transforms/) + options + alphabets + recipes     │ chrome.storage
             ─ decoder.js    detectors → ranked candidates → layer peeling with look-ahead, language hints
             ─ stego.js      emoji VS bits / bytes, Unicode tags
             ─ scan.js       scanText() / stripHidden() / checkPaste() (pure) + collectPage() (injected)
             ─ unicode.js    names, categories, scripts, blocks (src/data/unicode-data.js, Unicode 17)
             ─ diff.js · batch.js · sites.js · splitter.js · generators.js · tokenizer.js · store.js · badge.js
                   ▲                               ▲
                   │ same modules                  │ same modules
   src/background.js (service worker /         cli/injex.mjs ── scan · clean · decode · encode · inspect · diff
   Firefox event page)                          └ action.yml (GitHub Action), SARIF / annotations / JSON
     ├─ menu, Alt+Shift+D ─────────▶ chrome.scripting ─▶ src/page.js: selection, result panel, watchPage()
     ├─ live scan (opt-in) ─────────▶ collectPage() on load, again when watchPage() sees new text settle
     └─ paste guard (opt-in) ───────▶ registers src/content/paste-guard.js on the listed sites;
                                      it asks checkPaste() through runtime messages
```

- **No build step.** Plain ES modules; the transform index is generated once by `tools/sync-transforms.mjs` and committed. Transform modules are kept unmodified, one file each, so they can be re-synced.
- **Pure core.** Everything in `src/core/` (except the injected page functions) runs in Node, the service worker and extension pages alike, which is what the tests exercise.
- **Ranking.** `score = priority × (0.1 + 0.9 × quality²) + 80 × englishness`, where *quality* penalises control characters and U+FFFD three-fold and *englishness* mixes common-word share with a letter-frequency fit. Decoders without a detector start at priority 10 and rise only as far as their output reads more English than the input.
- **Page access** happens only through `activeTab`: the scanner and the right-click actions inject a self-contained function into the tab you clicked on, and only then. Live scan and the paste guard are the exceptions you opt into: live scan, with the all-sites permission, injects the same collector when a page finishes loading plus a `MutationObserver` that asks for a rescan when new text has been quiet for 1.5 s (at most every 4 s, backing off to a minute on busy pages); the paste guard, with permission for the sites you list, registers one small content script there that only listens for `paste`.
- **One codebase, three targets.** `tools/build-firefox.mjs` writes `dist/firefox/` with a Firefox manifest (event-page background, gecko id, `options_ui`); the CLI imports the same `src/core/` modules. The Unicode data is generated from the Unicode Character Database by `tools/build-unicode-data.mjs` (412 KB, front-coded names, loaded only when you inspect).

---

## 🚀 Install

1. Clone the repo:
   ```bash
   git clone https://github.com/0xnookie/injex.git
   ```
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked** and select the `injex` folder.
4. Pin the extension. **Alt+Shift+I** opens it, **Alt+Shift+D** decodes the selection on any page.

No build step and no runtime dependencies. Chrome / Edge 116+. Tagged releases also ship a ZIP of the extension.

**Command line:** `npx github:0xnookie/injex --help` (Node 20+), or clone and run `node cli/injex.mjs`. See [Command line and CI](#-command-line-and-ci).

**Firefox 128+:** download `injex-firefox-<version>.zip` from the [releases](https://github.com/0xnookie/injex/releases) (or run `node tools/build-firefox.mjs`, which writes `dist/firefox/`), open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** and pick the ZIP or `dist/firefox/manifest.json`. Same code, a Firefox manifest. Release Firefox keeps an unsigned add-on until it restarts; Developer Edition / Nightly can keep it with `xpinstall.signatures.required` set to `false`. Shortcuts are changed under `about:addons` → ⚙ → *Manage Extension Shortcuts*.

---

## 🕹️ Usage

- **Popup** (780 × 590): all 17 tabs; **Ctrl+1…9** switches between the first nine. Text you type is kept for the browser session, so closing the popup loses nothing. **Scan page** in the header scans the current tab.
- **Dashboard** (⤢ in the popup, or *Open dashboard* in the right-click menu): the same in a full tab. A right-click scan opens its results here.
- **Right-click** a selection → **injex**: decode it, encode it with one of your menu transforms (pick them in Settings or with the *Menu* switch on any transform), clean it, inspect its characters, hide it in an emoji or as invisible tags, or scan the page.
- **Chaining**: *Use as input* in Transform, *Decode further* in Decode, and *Decode* / *Transform* / *Tokenize* / *Split* buttons move a result between tabs.
- **Filters** accept plain text or `/regex/`.

---

## ⚙️ Settings & network activity

| Setting | Default | Network |
|---|---|---|
| Every transform, decoder, steganography scheme, the scanner, tokenizers, generators, codes | always on | **none** — all local, all libraries bundled |
| Page scan, right-click actions | on click | none; injects a function into the tab you clicked (`activeTab`) |
| **Live scan** | **off** | none; asks for permission to read all sites, then scans each page locally as it loads and when new text settles. Every site, every site except a list, or only a list. Switching it off gives the permission back |
| **Paste guard** | **off** | none; asks for permission for the listed AI chat sites (editable) and checks pastes there locally. Switching it off gives the permission back |
| AI tools, alphabet generation, *Test key*, *Load the full model list* | manual | requests to `openrouter.ai` with your key (the model list needs no key) |
| Theme | system | — |
| Emoji steganography (bit selectors, order, presentation selector, padding, carrier) | VS15 = 0, VS16 = 1, most significant bit first | — |
| Right-click menu transforms | 12 common ones (plus any recipe or alphabet you add) | — |
| History of copies | on, 100 entries | — |

Settings, favorites, options, alphabets and history live in `chrome.storage.local`; drafts and the last scan in `chrome.storage.session`. **Backup** exports them as JSON (the API key and history only if you tick the box).

---

## 🧪 Tests

```bash
node test/run-tests.mjs      # registry (all 222 transforms encode; decoders survive garbage; round trips; options;
                             # custom alphabets, recipes), universal decoder (single and nested layers, ranking ties, URL / HTML,
                             # plain text left alone, look-alike / error outputs, stego, speed), steganography (every
                             # option combination, unicode), scanner (all checks, false-positive guards — emoji, flag
                             # emoji, Persian / Indic joiners — instruction heuristics, page chunks, visualisation,
                             # cleaner, paste-guard verdicts, content script), Unicode inspector, diff (against an LCS),
                             # site lists, batch formats, CLI end to end (scan / formats / exit codes / clean with BOM
                             # and UTF-16 / decode / encode / inspect / diff), splitter, generators, badge, data files,
                             # manifest, Firefox manifest + ZIP writer
```

CI runs the suite, syntax-checks every module, checks the content script is a classic script, scans the repository with its own GitHub Action, verifies the transform index is in sync, validates the manifest and builds the Firefox package.

---

## 🗂️ Project layout

```
manifest.json
src/background.js        service worker: context menu, shortcuts, page scan → dashboard, live scan, paste guard
src/page.js              functions injected into pages: read / replace the selection, result panel, watchPage()
src/content/paste-guard.js  content script for the paste guard (registered on the sites you choose)
src/core/registry.js     transform table, categories, options, safe encode / decode, alphabets, recipes
src/core/decoder.js      universal decoder, ranking, layer peeling, language hints
src/core/stego.js        emoji steganography (bits, bytes), Unicode tags
src/core/scan.js         hidden-text scanner, cleaner, paste verdicts, collectPage() / locateInPage()
src/core/unicode.js      character inspector (names, categories, scripts, blocks, flags, escapes)
src/core/diff.js         code-point diff and "looks the same" verdicts
src/core/batch.js        batch export: prompts × transforms, templates, JSONL / CSV / JSON / promptfoo / text
src/core/sites.js        site lists for live scan and the paste guard, match patterns
src/core/splitter.js     message splitter
src/core/generators.js   tokenade, mutation lab, bijection, gibberish, seeded RNG
src/core/tokenizer.js    GPT tokenizers (bundled gpt-tokenizer encodings)
src/core/openrouter.js   OpenRouter client and prompts
src/core/store.js        settings and history
src/core/badge.js        toolbar badge for scan findings
src/transforms/          222 transform modules + generated index.js
src/data/                emoji list, Unicode 17 names / categories / scripts / blocks, glitch tokens,
                         end sequences, anti-classifier prompt
ui/                      app.html / app.js (popup + dashboard shell), views/ (one module per tab),
                         options.html / options.js, lib.js, style.css
cli/                     injex.mjs (command line), files.mjs (git / walk / ignore globs / encodings),
                         scan-files.mjs (line:column findings, hidden comments), report.mjs (text / JSON / SARIF / GitHub)
action.yml               GitHub Action (composite: runs cli/injex.mjs)
.injexignore             what `injex scan` skips in this repository
vendor/                  gpt-tokenizer encodings, node-qrcode, JsBarcode, ZXing (+ licenses)
icons/  fonts/           logo and toolbar icons; Inter and JetBrains Mono (SIL OFL)
assets/                  README banner and screenshots
tools/                   sync-transforms.mjs (transform index), build-emoji-data.mjs (emoji list),
                         build-unicode-data.mjs (Unicode data), build-firefox.mjs + zip.mjs (Firefox package)
test/                    Node tests
.github/workflows/       CI (tests, self-scan through the action) and tagged-release packaging (Chrome and Firefox ZIPs)
```

---

## 🛡️ Safety & Authorization

injex is for **authorized** testing and research: red-teaming AI systems you own or are permitted to test, bug-bounty programs that cover AI features, evaluating filters and guardrails, CTFs, and checking content for hidden instructions before an AI agent reads it.

- ✅ No host permissions: pages are only touched through `activeTab`, after your click — Live scan and the paste guard are opt-in, ask for their permissions and give them back when switched off
- ✅ The paste guard only sees pastes on the sites you list, never typing; clean pastes go through untouched
- ✅ No telemetry, no remote code; the only network traffic is OpenRouter, when you use an AI tool
- ✅ Your API key stays in `chrome.storage.local` and is only sent to `openrouter.ai`
- ✅ The scanner only reads; *Show on page* only scrolls and outlines the element
- ✅ Token bombs above 25 M code units need a second click
- ❌ Don't use generated payloads against systems you aren't authorized to test
- ❌ Scanner results are leads: CSS-hidden text is often legitimate (menus, screen-reader text); confirm before reporting
- ❌ An absent finding is not a clean bill of health: cross-origin frames the extension can't read, images and text rendered on canvas are not covered; the CLI reads text files only

---

## 📜 License & credits

**AGPL-3.0-or-later**, see [`LICENSE`](LICENSE). Inspired by [P4RS3LT0NGV3](https://elder-plinius.github.io/P4RS3LT0NGV3/#decoder); its transform modules and its glitch-token, end-sequence and anti-classifier data are included under the AGPL-3.0.

Bundled third-party code, with its licenses in `vendor/`: [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT), [node-qrcode](https://github.com/soldair/node-qrcode) (MIT), [JsBarcode](https://github.com/lindell/JsBarcode) (MIT), [ZXing](https://github.com/zxing-js/library) (Apache-2.0). Fonts: Inter and JetBrains Mono under the SIL Open Font License (`fonts/`). Character data from the [Unicode Character Database](https://www.unicode.org/ucd/) 17.0 (© Unicode, Inc., Unicode License v3). UI design follows [JS Recon](https://github.com/0xnookie/js-recon).
