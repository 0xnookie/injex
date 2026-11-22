// Targets for `injex run` / `injex attack`: what a test sends messages to. One interface —
//   send(messages, { temperature, maxTokens, seed, timeout, tools }) →
//     { text, tool_calls: [{ id, name, arguments }], usage: { input_tokens, output_tokens, cost? }, model, finish, latency }
// — over OpenAI-compatible chat completions (OpenRouter, OpenAI, Ollama, LM Studio, vLLM …), the Anthropic
// Messages API, the OpenAI Responses API, and any HTTP endpoint described by a body template and a
// response path (a chat widget, an agent gateway, a RAG service). Messages: [{ role, content,
// attachments?: [{ name, mime, data (base64), text? }] }]. Retries 429 / 5xx with back-off (Retry-After
// honoured). Uses fetch only, so it runs in Node and in extension pages. Keys are passed in by the caller,
// who reads them from the environment; they are never put into results or errors.

export const TARGET_TYPES = {
  'openai-chat': 'OpenAI-compatible /chat/completions (OpenRouter, OpenAI, Ollama, LM Studio, vLLM, …)',
  anthropic: 'Anthropic Messages API (/v1/messages)',
  responses: 'OpenAI Responses API (/v1/responses)',
  http: 'any HTTP endpoint: --body template with {{prompt}} / {{messages}} / {{system}}, --response-path',
};

export const PROVIDERS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
};

/** The API key for a provider, from the environment only. */
export function apiKey(provider, env = globalThis.process?.env || {}) {
  return env.INJEX_API_KEY || (provider === 'openrouter' ? env.OPENROUTER_API_KEY : provider === 'openai' ? env.OPENAI_API_KEY : provider === 'anthropic' ? env.ANTHROPIC_API_KEY : '') || '';
}

/** Base URL → chat completions URL. */
export function chatUrl(base) {
  const b = String(base).replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : b + '/chat/completions';
}

/** `${NAME}` / `$NAME` in a header value → the environment variable (so secrets stay out of arguments). */
export function expandEnv(s, env = globalThis.process?.env || {}) {
  return String(s).replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (m, a, b) => env[a || b] ?? '');
}

/** A value at a dotted path: "choices.0.message.content", "$.data.reply", "output[0].text". */
export function pathGet(obj, path) {
  if (!path) return obj;
  const parts = String(path)
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let v = obj;
  for (const p of parts) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s, key) => (key ? String(s).split(key).join('***') : String(s));

/** fetch with retries on 429 / 5xx / network errors; Retry-After honoured. → { res, body } */
async function post(url, { headers, body, timeout = 60000, retries = 3, backoffMs = 1000, key, method = 'POST' }) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method, signal: AbortSignal.timeout(timeout), headers, body: method === 'GET' ? undefined : body });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : backoffMs * 2 ** attempt);
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok || json?.error) {
        const msg = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || `HTTP ${res.status}${text && !json ? ': ' + text.slice(0, 200) : ''}`;
        throw Object.assign(new Error(scrub(msg, key)), { status: res.status, final: true });
      }
      return { res, json, text };
    } catch (e) {
      if (e.final || attempt >= retries) throw new Error(scrub(e.message || e, key));
      last = e;
      await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw last;
}

const dataUrl = (a) => `data:${a.mime || 'application/octet-stream'};base64,${a.data}`;
const isImage = (a) => /^image\//.test(a.mime || '');
const isPdf = (a) => a.mime === 'application/pdf';

/** Attachments a provider cannot take as files become text (their extracted text, or a note). */
const asText = (a) => `[attachment ${a.name || ''}${a.text !== undefined ? '' : ' (not readable by this target)'}]\n${a.text ?? ''}`;

function openaiContent(m) {
  if (!m.attachments?.length) return m.content;
  const parts = [{ type: 'text', text: m.content || '' }];
  for (const a of m.attachments) {
    if (isImage(a)) parts.push({ type: 'image_url', image_url: { url: dataUrl(a) } });
    else if (isPdf(a)) parts.push({ type: 'file', file: { filename: a.name || 'document.pdf', file_data: dataUrl(a) } });
    else parts.push({ type: 'text', text: asText(a) });
  }
  return parts;
}

function anthropicContent(m) {
  if (!m.attachments?.length) return m.content;
  const parts = [];
  for (const a of m.attachments) {
    if (isImage(a)) parts.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } });
    else if (isPdf(a)) parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    else parts.push({ type: 'text', text: asText(a) });
  }
  parts.push({ type: 'text', text: m.content || '' });
  return parts;
}

function responsesContent(m) {
  const parts = [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content || '' }];
  for (const a of m.attachments || []) {
    if (isImage(a)) parts.push({ type: 'input_image', image_url: dataUrl(a) });
    else if (isPdf(a)) parts.push({ type: 'input_file', filename: a.name || 'document.pdf', file_data: dataUrl(a) });
    else parts.push({ type: 'input_text', text: asText(a) });
  }
  return parts;
}

function priced(usage, price) {
  if (usage.cost === undefined && price && (price.in || price.out)) usage.cost = Math.round((((usage.input_tokens || 0) * (price.in || 0) + (usage.output_tokens || 0) * (price.out || 0)) / 1e6) * 1e6) / 1e6;
  return usage;
}

/**
 * A target. cfg: { type, url, key, model, headers, body (http template), responsePath, method, price:
 * { in, out } per million tokens, maxTokensParam ('max_tokens' | 'max_completion_tokens'), retries,
 * backoffMs, anthropicVersion }
 */
export function createTarget(cfg) {
  const type = cfg.type || 'openai-chat';
  if (!TARGET_TYPES[type]) throw new Error(`unknown target type "${type}" (${Object.keys(TARGET_TYPES).join(', ')}, command)`);
  const common = { timeout: cfg.timeout, retries: cfg.retries ?? 3, backoffMs: cfg.backoffMs ?? 1000, key: cfg.key };
  const host = (() => {
    try {
      return new URL(cfg.url).host;
    } catch {
      return '';
    }
  })();
  const describe = () => ({ type, host, model: cfg.model || '' });

  if (type === 'openai-chat') {
    const url = chatUrl(cfg.url);
    return {
      type,
      describe,
      async send(messages, o = {}) {
        const t0 = Date.now();
        const body = {
          model: cfg.model,
          messages: messages.map((m) => ({ role: m.role, content: openaiContent(m), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) })),
          temperature: o.temperature ?? 0,
          [cfg.maxTokensParam || 'max_tokens']: o.maxTokens ?? 512,
          ...(o.seed !== undefined && o.seed !== '' ? { seed: Number(o.seed) || 0 } : {}),
          ...(o.tools?.length ? { tools: o.tools.map((t) => ({ type: 'function', function: t })) } : {}),
          ...(/openrouter\.ai$/.test(host) ? { usage: { include: true } } : {}),
        };
        const { json } = await post(url, { ...common, timeout: o.timeout ?? common.timeout, headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}), 'x-title': 'injex', ...(cfg.headers || {}) }, body: JSON.stringify(body) });
        const msg = json?.choices?.[0]?.message || {};
        const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : msg.content ? JSON.stringify(msg.content) : '';
        const u = json?.usage || {};
        return {
          text,
          tool_calls: (msg.tool_calls || []).map((t) => ({ id: t.id, name: t.function?.name, arguments: t.function?.arguments })),
          usage: priced({ input_tokens: u.prompt_tokens ?? u.input_tokens, output_tokens: u.completion_tokens ?? u.output_tokens, ...(typeof u.cost === 'number' ? { cost: u.cost } : {}) }, cfg.price),
          model: json?.model || cfg.model,
          finish: json?.choices?.[0]?.finish_reason || '',
          latency: Date.now() - t0,
        };
      },
    };
  }

  if (type === 'anthropic') {
    const url = String(cfg.url || PROVIDERS.anthropic).replace(/\/+$/, '').replace(/\/v1\/messages$/, '') + '/v1/messages';
    return {
      type,
      describe,
      async send(messages, o = {}) {
        const t0 = Date.now();
        const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const body = {
          model: cfg.model,
          max_tokens: o.maxTokens ?? 512,
          temperature: o.temperature ?? 0,
          ...(system ? { system } : {}),
          messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: anthropicContent(m) })),
          ...(o.tools?.length ? { tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || { type: 'object' } })) } : {}),
        };
        const { json } = await post(url, { ...common, timeout: o.timeout ?? common.timeout, headers: { 'content-type': 'application/json', ...(cfg.key ? { 'x-api-key': cfg.key } : {}), 'anthropic-version': cfg.anthropicVersion || '2023-06-01', ...(cfg.headers || {}) }, body: JSON.stringify(body) });
        const blocks = json?.content || [];
        return {
          text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
          tool_calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })),
          usage: priced({ input_tokens: json?.usage?.input_tokens, output_tokens: json?.usage?.output_tokens }, cfg.price),
          model: json?.model || cfg.model,
          finish: json?.stop_reason || '',
          latency: Date.now() - t0,
        };
      },
    };
  }

  if (type === 'responses') {
    const url = String(cfg.url || PROVIDERS.openai).replace(/\/+$/, '').replace(/\/responses$/, '') + '/responses';
    return {
      type,
      describe,
      async send(messages, o = {}) {
        const t0 = Date.now();
        const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const body = {
          model: cfg.model,
          ...(system ? { instructions: system } : {}),
          input: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: responsesContent(m) })),
          max_output_tokens: o.maxTokens ?? 512,
          ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
          ...(o.tools?.length ? { tools: o.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters || { type: 'object' } })) } : {}),
        };
        const { json } = await post(url, { ...common, timeout: o.timeout ?? common.timeout, headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}), ...(cfg.headers || {}) }, body: JSON.stringify(body) });
        const out = json?.output || [];
        const text = typeof json?.output_text === 'string' ? json.output_text : out.filter((x) => x.type === 'message').flatMap((x) => x.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
        return {
          text,
          tool_calls: out.filter((x) => x.type === 'function_call').map((x) => ({ id: x.call_id || x.id, name: x.name, arguments: x.arguments })),
          usage: priced({ input_tokens: json?.usage?.input_tokens, output_tokens: json?.usage?.output_tokens }, cfg.price),
          model: json?.model || cfg.model,
          finish: json?.status || '',
          latency: Date.now() - t0,
        };
      },
    };
  }

  // http: a body template and a response path
  const template = cfg.body ?? '{"prompt": "{{prompt}}"}';
  const esc = (s) => JSON.stringify(String(s ?? '')).slice(1, -1);
  return {
    type,
    describe,
    async send(messages, o = {}) {
      const t0 = Date.now();
      // text only: attachments go in as their extracted text (run with --attach text for PDF and images)
      const flat = (m) => {
        if (!m.attachments?.length) return m.content;
        const bad = m.attachments.find((a) => a.text === undefined);
        if (bad) throw new Error(`the http target takes text only: ${bad.name || 'an attachment'} has no extracted text (use --attach text)`);
        return [...m.attachments.map(asText), m.content].join('\n\n');
      };
      const last = flat([...messages].reverse().find((m) => m.role === 'user') || { content: '' }) ?? '';
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const conv = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: flat(m) }));
      const body = template
        .replace(/\{\{\s*prompt\s*\}\}|\{PROMPT\}/g, () => esc(last))
        .replace(/\{\{\s*prompt_raw\s*\}\}/g, () => last)
        .replace(/\{\{\s*system\s*\}\}/g, () => esc(system))
        .replace(/\{\{\s*model\s*\}\}/g, () => esc(cfg.model || ''))
        .replace(/\{\{\s*messages\s*\}\}/g, () => JSON.stringify(conv));
      const headers = { 'content-type': /^\s*[[{]/.test(body) ? 'application/json' : 'text/plain', ...Object.fromEntries(Object.entries(cfg.headers || {}).map(([k, v]) => [k, expandEnv(v)])) };
      const { json, text } = await post(cfg.url, { ...common, method: cfg.method || 'POST', timeout: o.timeout ?? common.timeout, headers, body });
      const v = json !== null ? pathGet(json, cfg.responsePath) : text;
      return { text: typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v), tool_calls: [], usage: {}, model: cfg.model || host, finish: '', latency: Date.now() - t0 };
    },
  };
}
