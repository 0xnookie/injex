# Black Hat Arsenal / DEF CON Demo Labs submission draft

Fill in the presenter details; check each call's word limits (Arsenal abstracts are usually up to about
300 words) and submission window.

**Tool name:** injex

**Category:** AI / ML security · Defensive tooling · (Arsenal track: "AI, ML & Data Science" or "Code
Assessment")

**One-line description:** Finds, decodes and removes the text AI models read but people can't see — in web
pages, documents, repositories, CI and agent tool calls.

**Abstract:**

> Indirect prompt injection rarely looks like an attack to the person who opens the page, the issue or the
> PDF: the instruction is in Unicode tag characters, a run of emoji variation selectors, white or 1-pixel
> text, an aria-label, a Markdown comment or a hidden Word run. The AI assistant reading the same content
> sees every byte.
>
> injex is an open-source toolkit that makes this text visible and removes it, wherever an AI reads. A
> browser extension scans pages (including what an AI browsing agent reads that a screenshot doesn't show)
> and pastes into AI chats; a CLI, GitHub Action and pre-commit hook fail builds on hidden instructions and
> on agent configuration that reproduces recent CVEs (auto-approve settings, project hooks, folder-open
> tasks, unpinned MCP servers); an MCP server lets agents check what they are about to read; and a VS Code
> extension decodes hidden text inline. Everything runs locally with no dependencies.
>
> For red and purple teams, injex generates carrier corpora with a canary across 49 channels (web,
> Markdown, agent files, e-mail, calendar, MCP manifests, tool output, PDF and Word), encodes prompts with
> 226 transforms into promptfoo, Inspect and garak inputs, and scores model answers. Its tokenizer view
> loads any Hugging Face tokenizer.json and exposes a blind spot: a hidden instruction that becomes ~100
> tokens for an LLM is a single unknown token for the BERT and DeBERTa classifiers that are supposed to
> catch it.
>
> Attendees will watch a hidden instruction in a GitHub issue get stopped before an AI agent in CI reads
> it, decode a PDF's invisible text, compare what a browsing agent and a human see on the same page, and
> measure a classifier's tokenizer erasing a payload.

**Demo plan (25 minutes, repeatable):**
1. A pull request whose description hides an instruction in tag characters: the injex action's event gate
   fails before the AI review step runs (pre-recorded run plus live CLI).
2. Agent view on a lab page: text only an agent reads, and a link whose text and target disagree.
3. A résumé PDF with white text and an OCR layer: the Scan tab and `injex scan` decode both.
4. Tokenizer tab: the same payload under Llama 3 vs a DeBERTa injection classifier.
5. `injex mcp-audit` on a real MCP client configuration, then `injex mcp-proxy` stripping hidden text from a
   tool result.

**Requirements:** a projector (HDMI); internet optional (everything runs offline).

**Code / licence:** https://github.com/0xnookie/injex · AGPL-3.0-or-later

**Presenter bio:** _(name, affiliation, one or two sentences on prior work)_
