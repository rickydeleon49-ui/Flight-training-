# M2 Card Reviews C2 — State Publication Evidence Package (7 October 2026)

## Overview & Scope Summary

This evidence package completes the M2 Card Reviews C2 state publication planning corrections required in `docs/M2_CARD_REVIEW_C2_CONTRACT_REVIEW_2026-10-07.md` per the active model-neutral assignment in `docs/M2_CARD_REVIEW_C2_STATE_PUBLICATION_PROMPT_2026-10-07.md`.

All seven prior submitted evidence packages are preserved byte-for-byte:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/`
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/`
6. `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/`
7. `docs/evidence/m2-card-review-c2-contract-finish-2026-10-07/`

All 45 paths in `docs/evidence/m2-card-review-c2-contract-review-2026-10-07/submitted-source-hashes.json` were verified at the start of work and matched 100% byte-for-byte.

---

## Baseline Reproduction

The reviewer's frozen diagnostic (`docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs`) was executed against the submitted contract model, reproducing the baseline result exactly:
- **1 control pass / 6 assertion failures** (Exit code: 1).
- Failures reproduced:
  1. Failed card parsing did not spend the 500-card work reservation; three sets of 500 malformed cards were all read under a 500-card budget (receipt: `receipts/baseline-diagnostic.txt`).
  2. Controller dropped reader `issues` and summary metadata; terminal warning-only reader result became empty controller with `controller.issues === undefined`.
  3. Warning inspection target link pointed to unregistered route `/materials/a` instead of registered Study route `/study/a`.
  4. Due cursor accepted priority rank `lp: 2` outside SQL key domain `{0, 1}`.
  5. Targeted history enrichment could not resolve prior-page deferred material (`c,b` limit 2; targeting `b` on next page only queried `a`).
  6. Targeted history enrichment downgraded untargeted provenance (`b` current / `a` pending; targeting `a` returned `b` pending).

---

## Finding-to-Fix-to-Test Mapping

| Finding | Root Cause | Concrete Fix in `contractModel.mjs` | Test Verification | Baseline -> Final Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Failed parsing reservation** | Budget check only incremented parsed card counter on valid parse; failed parses charged 0 cards. | Added `attemptedCards` and `rawAttempts`. Reserved `MAX_CARDS_PER_SET = 500` before raw fetch/parse. Reservation stays spent if parsing fails. Valid sets reconcile to actual count. Single-set admission exception limited to `rawAttempts === 0`. | Diagnostic 7 Test 1; Proof Suite 14 Tests 1–2 | **FAIL -> PASS** |
| **2. Controller dropped issues/summary** | `DeferredReadController.loadNextPage` discarded `res.issues` and `res.summary`. | Controller records `this.issues` and `this.summary` under generation guard. Earlier issues retained across pages and deduplicated by `materialId:code`. `isCaughtUp` requires `isComplete && results.length === 0 && issues.length === 0`. If terminal page has issues, `hasBlockedContent: true`. | Diagnostic 7 Test 2; Proof Suite 14 Tests 3–4 | **FAIL -> PASS** |
| **3. Warning inspection route** | Oversize issue created `inspectionTarget: '/materials/' + id`. App routes register `study/:materialId`. | Updated to `'/study/' + encodeURIComponent(id)`. Opening target remains read-only. | Diagnostic 7 Test 3; Proof Suite 14 Test 5 | **FAIL -> PASS** |
| **4. Priority rank domain** | Due cursor validation accepted any integer `lp`. Key domain only contains ranks 0 and 1. | Strictly require `lp === 0 \|\| lp === 1` before SQL; throw `INVALID_CURSOR` otherwise. Enforced canonical clock instants, topic/material bounds, and status filters. | Diagnostic 7 Test 4; Proof Suite 14 Test 6 | **FAIL -> PASS** |
| **5. Prior-page history enrichment** | `enrichMaterialIds` only sorted IDs already present in current paged event page. | Decoupled target enrichment from event page query. Query requested target materials directly, returning explicit target-only `enrichment` records with `currentVersionId` without injecting old events into new event pages. | Diagnostic 7 Test 5; Proof Suite 14 Tests 7–8 | **FAIL -> PASS** |
| **6. Untargeted provenance downgrade** | Method returned full event rows for untargeted sets with `pending` status, overwriting resolved entries. | Return explicit target-only `enrichment` patches. Controller applies patches to matching loaded rows without overwriting untargeted rows (`b` stays `current`). Added controller `enrichMaterials(targetIds)` action callable even when `isComplete === true`. | Diagnostic 7 Test 6; Proof Suite 14 Tests 9–11 | **FAIL -> PASS** |

---

## Verification Suite Results

### 1. All Seven Frozen Diagnostics Pass Unchanged (74 / 74 total, Exit 0)
- **Diagnostic 1** (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed** (Exit: 0).
- **Diagnostic 2** (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed** (Exit: 0).
- **Diagnostic 3** (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed** (Exit: 0).
- **Diagnostic 4** (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 5** (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): **8 / 8 passed** (Exit: 0).
- **Diagnostic 6** (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 7** (`docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs`): **7 / 7 passed** (Exit: 0, up from 1 pass / 6 fail baseline).

Receipts saved:
- `receipts/all-frozen-diagnostics.txt` and `.exit`
- `receipts/diagnostic-pass.txt` and `.exit`

### 2. Comprehensive Proof Suite (`proof.test.mjs`): 57 / 57 Tests Passed (Exit 0)
All 14 test suites pass cleanly:
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
- Suite 14: State Publication, Work Reservations & Independent History Enrichment (11 tests promoting all findings)

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
- **Review Due Status Filter (`new_only`)**: **177 calls** (1 candidate header scan + 1 byte preflight + 174 raw card fetches + 1 review state batch)
- **History Page 1**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
- **History Next Page**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
- **History Filtered Page**: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)

*Note on earlier three-statement claim*: Distinguishes query stages (header scan, byte preflight, raw fetches, state batch) from total executed SQL calls.

Receipts saved: `receipts/query-audit.txt`, `receipts/query-audit.json`, and `.exit`.

### 5. Benchmark Performance
Ran benchmarks across synthetic SQLite datasets (Node v22.23.3 / SQLite 3.53.4 on macOS Darwin arm64):

| Metric | 100 Materials Scale | 2,500 Materials Scale | 5,000 Materials Scale | Target |
| :--- | :--- | :--- | :--- | :--- |
| **Review Due Page 1 (limit 50)** | **p50 = 2.92 ms** | **p50 = 5.12 ms** | **p50 = 6.16 ms** | $\le 10\text{ ms}$ (PASS) |
| **Review Due Continuation** | **p50 = 0.94 ms** | **p50 = 1.48 ms** | **p50 = 1.50 ms** | Fast resumption (PASS) |
| **History Page 1 (limit 20)** | **p50 = 1.15 ms** | **p50 = 4.60 ms** | **p50 = 9.81 ms** | $\le 15\text{ ms}$ (PASS) |
| **Full Discovery Traversal** | **p50 = 3.65 ms** (2 pages) | **p50 = 108.50 ms** (52 pages) | **p50 = 250.12 ms** (104 pages) | Bounded traversal (PASS) |
| **Preflight Byte Check** | p50 = 0.07 ms | p50 = 0.22 ms | p50 = 0.23 ms | Negligible overhead |
| **Raw JSON Reads (Budgeted)** | p50 = 2.19 ms (~219 KB) | p50 = 2.91 ms (~304 KB) | p50 = 3.00 ms (~305 KB) | Bounded transfer |
| **Genuine Max-Unicode 500 Cards Hash** | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | p50 = 10.46 ms (~5.26 MB) | Single-set lane bound |
| **JSON Escaped Control Char 500 Cards** | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | **8.60 MB** (Exceeds 8 MiB cap) | Preflight rejection |

*Note: Desktop IPC and WebKit rendering remain explicitly unmeasured.*

Receipts saved: `receipts/benchmark.txt`, `results.json`, and `.exit`.

---

## Artifact & Receipt Manifest

- `receipts/baseline-diagnostic.txt` & `.exit`: Diagnostic 7 baseline reproduction (1 pass / 6 fail, exit 1)
- `receipts/diagnostic-pass.txt` & `.exit`: Diagnostic 7 passed after fixes (7/7 pass, exit 0)
- `receipts/all-frozen-diagnostics.txt` & `.exit`: All 7 frozen reviewer diagnostics run unchanged (74/74 pass, exit 0)
- `receipts/proof-run.txt` & `.exit`: Full proof suite across 14 suites (57/57 pass, exit 0)
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

The seven prior evidence packages remain 100% byte-for-byte identical to their submitted states:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/SHA256SUMS` (verified)
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/SHA256SUMS` (verified)
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/SHA256SUMS` (verified)
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/SHA256SUMS` (verified)
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/SHA256SUMS` (verified)
6. `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/SHA256SUMS` (verified)
7. `docs/evidence/m2-card-review-c2-contract-finish-2026-10-07/SHA256SUMS` (verified)

---

## Status and Handoff State

- **Branch**: `codex/m2-card-review-c2-scope`
- **Expected HEAD**: `9028675475616ce338253ae7e4e46ba6b840b72c`
- **Staging / Commit State**: All changes remain uncommitted and unpushed in the working directory for independent review.
- **Product Status**: Corrected, pending independent review. C2 scope remains unaccepted; proposed defaults **C2-D1 through C2-D9** remain **PROPOSED** pending owner decision. Production C2 implementation is not authorized.
