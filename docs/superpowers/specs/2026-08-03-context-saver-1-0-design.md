# Context Saver 1.0 - product and architecture design

Date: August 3, 2026  
Status: approved for implementation planning  
Target package version: `1.0.0`

## 1. Outcome

Context Saver 1.0 reduces input-token use in production n8n agents while preserving exact data, tool behavior, structured output, and provider-cache value. It targets workflows serving many external conversations, including workflows with multiple agents, large system prompts, long sessions, many tool schemas, and large tool results.

The standard setup remains small:

```text
Chat Model -> Agent Optimizer -> AI Agent
                                  |-> Exact Lookup

AI Agent -> Savings Report
```

Each AI Agent receives its own Agent Optimizer. One Savings Report aggregates every optimizer and model call in the current execution.

## 2. Users

Two audiences have different needs:

1. Workflow builders configure the nodes in n8n. They need a short setup, clear names, safe defaults, actionable errors, and complete documentation.
2. External users converse with the agents. Optimization must be invisible to them and must not alter the intended tone, behavior, output format, or access boundaries of the agent.

Interface copy uses simple English. Documentation ships in English and Brazilian Portuguese.

## 3. Product principles

1. Quality wins over savings. Unsafe or non-saving candidates fall back to a more conservative result and then to the original.
2. Automatic is the default. Advanced controls remain collapsed until the builder requests them.
3. Lossless and reversible techniques run before relevance selection or semantic techniques.
4. Exact originals remain retrievable whenever content leaves the prompt.
5. Savings are measured as net savings, including compression, verification, cache, and retrieval overhead.

No feature claims that the underlying model can never hallucinate. The defensible guarantee is narrower: Context Saver rejects an optimized context when its deterministic checks detect loss of protected information or broken structure.

## 4. Node names and boundaries

| New display name | Existing implementation | Single responsibility |
|---|---|---|
| Agent Optimizer | Context Saver Model | Optimize every model call made by one AI Agent |
| Data Optimizer | Context Saver Content | Optimize one large JSON, API, RAG, HTML, log, text, or code input before AI use |
| Agent Handoff | New node | Build a compact, evidence-linked context passed from one agent to another |
| Session Memory | Context Saver Memory | Keep current facts, state, protected events, summary, and a recent window across turns |
| Context Storage | Context Saver Store | Store exact original resources outside the prompt |
| Exact Lookup | Context Saver Retriever | Let an AI Agent retrieve a bounded exact value, record, section, or fragment |
| Savings Report | Context Saver Metrics | Aggregate per-call, per-agent, provider, cache, retrieval, and net savings |

Internal node type names and old parameter names remain supported. Existing workflow exports continue to load without manual migration. Saved instance names on existing canvases remain unchanged.

## 5. Default user experience

### 5.1 Agent Optimizer

Fields shown by default:

- Run mode: `Save tokens` or `Measure only`
- Optimization profile: `Quality First`, `Balanced`, `Maximum Savings`, or `Custom`

Automatic mode handles prompt analysis, history windows, tool schema selection, large tool results, cache policy, token budgets, quality verification, and fallback. Advanced options expose overrides grouped by Prompt and history, Tools, Large results, Cache, Security, and Token budgets.

### 5.2 Data Optimizer

Fields shown by default:

- Data
- Data type, default `Auto detect`
- Optimization profile
- Current task, optional

Field projection, protected values, virtualization thresholds, storage, and diagnostics stay in Advanced options.

### 5.3 Agent Handoff

Fields shown by default:

- Agent output
- Next agent task
- Optimization profile

The node outputs current facts, decisions, pending work, exact resource references, and a compact handoff context. It does not pass complete prior prompts, history, or completed tool results unless protected or explicitly requested.

### 5.4 Session Memory

Fields shown by default:

- Session ID
- New messages
- Optimization profile

The default operation updates the session and returns model-ready context in one execution. Inspect, delete, purge, state replacement, summary locking, and storage controls remain advanced.

### 5.5 Context Storage

Fields shown by default:

- Data
- Storage provider
- Expiration

Scope, session isolation, encryption, size limits, content type, metadata, and diagnostics are automatic or advanced.

### 5.6 Exact Lookup

Fields shown by default:

- Storage provider
- Session ID

The tool description, operation defaults, field allowlists, blocked fields, result limits, call limits, and token budgets have safe defaults and remain advanced.

### 5.7 Savings Report

The default operation is `Current execution`. It automatically discovers every Context Saver telemetry record in the execution. Simple output includes agent count, model-call count, tokens before, tokens after, net tokens saved, percent saved, provider-measurement availability, cache use, retrieval overhead, and quality fallback count.

## 6. Profiles

Profiles define maximum permitted optimization strength. The adaptive policy may downgrade a call when risk is higher.

| Profile | Typical eligible reduction | Default behavior |
|---|---:|---|
| Quality First | 15-35% | Exact deduplication, lossless structural transforms, 12 recent messages, all tools, no automatic lossy selection |
| Balanced | 35-60% | Six recent messages, reversible packing, high-confidence tool selection, conservative recoverable previews |
| Maximum Savings | 60-85% | Three recent messages, lazy tools, small task-aware previews, exact retrieval required |
| Custom | User-defined | Manual windows, budgets, selection, virtualization, verification, and optional semantic stages |

High-risk calls automatically use a safer effective policy. Risk signals include code, contracts, finance, exact quotations, forced tools, ambiguous structured output, low tool-selection confidence, missing recovery, and missing storage isolation.

## 7. Optimization pipeline

Every Agent Optimizer call follows this order:

1. Convert model input to canonical context categories.
2. Detect model family and estimate tokens with the best available tokenizer.
3. Protect system rules, the current user message, exact facts, active tool sequences, structured-output requirements, and user-marked values.
4. Apply deterministic cleanup, exact deduplication, JSON packing, log collapsing, schema canonicalization, and cache-aware stable-prefix handling.
5. Apply category budgets, relevance selection, lazy tool loading, field projection, chunk selection, and large-result virtualization only when the profile permits it.
6. Run quality verification and net-savings checks.
7. Return the approved optimized input, a safer candidate, or the original.
8. Record per-call telemetry for Savings Report.

The current user message is never summarized. Code remains exact unless the user explicitly selects a code-aware projection mode with recoverable originals.

## 8. Existing techniques retained

Context Saver 1.0 keeps and tests all techniques implemented before 1.0:

- canonical context representation and category budgets;
- active tool-call and tool-result sequence preservation;
- provider-aware token estimation and normalized usage;
- negative-optimization prevention and net-savings calculation;
- reversible JSON packing, shared schemas, and round-trip verification;
- tool-result virtualization, receipts, resource IDs, hashes, and exact retrieval;
- hash reuse and fingerprint-based cache policy;
- recent-window memory, pinned facts, structured state, incremental summaries, archives, and fact versioning;
- field projection, BM25 chunk selection, relevance scoring, tool schema selection, and lazy tool loading;
- optional semantic deduplication, summary, reranking, and judge with deterministic fallback.

Semantic stages stay disabled in all standard profiles. They remain explicit Custom options because they add cost, latency, and omission risk.

## 9. New and improved techniques

### 9.1 System Prompt Compiler

The compiler separates stable and dynamic prompt units, removes exact repeated sections, normalizes safe formatting, fingerprints stable prefixes, and preserves protected instructions. It does not semantically rewrite unique rules in standard profiles.

### 9.2 Adaptive risk policy

The selected profile is an upper bound. The policy chooses an effective per-call strength from content risk, tool confidence, output constraints, storage availability, provider cache signals, and prior fallback history. Telemetry reports both selected and effective profiles.

### 9.3 Agent handoff deduplication

Agent Handoff serializes facts, decisions, pending work, source evidence, and resource references into a stable contract. Repeated prior prompts, complete history, and completed tool payloads do not cascade through downstream agents.

### 9.4 Execution-wide telemetry

A shared telemetry registry lists all optimizer, data, memory, storage, and retrieval records for one execution. Savings Report no longer requires a Code node or exact model-wrapper names.

### 9.5 Scalable storage

Filesystem remains the zero-credential legacy provider. Redis becomes the recommended provider for queue mode, multiple workers, high concurrency, cache fingerprints, session memory, and short-lived resources.

### 9.6 Encryption and tenant isolation

Stored content can use AES-256-GCM with a key held in an n8n credential. Resources bind to workflow, session, and user identity. Retrieval rejects scope, session, owner, hash, expiration, and authentication mismatches before reading content.

## 10. Quality and fallback rules

The following invariants apply to every standard profile:

- current user message remains byte-for-byte identical;
- active tool names, call IDs, result IDs, order, and pairing remain valid;
- protected IDs, dates, times, numbers, money, booleans, URLs, emails, names, negations, and quoted values remain present with the required polarity;
- packed JSON must reconstruct to the original value;
- content omitted from the prompt must have a valid, session-bound, unexpired recovery path;
- low-confidence tool selection keeps all tools;
- ambiguous structured output keeps all relevant schemas and tools;
- non-positive net savings cancel the candidate;
- any failed check downgrades to a conservative candidate and then to the original.

Optimization failure does not fail the customer conversation. Security failures block unsafe storage or cross-tenant retrieval, but the optimizer may continue with safe inline original content when that content was already authorized for the model.

## 11. High-volume behavior

Context Saver must avoid adding a paid compressor call to every customer message. Standard profiles use local deterministic processing. Stable prompt and data fingerprints reuse prior work. Redis operations are bounded and expire through TTL. Retrieval has per-call and per-execution limits. Telemetry objects remain small and never re-enter another AI prompt by default.

Concurrency design targets at least 100 parallel synthetic sessions without cross-session data access, unbounded memory growth, registry corruption, duplicate receipt ownership, or negative-savings loops.

## 12. Measurement

Savings Report distinguishes:

- eligible content before and after optimization;
- complete estimated request before and after optimization;
- provider-reported input, cached input, output, reasoning, and total tokens when available;
- compressor, verifier, storage receipt, and retrieval overhead;
- gross and net savings;
- selected and effective profile;
- per-agent and total execution measurements;
- fallback, quality-check, storage, cache, and retrieval diagnostics.

Estimated measurements remain labeled. Financial savings appear only after the builder supplies explicit prices. Provider usage is never fabricated.

## 13. Documentation

The package ships:

- a five-minute quick start;
- one complete page per node and per field;
- connection diagrams and a decision guide;
- importable synthetic examples for one agent, long context, many tools, multiple agents, and recoverable large data;
- troubleshooting with cause and exact corrective action;
- English and Brazilian Portuguese Markdown guides and verified PDFs.

Every node page uses the same order: what it does, when to use it, where to connect it, recommended configuration, output, advanced options, safety behavior, and common problems.

## 14. Test-data policy

Tests run locally with fictional and sanitized data only. User-provided production prompts, customer messages, credentials, Power BI data, tool responses, business rules, names, emails, phone numbers, and identifiers must not enter fixtures, snapshots, benchmarks, logs, or repository history.

Two synthetic boss scenarios reproduce only the structural difficulty:

1. Long-context boss: one fictional analytics agent with a large invented prompt, growing fictional memory, repeated tool iterations, and large generated tabular results.
2. Tool-heavy boss: two fictional service agents with 14 invented tools, large schemas, clear and ambiguous intents, and multi-agent branching.

## 15. Continuous test matrix

Every commit runs locally without provider credentials:

```text
unit tests
-> legacy compatibility tests
-> synthetic workflow runtime tests
-> quality invariant tests
-> deterministic token benchmarks
-> build and lint
```

Required cases include text, JSON, API responses, RAG, HTML, logs, code, static prompts, growing history, replaced facts, active and completed tool sequences, parallel tool calls, failed tools, streaming, structured output, forced tools, low-confidence selection, missing storage, expired resources, tampered ciphertext, negative savings, retrieval loops, multi-agent handoff, and concurrent sessions.

Provider-backed A/B tests run only before a release when explicit test credentials are available. They use synthetic prompts and data. They are never a requirement for normal local development.

## 16. Acceptance gates

Correctness gates:

- protected facts: 100%;
- active tool call and result integrity: 100%;
- JSON pack round-trip: 100%;
- exact requested retrieval: 100%;
- current user message identity: 100%;
- cross-session isolation: 100%;
- non-positive net optimization accepted: 0 cases.

Deterministic benchmark targets:

- Quality First: 15-35% typical eligible reduction without virtualization;
- Balanced: 35-60% median eligible reduction;
- Maximum Savings: 60-85% median eligible reduction for recoverable large content;
- synthetic tool-heavy boss: at least 60% schema reduction for clear intent and all tools retained for ambiguous intent;
- synthetic long-context boss: at least 30% full-request reduction in the multi-turn benchmark without quality failure.

These are regression targets for the synthetic corpus, not guaranteed billing reductions for arbitrary workflows.

## 17. Compatibility and release

Version 1.0 adds new node versions and one new Agent Handoff type. Existing type identifiers, operation values, field names, profiles, filesystem data, receipts, and workflow exports remain supported. Legacy names appear in migration documentation.

Release order:

1. Implement and pass deterministic gates as `1.0.0-rc.1`.
2. Import and execute sanitized synthetic examples in local n8n.
3. Run optional provider-backed synthetic A/B tests.
4. Regenerate English and Portuguese documentation and PDFs.
5. Release `1.0.0` only after all required gates pass.

## 18. Non-goals

Version 1.0 does not replace the native n8n AI Agent, route requests between model providers, promise a fixed billing reduction, use production customer data in tests, enable semantic compression by default, or provide a separate hosted analytics dashboard.

