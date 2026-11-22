# Distribution notes

Everything needed to list and announce injex; none of it ships in a package.

| File | For |
|---|---|
| `chrome-web-store.md` | Chrome Web Store and Microsoft Edge Add-ons: listing text, single purpose, permission justifications, data disclosures, reviewer notes |
| `firefox-amo.md` | addons.mozilla.org: listing, source-code notes, the open data-collection decision |
| `privacy.md` | The privacy policy the store forms link to |
| `launch.md` | Write-up, short posts, lists and catalogues to submit to |
| `arsenal.md` | Black Hat Arsenal / DEF CON Demo Labs submission |

## Release checklist

1. `node test/run-tests.mjs` and `node bench/run.mjs --check` pass; versions agree in `package.json`,
   `manifest.json`, `vscode/package.json` and `server.json` (`node tools/build-mcpb.mjs --server-json`).
2. Tag `v<version>` and push the tag: the release workflow attaches the Chrome ZIP, the Firefox ZIP, the MCP
   bundle (`.mcpb`) and the VS Code extension (`.vsix`).
3. Opt-in publishing, each switched on with a repository variable once its account is set up:
   `NPM_PUBLISH` (npm trusted publishing; the first publish is manual with 2FA), `MCP_REGISTRY_PUBLISH`
   (needs npm), `GHCR_PUBLISH` (container image), `PAGES_DEPLOY` (demo page).
4. Store uploads by hand: Chrome Web Store, Edge Add-ons, AMO (with the source notes), Open VSX / VS Code
   Marketplace (`ovsx publish`, `vsce publish --packagePath`).
5. Marketplace listing for the action: tick "Publish this Action to the GitHub Marketplace" when drafting
   the release, or use the thin repository from `node tools/build-injex-action.mjs`.
