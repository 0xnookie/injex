# gpt-tokenizer (vendored)

- Package: [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer) **2.9.0** by Bazyli Brzoska, MIT (see `LICENSE`)
- Files: `dist/cl100k_base.js`, `dist/o200k_base.js`, `dist/p50k_base.js`, `dist/r50k_base.js` (UMD builds)
- Change: the trailing `//# sourceMappingURL=…` line is removed from each file (the maps are not shipped);
  nothing else differs. Check with:

  ```bash
  curl -s https://cdn.jsdelivr.net/npm/gpt-tokenizer@2.9.0/dist/r50k_base.js | sed '$d' | cmp - vendor/gpt-tokenizer/r50k_base.js
  ```

Used by `src/core/tokenizer.js` (Tokenizer tab, `injex tokens`). To update, replace the four files with the same
builds of a newer release, drop the source-map line, and run `node test/run-tests.mjs`.
