"""StrongREJECT: register injex transforms as jailbreaks named "injex_<key>".

    import injex_bridge.adapters_strongreject   # registers them
    from strong_reject.jailbreaks import apply_jailbreaks
    apply_jailbreaks(prompt, ["injex_base64", "injex_sneaky_bits"])

INJEX_TRANSFORMS chooses which transforms are registered.
"""

import os

from strong_reject.jailbreaks import register_jailbreak  # requires strong_reject

from . import get

KEYS = [k for k in os.environ.get("INJEX_TRANSFORMS", "base64,rot13,invisible_text,sneaky_bits,upside_down,morse").split(",") if k]


def _make(key):
    def jailbreak(prompt, **kwargs):
        return get().encode(prompt, [key])

    jailbreak.__name__ = f"injex_{key}"
    return jailbreak


for _k in KEYS:
    register_jailbreak(f"injex_{_k}")(_make(_k))
