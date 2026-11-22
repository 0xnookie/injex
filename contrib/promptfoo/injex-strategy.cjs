// CommonJS entry for promptfoo setups that load strategies with require(): forwards to the ES module.
module.exports = async function action(testCases, injectVar, config) {
  const m = await import('./injex-strategy.mjs');
  return m.action(testCases, injectVar, config);
};
module.exports.action = module.exports;
