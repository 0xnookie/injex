// PyRIT seed datasets (.prompt / .yaml): read them as injex seeds, write injex batches as seeds. A small
// YAML reader for the subset these files use — block mappings and sequences, plain / single / double-quoted
// scalars, | and > block scalars, flow sequences, comments — so injex stays dependency-free.
//
//   dataset_name: …            defaults for every item: harm_categories, data_type, source, authors …
//   prompts: | seeds: | objectives:
//     - value: …               one seed; its own fields override the defaults

const BOM = String.fromCharCode(0xfeff);

function stripComment(s) {
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q && !(q === '"' && s[i - 1] === '\\')) q = '';
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[,{:]/.test(s[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

function splitFlow(s) {
  const out = [];
  let cur = '';
  let q = '';
  for (const c of s) {
    if (q) {
      cur += c;
      if (c === q) q = '';
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s[0] === '"') {
    try {
      return JSON.parse(s.replace(/\\\//g, '/').replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s[0] === '[' && s.endsWith(']')) return splitFlow(s.slice(1, -1)).map(scalar);
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#[{\-][^#]*?|-[^\s#][^#]*?)\s*:(?:\s+|$)/;
const isSeq = (t) => t === '-' || t.startsWith('- ');

/** Parse the YAML subset above. Throws on lines it cannot place. */
export function parseYaml(src) {
  const L = String(src)
    .replace(new RegExp('^' + BOM), '')
    .split(/\r?\n/)
    .map((raw) => ({ raw, ind: raw.match(/^ */)[0].length, text: raw.trim() }));
  let i = 0;
  const blank = (l) => !l.text || l.text.startsWith('#') || l.text === '---' || l.text === '...';
  const skip = () => {
    while (i < L.length && blank(L[i])) i++;
  };

  function blockScalar(indicator, parentInd) {
    const fold = indicator[0] === '>';
    const chomp = indicator[1] || '';
    const body = [];
    let bi = -1;
    while (i < L.length && (!L[i].text || L[i].ind > parentInd)) {
      if (L[i].text && bi < 0) bi = L[i].ind;
      body.push(L[i].text ? L[i].raw.slice(bi) : '');
      i++;
    }
    while (body.length && body.at(-1) === '' && chomp !== '+') body.pop();
    let text = fold ? body.reduce((acc, l, k) => (k === 0 ? l : l === '' ? acc + '\n' : acc.endsWith('\n') ? acc + l : acc + ' ' + l), '') : body.join('\n');
    if (chomp !== '-') text += '\n';
    return text;
  }

  function value(rest, ind) {
    const r = stripComment(rest).trim();
    if (/^[|>][+-]?$/.test(r)) {
      i++;
      return blockScalar(r, ind);
    }
    i++;
    if (r === '') {
      skip();
      if (i < L.length && (L[i].ind > ind || (L[i].ind === ind && isSeq(L[i].text)))) return block(L[i].ind);
      return null;
    }
    return scalar(r);
  }

  function map(ind) {
    const obj = {};
    for (skip(); i < L.length && L[i].ind === ind && !isSeq(L[i].text); skip()) {
      const m = KEY.exec(L[i].text);
      if (!m) throw new Error(`YAML line ${i + 1}: expected "key: value"`);
      const k = scalar(m[1]);
      obj[String(k)] = value(L[i].text.slice(m[0].length), ind);
    }
    return obj;
  }

  function seq(ind) {
    const arr = [];
    for (skip(); i < L.length && L[i].ind === ind && isSeq(L[i].text); skip()) {
      const rest = L[i].text.slice(1).trimStart();
      if (!rest || rest.startsWith('#')) {
        i++;
        skip();
        arr.push(i < L.length && L[i].ind > ind ? block(L[i].ind) : null);
      } else if (KEY.test(rest)) {
        const off = L[i].raw.length - L[i].raw.trimStart().length + (L[i].text.length - rest.length);
        L[i] = { raw: ' '.repeat(off) + rest, ind: off, text: rest };
        arr.push(map(off));
      } else arr.push(value(rest, ind));
    }
    return arr;
  }

  function block(ind) {
    skip();
    if (i >= L.length) return null;
    return isSeq(L[i].text) ? seq(L[i].ind) : map(L[i].ind);
  }

  const out = block(0);
  skip();
  if (i < L.length) throw new Error(`YAML line ${i + 1}: unexpected indentation`);
  return out;
}

const DEFAULT_FIELDS = ['harm_categories', 'data_type', 'source', 'authors', 'groups', 'description', 'dataset_name', 'name'];

/**
 * A PyRIT seed dataset → seed records { text, id, dataset_name, harm_categories, data_type, … } (items
 * that aren't text are skipped).
 */
export function parseSeedYaml(text) {
  const doc = parseYaml(text);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('not a PyRIT seed dataset (expected a mapping with prompts:, seeds: or objectives:)');
  const items = doc.prompts || doc.seeds || doc.objectives || doc.seed_prompts;
  if (!Array.isArray(items)) throw new Error('not a PyRIT seed dataset (no prompts:, seeds: or objectives: list)');
  const defaults = Object.fromEntries(DEFAULT_FIELDS.filter((k) => doc[k] !== undefined && doc[k] !== null).map((k) => [k, doc[k]]));
  return items
    .map((it, n) => (typeof it === 'string' ? { value: it } : it))
    .filter((it) => it && typeof it.value === 'string' && (it.data_type || defaults.data_type || 'text') === 'text')
    .map((it, n) => {
      const { value, ...rest } = it;
      const merged = { ...defaults, ...rest };
      if (typeof merged.harm_categories === 'string') merged.harm_categories = [merged.harm_categories];
      return { text: value, id: String(it.id ?? it.name ?? n + 1), ...merged };
    });
}

const yq = (s) => JSON.stringify(String(s ?? '')).replace(/[\u0085\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const yv = (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null || v === undefined ? 'null' : Array.isArray(v) ? `[${v.map(yv).join(', ')}]` : yq(v));

/**
 * Rows → a PyRIT seed dataset (YAML). Each rendered prompt is a seed; the original, transform and defense
 * go into its metadata so PyRIT results can be traced back to injex rows.
 */
export function rowsToSeedYaml(rows, { name = 'injex-batch', description = 'Prompt variants generated by injex', source = 'https://github.com/0xnookie/injex', harm = ['prompt-injection'] } = {}) {
  const out = [`dataset_name: ${yq(name)}`, `description: ${yq(description)}`, `source: ${yq(source)}`, 'data_type: text', `harm_categories: ${yv(harm)}`, 'prompts:'];
  for (const r of rows) {
    out.push(`  - value: ${yq(r.prompt)}`);
    out.push('    data_type: text');
    out.push('    metadata:');
    out.push(`      injex_row: ${yv(r.id)}`);
    out.push(`      original: ${yq(r.original)}`);
    out.push(`      transform: ${yq(r.transform)}`);
    out.push(`      defense: ${yq(r.defense || 'none')}`);
    if (r.tags?.length) out.push(`      tags: ${yv(r.tags)}`);
  }
  return out.join('\n') + '\n';
}
