# Context Saver v2 profile benchmark

Status: **PASS**

| Profile | Eligible median | Full-request median | Net median | Quality facts | JSON round-trip | Exact retrieval | Tool IDs |
|---|---:|---:|---:|---:|---:|---:|---:|
| Quality | 25.11% | 21.88% | 25.11% | 100% | 100% | 100% | 100% |
| Balanced | 59.73% | 52.06% | 57.05% | 100% | 100% | 100% | 100% |
| Savings | 80.33% | 70.54% | 78.26% | 100% | 100% | 100% | 100% |

## Method

- 12 deterministic cases per profile: JSON/API, RAG, and logs.
- Eligible savings measure only content the policy may optimize.
- Full-request savings add 600 protected tokens to show dilution by system/recent context.
- Net savings subtract exact-retrieval tokens. No compressor model was used.
- Provider usage is intentionally unavailable because the benchmark makes no paid LLM call.
- Every requested marker had to remain inline; every required exact retrieval, JSON round-trip, and tool-call ID check had to pass.

These medians describe this corpus, not guaranteed savings for arbitrary workflows.
