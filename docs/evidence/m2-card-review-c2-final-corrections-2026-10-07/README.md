# M2 Card Review C2 Final Corrections Evidence (2026-10-07)

## Overview & Scope Completion Summary

This package delivers the verified, final planning proof and contract model for Milestone 2, Card Review C2 (Library-Wide Review Due & History Discovery). It executes all requirements in [`docs/M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md) and resolves all findings documented in [`docs/M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md).

All work remains strictly planning and proof artifacts on branch `codex/m2-card-review-c2-scope`. **Production C2 implementation remains gated behind independent scope acceptance and owner approval of proposed defaults C2-D1 through C2-D9.**

---

## 1. Issue-to-Test Mapping (C2-R7 through C2-R11 & Remaining R4)

| Finding ID | Root Cause in Completion Model | Resolution in Final Corrections Model | Verification & Tests |
|---|---|---|---|
| **C2-R7** (P1): Declared filters not implemented | Model destructured material metadata `reviewStatus` instead of card spaced-repetition `statusFilter` (`all`, `due_today`, `new_only`); `getLibraryRecentReviews` ignored `materialId` and `topic` options. | Implemented typed `statusFilter`: `all` (due or new), `due_today` (`totalDueCount > 0`), `new_only` (`totalDueCount === 0 && newCount > 0`). Filter applied after deriving current card counts and before urgency ranking; history filters executed in SQL before `LIMIT` and composed with keyset pagination. | Diagnostic 3 Tests 1–4 (all 4 pass); `proof.test.mjs` Assertion 4 (both pass). |
| **C2-R8** (P1): Cached cursor summaries escape query/clock ownership | Pending batch `rem` cursor served client-carried summaries directly without revalidating against live DB, resurrecting deleted materials, leaking switched filters, and ignoring midnight clock shifts. | Cursors are kind-specific, versioned tokens encoding normalized query and clock identity; rejects mismatches with `STALE_CURSOR`. Pending batches encode material IDs (`remIds`) and revalidate against live DB on continuation, dropping deleted or content-cleared materials. | Diagnostic 3 Tests 5–8 (all 4 pass); `proof.test.mjs` Assertion 5 (all 4 pass). |
| **C2-R9** (P1): Controller drops history & locks/stales | Controller deduped by `materialId` before event `id` (collapsing multiple events from one material); synchronous throw in reader left rejected promise in `busyPromise`; `onReset` allowed stale summaries to block fresh reads; `setFilter` didn't reset `isLoading`. | Dedicated dedup identity: `item.id` for history rows, `item.materialId` for due rows. Synchronous reader call wrapped in try/catch to release lock immediately on throw. `onReset` replaces retained summaries with fresh authoritative data. Invalidation immediately resets `isLoading = false`. | Diagnostic 3 Tests 9–12 (all 4 pass); `proof.test.mjs` Assertion 6 (all 4 pass). |
| **C2-R10** (P2): Historical context & inspection incomplete | C1 parser `none` result collapsed valid empty guide sets `[]` into `unavailable`; returned event payload discarded parsed prior/next state, generation, and honest intervals. | Retains raw provenance around parser: `ai_study_sets.flashcards_json === '[]'` yields `contentStatus = 'valid_empty'`, distinct from missing set `contentStatus = 'unavailable'`. History rows expose parsed `priorState` and `nextState` objects directly, preserving honest intervals without invention. File-backed DB test extended to persist and verify history roundtrip. | Diagnostic 3 Tests 13–14 (both pass); `proof.test.mjs` Assertion 7 (both pass). |
| **C2-R11 / R4** (P2): Non-enforcing mutation gate & unmeasured claims | Old `runMutants.mjs` caught all exceptions as success and wrote literal 0 even on mutant survival; benchmark breakdown sorted fabricated `dummyList`; worst-case 125,000 card budget lacked explicit byte/card ceilings. | Built `proof/runMutants.mjs` running real isolated child processes against baseline and 4 mutants (wrong version, time boundary, cursor tie, owner lock); all 4 fail with `AssertionError` (exit 1). Built `proof/mutantSurvivalControl.mjs` proving verifier fails if mutant assertion is disabled. Instrumented actual candidate summaries in benchmark pipeline breakdown. Established explicit worst-case budget analysis with proposed safety caps. | `proof/runMutants.mjs` (exit 0); `proof/mutantSurvivalControl.mjs` (exit 0); `proof.test.mjs` Assertion 8 (both pass); `receipts/negative-controls.txt` & `.exit`. |

---

## 2. Frozen Diagnostics Results (All Three Unchanged & Passing)

All three reviewer diagnostics were executed unmodified using `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <path>` with `C2_REVIEW_MODEL`:

### A. Diagnostic 1 (Review 2026-10-07)
- **Path**: `docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`
- **Result**: **9 / 9 passed (0 failed)**. Exit code: **0**.
- **Receipt**: [`receipts/prior-frozen.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/prior-frozen.txt), [`receipts/prior-frozen.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/prior-frozen.exit).

### B. Diagnostic 2 (Re-review 2026-10-07)
- **Path**: `docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`
- **Result**: **12 / 12 passed (0 failed)**. Exit code: **0**.
- **Receipt**: [`receipts/rereview-frozen.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/rereview-frozen.txt), [`receipts/rereview-frozen.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/rereview-frozen.exit).

### C. Diagnostic 3 (Completion Review 2026-10-07)
- **Path**: `docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`
- **Result**: **16 / 16 passed (0 failed)**, including both controls. Exit code: **0**.
- **Receipt**: [`receipts/completion-diagnostic.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/completion-diagnostic.txt), [`receipts/completion-diagnostic.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/completion-diagnostic.exit).

---

## 3. Comprehensive Proof Test Suite (`proof.test.mjs`)

- **Command**: `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/proof/proof.test.mjs`
- **Result**: **24 / 24 passed across 8 suites (0 failed)**. Exit code: **0**.
- **Suites Covered**:
  1. Version-Owned Discovery & Content Replacement (5 tests)
  2. Urgency Ranking & Time Boundaries (2 tests)
  3. Keyset Pagination, History Enriched Payload & Caps (3 tests)
  4. Filters: Spaced Repetition & History (2 tests)
  5. Cursor Ownership & Revalidation (4 tests)
  6. Asynchronous Deferred Read Controller (4 tests)
  7. Historical Context Provenance & File-Backed Reopen (2 tests)
  8. Mutation Verifier and Survival Control (2 tests)
- **Receipt**: [`receipts/proof-run.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/proof-run.txt), [`receipts/proof-run.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/proof-run.exit).

---

## 4. SQL Query & Pipeline Audit (`query-audit.mjs`)

Executed on a 5,000-material / 10,000-event synthetic database on Node v22.23.3 and SQLite 3.53.4:

| Query Pipeline | Results Returned | SQL Calls | Returned SQL Rows | Est. JSON UTF-8 Bytes |
|---|---|---|---|---|
| **Due Page 1** (limit 50) | 50 | 3 | 1,061 | 682 KB |
| **Due Page 2 Continuation** (revalidation) | 50 | 3 | 711 | 507 KB |
| **Due Filtered** (`due_today`, topic) | 50 | 3 | 1,065 | 687 KB |
| **History Page 1** (limit 20) | 20 | 2 | 41 | 66 KB |
| **History Page 2 Continuation** | 20 | 2 | 41 | 55 KB |
| **History Filtered** (topic) | 20 | 2 | 41 | 61 KB |

Receipts: [`receipts/query-audit.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/query-audit.txt), [`receipts/query-audit.json`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/query-audit.json), [`receipts/query-audit.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/query-audit.exit).

---

## 5. Performance Benchmark & Worst-Case Budgets (`benchmark.mjs`)

Benchmarked across 100, 2,500, and 5,000 material scales on Apple Silicon (darwin arm64, Node v22.23.3, SQLite 3.53.4):

| Scale | Material Count | Event Count | Due Page 1 p50 (target 10 ms) | Due Page 1 p95 | Due Cont. p50 | History Page 1 p50 (target 15 ms) | History Page 1 p95 |
|---|---|---|---|---|---|---|---|
| **Small** | 100 | 200 | **2.81 ms** (PASS) | 5.13 ms | 0.66 ms | **1.14 ms** (PASS) | 1.46 ms |
| **Medium** | 2,500 | 5,000 | **6.61 ms** (PASS) | 6.94 ms | 4.38 ms | **4.58 ms** (PASS) | 5.43 ms |
| **Large** | 5,000 | 10,000 | **7.43 ms** (PASS) | 8.28 ms | 4.37 ms | **9.62 ms** (PASS) | 11.76 ms |

### Representative Stress Testing:
- **Standard 500-Card Set**: 500 cards JSON parse, canonicalization, and SHA-256 derivation: **p50 = 0.64 ms**, max = 1.08 ms.
- **Unicode Max-Text 500-Card Set**: 500 cards with accents, Japanese kanji, and max text (~183 KB JSON): **p50 = 1.15 ms**, max = 1.55 ms.

### Explicit Worst-Case Budget Analysis:
- **Theoretical Upper Bound**: 250 candidates × 500 cards = 125,000 cards. At ~250 bytes per card, this represents ~31.25 MB raw JSON. Synchronous V8 JSON parsing and hashing across 125,000 cards would require an estimated 250–500 ms (unexecuted upper bound).
- **Proposed Safety Caps**:
  - `candidateBatchBudget`: 250 materials.
  - `maxBatchCardsBudget`: 2,500 cards.
  - `maxBatchRawJsonBytesBudget`: 2 MB (2,097,152 bytes).
  - When either card or byte budget is exceeded during batch scanning, the reader terminates the current candidate batch and yields a valid continuation cursor, guaranteeing fair forward progression and preventing memory/IPC exhaustion.
- **IPC & WebKit Rendering**: Explicitly marked **UNMEASURED**. Node/SQLite in-process measurements do not establish Desktop Tauri IPC or WebKit render latency.

Receipts: [`receipts/benchmark-run.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/benchmark-run.txt), [`receipts/benchmark-run.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/benchmark-run.exit), [`results.json`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/results.json).

---

## 6. Semantic Mutation Verifier & Survival Control (`runMutants.mjs`, `mutantSurvivalControl.mjs`)

- **Verifier Architecture**: `proof/runMutants.mjs` executes baseline and each mutant in isolated child processes (`spawnSync`), requiring exit code 0 on baseline and exit code 1 with an intended `AssertionError` on each mutant. Any mutant survival or unexpected tooling crash causes the verifier itself to fail.
- **Mutants Tested**:
  1. `mutant_wrong_version`: Relies on `is_active=1` instead of current raw content. Killed with `AssertionError: Retired version due cards must be excluded!`.
  2. `mutant_time_boundary`: Uses 24h window instead of local midnight. Killed with `AssertionError: Card due tomorrow after midnight must NOT be counted as due today!`.
  3. `mutant_cursor_tie`: Keyset cursor without ID tiebreaker. Killed with `AssertionError: Broken cursor dropped tied timestamp events!`.
  4. `mutant_owner_lock`: Stale read resolution illegally resets `busyPromise`. Killed with `AssertionError: Held read B must retain busy lock while awaiting settlement!`.
- **Survival Control**: `proof/mutantSurvivalControl.mjs` runs the verifier with assertions disabled. The verifier correctly detects mutant survival and throws `MUTATION VERIFIER FAILURE: Mutant 'mutant_wrong_version' survived! Process exited with code 0.`, verifying that the mutation test runner actually enforces assertion failure.

Receipts: [`receipts/negative-controls.txt`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/negative-controls.txt), [`receipts/negative-controls.exit`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/receipts/negative-controls.exit).

---

## 7. Migration & Upgrade Assessment

- **Shipped Schema Baseline**: Shipped migrations `0001` through `0012` provide all required database structures (`card_versions`, `card_items`, `card_review_state`, `card_review_events`, `card_review_operations`).
- **No Additional C2 Migration**: Production C2 requires **no additional database migration**.
- **Optional Index Variant**: An optional index `CREATE INDEX idx_materials_priority_updated ON study_materials(priority, updated_at DESC, id ASC)` is documented in [`optional_migration_0013.sql`](file:///Users/rickymac/code/Flight-training-pr70-integration/docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/optional_migration_0013.sql) as an **UNAPPROVED COMPARISON VARIANT ONLY**. Baseline C2 operates within budget on the shipped schema.
- **Schema-11 Restore Property**: Restoring a database from schema 11 upgrades to schema 12 via shipped migration `0012_card_reviews.sql` (which performs DDL). C2 adds no further DDL upon restore.
