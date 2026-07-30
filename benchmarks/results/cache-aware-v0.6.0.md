# Token Saver 0.6.0 — cache-aware benchmark

## Maximum Savings

- Eligible cases: 20
- Median eligible reduction: 80.51%
- Minimum eligible reduction: 80.01%
- Cases at or above 70%: 20/20
- Exact Retriever checks: 20/20
- Requested facts kept in preview: 20/20

## Cache strategies

| Strategy | Cold input | Warm input | Warm cached | Warm cost vs baseline | Warm decision |
|---|---:|---:|---:|---:|---|
| automatic_hybrid | 2254 | 2254 | 1577 | 0% | preserve_stable_prefix |
| cache_priority | 2254 | 2254 | 1577 | 0% | preserve_stable_prefix |
| token_reduction_priority | 2146 | 2146 | 1502 | -4.85% | reduce_dynamic_blocks |
| ignore_cache_signals | 2146 | 2146 | 1502 | -4.85% | legacy_profile_only |

Cache cost is modeled, not provider-billed: 70% warm cache hit and cached-input price at 10% of regular input.
Maximum Savings percentages apply only to eligible tool/RAG/API/log context, not the full Agent request.

## Acceptance

- PASS — medianEligibleSavingsAtLeast80
- PASS — atLeast95PercentCasesAbove70
- PASS — exactRetrieval100Percent
- PASS — requestedPreviewFacts100Percent
- PASS — automaticWarmCostNotAboveBaseline
