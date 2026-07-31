# Context Saver Retriever

## Purpose

Give an AI Agent controlled access to exact details omitted from a compact Context Saver receipt.

## How it saves tokens

The Agent requests only a path, filtered record set, relevant chunk, section, schema, or bounded fragment. Results are projected to allowed fields, paginated, token-limited, and returned with resource ID, path, SHA-256 evidence, and exactness.

## Use it when

- Context Saver Content, Store, or Model returns a resource receipt.
- The Agent needs exact IDs, values, dates, code fragments, or records on demand.
- A full document or API result would be wasteful in every model turn.

## Do not use it when

- No resource was stored.
- Scope or storage directory differs from the producing node.
- The Agent can answer safely from the inline preview alone.

## Retrieval capabilities

- Exact JSON path and safe nested field projection.
- Compound filters with `and`/`or` and comparison operators.
- BM25 search with neighboring chunks.
- Schema, section, bounded fragment, cursor pagination, per-call and per-execution budgets.

## Tool call defaults

When one Retriever is dedicated to a workflow-known resource, version 2 can define a default `Resource ID`, `Operation`, and `Path`. Defaults are used only when the model omits a field. Scope validation still applies.

This avoids failing an entire Agent execution when a provider emits an empty or partial tool call. Invalid calls without usable defaults return a compact `invalid_tool_input` result so the Agent can retry instead of crashing the workflow.

## Example Agent instruction

```text
Never invent omitted values. When an exact value is absent, call retrieve_context
with the resourceId and the narrowest path/filter possible.
```

Block secrets and irrelevant fields. Keep `Allow Full Original` disabled for normal production use.
