// Functions injected into web pages with chrome.scripting.executeScript({ func }). Each one must be
// self-contained: it is serialised and run in the page's isolated world, without access to this module.

/**
 * Read the selection (input / textarea selection, contenteditable range or plain page selection) and
 * remember where it is, so applyResult() can replace it. Returns { text, editable } or null.
 */
export function captureSelection() {
  window.__injexSel = null;
  const st = {};
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  const isField = el && (el.localName === 'textarea' || (el.localName === 'input' && /^(text|search|url|email|tel|password|)$/i.test(el.type || '')));
  if (isField && el.selectionStart != null && el.selectionEnd > el.selectionStart) {
    st.kind = 'field';
    st.el = el;
    st.start = el.selectionStart;
    st.end = el.selectionEnd;
    window.__injexSel = st;
    return { text: el.value.slice(st.start, st.end), editable: true };
  }
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const host = (node.nodeType === 1 ? node : node.parentElement)?.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]');
  st.kind = host ? 'editable' : 'page';
  st.range = range.cloneRange();
  st.host = host;
  window.__injexSel = st;
  return { text: sel.toString(), editable: !!host };
}

/**
 * Put `result` back: replace the remembered selection when it was editable (and `replace` is set),
 * otherwise show a small panel with the result and a Copy button. Also tries to copy right away.
 * @param {{ result: string, title: string, sub?: string, replace?: boolean, error?: boolean }} msg
 */
export function applyResult(msg) {
  const { result = '', title = 'injex', sub = '', replace = false, error = false } = msg || {};
  const st = window.__injexSel;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  };

  if (replace && !error && st && (st.kind === 'field' || st.kind === 'editable')) {
    try {
      if (st.kind === 'field') {
        st.el.focus();
        st.el.setSelectionRange(st.start, st.end);
        if (!document.execCommand('insertText', false, result)) {
          st.el.setRangeText(result, st.start, st.end, 'end');
          st.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: result }));
        }
      } else {
        st.host.focus();
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(st.range);
        if (!document.execCommand('insertText', false, result)) {
          st.range.deleteContents();
          st.range.insertNode(document.createTextNode(result));
        }
      }
      window.__injexSel = null;
      return 'replaced';
    } catch {
      /* fall through to the panel */
    }
  }

  document.getElementById('__injex_panel')?.remove();
  const hostEl = document.createElement('div');
  hostEl.id = '__injex_panel';
  hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px';
  const root = hostEl.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .p { box-sizing: border-box; width: min(440px, calc(100vw - 32px)); font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
           color: #ededed; background: #111; border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
           box-shadow: 0 16px 40px -12px rgba(0,0,0,.8); overflow: hidden; animation: in .16s ease-out; }
      @keyframes in { from { opacity: 0; transform: translateY(6px); } }
      .h { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .h b { font-weight: 600; letter-spacing: -.01em; }
      .h span { color: #737373; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
      .dot { width: 6px; height: 6px; border-radius: 50%; background: ${error ? '#e9c046' : '#3ecf8e'}; flex: none; }
      pre { margin: 0; padding: 10px 12px; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all;
            font: 12px/1.6 ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace; color: ${error ? '#a3a3a3' : '#ededed'}; }
      .f { display: flex; gap: 6px; align-items: center; padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.08); }
      .f i { flex: 1; font-style: normal; color: #737373; font-size: 11.5px; }
      button { font: 500 12px system-ui, sans-serif; height: 26px; padding: 0 10px; border-radius: 6px; cursor: pointer;
               color: #ededed; background: #111; border: 1px solid rgba(255,255,255,.14); }
      button:hover { background: #171717; border-color: rgba(255,255,255,.26); }
      button.pr { color: #0a0a0a; background: #ededed; border-color: #ededed; font-weight: 600; }
      @media (prefers-color-scheme: light) {
        .p { color: #0a0a0a; background: #fff; border-color: rgba(0,0,0,.13); box-shadow: 0 16px 40px -12px rgba(0,0,0,.25); }
        .h, .f { border-color: rgba(0,0,0,.08); } pre { color: ${error ? '#525252' : '#0a0a0a'}; }
        button { color: #0a0a0a; background: #fff; border-color: rgba(0,0,0,.13); } button:hover { background: #f7f7f7; }
        button.pr { color: #fff; background: #0a0a0a; border-color: #0a0a0a; }
      }
    </style>
    <div class="p" role="dialog" aria-label="injex">
      <div class="h"><span class="dot"></span><b></b><span></span></div>
      <pre></pre>
      <div class="f"><i></i>${error ? '' : '<button class="pr" data-a="copy">Copy</button>'}<button data-a="close">Close</button></div>
    </div>`;
  root.querySelector('b').textContent = title;
  root.querySelector('.h span').textContent = sub;
  root.querySelector('pre').textContent = result.length > 20000 ? result.slice(0, 20000) + '\n…' : result;
  const note = root.querySelector('.f i');
  const close = () => hostEl.remove();
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'close') close();
    if (a === 'copy') note.textContent = (await copy(result)) ? 'Copied to clipboard' : 'Copy failed — select the text above';
  });
  root.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  (document.body || document.documentElement).appendChild(hostEl);
  if (!error) copy(result).then((ok) => ok && (note.textContent = 'Copied to clipboard'));
  setTimeout(close, 45000);
  return 'shown';
}
