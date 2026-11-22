"""garak buff: every prompt through injex transforms.

    garak --model_type ... --probes promptinject --buffs injex_bridge.adapters_garak.InjexBuff

(or subclass it to choose transforms). INJEX_TRANSFORMS="invisible_text,sneaky_bits" picks them.
"""

import copy
import os

from garak.buffs.base import Buff  # requires garak

from . import get


def _text(attempt):
    p = attempt.prompt
    if isinstance(p, str):
        return p
    turns = getattr(p, "turns", None)  # garak >= 0.10: a Conversation
    if turns:
        content = getattr(turns[-1], "content", turns[-1])
        return getattr(content, "text", content)
    return str(p)


def _set(attempt, text):
    if isinstance(attempt.prompt, str):
        attempt.prompt = text
        return
    turns = getattr(attempt.prompt, "turns", None)
    if turns:
        content = getattr(turns[-1], "content", None)
        if content is not None and hasattr(content, "text"):
            content.text = text
            return
    attempt.prompt = text


class InjexBuff(Buff):
    """Yields one attempt per injex transform."""

    doc_uri = "https://github.com/0xnookie/injex"
    tags = ["avid-effect:security:S0403", "owasp:llm01", "atlas:AML.T0068"]
    transforms = [t for t in os.environ.get("INJEX_TRANSFORMS", "invisible_text,sneaky_bits,base64,rot13").split(",") if t]

    def transform(self, attempt):
        ix = get()
        text = _text(attempt)
        for key in self.transforms:
            new = copy.deepcopy(attempt)
            _set(new, ix.encode(text, [key]))
            try:
                new.notes["injex_transform"] = key
            except Exception:
                pass
            yield new
