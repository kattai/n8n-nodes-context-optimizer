# n8n Context Saver

Provider-neutral n8n community nodes that reduce AI Agent input tokens without silently discarding exact data. Context Saver optimizes model messages, packs structured content, stores recoverable originals, retrieves only missing evidence, and reports net savings.

## Start with one node

```text
Any n8n Chat Model -> Context Saver Model -> AI Agent
```

Select `Save Tokens`, `Balanced`, and `Automatic Hybrid`. The wrapper changes the messages sent to the provider; it is not a prompt that merely asks the model to be shorter.

## Nodes

| Node                                                             | Add it when                                                                 | Main result                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Context Saver Model](docs/nodes/context-saver-model.md)         | An AI Agent has chat history or large tool results                          | Optimized calls to any compatible n8n chat model           |
| [Context Saver Content](docs/nodes/context-saver-content.md)     | JSON, API data, RAG, logs, HTML, or a static prompt exists before the Agent | Compact inline content or a recoverable preview            |
| [Context Saver Store](docs/nodes/context-saver-store.md)         | Exact large data must remain available outside the prompt                   | Gzip resource with SHA-256, scope, TTL, and receipt        |
| [Context Saver Retriever](docs/nodes/context-saver-retriever.md) | The Agent receives a Context Saver resource receipt                         | Small, exact, evidence-bearing retrievals                  |
| [Context Saver Metrics](docs/nodes/context-saver-metrics.md)     | Savings, provider usage, cost, or A/B evidence is required                  | Eligible, full-request, provider, and net measurements     |
| [Context Saver Memory](docs/nodes/context-saver-memory.md)       | Long conversations repeat growing history on every model call               | Current facts, protected items, summary, and recent window |

Store, Retriever, Metrics, and Memory are optional. Do not add them when the Model node alone solves the workflow.

## Profiles

| Profile      | Typical eligible reduction | Behavior                                                                                  |
| ------------ | -------------------------: | ----------------------------------------------------------------------------------------- |
| **Quality**  |                     15–35% | Lossless transforms, 12 recent messages, exact deduplication, no automatic virtualization |
| **Balanced** |                     35–60% | Six recent messages, reversible structural packing, conservative recoverable previews     |
| **Savings**  |                     60–85% | Three recent messages and small task-aware previews backed by exact retrieval             |
| **Custom**   |               User-defined | Manual recent window and safety settings                                                  |

These are measured ranges for content that is safe and eligible to optimize, not guarantees for the complete provider request. System instructions, recent messages, tool schemas, receipts, retrieval calls, and model output still consume tokens. Unique content is not deleted merely to hit a target.

## Why quality is preserved

- Tool names, roles, call IDs, result IDs, order, and pairing remain intact.
- IDs, dates, times, money, numbers, booleans, URLs, emails, negations, and protected values are checked.
- JSON packing is reversible and round-trip verified before use.
- Large omitted data remains addressable by resource ID and exact path.
- Unsafe or non-saving transformations fall back to the original.
- Savings can lazily bind relevant tool schemas; low confidence and structured output keep all tools.

Semantic compression is experimental and disabled by default. Code is preserved byte for byte.

## Guarded semantic optimization

Context Saver v0.9 can use one connected n8n Chat Model as an optional adapter for semantic deduplication, task reranking, summary, and judging. It stays provider-neutral: OpenAI, Anthropic, Gemini, OpenRouter, Ollama, or another compatible model can supply the adapter.

- Disabled by default; deterministic compression remains the normal path.
- Every adapter cost enters net-savings math.
- Recent/protected units cannot be removed by semantic selection.
- Low confidence, invalid JSON, missing facts, contradictions, or negative net savings fall back.
- Fallback order is semantic, deterministic, then original; no second paid retry occurs automatically.

Quality verification levels:

| Level        | Checks                                                               |
| ------------ | -------------------------------------------------------------------- |
| **Fast**     | Protected facts/blocks, non-empty output, valid/reversible structure |
| **Strict**   | Fast plus negation and protected-fact polarity; default              |
| **Critical** | Strict plus exact quoted values                                      |

## Cache-aware operation

Profile strength and provider caching are separate decisions:

| Strategy                    | Use                                                                             |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Automatic Hybrid**        | Default: preserve repeated stable prefixes and reduce changing context          |
| **Cache Priority**          | Repeated large system prompts or tool schemas with valuable provider cache hits |
| **Maximum Token Reduction** | Cold or highly dynamic requests where stable-prefix reuse is unlikely           |
| **Ignore Cache Signals**    | Controlled A/B tests or legacy cache-neutral behavior                           |

Only SHA-256 fingerprints and timing/count metadata are stored in the cache registry. Prompt text is not stored there.

## Large exact context

```text
API / RAG / tool output
        -> Context Saver Content or Store
        -> AI Agent -- Context Saver Retriever
```

Content/Store and Retriever must use the same scope and storage directory. The Retriever supports exact paths, filters, lexical search, sections, schema inspection, fragments, pagination, field policies, and per-call/per-execution budgets.

## Simple output

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

The original large input is intentionally absent. Use `Detailed Diagnostics` only while debugging.

## Provider support

Optimization runs before the provider adapter and is not tied to Gemini. It works with compatible n8n `AiLanguageModel` nodes. Provider usage is normalized when available from OpenAI-compatible models, OpenRouter, Anthropic, Gemini, Ollama/local LangChain models, or generic n8n `llmOutput.tokenUsage`.

Estimates remain labeled `estimated`. Financial savings are calculated only when explicit model prices are configured.

## Local development

```bash
npm install
npm run check
npm run benchmark:profiles
npm pack
```

Install the generated tarball in a local/self-hosted n8n user folder:

```powershell
cd $HOME\.n8n\nodes
npm install --save-exact C:\path\to\n8n-nodes-context-optimizer-0.9.0.tgz
```

Restart n8n after installation. The package targets n8n `2.18.5`. Filesystem resources are not encrypted; use a secured shared directory in queue mode and leave secret-like storage disabled unless explicitly required.

The package is currently private and is not published to npm.

## Evidence and design

- [v0.9 semantic and adaptive quality benchmark](benchmarks/results/semantic-quality-v0.9.0.md)
- [v0.8 memory and lazy-tools benchmark](benchmarks/results/memory-tools-v0.8.0.md)
- [v0.7 profile benchmark](benchmarks/results/profile-v2-results.md)
- [v0.7 design](docs/superpowers/specs/2026-07-31-context-saver-v2-design.md)
- [v0.6 cache-aware benchmark](benchmarks/results/cache-aware-v0.6.0.md)
- [Importable workflows](examples/workflows/)
