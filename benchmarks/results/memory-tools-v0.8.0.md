# Context Saver v0.8 memory and tools benchmark

Status: **PASS**

| Surface | Before | After | Saved | Reduction | Integrity |
|---|---:|---:|---:|---:|---:|
| Growing conversation memory | 11042 | 854 | 10188 | 92.27% | 100% |
| Tool schemas sent to model | 4926 | 827 | 4099 | 83.21% | 100% |

## What was verified

- Memory sends only the current fact, protected corrections/pending work, structured state, summary, and six recent messages.
- All 120 exact messages and superseded fact versions remain recoverable from the scoped archive.
- The model binding received 4 of 24 tools for a clear calendar task; the required tool and original tool objects were preserved.
- Low-confidence, Quality, Cache Priority, and ambiguous structured-output fallbacks are covered by the automated test suite and keep all tools.
- No paid provider call or semantic compressor was used. Percentages are estimated for this deterministic corpus, not guaranteed for every workflow.
