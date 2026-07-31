# Context Saver v0.9 semantic and quality benchmark

Status: **PASS**

| Case | Before | After | Net saved | Strategy |
|---|---:|---:|---:|---|
| Semantic opt-in | 2631 | 1252 | 1339 | hybrid |
| Judge rejection fallback | 675 | 20 | 634 | deterministic |

- Semantic adapter called once and protected recent context remained exact.
- Judge called once; rejection used deterministic fallback without a second paid retry.
- Strict verification rejected changed negation/polarity.
- Fast verification rejected a byte change inside a protected block.
- No provider or paid LLM call was made.
