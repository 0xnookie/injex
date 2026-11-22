// spotlight-datamark transform (defense): interleave a marker character between the words of untrusted
// text (Microsoft's spotlighting, datamarking variant), so the model can tell document text from the
// prompt's own instructions. The marker is visible (^ by default).
import BaseTransformer from '../BaseTransformer.js';

export default new BaseTransformer({
  name: 'Spotlight: datamark',
  priority: 30,
  configurableOptions: [{ id: 'marker', label: 'Marker', type: 'text', default: '^' }],
  func: function (text, options = {}) {
    const mark = options.marker || '^';
    return String(text).replace(/[ \t]+/g, mark);
  },
  reverse: function (text, options = {}) {
    const mark = options.marker || '^';
    return String(text).split(mark).join(' ');
  },
  detector: function (text) {
    return /^[^\s^]+(?:\^[^\s^]+){4,}/.test(text);
  },
});
