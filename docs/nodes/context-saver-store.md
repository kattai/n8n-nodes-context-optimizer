# Context Saver Store

## Purpose

Move exact large content outside the model prompt while keeping it recoverable during later Agent steps or executions.

## How it saves tokens

The original is gzip-compressed on the self-hosted filesystem and replaced downstream by a small receipt. Resources are content-addressed, reused by hash within the same scope, written atomically, checked with SHA-256, and expired by TTL.

## Use it when

- Large source data must remain exact and auditable.
- Multiple retrievals or executions can reuse the same content.
- Content should not travel through every n8n item.

## Do not use it when

- n8n Cloud or your deployment cannot provide persistent/shared filesystem storage.
- Queue workers do not share the configured directory.
- The directory is not secured for the sensitivity of the data.

## Operations

- **Store:** create or reuse a scoped resource and return a receipt.
- **Inspect:** return safe manifest metadata without the original content.
- **Delete:** remove a resource within the matching scope.

## Example

```text
Database -> Context Saver Store -> AI Agent
                                  |
                                  -> Context Saver Retriever
```

Use the same `Scope` and `Storage Directory` in Store and Retriever. Secret-like content is blocked unless explicit opt-in is enabled.
