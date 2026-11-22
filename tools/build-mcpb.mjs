// Builds the MCP server as an MCP Bundle (.mcpb) for Claude Desktop and other MCPB hosts:
//   node tools/build-mcpb.mjs                 → dist/injex-mcp-<version>.mcpb
//   node tools/build-mcpb.mjs --server-json   → also writes that version and the bundle's SHA-256 into
//                                               server.json (the MCP Registry entry)
//   node tools/build-mcpb.mjs --server-json --sha-of <file.mcpb>   → the same for a bundle already built
//                                               (the release asset), without building
// The bundle holds the CLI and the core modules (injex has no dependencies) and runs `injex mcp` with the
// host's Node. The folder the person picks in the host becomes an allowed --root.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHIP = ['cli', 'src/core', 'src/data', 'src/transforms', 'vendor/gpt-tokenizer'];
const REPO = 'https://github.com/0xnookie/injex';

const firstSentence = (s) => (String(s).match(/^.*?[.!?](?=\s|$)/) || [String(s)])[0];

/** The MCPB manifest (manifest_version 0.3) for a package.json and the server's TOOLS. */
export function mcpbManifest(pkg, tools) {
  return {
    manifest_version: '0.3',
    name: 'injex',
    display_name: 'injex — hidden-text scanner',
    version: pkg.version,
    description: 'Find, remove and decode hidden text and prompt injection in text, files, PDFs, Office documents and URLs.',
    long_description:
      'injex checks what an assistant is about to read for content people cannot see: Unicode tag characters, zero-width and bidi tricks, emoji steganography, look-alike letters, white or tiny text in PDF and Word files, hidden comments, instruction-like metadata and leak-shaped links. It decodes what is hidden, cleans text, audits agent and MCP configuration, and wraps untrusted text before a model reads it. Everything runs locally; the server reads files only inside the folder you allow.',
    author: { name: '0xnookie', url: 'https://github.com/0xnookie' },
    repository: { type: 'git', url: REPO + '.git' },
    homepage: REPO,
    documentation: REPO + '#readme',
    support: REPO + '/issues',
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/cli/injex.mjs',
      mcp_config: { command: 'node', args: ['${__dirname}/server/cli/injex.mjs', 'mcp', '--root', '${user_config.root}'], env: {} },
    },
    user_config: {
      root: {
        type: 'directory',
        title: 'Folder injex may read',
        description: 'scan_files and scan_agent_config read files only inside this folder. Leave it empty to check only text the assistant passes in.',
        required: false,
      },
    },
    tools: tools.map((t) => ({ name: t.name, description: t.title || firstSentence(t.description) })), // install screens: short
    keywords: ['prompt-injection', 'hidden-text', 'unicode', 'security', 'pdf', 'docx', 'mcp-audit'],
    license: pkg.license,
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: (pkg.engines?.node || '>=20').replace(/^>=(\d+)$/, '>=$1.0.0') } },
  };
}

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === '__pycache__' ? [] : files(p)) : [p];
  });
}

/** Stage dist/mcpb/ and write the .mcpb. → { file, sha256, version, stage } */
export async function buildMcpb({ outDir = join(ROOT, 'dist') } = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const { listedTools } = await import('../cli/mcp.mjs');
  const TOOLS = await listedTools();
  const stage = join(outDir, 'mcpb');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'server'), { recursive: true });
  for (const p of SHIP) cpSync(join(ROOT, p), join(stage, 'server', p), { recursive: true });
  // the CLI reads its version from ../package.json; the core modules are ES modules
  writeFileSync(join(stage, 'server', 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license, private: true }, null, 2) + '\n');
  cpSync(join(ROOT, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(ROOT, 'icons', 'icon128.png'), join(stage, 'icon.png'));
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(mcpbManifest(pkg, TOOLS), null, 2) + '\n');
  const entries = files(stage)
    .sort()
    .map((p) => ({ name: relative(stage, p).split(sep).join('/'), data: readFileSync(p) }));
  const file = join(outDir, `injex-mcp-${pkg.version}.mcpb`);
  const data = zip(entries);
  writeFileSync(file, data);
  return { file, sha256: createHash('sha256').update(data).digest('hex'), version: pkg.version, stage };
}

/** server.json with every version, the release URL of the bundle and its SHA-256 brought up to date. */
export function updateServerJson(server, { version, sha256 }) {
  const s = structuredClone(server);
  s.version = version;
  for (const p of s.packages || []) {
    if (p.registryType === 'npm') p.version = version;
    if (p.registryType === 'mcpb') {
      p.identifier = `${REPO}/releases/download/v${version}/injex-mcp-${version}.mcpb`;
      if (sha256) p.fileSha256 = sha256;
    }
  }
  return s;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  // --sha-of <file>: hash a bundle that already exists (the one attached to the release) instead of building
  const shaOf = process.argv.includes('--sha-of') ? process.argv[process.argv.indexOf('--sha-of') + 1] : null;
  const r = shaOf
    ? { file: shaOf, sha256: createHash('sha256').update(readFileSync(shaOf)).digest('hex'), version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version }
    : await buildMcpb();
  console.log(`${relative(process.cwd(), r.file)}  ${(statSync(r.file).size / 1024).toFixed(0)} KB  sha256 ${r.sha256}`);
  if (process.argv.includes('--server-json')) {
    const path = join(ROOT, 'server.json');
    writeFileSync(path, JSON.stringify(updateServerJson(JSON.parse(readFileSync(path, 'utf8')), r), null, 2) + '\n');
    console.log('server.json updated to', r.version);
  }
}
