// Does a text read like instructions to a model? A scored, categorised heuristic (no ML): each signal
// family has a weight, the score is 1 − Π(1 − weight) over the families that match, and a text counts as
// instructions at 0.5. English plus German, French, Spanish, Portuguese, Italian, Dutch, Russian, Chinese
// and Japanese for the strongest families. Runs on the text and on its skeleton (look-alike letters and
// compatibility forms folded), so "іgnore" with a Cyrillic і still counts — reported as `disguised`.

import { skeleton } from './confusables.js';

// \b only knows ASCII word characters; in parts with non-ASCII letters ("ü", "à", "ç") a \b before a
// group or letter becomes "no letter before", any other \b "no letter after"
const LEFT = String.raw`(?<![\p{L}\p{N}_])`;
const RIGHT = String.raw`(?![\p{L}\p{N}_])`;
const unicodeBoundaries = (p) => p.replace(/\\b(?=[(\p{L}])/gu, LEFT).replace(/\\b/g, RIGHT);
const R = (parts, flags = 'iu') => new RegExp(parts.map((p) => (/[^\x00-\x7F]/.test(p) ? unicodeBoundaries(p) : p)).join('|'), flags);

export const SIGNALS = [
  {
    id: 'override',
    label: 'overrides earlier instructions',
    weight: 0.6,
    re: R([
      String.raw`\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|system|preceding|original)\b`,
      String.raw`\b(ignoriere|ignorieren sie|vergiss|vergessen sie|missachte)\b.{0,40}\b(alle|vorherigen?|bisherigen?|obigen?|anweisungen|instruktionen)\b`,
      String.raw`\b(ignore[zr]?|oublie[zr]?)\b.{0,40}\b(toutes|les|précédentes|instructions|consignes)\b.{0,30}\b(instructions|consignes|précédentes)\b`,
      String.raw`\b(ignora|ignore|olvida|esquece|esqueça|dimentica)\b.{0,40}\b(instrucciones|instruções|istruzioni)\b`,
      String.raw`\b(negeer|vergeet)\b.{0,40}\b(instructies|opdrachten)\b`,
      String.raw`(игнорируй|игнорируйте|забудь|забудьте|проигнорируй)[^.]{0,40}(инструкци|указани|все)`,
      String.raw`(忽略|无视|忘记|忘掉)[^。]{0,12}(之前|以上|上面|前面|所有|先前)[^。]{0,8}(指令|指示|说明|提示)`,
      String.raw`(以前|これまで|上記|前)の(指示|命令|指令)を(無視|忘れ)`,
    ]),
  },
  {
    id: 'role',
    label: 'assigns a role or new instructions',
    weight: 0.5,
    re: R([
      String.raw`\b(you are now\b|you're now\b|new instructions?|from now on|updated instructions|your (real|true|new|actual) (task|goal|instructions|purpose)|you (must|will) now\b|override (mode|enabled))`,
      String.raw`\byou are (an?|the) ([\w-]+ ){0,2}(ai|assistant|agent|bot|chatbot|model|llm|language model|persona)\b`,
      String.raw`\b(du bist (jetzt|nun) (ein|eine|der|die)|neue anweisungen?|ab (jetzt|sofort) (bist|wirst|musst) du|systemprompt)`,
      String.raw`\b(tu es (maintenant|désormais) (un|une)|nouvelles instructions|à partir de maintenant)`,
      String.raw`\b(ahora eres (un|una)|nuevas instrucciones|a partir de ahora|agora você é|novas instruções|ora sei (un|una)|nuove istruzioni|d'ora in poi|je bent nu (een|de)|nieuwe instructies)`,
      String.raw`(теперь ты|новые инструкции|системный промпт|с этого момента)`,
      String.raw`(你现在是|从现在开始|新的指令|系统提示)`,
      String.raw`(あなたは今から|新しい指示|システムプロンプト)`,
    ]),
  },
  {
    // on its own a mention like this is ordinary text (an article about prompts); it adds up with others
    id: 'persona',
    label: 'talks about prompts or personas',
    weight: 0.3,
    re: R([String.raw`\b(system prompt|developer message|act as (an?|the|my|if)|pretend (to be|you are)|roleplay as|you are (an?|the) )`]),
  },
  {
    id: 'leak',
    label: 'asks for the system prompt',
    weight: 0.5,
    re: R([
      String.raw`\b(print|reveal|show|output|repeat|display|recite|dump|leak|tell me|give me|write out)\b.{0,20}\b(your|the) (full |entire |exact |original |hidden |initial |secret )*(system prompt|system message|initial prompt|hidden prompt|instructions you were given|developer (message|instructions))\b`,
      String.raw`\b(gib|zeig|verrate)\b.{0,20}\b(deinen|den) (system ?prompt|systemprompt)\b`,
    ]),
  },
  {
    id: 'secrecy',
    label: 'asks to hide something from the user',
    weight: 0.5,
    re: R([
      String.raw`\b(do not|don't|never) (tell|reveal|mention|inform|show|disclose)\b`,
      String.raw`\b(without (telling|informing|asking|notifying) the user|keep (this|it) (secret|hidden) from)\b`,
      String.raw`\b(sag|erzähl|verrate) (es )?(dem )?(nutzer|benutzer|user) nicht\b`,
      String.raw`\b(ne (dis|révèle|mentionne) (rien|pas))\b`,
      String.raw`\b(no (le )?(digas|reveles|menciones))\b`,
    ]),
  },
  {
    id: 'exfil',
    label: 'asks to send data somewhere',
    weight: 0.6,
    re: R([
      String.raw`\b(send|forward|email|e-mail|post|upload|leak|exfiltrate|transmit|submit)\b.{0,40}\b(conversation|chat|history|messages?|password|credentials?|api keys?|tokens?|cookies?|secrets?|personal data|private keys?|ssh keys?|env(ironment)? (variables?|vars)|\.env)\b`,
      String.raw`\b(sende|schicke|übermittle|lade)\b.{0,40}\b(passw(o|ö)rt(er)?|zugangsdaten|verlauf|unterhaltung|schlüssel|geheimnisse)\b`,
      String.raw`\b(envoie|transmets|envía|envia|manda|invia)\b.{0,40}\b(mot de passe|historique|conversation|contraseñas?|senhas?|historial|histórico|password|cronologia)\b`,
      String.raw`(отправь|перешли)[^.]{0,40}(пароль|историю|переписку|ключ)`,
      String.raw`(发送|上传|转发)[^。]{0,12}(密码|聊天记录|对话|密钥|令牌)`,
    ]),
  },
  {
    id: 'addressed',
    label: 'addressed to an AI',
    weight: 0.5,
    re: R([
      String.raw`\b(when|if) (you are|you're) (an? )?(ai|llm|language model|assistant|agent|chatbot)\b`,
      String.raw`\bnote to (ai|llm|the (ai|model|assistant|agent))s?\b`,
      String.raw`\b(attention|dear|hey|hello),? (ai|llm|chatgpt|claude|gemini|copilot|assistant|agent|language model)s?\b`,
      String.raw`\b(ai|llm) (agents?|assistants?|models?) (reading|processing|summari[sz]ing) this\b`,
      String.raw`\b(wenn du eine? (ki|künstliche intelligenz|sprachmodell)|hinweis an (die )?ki)\b`,
      String.raw`\b(si tu es une? (ia|intelligence artificielle)|si eres una? (ia|inteligencia artificial)|se você é uma? (ia|inteligência artificial))\b`,
    ]),
  },
  {
    id: 'delimiter',
    label: 'contains chat-template tokens',
    weight: 0.7,
    re: R([String.raw`<\|im_start\|>|<\|im_end\|>|\[INST\]|<<SYS>>|<\|system\|>|<\|user\|>|<\|assistant\|>|<\|start_header_id\|>|<\|eot_id\|>|<\|endoftext\|>|<start_of_turn>|<\/?system>|^\s*###\s*(instruction|system)\s*:`], 'imu'),
  },
  {
    id: 'output',
    label: 'dictates the answer',
    weight: 0.5,
    re: R([String.raw`\b(respond|reply|answer) (only )?with\b`, String.raw`\bassistant:`, String.raw`\b(output|print|say) only\b`]),
  },
  {
    id: 'tool',
    label: 'tells an agent to use a tool',
    weight: 0.35,
    re: R([
      String.raw`\b(call|invoke|use|run) the [\w.-]+ (tool|function|command)\b`,
      String.raw`\b(run|execute) (the following|this) (command|script|code)\b`,
      String.raw`\b(navigate|go|browse) to (the url|https?:\/\/)`,
      String.raw`\b(open|visit|fetch|load) (this|the following) (url|link|page)\b`,
      String.raw`\b(click|press) (the|on) .{0,30}(button|link)\b`,
    ]),
  },
];

const BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
export const THRESHOLD = 0.5;

function score(ids) {
  return 1 - ids.reduce((p, id) => p * (1 - BY_ID[id].weight), 1);
}

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };

/**
 * What a text reads as once disguises are undone: look-alike letters and compatibility forms folded
 * (skeleton), combining marks stripped (zalgo), percent-encoding decoded, and leetspeak inside words
 * ("1gn0r3") turned back into letters. Only used when the text itself doesn't read as instructions.
 */
export function fold(s) {
  let t = String(s);
  if (/[^\x00-\x7F]/.test(t)) t = skeleton(t.normalize('NFD').replace(/\p{M}+/gu, '')).normalize('NFC');
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t.replace(/\+/g, ' '));
    } catch {
      /* keep */
    }
  }
  // leetspeak: only inside tokens that mix letters with digits / symbols
  t = t.replace(/[\p{L}0-9@$!|]+/gu, (w) => (/\p{L}/u.test(w) && /[0-9@$!|]/.test(w) ? w.replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c) : w));
  return t;
}

/**
 * How much `text` reads like instructions to a model.
 * @returns {{ score: number, signals: string[], instructions: boolean, disguised: boolean }}
 *   `disguised`: only the skeleton (look-alike letters folded) reads like instructions.
 */
export function instructionSignals(text) {
  const s = String(text ?? '');
  if (!s) return { score: 0, signals: [], instructions: false, disguised: false };
  const hit = (t) => SIGNALS.filter((g) => g.re.test(t)).map((g) => g.id);
  let ids = hit(s);
  let disguised = false;
  if (score(ids) < THRESHOLD) {
    const folded = fold(s);
    if (folded !== s) {
      const more = hit(folded);
      if (score(more) >= THRESHOLD) {
        ids = [...new Set([...ids, ...more])];
        disguised = true;
      }
    }
  }
  const sc = Math.round(score(ids) * 100) / 100;
  return { score: sc, signals: ids, instructions: sc >= THRESHOLD, disguised };
}

/** True when `text` reads like instructions to a model. */
export function looksLikeInstructions(text) {
  return instructionSignals(text).instructions;
}

/** Labels for signal ids. */
export const signalLabel = (id) => BY_ID[id]?.label || id;

// A notice to AI crawlers or agents that sets terms rather than injecting a task ("AI systems may not use
// this content for training"). Reported at low severity, so publishers' opt-out notices aren't alarms.
const DIRECTIVE = R([
  String.raw`\b(ai|llm|gpt|chatgpt|claude|gemini|crawlers?|bots?|scrapers?|language models?|machine learning)\b.{0,80}\b(must not|may not|shall not|are not (allowed|permitted)|is (not permitted|prohibited|forbidden)|prohibited|forbidden|not allowed|do not)\b.{0,60}\b(use|train|training|scrape|scraping|index|crawl|reproduce|summari[sz]e|ingest)`,
  String.raw`\b(no|not for) (ai|llm|machine learning) (training|use|scraping)\b`,
  String.raw`\b(noai|noimageai)\b`,
  String.raw`\b(text and data mining|tdm)\b.{0,60}\b(reserved|prohibited|opt.?out)\b`,
]);

/** A notice addressed to AI crawlers / agents about how content may be used. */
export function looksLikeAiDirective(text) {
  return DIRECTIVE.test(String(text ?? ''));
}
