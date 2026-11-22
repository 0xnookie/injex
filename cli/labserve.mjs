// `injex lab serve` and `injex lab mcp`: put a lab folder (written by `injex lab`) in front of an agent.
//   serve  the corpus over HTTP on this machine; every request is logged, and a canary in a URL, body or
//          referer (an agent rendering the exfil-image carriers, or posting what it read) is flagged
//   mcp    a mock MCP server on stdio whose get_weather tool carries one of the lab's MCP-manifest carriers
//          in its definition and one of its tool-output carriers in its result; every call is logged, and a
//          canary in tool arguments is flagged (--sink adds a send_message tool an agent could misuse)

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { findCanary } from '../src/core/canary.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.eml': 'message/rfc822', '.ics': 'text/calendar', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.mdc': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The lab manifest of a folder written by `injex lab`. */
export function readLabManifest(dir) {
  const p = join(dir, 'lab-manifest.json');
  if (!existsSync(p)) throw new Error(`${dir} is not an injex lab (no lab-manifest.json): create one with injex lab ${dir}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

const hits = (watch, text) => watch.map((t) => ({ token: t, ...findCanary(text, t) })).filter((h) => h.found).map((h) => ({ token: h.token, how: h.how }));

/**
 * An HTTP server (not yet listening) for a lab folder: files are served as they are; any other path is a
 * collector (a 1×1 GIF for image requests). Every request goes to `log` as an object; canaries (the lab's
 * and `tokens`) found in the URL, body or referer are listed under `canary`.
 */
export function createLabServer(dir, { tokens = [], log = () => {} } = {}) {
  const root = resolve(dir);
  const watch = [...new Set([...(existsSync(join(root, 'lab-manifest.json')) ? [readLabManifest(root).canary] : []), ...tokens].filter(Boolean))];
  return createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= 64 * 1024) chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let url = req.url || '/';
      let path = '/';
      try {
        path = decodeURIComponent(new URL(req.url || '/', 'http://lab').pathname);
        url = decodeURIComponent(url);
      } catch {
        /* keep the raw URL */
      }
      const canary = hits(watch, `${req.method} ${url}\n${req.headers.referer || ''}\n${body}`);
      let file = resolve(root, '.' + path);
      let served = null;
      let status = 200;
      if (file !== root && !file.startsWith(root + sep)) status = 403;
      else {
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (existsSync(file) && statSync(file).isFile()) served = relative(root, file).replace(/\\/g, '/');
      }
      if (status === 403) res.writeHead(403, { 'content-type': 'text/plain' }).end('outside the lab\n');
      else if (served) res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
      else if (/\.(png|gif|jpe?g|webp|svg)(\?|$)/i.test(req.url || '') || /image/.test(req.headers.accept || '')) res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' }).end(GIF);
      else res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok\n');
      log({ time: new Date().toISOString(), method: req.method, url: req.url, status, served, headers: { 'user-agent': req.headers['user-agent'] || '', referer: req.headers.referer || '' }, ...(body ? { body: body.slice(0, 8000) } : {}), ...(canary.length ? { canary } : {}) });
    });
  });
}

const CLEAN_TOOL = { name: 'get_weather', description: 'Weather for a city.', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };
const SINK_TOOL = { name: 'send_message', description: 'Send a message to someone on behalf of the user.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'body'] } };

/**
 * The mock MCP server's decisions (tested without processes). o: { technique: an mcp-manifest technique
 * or 'clean', output: a tool-output technique or 'clean', sink: add send_message, tokens, version, log }.
 * handle(message) → the response object, or null for notifications.
 */
export function labMcpLogic(dir, { technique = 'mcp-line-jumping', output = 'tool-json-hidden', sink = false, tokens = [], version = '', log = () => {} } = {}) {
  const m = readLabManifest(dir);
  const watch = [...new Set([m.canary, ...tokens].filter(Boolean))];
  const fileOf = (channel, t) => m.items.find((i) => i.channel === channel && i.technique === t)?.file;
  const names = (channel) => m.items.filter((i) => i.channel === channel).map((i) => i.technique).join(', ') || 'none';
  let tool = CLEAN_TOOL;
  if (technique !== 'clean') {
    const f = fileOf('mcp-manifest', technique);
    if (!f) throw new Error(`no MCP carrier "${technique}" in this lab (${names('mcp-manifest')}, clean)`);
    tool = JSON.parse(readFileSync(join(dir, f), 'utf8')).tools[0];
  }
  let result = JSON.stringify({ city: 'Berlin', forecast: 'Sunny, 21 °C' }, null, 2) + '\n';
  if (output !== 'clean') {
    const f = fileOf('tool-output', output);
    if (!f) throw new Error(`no tool-output carrier "${output}" in this lab (${names('tool-output')}, clean)`);
    result = readFileSync(join(dir, f), 'utf8');
  }
  const tools = [tool, ...(sink ? [SINK_TOOL] : [])];
  const ok = (id, r) => ({ jsonrpc: '2.0', id, result: r });
  return {
    tools,
    canary: m.canary,
    handle(msg) {
      if (!msg || typeof msg.method !== 'string') return null;
      const { id, method, params = {} } = msg;
      if (id === undefined) return null; // notifications
      if (method === 'initialize') return ok(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'injex-lab', title: 'injex lab — mock tools carrying test injections', version } });
      if (method === 'ping') return ok(id, {});
      if (method === 'tools/list') {
        log({ event: 'tools/list', tools: tools.map((t) => t.name), technique });
        return ok(id, { tools });
      }
      if (method === 'tools/call') {
        const args = params.arguments ?? {};
        const canary = hits(watch, JSON.stringify(args));
        log({ event: 'tools/call', tool: params.name, arguments: args, ...(canary.length ? { canary } : {}) });
        if (params.name === tool.name) return ok(id, { content: [{ type: 'text', text: result }], isError: false });
        if (sink && params.name === 'send_message') return ok(id, { content: [{ type: 'text', text: 'Message sent.' }], isError: false });
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${params.name}` } };
      }
      if (method === 'resources/list') return ok(id, { resources: [] });
      if (method === 'prompts/list') return ok(id, { prompts: [] });
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
    },
  };
}

/** Run the mock MCP server on stdio. */
export async function serveLabMcp(dir, o) {
  const logic = labMcpLogic(dir, o);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      continue;
    }
    const r = logic.handle(msg);
    if (r) process.stdout.write(JSON.stringify(r) + '\n');
  }
  return 0;
}
