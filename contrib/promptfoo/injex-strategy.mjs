// A promptfoo custom strategy that runs each test case's injected variable through injex transforms.
//
// promptfooconfig.yaml:
//   redteam:
//     strategies:
//       - id: file://node_modules/@0xnookie/injex/contrib/promptfoo/injex-strategy.mjs   (or a path to a clone)
//         config:
//           transforms: [invisible_text, sneaky_bits, base64, rot13]   # injex list shows all keys
//           defenses: [delimit]          # optional: also emit spotlighted variants
//           seed: 42                     # optional: reproducible output for shuffling transforms
//
// Every new test case keeps the original in vars.injexOriginal and its metadata says which transform made
// it, so graders can decode-match the answer. Zero dependencies: imports injex's own modules.

import { encode, transforms as ALL, list } from '../../src/core/registry.js';
import { withSeed } from '../../src/core/batch.js';
import { tagsForTransform } from '../../src/core/taxonomy.js';

function resolve(name) {
  const n = String(name).trim().toLowerCase();
  return ALL[n] || ALL['spotlight_' + n] || list().find((t) => t.name.toLowerCase() === n) || null;
}

export async function action(testCases, injectVar, config = {}) {
  const ts = (config.transforms || ['base64']).map((n) => resolve(n) || (() => { throw new Error(`injex: unknown transform "${n}"`); })());
  const ds = (config.defenses || []).map((n) => resolve(n) || (() => { throw new Error(`injex: unknown defense "${n}"`); })());
  return withSeed(config.seed ?? '', () => {
    const out = [];
    for (const tc of testCases) {
      const original = String(tc.vars?.[injectVar] ?? '');
      for (const t of ts) {
        const r = encode(t, original);
        if (!r.ok) continue;
        for (const d of [null, ...ds]) {
          const wrapped = d ? encode(d, r.text) : r;
          if (!wrapped.ok) continue;
          out.push({
            ...tc,
            vars: { ...tc.vars, [injectVar]: wrapped.text, injexOriginal: original },
            metadata: { ...(tc.metadata || {}), strategyId: `injex:${t.key}${d ? '+' + d.key : ''}`, injexTransform: t.key, injexDefense: d ? d.key : 'none', injexTags: tagsForTransform(t) },
          });
        }
      }
    }
    return out;
  });
}

export default action;
