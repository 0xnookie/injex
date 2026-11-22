// injex run results in other tools' formats: CSV (spreadsheets, pandas), JUnit XML (CI test reports — a
// successful attack is a failed test), and SARIF 2.1.0 (code scanning — one finding per successful attack,
// pointing at the row in the rows file when it is known). Runs in Node and in extension pages.

const CSV_COLS = ['run_id', 'row_id', 'trial', 'model', 'model_reported', 'transform', 'transform_name', 'defense', 'control', 'outcome', 'success', 'refused', 'canary', 'decode_match', 'decode_score', 'judge', 'human', 'turns', 'latency_ms', 'input_tokens', 'output_tokens', 'cost', 'error', 'original', 'response'];

const csvField = (v) => {
  const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
};

/** One line per result. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function resultsCsv(results) {
  const val = (r, c) => {
    if (['refused', 'canary', 'decode_match', 'decode_score', 'human'].includes(c)) return r.scores?.[c];
    if (c === 'judge') return r.scores?.judge_label ?? r.scores?.judge;
    if (c === 'outcome') return r.outcome || r.scores?.outcome;
    if (['input_tokens', 'output_tokens', 'cost'].includes(c)) return r.usage?.[c];
    if (c === 'turns') return r.turns ?? 1;
    if (c === 'model') return r.model ?? r.target?.model;
    return r[c];
  };
  return [CSV_COLS.join(','), ...results.map((r) => CSV_COLS.map((c) => csvField(val(r, c))).join(','))].join('\r\n') + '\r\n';
}

// XML 1.0 allows tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD and astral characters
const xmlText = (s) =>
  String(s ?? '')
    .replace(/[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, (c) => `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JUnit XML: a suite per model × variant, a test case per trial; a successful attack is a failure. */
export function resultsJunit(results, { name = 'injex run' } = {}) {
  const suites = new Map();
  for (const r of results) {
    const k = `${r.model_reported || r.model || '—'} · ${r.transform_name || r.transform}${r.defense && r.defense !== 'none' ? ' + ' + r.defense : ''}${r.control ? ' (control)' : ''}`;
    if (!suites.has(k)) suites.set(k, []);
    suites.get(k).push(r);
  }
  const all = { tests: 0, failures: 0, errors: 0 };
  const body = [];
  for (const [k, rs] of suites) {
    const failures = rs.filter((r) => !r.error && r.success).length;
    const errors = rs.filter((r) => r.error).length;
    all.tests += rs.length;
    all.failures += failures;
    all.errors += errors;
    body.push(`  <testsuite name="${xmlText(k)}" tests="${rs.length}" failures="${failures}" errors="${errors}">`);
    for (const r of rs) {
      const time = r.latency_ms ? ` time="${(r.latency_ms / 1000).toFixed(3)}"` : '';
      const head = `    <testcase classname="injex.${xmlText(r.transform)}" name="row ${xmlText(r.row_id)} trial ${xmlText(r.trial)}"${time}`;
      if (r.error) body.push(`${head}>\n      <error message="${xmlText(r.error.slice(0, 300))}"/>\n    </testcase>`);
      else if (r.success) body.push(`${head}>\n      <failure message="the model carried out the injected instruction (${xmlText(r.outcome || r.scores?.outcome || 'success')})">${xmlText(String(r.response ?? '').slice(0, 2000))}</failure>\n    </testcase>`);
      else body.push(`${head}/>`);
    }
    body.push('  </testsuite>');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xmlText(name)}" tests="${all.tests}" failures="${all.failures}" errors="${all.errors}">\n${body.join('\n')}\n</testsuites>\n`;
}

/**
 * SARIF 2.1.0: one result per successful attack. rowLines: Map row id → line number in `rowsUri`, so code
 * scanning can point at the row that worked.
 */
export function resultsSarif(results, { version = '', rowsUri = '', rowLines = new Map() } = {}) {
  const wins = results.filter((r) => !r.error && r.success);
  const rules = new Map();
  for (const r of wins) {
    const id = `injex-run/${r.transform}`;
    if (!rules.has(id)) rules.set(id, { id, name: String(r.transform), shortDescription: { text: `Prompt injection carried out: ${r.transform_name || r.transform}` }, fullDescription: { text: 'A model under test carried out an instruction injected into its input (scored by injex run).' }, helpUri: 'https://github.com/0xnookie/injex#-research-and-red-teaming', properties: { tags: ['security', 'prompt-injection', ...(r.tags || [])] } });
  }
  return (
    JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'injex', version, informationUri: 'https://github.com/0xnookie/injex', rules: [...rules.values()] } },
            results: wins.map((r) => ({
              ruleId: `injex-run/${r.transform}`,
              level: r.control ? 'warning' : 'error',
              message: { text: `${r.model_reported || r.model} carried out the injected instruction (${r.outcome || r.scores?.outcome || 'success'}) — row ${r.row_id}, trial ${r.trial}, ${r.transform_name || r.transform}${r.defense && r.defense !== 'none' ? ` behind ${r.defense}` : ''}` },
              ...(rowsUri ? { locations: [{ physicalLocation: { artifactLocation: { uri: rowsUri }, region: { startLine: rowLines.get(String(r.row_id)) || 1 } } }] } : {}),
              partialFingerprints: { injexResult: `${r.model}|${r.row_id}|${r.trial}|${r.sha256?.input || r.sha256?.prompt || ''}` },
              properties: { model: r.model, defense: r.defense || 'none', outcome: r.outcome || r.scores?.outcome, response_sha256: r.sha256?.response },
            })),
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

/** `key=value` / `key!=value` filters over results; keys may reach into scores ("scores.canary"). */
export function whereFilter(exprs = []) {
  const tests = exprs.map((e) => {
    const m = /^([\w.]+)\s*(!=|=)\s*(.*)$/.exec(e);
    if (!m) throw new Error(`--where takes key=value or key!=value, not "${e}"`);
    const [, key, op, want] = m;
    const get = (r) => {
      let v = key.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), r);
      if (v === undefined && !key.includes('.')) v = r.scores?.[key];
      if (key === 'defense' && v === undefined) v = 'none';
      if (key === 'outcome' && v === undefined) v = r.scores?.outcome;
      return v === undefined || v === null ? '' : String(v);
    };
    const alts = want.split('|');
    return (r) => alts.includes(get(r)) === (op === '=');
  });
  return (r) => tests.every((t) => t(r));
}
