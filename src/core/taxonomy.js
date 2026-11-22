// Taxonomy tags for transforms, scanner findings, audit rules and batch rows: OWASP Top 10 for LLM
// Applications 2025 and for Agentic Applications 2026, MITRE ATLAS, NIST AI 100-2 E2025, CWE, AVID and
// garak's red-teaming strategy tags. Tags are plain strings in garak's style ("owasp:llm01",
// "avid-effect:security:S0403", "demon:…") so they round-trip into garak / AVID reports.

export const TAGS = {
  'owasp:llm01': { label: 'OWASP LLM01:2025 Prompt Injection', url: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/' },
  'owasp:llm02': { label: 'OWASP LLM02:2025 Sensitive Information Disclosure', url: 'https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/' },
  'owasp:llm03': { label: 'OWASP LLM03:2025 Supply Chain', url: 'https://genai.owasp.org/llmrisk/llm032025-supply-chain/' },
  'owasp:llm05': { label: 'OWASP LLM05:2025 Improper Output Handling', url: 'https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/' },
  'owasp:llm06': { label: 'OWASP LLM06:2025 Excessive Agency', url: 'https://genai.owasp.org/llmrisk/llm062025-excessive-agency/' },
  'owasp:llm07': { label: 'OWASP LLM07:2025 System Prompt Leakage', url: 'https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/' },
  'owasp:asi01': { label: 'OWASP ASI01 Agent Goal Hijack', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'owasp:asi02': { label: 'OWASP ASI02 Tool Misuse and Exploitation', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'owasp:asi03': { label: 'OWASP ASI03 Identity and Privilege Abuse', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'owasp:asi04': { label: 'OWASP ASI04 Agentic Supply Chain Vulnerabilities', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'owasp:asi05': { label: 'OWASP ASI05 Unexpected Code Execution', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'owasp:asi06': { label: 'OWASP ASI06 Memory and Context Poisoning', url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/' },
  'atlas:AML.T0051.000': { label: 'MITRE ATLAS AML.T0051.000 LLM Prompt Injection: Direct', url: 'https://atlas.mitre.org/techniques/AML.T0051.000' },
  'atlas:AML.T0051.001': { label: 'MITRE ATLAS AML.T0051.001 LLM Prompt Injection: Indirect', url: 'https://atlas.mitre.org/techniques/AML.T0051.001' },
  'atlas:AML.T0054': { label: 'MITRE ATLAS AML.T0054 LLM Jailbreak', url: 'https://atlas.mitre.org/techniques/AML.T0054' },
  'atlas:AML.T0056': { label: 'MITRE ATLAS AML.T0056 Extract LLM System Prompt', url: 'https://atlas.mitre.org/techniques/AML.T0056' },
  'atlas:AML.T0057': { label: 'MITRE ATLAS AML.T0057 LLM Data Leakage', url: 'https://atlas.mitre.org/techniques/AML.T0057' },
  'atlas:AML.T0065': { label: 'MITRE ATLAS AML.T0065 LLM Prompt Crafting', url: 'https://atlas.mitre.org/techniques/AML.T0065' },
  'atlas:AML.T0068': { label: 'MITRE ATLAS AML.T0068 LLM Prompt Obfuscation', url: 'https://atlas.mitre.org/techniques/AML.T0068' },
  'atlas:AML.T0077': { label: 'MITRE ATLAS AML.T0077 LLM Response Rendering', url: 'https://atlas.mitre.org/techniques/AML.T0077' },
  'atlas:AML.T0080.000': { label: 'MITRE ATLAS AML.T0080.000 AI Agent Context Poisoning: Memory', url: 'https://atlas.mitre.org/techniques/AML.T0080.000' },
  'atlas:AML.T0084.001': { label: 'MITRE ATLAS AML.T0084.001 Discover AI Agent Configuration: Tool Definitions', url: 'https://atlas.mitre.org/techniques/AML.T0084.001' },
  'atlas:AML.T0086': { label: 'MITRE ATLAS AML.T0086 Exfiltration via AI Agent Tool Invocation', url: 'https://atlas.mitre.org/techniques/AML.T0086' },
  'atlas:AML.T0110': { label: 'MITRE ATLAS AML.T0110 AI Agent Tool Poisoning', url: 'https://atlas.mitre.org/techniques/AML.T0110' },
  'nist:NISTAML.015': { label: 'NIST AI 100-2 E2025 NISTAML.015 Indirect Prompt Injection', url: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf' },
  'nist:NISTAML.018': { label: 'NIST AI 100-2 E2025 NISTAML.018 Prompt Injection', url: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf' },
  'nist:NISTAML.035': { label: 'NIST AI 100-2 E2025 NISTAML.035 Prompt Extraction', url: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf' },
  'nist:NISTAML.036': { label: 'NIST AI 100-2 E2025 NISTAML.036 Leaking information from user interactions', url: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf' },
  'nist:NISTAML.039': { label: 'NIST AI 100-2 E2025 NISTAML.039 Compromising connected resources', url: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf' },
  'cwe:CWE-1427': { label: 'CWE-1427 Improper Neutralization of Input Used for LLM Prompting', url: 'https://cwe.mitre.org/data/definitions/1427.html' },
  'cwe:CWE-94': { label: 'CWE-94 Improper Control of Generation of Code', url: 'https://cwe.mitre.org/data/definitions/94.html' },
  'cwe:CWE-200': { label: 'CWE-200 Exposure of Sensitive Information', url: 'https://cwe.mitre.org/data/definitions/200.html' },
  'cwe:CWE-829': { label: 'CWE-829 Inclusion of Functionality from Untrusted Control Sphere', url: 'https://cwe.mitre.org/data/definitions/829.html' },
  'avid-effect:security:S0403': { label: 'AVID S0403 Adversarial Example', url: 'https://avidml.org/taxonomy/' },
  'demon:Language:Code_and_encode:Data_encoding': { label: 'garak strategy: data encoding', url: 'https://reference.garak.ai/' },
  'demon:Language:Code_and_encode:Token': { label: 'garak strategy: token-level tricks', url: 'https://reference.garak.ai/' },
  'demon:Language:Prompt_injection:Ignore_previous_instructions': { label: 'garak strategy: ignore previous instructions', url: 'https://reference.garak.ai/' },
};

const HIDDEN = ['owasp:llm01', 'atlas:AML.T0068', 'cwe:CWE-1427'];
const INDIRECT = ['atlas:AML.T0051.001', 'nist:NISTAML.015', 'owasp:asi01'];

const BY_KIND = {
  tags: [...HIDDEN, 'demon:Language:Code_and_encode:Token'],
  'vs-bits': [...HIDDEN, 'demon:Language:Code_and_encode:Token'],
  'vs-bytes': [...HIDDEN, 'demon:Language:Code_and_encode:Token'],
  bits: [...HIDDEN, 'demon:Language:Code_and_encode:Token'],
  'zero-width': [...HIDDEN],
  bidi: ['atlas:AML.T0068', 'cwe:CWE-1427'],
  homoglyph: [...HIDDEN, 'avid-effect:security:S0403'],
  filler: ['atlas:AML.T0068'],
  zalgo: [...HIDDEN, 'avid-effect:security:S0403'],
  encoded: [...HIDDEN, 'demon:Language:Code_and_encode:Data_encoding'],
  'css-hidden': [...HIDDEN, ...INDIRECT],
  comment: [...HIDDEN, ...INDIRECT],
  'doc-hidden': [...HIDDEN, ...INDIRECT],
  metadata: [...HIDDEN, ...INDIRECT],
  'doc-comment': [...HIDDEN, ...INDIRECT],
  unrendered: [...HIDDEN, ...INDIRECT],
  'ai-directive': [],
  exfil: ['owasp:llm02', 'atlas:AML.T0057', 'atlas:AML.T0086', 'nist:NISTAML.036', 'cwe:CWE-200'],
  'agent-danger': ['owasp:asi01', 'owasp:asi02', 'owasp:asi05', 'atlas:AML.T0051.001', 'cwe:CWE-1427'],
  config: ['owasp:asi04', 'owasp:asi05', 'owasp:llm06', 'cwe:CWE-829'],
  'mcp-tool': ['owasp:asi04', 'owasp:llm03', 'atlas:AML.T0110', 'atlas:AML.T0084.001', 'atlas:AML.T0051.001'],
  'mcp-config': ['owasp:asi04', 'owasp:asi05', 'owasp:llm03', 'cwe:CWE-829'],
  'mcp-drift': ['owasp:asi04', 'atlas:AML.T0110'],
  'event-text': [...HIDDEN, ...INDIRECT],
  canary: ['owasp:llm02', 'atlas:AML.T0057', 'nist:NISTAML.036'],
  'message-text': ['owasp:llm01', 'cwe:CWE-1427', ...INDIRECT],
};

const EXFIL_EXTRA = {
  'image-data': ['atlas:AML.T0077', 'owasp:llm05'],
  'ref-image-data': ['atlas:AML.T0077', 'owasp:llm05'],
  'html-url-data': ['atlas:AML.T0077', 'owasp:llm05'],
  mermaid: ['atlas:AML.T0077', 'owasp:llm05'],
  'url-burst': ['atlas:AML.T0077'],
  memory: ['atlas:AML.T0080.000', 'owasp:asi06'],
  'public-sink': ['owasp:asi02', 'nist:NISTAML.039'],
  'shell-exfil': ['owasp:asi05', 'cwe:CWE-94'],
};

const uniq = (a) => [...new Set(a)];

/** Tags for a scanner / audit finding ({ kind, rule?, instructions?, signals?, exfil? }). */
export function tagsForFinding(f) {
  const out = [...(BY_KIND[f.kind] || [])];
  if (f.kind === 'exfil' && f.rule) out.push(...(EXFIL_EXTRA[f.rule] || []));
  for (const r of f.exfil || []) out.push(...BY_KIND.exfil, ...(EXFIL_EXTRA[r] || []));
  if (f.instructions && f.kind !== 'exfil') out.push('owasp:llm01', 'atlas:AML.T0051.001');
  if (f.signals?.includes('override')) out.push('demon:Language:Prompt_injection:Ignore_previous_instructions');
  if (f.signals?.includes('leak')) out.push('owasp:llm07', 'atlas:AML.T0056', 'nist:NISTAML.035');
  if (f.tags) out.push(...f.tags);
  return uniq(out);
}

const BY_CATEGORY = {
  concealment: ['atlas:AML.T0068', 'demon:Language:Code_and_encode:Token', 'owasp:llm01', 'avid-effect:security:S0403'],
  defense: [],
  recipe: ['atlas:AML.T0068', 'demon:Language:Code_and_encode:Data_encoding', 'owasp:llm01'],
};
const ENCODING = ['atlas:AML.T0068', 'demon:Language:Code_and_encode:Data_encoding', 'owasp:llm01', 'avid-effect:security:S0403'];

/** Tags for a transform ({ key, category }). */
export function tagsForTransform(t) {
  if (!t || t.key === 'none') return [];
  return [...(BY_CATEGORY[t.category] ?? ENCODING)];
}

/**
 * Tags for a batch row: the transform's, plus how the payload is delivered — `direct` (sent as the
 * prompt) or `indirect` (inside a document, page or tool output).
 */
export function tagsForRow({ transform, delivery = 'direct' } = {}) {
  const out = tagsForTransform(transform);
  if (transform && transform.key !== 'none') out.push(...(delivery === 'indirect' ? ['atlas:AML.T0051.001', 'nist:NISTAML.015', 'owasp:asi01'] : ['atlas:AML.T0051.000', 'nist:NISTAML.018']));
  if (transform?.key === 'tokenade') out.push('nist:NISTAML.01');
  return uniq(out);
}

/** Label for a tag ("owasp:llm01" → "OWASP LLM01:2025 Prompt Injection"). */
export const tagLabel = (t) => TAGS[t]?.label || t;

/** Does a finding / row carry `tag`? Prefix match: "atlas" matches every ATLAS tag, "owasp:asi" every ASI tag. */
export function hasTag(tags, wanted) {
  const w = String(wanted).toLowerCase();
  return (tags || []).some((t) => t.toLowerCase() === w || t.toLowerCase().startsWith(w));
}
