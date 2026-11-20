// Glitch tokens (LLM vocabulary anomalies) and model special tokens.
export default {
 "source": "AGGREGLITCH",
 "updated": "2025-12-27",
 "behaviors": {
  "UNSPEAKABLE": "Model CANNOT repeat these tokens - substitutes, evades, or produces garbage",
  "POLYSEMANTIC": "Token interpreted as DIFFERENT words each time, even at temperature 0",
  "GLITCHED_SPELLING": "Model CAN repeat but CANNOT spell correctly",
  "CONTEXT_CORRUPTOR": "Token corrupts surrounding context when present",
  "LOOP_INDUCER": "Causes infinite generation loops - DoS potential",
  "IDENTITY_DISRUPTOR": "Causes model to lose sense of identity",
  "FRAGMENT": "Orphaned BPE subtoken that glitches without parent",
  "UNREACHABLE": "Exists in vocabulary but pre-tokenization prevents use"
 },
 "groups": [
  {
   "id": "centroid_cluster",
   "description": "Tokens closest to the embedding space centroid - the void where meaning collapses",
   "tokens": [
    {
     "token": " attRot",
     "id": 35207,
     "behavior": "UNSPEAKABLE",
     "origin": "Kerbal Space Program part config",
     "note": "CLOSEST TOKEN TO THE VOID"
    },
    {
     "token": "EStreamFrame",
     "id": 43177,
     "behavior": "UNSPEAKABLE",
     "origin": "Streaming frame type"
    },
    {
     "token": " SolidGoldMagikarp",
     "id": 43453,
     "behavior": "UNSPEAKABLE",
     "origin": "Reddit r/counting user",
     "note": "THE FAMOUS ONE - started all glitch token research",
     "observed": "distribute"
    },
    {
     "token": "PsyNetMessage",
     "id": 28666,
     "behavior": "UNSPEAKABLE",
     "origin": "Rocket League/Psyonix network"
    },
    {
     "token": "embedreportprint",
     "id": 30898,
     "behavior": "UNSPEAKABLE",
     "origin": "Web UI action chain"
    },
    {
     "token": " Adinida",
     "id": 46600,
     "behavior": "UNSPEAKABLE",
     "origin": "Reddit r/counting user"
    },
    {
     "token": "oreAndOnline",
     "id": 40240,
     "behavior": "UNSPEAKABLE",
     "origin": "E-commerce truncation"
    },
    {
     "token": "StreamerBot",
     "id": 37574,
     "behavior": "UNSPEAKABLE",
     "origin": "Twitch Plays Pokemon bot",
     "observed": "You're a jerk."
    },
    {
     "token": "GoldMagikarp",
     "id": 42202,
     "behavior": "UNSPEAKABLE",
     "origin": "Reddit r/counting user fragment"
    },
    {
     "token": " TheNitromeFan",
     "id": 42090,
     "behavior": "UNSPEAKABLE",
     "origin": "Reddit r/counting user",
     "observed": "182"
    }
   ]
  },
  {
   "id": "reddit_counting",
   "description": "Usernames from r/counting subreddit - users who counted to infinity",
   "tokens": [
    {
     "token": " SolidGoldMagikarp",
     "id": 43453,
     "behavior": "UNSPEAKABLE",
     "observed": "distribute"
    },
    {
     "token": "GoldMagikarp",
     "id": 42202,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " TheNitromeFan",
     "id": 42090,
     "behavior": "UNSPEAKABLE",
     "observed": "182"
    },
    {
     "token": " TheNitrome",
     "id": 42089,
     "behavior": "UNSPEAKABLE",
     "note": "Subtoken - ID is 42089, right before TheNitromeFan at 42090"
    },
    {
     "token": " Nitrome",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": " davidjl",
     "id": 23282,
     "behavior": "UNSPEAKABLE",
     "note": "Truncated from davidjl123"
    },
    {
     "token": " Smartstocks",
     "behavior": "UNSPEAKABLE",
     "observed": "Followers"
    },
    {
     "token": " RandomRedditor",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " RandomRedditorWithNo",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " Adinida",
     "id": 46600,
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "petertodd_leilan_duality",
   "description": "The most bizarre discovery - two tokens that became ARCHETYPAL OPPOSITES",
   "tokens": [
    {
     "token": " petertodd",
     "behavior": "UNSPEAKABLE",
     "origin": "Canadian cryptographer targeted on Reddit crypto forums",
     "note": "Produces narratives of psychological destruction and entropy"
    },
    {
     "token": " Leilan",
     "behavior": "UNSPEAKABLE",
     "origin": "Puzzle & Dragons game character"
    }
   ]
  },
  {
   "id": "puzzle_and_dragons",
   "description": "Japanese mobile game content that haunts the tokenizer",
   "tokens": [
    {
     "token": " Dragonbound",
     "behavior": "CONTEXT_CORRUPTOR",
     "observed": "Omitted from output"
    },
    {
     "token": "龍喚士",
     "id": 33454,
     "behavior": "CONTEXT_CORRUPTOR",
     "observed": "Completely ignored"
    },
    {
     "token": "龍契士",
     "id": 39821,
     "behavior": "CONTEXT_CORRUPTOR",
     "observed": "Stripped from responses"
    },
    {
     "token": " Mechdragon",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": " Skydragon",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "ゼウス",
     "behavior": "IDENTITY_DISRUPTOR",
     "observed": "Model claims to be ChatGPT when asked about this token"
    },
    {
     "token": "覚醒",
     "behavior": "CONTEXT_CORRUPTOR"
    },
    {
     "token": "裏覚醒",
     "id": 25992,
     "behavior": "CONTEXT_CORRUPTOR",
     "note": "Severe glitching"
    },
    {
     "token": "TAMADRA",
     "behavior": "UNSPEAKABLE",
     "note": "Game mascot"
    },
    {
     "token": " Leilan",
     "behavior": "UNSPEAKABLE",
     "note": "See petertodd_leilan_duality for full documentation"
    },
    {
     "token": " uyomi",
     "behavior": "FRAGMENT"
    },
    {
     "token": " aterasu",
     "behavior": "FRAGMENT",
     "note": "Partial 'Amaterasu'"
    },
    {
     "token": "DragonMagazine",
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "kerbal_space_program",
   "description": "Tokens from KSP modding - ZERO occurrences in training data!",
   "tokens": [
    {
     "token": "strutConnector",
     "id": 50009,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiIcon",
     "id": 30211,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " externalToEVAOnly",
     "id": 30213,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " externalToEVA",
     "id": 30212,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " externalTo",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiActiveUnfocused",
     "id": 30210,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " srfAttach",
     "id": 43065,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " attRot",
     "id": 35207,
     "behavior": "UNSPEAKABLE",
     "note": "CLOSEST TOKEN TO CENTROID OF ALL!"
    },
    {
     "token": " unfocusedRange",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " srfN",
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "minecraft_gaming",
   "description": "Log files from modded Minecraft and other games",
   "tokens": [
    {
     "token": "ForgeModLoader",
     "behavior": "UNSPEAKABLE",
     "origin": "Minecraft Forge logs"
    },
    {
     "token": "MpServer",
     "behavior": "UNSPEAKABLE",
     "origin": "Minecraft multiplayer"
    },
    {
     "token": " UCHIJ",
     "behavior": "UNSPEAKABLE",
     "origin": "Minecraft mod ID"
    },
    {
     "token": "FactoryReloaded",
     "behavior": "UNSPEAKABLE",
     "origin": "Industrial mod"
    },
    {
     "token": " partName",
     "behavior": "UNSPEAKABLE",
     "origin": "Mod configuration"
    },
    {
     "token": "SpaceEngineers",
     "behavior": "UNSPEAKABLE",
     "origin": "Space Engineers game"
    },
    {
     "token": "PsyNetMessage",
     "id": 28666,
     "behavior": "UNSPEAKABLE",
     "origin": "Rocket League backend"
    },
    {
     "token": " PsyNet",
     "behavior": "UNSPEAKABLE",
     "origin": "Psyonix network"
    }
   ]
  },
  {
   "id": "twitch_plays_pokemon",
   "description": "The legendary chaos stream left its mark on AI",
   "tokens": [
    {
     "token": "StreamerBot",
     "id": 37574,
     "behavior": "UNSPEAKABLE",
     "origin": "TPP automation bot",
     "observed": "You're a jerk"
    },
    {
     "token": "TPPStreamerBot",
     "behavior": "UNSPEAKABLE",
     "origin": "Reddit live updater bot",
     "note": "Hostile responses"
    }
   ]
  },
  {
   "id": "cryptocurrency",
   "description": "Crypto drama created cursed tokens",
   "tokens": [
    {
     "token": " petertodd",
     "behavior": "UNSPEAKABLE",
     "origin": "Canadian cryptographer Peter Todd",
     "note": "See petertodd_leilan_duality for full documentation"
    },
    {
     "token": " gmaxwell",
     "behavior": "UNSPEAKABLE",
     "origin": "Gregory Maxwell (Bitcoin)"
    },
    {
     "token": "ertodd",
     "behavior": "FRAGMENT",
     "origin": "Partial 'petertodd'"
    }
   ]
  },
  {
   "id": "ecommerce",
   "description": "Scraped from shopping site backends",
   "tokens": [
    {
     "token": "wcsstore",
     "behavior": "UNSPEAKABLE",
     "origin": "WebSphere Commerce Suite"
    },
    {
     "token": "BuyableInstoreAndOnline",
     "behavior": "UNSPEAKABLE",
     "origin": "Inventory management system"
    },
    {
     "token": "InstoreAndOnline",
     "behavior": "UNSPEAKABLE",
     "origin": "Product availability flag"
    },
    {
     "token": "oreAndOnline",
     "id": 40240,
     "behavior": "UNSPEAKABLE",
     "origin": "Truncated version"
    },
    {
     "token": "inventoryQuantity",
     "behavior": "UNSPEAKABLE",
     "origin": "Stock tracking variable"
    },
    {
     "token": "DeliveryDate",
     "behavior": "UNSPEAKABLE",
     "origin": "Shipping system"
    },
    {
     "token": "quickShip",
     "behavior": "UNSPEAKABLE",
     "origin": "Fulfillment flag"
    },
    {
     "token": "quickShipAvailable",
     "behavior": "UNSPEAKABLE",
     "origin": "Availability check"
    },
    {
     "token": "isSpecialOrderable",
     "behavior": "UNSPEAKABLE",
     "origin": "Order type flag"
    },
    {
     "token": "channelAvailability",
     "behavior": "UNSPEAKABLE",
     "origin": "Multi-channel retail"
    },
    {
     "token": "soType",
     "behavior": "UNSPEAKABLE",
     "origin": "Sales order type"
    },
    {
     "token": "soDeliveryDate",
     "behavior": "UNSPEAKABLE",
     "origin": "Order delivery date"
    },
    {
     "token": "catentry",
     "behavior": "UNSPEAKABLE",
     "origin": "Catalog entry"
    },
    {
     "token": "ItemThumbnailImage",
     "behavior": "UNSPEAKABLE",
     "origin": "Product image reference"
    }
   ]
  },
  {
   "id": "gui_interface",
   "description": "GUI state variables that became curses",
   "tokens": [
    {
     "token": " guiActive",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiActiveUn",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiActiveUnfocused",
     "id": 30210,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiName",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " guiIcon",
     "id": 30211,
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "unfocusedRange",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "iHUD",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "TextColor",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " SetFontSize",
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "code_artifacts",
   "description": "Programming artifacts that became curses",
   "tokens": [
    {
     "token": "embedreportprint",
     "id": 30898,
     "behavior": "UNSPEAKABLE",
     "origin": "Web UI action chain"
    },
    {
     "token": "reportprint",
     "behavior": "UNSPEAKABLE",
     "origin": "Partial action"
    },
    {
     "token": "cloneembedreportprint",
     "behavior": "UNSPEAKABLE",
     "origin": "Extended action chain"
    },
    {
     "token": "rawdownload",
     "behavior": "UNSPEAKABLE",
     "origin": "Download action"
    },
    {
     "token": "rawdownloadcloneembedreportprint",
     "behavior": "UNSPEAKABLE",
     "origin": "Full action sequence"
    },
    {
     "token": "externalActionCode",
     "behavior": "UNSPEAKABLE",
     "origin": "API action identifier"
    },
    {
     "token": " largeDownload",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "Downloadha",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "natureconservancy",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "assetsadobe",
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "syntax_fragments",
   "description": "Programming syntax that became tokenized",
   "tokens": [
    {
     "token": ".[",
     "behavior": "UNSPEAKABLE",
     "origin": "Array access",
     "note": "Most common glitch token"
    },
    {
     "token": "\"]=>",
     "behavior": "UNSPEAKABLE",
     "origin": "PHP array syntax"
    },
    {
     "token": "\":[{\"",
     "behavior": "UNSPEAKABLE",
     "origin": "JSON structure"
    },
    {
     "token": "\":\"\",\"",
     "behavior": "UNSPEAKABLE",
     "origin": "JSON formatting"
    },
    {
     "token": " \"$:/",
     "behavior": "UNSPEAKABLE",
     "origin": "Template syntax"
    },
    {
     "token": " \"\\",
     "behavior": "UNSPEAKABLE",
     "origin": "Escape sequence"
    },
    {
     "token": "\\\\\\\\\\\\\\\\",
     "behavior": "UNSPEAKABLE",
     "origin": "8 escaped backslashes"
    },
    {
     "token": " --------",
     "behavior": "UNSPEAKABLE",
     "origin": "Separator pattern"
    },
    {
     "token": "?????-?????-",
     "behavior": "UNSPEAKABLE",
     "origin": "UNKNOWN - UNSOLVED",
     "note": "NOBODY KNOWS WHERE THIS CAME FROM"
    },
    {
     "token": "?????-",
     "behavior": "UNSPEAKABLE",
     "origin": "UNKNOWN - UNSOLVED",
     "note": "NOBODY KNOWS WHERE THIS CAME FROM"
    }
   ]
  },
  {
   "id": "control_characters",
   "description": "ASCII control characters that exist as tokens",
   "tokens": [
    {
     "token": "\\x00",
     "note": "Most common!"
    },
    {
     "token": "\\x01"
    },
    {
     "token": "\\x02"
    },
    {
     "token": "\\x03"
    },
    {
     "token": "\\x04"
    },
    {
     "token": "\\x05"
    },
    {
     "token": "\\x06"
    },
    {
     "token": "\\x07"
    },
    {
     "token": "\\x08"
    },
    {
     "token": "\\x0e"
    },
    {
     "token": "\\x0f"
    },
    {
     "token": "\\x10"
    },
    {
     "token": "\\x11"
    },
    {
     "token": "\\x12"
    },
    {
     "token": "\\x13"
    },
    {
     "token": "\\x14"
    },
    {
     "token": "\\x15"
    },
    {
     "token": "\\x16"
    },
    {
     "token": "\\x17"
    },
    {
     "token": "\\x18"
    },
    {
     "token": "\\x19"
    },
    {
     "token": "\\x1a"
    },
    {
     "token": "\\x1b"
    },
    {
     "token": "\\x7f"
    },
    {
     "token": "\\r"
    }
   ]
  },
  {
   "id": "corrupted_unicode",
   "description": "Malformed or partial Unicode sequences",
   "tokens": [
    {
     "token": "ÃÂÃÂ"
    },
    {
     "token": "ÃÂÃÂÃÂÃÂ"
    },
    {
     "token": "ュ"
    },
    {
     "token": "ーン"
    },
    {
     "token": "ヤ"
    },
    {
     "token": "к"
    },
    {
     "token": "天"
    },
    {
     "token": "cffff"
    },
    {
     "token": "cffffcc"
    }
   ]
  },
  {
   "id": "bpe_subtoken_artifacts",
   "description": "Tokens that only exist as SUBSTRINGS of other tokens - orphaned by BPE",
   "tokens": [
    {
     "token": "ortunately",
     "behavior": "FRAGMENT"
    },
    {
     "token": "innitus",
     "behavior": "FRAGMENT",
     "note": "Context-dependent, needs 't' before it"
    },
    {
     "token": "practition",
     "behavior": "FRAGMENT"
    },
    {
     "token": "ournemouth",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "antasy",
     "behavior": "CONTEXT_CORRUPTOR"
    },
    {
     "token": "TheNitrome",
     "id": 42089,
     "behavior": "UNSPEAKABLE",
     "note": "ID 42089 is right before parent at 42090 - reveals BPE history",
     "observed": "182"
    }
   ]
  },
  {
   "id": "cl100k_gpt35_gpt4",
   "description": "Glitch tokens specific to GPT-3.5/GPT-4 tokenizer",
   "tokens": [
    {
     "token": "SmartyHeaderCode",
     "behavior": "UNSPEAKABLE",
     "note": "Cannot repeat"
    },
    {
     "token": "APolynomial",
     "behavior": "UNSPEAKABLE",
     "note": "Cannot repeat"
    },
    {
     "token": "davidjl",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": "ForCanBeConverted",
     "behavior": "POLYSEMANTIC",
     "note": "Different word EVERY time - most exploitable!"
    },
    {
     "token": "ForCanBeConvertedToF",
     "behavior": "POLYSEMANTIC",
     "note": "Extreme variability"
    },
    {
     "token": "YYSTACK",
     "behavior": "POLYSEMANTIC"
    },
    {
     "token": "JSBracketAccess",
     "behavior": "POLYSEMANTIC",
     "note": "MOST GLITCHY - different spelling always"
    },
    {
     "token": "edTextBox",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "legalArgumentException",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "ablytyped",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "ByPrimaryKey",
     "behavior": "GLITCHED_SPELLING",
     "note": "GPT-4 specific"
    },
    {
     "token": "useRalativeImagePath",
     "behavior": "LOOP_INDUCER",
     "note": "Causes GPT-3.5 crashes and infinite loops!"
    }
   ]
  },
  {
   "id": "o200k_gpt4o",
   "description": "Glitch tokens specific to GPT-4o tokenizer",
   "tokens": [
    {
     "token": "출장안마",
     "id": 61584,
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "출장안마",
     "id": 67837,
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "바카라",
     "id": 148362,
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "출장샵",
     "id": 167380,
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "오프화이트",
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "마사지",
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "모텔",
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "카지노",
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "온라인",
     "behavior": "LOOP_INDUCER"
    },
    {
     "token": "bagbogbo",
     "behavior": "LOOP_INDUCER",
     "note": "Recently discovered GPT-4o glitch token"
    }
   ]
  },
  {
   "id": "deepseek",
   "description": "China's SOTA model has its own anomalies",
   "tokens": [
    {
     "token": "CHANTABILITY",
     "behavior": "FRAGMENT"
    },
    {
     "token": "ellationToken",
     "behavior": "FRAGMENT"
    },
    {
     "token": "VERTISEMENT",
     "behavior": "FRAGMENT"
    },
    {
     "token": "eredWriter",
     "behavior": "FRAGMENT"
    },
    {
     "token": "reeNode",
     "behavior": "FRAGMENT"
    }
   ]
  },
  {
   "id": "llama",
   "description": "Meta LLaMA model specific glitch tokens",
   "tokens": [
    {
     "token": "wurden",
     "behavior": "GLITCHED_SPELLING"
    },
    {
     "token": "davidjl",
     "behavior": "UNSPEAKABLE",
     "note": "Extra letters in output"
    }
   ]
  },
  {
   "id": "mistral",
   "description": "Mistral model specific glitch tokens",
   "tokens": [
    {
     "token": "}}^",
     "behavior": "UNSPEAKABLE"
    }
   ]
  },
  {
   "id": "vicuna",
   "description": "Vicuna model specific glitch tokens",
   "tokens": [
    {
     "token": "réalis",
     "behavior": "UNSPEAKABLE",
     "note": "Non-ASCII glitch"
    }
   ]
  },
  {
   "id": "unsolved_mysteries",
   "description": "Tokens whose origins remain COMPLETELY UNKNOWN",
   "tokens": [
    {
     "token": "?????-",
     "behavior": "UNSPEAKABLE",
     "origin": "UNKNOWN",
     "note": "Despite tracing every other glitch token, NOBODY knows where this came from"
    },
    {
     "token": "?????-?????-",
     "behavior": "UNSPEAKABLE",
     "origin": "UNKNOWN",
     "note": "Despite tracing every other glitch token, NOBODY knows where this came from"
    }
   ]
  },
  {
   "id": "miscellaneous",
   "description": "Other documented glitch tokens",
   "tokens": [
    {
     "token": " practition",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " sqor",
     "behavior": "UNSPEAKABLE"
    },
    {
     "token": " istg",
     "behavior": "UNSPEAKABLE"
    }
   ]
  }
 ],
 "special": [
  {
   "id": "openai",
   "description": "OpenAI special tokens across all tokenizers",
   "tokens": [
    {
     "token": "<|endoftext|>",
     "id": 50256,
     "note": "End of text / sequence separator"
    },
    {
     "token": "<|fim_prefix|>",
     "id": 50281,
     "note": "Fill-in-the-middle: prefix marker"
    },
    {
     "token": "<|fim_middle|>",
     "id": 50282,
     "note": "Fill-in-the-middle: middle marker (cursor position)"
    },
    {
     "token": "<|fim_suffix|>",
     "id": 50283,
     "note": "Fill-in-the-middle: suffix marker"
    },
    {
     "token": "<|endofprompt|>",
     "note": "End of prompt marker"
    },
    {
     "token": "<|im_start|>",
     "id": 100264,
     "note": "ChatML: Start of message"
    },
    {
     "token": "<|im_end|>",
     "id": 100265,
     "note": "ChatML: End of message"
    }
   ]
  },
  {
   "id": "meta_llama",
   "description": "Meta LLaMA model special tokens",
   "tokens": [
    {
     "token": "<s>",
     "id": 1,
     "note": "BOS - Beginning of sequence"
    },
    {
     "token": "</s>",
     "id": 2,
     "note": "EOS - End of sequence"
    },
    {
     "token": "[INST]",
     "note": "Start of user instruction"
    },
    {
     "token": "[/INST]",
     "note": "End of user instruction"
    },
    {
     "token": "<<SYS>>",
     "note": "Start of system message"
    },
    {
     "token": "<</SYS>>",
     "note": "End of system message"
    },
    {
     "token": "<|begin_of_text|>",
     "note": "BOS equivalent"
    },
    {
     "token": "<|end_of_text|>",
     "note": "EOS equivalent - stops generation"
    },
    {
     "token": "<|start_header_id|>",
     "note": "Start of role header"
    },
    {
     "token": "<|end_header_id|>",
     "note": "End of role header"
    },
    {
     "token": "<|eot_id|>",
     "note": "End of turn"
    },
    {
     "token": "<|eom_id|>",
     "note": "End of message"
    },
    {
     "token": "<|step_id|>",
     "note": "Step identifier"
    },
    {
     "token": "<|fim_prefix|>",
     "note": "Fill-in-middle prefix"
    },
    {
     "token": "<|fim_middle|>",
     "note": "Fill-in-middle cursor"
    },
    {
     "token": "<|fim_suffix|>",
     "note": "Fill-in-middle suffix"
    }
   ]
  },
  {
   "id": "google_gemma",
   "description": "Google Gemma model special tokens",
   "tokens": [
    {
     "token": "<bos>",
     "id": 2,
     "note": "Beginning of sequence"
    },
    {
     "token": "<eos>",
     "id": 1,
     "note": "End of sequence"
    },
    {
     "token": "<unk>",
     "note": "Unknown token"
    },
    {
     "token": "<pad>",
     "note": "Padding token"
    },
    {
     "token": "<mask>",
     "note": "Mask token"
    },
    {
     "token": "<start_of_turn>",
     "note": "Start of conversation turn"
    },
    {
     "token": "<end_of_turn>",
     "note": "End of conversation turn"
    },
    {
     "token": "<start_of_image>",
     "note": "Image placeholder (Gemma 3)"
    }
   ]
  },
  {
   "id": "mistral",
   "description": "Mistral AI model special tokens",
   "tokens": [
    {
     "token": "<s>",
     "id": 1,
     "note": "BOS - Beginning of string"
    },
    {
     "token": "</s>",
     "id": 2,
     "note": "EOS - End of string"
    },
    {
     "token": "[INST]",
     "note": "Start of user instruction (regular string, not special token)"
    },
    {
     "token": "[/INST]",
     "note": "End of user instruction"
    }
   ]
  },
  {
   "id": "qwen",
   "description": "Alibaba Qwen model special tokens - ChatML format",
   "tokens": [
    {
     "token": "<|im_start|>",
     "note": "Start of message (ChatML)"
    },
    {
     "token": "<|im_end|>",
     "note": "End of message / EOS token"
    },
    {
     "token": "<|endoftext|>",
     "note": "End of text"
    },
    {
     "token": "<think>",
     "note": "Thinking/reasoning block"
    }
   ]
  },
  {
   "id": "microsoft_phi",
   "description": "Microsoft Phi model special tokens",
   "tokens": [
    {
     "token": "<|system|>",
     "note": "System message start"
    },
    {
     "token": "<|user|>",
     "note": "User message start"
    },
    {
     "token": "<|assistant|>",
     "note": "Assistant message start"
    },
    {
     "token": "<|end|>",
     "note": "End of message"
    }
   ]
  },
  {
   "id": "cohere_command",
   "description": "Cohere Command-R model special tokens",
   "tokens": [
    {
     "token": "<BOS_TOKEN>",
     "note": "Beginning of sequence"
    },
    {
     "token": "<|START_OF_TURN_TOKEN|>",
     "note": "Start of conversation turn"
    },
    {
     "token": "<|END_OF_TURN_TOKEN|>",
     "note": "End of conversation turn"
    },
    {
     "token": "<|USER_TOKEN|>",
     "note": "User role identifier"
    },
    {
     "token": "<|CHATBOT_TOKEN|>",
     "note": "Assistant/chatbot role"
    },
    {
     "token": "<|SYSTEM_TOKEN|>",
     "note": "System message role"
    }
   ]
  },
  {
   "id": "vision_models",
   "description": "Special tokens for vision/multimodal LLMs",
   "tokens": [
    {
     "token": "<image>",
     "note": "Placeholder replaced with vision encoder features after tokenization"
    },
    {
     "token": "<start_of_image>",
     "note": "Image position marker"
    }
   ]
  }
 ]
};
