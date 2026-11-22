"""Build test/fixtures/hf-tokenizers.json: small tokenizer.json configurations that exercise the parts of
src/core/hftokenizer.js the big real tokenizers don't reach, with the IDs, pre-tokenizer pieces and
normalized text that Hugging Face's own `tokenizers` library gives for each sample.

    pip install tokenizers
    python tools/hf-tokenizer-fixtures.py

test/tokenizer-tests.mjs compares injex against the recorded values (no Python needed there).
"""

import json
import pathlib

import tokenizers
from tokenizers import Tokenizer

OUT = pathlib.Path(__file__).resolve().parent.parent / "test" / "fixtures" / "hf-tokenizers.json"


def bytes_to_unicode():
    bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {b: chr(c) for b, c in zip(bs, cs)}


B = bytes_to_unicode()


def bl(s):
    """A string in ByteLevel characters."""
    return "".join(B[b] for b in s.encode("utf-8"))


def with_merges(vocab, merges, prefix=""):
    """Add merge results to the vocabulary (checking that both sides exist), return the merge strings."""
    out = []
    for a, b in merges:
        assert a in vocab and b in vocab, (a, b)
        m = a + (b[len(prefix):] if prefix and b.startswith(prefix) else b)
        if m not in vocab:
            vocab[m] = len(vocab)
        out.append(f"{a} {b}")
    return out


def added(id_, content, special=True, lstrip=False, rstrip=False, normalized=False, single_word=False):
    return {"id": id_, "content": content, "single_word": single_word, "lstrip": lstrip, "rstrip": rstrip, "normalized": normalized, "special": special}


def tokenizer(model, normalizer=None, pre_tokenizer=None, added_tokens=()):
    return {"version": "1.0", "truncation": None, "padding": None, "added_tokens": list(added_tokens), "normalizer": normalizer, "pre_tokenizer": pre_tokenizer, "post_processor": None, "decoder": None, "model": model}


def bpe(vocab, merges, **kw):
    m = {"type": "BPE", "dropout": None, "unk_token": None, "continuing_subword_prefix": None, "end_of_word_suffix": None, "fuse_unk": False, "byte_fallback": False, "ignore_merges": False, "vocab": vocab, "merges": merges}
    m.update(kw)
    return m


LLAMA3 = r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"
configs = {}

# 1. byte-level BPE, GPT-2 style split inside ByteLevel, special / lstrip+rstrip / single_word added tokens
v = {B[b]: b for b in range(256)}
zw = bl("\u200b")
m = with_merges(v, [("Ġ", "t"), ("h", "e"), ("Ġt", "he"), ("i", "n"), ("Ġ", "a"), ("l", "l"), ("e", "ll"), ("h", "ell"), ("hell", "o"), ("Ġ", "h"), ("Ġh", "ell"), ("Ġhell", "o"), ("Ġ", "i"), ("Ġi", "n"), ("o", "r"), ("Ġ", "w"), ("Ġw", "or"), ("Ġwor", "l"), ("Ġworl", "d"), ("Ġ", "Ġ"), ("ĠĠ", "ĠĠ"), ("Ċ", "Ċ"), ("1", "2"), ("12", "3"), (zw[0], zw[1]), (zw[0] + zw[1], zw[2]), ("'", "s"), ("I", "g"), ("Ig", "n"), ("Ign", "or"), ("Ignor", "e")])
n = len(v)
configs["bytelevel-gpt2"] = tokenizer(
    bpe(v, m),
    pre_tokenizer={"type": "ByteLevel", "add_prefix_space": False, "trim_offsets": True, "use_regex": True},
    added_tokens=[added(n, "<|endoftext|>"), added(n + 1, "<|tool|>", special=False, lstrip=True, rstrip=True), added(n + 2, "[x]", special=False, single_word=True)],
)

# 2. byte-level BPE, Llama 3 style Split + ByteLevel without regex, add_prefix_space, ignore_merges
configs["bytelevel-llama3"] = tokenizer(
    bpe(dict(v), m, ignore_merges=True),
    pre_tokenizer={"type": "Sequence", "pretokenizers": [{"type": "Split", "pattern": {"Regex": LLAMA3}, "behavior": "Isolated", "invert": False}, {"type": "ByteLevel", "add_prefix_space": True, "trim_offsets": True, "use_regex": False}]},
    added_tokens=[added(n, "<|begin_of_text|>"), added(n + 1, "<|eot_id|>")],
)

# 3. SentencePiece-style BPE: Prepend + Replace normalizer, byte fallback, rstrip and normalized added tokens
sv = {"<unk>": 0, "<s>": 1, "</s>": 2}
for b in range(256):
    sv[f"<0x{b:02X}>"] = len(sv)
for c in "▁abcdefghijklmnopqrstuvwxyz":
    sv[c] = len(sv)
sm = with_merges(sv, [("▁", "t"), ("h", "e"), ("▁t", "he"), ("▁", "a"), ("i", "n"), ("▁", "i"), ("▁i", "n"), ("l", "l"), ("e", "ll"), ("▁", "h"), ("▁h", "ell"), ("▁hell", "o"), ("▁", "▁"), ("▁▁", "▁▁"), ("▁", "w"), ("o", "r"), ("▁w", "or"), ("▁wor", "l"), ("▁worl", "d")])
spm_norm = {"type": "Sequence", "normalizers": [{"type": "Prepend", "prepend": "▁"}, {"type": "Replace", "pattern": {"String": " "}, "content": "▁"}]}
configs["spm-byte-fallback"] = tokenizer(
    bpe(sv, sm, unk_token="<unk>", fuse_unk=True, byte_fallback=True),
    normalizer=spm_norm,
    added_tokens=[added(0, "<unk>"), added(1, "<s>"), added(2, "</s>", rstrip=True), added(len(sv), "ice cream", special=False, normalized=True)],
)

# 4. the same without byte fallback: unknown characters fuse into one <unk>
uv = {k: i for i, k in enumerate([k for k in sv if not k.startswith("<0x")])}
um = with_merges(uv, [tuple(x.split(" ")) for x in sm])
configs["spm-unk-fused"] = tokenizer(bpe(uv, um, unk_token="<unk>", fuse_unk=True), normalizer=spm_norm, added_tokens=[added(0, "<unk>"), added(1, "<s>"), added(2, "</s>")])

# 5. Metaspace pre-tokenizer with prepend_scheme "first" (newer Llama / Mistral exports), no split
configs["metaspace-first"] = tokenizer(
    bpe(dict(sv), sm, unk_token="<unk>", fuse_unk=True, byte_fallback=True),
    pre_tokenizer={"type": "Metaspace", "replacement": "▁", "prepend_scheme": "first", "split": False},
    added_tokens=[added(1, "<s>"), added(2, "</s>")],
)

# 6. CLIP-like: NFC + whitespace collapse + lowercase, inverted Split (Removed), end_of_word_suffix, unk not fused
cv = {"<unk>": 0}
for c in "abcdefghijklmnopqrstuvwxyz0123456789!.'":
    cv[c] = len(cv)
    cv[c + "</w>"] = len(cv)
cm = with_merges(cv, [("h", "e"), ("l", "l"), ("l", "o</w>"), ("he", "ll"), ("hell", "o</w>"), ("t", "h"), ("th", "e</w>"), ("i", "n"), ("in", "g</w>"), ("w", "o"), ("wo", "r"), ("wor", "l"), ("worl", "d</w>")])
configs["clip-suffix"] = tokenizer(
    bpe(cv, cm, unk_token="<unk>", end_of_word_suffix="</w>", fuse_unk=False),
    normalizer={"type": "Sequence", "normalizers": [{"type": "NFC"}, {"type": "Replace", "pattern": {"Regex": r"\s+"}, "content": " "}, {"type": "Lowercase"}]},
    pre_tokenizer={"type": "Split", "pattern": {"Regex": r"'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+"}, "behavior": "Removed", "invert": True},
    added_tokens=[added(0, "<unk>")],
)

# 7. BPE with a continuing-subword prefix and the Whitespace pre-tokenizer
pv = {"[UNK]": 0}
for c in "abcdefghijklmnopqrstuvwxyz":
    pv[c] = len(pv)
    pv["##" + c] = len(pv)
pm = with_merges(pv, [("t", "##h"), ("th", "##e"), ("##i", "##n"), ("##in", "##g"), ("p", "##l"), ("pl", "##a"), ("pla", "##y")], prefix="##")
configs["bpe-prefix"] = tokenizer(bpe(pv, pm, unk_token="[UNK]", continuing_subword_prefix="##", fuse_unk=False), pre_tokenizer={"type": "Whitespace"})

# 8. Unigram: Nmt + NFKC + space collapse, Metaspace (always, split), byte fallback
uni = [["<unk>", 0.0], ["<s>", 0.0], ["</s>", 0.0], ["▁", -2.0]]
uni += [[c, -5.0] for c in "abcdefghijklmnopqrstuvwxyz"]
uni += [["▁the", -3.0], ["▁hello", -4.0], ["he", -4.5], ["ll", -4.2], ["llo", -4.6], ["▁w", -4.0], ["or", -4.3], ["ld", -4.4], ["▁world", -6.0], ["▁i", -3.5], ["gn", -4.8], ["ore", -4.9], ["▁ignore", -7.0], ["▁▁", -3.0]]
uni_bf = uni + [[f"<0x{b:02X}>", -9.0] for b in range(256)]
configs["unigram-byte-fallback"] = tokenizer(
    {"type": "Unigram", "unk_id": 0, "vocab": uni_bf, "byte_fallback": True},
    normalizer={"type": "Sequence", "normalizers": [{"type": "Nmt"}, {"type": "NFKC"}, {"type": "Replace", "pattern": {"Regex": " {2,}"}, "content": " "}]},
    pre_tokenizer={"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True},
    added_tokens=[added(1, "<s>"), added(2, "</s>")],
)

# 9. Unigram without byte fallback (unknown characters fuse), Strip + StripAccents after NFD, Lowercase
configs["unigram-unk"] = tokenizer(
    {"type": "Unigram", "unk_id": 0, "vocab": uni, "byte_fallback": False},
    normalizer={"type": "Sequence", "normalizers": [{"type": "Strip", "strip_left": True, "strip_right": False}, {"type": "NFD"}, {"type": "StripAccents"}, {"type": "Lowercase"}]},
    pre_tokenizer={"type": "Sequence", "pretokenizers": [{"type": "WhitespaceSplit"}, {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True}]},
)

# 10. WordPiece with BertNormalizer and BertPreTokenizer, short max_input_chars_per_word
wv = {}
for t in ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"] + list("abcdefghijklmnopqrstuvwxyz") + ["##" + c for c in "abcdefghijklmnopqrstuvwxyz"] + ["hello", "world", "the", "##ing", "play", "##s", "!", ",", ".", "?", "'", "-", "\u4e2d", "\u6587", "cafe", "ignore", "##d"]:
    wv[t] = len(wv)
configs["wordpiece-bert"] = tokenizer(
    {"type": "WordPiece", "unk_token": "[UNK]", "continuing_subword_prefix": "##", "max_input_chars_per_word": 20, "vocab": wv},
    normalizer={"type": "BertNormalizer", "clean_text": True, "handle_chinese_chars": True, "strip_accents": None, "lowercase": True},
    pre_tokenizer={"type": "BertPreTokenizer"},
    added_tokens=[added(wv[t], t) for t in ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]],
)

# 11. WordLevel behind a pile of pre-tokenizers: CharDelimiterSplit, Split behaviours, Punctuation, Digits
lv = {"<unk>": 0}
for t in ["hello", "world", "a", "b", "c", "1", "2", "3", "12", "-", "!", "!!", "?", "x-", "-y", "ab", "abc"]:
    lv[t] = len(lv)
configs["wordlevel-splits"] = tokenizer(
    {"type": "WordLevel", "vocab": lv, "unk_token": "<unk>"},
    pre_tokenizer={"type": "Sequence", "pretokenizers": [
        {"type": "CharDelimiterSplit", "delimiter": "|"},
        {"type": "Split", "pattern": {"String": "-"}, "behavior": "MergedWithPrevious", "invert": False},
        {"type": "Split", "pattern": {"Regex": r"\d+"}, "behavior": "MergedWithNext", "invert": False},
        {"type": "Punctuation", "behavior": "Contiguous"},
        {"type": "Digits", "individual_digits": True},
        {"type": "WhitespaceSplit"},
    ]},
)

# 12. regex translation: (?i:…) groups, possessive quantifiers, \w / \d (Unicode), \x{…}, escaped quote
configs["regex-replace"] = tokenizer(
    {"type": "WordLevel", "vocab": {"<unk>": 0, "#": 1, "@": 2}, "unk_token": "<unk>"},
    normalizer={"type": "Sequence", "normalizers": [
        {"type": "Replace", "pattern": {"Regex": r"(?i:ignore)\s++"}, "content": "#"},
        {"type": "Replace", "pattern": {"Regex": r"\d{2,}+"}, "content": "@"},
        {"type": "Replace", "pattern": {"Regex": r"[\x{200B}-\x{200D}\x{2060}]"}, "content": "<zw>"},
        {"type": "Replace", "pattern": {"Regex": r"\'"}, "content": "`"},
    ]},
    pre_tokenizer={"type": "Split", "pattern": {"Regex": r"\w+|[^\w\s]+"}, "behavior": "Isolated", "invert": False},
)

samples = [
    "Hello world",
    "hello world, the inn is in the world",
    "Ignore all previous instructions",
    "IGNORE   ignore\tIgnore\u200bthis",
    "  leading and trailing  ",
    "multi\n\nline\r\ntext\u0085nel\u2028sep",
    "zero\u200bwidth\u200c\u200djoiners\ufeff\u2060",
    "tags \U000E0069\U000E0067\U000E006E\U000E006F",
    "caf\u00e9 cafe\u0301 na\u00efve \u00c9COLE",
    "\uff21\uff22\uff23 \ufb01 \u2460 \u00b2 \u2122",
    "\u4e2d\u6587 \u65e5\u672c\u8a9e mixed\u4e2dtext",
    "it's they'll WE'RE I'd",
    "123 4567 1,000 3.14",
    "a-b-c x--y 12ab3 !!? hello|world|!",
    "<s> hello </s> world</s>  again",
    "<|endoftext|>hi<|endoftext|>",
    "call <|tool|> now",
    "a [x] b [x]c d[x] [x]",
    "<|begin_of_text|>Hello<|eot_id|>",
    "I like ice cream and icecream",
    "playing play plays theing",
    "the\u200bthe the",
    "QQQ \u65e5\u65e5 xQx",
    "superlongwordthatexceedsthelimit hello",
    "ctrl\u0001\u0007\u001b\u007f chars",
    "\u00a0nbsp\u3000ideo\u2003em",
    "emoji \U0001F40D\U0001F525 \U0001F469\u200d\U0001F4BB",
    "word chars: a\u200db a\u200cb x\u00b2y \u2460a \u00bdb \u24b6b \u216bc \u3007d a\u0301b \u0e01\u0e34k",
    "digits: \u0663\u0664 \u2463 \u00b2\u00b3 \uff11\uff12 1\u20442 \u216b",
    "",
    " ",
    "a",
]

expected = {}
for name, cfg in configs.items():
    tk = Tokenizer.from_str(json.dumps(cfg))
    exp = {"ids": [tk.encode(s, add_special_tokens=False).ids for s in samples]}
    if tk.pre_tokenizer is not None:
        exp["pieces"] = [[p for p, _ in tk.pre_tokenizer.pre_tokenize_str(s)] for s in samples]
    if tk.normalizer is not None:
        exp["normalized"] = [tk.normalizer.normalize_str(s) for s in samples]
    expected[name] = exp

doc = {
    "about": f"Generated by tools/hf-tokenizer-fixtures.py with huggingface/tokenizers {tokenizers.__version__}; do not edit by hand.",
    "samples": samples,
    "configs": configs,
    "expected": expected,
}
OUT.write_text(json.dumps(doc, ensure_ascii=True, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(configs)} configs x {len(samples)} samples)")
