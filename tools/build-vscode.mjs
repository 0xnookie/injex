// Builds the VS Code / Open VSX extension (vscode/) into a .vsix without vsce:
//   node tools/build-vscode.mjs        → dist/injex-vscode-<version>.vsix (staged in dist/vscode/)
// The extension gets injex's core modules under extension/core/ (an ES-module package of its own) and the
// version of the root package.json. Publish with `npx @vscode/vsce publish --packagePath <vsix>` and
// `npx ovsx publish <vsix>` (tokens needed; not done here).

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = ['src/core', 'src/data', 'src/transforms'];
const TYPES = { '.json': 'application/json', '.js': 'application/javascript', '.mjs': 'application/javascript', '.md': 'text/markdown', '.txt': 'text/plain', '.png': 'image/png', '.vsixmanifest': 'text/xml', '.xml': 'text/xml' };

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** extension.vsixmanifest for an extension package.json. */
export function vsixManifest(ext) {
  const repo = ext.repository?.url || '';
  const prop = (id, v) => `      <Property Id="${id}" Value="${xml(v)}" />`;
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(ext.name)}" Version="${xml(ext.version)}" Publisher="${xml(ext.publisher)}" />
    <DisplayName>${xml(ext.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(ext.description)}</Description>
    <Tags>${xml((ext.keywords || []).join(','))}</Tags>
    <Categories>${xml((ext.categories || []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
${[
  prop('Microsoft.VisualStudio.Code.Engine', ext.engines.vscode),
  prop('Microsoft.VisualStudio.Code.ExtensionDependencies', ''),
  prop('Microsoft.VisualStudio.Code.ExtensionPack', ''),
  prop('Microsoft.VisualStudio.Code.ExtensionKind', 'workspace'),
  prop('Microsoft.VisualStudio.Code.LocalizedLanguages', ''),
  prop('Microsoft.VisualStudio.Services.Links.Source', repo),
  prop('Microsoft.VisualStudio.Services.Links.GitHub', repo),
  prop('Microsoft.VisualStudio.Services.Links.Support', ext.bugs || ''),
  prop('Microsoft.VisualStudio.Services.Links.Learn', ext.homepage || ''),
  prop('Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown', 'true'),
  prop('Microsoft.VisualStudio.Services.Content.Pricing', 'Free'),
].join('\n')}
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes(names) {
  const exts = [...new Set(names.map((n) => extname(n).toLowerCase()).filter(Boolean))].sort();
  return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${exts.map((e) => `<Default Extension="${e}" ContentType="${TYPES[e] || 'application/octet-stream'}" />`).join('')}</Types>\n`;
}

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Stage dist/vscode/ and write the .vsix. → { file, version, stage } */
export function buildVsix({ outDir = join(ROOT, 'dist') } = {}) {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const ext = { ...JSON.parse(readFileSync(join(ROOT, 'vscode', 'package.json'), 'utf8')), version: root.version };
  const stage = join(outDir, 'vscode');
  const dir = join(stage, 'extension');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(dir, 'core'), { recursive: true });
  for (const f of ['extension.js', 'analyze.js', 'README.md']) cpSync(join(ROOT, 'vscode', f), join(dir, f));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(ext, null, 2) + '\n');
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE.txt'));
  cpSync(join(ROOT, 'icons', 'icon128.png'), join(dir, 'icon.png'));
  for (const p of CORE) cpSync(join(ROOT, p), join(dir, 'core', p), { recursive: true });
  writeFileSync(join(dir, 'core', 'package.json'), JSON.stringify({ type: 'module', private: true }) + '\n');
  writeFileSync(join(stage, 'extension.vsixmanifest'), vsixManifest(ext));
  const names = files(stage).map((p) => relative(stage, p).split(sep).join('/'));
  writeFileSync(join(stage, '[Content_Types].xml'), contentTypes(names));
  const entries = files(stage)
    .map((p) => relative(stage, p).split(sep).join('/'))
    .sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a.localeCompare(b)))
    .map((name) => ({ name, data: readFileSync(join(stage, name)) }));
  const file = join(outDir, `injex-vscode-${ext.version}.vsix`);
  writeFileSync(file, zip(entries));
  return { file, version: ext.version, stage };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  const r = buildVsix();
  console.log(`${relative(process.cwd(), r.file)}  ${(statSync(r.file).size / 1024).toFixed(0)} KB`);
}
