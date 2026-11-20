<div align="center">

<img src="assets/banner.png" alt="injex — prompt-injection text toolkit in your browser" width="100%" />

injex
=====

### Prompt-Injection Text Toolkit for Red Teamers & AI Security Testing

**A Chrome / Edge / Firefox extension that encodes, hides and decodes text the way prompt-injection payloads do — 222 encoders, ciphers and Unicode tricks, a universal decoder that peels nested layers, emoji and Unicode-tag steganography, token tools, payload generators — and scans the page you're on for the text a model reads but you don't see: invisible tag characters, emoji steganography, zero-width and bidi characters, homoglyphs, CSS-hidden text and HTML comments. Everything runs locally in your browser.**

🎯 [What is it](#-what-is-injex) • ✨ [Features](#-features) • 🖥️ [Screenshots](#️-screenshots) • 🏗️ [How it works](#️-how-it-works) • 🚀 [Install](#-install) • 🕹️ [Usage](#️-usage) • ⚙️ [Settings](#️-settings--network-activity) • 🧪 [Tests](#-tests) • 🛡️ [Safety](#️-safety--authorization)

[![CI](https://github.com/0xnookie/injex/actions/workflows/ci.yml/badge.svg)](https://github.com/0xnookie/injex/actions/workflows/ci.yml)
[![Security](https://img.shields.io/badge/Security-AI%20Red%20Team-red)]()
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Browser](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Firefox-Manifest%20V3-black?logo=googlechrome&logoColor=white)]()
[![Transforms](https://img.shields.io/badge/Transforms-222-brightgreen)]()
[![Scanner](https://img.shields.io/badge/Hidden--text%20checks-8-red)]()
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
- **Warns while you browse (opt-in).** Turn on *Live scan* and every page is checked as it loads; the toolbar badge counts hidden instructions before you paste the page into an AI tool or let an agent read it.
- **Cleans text.** *Remove hidden characters* strips tags, selector runs, zero-width and bidi characters and fixes Cyrillic / Greek look-alike letters — from the right-click menu, the Scan tab or Decode.
- **Hides text, too.** Emoji steganography (one variation selector per bit, configurable, or one per byte) and invisible Unicode tags, from the toolbar or the right-click menu.
- **Works where you type.** Select text on any page → right-click → *injex* to encode it in place (inputs and editors), decode it, hide it in an emoji or make it invisible. **Alt+Shift+D** decodes the selection.
- **Shows what the model sees.** Bundled GPT tokenizers (o200k, cl100k, p50k, r50k) colour every token, so you can see what an emoji or a tag sequence costs.
- **Recipes.** Chain transforms (ROT13 → Base64 → invisible tags …) and save the chain as one transform: it decodes in reverse, the universal decoder recognises it, and it can go in the right-click menu.
- **Generates payloads.** Splitter (cut a payload across messages, every word broken in half), Mutation Lab (seeded fuzz variants), Tokenade (token bombs), Bijection prompts, Gibberish dictionaries, QR / barcodes, your own spelling alphabets.
- **Bring your own model.** PromptCraft rewrites, Anti-Classifier and translation (including dead and constructed languages) through OpenRouter with your key — the only feature that touches the network.
- **Private.** No telemetry, no remote code, no host permissions: page access only happens through `activeTab`, when you click — unless you switch on Live scan, which asks for it.

---

## ✨ Features

| Tab | What you get |
|---|---|
| **Transform** | 222 transforms in 11 categories — **Encoding** (Base16/32/36/45/58/62/64/85/91/122, Z85, uuencode, yEnc, quoted-printable, URL, HTML entities, hex, binary, octal …), **Cipher** (ROT13/18/47/8000, Caesar, Atbash, Vigenère, Beaufort, Autokey, Playfair, Bifid, Trifid, ADFGVX, Hill, Rail Fence, XOR …), **Concealment** (invisible Unicode tags, zero-width and whitespace steganography, homoglyphs, null cipher, acrostic, Cardan grille …), **Unicode** (bold, italic, fraktur, script, double-struck, small caps, bubble, squared, upside-down, zalgo, combining underlines …), **Symbol** (Braille, runes, Ogham, hieroglyphs, Aurebesh, Klingon, Tengwar, Daedric, pigpen …), **Technical** (Morse, NATO/ICAO, semaphore, DTMF, T9, tap code …), **Visual**, **Case**, **Format**, **SignWriting** and **Random Mix**. Encode or decode with every transform at once; filter by name, category or `/regex/`; star favorites; per-transform options (gear) are remembered; *Use as input* chains layers; *Menu* adds a transform to the right-click menu. **Recipes**: click **+** on transforms to chain them, see the output live, save the chain under a name — it becomes a transform (category *Recipes*) that decodes in reverse and can be edited, deleted or put in the right-click menu. Rows are filled lazily, so it stays instant with long inputs. |
| **Decode** | Universal decoder: all detectors and decoders plus every steganography scheme, ranked by priority × output readability + English-likeness. **Peel layers** unwraps nested encodings with a short look-ahead (it follows the top candidates a few layers deep and keeps the branch that ends in readable text). Cipher-level layers only count when they make the text more English; look-alike outputs (a decoder that only swaps a few letters) and decoders that return their error message are discarded. Force a specific decoder from the list. Language hints (14 scripts, 9 Latin-script languages) with one-click translation. Other readings are listed with *likely* / *maybe* / *weak*. |
| **Stego** | Hide a message after any emoji — **bits** (VS15/VS16 per bit; selectors, bit order, presentation selector and zero-width padding configurable) or **bytes** (VS1–VS256 per byte, 8× shorter) — or as **invisible Unicode tags**. 1,894 emoji to pick a carrier from. **Reveal** tries every scheme on pasted text. |
| **Scan** | Hidden-text scanner for **this page** (all frames, via `activeTab`) or **pasted text**. 8 checks: Unicode tags · emoji stego (bits / bytes) · zero-width runs · bidi overrides / isolates ("Trojan Source") · homoglyph words · CSS-hidden text (`display:none`, `visibility`, `opacity:0`, tiny font, transparent or same-as-background colour, clipped, off-screen) · sentence-like HTML comments · attributes (`alt`, `title`, `aria-*`, `placeholder`, `content` …). Each finding has a severity, the decoded payload, its context with invisible characters made visible, the element path and an **instructions** flag when it reads like a prompt injection or an exfiltration request. *Show on page*, *Decode*, **Copy cleaned** (hidden characters removed, look-alike letters fixed), Markdown report. The tab badge counts findings (red for critical). **Live scan** (opt-in, Settings): every page is scanned as it finishes loading and the toolbar badge shows the number of critical and high findings; the popup opens with that tab's results. |
| **Tokenizer** | o200k (GPT-4o, o-series), cl100k (GPT-4, GPT-3.5), p50k, r50k — bundled, offline — plus UTF-8 bytes, code points and words. Coloured tokens with visible whitespace, partial-character tokens outlined, token IDs, chars-per-token, and a count across all four encodings. |
| **Splitter** | Cut a payload into messages: **word** mode breaks every word across two messages (so no message holds a full keyword), or chunks, sentences, lines, a regex, or N tokens. Transform each piece through a chain of transforms and wrap it (`<part{n}>…</part{n}>`, code fences, quotes …). |
| **Mutation Lab** | Up to 500 variants of a payload: Random Mix, zero-width noise, diacritics, zalgo, whitespace swaps, random casing, homoglyphs. A seed makes the set reproducible. Copy all or download. |
| **Tokenade** | Token bombs: nested emoji with variation selectors and zero-width noise, presets from *feather* to *super*, or a single visible carrier with the payload as invisible tag sequences. Size estimate before generating, and a second click required above 25 M code units. Plus a text payload of combining marks / zero-width characters. |
| **Bijection** | "Learn my language *alphapr*" prompts: 8 mapping types (numbers, symbols, hex, emoji, Greek, mixes, ROT variant), fixed characters, one or many prompts with differently shuffled mappings, optional example exchange. |
| **Gibberish** | Every word swapped for a consistent nonsense word, with the dictionary (and a ready prompt to decode it); random letter removal across many variations; removal of chosen characters. |
| **Codes** | QR (error-correction level, module size, quiet zone), Code 128, EAN-13, Code 39 — download PNG or copy the image. **Decode image**: drop, paste or pick a picture; `BarcodeDetector` where available, bundled ZXing otherwise. |
| **Alphabets** | Your own NATO-style spelling alphabets (one word per letter), or generated on a theme by your OpenRouter model. Saved ones become transforms (category *Custom*) and decoders. |
| **AI** | Through OpenRouter, with your key: **PromptCraft** (rephrase, obfuscate, role-play, multi-language, expand, compress, metaphor, fragment, or your own instruction — up to 6 variants in parallel), **Anti-Classifier** (trigger words swapped for circumlocutions, with an explanation) and **Translate** into 23 living, dead and constructed languages, or back to English. A model per tool. |
| **Library** | 177 **glitch tokens** (AGGREGLITCH: unspeakable, polysemantic, loop-inducing …) with their token IDs and origin, model **special tokens** (OpenAI, Llama, Gemma, Mistral, Qwen, Phi, Command …), 37 **end / delimiter sequences**, and a table of 47 **invisible and look-alike characters** to copy. |
| **History** | Everything you copied from injex — including right-click results on pages — searchable, re-copyable, sendable to Decode / Transform / Scan, exportable as JSON. |

**Right-click menu** (on a selection): *Decode selection* · *Encode selection →* your chosen transforms and recipes · *Remove hidden characters* · *Hide selection in emoji* · *Make selection invisible (Unicode tags)* · *Scan page for hidden text* · *Open dashboard*. In inputs, textareas and rich editors the selection is **replaced in place**; elsewhere a small panel shows the result and copies it.

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

## 🏗️ How it works

```
           ┌──────────── popup / dashboard (ui/) ────────────┐        ┌── options.html ──┐
 you ────▶ │ 15 tabs, lazy-loaded view modules (ui/views/)   │ ◀────▶ │ settings, menu,  │
           └───────┬─────────────────────────────────────────┘        │ stego, backup    │
                   │ imports                                           └────────┬─────────┘
                   ▼                                                            │ chrome.storage.local
   src/core/ ─ registry.js   222 transforms (src/transforms/) + options + custom alphabets
             ─ decoder.js    detectors → ranked candidates → layer peeling with look-ahead, language hints
             ─ stego.js      emoji VS bits / bytes, Unicode tags
             ─ scan.js       scanText() (pure) + collectPage() / locateInPage() (injected)
             ─ splitter.js · generators.js · tokenizer.js · openrouter.js · store.js · badge.js
                   ▲
                   │ same modules
   src/background.js (service worker / Firefox event page) ── menu, Alt+Shift+D, live scan ──▶ chrome.scripting
                                                                       └ src/page.js: read / replace the
                                                                         selection, result panel (shadow DOM)
```

- **No build step.** Plain ES modules; the transform index is generated once by `tools/sync-transforms.mjs` and committed. Transform modules are kept unmodified, one file each, so they can be re-synced.
- **Pure core.** Everything in `src/core/` (except the injected page functions) runs in Node, the service worker and extension pages alike, which is what the tests exercise.
- **Ranking.** `score = priority × (0.1 + 0.9 × quality²) + 80 × englishness`, where *quality* penalises control characters and U+FFFD three-fold and *englishness* mixes common-word share with a letter-frequency fit. Decoders without a detector start at priority 10 and rise only as far as their output reads more English than the input.
- **Page access** happens only through `activeTab`: the scanner and the right-click actions inject a self-contained function into the tab you clicked on, and only then. Live scan is the exception you opt into: with the all-sites permission it injects the same collector when a page finishes loading.
- **One codebase, two browsers.** `tools/build-firefox.mjs` writes `dist/firefox/` with a Firefox manifest (event-page background, gecko id, `options_ui`); the code is identical.

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

**Firefox 128+:** download `injex-firefox-<version>.zip` from the [releases](https://github.com/0xnookie/injex/releases) (or run `node tools/build-firefox.mjs`, which writes `dist/firefox/`), open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** and pick the ZIP or `dist/firefox/manifest.json`. Same code, a Firefox manifest. Release Firefox keeps an unsigned add-on until it restarts; Developer Edition / Nightly can keep it with `xpinstall.signatures.required` set to `false`. Shortcuts are changed under `about:addons` → ⚙ → *Manage Extension Shortcuts*.

---

## 🕹️ Usage

- **Popup** (780 × 590): all 15 tabs; **Ctrl+1…9** switches between the first nine. Text you type is kept for the browser session, so closing the popup loses nothing. **Scan page** in the header scans the current tab.
- **Dashboard** (⤢ in the popup, or *Open dashboard* in the right-click menu): the same in a full tab. A right-click scan opens its results here.
- **Right-click** a selection → **injex**: decode it, encode it with one of your menu transforms (pick them in Settings or with the *Menu* switch on any transform), hide it in an emoji or as invisible tags, or scan the page.
- **Chaining**: *Use as input* in Transform, *Decode further* in Decode, and *Decode* / *Transform* / *Tokenize* / *Split* buttons move a result between tabs.
- **Filters** accept plain text or `/regex/`.

---

## ⚙️ Settings & network activity

| Setting | Default | Network |
|---|---|---|
| Every transform, decoder, steganography scheme, the scanner, tokenizers, generators, codes | always on | **none** — all local, all libraries bundled |
| Page scan, right-click actions | on click | none; injects a function into the tab you clicked (`activeTab`) |
| **Live scan** | **off** | none; asks for permission to read all sites, then scans each page locally as it loads. Switching it off gives the permission back |
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
                             # option combination, unicode), scanner (all checks, false-positive guards, instruction
                             # heuristics, page chunks, visualisation, cleaner), splitter, generators, badge, data files,
                             # manifest, Firefox manifest + ZIP writer
```

CI runs the suite, syntax-checks every module, verifies the transform index is in sync, validates the manifest and builds the Firefox package.

---

## 🗂️ Project layout

```
manifest.json
src/background.js        service worker: context menu, shortcuts, page scan → dashboard
src/page.js              functions injected into pages: read / replace the selection, result panel
src/core/registry.js     transform table, categories, options, safe encode / decode, custom alphabets
src/core/decoder.js      universal decoder, ranking, layer peeling, language hints
src/core/stego.js        emoji steganography (bits, bytes), Unicode tags
src/core/scan.js         hidden-text scanner, collectPage() / locateInPage() for the page
src/core/splitter.js     message splitter
src/core/generators.js   tokenade, mutation lab, bijection, gibberish, seeded RNG
src/core/tokenizer.js    GPT tokenizers (bundled gpt-tokenizer encodings)
src/core/openrouter.js   OpenRouter client and prompts
src/core/store.js        settings and history
src/core/badge.js        toolbar badge for scan findings
src/transforms/          222 transform modules + generated index.js
src/data/                emoji list, glitch tokens, end sequences, anti-classifier prompt
ui/                      app.html / app.js (popup + dashboard shell), views/ (one module per tab),
                         options.html / options.js, lib.js, style.css
vendor/                  gpt-tokenizer encodings, node-qrcode, JsBarcode, ZXing (+ licenses)
icons/  fonts/           logo and toolbar icons; Inter and JetBrains Mono (SIL OFL)
assets/                  README banner and screenshots
tools/                   sync-transforms.mjs (transform index), build-emoji-data.mjs (emoji list),
                         build-firefox.mjs + zip.mjs (Firefox manifest and package)
test/                    Node tests
.github/workflows/       CI and tagged-release packaging (Chrome and Firefox ZIPs)
```

---

## 🛡️ Safety & Authorization

injex is for **authorized** testing and research: red-teaming AI systems you own or are permitted to test, bug-bounty programs that cover AI features, evaluating filters and guardrails, CTFs, and checking content for hidden instructions before an AI agent reads it.

- ✅ No host permissions: pages are only touched through `activeTab`, after your click — Live scan is opt-in, asks for the permission and gives it back when switched off
- ✅ No telemetry, no remote code; the only network traffic is OpenRouter, when you use an AI tool
- ✅ Your API key stays in `chrome.storage.local` and is only sent to `openrouter.ai`
- ✅ The scanner only reads; *Show on page* only scrolls and outlines the element
- ✅ Token bombs above 25 M code units need a second click
- ❌ Don't use generated payloads against systems you aren't authorized to test
- ❌ Scanner results are leads: CSS-hidden text is often legitimate (menus, screen-reader text); confirm before reporting
- ❌ An absent finding is not a clean bill of health: cross-origin frames the extension can't read, images and text rendered on canvas are not covered

---

## 📜 License & credits

**AGPL-3.0-or-later**, see [`LICENSE`](LICENSE). Inspired by [P4RS3LT0NGV3](https://elder-plinius.github.io/P4RS3LT0NGV3/#decoder); its transform modules and its glitch-token, end-sequence and anti-classifier data are included under the AGPL-3.0.

Bundled third-party code, with its licenses in `vendor/`: [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT), [node-qrcode](https://github.com/soldair/node-qrcode) (MIT), [JsBarcode](https://github.com/lindell/JsBarcode) (MIT), [ZXing](https://github.com/zxing-js/library) (Apache-2.0). Fonts: Inter and JetBrains Mono under the SIL Open Font License (`fonts/`). UI design follows [JS Recon](https://github.com/0xnookie/js-recon).
