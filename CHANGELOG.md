# Changelog

## 0.8.0 — 2026-07-31

- Add Context Saver Memory with scoped sessions, current fact versioning, protected corrections and pending work, incremental summaries, recent windows, gzip archives, TTL, and atomic writes.
- Add safe deferred tool binding for Savings and opt-in Balanced workflows with deterministic relevance, budgets, always-available tools, and recently used tools.
- Keep every tool on low confidence, duplicate names, Quality, Cache Priority, forced/ambiguous structured output, or small tool sets.
- Report tool-schema counts, estimated tokens, selection reason, and confidence alongside model optimization metrics.
- Add local n8n runtime workflows and deterministic memory/many-tools benchmarks.
- Validate 92.27% memory-context reduction and 83.21% tool-schema reduction on the v0.8 corpus with all defined integrity checks passing.

## 0.7.0 — 2026-07-31

- Rename the public suite to Context Saver while preserving technical node identifiers and v1 workflow compatibility.
- Add v2 Quality, Balanced, Savings, and Custom profile contracts with explicit eligible-savings ranges.
- Add canonical context, active tool-sequence preservation, model-aware token counting, net-savings guards, and negative-optimization fallback.
- Add reversible recursive JSON packing, content-addressed resource reuse, SHA-256 receipts, task-aware previews, paged exact retrieval, and evidence paths.
- Separate eligible, full-request, provider, and net measurements with actionable recommendations.
- Add distinct background-free light/dark icons, per-node documentation, v2 example workflows, and a deterministic profile benchmark.

## 0.6.0 — 2026-07-30

- Add provider-neutral cache-aware strategies: Automatic Hybrid, Cache Priority, Token Reduction Priority, and legacy Ignore Cache Signals.
- Preserve stable prompt prefixes with SHA-256-only fingerprint metadata and configurable repetition thresholds.
- Keep `0.5.2` workflows backward compatible when the new cache setting is absent.
- Separate provider-reported regular input, cached input, output, and reasoning tokens.
- Report measurement confidence and calculate cost only from explicit user prices.
- Warn when queue-mode fingerprint observations may remain worker-local.

## 0.5.2 — 2026-07-30

- Aggregate provider usage and optimization metrics across every internal Agent loop so A/B reports measure the complete conversation, including exact Retriever calls.

## 0.5.1 — 2026-07-30

- Detect the exact AI Agent parent supplied by n8n for model sub-nodes, allowing Maximum Savings to verify a Retriever connected to that same Agent.

## 0.5.0 — 2026-07-30

- Turn Maximum Savings into automatic reversible virtualization for eligible large tool results.
- Target 70–90% eligible-token savings with a deterministic task-aware preview capped at 30%.
- Require a compatible Token Saver Retriever on the same Agent, scope, and storage directory.
- Verify stored SHA-256 and exact retrieval before replacing provider input.
- Refuse automatic storage of code, binary, and secret-like content by default.
- Fall back to structural compression on every eligibility, storage, retrieval, or quality failure.
- Add eligible-token, resource, retrieval, target-band, and fallback telemetry.
- Keep model telemetry reusable for multiple A/B comparisons until its 24-hour TTL.
- Improve lexical preview ranking so exact IDs outrank generic short terms.
- Validate 70%+ savings on at least 95% of a 20-case structured dataset.

## 0.4.5 — 2026-07-30

- Replace provider-fragile discriminated tool input with one portable schema.
- Infer retrieval operations deterministically when a model sends only `path`, `query`, `filters`, `section`, or `start/end`.

## 0.4.4 — 2026-07-30

- Invoke the retriever through its LangChain tool in n8n 2.18 so ToolCall `args` are decoded and the tool-call ID is preserved.

## 0.4.3 — 2026-07-30

- Support current n8n 2.18 AI Tool execution while retaining legacy `supplyData()` compatibility.
- Read the concise `tokenSavings` output from Token Saver Content without requiring detailed telemetry.
- Add regression coverage and a five-node integration workflow for Content, Savings, Store, Retriever, and Chat Model.

## 0.4.2 — 2026-07-30

- Unwrap n8n and LangChain `response`, `text`, and `content` tool-result envelopes before compression.
- Safely serialize structured tool results while rejecting non-text content blocks.
- Add structured-envelope regression coverage for current n8n agent tool calls.

## 0.4.1 — 2026-07-30

- Compress tool outputs emitted as LangChain text-content blocks, not only legacy string content.
- Add a regression test matching current n8n Code Tool message shape.
- Add a first-message A/B workflow that measures provider tokens and exact-fact retention.

## 0.4.0 — 2026-07-30

- Rename the user-facing suite to Token Saver and make Token Saver Chat Model the one-node quick start.
- Add meaningful Maximum Quality, Balanced, Maximum Savings, and Custom protected-message windows.
- Stop default profiles from trimming unique context solely to meet a token budget.
- Add reusable provider-usage normalization for OpenAI-compatible, Anthropic, Gemini, Ollama, and generic n8n metadata.
- Default Content, Store, and Savings to concise outputs that do not copy large original input.
- Add concise model-visible Retriever responses and clearer option descriptions across all five nodes.
- Validate reversible JSON-table rows, ISO dates, additional currencies, and booleans.
- Add provider, output-shape, level, UI-description, and unique-content regression tests.

## 0.3.0 — 2026-07-30

- Preserve all unique conversation messages in every default profile.
- Disable approximate deduplication in Balanced and protect instruction polarity.
- Enforce token budgets, include receipt overhead, and reject non-positive savings.
- Preserve code byte for byte and fix nested JSON include-field handling.
- Apply blocked and allowed retriever fields recursively; deny unsafe raw retrieval.
- Verify stored resource SHA-256 on every read and require scope for inspect/delete.
- Use operation-specific retriever schemas and abort timed-out compression calls.
- Observe streams until completion and separate provider-reported usage from estimates.
- Add regression coverage for security, integrity, budget, quality, and actual A/B metrics.

## 0.2.1 — 2026-07-30

- Compress large JSON/tool responses structurally inside the model wrapper.
- Preserve the exact count, order, role, call ID, and result ID of every tool message.
- Keep short tool exchanges unchanged and bypass malformed sequences.

## 0.2.0 — 2026-07-30

- Add content-aware compression for JSON/API responses, tool output, RAG, logs, HTML, code, and text.
- Add explicit context virtualization with task-aware previews and reversible storage.
- Add Context Store with gzip, SHA-256, scope isolation, TTL, atomic writes, size limits, and safe paths.
- Add Context Retriever Tool with exact lookup, filters, lexical search, schema inspection, and retrieval budgets.
- Add Token Analytics with net-savings, cache, retrieval, quality, latency, and cost metrics.
- Preserve user corrections, pending questions, failures, and complete tool-call sequences.
- Bypass model-wrapper compression whenever tool call/result data is present.
- Add quality fallback and 40 deterministic unit tests.

## 0.1.2 — 2026-07-29

- Preserve the latest message even when approximate deduplication finds an older equivalent.
- Preserve tool calls and tool results as complete pairs.
- Add content-free execution telemetry to Optimized Chat Model.
- Capture provider token usage when the model response exposes it.

## 0.1.1 — 2026-07-29

- Prevent n8n from generating misleading tool variants for both nodes.
- Validate both visible node types in n8n 2.18.5.

## 0.1.0 — 2026-07-29

- Add Context Optimizer, Optimized Chat Model, four profiles, deterministic compression, optional summarization, protected-fact validation, and fail-open behavior.
