// Compare two texts code point by code point: what differs, and whether the difference is something a
// reader can't see (hidden characters, look-alike letters, compatibility forms). Pure JavaScript.

import { stripHidden } from './scan.js';

/**
 * Myers diff of two arrays. Returns ops [{ op: '=' | '-' | '+', items: [...] }] (adjacent ops merged).
 * Common prefix / suffix are trimmed first, so "same text plus a few hidden characters" is cheap.
 * Gives up (one delete + one insert) when the edit distance passes `maxD`.
 */
export function diffArrays(a, b, maxD = 2000) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const ops = [];
  const push = (op, items) => {
    if (!items.length) return;
    const last = ops.at(-1);
    if (last?.op === op) last.items.push(...items);
    else ops.push({ op, items: [...items] });
  };
  push('=', a.slice(0, pre));

  const N = A.length;
  const M = B.length;
  const max = N + M;
  let mid = null;
  if (N && M) {
    const off = max;
    const v = new Int32Array(2 * max + 2);
    const trace = [];
    outer: for (let d = 0; d <= Math.min(max, maxD); d++) {
      // round d only reads diagonals -d…d of the previous round: keep just that window (memory ~ d²)
      trace.push(v.slice(off - d, off + d + 1));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= N && y >= M) {
          mid = backtrack(trace, A, B, d);
          break outer;
        }
      }
    }
  }
  if (mid) for (const o of mid) push(o.op, o.items);
  else {
    push('-', A);
    push('+', B);
  }
  push('=', a.slice(a.length - suf));
  return ops;
}

function backtrack(trace, A, B, D) {
  const out = [];
  let x = A.length;
  let y = B.length;
  for (let d = D; d > 0; d--) {
    const w = trace[d];
    const v = (k) => w[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v(k - 1) < v(k + 1)) ? k + 1 : k - 1;
    const px = v(prevK);
    const py = px - prevK;
    while (x > px && y > py) {
      out.push({ op: '=', items: [A[x - 1]] });
      x--;
      y--;
    }
    if (x === px) out.push({ op: '+', items: [B[py]] });
    else out.push({ op: '-', items: [A[px]] });
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    out.push({ op: '=', items: [A[x - 1]] });
    x--;
    y--;
  }
  return out.reverse();
}

/** Diff two strings by code point. Returns [{ op, text }]. */
export function diffText(a, b, maxD) {
  return diffArrays([...String(a ?? '')], [...String(b ?? '')], maxD).map((o) => ({ op: o.op, text: o.items.join('') }));
}

const fold = (s) => stripHidden(s).text.normalize('NFKC');

/**
 * Compare two texts. `verdict`:
 *   'identical'   same code points
 *   'normalized'  differ only in Unicode normalization (é as one or two code points)
 *   'hidden'      differ only in what a reader can't see: invisible characters, look-alike letters,
 *                 compatibility forms (ｆｕｌｌｗｉｄｔｈ, 𝐛𝐨𝐥𝐝)
 *   'visible'     differ in visible text
 */
export function compareTexts(a, b, maxD) {
  a = String(a ?? '');
  b = String(b ?? '');
  const ops = diffText(a, b, maxD);
  const removed = ops.filter((o) => o.op === '-').reduce((n, o) => n + [...o.text].length, 0);
  const added = ops.filter((o) => o.op === '+').reduce((n, o) => n + [...o.text].length, 0);
  let verdict = 'visible';
  if (a === b) verdict = 'identical';
  else if (a.normalize('NFC') === b.normalize('NFC')) verdict = 'normalized';
  else if (fold(a) === fold(b)) verdict = 'hidden';
  return { verdict, ops, removed, added, changes: ops.filter((o) => o.op !== '=').length };
}
