// injex for VS Code: hidden text and prompt injection in the files you edit — diagnostics, decoded hidden
// text inline and on hover, a "remove hidden characters" quick fix, a workspace scan (also PDF, Word and
// other documents) and an audit of AI-agent files and configuration. Runs locally; nothing is sent anywhere.

'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createAnalyzer, SEVERITIES } = require('./analyze.js');

// packaged: extension/core/src/core/…; from the repository (F5 on vscode/): ../src/core/…
const CORE_BASE = fs.existsSync(path.join(__dirname, 'core', 'src', 'core')) ? path.join(__dirname, 'core') : path.join(__dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(CORE_BASE, rel)).href);

const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/coverage/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/target/**,**/*.min.js,**/*.map}';
const DIAG_SEVERITY = () => ({
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
  info: vscode.DiagnosticSeverity.Hint,
});

let core;
let analyzer;
let diagnostics;
let decoration;
const byUri = new Map(); // uri → editor findings (for hovers, fixes, decorations)
const timers = new Map();

const config = () => vscode.workspace.getConfiguration('injex');
const relPath = (uri) => vscode.workspace.asRelativePath(uri, false);
const toRange = (r) => new vscode.Range(r.line, r.character, r.endLine, r.endCharacter);

async function loadCore() {
  const mods = await Promise.all(['filescan', 'audit', 'scan', 'decoder', 'stego', 'docs/index', 'taxonomy'].map((m) => load(`src/core/${m}.js`)));
  core = Object.assign({}, ...mods);
  analyzer = createAnalyzer(core);
}

function publish(uri, findings) {
  byUri.set(uri.toString(), findings);
  const sev = DIAG_SEVERITY();
  diagnostics.set(
    uri,
    findings.map((f) => {
      const d = new vscode.Diagnostic(toRange(f.range), f.message, sev[f.severity] ?? vscode.DiagnosticSeverity.Information);
      d.source = 'injex';
      d.code = f.rule || f.kind;
      return d;
    }),
  );
  for (const editor of vscode.window.visibleTextEditors) if (editor.document.uri.toString() === uri.toString()) decorate(editor);
}

function decorate(editor) {
  if (!decoration) return;
  const findings = config().get('showDecoded', true) ? byUri.get(editor.document.uri.toString()) || [] : [];
  editor.setDecorations(
    decoration,
    findings
      .filter((f) => f.shown || f.decoded)
      .map((f) => ({
        range: toRange(f.range),
        hoverMessage: undefined,
        renderOptions: { after: { contentText: ` ${f.decoded ? '⟨hidden: ' + f.decoded.slice(0, 80) + (f.decoded.length > 80 ? '…' : '') + '⟩' : f.shown}` } },
      })),
  );
}

function scanDocumentText(doc) {
  if (!analyzer || doc.uri.scheme === 'output' || doc.uri.scheme === 'vscode') return;
  const enabled = config().get('enable', true);
  if (!enabled) return diagnostics.delete(doc.uri);
  const text = doc.getText();
  if (text.length > config().get('maxFileSize', 2000000)) return;
  publish(doc.uri, analyzer.analyze(text, relPath(doc.uri), { minSeverity: config().get('minSeverity', 'low'), audit: config().get('auditAgentConfig', true) }));
}

function schedule(doc) {
  const key = doc.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      scanDocumentText(doc);
    }, 300),
  );
}

/** Scan files of the workspace: text files with the editor rules, documents (PDF, Word …) with scanDocument. */
async function scanWorkspace({ agentOnly = false } = {}) {
  const max = config().get('maxFiles', 5000);
  const minSeverity = config().get('minSeverity', 'low');
  const uris = await vscode.workspace.findFiles('**/*', EXCLUDE, max);
  let files = 0;
  let findings = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: agentOnly ? 'injex: auditing agent files' : 'injex: scanning the workspace', cancellable: true }, async (progress, token) => {
    for (const uri of uris) {
      if (token.isCancellationRequested) break;
      const rel = relPath(uri);
      if (agentOnly && !(core.isAgentFile(rel) || core.isAuditFile(rel))) continue;
      let bytes;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch {
        continue;
      }
      files++;
      let list = [];
      if (core.DOC_EXT.test(rel)) {
        if (agentOnly || bytes.length > config().get('maxDocumentSize', 50000000)) continue;
        const r = await core.scanDocument(bytes, rel).catch(() => null);
        list = (r?.findings || [])
          .filter((f) => SEVERITIES.indexOf(f.severity) <= SEVERITIES.indexOf(minSeverity))
          .map((f) => ({ source: 'document', kind: f.kind, rule: null, severity: f.severity, range: { line: 0, character: 0, endLine: 0, endCharacter: 0 }, message: `${core.KINDS[f.kind]?.label || f.kind}${f.where ? ' (' + f.where + ')' : ''}: ${f.note}${f.payload ? ' — “' + core.visualize(String(f.payload), 160) + '”' : ''}`, decoded: '', shown: '', refs: [], tags: [], fixable: false, finding: f }));
      } else {
        if (bytes.length > config().get('maxFileSize', 2000000) || bytes.subarray(0, 8000).includes(0)) continue;
        list = analyzer.analyze(new TextDecoder().decode(bytes), rel, { minSeverity, audit: config().get('auditAgentConfig', true) });
      }
      findings += list.length;
      if (list.length) publish(uri, list);
      else diagnostics.delete(uri);
      if (files % 50 === 0) progress.report({ message: `${files} files` });
    }
  });
  const msg = `injex: ${findings} finding${findings === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`;
  if (findings) vscode.window.showWarningMessage(msg, 'Show problems').then((a) => a && vscode.commands.executeCommand('workbench.actions.view.problems'));
  else vscode.window.showInformationMessage(msg);
  return { files, findings };
}

class HoverProvider {
  provideHover(doc, pos) {
    const hits = (byUri.get(doc.uri.toString()) || []).filter((f) => toRange(f.range).contains(pos) || (f.range.line === pos.line && f.range.endCharacter === pos.character));
    if (!hits.length) return null;
    const m = new vscode.MarkdownString(hits.map((f) => analyzer.hover(f)).join('\n\n---\n\n'));
    m.isTrusted = false;
    return new vscode.Hover(m, toRange(hits[0].range));
  }
}

class FixProvider {
  provideCodeActions(doc, range, context) {
    const found = byUri.get(doc.uri.toString()) || [];
    const actions = [];
    for (const d of context.diagnostics.filter((x) => x.source === 'injex')) {
      const f = found.find((x) => toRange(x.range).isEqual(d.range) && x.fixable);
      if (!f) continue;
      const r = toRange(f.range);
      const a = new vscode.CodeAction('Remove hidden characters here', vscode.CodeActionKind.QuickFix);
      a.edit = new vscode.WorkspaceEdit();
      a.edit.replace(doc.uri, r, analyzer.clean(doc.getText(r)).text);
      a.diagnostics = [d];
      a.isPreferred = true;
      actions.push(a);
    }
    if (found.some((f) => f.fixable)) {
      const all = new vscode.CodeAction('Remove all hidden characters in this file', vscode.CodeActionKind.QuickFix);
      all.command = { command: 'injex.cleanFile', title: 'Remove all hidden characters in this file' };
      actions.push(all);
    }
    return actions;
  }
}

async function cleanFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const sel = editor.selection && !editor.selection.isEmpty ? editor.selection : null;
  const range = sel || new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  const r = analyzer.clean(doc.getText(range));
  if (!r.removed && !r.replaced) return vscode.window.showInformationMessage('injex: no hidden characters to remove');
  await editor.edit((e) => e.replace(range, r.text));
  vscode.window.showInformationMessage(`injex: removed ${r.removed} hidden character${r.removed === 1 ? '' : 's'}${r.replaced ? `, replaced ${r.replaced} look-alike letter${r.replaced === 1 ? '' : 's'}` : ''}`);
}

async function decodeSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const text = editor.selection.isEmpty ? editor.document.lineAt(editor.selection.active.line).text : editor.document.getText(editor.selection);
  const d = core.universalDecode(text);
  // hidden payloads first (tags, emoji / invisible-bit steganography), then encodings
  const items = core.revealAll(text).map((h) => ({ label: h.method, detail: h.text.slice(0, 300), value: h.text }));
  if (d?.text && d.text !== text) items.push({ label: d.method, detail: d.text.slice(0, 300), value: d.text });
  for (const a of (d?.alternatives || []).slice(0, 5)) if (!a.weak) items.push({ label: a.method, detail: a.text.slice(0, 300), value: a.text });
  if (!items.length) return vscode.window.showInformationMessage('injex: nothing to decode');
  const pick = await vscode.window.showQuickPick(items, { title: 'injex: decoded', matchOnDetail: true });
  if (pick) {
    await vscode.env.clipboard.writeText(pick.value);
    vscode.window.showInformationMessage(`injex: ${pick.label} copied`);
  }
}

async function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection('injex');
  decoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '0 0 1px 0',
    borderStyle: 'dashed',
    borderColor: new vscode.ThemeColor('editorWarning.foreground'),
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic', margin: '0 0 0 4px' },
  });
  context.subscriptions.push(diagnostics, decoration);
  await loadCore();

  const selector = [{ scheme: 'file' }, { scheme: 'untitled' }];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new HoverProvider()),
    vscode.languages.registerCodeActionsProvider(selector, new FixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidOpenTextDocument(scanDocumentText),
    vscode.workspace.onDidChangeTextDocument((e) => config().get('scanOnType', true) && schedule(e.document)),
    vscode.workspace.onDidSaveTextDocument(scanDocumentText),
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(decorate)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('injex') && vscode.workspace.textDocuments.forEach(scanDocumentText)),
    vscode.commands.registerCommand('injex.scanWorkspace', () => scanWorkspace()),
    vscode.commands.registerCommand('injex.auditAgentFiles', () => scanWorkspace({ agentOnly: true })),
    vscode.commands.registerCommand('injex.cleanFile', cleanFile),
    vscode.commands.registerCommand('injex.decodeSelection', decodeSelection),
    vscode.commands.registerCommand('injex.clearProblems', () => {
      diagnostics.clear();
      byUri.clear();
      vscode.window.visibleTextEditors.forEach(decorate);
    }),
  );
  vscode.workspace.textDocuments.forEach(scanDocumentText);
  return { analyze: (text, file, opts) => analyzer.analyze(text, file, opts) };
}

function deactivate() {
  for (const t of timers.values()) clearTimeout(t);
}

module.exports = { activate, deactivate, scanWorkspace };
