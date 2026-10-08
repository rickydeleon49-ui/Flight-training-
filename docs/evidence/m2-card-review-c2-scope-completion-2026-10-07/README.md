# M2 Card Review C2 Scope Completion Evidence (2026-10-07)

## Overview & Scope Completion Summary

This directory contains the completed and verified planning proof package for Milestone 2, Card Review C2 (Library-Wide Review Due & History Discovery), executing the requirements of [`docs/M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md) and resolving all findings from [`docs/M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md).

All changes are strictly planning and proof artifacts. **Production C2 implementation remains gated behind independent scope acceptance and recorded owner choice.**

---

## 1. Issue-to-Test Mapping (C2-R1, C2-R4, C2-R5, C2-R6)

| Finding ID | Root Cause in Submitted Model | Resolution in Completion Package | Verification & Tests |
|---|---|---|---|
| **C2-R6** (P1) | Duplicated pure logic drifted: card text lengths were 2000/4000/2000 instead of 1000/2000/1000; surrogate regex differed; ladder step 3 was 14 days instead of 16 days. | Directly import production TypeScript modules via Node 22 (`src/logic/cardIdentity.ts`, `src/logic/cardScheduler.ts`, `src/logic/localDay.ts`) and export identical pure contracts. | `new-diagnostic.test.mjs` Tests 1–6 (all 6 pass); `proof.test.mjs` (all pass). |
| **C2-R4** (P1) | `createDisposableDb` added unapproved `idx_materials_priority_updated` absent from shipped migrations; due & history reads looped `.get()` per candidate/material (124 & 21 SQL calls). | Baseline DB executes actual shipped migrations 0001–0012 without extra indexes; candidate reads perform real batched SQL reads (`IN (?, ..., ?)`) reducing SQL calls to 3 for due and 2 for history. | `new-diagnostic.test.mjs` Test 7 (passes); `query-audit.mjs` (3 calls for due, 2 for history); `receipts/query-audit.txt`. |
| **C2-R1** (P1) | Missing urgency ranking within batch; uncapped `candidateBatchBudget`/`limit`; candidate cursor did not preserve undisplayed batch items; single-page summary conflated with library totals. | Implemented within-batch urgency ranking (Again due -> Day due -> New only -> Tiebreakers); hard-capped budget to 250; cursor encodes leftover undisplayed batch items (`rem`); summary labeled `isPageLocal: true`. | `new-diagnostic.test.mjs` Tests 8 & 9 (both pass); `prior-frozen` Tests 1–3 (all pass); `proof.test.mjs` (ranking and caps pass). |
| **C2-R5** (P1) | Controller lacked synchronous busy lock (duplicate loads on same turn); `setFilter` did not clear previous rows; no held read promise isolation; no executable close/reopen or schema-11 upgrade test. | Built `DeferredReadController` with synchronous `busyPromise`, synchronous `results = []` on `setFilter`, generation bump on in-flight reads; wrote file-backed close/reopen roundtrip test and genuine schema-11 to 12 migration test. | `new-diagnostic.test.mjs` Tests 10 & 11 (both pass); `proof.test.mjs` Tests for busy lock, held promises, file-backed DB, and schema-11 upgrade (all pass). |

---

## 2. Frozen Diagnostics Results

Both diagnostics were run unmodified against `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/proof/contractModel.mjs`:

### A. Prior Frozen Diagnostic (`scratch/diagnostic.test.mjs`)
- **Command**:
  ```bash
  C2_REVIEW_MODEL="$(pwd)/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/proof/contractModel.mjs" \
  /opt/homebrew/opt/node@22/bin/node --test scratch/diagnostic.test.mjs
  ```
- **Result**: **9 / 9 passed (0 failed)**. Exit code: **0**.
- **Receipt**: [`receipts/prior-frozen.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/prior-frozen.txt), [`receipts/prior-frozen.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/prior-frozen.exit).

### B. New Frozen Diagnostic (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`)
- **Command**:
  ```bash
  C2_REVIEW_MODEL="$(pwd)/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/proof/contractModel.mjs" \
  /opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs
  ```
- **Result**: **12 / 12 passed (0 failed)**. Exit code: **0**.
- **Baseline Comparison**: Improved from 1 pass / 11 fail on initial review to **12 / 12 pass**.
- **Receipt**: [`receipts/new-diagnostic.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/new-diagnostic.txt), [`receipts/new-diagnostic.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/new-diagnostic.exit).

---

## 3. Comprehensive Proof Test Suite (`proof.test.mjs`)
- **Command**:
  ```bash
  /opt/homebrew/opt/node@22/bin/node --test docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/proof/proof.test.mjs
  ```
- **Result**: **21 / 21 passed across 6 test suites (0 failed)**. Exit code: **0**.
- **Coverage**:
  1. Version-Owned Discovery & Content Replacement (5 tests)
  2. Urgency Ranking & Time Boundaries (2 tests)
  3. Keyset Pagination, History Enriched Payload & Caps (3 tests)
  4. Asynchronous Deferred Read Controller & Held Requests (5 tests)
  5. File-Backed Reopen/Restore & Schema-11 Upgrade (3 tests)
  6. Negative Controls & Semantic Failure Verification (3 tests)
- **Receipt**: [`receipts/proof-run.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/proof-run.txt), [`receipts/proof-run.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/proof-run.exit).

---

## 4. SQL Call & Row Audit (`query-audit.mjs`)
Executed on the 5,000-material scale fixture with 10,000 events:

| Metric | Review Due Query (50 results) | History Query (20 results) |
|---|---|---|
| **SQL Calls** | **3 calls** (down from 124 calls!) | **2 calls** (down from 21 calls!) |
| **Returned SQL Rows** | 1,061 rows | 41 rows |
| **JSON Bytes Estimate** | ~679 KB | ~65 KB |
| **Executed SQL Statements** | [1] Candidate headers scan (LIMIT 251)<br>[2] Batched `ai_study_sets` raw cards (`IN (...)`)<br>[3] Batched `card_review_state` (`IN (...)`) | [1] Keyset `card_review_events` query (LIMIT 21)<br>[2] Batched `ai_study_sets` distinct raw cards (`IN (...)`) |

Receipt: [`receipts/query-audit.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/query-audit.txt), [`receipts/query-audit.json`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/query-audit.json).

---

## 5. Performance Benchmark (`benchmark.mjs`)
Executed on Apple Silicon (darwin arm64, Node v22.23.3, SQLite 3.53.4) across three scales:

| Scale | Material Count | Event Count | Due Page 1 p50 (target 10 ms) | Due Page 1 p95 | History Page 1 p50 (target 15 ms) | History Page 1 p95 |
|---|---|---|---|---|---|---|
| **Small** | 100 | 200 | **2.95 ms** | 5.05 ms | **1.14 ms** | 1.46 ms |
| **Medium** | 2,500 | 5,000 | **6.82 ms** | 7.57 ms | **4.58 ms** | 5.56 ms |
| **Large** | 5,000 | 10,000 | **7.93 ms** | 8.71 ms | **9.72 ms** | 11.72 ms |
| **Adversarial** | 500-card set | N/A | **0.56 ms** (p50 parse + hash) | 0.99 ms (p95) | N/A | N/A |

### Latency Budget Status & Distinction:
- **In-process SQLite & Node runtime**: **PASS** (Due: 7.93 ms <= 10 ms; History: 9.72 ms <= 15 ms).
- **Desktop Tauri IPC serialization**: **UNMEASURED** (Estimated ~3–8 ms roundtrip overhead).
- **WebKit webview rendering**: **UNMEASURED** (Requires production UI implementation).

Receipt: [`receipts/benchmark-run.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/benchmark-run.txt), [`receipts/benchmark-run.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/benchmark-run.exit), [`results.json`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/results.json).

---

## 6. Semantic Mutants & Negative Controls (`runMutants.mjs`)
Exercised representative mutants in isolated runs to verify assertion strength:
1. **Mutant 1 (Stale Version Assumption)**: Query relying on `is_active=1` instead of current raw content failed assertion `Assertion Error: MUTANT FAILED: Retired version due cards were incorrectly included!`.
2. **Mutant 2 (Tied Keyset Pagination)**: Cursor without event ID tiebreaker failed assertion `Assertion Error: MUTANT FAILED: Broken cursor dropped tied timestamp events!`.
3. **Mutant 3 (Candidate Progression Cutoff)**: Candidate scan dropping items past 250 failed assertion `Assertion Error: MUTANT FAILED: Older material past 250 was dropped by broken progression!`.

Receipt: [`receipts/negative-controls.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/negative-controls.txt), [`receipts/negative-controls.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/receipts/negative-controls.exit).

---

## 7. Delivery File Inventory & Checksums

Prior evidence packages (`m2-card-review-c2-scope-2026-10-07/` and `m2-card-review-c2-scope-corrections-2026-10-07/`) remain byte-for-byte untouched.
All completion artifacts are rooted in:
`docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
