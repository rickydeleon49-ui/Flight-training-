# M2 Card Reviews C2 — Read-Pipeline Corrections Evidence Package (7 October 2026)

## Overview & Scope Summary

This evidence package completes the focused read-pipeline planning corrections required by the reviewer in `docs/M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md` and `docs/M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md`.

All four prior evidence packages are preserved byte-for-byte:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/`
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`

All four frozen diagnostic test suites pass **100% unchanged**:
- **Diagnostic 1** (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed** (Exit: 0).
- **Diagnostic 2** (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed** (Exit: 0).
- **Diagnostic 3** (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed** (Exit: 0).
- **Diagnostic 4** (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).

The comprehensive proof test suite (`proof.test.mjs`) passes **32 / 32 tests** (Exit: 0).

---

## Core Corrections Implemented

### 1. R8 Continued: Pending Stream Consumption & Strict Cursor Tokens
- **Consumption Invariant**: Resolved the numeric indexing bug (`remIds.slice(limit)`). The reader now tracks evaluated and discarded IDs in candidate order (`consumedCount`). Only truly unvisited candidates are retained in `remLeftIds = remIds.slice(consumedCount)`. Deleted rows, empty flashcard arrays, and ineligible items are discarded rather than leaving stale duplicates in continuation pages. Full traversals after middle/prefix stream mutation strictly match expected IDs (e.g. `['a', 'c', 'd']`).
- **Kind-Specific Bounded Cursor Tokens**:
  - `due` cursors require version `v === 1`, `type === 'due'`, and mandatory normalized context: `ctx: { topic, statusFilter, nowUtc, nextLocalMidnightUtc }`. Cursors missing `ctx` or containing mismatched filter/clock parameters explicitly throw with errors matching `/CURSOR|STALE|INVALID/i`.
  - `history` cursors require version `v === 1`, `type === 'history'`, keyset fields `t, id`, and mandatory filter ownership context: `ctx: { materialId, topic }`. Using a cursor generated under filter A against query filter B explicitly throws `STALE_CURSOR`.

### 2. R9 Continued: Authoritative Refresh & Synchronously Owned Reader Lock
- **Authoritative Refresh on Invalidation**: Upon reset (`onReset(materialId)`), content change, or deletion, the controller starts a fresh generation with empty results (`this.results = []`), reset cursor (`this.cursor = null`), and idle status. Page 1 of the new generation replaces old entries, adopting fresh urgency ordering and eliminating surviving no-longer-actionable rows.
- **Synchronously Owned Reader Lock**: The controller creates a unique operation token (`Symbol('op')`) and sets `this.busyPromise` *before* invoking `this.reader`. In catch/finally handlers, `isLoading` and `busyPromise` are only cleared if the operation token and generation match the active state. When operation A synchronously invalidates and starts a genuinely held operation B before throwing, A's throw cannot clear B's loading or busy lock. Duplicate calls during held B return `heldB` without allocating redundant read requests.

### 3. R4 Continued: Executable Resource Budgets & Preflight Checks
- **Executable Parameter Bounds**: The reader accepts and enforces `maxBatchCardsBudget` (default: 2,500) and `maxBatchRawJsonBytesBudget` (default: 2,097,152 bytes = 2 MiB).
- **SQLite Byte-Length Preflight**: Before reading large raw `flashcards_json` strings, SQLite executes `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len FROM ai_study_sets WHERE source_material_id IN (...)`. Candidates are admitted in order until the raw JSON byte ceiling is reached. Only admitted candidate materials have their full `flashcards_json` transferred from SQLite.
- **Card Budget Enforcement**: As parsed card versions are processed, card counts accumulate. If admitting the next material would exceed `maxBatchCardsBudget`, evaluation terminates for the current batch. All unevaluated candidates retain forward continuation via `nextCursor` pointing to the last evaluated candidate key.
- **Single-Set Admission Lane**: If the first candidate in a batch exceeds the requested batch budget, it is admitted under the single-set lane to ensure terminating forward progress without empty-page livelock.
- **Accurate Work Counters**: The returned `summary` includes `scannedCandidates`, `evaluatedCandidates`, `evaluatedCards`, `rawBytesTransferred`, and `isPageLocal: true`.

### 4. Owner Mutation Verifier Repair
- **Independently Held A/B Fixture**: Fixed `runMutants.mjs` and `mutant_owner_lock` to share an independently held A/B fixture where operation A completes while operation B remains pending.
- **Baseline Assertions**: Baseline verifies that `ctrl.busyPromise !== null` and `ctrl.isLoading === true` while B is pending, exiting with 0.
- **Mutant Detection**: In `mutant_owner_lock`, simulating stale completion clearing the lock causes an `AssertionError`, exiting with code 1.
- **Survival Control**: Running `mutantSurvivalControl.mjs` with assertions disabled confirms that surviving mutants cause verifier failure matching `/MUTATION VERIFIER FAILURE: Mutant .* survived!/` (Exit: 0).

---

## Benchmark & Audit Performance Summary

| Metric | 100 Materials Scale | 2,500 Materials Scale | 5,000 Materials Scale |
| :--- | :--- | :--- | :--- |
| **Review Due Page 1 (limit 50)** | **p50 = 3.22 ms** (p95 = 5.89 ms) | **p50 = 6.53 ms** (p95 = 6.84 ms) | **p50 = 7.31 ms** (p95 = 7.97 ms) |
| **Review Due Page 2 Cont.** | **p50 = 0.98 ms** | **p50 = 1.79 ms** | **p50 = 1.79 ms** |
| **History Page 1 (limit 20)** | **p50 = 1.17 ms** | **p50 = 4.56 ms** | **p50 = 9.93 ms** |
| **Full Discovery Traversal** | **p50 = 3.96 ms** (2 pages) | **p50 = 119.41 ms** (47 pages) | **p50 = 257.93 ms** (92 pages) |
| **Preflight Byte Check** | p50 = 0.07 ms | p50 = 0.23 ms | p50 = 0.24 ms |
| **Raw JSON Reads** | p50 = 2.27 ms (~219 KB) | p50 = 4.22 ms (~442 KB) | p50 = 4.34 ms (~444 KB) |
| **Urgency Ranking (actual)** | p50 = 0.10 ms | p50 = 0.28 ms | p50 = 0.29 ms |
| **Standard 500 Cards Hash** | p50 = 0.50 ms | p50 = 0.50 ms | p50 = 0.50 ms |
| **Unicode Max-Text 500 Cards** | p50 = 1.17 ms (~183 KB) | p50 = 1.17 ms (~183 KB) | p50 = 1.17 ms (~183 KB) |

All targets pass (due p50 <= 10 ms, history p50 <= 15 ms). WebKit render and desktop IPC remain unmeasured.

---

## Evidence Manifest & Artifact Verification

- `receipts/diagnostic-1-frozen.txt` & `.exit`: Diagnostic 1 (9/9 pass, exit 0)
- `receipts/diagnostic-2-frozen.txt` & `.exit`: Diagnostic 2 (12/12 pass, exit 0)
- `receipts/diagnostic-3-frozen.txt` & `.exit`: Diagnostic 3 (16/16 pass, exit 0)
- `receipts/diagnostic-4-frozen.txt` & `.exit`: Diagnostic 4 (11/11 pass, exit 0)
- `receipts/proof-run.txt` & `.exit`: Full proof suite (32/32 pass, exit 0)
- `receipts/negative-controls.txt` & `.exit`: Mutation verifier killing all 4 mutants (exit 0)
- `receipts/mutant-survival.txt` & `.exit`: Mutation survival control detecting survivor (exit 0)
- `receipts/query-audit.txt`, `query-audit.json` & `.exit`: SQL query audit across pages and filters
- `receipts/benchmark-run.txt` & `.exit`: Multi-scale performance benchmark (exit 0)
- `receipts/explain-query-plans.txt`: Baseline SQLite query plans

All changes remain uncommitted and unpushed on branch `codex/m2-card-review-c2-scope`. Production C2 implementation remains pending independent scope review and owner approval. Proposed defaults C2-D1 through C2-D9 remain PROPOSED.
