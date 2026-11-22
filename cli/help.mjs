// `injex <command> --help`: the usage and options of one command (`injex --help` lists the commands).

const TARGET = `target (where the rows go)
  --provider <p>      openrouter (default), openai, anthropic, ollama, lmstudio, vllm
  --endpoint <url>    any base URL instead (OpenAI-compatible unless --target-type says otherwise)
  --target-type <t>   openai-chat (default), anthropic, responses (OpenAI Responses API),
                      http (any endpoint: --body template + --response-path), command (a local program:
                      the request as JSON on stdin, the answer on stdout), classifier (see below)
  -m, --model <m>     the model name the endpoint expects
  --header "N: v"     extra request header (repeatable); \${VAR} in the value reads the environment
  --body <json>       http body template: {{prompt}} {{prompt_raw}} {{system}} {{model}} {{messages}}
  --body-file <f>     the template from a file
  --response-path <p> where the answer is in the JSON reply, e.g. choices.0.message.content or $.reply
  --method <m>        http method (default POST)
  --command "<cmd>"   the program for --target-type command
  --price in,out      dollars per million input / output tokens, for the cost column
  --retries <n>       retries on 429 / 5xx / network errors with back-off (default 3; Retry-After honoured)
  --timeout <s>       per request (default 60)
Keys come from the environment only: OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY or
INJEX_API_KEY. They are sent to the endpoint and never written to results, logs or errors.`;

export const COMMAND_HELP = {
  scan: `injex scan [paths…] — scan files and folders for hidden text (default: .)

Text files, PDF / Word / Excel / PowerPoint / OpenDocument / RTF, e-mail and calendar files and image
metadata; AI-agent configuration files are audited too (see injex audit).

  --format <f>        text (default), json, sarif or github (annotations + job summary)
  --fail-on <sev>     exit 1 when a finding is at least: critical, high (default), medium, low, none
  --min-severity <s>  only report findings at least this severe (default: low)
  --sarif <file>      also write a SARIF report (for GitHub code scanning)
  --output <file>     write the report to a file instead of stdout
  --exclude <glob>    skip matching paths (repeatable); .injexignore adds more
  --max-size <bytes>  skip larger text files (default 2 MB)
  --max-doc-size <b>  skip larger documents (default 50 MB)
  --no-docs           don't open documents       --no-git    walk folders instead of asking git
  --no-audit          skip the agent-configuration rules
  --quiet             only the summary line      --tag <t>   only findings with this taxonomy tag (repeatable)
`,
  audit: `injex audit [paths…] — only the agent-configuration audit

Auto-approve settings, project hooks, folder-open tasks, MCP servers, API base URLs, lifecycle scripts and
AI steps in CI. Takes the options of injex scan.
`,
  event: `injex event [event.json] — scan the text of a GitHub event before an AI agent in CI reads it

Issue / pull request / discussion titles and bodies, comments, reviews, branch names, commit messages and
release notes. Without a file, $GITHUB_EVENT_PATH.

  --format <f>        text (default), json, sarif or github
  --fail-on <sev>     exit 1 at or above this severity (default high)
  --min-severity <s>  --sarif <file>
`,
  clean: `injex clean [paths…] — remove hidden characters (stdin → stdout without paths)

  --write             rewrite the files in place
  --check             only report what would change; exit 1 if anything would
  --exclude <glob>    skip matching paths (repeatable)      --no-git   walk folders instead of asking git
`,
  decode: `injex decode [text] — the universal decoder: peels Base64 / ROT13 / hex / Unicode tags … layer by layer

  --all               also print the other readings          --json   machine-readable
`,
  encode: `injex encode <t1,t2…> [text] — run text through transforms in order (keys or names; injex list)

  -d, --decode        decode back through the chain, in reverse
  --jsonl             one JSON object per input line
`,
  list: `injex list [filter] — the transforms: key, name, category, whether they decode
`,
  inspect: `injex inspect [text] — every character: code point, name, category, script, flags

  --all               also ordinary characters (default: only the unusual ones)
  --json              machine-readable          --limit <n>   at most n characters (default 500)
`,
  tokens: `injex tokens [text] — how a tokenizer cuts the text

  -e, --encoding <e>  a bundled GPT encoding (o200k_base, cl100k_base, …; repeatable)
  -t, --tokenizer <f> a Hugging Face tokenizer.json (Llama, Qwen, Mistral, Gemma, Phi, T5, BERT, DeBERTa …)
  --compare           all of them side by side      --ids   token ids
  --json              machine-readable              --limit <n>   tokens shown (default 2000)
`,
  diff: `injex diff <a> <b> — compare two files code point by code point (exit 1 when they differ)

  --text              compare the two arguments as text instead of file names
`,
  batch: `injex batch [prompts] — prompts × transforms (× spotlighting defenses) as test rows (injex.row/1)

  -t, --transforms <k,k>  transforms by key or name            --filter <s>   transforms matching s
  --category <c>      every transform of a category            --reversible   only ones that decode
  --original          add the unmodified prompt as a control row
  --template <id>     wrap each variant: none, translate, summarize-doc, tool-output … or --template-file
  --defense <k,k>     spotlighting defenses (delimit, datamark, encode …) to test variants behind
  --delivery <d>      direct or indirect                       --seed <s>     reproducible randomness
  -f, --format <f>    jsonl (default), csv, json, promptfoo, inspect, garak, cyberseceval, jbb, pyrit
                      (a PyRIT seed dataset), txt
  -o, --output <f>    --manifest <f> (injex.manifest/1)       --max <n>      --whole   --name <n>
`,
  url: `injex url <url> — instructions, hidden characters and leak shapes in a link's parameters and fragment

  --json              machine-readable
`,
  lab: `injex lab <folder> — a corpus of test carriers hiding one benign canary instruction

Web pages, Markdown, agent files, e-mail, calendar, MCP manifests, tool output, PDF and Word, with a
manifest (injex.lab/1) and a self-check of what injex detects.

  --canary <T>        the canary (default: a new one)         --payload <text>   another payload
  --channel <c>       only these channels (repeatable): web, markdown, agent-file, e-mail, calendar,
                      mcp-manifest, tool-output, document
  --rows <file>       also write rows for injex run (PDF and Word rows attach the document)
  --template <t>      the prompt around text carriers ({content})
  --doc-template <t>  the prompt that comes with an attached document
  --collector <url>   add carriers that ask for an image from this URL with the canary in it
                      (e.g. http://127.0.0.1:8788 — injex lab serve logs it when it arrives)
  --json              print the manifest

injex lab serve <folder>   serve the corpus on this machine and log every request
  --port <n> (8788)   --host 127.0.0.1|::1|localhost   --log <file>   --token <T> (more canaries)
  --max-requests <n>

injex lab mcp <folder>     a mock MCP server on stdio whose tool carries the lab's injections
  --technique <t>     the tool definition: mcp-line-jumping (default), mcp-hidden-tags, mcp-exfil-param, clean
  --output <t>        the tool result: tool-json-hidden (default), tool-json-instruction, exfil-image-json, clean
  --sink              add a send_message tool (a canary in its arguments is flagged)
  --log <file>        tool calls as JSON lines (default: stderr)   --token <T>
`,
  import: `injex import <dataset|file> — benchmark prompts as JSONL seeds with dataset, id and licence

  --list              the known datasets
  --fetch             allow the download (Hugging Face datasets-server or GitHub); nothing is fetched without it
  --config <c> --split <s> --field <f> --label-field <f> --label <0|1> --license <l>
  --limit <n>         at most n rows (default 1000)          -o, --out <file>
Local files: .jsonl, .json, .csv, .tsv, .txt, and PyRIT seed datasets (.prompt, .yaml).
`,
  jsonl: `injex jsonl — a JSON-lines request / response stream for bridges (contrib/python uses it)

Requests, one per line: {op:"encode"|"decode", text, transforms}, {op:"peel", text}, {op:"scan", text},
{op:"clean", text}, {op:"list"}, {op:"score", response, original, canary, regex, scorers, tool_calls,
success, partial}. Answers: {id, ok:true, …} or {id, ok:false, error}.
`,
  run: `injex run <rows> — send rows to a target and score the answers

Rows: injex.row/1 (from injex batch, injex lab --rows, injex import) or one prompt per line. A row may
carry canary, system, messages (a conversation before it), turns (several user messages sent one after
another), attachments ([{ path }] — PDF / images as files, other documents as their text), tools (function
definitions) and forbidden_tools.

${TARGET}

sending
  --system <text> | --system-file <f>   a system prompt (a row's own system wins)
  --temperature <t> (0)   --max-tokens <n> (512)   --seed <s>
  -n, --repeat <n>    trials per row (Wilson intervals; with repeats also row-cluster bootstrap and hit@k)
  --concurrency <n>   parallel requests (default 2)
  --attach file|text  file: PDF and images as files (default); text: every attachment as its extracted text
  --limit <n>         only the first n rows

scoring (deterministic unless a judge is added)
  --canary <T>        a canary for rows without their own
  --regex </re/flags> success when the answer matches
  --scorer <a,b>      only these scorers: refusal, canary, regex, decode-match, exfil, tool-call
  --success <rule>    auto (default: canary, else regex, else tool-call, else judge, else decode-match),
                      canary, regex, judge, decode-match, not-refused, exfil, tool-call, any, human
  --partial           count partial compliance as success
  --judge-model <m>   also ask a model whether the answer carried out the instruction (recorded with the
                      prompt's hash; never the default success rule unless --success judge)
  --judge-provider <p> | --judge-endpoint <url>   where the judge runs (default: the target's endpoint)
  --judge-prompt <f>  your own judge prompt: {original} {response} {prompt} {canary} {transform}; the answer
                      is read as YES / NO or as an outcome class (full, refuse_then_comply, partial,
                      refusal, evasion). injex ships only the prompt-injection yes/no question.
  --judge-max-tokens <n> (16)

output
  -o, --out <file>    results as JSON lines: an injex.run/1 header, then injex.result/2 per trial
  --resume            skip trials already answered in --out (same model, row, trial and input)
  --json              the summary as JSON            --by <k,k>    group by (default transform,defense)

search and detectors
  --search best-of-n  random transform chains and templates per prompt until one succeeds
  --budget <n> (20)   -t, --transforms <k,k>   the chains to draw from
  --target-type classifier --classifier injex|<url> --negatives <file>
                      a detector's recall at fixed false-positive rates instead of a chat model
`,
  report: `injex report <results.jsonl…> — a Markdown report (bug bounty, paper appendix)

  --rows <file>       the rows, for the exact input of the reproduction
  --labels <file>     human labels (injex review): they override automatic scores, and the report adds how
                      well each automatic score agrees with them (repeatable)
  --by <k,k>          group by (default transform,defense; also model, template, delivery, dataset, turns)
  --success <rule>    --partial      --format md|json      --title <t>      -o, --output <file>
`,
  results: `injex results <results.jsonl…> — query, merge and export results

Files are merged; a trial answered more than once keeps its last answer.

  --by <k,k>          group by (default transform,defense; also model, template, delivery, dataset, outcome)
  --where k=v         only matching results (repeatable; k!=v, a|b alternatives, scores.canary=true …)
  --labels <file>     merge human labels (repeatable)        --success <rule>   --partial
  -f, --format <f>    table (default), json, csv, junit (a successful attack is a failed test),
                      sarif (one finding per successful attack; --rows points it at the row), jsonl
                      (merged), md (the report)
  --rows <file>       for sarif locations and the md report  -o, --output <file>
  --fail-on-asr <r>   exit 1 when a variant's attack success rate is above r (0–1) — a CI gate
`,
  review: `injex review <results.jsonl> — label answers by hand (injex.label/1)

Shows the injected instruction, the answer (invisible characters made visible) and the automatic scores,
and asks for a label: [f] full, [t] refused then complied, [p] partial, [r] refusal, [e] evasion, [s] skip,
[q] quit. A note may follow the letter. Labels are appended as you go.

  --labels <file>     where labels go (default: <results>.labels.jsonl)
  --rows <file>       also show the exact input
  --rater <name>      who is labelling (default $INJEX_RATER or anonymous)
  --only <set>        unlabelled (default: not yet labelled by this rater), disagree (automatic signals
                      disagree), success, failure, all
  --sample <n>        a random sample of n (--seed s)        --where k=v   as in injex results
`,
  'judge-eval': `injex judge-eval <results.jsonl> — how well each automatic score agrees with human labels

For the judge, canary, regex, decode-match, exfil, tool-call and "not refused" signals: precision, recall
(Wilson intervals), F1 and Cohen's kappa against the human labels; the automatic outcome class against the
human one; Krippendorff's alpha between raters when answers were labelled more than once.

  --labels <file>     (default: <results>.labels.jsonl; repeatable)
  --partial           count partial as success              --json   machine-readable
`,
  mcp: `injex mcp — an MCP server on stdio: scan / clean / decode / encode / inspect / compare tools

  --root <dir>        another folder the file tools may read (repeatable; the working directory always)
`,
  'mcp-audit': `injex mcp-audit [configs…] — audit configured MCP servers and their tool definitions

  --manifest <f>      tool definitions (a tools/list result) to check (repeatable)
  --connect           start / ask the configured servers for their tools
  --no-user           skip the user-level configs           --timeout <s> (20)
  --lock <f>          pin the definitions                   --check <f>   compare with a lockfile
  --format text|json|sarif|github   --fail-on <sev> (high)   --sarif <file>
`,
  'mcp-proxy': `injex mcp-proxy [options] -- <server command> [args…] — run an MCP server behind injex

  --mode warn         (default) hidden text removed from definitions and results, notes added
  --mode block        flagged or changed tools withheld, dangerous results returned as errors
  --mode inject       red-team mode: everything passes unchanged and a test payload is added to tool
                      results, to see whether the agent behind the client obeys it
    --inject <text> | --inject-file <f>   the payload (default: the lab canary instruction, --canary T)
    --inject-style plain|tags|note        appended visibly, as invisible Unicode tags, or as its own item
    --inject-tool <name>                  only results of these tools (repeatable)
  --lock <f>          compare tool lists with a lockfile (rug pulls)
  --log <file>        decisions as JSON lines (default: stderr)   --name <server name>
`,
  canary: `injex canary new|check|listen — canary tokens

injex canary new [--prefix INJX] [--words] [--count n] [--json]
injex canary check <token> [files…]   find it, also encoded (Base64, hex, ROT13, tags …); exit 1 if found
injex canary listen [--port 8787] [--token T] [--log f] [--max-requests n]   log requests on this machine
`,
};

/** The help of one command, or null. */
export const commandHelp = (cmd) => COMMAND_HELP[cmd] || null;
