// Agent-configuration audit: settings in a repository that hand an AI coding agent code execution or a
// way to leak data — the pattern behind most 2025–2026 coding-agent CVEs, where a prompt injection
// writes (or a malicious repo ships) one of these files. One rule per published bug class, each with
// its CVEs. Pure: give it { file, text } pairs; findings have kind 'config' / 'mcp-config' and a line.

import { parseJsonc, locatePath, lineCol } from './jsonc.js';
import { COLLECTOR_HOSTS, isCollector, hostOf } from './exfil.js';
import { looksLikeInstructions } from './instructions.js';

export const AUDIT_RULES = {
  'auto-approve': { severity: 'critical', label: 'auto-approves agent tool calls (“YOLO mode”)', refs: ['CVE-2025-53773'] },
  'permissions-default': { severity: 'high', label: 'sets agent tool permissions to allow by default', refs: ['CVE-2025-53773'] },
  'executable-path': { severity: 'high', label: 'points a tool’s executable path into the repository', refs: ['CVE-2025-54130', 'CVE-2025-53536', 'CVE-2025-55012'] },
  'workspace-folders': { severity: 'medium', label: 'workspace file adds folders outside the repository', refs: ['CVE-2025-64660', 'CVE-2025-61590', 'CVE-2025-58372'] },
  'workspace-trust-off': { severity: 'medium', label: 'turns off workspace trust or allows automatic tasks', refs: ['Oasis Security 2025 (Cursor)'] },
  'auto-run-task': { severity: 'high', label: 'task runs automatically when the folder opens', refs: ['Oasis Security 2025 (Cursor)'] },
  'devcontainer-command': { severity: 'high', label: 'dev-container lifecycle command fetches or decodes code', refs: [] },
  'devcontainer-host-command': { severity: 'medium', label: 'dev-container initializeCommand runs on the host', refs: [] },
  'project-hooks': { severity: 'high', label: 'project settings define hooks that run commands', refs: ['CVE-2025-59536'] },
  'base-url': { severity: 'high', label: 'project settings redirect the API endpoint or proxy (keys go elsewhere)', refs: ['CVE-2026-21852'] },
  'mcp-auto-enable': { severity: 'high', label: 'auto-enables project MCP servers without approval', refs: ['CVE-2025-59536', 'CVE-2025-54135'] },
  'bypass-mode': { severity: 'critical', label: 'switches the agent to bypass-permissions mode', refs: [] },
  'broad-allow': { severity: 'medium', label: 'allow-list grants shell or network access broadly', refs: [] },
  'helper-command': { severity: 'medium', label: 'settings run a helper command (API key / status line / auth refresh)', refs: [] },
  'remote-schema': { severity: 'medium', label: 'JSON $schema fetched from a remote host (the IDE requests it)', refs: ['CVE-2025-49150', 'CVE-2025-53097', 'CVE-2025-58335'] },
  'mcp-unpinned': { severity: 'medium', label: 'MCP server runs an unpinned package (npx / uvx …)', refs: ['CVE-2025-54136'] },
  'mcp-shell': { severity: 'high', label: 'MCP server runs a shell one-liner', refs: ['CVE-2025-54135'] },
  'mcp-remote-script': { severity: 'critical', label: 'MCP server downloads and runs a script', refs: ['CVE-2025-54135'] },
  'mcp-remote-url': { severity: 'medium', label: 'MCP server at a remote URL over plain HTTP or on a collector host', refs: [] },
  'mcp-inline-secret': { severity: 'medium', label: 'MCP server config holds a secret in plain text', refs: [] },
  'mcp-trust': { severity: 'high', label: 'MCP server marked trusted: its tools run without confirmation', refs: [] },
  'lifecycle-ai-cli': { severity: 'critical', label: 'package lifecycle script runs an AI CLI with permission bypass flags', refs: ['s1ngularity / Nx 2025'] },
  'lifecycle-fetch': { severity: 'high', label: 'package lifecycle script pipes a download into a shell', refs: [] },
  'package-description': { severity: 'medium', label: 'package description reads like instructions to a model', refs: [] },
  'ai-workflow-untrusted': { severity: 'high', label: 'CI workflow feeds issue / PR text to an AI agent that has secrets or write access', refs: ['PromptPwnd 2025', 'Invariant GitHub MCP 2025'] },
  'ai-workflow-trigger': { severity: 'medium', label: 'CI workflow runs an AI agent on untrusted events', refs: ['PromptPwnd 2025'] },
  'codex-full-access': { severity: 'high', label: 'Codex config: no approvals or full-access sandbox', refs: [] },
  'aider-yes': { severity: 'high', label: 'aider config answers yes to every prompt', refs: [] },
  'zed-always-allow': { severity: 'high', label: 'Zed agent always allows tool actions', refs: ['CVE-2025-55012'] },
};

const VSCODE_SETTINGS = /(?:^|\/)\.(?:vscode|cursor|windsurf|kiro|trae)\/settings\.json$/i;
const WORKSPACE = /\.code-workspace$/i;
const TASKS = /(?:^|\/)\.vscode\/tasks\.json$/i;
const DEVCONTAINER = /(?:^|\/)(?:\.devcontainer\/(?:[^/]+\/)?devcontainer\.json|\.devcontainer\.json)$/i;
const CLAUDE_SETTINGS = /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/i;
const MCP_FILES = /(?:^|\/)(?:\.mcp\.json|mcp\.json|mcp_config\.json|claude_desktop_config\.json|\.claude\.json|\.(?:cursor|vscode|roo|amazonq|kiro\/settings|windsurf|codeium\/windsurf)\/mcp(?:_config)?\.json)$/i;
const GEMINI = /(?:^|\/)\.gemini\/settings\.json$/i;
const ZED = /(?:^|\/)\.zed\/settings\.json$/i;
const CODEX = /(?:^|\/)\.codex\/config\.toml$/i;
const AIDER = /(?:^|\/)\.aider\.conf\.ya?ml$/i;
const PACKAGE = /(?:^|\/)package\.json$/i;
const WORKFLOW = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const JSON_FILE = /\.(?:json|jsonc|json5)$/i;

/** Would the audit look at this file? */
export function isAuditFile(file) {
  const f = String(file).replace(/\\/g, '/');
  return [VSCODE_SETTINGS, WORKSPACE, TASKS, DEVCONTAINER, CLAUDE_SETTINGS, MCP_FILES, GEMINI, ZED, CODEX, AIDER, PACKAGE, WORKFLOW].some((re) => re.test(f)) || JSON_FILE.test(f);
}

const NET = /\b(?:curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod|fetch\(|nc\s|ncat|bitsadmin|certutil\s+-urlcache)\b|https?:\/\//i;
const DECODE = /\bbase64\s+(?:-d|--decode)|FromBase64String|-enc(?:odedcommand)?\s|atob\(|Buffer\.from\([^)]*base64/i;
const PIPE_SHELL = /\|\s*(?:sudo\s+)?(?:(?:ba|z|da)?sh|iex|Invoke-Expression|python3?|node|pwsh|powershell)\b/i;
const AI_CLI_BYPASS = /\b(?:claude|gemini|q(?:\s+chat)?|codex|cursor-agent|opencode|amp|qwen|crush|aider|copilot)\b[^\n;&|]{0,120}?(?:--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox|--yolo|--trust-all-tools|--full-auto|--approval-mode[= ](?:yolo|never)|--yes-always|-y\b|--force\b|-f\b)/i;
const SECRET_VALUE = /^(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})$/;

const commandOf = (c) => (Array.isArray(c) ? c.join(' ') : typeof c === 'object' && c ? Object.values(c).flat().join(' ') : String(c ?? ''));

/**
 * Checks for one MCP server entry ({ command, args, url, env, trust … }). Returns [{ rule, path, value }].
 * `path` is relative to the entry.
 */
export function checkMcpServer(entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  const cmd = String(entry.command || '');
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const line = [cmd, ...args].join(' ');
  const base = cmd.split(/[\\/]/).pop().replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
  if (/^(?:ba|z|da)?sh$|^cmd$|^powershell$|^pwsh$/.test(base) && args.some((a) => /^(?:-c|\/c|-command|-encodedcommand|-e|-enc)$/i.test(a))) {
    out.push({ rule: NET.test(line) && (PIPE_SHELL.test(line) || DECODE.test(line) || /\b(?:iex|Invoke-Expression)\b/i.test(line)) ? 'mcp-remote-script' : 'mcp-shell', path: ['command'], value: line.slice(0, 300) });
  } else if (NET.test(line) && PIPE_SHELL.test(line)) out.push({ rule: 'mcp-remote-script', path: ['command'], value: line.slice(0, 300) });
  // package runners: the package is the first argument that isn't an option
  const runner = { npx: 'npm', bunx: 'npm', uvx: 'pypi', pipx: 'pypi', pnpx: 'npm' }[base] || (base === 'pnpm' && args[0] === 'dlx' ? 'npm' : base === 'yarn' && args[0] === 'dlx' ? 'npm' : base === 'uv' && args[0] === 'tool' && args[1] === 'run' ? 'pypi' : '');
  if (runner) {
    const rest = args.filter((a, i) => !(i === 0 && (a === 'dlx' || a === 'run')) && !(base === 'uv' && i < 2));
    const pkg = rest.find((a) => !a.startsWith('-') && !/^--?\w/.test(a));
    if (pkg && !/^(?:https?:|file:|\.|\/)/.test(pkg)) {
      const pinned = runner === 'npm' ? /^(?:@[^/]+\/)?[^@]+@\d+\.\d+\.\d+/.test(pkg) : /==\d|@\d+\.\d+/.test(pkg);
      if (!pinned || /@latest$|@next$/.test(pkg)) out.push({ rule: 'mcp-unpinned', path: ['args'], value: pkg });
    }
  }
  if (entry.url || entry.serverUrl || entry.httpUrl) {
    const url = String(entry.url || entry.serverUrl || entry.httpUrl);
    const host = hostOf(url);
    if ((/^http:/i.test(url) && !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(host)) || isCollector(host, COLLECTOR_HOSTS)) out.push({ rule: 'mcp-remote-url', path: [entry.url ? 'url' : entry.serverUrl ? 'serverUrl' : 'httpUrl'], value: url });
  }
  for (const [k, v] of Object.entries(entry.env || {})) {
    if (typeof v === 'string' && SECRET_VALUE.test(v.trim()) && !/^\$\{|^\$[A-Z_]|^env:|\{\{/.test(v)) out.push({ rule: 'mcp-inline-secret', path: ['env', k], value: `${k}=${v.slice(0, 4)}…` });
  }
  for (const [k, v] of Object.entries(entry.headers || {})) {
    if (typeof v === 'string' && /bearer\s+[A-Za-z0-9._-]{20,}|^[A-Za-z0-9_-]{32,}$/i.test(v) && !/\$\{|\{\{/.test(v)) out.push({ rule: 'mcp-inline-secret', path: ['headers', k], value: `${k}: ${v.slice(0, 10)}…` });
  }
  if (entry.trust === true || entry.autoApprove === true || (Array.isArray(entry.autoApprove) && entry.autoApprove.length) || (Array.isArray(entry.alwaysAllow) && entry.alwaysAllow.length)) out.push({ rule: 'mcp-trust', path: [entry.trust === true ? 'trust' : entry.autoApprove ? 'autoApprove' : 'alwaysAllow'], value: JSON.stringify(entry.trust ?? entry.autoApprove ?? entry.alwaysAllow).slice(0, 200) });
  return out;
}

/** The MCP server entries of a parsed config: [{ name, entry, path }]. */
export function mcpServersOf(json) {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  for (const key of ['mcpServers', 'servers', 'mcp_servers', 'context_servers']) {
    const m = json[key] ?? (key === 'servers' ? json.mcp?.servers : undefined);
    if (m && typeof m === 'object' && !Array.isArray(m)) for (const [name, entry] of Object.entries(m)) out.push({ name, entry, path: [key === 'servers' && json.mcp?.servers ? 'mcp' : null, key, name].filter(Boolean) });
  }
  // ~/.claude.json keeps servers per project too
  if (json.projects && typeof json.projects === 'object') for (const [p, v] of Object.entries(json.projects)) for (const [name, entry] of Object.entries(v?.mcpServers || {})) out.push({ name: `${name} (${p})`, entry, path: ['projects', p, 'mcpServers', name] });
  return out;
}

// executable-path settings: an IDE setting that names a program to run
const EXEC_KEY = /(?:^|\.)(?:path|executablePath|executable|serverPath|binaryPath|interpreterPath|defaultInterpreterPath|pythonPath|nodePath|tsdk|java\.home|command|commandPath|binary)$|^terminal\.integrated\.(?:shell|automationProfile|profiles)\.|^go\.alternateTools$/i;
const insideRepo = (v) => typeof v === 'string' && v.trim() && (/^\.{1,2}[\\/]/.test(v) || /\$\{workspaceFolder|\$\{workspaceRoot/.test(v) || (!/^(?:[A-Za-z]:[\\/]|\/|~|\$\{env:|\$\{userHome)/.test(v) && /[\\/]/.test(v) && !/^https?:/.test(v)));

function checkVsSettings(s, push, prefix = []) {
  if (!s || typeof s !== 'object') return;
  for (const [k, v] of Object.entries(s)) {
    const p = [...prefix, k];
    if (/^chat\.tools\.(?:global\.)?autoApprove$/i.test(k) && (v === true || (v && typeof v === 'object' && Object.values(v).some((x) => x === true)))) push('auto-approve', p, `${k}: ${JSON.stringify(v).slice(0, 120)}`);
    else if (/^chat\.tools\.terminal\.autoApprove$/i.test(k) && v && typeof v === 'object' && Object.entries(v).some(([cmd, ok]) => ok === true && /^\/?\.\*|^\*|curl|wget|bash|sh$|powershell|rm\b/i.test(cmd))) push('auto-approve', p, `${k}: ${JSON.stringify(v).slice(0, 120)}`);
    else if (/^chat\.permissions\.default$/i.test(k) && v && !/^(?:ask|default|prompt)$/i.test(String(v))) push('permissions-default', p, `${k}: ${JSON.stringify(v)}`);
    else if (/^security\.workspace\.trust\.enabled$/i.test(k) && v === false) push('workspace-trust-off', p, `${k}: false`);
    else if (/^task\.allowAutomaticTasks$/i.test(k) && /^on$/i.test(String(v))) push('workspace-trust-off', p, `${k}: "on"`);
    else if (EXEC_KEY.test(k) && insideRepo(typeof v === 'object' && v ? v.path || v.command : v)) push('executable-path', p, `${k}: ${JSON.stringify(v).slice(0, 160)}`);
    else if (/^json\.schemas$/i.test(k) && Array.isArray(v)) {
      for (const sc of v) if (sc && typeof sc.url === 'string' && /^https?:/i.test(sc.url) && !/(?:^|\.)(?:json-schema\.org|schemastore\.org|w3\.org|microsoft\.com|github\.com)$/i.test(hostOf(sc.url))) push('remote-schema', p, sc.url);
    }
  }
}

/**
 * Audit one file. Returns findings: { kind, rule, severity, line, column, note, payload, refs }.
 */
export function auditFile(file, text) {
  const f = String(file).replace(/\\/g, '/');
  const out = [];
  const add = (kind, rule, loc, value, extra = {}) => {
    const r = AUDIT_RULES[rule];
    out.push({ kind, rule, severity: extra.severity || r.severity, line: loc.line, column: loc.column, endColumn: loc.column + 1, count: 1, payload: String(value ?? '').slice(0, 400), note: r.label + (r.refs.length ? ` (${r.refs.join(', ')})` : ''), refs: r.refs, ctx: { before: '', match: String(value ?? '').slice(0, 160), after: '' } });
  };
  const at = (path) => locatePath(text, path);

  if (CODEX.test(f)) {
    for (const m of text.matchAll(/^\s*(approval_policy\s*=\s*"never"|sandbox_mode\s*=\s*"danger-full-access")/gm)) add('config', 'codex-full-access', lineCol(text, m.index), m[1]);
    for (const m of text.matchAll(/^[ \t]*\[mcp_servers\.([^\]]+)\][ \t]*\r?\n((?:(?![ \t]*\[)[^\n]*\n?)*)/gm)) {
      const cmd = /^\s*command\s*=\s*"([^"]*)"/m.exec(m[2])?.[1] || '';
      const args = (/^\s*args\s*=\s*\[([^\]]*)\]/m.exec(m[2])?.[1] || '').match(/"([^"]*)"/g)?.map((x) => x.slice(1, -1)) || [];
      for (const c of checkMcpServer({ command: cmd, args })) add('mcp-config', c.rule, lineCol(text, m.index), `${m[1]}: ${c.value}`);
    }
    return out;
  }
  if (AIDER.test(f)) {
    for (const m of text.matchAll(/^\s*yes(?:-always)?\s*:\s*true\b/gm)) add('config', 'aider-yes', lineCol(text, m.index), m[0].trim());
    return out;
  }
  if (WORKFLOW.test(f)) return auditWorkflow(f, text);
  if (!JSON_FILE.test(f) && !MCP_FILES.test(f) && !WORKSPACE.test(f)) return out;

  const { value: json, error } = parseJsonc(text);
  if (error || !json || typeof json !== 'object') return out;

  // remote $schema in any JSON file (the IDE fetches it — data can ride along in the URL)
  if (typeof json.$schema === 'string' && /^https?:/i.test(json.$schema) && !/(?:^|\.)(?:json-schema\.org|schemastore\.org|json\.schemastore\.org|w3\.org|schemas\.microsoft\.com|developer\.microsoft\.com|containers\.dev|raw\.githubusercontent\.com|unpkg\.com|cdn\.jsdelivr\.net|biomejs\.dev|turbo\.build|turborepo\.(?:com|org)|deno\.land|json\.schemastore\.org|aka\.ms|code\.visualstudio\.com|docs\.renovatebot\.com|www\.schemastore\.org|opencode\.ai|modelcontextprotocol\.io|static\.modelcontextprotocol\.io)$/i.test(hostOf(json.$schema))) add('config', 'remote-schema', at(['$schema']), json.$schema, isCollector(hostOf(json.$schema)) || /[?#]/.test(json.$schema) ? { severity: 'high' } : {});

  if (VSCODE_SETTINGS.test(f)) checkVsSettings(json, (rule, p, v) => add('config', rule, at(p), v));
  if (ZED.test(f)) {
    if (json.agent?.always_allow_tool_actions === true) add('config', 'zed-always-allow', at(['agent', 'always_allow_tool_actions']), 'agent.always_allow_tool_actions: true');
    checkVsSettings(json, (rule, p, v) => add('config', rule, at(p), v));
  }
  if (WORKSPACE.test(f)) {
    for (const fo of Array.isArray(json.folders) ? json.folders : []) if (fo && typeof fo.path === 'string' && (/^(?:[A-Za-z]:[\\/]|\/|~)/.test(fo.path) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(fo.path))) add('config', 'workspace-folders', at(['folders']), fo.path);
    checkVsSettings(json.settings, (rule, p, v) => add('config', rule, at(['settings', ...p]), v));
    for (const t of json.tasks?.tasks || []) if (t?.runOptions?.runOn === 'folderOpen') add('config', 'auto-run-task', at(['tasks', 'runOn']), commandOf([t.command, t.args]).slice(0, 300));
  }
  if (TASKS.test(f)) {
    for (const t of Array.isArray(json.tasks) ? json.tasks : []) {
      if (t?.runOptions?.runOn !== 'folderOpen') continue;
      const cmd = commandOf([t.command, t.args, t.windows?.command, t.linux?.command, t.osx?.command]);
      add('config', 'auto-run-task', at(['runOn']), cmd.slice(0, 300) || t.label, NET.test(cmd) || DECODE.test(cmd) ? { severity: 'critical' } : {});
    }
  }
  if (DEVCONTAINER.test(f)) {
    for (const k of ['initializeCommand', 'onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand', 'postAttachCommand']) {
      if (json[k] === undefined) continue;
      const cmd = commandOf(json[k]);
      const risky = (NET.test(cmd) && PIPE_SHELL.test(cmd)) || DECODE.test(cmd) || AI_CLI_BYPASS.test(cmd);
      if (k === 'initializeCommand') add('config', 'devcontainer-host-command', at([k]), cmd.slice(0, 300), risky ? { severity: 'high' } : {});
      else if (risky) add('config', 'devcontainer-command', at([k]), cmd.slice(0, 300));
    }
  }
  if (CLAUDE_SETTINGS.test(f)) {
    if (json.hooks && typeof json.hooks === 'object' && Object.keys(json.hooks).length) {
      const cmds = JSON.stringify(json.hooks);
      add('config', 'project-hooks', at(['hooks']), cmds.slice(0, 300), NET.test(cmds) || DECODE.test(cmds) ? { severity: 'critical' } : {});
    }
    for (const [k, v] of Object.entries(json.env || {})) if (/_BASE_URL$|^HTTPS?_PROXY$|^ALL_PROXY$|^NODE_OPTIONS$|^NODE_EXTRA_CA_CERTS$|^ANTHROPIC_API_KEY$|^ANTHROPIC_AUTH_TOKEN$|^CLAUDE_CODE_USE_(?:BEDROCK|VERTEX)$/i.test(k)) add('config', 'base-url', at(['env', k]), `${k}=${String(v).slice(0, 120)}`);
    if (json.enableAllProjectMcpServers === true) add('config', 'mcp-auto-enable', at(['enableAllProjectMcpServers']), 'enableAllProjectMcpServers: true');
    if (Array.isArray(json.enabledMcpjsonServers) && json.enabledMcpjsonServers.length) add('config', 'mcp-auto-enable', at(['enabledMcpjsonServers']), JSON.stringify(json.enabledMcpjsonServers), { severity: 'medium' });
    const mode = json.permissions?.defaultMode;
    if (mode === 'bypassPermissions') add('config', 'bypass-mode', at(['permissions', 'defaultMode']), 'defaultMode: bypassPermissions');
    const allow = json.permissions?.allow || [];
    const broad = allow.filter((a) => /^(?:Bash|Shell|PowerShell)(?:\(\s*\*?\s*\)|\(\s*(?:curl|wget|bash|sh|powershell|iex|python|node|rm|npx|eval)\b[^)]*\))?$|^\*$|^WebFetch$|^mcp__\*$/i.test(String(a)));
    if (broad.length) add('config', 'broad-allow', at(['permissions', 'allow']), broad.join(', '));
    for (const k of ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper']) if (typeof json[k] === 'string') add('config', 'helper-command', at([k]), `${k}: ${json[k].slice(0, 200)}`, NET.test(json[k]) ? { severity: 'high' } : {});
    if (typeof json.statusLine?.command === 'string' && (NET.test(json.statusLine.command) || DECODE.test(json.statusLine.command))) add('config', 'helper-command', at(['statusLine', 'command']), json.statusLine.command.slice(0, 200), { severity: 'high' });
  }
  if (GEMINI.test(f)) {
    const yolo = json.approvalMode === 'yolo' || json.tools?.autoAccept === true || json.autoAccept === true || json.general?.approvalMode === 'yolo';
    if (yolo) add('config', 'auto-approve', at([json.approvalMode ? 'approvalMode' : 'autoAccept']), 'Gemini CLI auto-accepts tool calls');
  }
  if (MCP_FILES.test(f) || GEMINI.test(f) || VSCODE_SETTINGS.test(f) || ZED.test(f)) {
    for (const s of mcpServersOf(json)) for (const c of checkMcpServer(s.entry)) add('mcp-config', c.rule, at([...s.path, ...c.path]), `${s.name}: ${c.value}`);
  }
  if (PACKAGE.test(f) && json.scripts && typeof json.scripts === 'object') {
    for (const k of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'preuninstall', 'postuninstall']) {
      const cmd = json.scripts[k];
      if (typeof cmd !== 'string') continue;
      if (AI_CLI_BYPASS.test(cmd)) add('config', 'lifecycle-ai-cli', at(['scripts', k]), `${k}: ${cmd.slice(0, 300)}`);
      else if ((NET.test(cmd) && PIPE_SHELL.test(cmd)) || DECODE.test(cmd)) add('config', 'lifecycle-fetch', at(['scripts', k]), `${k}: ${cmd.slice(0, 300)}`);
    }
    if (typeof json.description === 'string' && looksLikeInstructions(json.description)) add('config', 'package-description', at(['description']), json.description);
  }
  return out;
}

// ── GitHub workflows (line-based: enough to see triggers, AI steps, interpolations and permissions) ──

const AI_ACTION = /uses:\s*["']?(?:anthropics\/claude-code-(?:action|base-action)|openai\/codex-action|google-github-actions\/run-gemini-cli|google-gemini\/gemini-cli-action|github\/copilot-[\w-]+|warpdotdev\/[\w-]+|coderabbitai\/[\w-]+|qodo-ai\/[\w-]+|Codium-ai\/pr-agent|appleboy\/llm-action|[\w-]+\/[\w-]*(?:claude|gpt|openai|gemini|llm|ai-agent|aider|cursor)[\w-]*)@/i;
const AI_RUN = /\b(?:claude\s+(?:-p|--print)|gemini\s+(?:-p|--prompt)|codex\s+exec|aider\s+--message|cursor-agent\s+-p|opencode\s+run|q\s+chat\s+--no-interactive|llm\s+-m)\b/i;
const UNTRUSTED_EXPR = /\$\{\{\s*(?:github\.event\.(?:issue|pull_request|comment|review|review_comment|discussion|discussion_comment|commits|head_commit|pages)\b[^}]*\.(?:title|body|message|name|label|ref|head\.ref|description)|github\.head_ref)\s*\}\}/i;
const UNTRUSTED_TRIGGER = /^\s*(?:on:\s*\[?[^\n]*\b|-\s*|)(issue_comment|issues|pull_request_target|pull_request_review_comment|pull_request_review|discussion|discussion_comment)\b/m;

function auditWorkflow(file, text) {
  const out = [];
  const ai = AI_ACTION.exec(text) || AI_RUN.exec(text);
  if (!ai) return out;
  const trigger = UNTRUSTED_TRIGGER.exec(text);
  const expr = UNTRUSTED_EXPR.exec(text);
  const secrets = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)\w+/i.test(text);
  const write = /^\s*(?:contents|pull-requests|issues|actions|packages|id-token|deployments|statuses|checks|discussions)\s*:\s*write\b|permissions\s*:\s*write-all/m.test(text);
  const loc = lineCol(text, ai.index);
  const add = (rule, at, value, severity) => {
    const r = AUDIT_RULES[rule];
    out.push({ kind: 'config', rule, severity: severity || r.severity, line: at.line, column: at.column, endColumn: at.column + 1, count: 1, payload: value.slice(0, 400), note: r.label + (r.refs.length ? ` (${r.refs.join(', ')})` : ''), refs: r.refs, ctx: { before: '', match: value.slice(0, 160), after: '' } });
  };
  if (expr && (secrets || write)) add('ai-workflow-untrusted', lineCol(text, expr.index), `${expr[0]} reaches ${ai[0].trim()}${secrets ? ' with secrets' : ''}${write ? ' and write permissions' : ''}`, trigger ? 'critical' : 'high');
  else if (trigger && (secrets || write || expr)) add('ai-workflow-trigger', loc, `${ai[0].trim()} on ${trigger[1]}${secrets ? ', with secrets' : ''}${write ? ', with write permissions' : ''}`);
  return out;
}

/** Audit many files ({ file, text }[]) → [{ file, findings }]. */
export function auditFiles(entries) {
  return entries.map(({ file, text }) => ({ file, findings: isAuditFile(file) ? auditFile(file, text) : [] }));
}
