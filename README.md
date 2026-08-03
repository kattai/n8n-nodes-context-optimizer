# Context Saver for n8n

Provider-neutral community nodes that reduce AI Agent input tokens while preserving exact facts, active tool calls, structured output, and recoverable originals.

## Five-minute setup

```text
Any n8n Chat Model -> Agent Optimizer -> AI Agent
                                          |-> Exact Lookup (only for Maximum Savings)

AI Agent -> Savings Report
```

1. Insert **Agent Optimizer** between the Chat Model and AI Agent.
2. Choose **Save Tokens** and **Balanced**.
3. Keep **Adaptive Quality Protection** enabled.
4. Add **Savings Report** after the agent response.
5. Use **Maximum Savings** only with **Exact Lookup** and shared storage.

No model provider is required by Context Saver. It wraps compatible n8n chat models from Gemini, OpenAI, Anthropic, OpenRouter, Ollama, and other LangChain-compatible nodes.

## Nodes

| Node | Use it for | Where it connects |
|---|---|---|
| **Agent Optimizer** | Every call of one AI Agent: prompt, history, tools, and large tool results | Chat Model -> Agent Optimizer -> AI Agent |
| **Data Optimizer** | Large JSON, API, RAG, HTML, logs, text, or tool output | Before the AI Agent input |
| **Agent Handoff** | Compact evidence passed between multiple agents | Agent A -> Agent Handoff -> Agent B |
| **Session Memory** | Current facts, state, protected events, recent window, and archive | Main workflow path before the Agent |
| **Context Storage** | Exact original content outside the prompt | Before Agent Handoff or as a data branch |
| **Exact Lookup** | Bounded exact retrieval from Context Storage | AI Tool port of the Agent |
| **Savings Report** | Current-execution totals and diagnostics | After the optimized agent path |

Use only the nodes needed by the workflow. **Agent Optimizer** alone is the normal starting point.

## Profiles

| Profile | Typical eligible reduction | Safety behavior |
|---|---:|---|
| **Quality First** | 15-35% | Lossless transforms, 12 recent messages, all tools |
| **Balanced** | 35-60% | Reversible packing, six recent messages, conservative selection |
| **Maximum Savings** | 60-85% | Three recent messages, lazy tools, recoverable previews |
| **Custom** | User-defined | Manual budgets and experimental semantic stages |

Ranges describe synthetic eligible content, not guaranteed provider billing. Adaptive protection can automatically downgrade a risky call. Code, exact quotations, forced tools, active tool sequences, ambiguous structured output, or missing retrieval produce a safer effective profile.

## What actually saves tokens

- Exact paragraph and message deduplication; stable System Prompt compilation.
- Reversible JSON packing, shared schemas, field projection, and log collapsing.
- Recent-window memory, replaced-fact versioning, and compact multi-agent handoffs.
- High-confidence lazy tool schemas; ambiguity and low confidence retain all tools.
- Large-result virtualization with hash reuse and bounded exact recovery.

The current user message is never summarized. Active tool-call IDs, result IDs, order, and pairing remain intact. Non-positive optimization and failed quality checks return a safer candidate or the original.

## Cache and direct reduction

**Automatic Hybrid** is the default. It preserves repeated stable prefixes when provider caching is valuable and reduces dynamic content. The fingerprint registry stores hashes and timing/count metadata, never prompt text.

- Filesystem registry: simplest local setup.
- Redis registry: shared observations across queue workers.
- Provider-reported cached tokens are used when available.
- Savings Report separates estimates from provider measurements.

## Shared and secure storage

Filesystem remains the zero-credential option. Redis is recommended for queue mode and many simultaneous users. Optional AES-256-GCM encryption protects compressed resources and sessions at rest.

Set the same values in producers and **Exact Lookup**:

```text
Storage Provider
Scope
Session ID
Owner ID
Redis Prefix or Filesystem Directory
Encryption setting and credential
```

Resource access is rejected when workflow, session, owner, TTL, hash, encryption authentication, field policy, call budget, or token budget fails.

## Measurement

**Savings Report / Current Execution** automatically collects Agent Optimizer model calls plus Data Optimizer, Agent Handoff, Session Memory, Context Storage, and Exact Lookup telemetry. It subtracts compression, verification, and retrieval overhead from net savings. Provider usage is never invented.

## Local validation

```bash
npm install
npm run check:local
npm pack
```

`check:local` uses generated fictional data only. It runs unit, compatibility, security, concurrency, profile, long-context, 14-tool, multi-agent, build, and lint gates without external LLM calls.

Importable local workflows:

- [First-message chat proof](examples/workflows/context-saver-v1-chat-first-message.workflow.json)
- [Complete local runtime proof](examples/workflows/context-saver-v1-local-runtime.workflow.json)

## Documentation

- [Guia completo em português](docs/pt-BR/GUIA_COMPLETO.md)
- [Guia completo em PDF](output/pdf/context-saver-1.0-guia-completo-pt-br.pdf)
- [English quick start](docs/en/QUICKSTART.md)
- [1.0 architecture](docs/superpowers/specs/2026-08-03-context-saver-1-0-design.md)
- [Profile benchmark](benchmarks/results/profile-v2-results.md)
- [Synthetic boss benchmark](benchmarks/results/context-saver-v1-bosses.md)

The package is private until release approval. Existing internal node IDs, legacy versions, operations, fields, profile aliases, workflow imports, and unencrypted filesystem resources remain supported.
