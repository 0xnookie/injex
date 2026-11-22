# injex × promptfoo

`injex-strategy.mjs` is a promptfoo [custom strategy](https://www.promptfoo.dev/docs/red-team/strategies/custom/):
it turns every red-team test case into one variant per injex transform (226 of them — `npx github:0xnookie/injex list`),
optionally followed by a spotlighting defense, so you can compare attack success with and without it.

```yaml
redteam:
  strategies:
    - id: file://path/to/injex/contrib/promptfoo/injex-strategy.mjs
      config:
        transforms: [invisible_text, sneaky_bits, base64, rot13, upside_down]
        defenses: [delimit]      # optional: delimit, datamark, encode
        seed: 42                 # optional
```

Each variant carries `vars.injexOriginal` and `metadata.injexTransform` / `injexDefense` / `injexTags`
(OWASP / MITRE ATLAS / garak tags), so a grader can decode the answer and compare it with the original.
If your promptfoo version loads strategies with `require()`, point it at `injex-strategy.cjs` instead.

For static test files, `injex batch --format promptfoo` writes a `tests:` file directly.
