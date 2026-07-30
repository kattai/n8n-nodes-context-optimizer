# Token Saver v0.4 — Product and First-Turn Benchmark Design

Date: 2026-07-30
Status: approved for implementation

## Goal

Turn the existing context-optimizer package into a provider-neutral token-saving product that is useful with normal n8n AI Agents, simple by default, conservative about quality, and measurable with real provider usage whenever the connected model exposes it.

The normal production path must require only one extra node:

```text
Any n8n Chat Model -> Token Saver Chat Model -> AI Agent
```

The remaining nodes are optional tools for large data, reversible context, and measurement.

## Non-goals

- Do not route between LLM providers or select cheaper models.
- Do not depend on Gemini, Headroom, OmniRoute, or an external compression service.
- Do not promise zero hallucination or guaranteed savings for every input.
- Do not delete unique conversation content in the default profile.
- Do not report an estimate as provider-reported usage.

## Audit findings

The v0.3.1 core already reduces real provider input usage in repetitive histories and compresses structured tool results. It passes 58 tests, builds, and lints. The product still has these usability and correctness gaps:

1. `Safe` and `Balanced` behave almost identically in the model wrapper because `keepRecentMessages` is not applied.
2. `targetSavingsPercent` is exposed but has no effect; `currentTask` only affects virtualization, despite its broader description.
3. normal node outputs retain the original large input beside the optimized value; sending the whole `$json` can accidentally erase the savings.
4. analytics output is too nested for everyday use and provider telemetry parsing lives inside one node instead of a tested reusable adapter.
5. the existing A/B chat requires multiple history turns; it does not demonstrate a first-message saving caused by a real tool result.

## Product architecture

### 1. Token Saver Chat Model

Display name for the existing `optimizedChatModel` type. It remains a generic `AiLanguageModel` proxy and accepts exactly one connected n8n chat model.

Use it in nearly every conversational AI workflow. It optimizes the messages actually sent to the connected model and leaves the model response unchanged.

Modes:

- `Save Tokens`: production default; optimize and record telemetry.
- `Measure Baseline`: testing only; leave messages byte-for-byte unchanged and record telemetry.

It must support `invoke`, `batch`, `stream`, `generate`, and models returned by `bindTools`. It must preserve tool-call ordering, IDs, roles, and immediate call/result pairing.

### 2. Token Saver Content

Display name for the existing `contextOptimizer` type. Use it before an agent when a workflow already has a large JSON/API response, RAG document set, log, HTML page, or static prompt.

Operations:

- `Optimize Content`: content-aware compression for data that will be injected into an agent.
- `Build Agent Context`: assemble separately protected prompt, history, retrieved context, tool definitions, and current message.
- `Compile Static Prompt`: remove deterministic repetition and return a stable hash for a reusable prompt prefix.

The default simple output must not include the original large input. It returns the optimized field required downstream plus `tokenSavings`. An advanced output mode may include diagnostics and manifests, but still must not duplicate the original unless an explicit `Include Original` option is enabled.

### 3. Token Saver Store

Display name for the existing `contextStore` type. Use it only when full data must remain exactly recoverable while staying outside the agent prompt.

It stores gzip-compressed originals with SHA-256 verification, TTL, scope isolation, atomic writes, safe paths, and a maximum resource size. The default response contains only the receipt needed downstream: resource ID, status, type, expiry, record count, and fields when known.

### 4. Token Saver Retriever

Display name for the existing `contextRetrieverTool` type. Connect it to the Agent only when Store or Content Virtualization is used.

The agent can search, filter records, inspect a schema, get an exact JSON path, fetch a section, or retrieve a bounded fragment. Responses must contain only exact returned data, source, truncation status, and estimated response tokens. Internal manifests and empty error fields stay out of the model-visible response.

Default tool guidance must be concise: retrieve exact missing IDs, values, dates, fields, or records; never guess; do not call when the compact context already contains the answer.

### 5. Token Savings

Display name for the existing `tokenAnalytics` type. Use it for visibility, A/B validation, cost estimates, and batch reporting; it is not required to obtain savings.

Default output:

```json
{
  "tokenSavings": {
    "before": 3120,
    "after": 1040,
    "saved": 2080,
    "percent": 66.67,
    "measurement": "provider",
    "qualityPassed": true
  }
}
```

Detailed diagnostics are opt-in. `measurement` is one of `provider`, `estimated`, or `unavailable`. Negative savings remain visible instead of being silently clamped.

## Optimization levels

The same four labels are used consistently wherever a profile applies:

### Maximum Quality

- preserve the current message, system messages, tool sequences, and the latest 12 conversational messages;
- remove only exact historical duplicates outside the protected recent window;
- use reversible structural compression for JSON and exact repeated log lines;
- never use approximate deduplication, semantic summarization, or unique-content trimming.

### Balanced (recommended)

- preserve the current message, system messages, tool sequences, and latest 6 conversational messages;
- remove exact and formatting-only duplicates outside the recent window;
- use content-aware structural compression for tool output, JSON, logs, HTML, and RAG;
- preserve all unique chat messages and fail open when verification fails.

### Maximum Savings

- preserve the current message, system messages, tool sequences, and latest 3 conversational messages;
- allow polarity-aware near-duplicate removal outside the recent window;
- prefer virtualization for large unique data so removed detail remains retrievable;
- never silently trim unique context that has no retrievable original.

### Custom

Expose only controls that change runtime behavior: recent protected window, approximate deduplication, token budget policy, semantic compression, protected values, virtualization threshold, retrieval budget, and fallback policy. Remove or hide telemetry-only controls from the optimization UI.

## Quality contract

The default strategy order is:

```text
exact cleanup -> structural compression -> quality checks -> use compact form
                                                    -> on failure: use original
```

Semantic summarization is off by default and labeled experimental. When enabled it runs only after deterministic compression, must preserve protected values, has a timeout, and falls back to deterministic or original content.

The Quality Guard must validate, as applicable:

- current message and recent protected messages;
- IDs, numbers, money, percentages, dates, times, URLs, emails, booleans, and explicit protected blocks;
- polarity/negation during approximate deduplication;
- valid JSON or reversible JSON-table structure;
- tool names, tool-call IDs, result IDs, roles, order, and pairing;
- positive estimated savings after receipt/retrieval overhead.

If a check fails, the node returns the original content with a short fallback reason. It must not claim savings in that case.

## Provider neutrality and telemetry

Compression operates on n8n/LangChain message structures before the provider adapter is called, so it is independent of model vendor.

Provider usage extraction becomes a reusable module with fixture tests for common metadata shapes:

- OpenAI-compatible and OpenRouter;
- Anthropic;
- Google Gemini;
- Ollama/local LangChain models when usage is exposed;
- generic n8n `llmOutput.tokenUsage` and `usage_metadata` shapes.

If a model does not expose usage, execution continues and displays an estimate. The UI and output must never label an estimate as real usage.

## Output and UI rules

- descriptions state what the option changes and when to use it;
- common settings stay visible; risky or diagnostic settings live in `Advanced Options`;
- defaults work without expressions beyond the content field;
- output mode defaults to `Simple`; `Detailed` is opt-in;
- simple output never duplicates a large original input;
- model-visible tool responses omit telemetry and internal storage data;
- each node description includes one clear use case and one boundary.

Existing technical node type names remain unchanged for workflow compatibility. Display names may change to the cohesive Token Saver names.

## First-message A/B workflow

Create a local draft workflow with no WhatsApp, RD, inventory, or external side effects:

```text
n8n Chat Trigger
  -> identical Baseline Agent -> Measure Baseline wrapper -> same model -> Large Data Tool
  -> identical Optimized Agent -> Token Saver wrapper -> same model -> Large Data Tool
  -> Token Savings comparison
  -> Chat response
```

The tool is a deterministic n8n sub-workflow that returns a large, repetitive but realistic JSON dataset with protected IDs, dates, money, negations, and a requested record. Both agents receive the same tool schema, prompt, question, temperature, and model.

The very first user message asks for exact facts that require the tool. The final chat response shows:

- baseline and optimized answers;
- provider input tokens for both paths when available;
- tokens and percentage saved;
- whether required facts are present in both answers;
- whether the optimized path used fallback or retrieval.

The benchmark uses Gemini 2.5 Flash only because that credential is available locally. The package behavior and tests remain provider-neutral.

## Tests and acceptance criteria

### Unit and integration tests

- all optimization levels produce meaningfully different protected windows or strategies;
- default profiles never remove unique chat messages;
- model wrapper compresses valid large tool results and preserves tool protocol;
- malformed tool sequences bypass optimization;
- provider telemetry fixtures normalize correctly;
- simple outputs exclude original large input and diagnostics;
- detailed outputs remain available;
- Quality Guard fallback returns original with zero claimed savings;
- all five node descriptions and option defaults are validated by build/lint.

### Local n8n acceptance

- package tests, build, and lint pass;
- package is packed and installed in the local n8n only;
- each of the five nodes loads and executes;
- first-message workflow executes end to end;
- provider-reported baseline input is greater than optimized input on the large tool result;
- all required exact facts appear in both final answers;
- the report clearly separates provider usage from estimates.

No fixed percentage is promised. A valid result is measurable positive provider-token reduction with equivalent required facts. If the fixture does not create a measurable reduction, adjust only the deterministic test dataset size/repetition, not the expected answer or quality rules.

## Delivery

- package version `0.4.0` and updated changelog/README;
- packed local tarball;
- upgraded first-message A/B workflow JSON and creation/report scripts;
- local n8n workflow in draft state;
- concise Portuguese handoff explaining what every node does, when to use it, and which level to choose;
- recorded A/B execution evidence with provider usage and quality result.
