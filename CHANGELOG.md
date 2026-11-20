# Changelog

All notable changes to **injex** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-11-20

### Added
- **Hidden text in PDF and Word files.** A PDF reader (incremental updates, object streams, Flate / LZW /
  ASCII85 / ASCIIHex / RunLength, PNG predictors, ToUnicode CMaps and font encodings, a content-stream
  interpreter with colour, transparency, clipping, optional content and form XObjects) and a Word reader
  (styles, highlights, page colour, text boxes, headers, footers, notes) report text a reader can't see:
  white or background-coloured, transparent, sub-point, invisible (render mode 3), squeezed, off the page,
  clipped, covered by a shape drawn on top, on a hidden layer, or formatted as hidden — with the reason —
  plus tracked deletions, metadata and comments / annotations that read like instructions, and every
  invisible-character check on all text. An OCR layer over a scanned page is recognised as normal.
  Encrypted PDFs are reported, not read. In the extension: **Scan → File** (drop a PDF, .docx or text
  file), and a tab showing a PDF is downloaded and read as a PDF — by *Scan page* and by live scan. In the
  CLI, `injex scan` reads PDF and Word files (`--no-docs`, `--max-doc-size`); locations are `p.N` / `¶N`.
- **MCP server: `injex mcp`.** Model Context Protocol over stdio with eight read-only tools — `scan_text`,
  `scan_files` (files, folders, PDF and Word documents under the working directory and `--root`),
  `clean_text`, `decode`, `encode`, `list_transforms`, `inspect_text`, `compare_texts`. Hidden text in
  results is labelled as untrusted data.
- **pre-commit hooks** (`.pre-commit-hooks.yaml`): `injex` fails the commit on hidden text, `injex-clean`
  strips hidden characters from staged text files.

### Changed
- The paste guard was verified with real pastes in Firefox as well as Chrome.
- package.json lists only what the CLI needs and gains keywords, homepage and bugs links.

## [1.2.0] — 2026-11-20

### Added
- **Command line and GitHub Action.** `cli/injex.mjs` (Node 20+, no dependencies; `npx github:0xnookie/injex`)
  runs the extension's own modules: `scan` finds hidden text in files with line and column (Unicode tags,
  emoji steganography, zero-width runs, bidi controls, invisible letters, homoglyphs, and HTML / Markdown
  comments that read like instructions to a model) — git-aware, `.injexignore` / `--exclude`, binary and
  size skipping, UTF-16 — and reports as text, JSON, SARIF or GitHub annotations with a job summary,
  failing at `--fail-on` (default `high`). `clean --check / --write` fixes files (BOM and UTF-16 kept),
  plus `decode`, `encode` (chains, `-d`), `list`, `inspect` and `diff`. `action.yml` wraps it as a
  composite GitHub Action (outputs `findings`, `failing`; optional SARIF for code scanning); CI runs it on
  this repository.
- **Inspect tab.** *Characters*: every code point with glyph, Unicode 17 name, category, script, block,
  flags (invisible, bidi, tag, selector, look-alike, odd space, private use …) and escapes; runs of tags or
  selectors collapse into one row with what they hide; *Copy cleaned*, *Copy NFKC*. *Compare*: a
  code-point diff of two texts with a verdict (identical / normalization / looks the same but isn't /
  visibly different) and every difference named. Right-click → *Inspect characters*. Data generated from
  the UCD by `tools/build-unicode-data.mjs` and loaded only when used.
- **Batch tab.** Prompts × filtered transforms, optional template (`{payload}`, `{prompt}`, `{transform}`,
  `{category}`, `{n}`) and control rows, exported as JSONL, CSV, JSON, a promptfoo tests file or text.
- **Paste guard (opt-in).** On the AI chat sites you list (defaults: ChatGPT, Claude, Gemini, AI Studio,
  Copilot, Perplexity, DeepSeek, Grok, Le Chat, Poe, Meta AI, Hugging Face), a paste that hides text is
  held and a panel offers *Paste cleaned* (Enter), *Paste as is* or *Cancel* (Esc). Clean pastes are not
  touched. Asks for permission for those sites only.
- **Live scan follows changing pages** — chats, mail, feeds are scanned again once new text settles
  (rate-limited, backing off on busy pages) — and takes a site list: every site except some, or only some.
  The popup's Scan tab can add or remove the current site.
- Scanner: **invisible letters** (Hangul fillers used as blank identifiers in code) as a new check.

### Changed
- The scanner and the cleaner leave alone what is normal text: flag emoji built from tag characters
  (England, Scotland, Wales) and ZWJ / ZWNJ between letters of Persian, Arabic and Indic scripts. Tags
  appended to a flag are still reported.
- injex's own sources no longer contain literal invisible characters (escaped as `\uXXXX`).

## [1.1.0] — 2026-11-20

### Added
- **Firefox build.** `node tools/build-firefox.mjs [--zip out.zip]` writes `dist/firefox/` with a Firefox
  manifest (background as an event-page module, gecko id `injex@0xnookie`, Firefox 128+, `options_ui`,
  `data_collection_permissions: none`); the code is shared. Tagged releases attach
  `injex-firefox-<version>.zip`, CI builds it on every push. Tested in Firefox 160: every tab, the
  settings page, the page scanner, the background event page and live scan.
- **Recipes.** Click **+** on transforms to chain them (ROT13 → Base64 → invisible tags …), watch the
  output live, save the chain under a name. A recipe is a transform of its own (category *Recipes*):
  it decodes by running the steps backwards, shows up in Decode and in the right-click menu picker,
  and the universal decoder recognises it. Edit and delete from its row.
- **Remove hidden characters.** Strips Unicode tags, variation-selector runs, zero-width characters,
  invisible operators, soft hyphens and bidi embeddings / overrides / isolates, and turns Cyrillic /
  Greek look-alikes inside Latin words back into Latin letters — while keeping emoji ZWJ sequences,
  single emoji selectors and ZWNJ in scripts that need it. In the right-click menu (replaces the
  selection in text fields), as **Copy cleaned** in the Scan tab, and on Decode's invisible-character
  warning.
- **Live scan (opt-in).** Settings → *Live scan* asks for permission to read all sites and then scans
  each page as it finishes loading. The toolbar badge counts critical and high findings (red / orange)
  and the popup opens with that tab's results. Switching it off gives the permission back.

### Changed
- Manual scans set the toolbar badge for their tab too.
- Settings → *Edit shortcuts* uses `commands.openShortcutSettings()` where available; on older Firefox
  it explains where shortcuts live.
- Opening Settings at a section from the popup uses a tab instead of `window.open`.

## [1.0.0] — 2026-11-20

First release: a prompt-injection text toolkit as a Chrome extension, with a popup, a full-tab
dashboard and a right-click menu.

### Added
- **Transform** — 222 encoders, ciphers, Unicode styles and steganography schemes, live as
  you type; encode or decode, filter by name, category or `/regex/`, favorites, per-transform options
  (saved), chain an output back into the input.
- **Decode** — universal decoder: every detector and decoder, ranked by priority, output readability
  and how English the result reads, so equal-priority matches (Base36 / Base64 / Base91) are ordered by
  how readable their output is. **Peels nested layers** (`Base32 → Base64 → Hex`) with a short look-ahead,
  only lets cipher-level layers through when they make the text more readable, discards look-alike
  outputs and decoders that return their error as text, and says when the input is already plain text.
  Language hints with one-click translation.
- **Stego** — hide text after an emoji (VS15/VS16 bits, configurable, or one
  selector per byte) or as invisible Unicode tags; reveal tries every scheme.
- **Scan** — hidden-text scanner for the current page (all frames) or pasted text: Unicode tags, emoji
  steganography, zero-width runs (decoded when they carry a message), bidi overrides, homoglyph words,
  CSS-hidden text (display/visibility/opacity/size/colour/clip/off-screen) and sentence-like HTML
  comments. Findings that read like instructions to a model (or ask it to exfiltrate data) are flagged;
  *Show on page* scrolls to the element; Markdown report.
- **Tokenizer** — o200k, cl100k, p50k, r50k (bundled gpt-tokenizer), bytes, code points, words; token IDs
  and a comparison across encodings.
- **Splitter**, **Mutation Lab**, **Tokenade** (token bombs with a size estimate and a guard),
  **Bijection** prompts, **Gibberish** dictionaries, **Codes** (QR, Code 128, EAN-13, Code 39; decode
  from an image), custom **spelling alphabets** that become transforms.
- **AI** over OpenRouter with your own key: PromptCraft (8 strategies + custom, parallel variants),
  Anti-Classifier, translation into living, dead and constructed languages.
- **Library** — glitch tokens (AGGREGLITCH), model special tokens, end / delimiter sequences and a table
  of invisible characters to copy.
- **History** of everything copied, including right-click results.
- **Right-click menu** — encode the selection with a chosen set of transforms (replaced in place in text
  fields), decode it, hide it in an emoji or as invisible tags, scan the page. **Alt+Shift+D** decodes the
  selection.
- Settings page: theme, OpenRouter key test and models, steganography options with a live preview,
  context-menu transform picker, history, keyboard shortcuts, backup / restore.
- Node test suite (`node test/run-tests.mjs`) and CI.

[1.3.0]: https://github.com/0xnookie/injex/releases/tag/v1.3.0
[1.2.0]: https://github.com/0xnookie/injex/releases/tag/v1.2.0
[1.1.0]: https://github.com/0xnookie/injex/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xnookie/injex/releases/tag/v1.0.0
