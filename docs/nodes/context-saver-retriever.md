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

## Example Agent instruction

```text
Never invent omitted values. When an exact value is absent, call retrieve_context
with the resourceId and the narrowest path/filter possible.
```

Block secrets and irrelevant fields. Keep `Allow Full Original` disabled for normal production use.
