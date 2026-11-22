// JSON with comments and trailing commas (VS Code settings, tasks, devcontainer, MCP configs), plus a
// helper that finds where a key sits in the source so findings can point at a line.

/** Comments and trailing commas replaced by spaces (offsets stay the same). */
export function stripJsonc(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, ' ');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && s[i + 1] === '/') {
      let j = i;
      while (j < s.length && s[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const j = end < 0 ? s.length : end + 2;
      out += s.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  // trailing commas: ", }" and ", ]"
  return out.replace(/,(\s*[}\]])/g, ' $1');
}

/** Parse JSONC; returns { value } or { error }. */
export function parseJsonc(text) {
  try {
    return { value: JSON.parse(stripJsonc(text)) };
  } catch (e) {
    return { error: e.message };
  }
}

/** Offset of `"key":` in `text` at or after `from` (-1 when absent). */
export function keyOffset(text, key, from = 0) {
  const re = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`, 'g');
  re.lastIndex = Math.max(0, from);
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** 1-based { line, column } of an offset. */
export function lineCol(text, offset) {
  if (offset < 0) return { line: 1, column: 1 };
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, column: offset - last };
}

/** Location of a key path (["mcpServers", "x", "command"]): each key is searched after the previous one. */
export function locatePath(text, path) {
  let at = 0;
  let found = -1;
  for (const k of path) {
    if (typeof k === 'number') continue;
    const o = keyOffset(text, k, at);
    if (o < 0) break;
    found = o;
    at = o + 1;
  }
  return lineCol(text, found);
}
