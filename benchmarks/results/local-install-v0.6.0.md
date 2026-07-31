# Token Saver 0.6.0 — local n8n proof

Date: 2026-07-31  
n8n: `2.18.5`  
Package: `n8n-nodes-context-optimizer-0.6.0.tgz`

## Isolated installation

- Separate `N8N_USER_FOLDER`; no existing workflows, credentials, or database copied.
- Editor and `/healthz` started successfully on `127.0.0.1:5680`.
- n8n-generated `types/nodes.json` registered all five package nodes.
- Sanitized A/B workflow imported and exported with `profile=balanced` and `cacheStrategy=automatic_hybrid` unchanged.

## Loaded nodes

1. Token Saver Content
2. Token Saver Retriever
3. Token Saver Store
4. Token Saver Chat Model
5. Token Savings

## Runtime smoke

CLI workflow status: `success`  
Last node: `Inspect Stored Resource`

- Token Saver Content: `14,978 → 13,377` estimated tokens (`10.69%`) using Balanced structural JSON compression.
- Token Savings: `measurementConfidence=optimizer_estimate`; no provider cache or financial claim.
- Token Saver Store: 120 records stored with SHA-256, scope, TTL, field manifest, and no original content in the simple output.
- Inspect Stored Resource: manifest read successfully; `originalTokens=14,978`, `recordCount=120`.

## Maximum Savings evidence

See [cache-aware-v0.6.0.md](cache-aware-v0.6.0.md): 20 universal eligible cases, median `80.51%`, minimum `80.01%`, exact retrieval `20/20`, requested preview fact `20/20`.

Provider-billed cache cost remains intentionally unclaimed in this isolated proof because no paid model credential was copied. Cold/warm cost in the universal benchmark is explicitly modeled.
