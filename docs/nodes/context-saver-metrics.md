# Context Saver Metrics

## Purpose

Show whether optimization produced real savings and whether the chosen profile should be kept or adjusted.

## How it measures

The node normalizes optimizer estimates and provider-reported usage. It separates four scopes: eligible content, complete request, provider input/cache/output, and net savings after compressor, verifier, and retrieval overhead.

## Use it when

- Comparing baseline and optimized branches.
- Validating a workflow before production rollout.
- Monitoring retrieval overhead, fallbacks, or provider cache impact.

## Do not use it when

- You need token reduction itself; Metrics observes but does not compress.
- Provider usage is unavailable and you require billing-exact cost.
- Prices have not been configured but you expect financial estimates.

## Recommendations

The Simple output can recommend measuring provider usage, adding a Retriever, reducing retrieval overhead, adjusting the profile, or keeping the current policy. Estimated values remain labeled; provider values are never inferred.

## Example

```text
Baseline Agent ----\
                    -> Context Saver Metrics (Compare Model Runs)
Optimized Agent ---/
```

Use Detailed Diagnostics for development. In production, Simple output prevents large telemetry objects from becoming new Agent context.
