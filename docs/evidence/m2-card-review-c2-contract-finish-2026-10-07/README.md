# M2 Card Reviews C2 — Contract Finishing Evidence Package (7 October 2026)

## Overview & Scope Summary

This evidence package completes the contract-finishing planning corrections required by the reviewer in `docs/M2_CARD_REVIEW_C2_BOUNDS_REREVIEW_2026-10-07.md` per the active model-neutral correction assignment.

All six prior submitted evidence packages are preserved byte-for-byte:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/`
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/`
6. `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/`

All 40 paths in `origin/main:docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/submitted-source-hashes.json` were verified at the start of work and matched 100% byte-for-byte.

---

## Baseline Reproduction

The reviewer's frozen diagnostic (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`) was executed against the submitted contract model, reproducing the baseline result exactly:
- **1 control pass / 10 assertion failures** (Exit code: 1).
- Failures confirmed:
  1. Oversize discovery candidate marked processed and broken without emitting error/issue/link (silent catch-up).
  2. Oversize pending candidate consumed ID silently without reporting.
  3. History first distinct set bypassed 8 MiB absolute bound and transferred 9,020,501 bytes.
  4. Mixed discovery parsed 900 cards under 600 card request budget before refusing (900 parsed / 400 reported evaluated).
  5. Mixed pending parsed 900 cards under 600 card request budget before refusing.
  6. Owned v1 due cursor with `remIds: []`, `isExhausted: false`, missing `lc/lp/lu` accepted and restarted page 1.
  7. Owned due cursor with duplicate IDs in `remIds: ['a', 'a']` accepted.
  8. History cursor accepted non-canonical date `2026-02-30T00:00:00.000Z` and overlong 65-char event ID.
  9. `validateScheduleState` invented a 1d interval for an event under `unsupported-v99`.
  10. `validateScheduleState` accepted normalized Feb 30 and negative reps/lapses.

---

## Diagnostic Test Verification

All six frozen diagnostic test suites pass **100% unchanged**:
- **Diagnostic 1** (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed** (Exit: 0).
- **Diagnostic 2** (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed** (Exit: 0).
- **Diagnostic 3** (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed** (Exit: 0).
- **Diagnostic 4** (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 5** (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): **8 / 8 passed** (Exit: 0).
- **Diagnostic 6** (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0, including control, up from 1 pass / 10 fail baseline).

**Total Frozen Diagnostic Passes**: **67 / 67 passed** (zero failures, exit 0).

The comprehensive proof test suite (`proof.test.mjs`) passes **46 / 46 tests** (Exit: 0) across 13 suites, including Suite 13 with 6 new contract finishing tests.

---

## Core Corrections Implemented

### 1. C2-R4: Explicit Oversize Outcomes and Admission Before Work
- **Explicit Bounded Issue Collection**: When preflight byte check encounters a candidate where `byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES` (8 MiB), the raw set is **not** transferred across SQLite wire. Instead, an explicit issue is emitted in `issues: [{ materialId, title, code: 'PAYLOAD_TOO_LARGE', rawBytes, allowedBytes: 8388608, inspectionTarget }]`.
- **Keyset Continuation Advancement**: The keyset boundary advances past the reported oversize candidate in both discovery and pending streams. Later normal materials remain discoverable with zero silent drops, zero infinite loops, and zero livelock.
- **Rewritten Submitted Proof Expectation**: Corrected the previous submitted test that asserted zero rows/null cursor on an oversize set. The test now explicitly asserts the oversize candidate is reported in `issues`, zero raw bytes are read, and later materials remain discoverable.
- **History Absolute Cap Preflight**: In history current-content enrichment, the 8 MiB absolute bound is applied before SQLite raw row reads for every set (regardless of index). Unread sets are marked `contentStatus: "pending"` with `isEarlierVersion: null` without transferring megabytes.
- **Targeted History Pending Resolution**: Supported `enrichMaterialIds` option in `getLibraryRecentReviews` to allow targeted resolution of deferred materials on subsequent reads without losing, reordering, or duplicating event stream pagination. Exposes `pendingMaterialIds`.
- **Conservative Card Reservation Before Parse**: When exact count metadata is unindexed, the reader conservatively reserves `MAX_CARDS_PER_SET = 500` before reading candidate $i > 0$. If `cumulativeCards + 500 > maxBatchCardsBudget`, reading stops before SQLite wire transfer and JSON parsing, retaining the candidate for keyset continuation.

### 2. C2-R8: Strict Complete Cursor Schemas
- **Due Continuation Token Validation**: Enforced before SQL. Requires `v === 1`, `type === 'due'`, `ctx`, boolean `isExhausted`, unique string IDs in `remIds` ($\le 250$), and complete keyset boundary `lc` (string $\le 64$), integer rank `lp`, and canonical ISO instant `lu` (`isIsoInstant(lu)`). Rejects partial keys, non-boolean exhaustion, duplicate IDs, and invalid calendars with `INVALID_CURSOR`.
- **History Continuation Token Validation**: Enforced before SQL. Requires `v === 1`, `type === 'history'`, `ctx`, canonical ISO instant `t` (`isIsoInstant(t)`), and non-empty string `id` ($\le 64$). Rejects non-canonical dates (e.g. Feb 30) and overlong IDs before SQL.

### 3. C2-R10 Inspection: Honor Scheduler Ownership and Valid State
- **Scheduler Ownership in History**: Passed the review event's verified `scheduler_version` into `validateScheduleState(next_state_json, row.scheduler_version)`.
- **Honest Null Intervals**: Unsupported event scheduler versions (`unsupported-v99`) yield typed nulls (`step: null`, `dueAt: null`, `intervalDays: null`, `intervalLabel: null`) while preserving raw audit strings.
- **Strict Schedule Validation**: Enforced `isIsoInstant` on `dueAt` and `lastReviewedAt`, rejecting non-canonical dates. Validated finite non-negative integers for `reps` and `lapses`, and valid ladder steps in $[-1, 7]$. Supported C1 16-day schedule control remains passing.

### 4. Supporting Document and Benchmark Alignments
- **Approximate Component Microbenchmarks**: Renamed duplicate synthetic breakdown loop in `benchmark.mjs` to `pipeline_breakdown_approximate_microbenchmarks` with explicit notes; preserved genuine full-reader metrics (`reviewDue`, `history`).
- **Honest JSON Escaping Serialization Arithmetic**: Documented that code-point and memory byte counts do not bound serialized JSON. Control characters like `\u0001` expand to 6 serialized bytes in JSON (`\u0001`), producing **9,020,501 bytes** (~8.60 MiB) for a valid C1 500-card set, exceeding the 8 MiB cap and proving why preflight blob checks are necessary.
- **Fixed Relative Links**: Fixed sibling links in `docs/` (`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md` and `docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`) to point directly to sibling filenames without prepending `docs/`.

---

## Mutation Verifier & Survival Control

- **Baseline**: `runMutants.mjs` runs baseline tests against the contract model; passes cleanly (Exit code: 0).
- **Mutants Killed**:
  - `mutant_wrong_version`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_time_boundary`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_cursor_tie`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_owner_lock`: Fails with `AssertionError` (Exit code: 1).
  All 4 mutants killed.
- **Survival Control**: `mutantSurvivalControl.mjs` verifies that disabling assertions causes the verifier to report a mutant survival failure (Exit code: 0).

---

## Benchmark & Audit Performance Summary

Ran benchmarks across synthetic SQLite datasets (Node v22.23.3 / SQLite 3.53.4 on macOS Darwin arm64):

| Metric | 100 Materials Scale | 2,500 Materials Scale | 5,000 Materials Scale | Target |
| :--- | :--- | :--- | :--- | :--- |
| **Review Due Page 1 (limit 50)** | **p50 = 2.88 ms** | **p50 = 5.06 ms** | **p50 = 6.08 ms** | $\le 10\text{ ms}$ (PASS) |
| **Review Due Page 2 Cont.** | **p50 = 0.95 ms** | **p50 = 1.54 ms** | **p50 = 1.51 ms** | Fast resumption (PASS) |
| **History Page 1 (limit 20)** | **p50 = 1.14 ms** | **p50 = 4.57 ms** | **p50 = 9.57 ms** | $\le 15\text{ ms}$ (PASS) |
| **Full Discovery Traversal** | **p50 = 3.69 ms** (2 pages) | **p50 = 108.33 ms** (52 pages) | **p50 = 249.01 ms** (104 pages) | Bounded traversal (PASS) |
| **Preflight Byte Check** | p50 = 0.07 ms | p50 = 0.22 ms | p50 = 0.23 ms | Negligible overhead |
| **Raw JSON Reads (Budgeted)** | p50 = 2.19 ms (~219 KB) | p50 = 2.91 ms (~304 KB) | p50 = 3.00 ms (~305 KB) | Bounded transfer |
| **Genuine Max-Unicode 500 Cards Hash** | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | Single-set lane bound |
| **JSON Escaped Control Char 500 Cards** | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | Bounded preflight rejection |

*Note: Desktop IPC and WebKit rendering remain explicitly unmeasured.*

---

## Evidence Manifest & Artifact Verification

- `receipts/diagnostic-1-frozen.txt` & `.exit`: Diagnostic 1 (9/9 pass, exit 0)
- `receipts/diagnostic-2-frozen.txt` & `.exit`: Diagnostic 2 (12/12 pass, exit 0)
- `receipts/diagnostic-3-frozen.txt` & `.exit`: Diagnostic 3 (16/16 pass, exit 0)
- `receipts/diagnostic-4-frozen.txt` & `.exit`: Diagnostic 4 (11/11 pass, exit 0)
- `receipts/diagnostic-5-frozen.txt` & `.exit`: Diagnostic 5 (8/8 pass, exit 0)
- `receipts/diagnostic-6-frozen.txt` & `.exit`: Diagnostic 6 (11/11 pass, exit 0)
- `receipts/proof-run.txt` & `.exit`: Full proof suite (46/46 pass, exit 0)
- `receipts/negative-controls.txt` & `.exit`: Mutation verifier killing all 4 mutants (exit 0)
- `receipts/mutant-survival.txt` & `.exit`: Mutation survival control detecting survivor (exit 0)
- `receipts/query-audit.txt`, `query-audit.json` & `.exit`: SQL query audit across pages and filters
- `receipts/benchmark-run.txt` & `.exit`: Multi-scale performance benchmark (exit 0)
- `receipts/explain-query-plans.txt` & `.exit`: Baseline SQLite query plans

All changes remain uncommitted and unpushed on branch `codex/m2-card-review-c2-scope`. Production C2 implementation remains pending independent scope review and owner approval. Proposed defaults C2-D1 through C2-D9 remain PROPOSED.
