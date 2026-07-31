# Context Saver Memory

## Purpose

Keep long-running agent sessions useful without sending the complete conversation to the model on every turn.

This is an explicit workflow node, not an `AiMemory` sub-node. Use it before an Agent when you want visible control over what is stored and what enters the prompt.

## How it saves tokens

The context sent to the Agent contains only:

- current pinned fact values;
- compact structured state;
- protected corrections, decisions, pending work, and active failures;
- one validated incremental summary;
- the recent message window and recoverable resource IDs.

Older messages and superseded fact values remain in the gzip session file but stay outside the normal prompt. Repeating a changed fact does not resend every prior value.

## Recommended flow

```text
Chat/Webhook -> Context Saver Memory (Update Session)
             -> Context Saver Memory (Build Context)
             -> AI Agent
```

Use the same stable `Session Key`, `Scope`, and `Storage Directory` in both nodes. Inject the `context` returned by **Build Context** into the Agent system prompt or input context.

## Operations

- **Update Session:** merge new facts, state, messages, summary, and resource references.
- **Build Context:** return the compact model-ready context plus estimated tokens.
- **Inspect Session:** return counts; Detailed output also exposes exact versions and archives.
- **Delete Session:** delete one session without touching equal keys in another scope.
- **Purge Expired Sessions:** remove sessions whose TTL ended.

## Profiles

- **Quality:** 12 recent messages.
- **Balanced:** 6 recent messages.
- **Savings:** 3 recent messages.
- **Custom:** 1–100 recent messages.

Corrections and pending work remain protected even after they leave the recent window. Put changing canonical values in `Pinned Facts`; the latest value enters the prompt once and older versions remain inspectable.

## Message input

```json
[
	{
		"role": "user",
		"content": "Correção: o pedido certo é ORD-991.",
		"kind": "correction"
	},
	{
		"role": "assistant",
		"content": "Vou verificar."
	}
]
```

Protected `kind` values: `correction`, `pending`, `decision`, and `active_failure`.

## Incremental summary safety

Set `Summary Based on Revision` when a separate summarizer read a specific session revision. If another update happened first, Context Saver rejects that stale summary and keeps the last valid one.

`Summary Safety` adds two guards:

- **Required Exact Values:** one value per line; any missing value rejects the candidate.
- **Maximum Summary Tokens:** rejects a candidate above the configured estimate.

Empty, stale, oversized, or incomplete summaries never replace the last valid summary.

## Deployment limits

- Self-hosted filesystem storage only in this version.
- Queue workers must share the configured directory.
- Files are gzip-compressed, not encrypted; secure the directory and its backups.
- Native Agent memory and Context Saver Memory should not both inject the same full history.
