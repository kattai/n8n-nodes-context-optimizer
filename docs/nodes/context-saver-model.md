# Context Saver Model

## Purpose

Wrap any compatible n8n chat model and optimize the messages actually sent by an AI Agent. This is the default node for conversational agents.

## How it saves tokens

It preserves the system message, current request, recent window, and valid tool-call/result sequences. Older exact repetition is removed. Large completed tool results are structurally packed; Savings can replace them with task-aware receipts when an exact Retriever is connected. Automatic Hybrid keeps stable prefixes reusable by provider caches.

## Use it when

- An AI Agent carries chat history across turns.
- Tools return large JSON, logs, or documents.
- You want provider-neutral optimization with one added node.

## Do not use it when

- The model input is already tiny or has no repeated/structured eligible content.
- You cannot provide a Retriever but expect Savings to omit exact tool data.
- A provider-specific model node does not expose a compatible `AiLanguageModel` connection.

## Profiles

- **Quality:** 12 recent messages; exact deduplication; maximum fidelity.
- **Balanced:** six recent messages; safe structural reduction; default.
- **Savings:** three recent messages; recoverable large-result virtualization.
- **Custom:** manual recent window and near-duplicate behavior.

## Example

```text
Gemini / OpenAI / Anthropic Chat Model
  -> Context Saver Model (Save Tokens, Balanced, Automatic Hybrid)
  -> AI Agent
```

Use `Measure Baseline` only in an A/B branch. It records usage without modifying messages.
