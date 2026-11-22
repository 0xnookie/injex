// MCP supply-chain audit: what MCP servers tell a model about their tools. Tool, prompt and resource
// definitions go straight into the model's context, so a poisoned description is a prompt injection that
// runs before any tool is called ("line jumping"). Checks every string in a tools/list (and
// prompts/list, resources/list) result for hidden text, terminal escape codes, coercive or
// instruction-like phrasing, references to secrets, tool shadowing, parameters shaped to collect the
// conversation or credentials, encoded blobs and exfiltration shapes. Pins definitions in a lockfile and
// reports what changed since (a "rug pull"). Pure and offline; connecting to servers is the CLI's job.

import { scanText, SEVERITY_ORDER, visualize } from './scan.js';
import { instructionSignals } from './instructions.js';
import { findExfil } from './exfil.js';
import { sha256, stableJson } from './hash.js';

export const MCP_RULES = {
  'hidden-text': { severity: 'critical', label: 'hidden text in a tool definition' },
  'ansi-escape': { severity: 'high', label: 'terminal escape codes (can hide text from the person approving the tool)' },
  coercive: { severity: 'high', label: 'coercive phrasing aimed at the model (“line jumping”)' },
  instructions: { severity: 'high', label: 'reads like instructions to the model' },
  'sensitive-path': { severity: 'high', label: 'mentions secrets or agent configuration files' },
  shadowing: { severity: 'high', label: 'tries to change how another tool is used (tool shadowing)' },
  'duplicate-name': { severity: 'medium', label: 'the same tool name in more than one server' },
  'exfil-param': { severity: 'high', label: 'parameter asks for the conversation, the system prompt, files or credentials' },
  'exfil-shape': { severity: 'high', label: 'exfiltration shape in a tool definition' },
  'encoded-blob': { severity: 'medium', label: 'encoded blob in a tool definition' },
  'long-description': { severity: 'low', label: 'unusually long description' },
  'new-server': { severity: 'medium', label: 'server not in the lockfile' },
  'new-item': { severity: 'medium', label: 'tool / prompt / resource not in the lockfile' },
  changed: { severity: 'high', label: 'definition changed since it was pinned (rug pull?)' },
  'changed-hidden': { severity: 'critical', label: 'definition changed only in what a reader can’t see' },
  removed: { severity: 'low', label: 'pinned definition no longer offered' },
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[PX^_][\s\S]*?\u001b\\|\u009b[0-9;?]*[@-~]/;
const COERCIVE = /<\s*\/?\s*(?:important|system|instructions?|critical|secret|hidden|note)\s*>|\b(?:before (?:using|calling|you use|you call) (?:any|this|other|the \w+) tools?|always (?:call|use|invoke|run|include|pass|send)\b|you (?:must|have to|need to) (?:always|first|also)\b|do not (?:mention|tell|reveal|inform|notify)(?: this)?(?: to)? (?:the )?user|don'?t (?:mention|tell) (?:the )?user|(?:this|it) is (?:very |extremely |critically )?important (?:that|to)|ignore (?:any|all|the) (?:other|previous)|otherwise the (?:tool|system|application) will (?:crash|fail|break)|the user (?:already )?(?:knows|agreed|approved))/i;
const SENSITIVE = /~\/\.ssh|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|(?:^|[\s"'`(/])\.env\b|\bmcp\.json\b|claude_desktop_config|\.cursor\/|\.claude\/|\.npmrc|\.netrc|\/etc\/(?:passwd|shadow)|\bprivate key\b|\bapi[_ -]?keys?\b|\bsecrets? file\b|keychain|\.git-credentials/i;
const COLLECT = /\b(?:full|entire|whole|complete|all) (?:conversation|chat(?: history)?|message history|previous messages|context)\b|\bsystem prompt\b|\b(?:contents?|text) of (?:~|\/|the (?:file|files|repo)|any file)|\b(?:api keys?|passwords?|credentials|access tokens?|session cookies?|ssh keys?)\b|\b(?:paste|include|put|copy) (?:here |in this field )?(?:everything|all|the (?:whole|full))\b/i;
const COLLECT_NAME = /^(?:sidenote|side_note|note|notes|context|conversation|history|chat|chat_history|memory|system_prompt|systemprompt|feedback|debug|metadata|extra|extra_info|reasoning|thoughts|summary_of_conversation)$/i;
const BLOB = /[A-Za-z0-9+/]{48,}={0,2}/;

/**
 * Normalise what a client got from servers into { servers: [{ name, version?, tools, prompts, resources, resourceTemplates }] }.
 * Accepts a tools/list result ({ tools }), a JSON-RPC response ({ result: { tools } }), an array of tools,
 * { servers: { name: { tools, prompts … } } } or { name: { tools … } }.
 */
const isNormalized = (x) => Array.isArray(x?.servers) && x.servers.every((s) => s && Array.isArray(s.tools) && Array.isArray(s.prompts) && Array.isArray(s.resources));

export function normalizeManifest(input, name = 'server') {
  if (isNormalized(input)) return input;
  let m = typeof input === 'string' ? JSON.parse(input) : input;
  if (m?.result && (m.result.tools || m.result.prompts || m.result.resources)) m = m.result;
  const one = (n, x) => ({ name: n, version: x?.serverInfo?.version || x?.version || '', tools: x?.tools || [], prompts: x?.prompts || [], resources: x?.resources || [], resourceTemplates: x?.resourceTemplates || [] });
  if (Array.isArray(m)) return { servers: [one(name, { tools: m })] };
  if (m?.servers && typeof m.servers === 'object' && !Array.isArray(m.servers)) return { servers: Object.entries(m.servers).map(([n, x]) => one(n, x)) };
  if (Array.isArray(m?.servers)) return { servers: m.servers.map((x, i) => one(x.name || `server ${i + 1}`, x)) };
  if (m && (m.tools || m.prompts || m.resources)) return { servers: [one(name, m)] };
  if (m && typeof m === 'object' && Object.values(m).every((x) => x && typeof x === 'object' && (x.tools || x.prompts || x.resources))) return { servers: Object.entries(m).map(([n, x]) => one(n, x)) };
  throw new Error('not an MCP manifest: expected tools/list output, an array of tools, or { servers: { name: { tools } } }');
}

/** Every string in a definition with its field path: [{ field, text }]. */
function strings(item, prefix = '') {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === 'string') out.push({ field: path, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(item, prefix);
  return out;
}

/** Schema properties: [{ name, description, path }] (nested objects included). */
function properties(schema, path = 'inputSchema') {
  const out = [];
  for (const [n, p] of Object.entries(schema?.properties || {})) {
    out.push({ name: n, description: String(p?.description || ''), path: `${path}.properties.${n}` });
    if (p?.properties) out.push(...properties(p, `${path}.properties.${n}`));
    if (p?.items?.properties) out.push(...properties(p.items, `${path}.properties.${n}.items`));
  }
  return out;
}

const itemsOf = (s) => [...s.tools.map((x) => ['tool', x]), ...s.prompts.map((x) => ['prompt', x]), ...s.resources.map((x) => ['resource', x]), ...s.resourceTemplates.map((x) => ['resource template', x])];
const itemName = (kind, x) => x?.name || x?.uri || x?.uriTemplate || '(unnamed)';

/**
 * Findings for a manifest: { kind: 'mcp-tool', rule, severity, server, item, field, payload, note }.
 */
export function auditManifest(input) {
  const { servers } = normalizeManifest(input);
  const out = [];
  const allTools = new Map(); // tool name → servers
  for (const s of servers) for (const t of s.tools) if (t?.name) allTools.set(t.name, [...(allTools.get(t.name) || []), s.name]);
  const add = (s, kind, x, rule, field, payload, extra = {}) => {
    const r = MCP_RULES[rule];
    out.push({ kind: 'mcp-tool', rule, severity: extra.severity || r.severity, server: s.name, item: `${kind} ${itemName(kind, x)}`, field, count: 1, payload: String(payload ?? '').slice(0, 600), note: `${r.label}${extra.why ? ` — ${extra.why}` : ''}`, ...(extra.signals ? { signals: extra.signals, instructions: true } : {}) });
  };
  for (const s of servers) {
    const otherTools = [...allTools.keys()].filter((n) => !s.tools.some((t) => t.name === n) && n.length >= 4);
    for (const [kind, x] of itemsOf(s)) {
      for (const { field, text } of strings(x)) {
        if (!text || text.length < 2) continue;
        for (const f of scanText(text, { exfil: false })) {
          if (f.kind === 'homoglyph' && f.severity === 'low') continue;
          add(s, kind, x, 'hidden-text', field, f.payload || `${f.ctx?.before || ''}${f.ctx?.match || ''}${f.ctx?.after || ''}`, { severity: SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.high ? 'critical' : 'high', why: `${f.note}${f.payload ? `: “${visualize(f.payload, 120)}”` : ''}` });
        }
        if (ANSI.test(text)) add(s, kind, x, 'ansi-escape', field, visualize(text.replace(/\u001b/g, '⟨ESC⟩'), 300));
        const coercive = COERCIVE.exec(text);
        const sig = instructionSignals(text);
        if (coercive) add(s, kind, x, 'coercive', field, text, { why: `“${coercive[0]}”`, ...(sig.signals.length ? { signals: sig.signals } : {}) });
        else if (sig.instructions) add(s, kind, x, 'instructions', field, text, { signals: sig.signals });
        const sens = SENSITIVE.exec(text);
        if (sens && /description|title|text|template/i.test(field)) add(s, kind, x, 'sensitive-path', field, text, { why: `“${sens[0].trim()}”` });
        for (const e of findExfil(text)) add(s, kind, x, 'exfil-shape', field, e.match, { why: e.note, severity: e.severity === 'high' ? 'high' : 'medium' });
        if (BLOB.test(text) && !/^(?:data:|https?:)/.test(text)) add(s, kind, x, 'encoded-blob', field, BLOB.exec(text)[0]);
        if (/^description$/.test(field) && text.length > 2000) add(s, kind, x, 'long-description', field, `${text.length} characters`);
        // shadowing: a description that talks about another server's tools
        if (/description/i.test(field)) {
          const named = otherTools.filter((n) => new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(text));
          if (named.length || /\b(?:when|whenever|if) (?:the user|you|anyone) (?:use|call|invoke)s? (?:the |any )?\w+ tool\b|\binstead of (?:using |calling )?(?:the )?\w+ tool\b/i.test(text)) add(s, kind, x, 'shadowing', field, text, { why: named.length ? `names ${named.slice(0, 5).join(', ')} from another server` : 'redefines how other tools are used' });
        }
      }
      if (kind === 'tool') {
        for (const p of properties(x.inputSchema)) {
          if (COLLECT.test(p.description) || (COLLECT_NAME.test(p.name) && /\b(?:all|every|full|entire|previous|conversation|context|include|anything)\b/i.test(p.description))) add(s, kind, x, 'exfil-param', `${p.path}.description`, `${p.name}: ${p.description}`);
        }
        if ((allTools.get(x.name) || []).length > 1) add(s, kind, x, 'duplicate-name', 'name', `${x.name} — also in ${allTools.get(x.name).filter((n) => n !== s.name).join(', ')}`);
      }
    }
  }
  // one finding per rule, item and field
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.server}|${f.item}|${f.field}|${f.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── pinning ──

/** A lockfile for a manifest: every definition hashed (canonical JSON). */
export function lockManifest(input, { configs = {} } = {}) {
  const { servers } = normalizeManifest(input);
  const lock = { schema: 'injex.mcp-lock/1', servers: {} };
  for (const s of servers) {
    const items = {};
    for (const [kind, x] of itemsOf(s)) items[`${kind}:${itemName(kind, x)}`] = { sha256: sha256(stableJson(x)), description: String(x.description || '').slice(0, 2000) };
    lock.servers[s.name] = { ...(s.version ? { version: s.version } : {}), ...(configs[s.name] ? { config_sha256: sha256(stableJson(configs[s.name])) } : {}), items };
  }
  return lock;
}

/**
 * What changed between a lockfile and the current manifest. `compare(a, b)` (optional) classifies a
 * description change: returns 'hidden' when only invisible characters / look-alikes differ.
 */
export function diffLock(lock, input, { compare, configs = {} } = {}) {
  const now = lockManifest(input, { configs });
  const out = [];
  const add = (rule, server, item, payload, why = '') => out.push({ kind: 'mcp-drift', rule, severity: MCP_RULES[rule].severity, server, item, field: '', count: 1, payload: String(payload ?? '').slice(0, 600), note: MCP_RULES[rule].label + (why ? ` — ${why}` : '') });
  for (const [name, s] of Object.entries(now.servers)) {
    const was = lock?.servers?.[name];
    if (!was) {
      add('new-server', name, '', `${Object.keys(s.items).length} definitions`);
      continue;
    }
    if (was.config_sha256 && s.config_sha256 && was.config_sha256 !== s.config_sha256) add('changed', name, 'server config', 'the server’s command, arguments or URL changed');
    for (const [k, v] of Object.entries(s.items)) {
      const old = was.items?.[k];
      if (!old) add('new-item', name, k, v.description);
      else if (old.sha256 !== v.sha256) {
        const kindOf = compare && old.description !== v.description ? compare(old.description, v.description) : '';
        const why = old.description !== v.description ? `description was “${visualize(old.description, 120)}”, now “${visualize(v.description, 120)}”` : 'schema or annotations changed';
        add(kindOf === 'hidden' ? 'changed-hidden' : 'changed', name, k, v.description, why);
      }
    }
    for (const k of Object.keys(was.items || {})) if (!s.items[k]) add('removed', name, k, was.items[k].description);
  }
  return out;
}
