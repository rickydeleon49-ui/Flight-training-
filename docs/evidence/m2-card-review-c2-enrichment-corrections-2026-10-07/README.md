# M2 Card Reviews C2 — Enrichment Corrections Evidence Package (7 October 2026)

## Overview & Scope Summary

This evidence package completes the M2 Card Reviews C2 planning-proof corrections required in `docs/M2_CARD_REVIEW_C2_STATE_PUBLICATION_REREVIEW_2026-10-07.md` per the active model-neutral assignment in `docs/M2_CARD_REVIEW_C2_ENRICHMENT_CORRECTIONS_PROMPT_2026-10-07.md`.

All eight prior submitted evidence packages are preserved byte-for-byte:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/`
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/`
6. `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/`
7. `docs/evidence/m2-card-review-c2-contract-finish-2026-10-07/`
8. `docs/evidence/m2-card-review-c2-state-publication-2026-10-07/`

All 39 paths in `docs/evidence/m2-card-review-c2-publication-rereview-2026-10-07/submitted-source-hashes.json` were verified at the start of work and matched 100% byte-for-byte.

---

## Baseline Reproduction

The reviewer's frozen diagnostic (`docs/evidence/m2-card-review-c2-publication-rereview-2026-10-07/diagnostic.test.mjs`) was executed against the submitted contract model, reproducing the baseline result exactly:
- **1 control pass / 9 assertion failures** (Exit code: 1, receipt: `receipts/baseline-diagnostic.txt`).
- Failures reproduced:
  1. *Filter ownership (C2-E1)*: Candidate outside active material/topic filter was still read and enriched instead of yielding `contentStatus: 'unavailable'`, `reason: 'filter_mismatch'`.
  2. *Target count bounds (C2-E1)*: Target array accepted > 250 distinct IDs without rejecting before SQL with `INVALID_TARGET`.
  3. *Work budget ledger (C2-E1)*: Three malformed 500-card sets parsed under a 500-card budget without charging the work reservation.
  4. *Enrichment-only mode (C2-E1)*: Controller enrichment passed `limit: 0`, but reader clamped to 1 and queried events instead of skipping event query (`eventQueries === 0`) and preserving cursor/order.
  5. *Status-aware publication (C2-E2)*: Pending patch with `currentVersionId: null` mutated `isEarlierVersion` from `null` to `true`.
  6. *Blocking reason clearing (C2-E2)*: Successful resolution left obsolete `blockedReason: 'budget_exceeded'` and action on the row.
  7. *Inspection action publication (C2-E2)*: Controller dropped reader `inspectionTarget` on blocked oversize rows.
  8. *Route URL encoding (C2-E2)*: Route template interpolated raw IDs directly (`/study/a/b` instead of `/study/a%2Fb`).
  9. *Failed read descriptor (C2-E3)*: Independent failure markers caused retry of wrong operation when failure order alternated.

---

## Finding-to-Fix-to-Test Mapping

| Finding | Root Cause | Concrete Fix in `contractModel.mjs` | Test Verification | Baseline -> Final Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Filter ownership bypass (C2-E1.1)** | Target enrichment loop queried and parsed sets without checking whether the candidate material or topic matched the active query filter. | Validated candidate `materialId` and `topic` context before raw fetch. If candidate topic or material does not match active filter, skips raw fetch and returns `{ contentStatus: 'unavailable', currentVersionId: null, reason: 'filter_mismatch' }`. | Diagnostic 8 Test 2; Proof Suite 15 Test 1 | **FAIL -> PASS** |
| **2. Unbounded target count (C2-E1.2)** | `enrichMaterialIds` did not validate array shape or cap length before SQL. | Validated non-empty array shape, string element length ($\le 64$), deduplicated target IDs, and rejected $> 250$ distinct targets before SQL (`INVALID_TARGET`). Controller fairly batches loaded pending list in chunks $\le 250$ without dropping remaining work. | Diagnostic 8 Test 3; Proof Suite 15 Tests 2–3 | **FAIL -> PASS** |
| **3. Shared card work ledger (C2-E1.3)** | History reader did not charge work reservations for explicit targets or keep failed reservations spent. | History reader shares cumulative ledger (`attemptedCards`, `rawAttempts`, `cumulativeRawBytes`, `evaluatedCards`). Reserves 500 cards before every raw fetch. Failed parse leaves reservation spent; valid sets reconcile to actual card count. Stops before exceeding `maxBatchCardsBudget: 500` and retains unread targets as pending. | Diagnostic 8 Test 4; Proof Suite 15 Tests 4–5 | **FAIL -> PASS** |
| **4. Reader clamped limit 0 (C2-E1.4)** | `limit: 0` was clamped to 1, causing event queries and potential unrelated raw reads on enrichment passes. | Added explicit `enrichmentOnly: true` mode (and support for `limit: 0`). Skips event keyset query completely (`eventQueries === 0`), returns empty rows, and preserves controller cursor, event order, and event IDs. Controller `enrichMaterials` passes `enrichmentOnly: true`. | Diagnostic 8 Test 5; Proof Suite 15 Tests 6–7 | **FAIL -> PASS** |
| **5. Null identity comparison (C2-E2.5)** | Controller `_applyEnrichment` evaluated `row.versionId !== patch.currentVersionId` even when `currentVersionId === null`. | Compare event versions only when readable current identity exists (`patch.currentVersionId !== null`). When `currentVersionId` is null (or status is `pending`), `isEarlierVersion` remains `null`. | Diagnostic 8 Test 6; Proof Suite 15 Test 8 | **FAIL -> PASS** |
| **6. Obsolete blocking reason (C2-E2.6)** | Patching resolved rows did not clear existing `blockedReason` or `inspectionTarget`. | On successful resolution (`current`, `earlier`, `valid_empty`), explicitly cleared obsolete `blockedReason: null` and `inspectionTarget: null`. | Diagnostic 8 Test 7; Proof Suite 15 Test 9 | **FAIL -> PASS** |
| **7. Dropped inspection target (C2-E2.7)** | Controller `_applyEnrichment` omitted `inspectionTarget` from blocked patch updates. | Published `blockedReason` and `inspectionTarget` together on blocked rows. Permanently oversized content is excluded from automatic pending retry. | Diagnostic 8 Test 8; Proof Suite 15 Test 10 | **FAIL -> PASS** |
| **8. Raw route interpolation (C2-E2.9)** | Route templates interpolated IDs without encoding (`/study/${id}`). | Centralized helper `getStudyInspectionTarget(id)` produces `/study/${encodeURIComponent(id)}` (e.g. `a/b` -> `/study/a%2Fb`) across due issues and history blocked actions. | Diagnostic 8 Test 9; Proof Suite 15 Test 11 | **FAIL -> PASS** |
| **9. Retry wrong operation (C2-E3.8)** | Independent mutable failure markers (`lastFailedPageCursor`, `lastFailedEnrichTargets`) allowed stale enrichment targets to survive page failures. | Replaced independent flags with single discriminated `this.lastFailedRead = { kind: 'page' \| 'enrich', ... } \| null` descriptor. Overwritten only on live failure; cleared on live success and authoritative invalidation (`onReset`, `setFilter`, `onMaterialDeleted`). `retryRead()` repeats the most recent failed read without writes. | Diagnostic 8 Test 10; Proof Suite 15 Tests 12–14 | **FAIL -> PASS** |

---

## Verification Suite Results

### 1. All Eight Frozen Diagnostics Pass Unchanged (84 / 84 total, Exit 0)
- **Diagnostic 1** (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed** (Exit: 0).
- **Diagnostic 2** (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed** (Exit: 0).
- **Diagnostic 3** (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed** (Exit: 0).
- **Diagnostic 4** (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 5** (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): **8 / 8 passed** (Exit: 0).
- **Diagnostic 6** (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 7** (`docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs`): **7 / 7 passed** (Exit: 0).
- **Diagnostic 8** (`docs/evidence/m2-card-review-c2-publication-rereview-2026-10-07/diagnostic.test.mjs`): **10 / 10 passed** (Exit: 0, up from 1 pass / 9 fail baseline).

Receipts saved:
- `receipts/all-frozen-diagnostics.txt` and `.exit`
- `receipts/diagnostic-pass.txt` and `.exit`

### 2. Comprehensive Proof Suite (`proof.test.mjs`): 71 / 71 Tests Passed (Exit 0)
All 15 test suites pass cleanly:
- Suite 1: Pure Logic Parity
- Suite 2: Schema 12 Database Baseline & Upgrade from Schema 11
- Suite 3: Review Due Pipeline & In-Memory Urgency Sorting
- Suite 4: Review Due Keyset Paging & Revalidated Keyset Continuation
- Suite 5: Recent Reviews Keyset Paging, Preflight Checks & Version Provenance
- Suite 6: Asynchronous UI State Controller Lifecycle
- Suite 7: Negative Controls & Security Defenses
- Suite 8: File-Backed Database Verification
- Suite 9: Candidate Progression & Filter Matrix
- Suite 10: Stream Consumption & Synchronous Op Lock Ownership
- Suite 11: Single-Set Admission Lane & Preflight Bounds Accounting
- Suite 12: Cursor Token Validation & Scheduler Ownership
- Suite 13: Bounded Preflight, Issues & Work Reservations
- Suite 14: State Publication, Work Reservations & Independent History Enrichment
- Suite 15: Bounded Filter-Owned Enrichment, Status-Aware Publication & Discriminated Read Retries (14 tests promoting all findings and controls)

Receipt saved: `receipts/proof-run.txt` and `.exit`.

### 3. Mutation Verifier Baseline, 4 Semantic Kills & Survival Control
- **Baseline**: Passes cleanly (Exit: 0).
- **Mutant 1 (`mutant_wrong_version`)**: Killed with `AssertionError` (Exit: 1).
- **Mutant 2 (`mutant_time_boundary`)**: Killed with `AssertionError` (Exit: 1).
- **Mutant 3 (`mutant_cursor_tie`)**: Killed with `AssertionError` (Exit: 1).
- **Mutant 4 (`mutant_owner_lock`)**: Killed with `AssertionError` (Exit: 1).
Receipt saved: `receipts/negative-controls.txt` and `.exit`.
- **Survival Control**: Confirms verifier fails if mutant assertions are suppressed (Exit: 0).
Receipt saved: `receipts/mutant-survival.txt` and `.exit`.

### 4. Executed SQL Call Audit (`query-audit.mjs`)
Measured exact executed SQLite calls on the 5,000-material / 10,000-event fixture:
- **Review Due Page 1**: **175 calls** (1 candidate header scan + 1 byte preflight + 172 raw card fetches + 1 review state batch)
- **Review Due Continuation Page**: **150 calls** (revalidation of pending IDs: 1 metadata scan + 1 byte preflight + 147 raw card fetches + 1 review state batch)
- **Review Due Status Filter (`due_today`)**: **177 calls** (1 candidate header scan + 1 byte preflight + 174 raw card fetches + 1 review state batch)
- **History Page 1**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
- **History Next Page**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
- **History Filtered Page**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
- **History Enrichment-Only Mode (`history_enrichment_only`)**: **3 calls** (0 event keyset queries + 1 distinct byte preflight + 2 raw card fetches)
- **History Combined Page Plus Target (`history_combined_page_plus_target`)**: **24 calls** (1 event keyset scan + 1 distinct byte preflight + 22 raw card fetches with deduplicated targets)

Receipts saved: `receipts/query-audit.txt`, `receipts/query-audit.json`, and `.exit`.

### 5. Benchmark Performance
Ran benchmarks across synthetic SQLite datasets (Node v22.23.3 / SQLite 3.53.4 on macOS Darwin arm64):

| Metric | 100 Materials Scale | 2,500 Materials Scale | 5,000 Materials Scale | Target |
| :--- | :--- | :--- | :--- | :--- |
| **Review Due Page 1 (limit 50)** | **p50 = 2.97 ms** | **p50 = 5.23 ms** | **p50 = 6.07 ms** | $\le 10\text{ ms}$ (PASS) |
| **Review Due Continuation** | **p50 = 0.92 ms** | **p50 = 1.62 ms** | **p50 = 1.57 ms** | Fast resumption (PASS) |
| **History Page 1 (limit 20)** | **p50 = 1.15 ms** | **p50 = 4.63 ms** | **p50 = 9.52 ms** | $\le 15\text{ ms}$ (PASS) |
| **Full Discovery Traversal** | **p50 = 3.72 ms** (2 pages) | **p50 = 109.31 ms** (52 pages) | **p50 = 249.95 ms** (103 pages) | Bounded traversal (PASS) |
| **Preflight Byte Check** | p50 = 0.08 ms | p50 = 0.22 ms | p50 = 0.23 ms | Negligible overhead |
| **Raw JSON Reads (Budgeted)** | p50 = 2.19 ms (~219 KB) | p50 = 2.91 ms (~304 KB) | p50 = 2.71 ms (~312 KB) | Bounded transfer |
| **Genuine Max-Unicode 500 Cards Hash** | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | Single-set lane bound |
| **JSON Escaped Control Char 500 Cards** | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | Preflight rejection |

*Note: Desktop IPC and WebKit rendering remain explicitly unmeasured.*

Receipts saved: `receipts/benchmark.txt`, `results.json`, and `.exit`.

---

## Artifact & Receipt Manifest

- `receipts/baseline-diagnostic.txt` & `.exit`: Diagnostic 8 baseline reproduction (1 pass / 9 fail, exit 1)
- `receipts/diagnostic-pass.txt` & `.exit`: Diagnostic 8 passed after fixes (10/10 pass, exit 0)
- `receipts/all-frozen-diagnostics.txt` & `.exit`: All 8 frozen reviewer diagnostics run unchanged (84/84 pass, exit 0 across all children)
- `receipts/proof-run.txt` & `.exit`: Full proof suite across 15 suites (71/71 pass, exit 0)
- `receipts/negative-controls.txt` & `.exit`: Mutation verifier baseline + 4 kills with `AssertionError` (runner exit 0)
- `receipts/mutant-survival.txt` & `.exit`: Mutation survival control detecting survivor (exit 0)
- `receipts/query-audit.txt`, `query-audit.json` & `.exit`: Executed SQL call audit on 5,000-material/10,000-event fixture
- `receipts/benchmark.txt` & `.exit`: Multi-scale performance benchmarks (exit 0)
- `receipts/explain-query-plans.txt` & `.exit`: Baseline SQLite query plans (exit 0)
- `results.json`: Machine-readable benchmark measurements
- `optional_migration_0013.sql`: Unapproved optional index variant
- `submitted/STATUS.md`: Snapshot of live STATUS.md
- `submitted/docs/PROJECT_HANDOFF.md`: Snapshot of live docs/PROJECT_HANDOFF.md
- `submitted/docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`: Snapshot of live scope document
- `submitted/docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`: Snapshot of live implementation prompt

---

## Preserved Prior Evidence Packages

The eight prior evidence packages remain 100% byte-for-byte identical to their submitted states:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/SHA256SUMS` (verified)
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/SHA256SUMS` (verified)
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/SHA256SUMS` (verified)
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/SHA256SUMS` (verified)
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/SHA256SUMS` (verified)
6. `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/SHA256SUMS` (verified)
7. `docs/evidence/m2-card-review-c2-contract-finish-2026-10-07/SHA256SUMS` (verified)
8. `docs/evidence/m2-card-review-c2-state-publication-2026-10-07/SHA256SUMS` (verified)

---

## Status and Handoff State

- **Branch**: `codex/m2-card-review-c2-scope`
- **Expected HEAD**: `9028675475616ce338253ae7e4e46ba6b840b72c`
- **Staging / Commit State**: All changes remain uncommitted and unpushed in the working directory for independent review.
- **Product Status**: Corrected, pending independent review. C2 scope remains unaccepted; proposed defaults **C2-D1 through C2-D9** remain **PROPOSED** pending owner decision. Production C2 implementation is not authorized.
