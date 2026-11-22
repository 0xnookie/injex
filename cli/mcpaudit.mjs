// `injex mcp-audit`: audit the MCP servers an AI client is configured with. Reads the known client
// configuration files (project and user level), checks each server entry (unpinned packages, shell
// one-liners, remote scripts, plain-HTTP URLs, inline secrets, auto-trust), and checks what the servers
// tell the model — from a saved tools/list (--manifest) or, only with --connect, by starting each server
// and asking it. --lock writes a lockfile of every definition; --check compares against it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseJsonc } from '../src/core/jsonc.js';
import { auditFile, mcpServersOf } from '../src/core/audit.js';
import { auditManifest, normalizeManifest, lockManifest, diffLock } from '../src/core/mcpaudit.js';
import { toRel } from './files.mjs';

const PROJECT_CONFIGS = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.vscode/settings.json', '.gemini/settings.json', '.roo/mcp.json', '.kiro/settings/mcp.json', '.amazonq/mcp.json', '.windsurf/mcp_config.json', '.zed/settings.json', '.codex/config.toml'];

/** User-level client configs on this machine (Claude Desktop, Claude Code, Cursor, Windsurf, Gemini CLI, Codex, VS Code). */
export function userConfigs(env = process.env, home = homedir()) {
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  return [
    join(appData, 'Claude', 'claude_desktop_config.json'),
    join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    join(home, '.claude.json'),
    join(home, '.cursor', 'mcp.json'),
    join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    join(home, '.gemini', 'settings.json'),
    join(home, '.codex', 'config.toml'),
    join(appData, 'Code', 'User', 'mcp.json'),
    join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
    join(home, '.config', 'Code', 'User', 'mcp.json'),
  ];
}

/** Servers from a config file: [{ name, entry }] (TOML: Codex [mcp_servers.x] tables). */
export function serversInFile(path, text) {
  if (/\.toml$/i.test(path)) {
    const out = [];
    for (const m of text.matchAll(/^[ \t]*\[mcp_servers\.([^\]]+)\][ \t]*\r?\n((?:(?![ \t]*\[)[^\n]*\n?)*)/gm)) {
      const command = /^\s*command\s*=\s*"([^"]*)"/m.exec(m[2])?.[1] || '';
      const args = (/^\s*args\s*=\s*\[([^\]]*)\]/m.exec(m[2])?.[1] || '').match(/"([^"]*)"/g)?.map((x) => x.slice(1, -1)) || [];
      const url = /^\s*url\s*=\s*"([^"]*)"/m.exec(m[2])?.[1];
      out.push({ name: m[1].replace(/^"|"$/g, ''), entry: { command, args, ...(url ? { url } : {}) } });
    }
    return out;
  }
  const { value } = parseJsonc(text);
  return mcpServersOf(value).map((s) => ({ name: s.name, entry: s.entry }));
}

// ── talking to servers (only with --connect) ──

function rpcStdio(entry, { timeout = 20000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const win = process.platform === 'win32';
    const cmd = String(entry.command || '');
    const args = (entry.args || []).map(String);
    // Windows: npx / uvx are .cmd shims that need a shell; quote every argument for cmd.exe
    const useShell = win && !/\.(?:exe|com)$/i.test(cmd) && !/[\\/]/.test(cmd);
    const q = (a) => (/^[\w@./:=+-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
    const child = useShell ? spawn([cmd, ...args].map(q).join(' '), { shell: true, env: { ...process.env, ...(entry.env || {}) }, cwd: entry.cwd || process.cwd(), windowsHide: true }) : spawn(cmd, args, { env: { ...process.env, ...(entry.env || {}) }, cwd: entry.cwd || process.cwd(), windowsHide: true });
    let buf = '';
    let id = 0;
    const waiting = new Map();
    const timer = setTimeout(() => finish(new Error(`no answer within ${timeout / 1000} s`)), timeout);
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
        child.kill();
      } catch {
        /* gone */
      }
      err ? reject(err) : resolvePromise(val);
    };
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => setTimeout(() => finish(new Error(`server exited (${code}) before answering`)), 50));
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && waiting.has(msg.id)) {
            waiting.get(msg.id)(msg);
            waiting.delete(msg.id);
          }
        } catch {
          /* log output on stdout */
        }
      }
    });
    child.stderr.on('data', () => {});
    const call = (method, params = {}) =>
      new Promise((res) => {
        const i = ++id;
        waiting.set(i, res);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
      });
    (async () => {
      const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'injex-mcp-audit', version: '1' } });
      if (init.error) throw new Error(init.error.message);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const caps = init.result?.capabilities || {};
      const list = async (method, key) => {
        const items = [];
        let cursor;
        for (let page = 0; page < 20; page++) {
          const r = await call(method, cursor ? { cursor } : {});
          if (r.error) break;
          items.push(...(r.result?.[key] || []));
          cursor = r.result?.nextCursor;
          if (!cursor) break;
        }
        return items;
      };
      const tools = caps.tools ? await list('tools/list', 'tools') : [];
      const prompts = caps.prompts ? await list('prompts/list', 'prompts') : [];
      const resources = caps.resources ? await list('resources/list', 'resources') : [];
      finish(null, { serverInfo: init.result?.serverInfo, instructions: init.result?.instructions, tools, prompts, resources });
    })().catch((e) => finish(e));
  });
}

async function rpcHttp(entry, { timeout = 20000 } = {}) {
  const url = entry.url || entry.serverUrl || entry.httpUrl;
  let session = '';
  let id = 0;
  const call = async (method, params = {}, notify = false) => {
    const ctl = AbortSignal.timeout(timeout);
    const res = await fetch(url, { method: 'POST', signal: ctl, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}), 'mcp-protocol-version': '2025-06-18', ...(entry.headers || {}) }, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params }) });
    session = res.headers.get('mcp-session-id') || session;
    if (notify) return null;
    const text = await res.text();
    if (/text\/event-stream/.test(res.headers.get('content-type') || '')) {
      for (const line of text.split('\n')) if (line.startsWith('data:')) {
        try {
          const m = JSON.parse(line.slice(5));
          if (m.id === id) return m;
        } catch {
          /* keep looking */
        }
      }
      throw new Error('no JSON-RPC answer in the event stream');
    }
    return JSON.parse(text);
  };
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'injex-mcp-audit', version: '1' } });
  if (init.error) throw new Error(init.error.message);
  await call('notifications/initialized', {}, true);
  const caps = init.result?.capabilities || {};
  const tools = caps.tools ? (await call('tools/list')).result?.tools || [] : [];
  const prompts = caps.prompts ? (await call('prompts/list')).result?.prompts || [] : [];
  const resources = caps.resources ? (await call('resources/list')).result?.resources || [] : [];
  return { serverInfo: init.result?.serverInfo, instructions: init.result?.instructions, tools, prompts, resources };
}

/** Ask one configured server for its tools, prompts and resources. */
export function fetchManifest(entry, opts) {
  return entry.url || entry.serverUrl || entry.httpUrl ? rpcHttp(entry, opts) : rpcStdio(entry, opts);
}

/**
 * Run the audit. Returns a scan-style result ({ files: [{ file, findings }] … }) plus { servers, lock }.
 * o: { configs: string[], user: boolean, manifest: string[], connect: boolean, lock?: string, check?: string, timeout }
 */
export async function runMcpAudit(o, { cwd = process.cwd(), log = () => {} } = {}) {
  const files = [];
  const servers = new Map(); // name → entry
  const configPaths = o.configs?.length ? o.configs.map((c) => resolve(cwd, c)) : [...PROJECT_CONFIGS.map((c) => join(cwd, c)), ...(o.user ? userConfigs() : [])];
  const read = [];
  for (const p of configPaths) {
    if (!existsSync(p)) continue;
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    read.push(p);
    const label = p.startsWith(cwd) ? toRel(p, cwd) : p.replace(homedir(), '~');
    const findings = auditFile(label.replace(/\\/g, '/'), text).filter((f) => f.kind === 'mcp-config' || /settings\.json$|config\.toml$/.test(label) === false || f.kind === 'config');
    for (const s of serversInFile(p, text)) if (!servers.has(s.name)) servers.set(s.name, s.entry);
    files.push({ file: label, findings });
  }
  const manifests = { servers: [] };
  for (const m of o.manifest || []) {
    const n = normalizeManifest(readFileSync(resolve(cwd, m), 'utf8'), m.replace(/\.json$/i, ''));
    manifests.servers.push(...n.servers);
  }
  const errors = [];
  if (o.connect) {
    for (const [name, entry] of servers) {
      log(`connecting to ${name} …`);
      try {
        const r = await fetchManifest(entry, { timeout: o.timeout || 20000 });
        manifests.servers.push({ name, version: r.serverInfo?.version || '', tools: r.tools, prompts: r.prompts, resources: r.resources, resourceTemplates: [] });
        if (r.instructions) manifests.servers.at(-1).prompts.push({ name: '(server instructions)', description: r.instructions });
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
  }
  if (manifests.servers.length) {
    const byServer = new Map();
    for (const f of auditManifest(manifests)) {
      const key = `mcp server: ${f.server}`;
      if (!byServer.has(key)) byServer.set(key, []);
      byServer.get(key).push({ ...f, line: 1, column: 1, endColumn: 2, loc: f.item + (f.field ? ` · ${f.field}` : ''), where: f.item });
    }
    for (const s of manifests.servers) files.push({ file: `mcp server: ${s.name}`, findings: byServer.get(`mcp server: ${s.name}`) || [], warnings: [] });
  }
  const configsByName = Object.fromEntries([...servers].map(([n, e]) => [n, { command: e.command, args: e.args, url: e.url }]));
  let lock = null;
  if (o.lock && manifests.servers.length) {
    lock = lockManifest(manifests, { configs: configsByName });
    writeFileSync(resolve(cwd, o.lock), JSON.stringify(lock, null, 2) + '\n');
  }
  if (o.check) {
    const old = JSON.parse(readFileSync(resolve(cwd, o.check), 'utf8'));
    const { compareTexts } = await import('../src/core/diff.js');
    const drift = diffLock(old, manifests, { configs: configsByName, compare: (a, b) => compareTexts(a, b).verdict });
    files.push({ file: `lockfile: ${o.check}`, findings: drift.map((f) => ({ ...f, line: 1, column: 1, endColumn: 2, loc: `${f.server} · ${f.item}`, where: f.server })) });
  }
  return { files, read, servers: [...servers.keys()], manifests: manifests.servers.length, errors, lock };
}
