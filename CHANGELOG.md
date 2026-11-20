# Changelog

All notable changes to **injex** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/0xnookie/injex/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xnookie/injex/releases/tag/v1.0.0
