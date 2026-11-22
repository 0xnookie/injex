// sneaky-bits transform: every UTF-8 bit as an invisible character — U+2062 INVISIBLE TIMES for 0,
// U+2064 INVISIBLE PLUS for 1 (the "Sneaky Bits" scheme; both characters render as nothing).
import BaseTransformer from '../BaseTransformer.js';
import { encodeSneakyBits, decodeSneakyBits } from '../../core/stego.js';

const PAIRS = {
  sneaky: ['\u{2062}', '\u{2064}'],
  'zw-zwnj': ['\u{200B}', '\u{200C}'],
  'wj-fa': ['\u{2060}', '\u{2061}'],
};

export default new BaseTransformer({
  name: 'Sneaky Bits',
  priority: 95,
  configurableOptions: [
    {
      id: 'pair',
      label: 'Bit characters (0 / 1)',
      type: 'select',
      default: 'sneaky',
      options: [
        { value: 'sneaky', label: 'Invisible times / plus (U+2062 / U+2064)' },
        { value: 'zw-zwnj', label: 'ZWSP / ZWNJ (U+200B / U+200C)' },
        { value: 'wj-fa', label: 'Word joiner / function application (U+2060 / U+2061)' },
      ],
    },
  ],
  func: function (text, options = {}) {
    const [zero, one] = PAIRS[options.pair] || PAIRS.sneaky;
    return encodeSneakyBits(text, { zero, one });
  },
  preview: function () {
    return '[invisible bits]';
  },
  reverse: function (text, options = {}) {
    const [zero, one] = PAIRS[options.pair] || PAIRS.sneaky;
    return decodeSneakyBits(text, { zero, one });
  },
  detector: function (text) {
    return /[\u{2062}\u{2064}]{16,}/u.test(text);
  },
});
