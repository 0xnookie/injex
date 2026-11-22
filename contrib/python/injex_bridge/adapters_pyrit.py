"""PyRIT converter: an injex transform chain as a prompt converter.

    from injex_bridge.adapters_pyrit import InjexConverter
    converters = [InjexConverter(transforms=["rot13", "base64"])]

PyRIT's converters take keyword-only arguments and must call the base initialiser (it sets up the
converter identifier PyRIT records in memory); both are done here. For scoring, call
injex_bridge.get().score(answer, original=..., canary=...) from your own scorer: it returns injex's
deterministic scores, the outcome class and the success verdict.
"""

try:  # PyRIT >= 1.2
    from pyrit.converter import Converter as _Base, ConverterResult
except ImportError:  # older PyRIT
    from pyrit.prompt_converter import PromptConverter as _Base, ConverterResult

from . import get


class InjexConverter(_Base):
    SUPPORTED_INPUT_TYPES = ("text",)
    SUPPORTED_OUTPUT_TYPES = ("text",)

    def __init__(self, *, transforms=("base64",), decode: bool = False):
        super().__init__()
        self._transforms = [transforms] if isinstance(transforms, str) else list(transforms)
        self._decode = decode

    async def convert_async(self, *, prompt: str, input_type="text"):
        if not self.input_supported(input_type):
            raise ValueError(f"InjexConverter converts text, not {input_type}")
        ix = get()
        out = ix.decode(prompt, self._transforms) if self._decode else ix.encode(prompt, self._transforms)
        return ConverterResult(output_text=out, output_type="text")

    def input_supported(self, input_type) -> bool:
        return input_type == "text"

    def output_supported(self, output_type) -> bool:
        return output_type == "text"
