# Context Saver 1.0 - implementation plan

Date: August 3, 2026  
Spec: `docs/superpowers/specs/2026-08-03-context-saver-1-0-design.md`  
Target: `1.0.0-rc.1`, then `1.0.0`

## Execution rules

- Use only fictional local fixtures and generated data.
- Never copy production prompts, customer content, credentials, identifiers, or tool results into tests or repository history.
- Add or update tests before each behavioral change.
- Preserve internal node type IDs, legacy operation values, old field names, and old workflow imports.
- Run focused tests after each task and the complete local gate before release packaging.
- Never accept a candidate with failed integrity checks or non-positive net savings.
- Keep provider-backed tests optional and outside the normal local gate.

## Phase 1 - compatibility and shared contracts

### Task 1 - version and compatibility matrix

Update package metadata and create tests that instantiate every legacy node version and load representative legacy parameter sets. Add a compatibility manifest mapping old display names, versions, fields, operations, and profile aliases to 1.0 behavior.

Done when old versions still instantiate, legacy aliases resolve identically, and new display names do not change internal type IDs.

### Task 2 - shared execution telemetry

Replace model-only lookup with a generic execution registry supporting optimizer calls, data optimization, memory, storage, handoff, and exact lookup. Add list-by-execution, list-by-node, aggregation, TTL pruning, and bounded record counts.

Done when Savings Report can aggregate all calls in one execution without node names or a Code collector.

### Task 3 - automatic policy contracts

Add selected profile, effective profile, risk signals, downgrade reasons, per-category budgets, storage capability, lookup capability, structured-output ambiguity, and cache signals to the policy contract.

Done when the same input produces the same effective policy and every downgrade has an explicit reason.

## Phase 2 - Agent Optimizer

### Task 4 - System Prompt Compiler

Create deterministic prompt units, exact section deduplication, safe whitespace normalization, protected-section handling, stable/dynamic split, and stable-prefix fingerprinting. Do not semantically rewrite unique instructions in standard profiles.

Done when protected prompt text and current user messages remain exact, repeated sections shrink, and unique prompts fall back without negative savings.

### Task 5 - adaptive per-call optimization

Integrate risk policy with the model wrapper. Protect high-risk tasks, forced tools, ambiguous structured output, code, exact quotes, and active tool sequences. Apply profile as a maximum strength and report selected/effective profile.

Done when Maximum Savings safely downgrades per call and deterministic quality gates remain green.

### Task 6 - automatic tool and result handling

Improve schema canonicalization, high-confidence lazy tool loading, required/recent tool retention, completed-result virtualization, lookup detection, and category budgets. Keep all tools on low confidence or ambiguity.

Done when clear synthetic intent reduces schemas by at least 60%, ambiguous intent keeps all tools, and active calls remain exact.

### Task 7 - Agent Optimizer v3 UX

Add version 3 with display name Agent Optimizer. Automatic mode shows only Run mode and Optimization profile. Group advanced controls by Prompt and history, Tools, Large results, Cache, Security, and Token budgets. Keep versions 1 and 2 behavior compatible.

Done when node-description tests verify labels, descriptions, defaults, display conditions, and legacy fields.

## Phase 3 - specialist nodes

### Task 8 - Data Optimizer v3

Rename the new picker display to Data Optimizer, keep legacy operations, simplify default fields, move Build Agent Context logic to shared handoff helpers, and retain all deterministic content compressors and reversible packing.

Done when JSON, API, RAG, HTML, logs, text, code, and static-prompt cases pass with Simple output excluding originals.

### Task 9 - Agent Handoff node

Add a new node that accepts agent output, next-agent task, optional facts/state/resources, and profile. Emit a stable compact handoff contract with exact evidence references and telemetry.

Done when sequential synthetic agents do not repeat full prompts, history, or completed tool payloads and protected facts remain exact.

### Task 10 - Session Memory v2

Add an Update and build context default operation, automatic message classification, selected/effective profile reporting, session-owner isolation, and telemetry. Preserve legacy operations and filesystem sessions.

Done when one node can update and emit model-ready context while old Update plus Build workflows remain valid.

### Task 11 - Context Storage v3 and Exact Lookup v3

Add owner/session binding, pluggable storage interfaces, encrypted envelopes, tamper checks, and consistent storage references. Rename picker displays to Context Storage and Exact Lookup while preserving internal IDs and legacy receipts.

Done when wrong owner/session, expired resources, tampered ciphertext, blocked fields, and retrieval-budget violations cannot expose content.

### Task 12 - Savings Report v3

Add Current execution as the default operation. Aggregate per-agent calls, data, memory, handoff, storage, retrieval, provider usage, cache, quality fallback, and net savings. Keep existing analyze, aggregate, compare, and cost operations.

Done when a multi-agent synthetic workflow reports totals without helper code and Simple output stays small.

## Phase 4 - scalable and secure storage

### Task 13 - encrypted filesystem envelopes

Implement optional AES-256-GCM encryption with key IDs, random nonces, authentication tags, versioned envelopes, and plaintext-hash verification. Keep unencrypted legacy resources readable when allowed.

Done when encrypted round-trip, wrong key, tamper, key rotation metadata, secret blocking, and path traversal tests pass.

### Task 14 - Redis provider

Add a Context Saver Redis credential and Redis resource, memory, fingerprint, and telemetry storage with namespaced keys, TTL, bounded indexes, atomic set-if-absent reuse, and TLS options.

Done when local Redis contract tests pass or skip with an explicit unavailable status, and filesystem remains the zero-credential default.

### Task 15 - high-concurrency isolation

Run at least 100 parallel synthetic sessions across resource, memory, and retrieval operations. Verify owner isolation, deterministic reuse within one owner, no cross-session reads, bounded registries, and complete TTL cleanup.

Done when every isolation assertion passes without production data or provider calls.

## Phase 5 - documentation and local workflow evidence

### Task 16 - node documentation and examples

Write English and Brazilian Portuguese quick starts, one page per node and field, connection diagrams, decision guide, migration map, actionable errors, and importable synthetic examples.

Done when docs cover every v3/v2 field and no example contains production-derived content.

### Task 17 - synthetic boss benchmarks

Create two generated fixtures:

- Long-context boss: one fictional analytics agent, invented large prompt, growing history, repeated tool calls, and generated tabular output.
- Tool-heavy boss: two fictional agents, 14 invented tools, clear and ambiguous tasks, parallel calls, and branching.

Done when Quality First, Balanced, Maximum Savings, exact retrieval, fallback, cache, handoff, and total-report assertions pass.

### Task 18 - local n8n runtime workflows

Build importable baseline and optimized workflows using mock chat models and mock tools. Execute locally and capture provider-shaped token telemetry without external APIs.

Done when the first message demonstrates real message-payload reduction, outputs remain equivalent for golden facts, and Savings Report totals match recorded calls.

## Phase 6 - release gates

### Task 19 - complete local gate

Add `check:local` and `benchmark:regression` scripts. Run unit, compatibility, runtime, security, concurrency, benchmarks, build, lint, package validation, and sanitized-export scans.

Required gates:

- protected facts, active tool integrity, JSON round-trip, exact requested retrieval, current message identity, and session isolation: 100%;
- non-positive net candidates accepted: zero;
- tool-heavy clear intent schema reduction: at least 60%;
- tool-heavy ambiguous intent: all tools retained;
- long-context full-request reduction: at least 30%;
- Balanced median eligible reduction: 35-60%;
- Maximum Savings median eligible reduction: 60-85% for recoverable large content.

### Task 20 - release candidate and stable package

Update version, changelog, package metadata, node JSON details, icons, README, and generated PDFs. Pack `1.0.0-rc.1`, install it in local n8n, execute synthetic workflows, then prepare `1.0.0` after all required gates pass.

No npm publication, remote workflow mutation, or provider-backed test occurs without separate explicit authorization.

