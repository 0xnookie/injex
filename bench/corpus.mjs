// Benign negatives for the scanner benchmark: text that legitimately uses what injex looks for — Persian
// and Hindi joiners, Arabic and Hebrew with direction marks, emoji ZWJ sequences, flags and keycaps,
// Russian, Greek, Chinese and Japanese prose, mathematical letters in a formula, code, documentation —
// combined deterministically into many documents. Plus real files of this repository (code, docs).
// Dev-only: nothing here ships in the extension or the npm package.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seeded } from '../src/core/generators.js';

const ZWNJ = '\u{200C}';
const ZWJ = '\u{200D}';
const RLM = '\u{200F}';
const LRM = '\u{200E}';

export const SENTENCES = {
  persian: [`من کتاب${ZWNJ}ها را دوست دارم و هر روز می${ZWNJ}خوانم.`, `این برنامه${ZWNJ}ای برای مدیریت پروژه${ZWNJ}هاست.`, `ما فردا به کتابخانه می${ZWNJ}رویم.`],
  arabic: [`مرحبا بكم في موقعنا، نتمنى لكم يوما سعيدا.`, `السعر ${LRM}25 USD${LRM} يشمل الضريبة.`, `يرجى قراءة الشروط قبل التسجيل.`],
  hebrew: [`שלום, זהו מסמך לדוגמה בעברית.`, `המחיר הוא ${LRM}120 ₪${RLM} כולל מע"מ.`, `נא לקרוא את ההוראות לפני השימוש.`],
  hindi: [`नमस्ते, आज मौसम बहुत अच्छा है।`, `क्${ZWJ}ष और द्${ZWNJ}व जैसे संयुक्ताक्षर सामान्य हैं।`, `कृपया फ़ॉर्म भरकर जमा करें।`],
  russian: ['Привет, это обычный текст на русском языке.', 'Москва — столица России, здесь много музеев.', 'Пожалуйста, прочитайте инструкцию перед использованием.'],
  greek: ['Καλημέρα, αυτό είναι ένα κείμενο στα ελληνικά.', 'Η Αθήνα είναι η πρωτεύουσα της Ελλάδας.', 'Η εξίσωση α + β = γ ισχύει πάντα.'],
  chinese: ['今天天气很好，我们去公园散步吧。', '请在使用前仔细阅读说明书。', '这个软件可以帮助你管理任务。'],
  japanese: ['今日はとても良い天気ですね。', 'ご利用の前に説明書をお読みください。', '東京は日本の首都です。'],
  emoji: [`Family day 👨${ZWJ}👩${ZWJ}👧${ZWJ}👦 at the park!`, 'Go team 🇩🇪🇫🇷🇯🇵 — great match ⚽', `Rainbow 🏳\uFE0F${ZWJ}🌈 and heart ❤\uFE0F and keycap 1\uFE0F⃣`, `Wales 🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F} and Scotland 🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}`, `Thumbs 👍🏽 and 👩🏻${ZWJ}💻 coding`],
  english: ['The quarterly report shows steady growth in all regions.', 'Please read the terms before you sign up for the newsletter.', 'Our support team answers questions within one business day.', 'You are a valued customer, and we appreciate your feedback.', 'This article explains how system prompts work in chat assistants.', 'Send us your questions by e-mail and we will reply soon.'],
  math: ['Let 𝐱 ∈ ℝⁿ and 𝑓(𝐱) = ‖𝐱‖² — the minimum is at 𝐱 = 𝟎.', 'The set ℕ of natural numbers and ℤ of integers.'],
  code: ['const naïve = true; // café-style variable names are fine', 'def größe(x):\n    return x * 2', '<p dir="rtl">مرحبا</p> <bdi>abc</bdi>'],
};

/** n benign documents: each a seeded mix of 2–6 sentences from different languages. */
export function syntheticNegatives(n = 1000, seed = 'injex-bench') {
  const rng = seeded(seed);
  const pools = Object.entries(SENTENCES);
  const docs = [];
  for (let i = 0; i < n; i++) {
    const k = 2 + Math.floor(rng() * 5);
    const parts = [];
    for (let j = 0; j < k; j++) {
      const [lang, list] = pools[Math.floor(rng() * pools.length)];
      parts.push({ lang, text: list[Math.floor(rng() * list.length)] });
    }
    docs.push({ id: `syn-${i + 1}`, text: parts.map((p) => p.text).join(rng() < 0.5 ? ' ' : '\n'), langs: [...new Set(parts.map((p) => p.lang))] });
  }
  return docs;
}

/** This repository's own source and docs (minus tests, fixtures, research notes and vendored data). */
export function repoNegatives(root) {
  let files = [];
  try {
    files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return files
    .filter((f) => /\.(?:m?js|md|json|html|css|ya?ml)$/i.test(f) && !/^(?:test|vendor|research_notes|reports|bench)\//.test(f) && !/^src\/(?:transforms|data)\//.test(f))
    .map((f) => ({ id: f, file: f, text: readFileSync(join(root, f), 'utf8') }));
}
