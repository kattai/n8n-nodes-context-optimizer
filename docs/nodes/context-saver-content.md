# Context Saver Content

## Purpose

Optimize one large value before it enters an AI prompt. Supported content includes JSON/API responses, tool output, RAG documents, logs, HTML, text, code, and static prompts.

## How it saves tokens

The node detects content type, removes safe boilerplate, deduplicates exact units, and packs repeated JSON schemas into a reversible representation. It rejects transformations that lose protected facts or do not produce positive savings. Automatic virtualization stores eligible originals and returns a smaller task-aware preview plus resource ID.

## Use it when

- An HTTP, database, file, or RAG node returns a large field.
- A static prompt repeats on every request and can be compiled once.
- You need explicit field projection before the Agent.

## Do not use it when

- The value is small; receipt overhead may cost more than it saves.
- The exact original is required inline and no Retriever is connected.
- You expect natural-language summarization; semantic rewriting is not the default behavior.

## Profiles and virtualization

- **Quality:** keep inline; deterministic packing only.
- **Balanced:** virtualize large eligible content automatically.
- **Savings:** use the smallest safe recoverable preview.
- **Required virtualization:** fail instead of silently continuing if storage/recovery cannot be established.

## Example

```text
HTTP Request
  -> Context Saver Content
     operation: Optimize Content
     type: JSON or API Response
     profile: Balanced
     virtualization: Automatic
  -> AI Agent
```

Pass only `optimizedContent` downstream. The Simple output intentionally excludes the original.
