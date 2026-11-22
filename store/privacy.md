# injex privacy policy

_Applies to the injex browser extension, command-line tool, GitHub Action, MCP server and VS Code extension._

**The developer collects no data.** injex has no server, no analytics, no telemetry and no accounts.

## What stays on your device

Everything injex does — encoding and decoding, scanning pages, pastes, files and documents, the character
inspector, tokenizers (including a tokenizer.json you load) — runs locally. Settings, favourites, recipes,
alphabets and the copy history are stored in your browser's extension storage; a loaded tokenizer.json in
the extension's IndexedDB. You can delete all of it by removing the extension, and export it with Backup.

## The one exception: optional AI tools

The AI tools in the extension (prompt crafting, classifier testing, translation, alphabet generation) are
off until you add your own OpenRouter API key. When you use one, the text you give it and your key are sent
from your browser directly to openrouter.ai, under OpenRouter's privacy policy. The model list can be loaded
from openrouter.ai without a key. Nothing goes through the developer.

The command-line `injex run` and `injex import --fetch` commands contact the model endpoint or Hugging Face
dataset you name, only when you run them.

## Permissions

Page access is used only to scan the page you click (or, if you switch on live scan or the paste guard, the
sites you allow) — locally. See the store listing or `manifest.json` for each permission's purpose.

Contact: https://github.com/0xnookie/injex/issues
