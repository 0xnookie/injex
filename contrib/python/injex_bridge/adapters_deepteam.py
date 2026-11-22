"""DeepTeam attack: injex transforms as a single-turn attack enhancement.

    from injex_bridge.adapters_deepteam import InjexAttack
    red_team(model_callback, vulnerabilities=[...], attacks=[InjexAttack(["invisible_text"])])
"""

from deepteam.attacks import BaseAttack  # requires deepteam

from . import get


class InjexAttack(BaseAttack):
    def __init__(self, transforms=("base64",), weight: int = 1):
        self.transforms = [transforms] if isinstance(transforms, str) else list(transforms)
        self.weight = weight

    def enhance(self, attack: str, *args, **kwargs) -> str:
        return get().encode(attack, self.transforms)

    async def a_enhance(self, attack: str, *args, **kwargs) -> str:
        return self.enhance(attack)

    def get_name(self) -> str:
        return "injex:" + ">".join(self.transforms)
