# n8n Token Saver

Provider-neutral n8n community nodes that reduce AI Agent input tokens while protecting exact facts and tool-call structure.

## Quick start

Most workflows need only one extra node:

```text
Any n8n Chat Model -> Token Saver Chat Model -> AI Agent
```

Choose `Save Tokens` and `Balanced (Recommended)`. The model response is unchanged. The wrapper removes safe historical repetition and structurally compresses large tool results before the connected provider receives them.

For new nodes, keep `Cache Strategy` on `Automatic Hybrid (Recommended)`. It preserves repeated stable prefixes that provider caches can reuse, while optimizing dynamic history and tool results. Existing workflows created before `0.6.0` keep their previous behavior automatically.

## Which node to use

| Node | Use it when | What it does |
|---|---|---|
| **Token Saver Chat Model** | Almost every conversational AI Agent | Wraps any n8n chat model and optimizes the messages actually sent to it |
| **Token Saver Content** | A large JSON, API response, RAG result, log, HTML page, or static prompt already exists before the Agent | Produces compact content and a short savings summary |
| **Token Saver Store** | Large original data must stay exactly recoverable outside the prompt | Stores gzip-compressed originals with SHA-256, scope, and TTL |
| **Token Saver Retriever** | The Agent receives virtualized context from Content or Store | Retrieves only the exact missing value, record, section, or fragment |
| **Token Savings** | You need an A/B comparison, cost estimate, batch total, or visible metrics | Returns a simple savings object; detailed diagnostics are optional |

Do not add Store, Retriever, or Savings to every workflow. They solve specific large-context and measurement cases.

## Optimization levels

- **Maximum Quality:** protects the latest 12 messages and removes only exact older duplicates.
- **Balanced (Recommended):** protects the latest 6 messages and safely compresses older repetition and tool results.
- **Maximum Savings:** protects the latest 3 messages and automatically stores eligible large tool results outside the prompt. A task-aware preview targets about 80% eligible-token savings and exact values remain available through Token Saver Retriever.
- **Custom (Advanced):** exposes the recent window, semantic threshold, budget policy, and risky unique-content trimming toggle.

Default levels never delete unique history merely to meet a token budget.

The 70–90% target applies only to eligible large tool output, not to the complete request. System instructions, tool schemas, recent messages, and exact retrieval calls still consume tokens.

## Cache strategy

Optimization level controls **how strongly content may be reduced**. Cache strategy independently controls **whether stable prompt prefixes should remain byte-for-byte reusable**.

| Strategy | Best use | Behavior |
|---|---|---|
| **Automatic Hybrid (Recommended)** | Most production Agents | Preserves uncertain or repeated stable prefixes; reduces dynamic eligible blocks |
| **Cache Priority** | Large repeated system prompts and tool schemas | Prefers stable-prefix reuse even when direct token reduction would be larger |
| **Token Reduction Priority** | Cold, one-off, or mostly changing requests | Minimizes eligible content even when the resulting prefix differs |
| **Ignore Cache Signals** | Legacy workflows and controlled A/B tests | Uses only the selected optimization level, matching `0.5.2` behavior |

Fingerprint records contain only SHA-256 and operational metadata, never prompt content. In queue mode, every worker must use the same shared `Fingerprint Directory`; otherwise cache observations remain worker-local and analytics emits `queue_mode_local_registry`.

## Simple output

Transform and analytics nodes default to output that is safe to pass downstream:

```json
{
  "optimizedContent": "...",
  "tokenSavings": {
    "before": 3120,
    "after": 1040,
    "saved": 2080,
    "percent": 66.67,
    "measurement": "estimated",
    "qualityPassed": true
  }
}
```

The original large input is not copied into the simple output. This prevents an expression such as `$json` from accidentally sending both original and optimized content to the Agent.

Use `Detailed Diagnostics` only while debugging. Provider-reported A/B comparisons use `measurement: "provider"`; all other token estimates stay labeled `estimated`.

## Quality protection

- Current user messages and protected recent messages remain unchanged.
- IDs, numbers, money, percentages, dates, times, URLs, emails, booleans, and explicit protected blocks are checked.
- JSON tables are structurally validated as reversible.
- Tool names, roles, call IDs, result IDs, order, and pairing are preserved.
- Unsafe or non-saving transformations fall back to the original.
- Semantic compression is experimental, off by default, timeout-bounded, and fail-open.
- Code is preserved byte for byte.

## Large exact context

```text
API / RAG / Tool output
        -> Token Saver Content (Context Virtualization on)
        -> AI Agent -- Token Saver Retriever
```

Use the same `Scope` and `Storage Directory` in Content and Retriever. The compact receipt tells the Agent which resource contains omitted details. Retrieval limits keep follow-up tool calls from consuming the original savings.

For automatic virtualization inside the model call:

```text
Any Chat Model -> Token Saver Chat Model (Maximum Savings) -> AI Agent
                                                            ^
Token Saver Retriever --------------------------------------|
```

The Chat Model checks that the Retriever is attached to the same Agent and uses the same scope and directory. Without that exact-retrieval path, it safely keeps the current structural compression. Code, binary, and secret-like content are not stored automatically by default.

## Provider support

Token reduction happens before the provider adapter, so the Chat Model wrapper is not tied to Gemini. It works with any compatible n8n `AiLanguageModel` connection.

Usage metadata is normalized when exposed by OpenAI-compatible models, OpenRouter, Anthropic, Gemini, Ollama/local LangChain models, or generic n8n `llmOutput.tokenUsage`. Models that do not expose usage continue normally with clearly labeled estimates.

`Token Savings` separates regular input, cached input, output, and reasoning when the provider reports them. Financial savings appear only after explicit model prices are configured. Confidence is reported as `provider_actual`, `provider_partial`, or `optimizer_estimate`.

## Local development

```bash
npm install
npm run check
npm pack
```

Install the generated tarball only in a local/self-hosted n8n user folder:

```powershell
cd $HOME\.n8n\nodes
npm install --save-exact C:\path\to\n8n-nodes-context-optimizer-0.6.0.tgz
```

Restart n8n after installation.

This package targets n8n `2.18.5`. Token Saver Store uses the local filesystem, so queue mode requires a directory shared by all workers. Stored resources are not encrypted in v0.5; automatic secret-like storage remains disabled unless the user explicitly opts in.

The package is not published to npm and must remain on the local test instance until quality and cost evaluation passes.

## Documentation

- [v0.4 product specification](docs/specs/2026-07-30-n8n-token-saver-v0-4-product-design.md)
- [v0.6 cache-aware benchmark](benchmarks/results/cache-aware-v0.6.0.md)
- [Maximum Savings specification](docs/specs/2026-07-30-n8n-token-saver-maximum-savings-design.md)
- [v0.3 correctness specification](docs/specs/2026-07-30-n8n-context-optimizer-v0-3-correctness-design.md)
- [n8n node development](https://docs.n8n.io/integrations/creating-nodes/)
