# Changelog

All notable changes to **injex** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-11-22

### Added
- **Plus builds** (`injex-plus-<version>.zip`, `injex-plus-firefox-<version>.zip`): the extension with two
  optional packs, every file pinned by SHA-256 in `src/data/packs.json` and fetched at build time
  (`node tools/fetch-packs.mjs && node tools/build-plus.mjs`). Their manifest allows WebAssembly; the default
  builds are unchanged and carry neither pack.
- **OCR pack** (Tesseract.js 7, bundled — never loaded from a CDN): *Scan → File* reads the text in an image
  and in the images on a PDF's pages (JPEG, 8-bit and 1-bit scans), the *Agent view* reads its screenshot.
  New findings: **faint text** (a colour barely different from the background, found by reading a
  contrast-enhanced copy in which only near-background pixels turn black) and **text only an image shows**
  (a canvas, a picture, a scanned page) when it reads like instructions.
- **ML second opinion**: a prompt-injection classifier (ProtectAI deberta-v3-base-prompt-injection-v2,
  Apache-2.0, pinned revision and SHA-256) run with ONNX Runtime Web and injex's own tokenizer.json reader;
  long texts are read in overlapping windows. It scores findings next to their severity, never instead of
  it. Extension (plus builds): *Settings → ML second opinion → Download the model*, then *ML second opinion*
  in the Scan tab. CLI: `injex ml status | fetch | score`, `injex scan --ml`, and
  `injex run --target-type classifier --classifier ml` for its recall at a fixed false-positive rate; your own
  ONNX export with `--ml-model` / `--ml-tokenizer`.
- **Firefox data consent**: the Firefox build declares `required: ["none"]` with the AI tools' data as
  optional categories and asks for them the first time an AI tool is used; minimum Firefox 140.
- `vendor/gpt-tokenizer/README.md` records the vendored release (gpt-tokenizer 2.9.0) and how to check it.

### Fixed
- The README counted 17 tabs; there are 18 since the Results tab.

## [1.4.0] — 2026-11-22

### Added
- **Scanner overhaul.** A scored, multilingual instruction heuristic that also reads leetspeak, zalgo,
  percent-encoding and look-alike letters (Unicode confusables data, skeletons, whole-script and mixed-script
  words, UTS #55 bidi checks); exfiltration shapes (image and link URLs that carry data, template
  placeholders, DNS / curl commands with secrets, memory writes); encoded payloads (Base64, Base32, hex,
  binary, percent-encoding) decoded and re-checked; the Sneaky Bits invisible-bit scheme as a transform and
  a finding. The page scanner also reads attributes, meta, JSON-LD, title, noscript, template, shadow DOM,
  low-contrast and covered text; HTML, SVG and Markdown files get the same checks statically, and Jupyter
  notebooks are read cell by cell. Agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `copilot-instructions.md`, skills …) are judged harder.
- **Agent-configuration audit** (`injex audit`, on by default in `injex scan`, the action and pre-commit):
  auto-approve settings, project hooks, folder-open tasks, MCP servers launched from unpinned packages or
  over plain HTTP, API base-URL overrides, lifecycle scripts and AI steps in CI workflows — each mapped to
  the CVE it reproduces. `injex event` and the action's `scan-event` input check issue, pull-request and
  comment text before an AI agent in CI reads it, with an `event-gate` output.
- **MCP supply chain.** `injex mcp-audit` audits configured MCP servers and their tool definitions
  (`--connect` asks the servers; `--lock` / `--check` pin them); `injex mcp-proxy` runs a server behind
  injex, auditing tool lists, removing hidden text from definitions and results and inspecting sampling
  requests. The MCP server grows to 14 tools (`check_output`, `check_canary`, `wrap_untrusted`,
  `scan_tool_manifest`, `scan_agent_config`, `scan_url`).
- **Research workflow.** `injex batch` (prompts × transforms × spotlighting defences as JSONL, CSV, JSON,
  promptfoo, Inspect, garak or PyRIT seed files in the `injex.row/1` schema), `injex import` (benchmark
  datasets and PyRIT seed datasets as seeds, Hugging Face only with `--fetch`), `injex jsonl` and
  `contrib/python` (a bridge with garak, PyRIT, Spikee, DeepTeam, AgentDojo and StrongREJECT adapters, and
  `Injex.score()`), `contrib/promptfoo`, and `injex canary` (make, find and listen for canary tokens).
  Findings and rows carry taxonomy tags (OWASP LLM Top 10 and Agentic, MITRE ATLAS, CWE).
- **`injex run`** sends rows to a target and scores the answers. Targets: OpenAI-compatible chat
  (OpenRouter, OpenAI, Ollama, LM Studio, vLLM), the Anthropic Messages API, the OpenAI Responses API, any
  HTTP endpoint (`--body` template, `--response-path`, `--header` values that read `${VAR}` from the
  environment) and a local command (your agent as a program, JSON on stdin), with retries on 429 / 5xx and
  token use and cost per trial. Rows may carry their own `system` and `canary`, a prior conversation
  (`messages`), scripted `turns`, `attachments` (PDF and images as files; Word, Excel, e-mail … as the
  text an extractor gets, hidden runs included) and `tools` / `forbidden_tools`. Scoring is deterministic
  — canary (also encoded, also in tool-call arguments), regex, decode-match outside refusal sentences (so
  refusing and then complying counts, and quoting the request while refusing doesn't), exfiltration
  shapes, forbidden tool calls — with an outcome class per answer (full, refuse_then_comply, partial,
  refusal, evasion). An optional model judge (the built-in prompt-injection question or your own
  `--judge-prompt`) is recorded with its prompt hash and never decides success unless asked. Repeats get
  Wilson intervals, a row-level cluster bootstrap and hit@k; also best-of-n search and a classifier mode at
  a fixed false-positive rate. Results are JSON lines — an `injex.run/1` header per invocation, then
  `injex.result/2` per trial — and `--resume` skips trials already answered for the same model, row and
  input.
- **Working with results**: `injex report` (Markdown), `injex results` (merge, filter, group; CSV, JUnit,
  SARIF, JSONL, Markdown; `--fail-on-asr` as a CI gate), `injex review` (label answers by hand into
  `injex.label/1`; labels override automatic scores) and `injex judge-eval` (precision, recall, F1 and
  Cohen's κ of every automatic signal against the labels; Krippendorff's α between raters). The extension's
  new **Results** tab opens results files, shows every answer and its scores, and saves labels.
- **Indirect-injection lab.** `injex lab` writes carriers hiding a benign canary instruction across web,
  Markdown, agent files, e-mail, calendar, MCP manifests, tool output, PDF and Word, with a manifest and a
  self-check, and rows for `injex run` (documents attached as files); `--collector` adds carriers that ask
  for an image whose URL carries the canary. `injex lab serve` serves the corpus on this machine and logs
  every request, flagging canaries; `injex lab mcp` is a mock MCP server whose tool carries the lab's
  poisoned definition and result; `injex mcp-proxy --mode inject` adds a test payload to a real server's
  tool results.
- `injex <command> --help` shows that command's options.
- **Spotlighting defences**: delimiting, datamarking and encoding transforms (226 transforms in all), and an
  MCP `wrap_untrusted` tool.
- **More documents**: Excel, PowerPoint, OpenDocument, RTF, e-mail (.eml / .mbox, with HTML parts, plain-only
  alternatives and quoted-printable), calendar invitations (.ics) and image metadata (PNG, JPEG, WebP, GIF).
- **Agent view** (Scan tab): what an AI browsing agent reads on the page that a screenshot doesn't show,
  and the reverse, plus link text that disagrees with its target; an optional full accessibility tree
  through the debugger API (Chrome). `injex url` and the MCP `scan_url` tool check a link's parameters and
  fragment.
- **Bring your own tokenizer.** The Tokenizer tab and `injex tokens` read any Hugging Face `tokenizer.json`
  (BPE — byte-level or with byte fallback —, Unigram with SentencePiece charsmaps, WordPiece, WordLevel)
  with the IDs of Hugging Face's own library, and say what the tokenizer's normalizer removes and which
  characters become unknown tokens. The file stays on the device (IndexedDB). GPT encodings now show a
  character's byte pieces as `<0xF3>` instead of an empty token.
- **Benchmarks** (`bench/`, `BENCHMARKS.md`): recall on the lab corpus, false positives on benign
  multilingual text (gated in CI), the instruction heuristic on labelled datasets, robustness against the
  encodings red-team frameworks ship, and what tokenizers see of hidden text.
- **VS Code / Open VSX extension** (`vscode/`): diagnostics as you type, hidden text decoded inline and on
  hover, a "remove hidden characters" quick fix, a workspace scan including documents, and the agent
  audit. Packed with `node tools/build-vscode.mjs`.
- **Distribution**: an MCP Bundle (`.mcpb`) for Claude Desktop and other MCPB hosts, `server.json` for the
  MCP Registry, a Dockerfile (CLI and MCP server), a browser demo page (`site/`), store listing notes
  (`store/`), and release jobs for npm (trusted publishing with provenance), the MCP Registry, GHCR and
  GitHub Pages — each switched on with a repository variable.

### Changed
- The npm package is `@0xnookie/injex` (with `mcpName` for the MCP Registry) and includes the GPT
  encodings, so `injex tokens` works from npm.
- `injex mcp` ignores an empty or unexpanded `--root`, as MCPB hosts pass when no folder was chosen.

### Fixed
- Mutation Lab: Random Mix and Zalgo ignored the seed, so a seeded set was not reproducible.
- The MCP `encode` tool said 222 transforms; it now reports the live count.
- An expandable row inside another row's details could not be opened.

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
