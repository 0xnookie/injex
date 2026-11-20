// Paste guard: registered (opt-in, Settings → Paste guard) on AI chat sites. When something you paste
// contains hidden text — Unicode tags, emoji steganography, zero-width runs, bidi overrides, look-alike
// letters — the paste is held and a small panel asks: paste it cleaned, paste it as is, or cancel.
// The check itself runs in the extension's background (the same scanner as everywhere else); pastes
// without any suspicious character never leave the page. A classic script: no imports.

(() => {
  if (globalThis.__injexPasteGuard) return;
  globalThis.__injexPasteGuard = true;

  // characters worth a closer look; everything else is pasted untouched without asking the background
  const QUICK = /[\u{34F}\u{61C}\u{115F}\u{1160}\u{180E}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{3164}\u{FE00}-\u{FE0F}\u{FEFF}\u{FFA0}\u{E0000}-\u{E01EF}]|[A-Za-z][\u{370}-\u{3FF}\u{400}-\u{4FF}]|[\u{370}-\u{3FF}\u{400}-\u{4FF}][A-Za-z]/u;
  let open = null; // the panel while it is shown

  const deepActive = () => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  const isField = (el) => el && (el.localName === 'textarea' || (el.localName === 'input' && /^(text|search|url|email|tel|)$/i.test(el.type || '')));
  const editable = (el) => isField(el) || !!el?.isContentEditable;

  function ask(text) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (!done) resolve(r);
        done = true;
      };
      setTimeout(() => finish(null), 2500);
      try {
        chrome.runtime.sendMessage({ type: 'injex:paste-check', text }).then(finish, () => finish(null));
      } catch {
        finish(null); // the extension was reloaded or removed: behave like a normal paste
      }
    });
  }

  /** Put text in where the paste was going: a synthetic paste the editor handles, else insertText. */
  function insert(target, data, sel) {
    try {
      target.focus({ preventScroll: true });
      if (isField(target) && sel) target.setSelectionRange(sel.start, sel.end);
      else if (sel?.range) {
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(sel.range);
      }
    } catch {
      /* keep whatever focus there is */
    }
    let handled = false;
    try {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) if (value) dt.setData(type, value);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
      handled = !target.dispatchEvent(ev);
    } catch {
      handled = false;
    }
    if (handled) return;
    const text = data['text/plain'];
    if (document.execCommand('insertText', false, text)) return;
    if (isField(target)) {
      const start = target.selectionStart ?? target.value.length;
      target.setRangeText(text, start, target.selectionEnd ?? start, 'end');
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    }
  }

  function panel(target, res, onChoice) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0';
    const root = host.attachShadow({ mode: 'closed' });
    const r = target.getBoundingClientRect();
    const width = Math.min(480, innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, innerWidth - width - 12));
    root.innerHTML = `
      <style>
        .p { position: fixed; box-sizing: border-box; width: ${width}px; left: ${left}px; font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
             color: #ededed; background: #111; border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
             box-shadow: 0 18px 44px -12px rgba(0,0,0,.85); overflow: hidden; animation: in .14s ease-out; }
        @keyframes in { from { opacity: 0; transform: translateY(4px); } }
        .h { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .h b { font-weight: 600; letter-spacing: -.01em; flex: 1; }
        .h i { font-style: normal; color: #737373; font-size: 11.5px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: ${res.findings.some((f) => f.severity === 'critical') ? '#ff5c5c' : '#ff9b42'}; flex: none; }
        ul { list-style: none; margin: 0; padding: 8px 12px; display: grid; gap: 6px; max-height: 190px; overflow: auto; }
        li { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: baseline; }
        .s { font: 600 10px/1.6 ui-monospace, 'Cascadia Mono', Consolas, monospace; text-transform: uppercase; padding: 0 5px; border-radius: 4px;
             color: #0a0a0a; background: #ff9b42; }
        .s.critical { background: #ff5c5c; } .s.medium { background: #e9c046; }
        .k { color: #a3a3a3; } .k em { font-style: normal; color: #ff5c5c; margin-left: 6px; }
        .t { grid-column: 2; font: 12px/1.5 ui-monospace, 'Cascadia Mono', Consolas, monospace; overflow-wrap: anywhere; color: #ededed; }
        .n { padding: 0 12px 8px; color: #a3a3a3; font-size: 12px; }
        .f { display: flex; gap: 6px; align-items: center; padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.08); }
        .f span { flex: 1; }
        button { font: 500 12px system-ui, sans-serif; height: 28px; padding: 0 11px; border-radius: 6px; cursor: pointer;
                 color: #ededed; background: #111; border: 1px solid rgba(255,255,255,.16); }
        button:hover { background: #1a1a1a; border-color: rgba(255,255,255,.3); }
        button.pr { color: #0a0a0a; background: #ededed; border-color: #ededed; font-weight: 600; }
        kbd { font: 10.5px ui-monospace, monospace; opacity: .6; margin-left: 4px; }
        @media (prefers-color-scheme: light) {
          .p { color: #0a0a0a; background: #fff; border-color: rgba(0,0,0,.14); box-shadow: 0 18px 44px -12px rgba(0,0,0,.28); }
          .h, .f { border-color: rgba(0,0,0,.08); } .t { color: #0a0a0a; } .k, .n { color: #525252; }
          button { color: #0a0a0a; background: #fff; border-color: rgba(0,0,0,.14); } button:hover { background: #f5f5f5; }
          button.pr { color: #fff; background: #0a0a0a; border-color: #0a0a0a; }
        }
      </style>
      <div class="p" role="alertdialog" aria-label="injex: hidden text in what you are pasting">
        <div class="h"><span class="dot"></span><b>Hidden text in what you’re pasting</b><i>injex</i></div>
        <ul></ul>
        <div class="n"></div>
        <div class="f"><button class="pr" data-a="clean">Paste cleaned<kbd>⏎</kbd></button><button data-a="raw">Paste as is</button><span></span><button data-a="cancel">Cancel<kbd>Esc</kbd></button></div>
      </div>`;
    const ul = root.querySelector('ul');
    for (const f of res.findings) {
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.className = 's ' + f.severity;
      s.textContent = f.severity;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = f.label;
      if (f.instructions) {
        const em = document.createElement('em');
        em.textContent = 'reads like instructions to a model';
        k.append(em);
      }
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = f.text;
      li.append(s, k, t);
      ul.append(li);
    }
    const parts = [];
    if (res.removed) parts.push(`removes ${res.removed} hidden character${res.removed === 1 ? '' : 's'}`);
    if (res.replaced) parts.push(`turns ${res.replaced} look-alike letter${res.replaced === 1 ? '' : 's'} back into Latin`);
    root.querySelector('.n').textContent = (res.total > res.findings.length ? `…and ${res.total - res.findings.length} more. ` : '') + (parts.length ? `“Paste cleaned” ${parts.join(' and ')}.` : '');

    const box = root.querySelector('.p');
    (document.body || document.documentElement).append(host);
    const place = () => {
      const h = box.offsetHeight;
      const rr = target.getBoundingClientRect();
      box.style.top = (rr.top - h - 8 >= 8 ? rr.top - h - 8 : Math.min(innerHeight - h - 8, rr.bottom + 8)) + 'px';
    };
    place();

    const close = (choice) => {
      host.remove();
      removeEventListener('keydown', onKey, true);
      removeEventListener('mousedown', onOutside, true);
      removeEventListener('resize', place);
      open = null;
      onChoice(choice);
    };
    // keep the focus (and the caret) in the editor: the panel never takes it
    root.addEventListener('mousedown', (e) => e.preventDefault());
    root.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a) close(a);
    });
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation(); // Enter must not send the chat message
      close(e.key === 'Enter' ? 'clean' : 'cancel');
    };
    const onOutside = (e) => {
      if (!e.composedPath().includes(host)) close('cancel');
    };
    addEventListener('keydown', onKey, true);
    addEventListener('mousedown', onOutside, true);
    addEventListener('resize', place);
    open = { close };
  }

  addEventListener(
    'paste',
    (e) => {
      if (!e.isTrusted || !e.clipboardData) return;
      const target = deepActive() || e.target;
      if (!editable(target)) return;
      const dt = e.clipboardData;
      if (dt.files && dt.files.length) return; // images and files: not ours
      const text = dt.getData('text/plain');
      if (!text || !QUICK.test(text)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      open?.close('cancel');
      const html = dt.getData('text/html');
      const sel = isField(target) ? { start: target.selectionStart, end: target.selectionEnd } : getSelection().rangeCount ? { range: getSelection().getRangeAt(0).cloneRange() } : null;
      ask(text).then((res) => {
        if (!res || !res.show) return insert(target, { 'text/plain': text, 'text/html': html }, sel);
        panel(target, res, (choice) => {
          if (choice === 'clean') insert(target, { 'text/plain': res.cleaned }, sel);
          else if (choice === 'raw') insert(target, { 'text/plain': text, 'text/html': html }, sel);
        });
      });
    },
    true,
  );
})();
