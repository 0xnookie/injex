# injex for VS Code

Find, decode and remove hidden text in the files you edit — the text people can't see but AI models read.

- **Problems as you type**: Unicode tag characters, emoji and invisible-bit steganography, zero-width runs,
  bidi overrides (Trojan Source), invisible letters, look-alike and mixed-script words, hidden HTML /
  Markdown comments that read like instructions, leak-shaped links and encoded payloads. Agent instruction
  files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `copilot-instructions.md` …) are judged harder.
- **Decoded inline and on hover**: what a run of invisible characters says is shown after it, and the hover
  explains the technique, whether it reads like instructions to a model, and taxonomy tags (OWASP LLM01,
  MITRE ATLAS).
- **Quick fix** (Ctrl+.): *Remove hidden characters here*, or in the whole file. Flag emoji and joiners
  that belong to a script stay.
- **Agent configuration audit**: auto-approve ("YOLO mode") settings, project hooks, folder-open tasks,
  MCP servers launched from unpinned packages or over plain HTTP, API base-URL overrides, lifecycle
  scripts and AI steps in CI workflows — each mapped to the CVE it reproduces.
- **Workspace scan** (*injex: Scan the workspace for hidden text*): every text file, plus PDF, Word,
  Excel, PowerPoint, OpenDocument, RTF, e-mail and calendar files and image metadata.
- **Decode selection**: hidden payloads, Base64, ROT13, hex and the other layers injex's universal decoder
  peels.

Everything runs locally inside VS Code. The extension reads files; it never runs workspace code, so it also
works in untrusted (Restricted Mode) workspaces. Nothing is sent anywhere.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `injex.enable` | `true` | Check open files |
| `injex.minSeverity` | `low` | Only report findings at least this severe |
| `injex.scanOnType` | `true` | Check again while typing (otherwise on open / save) |
| `injex.showDecoded` | `true` | Show hidden characters and decoded text inline |
| `injex.auditAgentConfig` | `true` | Audit AI-agent configuration files |
| `injex.maxFileSize` / `injex.maxDocumentSize` / `injex.maxFiles` | 2 MB / 50 MB / 5000 | Workspace scan limits |

The same scanner runs in the [injex browser extension, CLI, GitHub Action, pre-commit hook and MCP
server](https://github.com/0xnookie/injex). Licence: AGPL-3.0-or-later.
