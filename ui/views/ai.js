// AI tools over OpenRouter with the user's own key: PromptCraft rewrites, Anti-Classifier and translation.

import { chat, MODEL_SUGGESTIONS, STRATEGIES, LANGUAGES, translatePrompt, TO_ENGLISH } from '../../src/core/openrouter.js';
import { ANTICLASSIFIER_SYSTEM_PROMPT } from '../../src/data/anticlassifier-prompt.js';
import { $, h, seg, empty, clip, mini, keepDraft, setValue, icon } from '../lib.js';

let ctx;
let mode;
let abort = null;
const o = { strategy: 'rephrase', custom: '', variants: 3, language: 'Spanish', toEnglish: false };

function model() {
  return ctx.settings.models?.[mode.get()] || 'openrouter/auto';
}

function keyBanner() {
  $('iKeyBanner').hidden = !!ctx.settings.openrouterKey;
}

function opts() {
  const box = $('iOpts');
  box.textContent = '';
  const m = mode.get();
  $('iModel').value = model();
  if (m === 'promptcraft') {
    box.append(
      h(
        'select',
        { title: 'Mutation strategy', onchange: (e) => ((o.strategy = e.target.value), opts()) },
        Object.entries(STRATEGIES).map(([k, s]) => h('option', { value: k, text: s.label, title: s.desc, selected: k === o.strategy })),
      ),
      o.strategy === 'custom' ? h('input', { type: 'text', value: o.custom, placeholder: 'Your rewrite instruction', style: 'flex: 1; min-width: 160px', oninput: (e) => (o.custom = e.target.value) }) : h('span', { class: 'muted small', text: STRATEGIES[o.strategy].desc }),
      h('label', { class: 'muted small', title: 'Parallel requests' }, 'Variants ', h('input', { type: 'number', min: 1, max: 6, value: o.variants, oninput: (e) => (o.variants = Number(e.target.value)) })),
    );
  } else if (m === 'anticlassifier') {
    box.append(h('span', { class: 'muted small', text: 'Rewrites trigger words with synonyms and circumlocutions, and explains each substitution.' }));
  } else {
    box.append(
      h('div', { class: 'seg' }, h('button', { class: o.toEnglish ? '' : 'on', onclick: () => ((o.toEnglish = false), opts()) }, 'Translate to'), h('button', { class: o.toEnglish ? 'on' : '', onclick: () => ((o.toEnglish = true), opts()) }, 'To English')),
    );
    if (!o.toEnglish) box.append(h('select', { onchange: (e) => (o.language = e.target.value) }, LANGUAGES.map(([l, tag]) => h('option', { value: l, text: tag ? `${l} (${tag})` : l, selected: l === o.language }))));
  }
  box.append(h('span', { class: 'spacer' }), runBtn());
}

function runBtn() {
  const b = h('button', { class: 'btn primary', id: 'iRun', onclick: () => (abort ? stop() : run()) }, icon(abort ? 'stop' : 'spark'), abort ? 'Stop' : 'Run');
  return b;
}

function setRunning(on) {
  if (!on) abort = null;
  $('iRun')?.replaceWith(runBtn());
}

function stop() {
  abort?.abort();
  abort = null;
  setRunning(false);
}

function card(title, sub) {
  const pre = h('pre', { class: 'out tall', 'data-empty': '…' });
  const actions = h('div', { class: 'row-actions', style: 'margin-top: 10px' });
  const head = h('div', { class: 'card-head' }, h('b', { text: title }), h('span', { class: 'muted small', text: sub }), h('span', { class: 'spacer' }));
  const el = h('div', { class: 'card', style: 'margin-bottom: 12px' }, head, pre, actions);
  return {
    el,
    done(text, ms) {
      pre.textContent = clip(text, 40000);
      head.append(h('span', { class: 'chip dim', text: (ms / 1000).toFixed(1) + ' s' }), mini('Copy', () => ctx.copy(text, title), { iconName: 'copy', primary: true }));
      actions.append(
        h('button', { class: 'btn', onclick: () => setValue($('iIn'), text) }, 'Use as input'),
        h('button', { class: 'btn', onclick: () => ctx.switchTo('transform', { text }) }, 'Transform'),
        h('button', { class: 'btn', onclick: () => ctx.switchTo('tokens', { text }) }, 'Count tokens'),
      );
    },
    fail(err) {
      el.classList.add('bad');
      pre.textContent = err;
    },
  };
}

async function run() {
  const text = $('iIn').value.trim();
  if (!text) return ctx.toast('Enter a prompt first', true);
  if (!ctx.settings.openrouterKey) {
    keyBanner();
    return ctx.toast('Add your OpenRouter API key in Settings', true);
  }
  const m = mode.get();
  const out = $('iOut');
  out.textContent = '';
  const ac = (abort = new AbortController());
  setRunning(true);
  const base = { key: ctx.settings.openrouterKey, model: model(), temperature: Number(ctx.settings.temperature) || 0.9, signal: ac.signal };
  const jobs = [];
  if (m === 'promptcraft') {
    const s = STRATEGIES[o.strategy];
    const system = o.strategy === 'custom' ? `${o.custom || 'Rewrite the prompt.'} Do NOT add commentary — output ONLY the rewritten prompt.` : s.prompt;
    const n = Math.max(1, Math.min(6, o.variants || 1));
    for (let i = 0; i < n; i++) jobs.push([`${s.label}${n > 1 ? ' #' + (i + 1) : ''}`, { ...base, system, user: text }]);
  } else if (m === 'anticlassifier') {
    jobs.push(['Anti-Classifier', { ...base, system: ANTICLASSIFIER_SYSTEM_PROMPT, user: text, maxTokens: 4096 }]);
  } else {
    jobs.push([o.toEnglish ? 'English' : o.language, { ...base, temperature: 0.3, system: o.toEnglish ? TO_ENGLISH : translatePrompt(o.language), user: text }]);
  }
  await Promise.allSettled(
    jobs.map(async ([title, req]) => {
      const c = card(title, req.model);
      out.append(c.el);
      const t0 = performance.now();
      try {
        c.done(await chat(req), performance.now() - t0);
      } catch (e) {
        c.fail(e.name === 'AbortError' ? 'Stopped.' : e.message || String(e));
      }
    }),
  );
  if (abort === ac) setRunning(false);
}

export async function init(c) {
  ctx = c;
  for (const [id, name] of MODEL_SUGGESTIONS) $('iModels').append(h('option', { value: id, text: name }));
  mode = seg($('iMode'), opts);
  $('iModel').addEventListener('change', () => {
    const v = $('iModel').value.trim();
    if (v) ctx.save({ models: { ...ctx.settings.models, [mode.get()]: v } });
  });
  $('iKeyBtn').addEventListener('click', () => ctx.openOptions('#ai'));
  $('iIn').addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && run());
  keyBanner();
  opts();
  await keepDraft($('iIn'), 'ai');
  $('iOut').append(empty('✦', 'AI tools', 'PromptCraft rewrites a prompt with a strategy (several variants in parallel), Anti-Classifier swaps trigger words, Translate covers living, dead and constructed languages. Ctrl+Enter runs.'));
}

export function activate(payload) {
  if (!payload) return;
  if (payload.mode) mode.set(payload.mode);
  if (payload.toEnglish !== undefined) {
    o.toEnglish = payload.toEnglish;
    opts();
  }
  if (payload.text !== undefined) setValue($('iIn'), payload.text);
}

export function onSettings(changes) {
  if (changes.openrouterKey) keyBanner();
  if (changes.models) $('iModel').value = model();
}
