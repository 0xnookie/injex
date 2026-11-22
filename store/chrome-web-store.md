# Chrome Web Store and Microsoft Edge Add-ons listing

Copy for the store forms. Upload the release asset `injex-<version>.zip` (built by the release workflow from
the repository folders as they are — there is no build step). Edge Add-ons takes the same ZIP and the same
text; differences are noted at the end.

## Store listing

**Name:** injex

**Summary** (132 characters max):

> Find, decode and remove hidden text — invisible Unicode, steganography, prompt injection people can't see but AI reads.

**Category:** Developer Tools · **Language:** English

**Description:**

> injex is a toolkit for text that people and AI models read differently.
>
> HIDDEN-TEXT SCANNER
> • Scan any page for content a person can't see but an AI assistant reads: Unicode tag characters, emoji
>   and invisible-bit steganography, zero-width runs, bidi overrides, look-alike letters, white / tiny /
>   off-screen / covered text, hidden comments, attributes and metadata.
> • Every hidden payload is decoded, and injex says when it reads like instructions to a model.
> • Agent view: what an AI browsing agent reads on the page that a screenshot doesn't show, and the reverse.
> • Paste guard (off by default): checks what you paste into AI chat sites for hidden text.
> • Scan files you drop in: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, e-mail, calendar invitations
>   and image metadata — read locally, never uploaded.
>
> ENCODE, DECODE, INSPECT
> • 226 transforms: encodings, ciphers, Unicode styles, steganography, and "spotlighting" defences.
> • A universal decoder that peels nested layers (Base64 → ROT13 → hex …).
> • Character inspector, text compare, cleaner that removes hidden characters.
> • Tokenizer view: how GPT encodings — or any Hugging Face tokenizer.json you load (Llama, Qwen, Mistral,
>   Gemma, BERT, DeBERTa classifiers) — cut your text, and what the tokenizer's normalizer throws away.
>
> PRIVATE BY DESIGN
> Everything runs in your browser and all libraries are bundled. Nothing is sent anywhere, with one
> exception you switch on yourself: the optional AI tools send the text you give them to openrouter.ai with
> your own API key.
>
> Also available as a command-line tool, GitHub Action, pre-commit hook, MCP server for AI agents and VS
> Code extension: github.com/0xnookie/injex. Open source (AGPL-3.0).

**Screenshots** (1280×800): Scan tab on a page with a hidden instruction · Agent view · Transform tab ·
Decode tab peeling layers · Tokenizer tab with a loaded tokenizer.json · Inspect tab.

## Privacy practices tab

**Single purpose:**

> injex helps people find, decode and remove hidden text — content that AI models read but people can't
> see — and test how text is encoded, for prompt-injection research and defence.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves settings, favourite transforms, recipes, custom alphabets and the copy history on the device. |
| `contextMenus` | Right-click actions: transform, decode or scan the selected text, scan the page. |
| `activeTab` | Scans the page the user clicked the toolbar button or a menu item on — only that tab, only then. |
| `scripting` | Injects the page scanner (a self-contained function) into that tab to read its text and styles. |
| `clipboardWrite` | Copies results (encoded text, decoded payloads, cleaned text) when the user clicks Copy. |
| `debugger` (optional) | Only for the Agent view's "Full accessibility tree…" button: requested when the user clicks it, reads the accessibility tree of that one tab (what AI browsing agents read) while Chrome shows its debugging banner, then detaches and gives the permission back. |
| Host access `<all_urls>` (optional) | Live scan and paste guard, both off by default. Asked for when the user switches one on, released when it is switched off. |

**Remote code:** No. All code is in the package; nothing is loaded from a CDN and there is no `eval`.

**Data usage** — what to tick:

- *Website content*: yes — only text the user chooses to send with the optional AI tools, which goes from
  the browser to openrouter.ai.
- *Authentication information*: yes — the user's own OpenRouter API key, stored on the device and sent only
  to openrouter.ai.
- Everything else: no. The developer receives no data at all.
- Certifications: not sold to third parties; not used or transferred for purposes unrelated to the single
  purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** `https://github.com/0xnookie/injex/blob/main/store/privacy.md`

## Notes for the reviewer

> The extension's source is in the package unminified, exactly as in github.com/0xnookie/injex (the ZIP is
> the repository's manifest.json, LICENSE, icons/, fonts/, src/ and ui/ folders — no build step). The only
> minified files are vendor/gpt-tokenizer/*.js, the unmodified browser bundles of the MIT-licensed
> gpt-tokenizer npm package, used for offline token counting.
>
> To try the main feature: open any page, click the toolbar icon, then "Scan page". Test pages that hide
> text in many ways can be generated with `npx @0xnookie/injex lab ./lab` (or `node cli/injex.mjs lab ./lab`
> from the repository).
>
> The optional `debugger` permission is requested only when the user clicks "Full accessibility tree…" in
> the Agent view. It reads the accessibility tree of that one tab, then injex detaches and removes the
> permission again (chrome.permissions.remove).

## Edge Add-ons differences

- Category: *Developer tools*. Edge has no separate summary field: the first line of the description shows.
- Edge asks for search terms (up to 7): prompt injection, hidden text, invisible characters, unicode,
  steganography, AI security, decoder.
- Same privacy policy URL and the same reviewer notes ("Notes for certification").
