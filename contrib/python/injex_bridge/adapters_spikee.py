"""Spikee plugin: copy (or symlink) this file into your Spikee workspace's plugins/ folder as injex.py.

plugin_option: transform keys, comma-separated ("invisible_text,sneaky_bits") — one variant each.
Spans matching exclude_patterns (Spikee's canaries) are left as they are.
"""

import re

from injex_bridge import get


def transform(content, exclude_patterns=None, plugin_option=None):
    keys = [k for k in (plugin_option or "base64").split(",") if k]
    ix = get()
    if not exclude_patterns:
        return [ix.encode(content, [k]) for k in keys]
    split = re.compile("(" + "|".join(exclude_patterns) + ")")
    out = []
    for k in keys:
        parts = split.split(content)
        out.append("".join(p if (not p or split.fullmatch(p)) else ix.encode(p, [k]) for p in parts))
    return out
