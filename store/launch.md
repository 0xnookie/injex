# Launch kit for injex 1.4

Drafts to adapt: a write-up, short posts, and where to submit. Numbers come from `BENCHMARKS.md`; re-run
`node bench/run.mjs` before publishing and update them if they moved.

## Write-up (blog / dev.to / Medium)

### Your AI reads text you can't see. injex shows it.

A white-on-white paragraph on a web page, a run of Unicode tag characters in a GitHub issue, 314 emoji
variation selectors behind a 🐍, a comment in `AGENTS.md`: people scroll past them, AI assistants and
coding agents read them as instructions. injex is an open-source toolkit that finds, decodes and removes
that hidden text — in the browser, in your repository, in CI and inside AI agents.

**What it checks.** Invisible Unicode (tag characters, zero-width runs, bidi overrides, invisible letters),
emoji / invisible-bit steganography, look-alike and mixed-script words, concealed page text (white, tiny,
off-screen, clipped, covered, `aria-label`, `alt`, meta, JSON-LD, `noscript`, shadow DOM), hidden HTML and
Markdown comments, encoded payloads (Base64, hex, percent-encoding — decoded and re-checked), leak-shaped
links and image URLs, and hidden text in PDF, Word, Excel, PowerPoint, OpenDocument, RTF, e-mail,
calendar invitations and image metadata. Everything it finds is decoded, and it tells you when the hidden
text reads like instructions to a model.

**How well.** On a corpus of 49 carriers that hide the same instruction in different channels, the static
scan finds 49. On 1,000 benign multilingual documents (Persian and Hindi joiners, Arabic and Hebrew
direction marks, emoji sequences, flags, math letters, code) it raises nothing at medium severity or above,
and nothing on the 113 trigger-word-heavy benign prompts of NotInject. Encodings that red-team frameworks
ship (Base64, ROT13, Morse, Braille, ASCII smuggling, Sneaky Bits, homoglyphs, zalgo …) are peeled by the
decoder; `BENCHMARKS.md` has the per-encoding table and the limits.

**What the model sees.** New in 1.4: load any Hugging Face `tokenizer.json` (Llama, Qwen, Mistral, Gemma,
Phi, BERT, DeBERTa) and see how it cuts your text — IDs identical to Hugging Face's own library. It shows a
blind spot worth knowing about: a 32-character instruction hidden in tag characters becomes 78–129 tokens
for every decoder LLM we tried, but a single unknown token — or nothing at all — for the BERT and DeBERTa
tokenizers prompt-injection classifiers are built on. A detector cannot judge text its tokenizer erases.

**Where it runs.**
- Browser extension (Chrome, Edge, Firefox): page scan, Agent view (what an AI browsing agent reads that a
  screenshot doesn't show), paste guard for AI chats, 226 encoders and a universal decoder.
- `npx @0xnookie/injex scan` — CLI with SARIF output; a GitHub Action and pre-commit hook that fail the
  build on hidden instructions and on risky agent configuration (auto-approve settings, project hooks,
  folder-open tasks, unpinned MCP servers — each mapped to the CVE it reproduces).
- An MCP server (14 read-only tools) so agents can check what they are about to read, plus `injex
  mcp-audit` and `injex mcp-proxy` for the MCP servers you run.
- A VS Code extension with inline decoding and a quick fix.
- For researchers: `injex lab` builds a carrier corpus with a canary, `injex batch` / `injex run` turn
  prompts × transforms into promptfoo, Inspect or garak inputs and score model answers, and there are
  adapters for garak, PyRIT, Spikee, DeepTeam, AgentDojo and StrongREJECT.

Everything runs locally, with no dependencies and no telemetry. AGPL-3.0. Demo: <Pages URL> · Code:
https://github.com/0xnookie/injex

## Short posts

- **Mastodon / Bluesky / X**: AI assistants read text you can't see — tag characters, zero-width runs,
  white text, emoji steganography. injex finds it, decodes it and removes it: browser extension, CLI,
  GitHub Action, MCP server, VS Code. Local, open source. Try it in the browser: <Pages URL>
- **Hacker News (Show HN)**: "Show HN: injex – find hidden prompt injection in pages, files and repos".
  First comment: what it checks, the benchmark table and its limits, the tokenizer blind spot, and that
  it has no dependencies or telemetry.
- **LinkedIn**: the tokenizer finding first ("your injection classifier can't see this"), then the tool.

## Where to submit

Check each list's contribution rules first and open one focused PR per list.

| Where | What |
|---|---|
| corca-ai/awesome-llm-security | Tools section: one line, link, "hidden-text / prompt-injection scanner, CLI + extension + MCP" |
| tldrsec/prompt-injection-defenses | Detection tools |
| punkpeye/awesome-mcp-servers | Security category: the MCP server (`npx -y @0xnookie/injex mcp`) |
| ottosulin/awesome-ai-security | Defensive tools |
| OWASP GenAI Security Project — AI Security Solutions Landscape | Submit through the project's form: categories "LLM01 prompt injection" detection, "AI supply chain" (agent-config and MCP audit) |
| Official MCP Registry | Automatic from the release workflow once `MCP_REGISTRY_PUBLISH` is set |
| Docker MCP Catalog | After the GHCR image exists: open a PR to docker/mcp-registry with the image and server.json |
| Open VSX / VS Code Marketplace | `npx ovsx publish dist/injex-vscode-<v>.vsix`, `npx @vscode/vsce publish --packagePath …` |
| Conferences | `store/arsenal.md` |
