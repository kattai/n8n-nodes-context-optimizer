# Context Saver 1.0.1 — safe maximum-savings integration

## Objective

Make the unified `Context Saver` node recognize its unified `Exact Lookup` sibling, then integrate recoverable Maximum Savings into the Lino workflow without changing its business paths, credentials, model, Redis memory, tools, or customer-facing output contract.

## Root cause

`Agent Model` checks whether an Agent has a compatible Retriever before virtualizing large completed tool results. The check accepts only the removed legacy type suffix `.contextRetrieverTool`. Package 1.0.0 registers only `.contextSaver`, where the Retriever is selected by `parameters.resource === "exactLookup"`. The valid unified Retriever is therefore ignored and Maximum Savings is adaptively downgraded.

## Package changes

1. Recognize both legacy Retriever nodes and unified `Context Saver / Exact Lookup` nodes.
2. Validate matching scope, filesystem/Redis provider, directory/prefix, and encryption settings for both forms.
3. Add regression tests for unified detection, incompatible storage, two Agents sharing one model wrapper, and missing Retriever fallback.
4. Keep every unique conversation message. Savings may remove only exact repetition; large completed tool results become recoverable receipts.
5. Release as 1.0.1 only after unit, integration, security, concurrency, build, lint, package, and local n8n smoke gates pass.

## Workflow integration

- `Universal Chat Model1 -> Context Saver / Agent Model -> both Lino Agents`.
- Keep `Redis Chat Memory2` connected to both Agents with its existing session key and 12-message source window.
- Configure Maximum Savings with adaptive protection, stable prompt compilation, Automatic Hybrid cache, and shared filesystem storage.
- Connect one `Context Saver / Exact Lookup` to both Agents. Use workflow ID as scope, `Info_Agente.chat_id` as session, and `Info_Agente.tenant_id` as owner.
- Pin `retrieve_context`, transfer, last-interaction, and cart-state tools. Select other schemas only when confidence is high.
- Keep `Savings Report` on a parallel branch after `Lino_Output`, preserving `Lino_Output -> Direciona1` unchanged.

## Quality invariants

- Current user message, system instructions, active tool-call/result pairs, IDs, numbers, dates, prices, stock, and structured JSON output remain protected.
- No semantic LLM compression is enabled.
- Exact originals remain available through bounded retrieval; full-original retrieval stays disabled.
- Low-confidence tool selection, malformed tool sequences, structured-output risk, missing storage, or failed integrity checks fall back to a safer profile or original context.
- Tests use fictional payloads and never call production APIs.

## Verification

1. Static workflow validation: JSON parse, unique names/IDs, no missing targets, both IF branches intact, model/memory/tool subnode wiring valid.
2. Package regression suite and synthetic boss benchmarks.
3. Local n8n import/startup check with package tarball 1.0.1.
4. Local mock workflow executions covering normal Agent, protected-location Agent, large tool result virtualization, exact lookup, structured output, and metrics.
5. Confirm npm tarball contents, installability, Git status, GitHub push, npm publish, and `latest` dist-tag.

## Non-goals

- No production Lino execution.
- No changes to external API credentials or endpoints.
- No manual shortening of the two business prompts in this release.
- No replacement of Redis memory with Context Saver Session Memory.
