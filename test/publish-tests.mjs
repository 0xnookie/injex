// Tests for what publishing relies on: package.json for npm, server.json for the MCP Registry (rules of the
// 2025-12-11 schema), the MCP Bundle manifest (tools/build-mcpb.mjs) and the server ignoring an unset root.

import { readFileSync, existsSync } from 'node:fs';
import { mcpbManifest, updateServerJson } from '../tools/build-mcpb.mjs';
import { thinAction, blockKeys } from '../tools/build-injex-action.mjs';
import { TOOLS } from '../cli/mcp.mjs';

export default async function register({ test, assert, cli }) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));

  test('publish: package.json is ready for npm', () => {
    assert.equal(pkg.name, '@0xnookie/injex');
    assert.equal(pkg.private, undefined, 'not private');
    assert.equal(pkg.mcpName, server.name, 'mcpName proves the MCP Registry name');
    assert.equal(pkg.publishConfig.access, 'public');
    assert.equal(pkg.publishConfig.provenance, true);
    assert.match(pkg.repository.url, /^git\+https:\/\/github\.com\/0xnookie\/injex\.git$/, 'provenance needs the exact repository URL');
    for (const f of ['cli/', 'src/core/', 'src/data/', 'src/transforms/', 'vendor/gpt-tokenizer/', 'server.json']) assert.ok(pkg.files.includes(f), f);
    assert.ok(pkg.files.includes('!**/__pycache__/'), 'no Python caches from contrib/');
    assert.deepEqual(pkg.dependencies, undefined, 'no runtime dependencies');
  });

  test('publish: server.json follows the MCP Registry rules', () => {
    assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    assert.match(server.name, /^io\.github\.0xnookie\/[a-zA-Z0-9._-]+$/);
    assert.ok(server.description.length >= 1 && server.description.length <= 100, `description is ${server.description.length} characters (max 100)`);
    assert.deepEqual(server.repository, { url: 'https://github.com/0xnookie/injex', source: 'github' });
    assert.equal(server.version, pkg.version);
    const npm = server.packages.find((p) => p.registryType === 'npm');
    assert.deepEqual([npm.identifier, npm.version, npm.transport.type], [pkg.name, pkg.version, 'stdio']);
    assert.deepEqual(npm.packageArguments, [{ type: 'positional', value: 'mcp' }]);
    const b = server.packages.find((p) => p.registryType === 'mcpb');
    assert.equal(b.identifier, `https://github.com/0xnookie/injex/releases/download/v${pkg.version}/injex-mcp-${pkg.version}.mcpb`);
    assert.match(b.identifier.split('/').pop(), /mcp/, 'the registry wants "mcp" in the bundle name');
    assert.match(b.fileSha256, /^[a-f0-9]{64}$/);
    for (const p of server.packages) for (const k of ['registryType', 'identifier', 'transport']) assert.ok(p[k], `${p.registryType}: ${k}`);

    const next = updateServerJson(server, { version: '9.8.7', sha256: 'ab'.repeat(32) });
    assert.equal(next.version, '9.8.7');
    assert.equal(next.packages.find((p) => p.registryType === 'npm').version, '9.8.7');
    assert.deepEqual(
      [next.packages.find((p) => p.registryType === 'mcpb').identifier, next.packages.find((p) => p.registryType === 'mcpb').fileSha256],
      ['https://github.com/0xnookie/injex/releases/download/v9.8.7/injex-mcp-9.8.7.mcpb', 'ab'.repeat(32)],
    );
    assert.equal(server.version, pkg.version, 'updateServerJson does not change its input');
  });

  test('publish: MCP Bundle manifest (manifest_version 0.3)', () => {
    const m = mcpbManifest(pkg, TOOLS);
    for (const k of ['manifest_version', 'name', 'version', 'description', 'author', 'server']) assert.ok(m[k], k);
    assert.equal(m.manifest_version, '0.3');
    assert.equal(m.version, pkg.version);
    assert.ok(m.author.name);
    assert.equal(m.server.type, 'node');
    assert.equal(m.server.entry_point, 'server/cli/injex.mjs');
    assert.deepEqual(m.server.mcp_config.args.slice(0, 2), ['${__dirname}/server/cli/injex.mjs', 'mcp']);
    assert.equal(m.user_config.root.type, 'directory');
    assert.equal(m.user_config.root.required, false);
    assert.deepEqual(m.tools.map((t) => t.name), TOOLS.map((t) => t.name));
    assert.ok(m.tools.every((t) => t.description && t.description.length <= 80), 'short descriptions for install screens');
    assert.deepEqual(m.compatibility.runtimes, { node: '>=20.0.0' });
    assert.ok(existsSync(new URL('../icons/icon128.png', import.meta.url)));
  });

  test('publish: thin injex-action mirrors every input and output of action.yml', () => {
    const yml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
    const thin = thinAction(yml, 'v9.9.9');
    const inputs = blockKeys(yml, 'inputs');
    assert.ok(inputs.length >= 9 && inputs.includes('scan-event'), inputs.join(' '));
    assert.deepEqual(blockKeys(thin, 'inputs'), inputs);
    assert.deepEqual(blockKeys(thin, 'outputs'), blockKeys(yml, 'outputs'));
    assert.match(thin, /^ {6}uses: 0xnookie\/injex@v9\.9\.9$/m);
    for (const k of inputs) assert.ok(thin.includes(`        ${k}: \${{ inputs.${k} }}\n`), k);
    assert.ok(!/steps\.(scan|event)\.outputs/.test(thin), 'outputs come from the forwarding step');
  });

  test('mcp: an unexpanded --root from an MCPB host is ignored', () => {
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'scan_files', arguments: { paths: ['.'] } } },
    ];
    const r = cli(['mcp', '--root', '${user_config.root}', '--root', ''], msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
    const res = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(res[0].result.serverInfo.name, 'injex');
    assert.ok(!res[1].result.isError, res[1].result.content?.[0]?.text);
  });
}
