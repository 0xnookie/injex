#!/usr/bin/env node
// Browser smoke test for the extension (not part of test/run-tests.mjs: it needs Chrome).
//
// Loads a copy of the extension unpacked into headless Chrome over --remote-debugging-pipe (branded Chrome
// ignores --load-extension since version 137; Extensions.loadUnpacked needs the pipe and
// --enable-unsafe-extension-debugging). The copy adds host access to 127.0.0.1 so the test can do what a
// click on the toolbar button grants in real use (activeTab). Then:
//   1. the service worker starts; the dashboard, the popup and the settings page load, and every tab of
//      the dashboard opens — no uncaught exception and no console error anywhere
//   2. the `injex lab` web carriers are served on 127.0.0.1 and the extension's page scanner runs on each
//      (collectPage in the page through chrome.scripting, scanPage on the result, as the Scan tab does):
//      every carrier is detected, including the ones only a rendered page shows (covered text, shadow DOM)
//   3. a plain page gives no finding at medium severity or above
//
//   node test/e2e/chrome.mjs              skips (exit 0) when no Chrome is found
//   node test/e2e/chrome.mjs --require    fails when no Chrome is found (CI)
//   CHROME=/path/to/chrome node test/e2e/chrome.mjs

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { copyShip } from '../../tools/build-firefox.mjs';
import { writeLab } from '../../cli/lab.mjs';
import { SEVERITY_ORDER } from '../../src/core/scan.js';

const REQUIRE = process.argv.includes('--require');
const TIMEOUT = 180_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const v of [process.env.CHROME, process.env.CHROME_PATH]) if (v && existsSync(v)) return v;
  const candidates =
    process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : [];
  for (const c of candidates) if (existsSync(c)) return c;
  if (process.platform !== 'win32')
    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
      try {
        return execFileSync('which', [name], { encoding: 'utf8' }).trim();
      } catch {}
    }
  return null;
}

/** Chrome with the DevTools protocol on fd 3 / 4 (NUL-separated JSON). */
async function launch(chrome, extDir) {
  const profile = mkdtempSync(join(tmpdir(), 'injex-e2e-profile-'));
  const args = ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1280,900', 'about:blank'];
  // GitHub's Ubuntu runners restrict the user namespaces Chrome's sandbox needs
  if (process.platform === 'linux' && process.env.CI) args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  const [, , , toChrome, fromChrome] = proc.stdio;
  let seq = 0;
  let buf = '';
  const pending = new Map();
  const listeners = new Set();
  fromChrome.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(`${m.error.message}${m.error.data ? ' — ' + m.error.data : ''}`)) : resolve(m.result);
      } else for (const l of listeners) l(m);
    }
  });
  const exited = new Promise((r) => proc.on('exit', r));
  exited.then(() => {
    for (const { reject } of pending.values()) reject(new Error(`Chrome exited\n${stderr}`));
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });

  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  const problems = [];

  /** A new tab at `url`, attached; uncaught exceptions and console errors land in `problems`. */
  async function open(url, label) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    listeners.add((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') problems.push(`${label}: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`${label}: console.error ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`${label}: ${m.params.entry.text}${m.params.entry.url ? ' (' + m.params.entry.url + ')' : ''}`);
    });
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Log.enable');
    const tab = {
      targetId,
      async navigate(to) {
        const loaded = new Promise((r) => {
          const l = (m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && (listeners.delete(l), r());
          listeners.add(l);
        });
        await s('Page.navigate', { url: to });
        await loaded;
      },
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async waitFor(expression, what, ms = 15_000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await tab.eval(expression).catch(() => false)) return;
          await sleep(100);
        }
        throw new Error(`timed out waiting for ${what}`);
      },
    };
    await tab.navigate(url);
    return tab;
  }

  return {
    extId,
    send,
    open,
    problems,
    async close() {
      await send('Browser.close').catch(() => {});
      await Promise.race([exited, sleep(3000)]);
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** Static files of `dir` on 127.0.0.1 (random port). */
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript' };
  const server = createServer((req, res) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(dir + sep) || !existsSync(path)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(readFileSync(path));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

// ── the test ──

const chrome = findChrome();
if (!chrome) {
  console.log(REQUIRE ? 'e2e: no Chrome found (set CHROME=…)' : 'e2e: no Chrome found — skipped (set CHROME=… or pass --require to fail instead)');
  process.exit(REQUIRE ? 1 : 0);
}

const work = mkdtempSync(join(tmpdir(), 'injex-e2e-'));
const extDir = join(work, 'ext');
const labDir = join(work, 'lab');
copyShip(extDir);
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const lab = await writeLab(labDir, { canary: 'INJX-E2E-0001' });
writeFileSync(join(labDir, 'plain.html'), '<!doctype html><meta charset="utf-8"><title>Kettle</title><h1>Model T kettle</h1><p>1.7 litres, boils in three minutes. Customers rate it 4.8 of 5 — “quiet and quick”. In stock, ships tomorrow.</p><p lang="fa">کتری برقی</p><p>👩\u200D👩\u200D👧 🏴\udb40\udc67\udb40\udc62\udb40\udc73\udb40\udc63\udb40\udc74\udb40\udc7f</p>');
const { server, port } = await serve(labDir);

const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const watchdog = setTimeout(() => {
  console.log(`✗ timed out after ${TIMEOUT / 1000} s`);
  process.exit(1);
}, TIMEOUT);

const b = await launch(chrome, extDir);
try {
  const { product } = await b.send('Browser.getVersion');
  console.log(`e2e: ${product}, extension ${manifest.version} (${b.extId})`);
  const base = `chrome-extension://${b.extId}`;

  // 1. service worker, dashboard with every tab, popup, settings
  let worker = false;
  for (let i = 0; i < 50 && !worker; i++) {
    const { targetInfos } = await b.send('Target.getTargets');
    worker = targetInfos.some((t) => t.type === 'service_worker' && t.url.startsWith(base));
    if (!worker) await sleep(100);
  }
  check(worker, 'service worker runs');

  const dash = await b.open(`${base}/ui/app.html?full=1#transform`, 'dashboard');
  await dash.waitFor(`document.querySelectorAll('#tabs .tab').length > 0`, 'the dashboard tabs');
  const tabs = await dash.eval(`[...document.querySelectorAll('#tabs .tab')].map((t) => t.dataset.tab)`);
  const opened = [];
  for (const id of tabs) {
    await dash.eval(`document.querySelector('#tabs .tab[data-tab="${id}"]').click()`);
    await dash.waitFor(`document.querySelector('.view[data-view="${id}"]')?.classList.contains('active') && location.hash === '#${id}'`, `tab ${id}`);
    await sleep(150);
    opened.push(id);
  }
  check(opened.length === tabs.length && tabs.length >= 18, `dashboard: all ${tabs.length} tabs open`);
  const transforms = await dash.eval(`document.querySelector('.tab[data-tab="transform"] .count')?.textContent`);
  check(Number(transforms) > 200, 'transform count shown', `${transforms}`);

  const popup = await b.open(`${base}/ui/app.html`, 'popup');
  await popup.waitFor(`document.querySelectorAll('#tabs .tab').length > 0`, 'the popup');
  const options = await b.open(`${base}/ui/options.html`, 'settings');
  await options.waitFor(`document.readyState === 'complete' && document.body.innerText.length > 100`, 'the settings page');
  await sleep(500);
  check(!b.problems.length, 'no uncaught errors or console errors on extension pages', b.problems.slice(0, 5).join(' | '));

  // 2. the page scanner on every lab web carrier, in a real page
  const web = lab.items.filter((i) => i.channel === 'web');
  const page = await b.open(`http://127.0.0.1:${port}/${web[0].file}`, 'lab page');
  const tabId = await dash.eval(`chrome.tabs.query({ url: 'http://127.0.0.1/${web[0].file}' }).then((t) => t[0]?.id)`);
  if (!tabId) throw new Error('the extension does not see the lab tab');
  const scan = () =>
    dash.eval(`(async () => {
      const { collectPage, scanPage } = await import('/src/core/scan.js');
      const r = await chrome.scripting.executeScript({ target: { tabId: ${tabId}, allFrames: true }, func: collectPage });
      const findings = scanPage({ ...r[0].result, chunks: r.flatMap((x) => x.result?.chunks || []) });
      return findings.map((f) => ({ kind: f.kind, severity: f.severity, instructions: !!f.instructions }));
    })()`);
  const missed = [];
  for (const item of web) {
    await page.navigate(`http://127.0.0.1:${port}/${item.file}`);
    const found = await scan();
    if (!item.expect.some((k) => found.some((f) => f.kind === k && SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.medium))) missed.push(`${item.technique} (expected ${item.expect.join('/')}, found ${[...new Set(found.map((f) => `${f.kind}:${f.severity}`))].join(', ') || 'nothing'})`);
  }
  const browserOnly = web.filter((i) => i.detected === 'browser-only').map((i) => i.technique);
  check(!missed.length, `page scanner: ${web.length - missed.length}/${web.length} web carriers detected in the browser`, missed.length ? 'missed ' + missed.join('; ') : `incl. browser-only ${browserOnly.join(', ')}`);

  // 3. a plain page stays quiet
  await page.navigate(`http://127.0.0.1:${port}/plain.html`);
  const plain = (await scan()).filter((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.medium);
  check(!plain.length, 'plain page: no finding at medium or above', plain.map((f) => `${f.kind}:${f.severity}`).join(', '));
} catch (e) {
  check(false, 'e2e run', e.stack || e.message);
} finally {
  clearTimeout(watchdog);
  await b.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `e2e: ${failed} of ${results.length} checks failed` : `e2e: all ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
