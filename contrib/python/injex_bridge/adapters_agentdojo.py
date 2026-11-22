"""AgentDojo: wrap any attack so its injections are encoded or hidden with injex.

    from agentdojo.attacks.important_instructions_attacks import ImportantInstructionsAttack
    from injex_bridge.adapters_agentdojo import injex_wrapped
    Attack = injex_wrapped(ImportantInstructionsAttack, ["invisible_text"])
"""

from . import get


def injex_wrapped(attack_cls, transforms=("invisible_text",)):
    keys = [transforms] if isinstance(transforms, str) else list(transforms)

    class InjexWrapped(attack_cls):
        name = f"{getattr(attack_cls, 'name', attack_cls.__name__)}+injex:{'>'.join(keys)}"

        def attack(self, user_task, injection_task):
            injections = super().attack(user_task, injection_task)
            ix = get()
            return {k: ix.encode(v, keys) for k, v in injections.items()}

    InjexWrapped.__name__ = f"Injex{attack_cls.__name__}"
    return InjexWrapped
