# M2 Split-Source Lineage Scope — Correction Evidence Pack (Round 5)

> [!IMPORTANT]
> **ROUND 5 CORRECTIONS COMPLETE — SCOPE AND CONTRACT PROVEN FOR SENIOR REVIEW.**
> This evidence pack documents the bounded corrections for review findings **SL-R12** and **SL-R13** on Milestone 2 split-source lineage.
> All owner defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent scope review and recorded owner approval.
> No production migration, schema-version bump, application source change, installed/package testing, or release work is authorized.

---

## 1. Executive Summary & Review Findings Addressed

Following senior review of Round 4, Round 5 corrections were completed in `/Users/rickymac/code/Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`).

### SL-R12: Model Defects Addressed
1. **Nested Parent Tier (`parent_title` & `parent_file_name`):**
   - In nested split operations, `parent_title` and `parent_file_name` in `material_split_lineage` now truthfully record the immediate parent's metadata ($A$'s title and stored file name), while `source_title` and `source_file_name` maintain the root ($R$) snapshot.
   - The receipt's `parentSnapshot` explicitly captures `parentTitle` and `parentFileName`.
   - Covered by Contract 11 proof assertions and verified in Reviewer Diagnostic Assertion 5.
2. **Receipt Re-issue Policy:**
   - Re-issuing an identical receipt uses a plain `INSERT` with an explicit existing-row policy, never `INSERT OR REPLACE`.
   - **`committed`**: remains committed; replay and reconcile continue to return existing persisted rows without resetting state.
   - **`cancelled`**: remains cancelled; subsequent saves of that receipt are refused (`Cannot save a cancelled split operation`).
   - **`pending`**: returns the existing uncommitted row unchanged.
   - Verified by Reviewer Diagnostic Assertions 6 and 7, and Contract 18 proof assertions.
3. **Unconditional Tamper Verification:**
   - Tamper verification against `split_operation_log` is unconditional. If the `split_operation_log` table does not exist or has not been initialized, the save is immediately refused with a named error (`split_operation_log table does not exist; cannot verify split operation`).
4. **Deliberate Operation-Log Delete Policy (`ON DELETE SET NULL`):**
   - In `split_operation_log`, `source_material_id` is defined as nullable with `REFERENCES study_materials(id) ON DELETE SET NULL`.
   - When a source handbook is deleted from the library, the operation log row is preserved, setting `source_material_id` to `NULL`.
   - This ensures that operational history, canonical receipts, and batch reconciliation (`reconcileBatch`) remain functional and truthful for already-committed split children even after the source handbook is removed.

### SL-R13: Evidence and Helper Integrity
1. **Strict `cancelBatch(db, operationId)` Signature:**
   - Removed the legacy 3-argument compatibility signature (`cancelBatch(operationId, outputPath, ...)`).
   - Only `cancelBatch(db, operationId)` remains. It unlinks *only* the staging files recorded in that operation's receipt plan, preventing arbitrary or ownerless deletions.
2. **Resolve-Only Forwarding Loader:**
   - Deleted `round2CompatAdapter.mjs` and the loader's `load`/source-rewriting hook.
   - Replaced with a clean, resolve-only loader (`forwardingLoader.mjs` via `forwardingAdapter.mjs`) that redirects earlier `lineageContract.mjs` imports directly to Round 5 without modifying diagnostic source texts.
3. **Honest Recording of Superseded Diagnostics & Retirements:**
   - Every superseded diagnostic was executed through the resolve-only loader without modifying the test source text.
   - Retired test cases are honestly disclosed with exit 1 and mapped to permanent proof contracts covering their intent:
     - **Frozen Round 1 Diagnostic:** 7 passed / 0 failed (exit 0).
     - **Frozen Round 2 Diagnostic:** 4 passed / 2 retired (exit 1). Controls 1–2 retired due to mandatory receipt enforcement; covered permanently in Contract 11.
     - **Round 2 Reviewer Diagnostic:** 8 passed / 3 retired (exit 1). Controls 1–2 and case 11 retired due to mandatory receipt enforcement; covered permanently in Contract 11.
     - **Round 3 Reviewer Diagnostic:** 10 passed / 2 retired (exit 1). Case 11 retired due to hard-coded Round 3 DDL path in test (passes directly against Round 5 DDL); Case 12 retired due to legacy 3-arg cancel signature; covered permanently in Contract 18.
     - **Round 4 Reviewer Diagnostic:** 8 passed / 0 failed (exit 0) verbatim.
4. **Pinned, Deterministic Mutation Runner:**
   - `mutationChecks.mjs` runs with `--test-reporter=tap`, ensuring output format is completely decoupled from terminal environment or runner defaults.
   - Matches both failing test name in the TAP stream and expected assertion error message.
   - Prints the actual killed count and exits 1 on any miss.
   - Accepts an explicit output directory as `argv[2]` and executes against a temporary isolated workspace (`mkdtempSync`), never mutating source or evidence directories in-place.
   - Evaluated 14 mutants (12 preserved + Mutant 13: parent-tier mislabel + Mutant 14: `INSERT OR REPLACE` re-issue reset).
   - Run twice from two different working directories; both runs killed 14/14 mutants with exit 0, yielding identical summary output.

---

## 2. Requirements-to-Test Mapping

The following matrix maps domain requirements and review findings across controls, guards, reproductions, and disclosed retirements:

| Requirement / Finding | Category | Test Case (`proof.test.mjs` / `diagnostics/`) | Verifies / Enforces | Permanent Mapping for Retired Cases |
| --- | :---: | --- | --- | --- |
| **SL-R12.1: Nested Parent Tier** | **Guard** | `Contract 11` & Reviewer Case 5 | `parent_title` and `parent_file_name` capture immediate parent; `source_*` keeps root snapshot. | — |
| **SL-R12.2: Re-issue Policy** | **Guard** | `Contract 18` & Reviewer Cases 6–7 | Re-issuing identical receipt never resets `committed` or `cancelled` operations; saves of cancelled receipts refused. | — |
| **SL-R12.3: Unconditional Tamper Check** | **Guard** | `Contract 11` | Refuses save if `split_operation_log` table is absent. | — |
| **SL-R12.4: Op-Log Delete Policy** | **Control** | `Contract 10` & `Contract 14` | `source_material_id` is `ON DELETE SET NULL`; operation log retained across parent deletions. | — |
| **SL-R13.1: Strict `cancelBatch`** | **Control** | `Contract 18` & Reviewer Case 8 | Strictly `cancelBatch(db, operationId)`; deletes only files recorded in receipt plan. | — |
| **SL-R13.2: Resolve-Only Loader** | **Control** | `forwardingLoader.mjs` | Resolves imports without modifying diagnostic source texts. | — |
| **Frozen Round 1 Diagnostic** | **Control** | `lineage-review.test.mjs` | 7 passed / 0 failed (exit 0). | — |
| **Frozen Round 2 Controls 1–2** | **Disclosed Retirement** | `lineage-round2.test.mjs` (Cases 5 & 6) | Retired because receipt-less save path was eliminated per SL-R10. | Mapped to `Contract 11: Authoritative Receipt and Save Validation`. |
| **Round 2 Reviewer Controls 1–2, Case 11** | **Disclosed Retirement** | `lineage-round2-review.test.mjs` (Cases 1, 2, 11) | Retired because receipt-less save and non-receipt cleanup are eliminated. | Mapped to `Contract 11` and `Contract 17`. |
| **Round 3 Reviewer Case 11** | **Disclosed Retirement** | `lineage-round3-review.test.mjs` (Case 11) | Retired due to hard-coded Round 3 DDL path in diagnostic source text. | Passes directly against Round 5 DDL; mapped to `Contract 13`. |
| **Round 3 Reviewer Case 12** | **Disclosed Retirement** | `lineage-round3-review.test.mjs` (Case 12) | Retired due to legacy 3-argument `cancelBatch` signature. | Mapped to `Contract 18` strict `(db, operationId)` signature. |
| **Round 4 Reviewer Diagnostic (Baseline)** | **Reproduction** | `lineage-round4-review.test.mjs` | 4 passed / 4 failed (exit 1), exactly reproducing reviewer baseline. | — |
| **Round 4 Reviewer Diagnostic (Final)** | **Control** | `lineage-round4-review.test.mjs` | 8 passed / 0 failed (exit 0) verbatim. | — |
| **Proof Test Suite (18 Contracts)** | **Control** | `proof/proof.test.mjs` | 18 passed / 0 failed (exit 0). | — |

---

## 3. Verification Receipts & Results Summary

| Suite / Check | Command | Exit Code | Result | Receipt File |
| --- | --- | :---: | --- | --- |
| **Baseline Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/lineage-round4-review.test.mjs` | **1** | 4 passed / 4 failed (baseline reproduced) | `receipts/diagnostics-baseline.txt` & `.exit` |
| **Final Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/lineage-round4-review.test.mjs` | **0** | **8 passed / 0 failed** | `receipts/diagnostics-review-final.txt` & `.exit` |
| **Frozen Round 1 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** | `receipts/diagnostics-frozen-round1.txt` & `.exit` |
| **Frozen Round 2 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs` | **1** | **4 passed / 2 retired** | `receipts/diagnostics-frozen-round2.txt` & `.exit` |
| **Round 2 Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/lineage-round2-review.test.mjs` | **1** | **8 passed / 3 retired** | `receipts/diagnostics-round2-reviewer.txt` & `.exit` |
| **Round 3 Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round5-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/lineage-round3-review.test.mjs` | **1** | **10 passed / 2 retired** | `receipts/diagnostics-round3-reviewer.txt` & `.exit` |
| **Round 5 Proof Suite (18 Contracts)** | `node --test docs/evidence/m2-split-lineage-scope-round5-2026-10-08/proof/proof.test.mjs` | **0** | **18 passed / 0 failed** | `receipts/proof-run.txt` & `.exit` |
| **Mutation Checks (Run 1)** | `node docs/evidence/m2-split-lineage-scope-round5-2026-10-08/proof/mutationChecks.mjs docs/evidence/m2-split-lineage-scope-round5-2026-10-08/receipts` | **0** | **14/14 caught and verified** | `receipts/mutation-checks.txt` & `.exit` |
| **Mutation Checks (Run 2)** | `node docs/evidence/m2-split-lineage-scope-round5-2026-10-08/proof/mutationChecks.mjs docs/evidence/m2-split-lineage-scope-round5-2026-10-08/receipts/mutations-run2` | **0** | **14/14 caught and verified** | `receipts/mutations-run2/mutation-checks.txt` & `.exit` |

---

## 4. Mutation Sensitivity Results (`mutationChecks.mjs`)

Every mutant was evaluated in a fresh, isolated temporary workspace (`mkdtempSync`), executed with `--test-reporter=tap`, matched against the failing test name in the TAP stream plus the expected assertion message, and logged with individual `.txt` and `.exit` receipts. Both runs produced identical results:

| Mutant ID | Targeted File | Mutation Description | Killing Test in TAP | Expected Killing Message | Exit | Run 1 Receipt | Run 2 Receipt |
| --- | --- | --- | --- | --- | :---: | --- | --- |
| **MUTANT-1** | `lineageContract.mjs` | Range composition off-by-one (`+ 1` instead of `- 1`) | `Contract 3: Nested Range Composition` | `Composed R start mismatch` | **1** | `receipts/mutations/mutant-1.txt` | `receipts/mutations-run2/mutations/mutant-1.txt` |
| **MUTANT-2** | `lineageContract.mjs` | Child upper-bound enforcement removed | `Contract 2: Page Translation Maps Child Position` | `Child page beyond length must throw out-of-bounds error` | **1** | `receipts/mutations/mutant-2.txt` | `receipts/mutations-run2/mutations/mutant-2.txt` |
| **MUTANT-3** | `candidate_migration_0013.sql` | `TYPEOF(...) = 'integer'` checks removed from DDL | `Contract 5: Structural Tiers and Strict DDL CHECK Constraints` | `Fractional physical page bounds must fail TYPEOF constraint` | **1** | `receipts/mutations/mutant-3.txt` | `receipts/mutations-run2/mutations/mutant-3.txt` |
| **MUTANT-4** | `candidate_migration_0013.sql` | `CHECK (material_id != parent_material_id)` removed from DDL | `Contract 5: Structural Tiers and Strict DDL CHECK Constraints` | `Self-parenting must fail cycle check constraint` | **1** | `receipts/mutations/mutant-4.txt` | `receipts/mutations-run2/mutations/mutant-4.txt` |
| **MUTANT-5** | `lineageContract.mjs` | Hash-nullness tier heuristic restored over structural check | `Contract 8: Legacy NULL Parent Hash is Handled as Unknown` | `Legacy NULL parent hash must yield unknown status` | **1** | `receipts/mutations/mutant-5.txt` | `receipts/mutations-run2/mutations/mutant-5.txt` |
| **MUTANT-6** | `lineageContract.mjs` | Sibling `COALESCE` grouping restored over effective identity | `Contract 9: Unknown Parent Editions Are Not Grouped as Siblings` | `Unknown parent editions must not be grouped as siblings` | **1** | `receipts/mutations/mutant-6.txt` | `receipts/mutations-run2/mutations/mutant-6.txt` |
| **MUTANT-7** | `lineageContract.mjs` | Planned output material ID collision check skipped | `Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation` | `Planned output material ID already exists in library` | **1** | `receipts/mutations/mutant-7.txt` | `receipts/mutations-run2/mutations/mutant-7.txt` |
| **MUTANT-8** | `lineageContract.mjs` | Cancellation after commit allowed to mutate database/delete files | `Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation` | `Expected values to be strictly equal` | **1** | `receipts/mutations/mutant-8.txt` | `receipts/mutations-run2/mutations/mutant-8.txt` |
| **MUTANT-9** | `lineageContract.mjs` | Receipt-less save path restored | `Contract 11: Atomic Batch Save Binds to Authoritative Receipt` | `Receipt-less save must throw mandatory receipt error` | **1** | `receipts/mutations/mutant-9.txt` | `receipts/mutations-run2/mutations/mutant-9.txt` |
| **MUTANT-10** | `lineageContract.mjs` | Receipt hash check against `split_operation_log` skipped | `Contract 11: Atomic Batch Save Binds to Authoritative Receipt` | `Tampered receipt must be refused by hash check` | **1** | `receipts/mutations/mutant-10.txt` | `receipts/mutations-run2/mutations/mutant-10.txt` |
| **MUTANT-11** | `lineageContract.mjs` | In-transaction nested parent snapshot comparison removed | `Contract 11: Atomic Batch Save Binds to Authoritative Receipt` | `Parent lineage snapshot drift must be refused` | **1** | `receipts/mutations/mutant-11.txt` | `receipts/mutations-run2/mutations/mutant-11.txt` |
| **MUTANT-12** | `proof.test.mjs` | `split_operation_log` restored inside test helper | `Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline` | `split_operation_log must not exist in shipped migrations 0001–0012` | **1** | `receipts/mutations/mutant-12.txt` | `receipts/mutations-run2/mutations/mutant-12.txt` |
| **MUTANT-13** | `lineageContract.mjs` | Nested parent tier records root title/file instead of parent | `Contract 11: Atomic Batch Save Binds to Authoritative Receipt` | `Nested parent tier must record immediate parent title and file name` | **1** | `receipts/mutations/mutant-13.txt` | `receipts/mutations-run2/mutations/mutant-13.txt` |
| **MUTANT-14** | `lineageContract.mjs` | Re-issuing receipt uses `INSERT OR REPLACE` resetting status | `Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation` | `Re-issuing receipt must not reset committed operation status` | **1** | `receipts/mutations/mutant-14.txt` | `receipts/mutations-run2/mutations/mutant-14.txt` |

---

## 5. Pack File Manifest

- `candidate_migration_0013.sql`: Authoritative candidate DDL containing `material_split_lineage` and `split_operation_log` (`source_material_id` with `ON DELETE SET NULL`).
- `proof/package.json`: ES module package configuration.
- `proof/lineageContract.mjs`: Complete contract model with immediate parent tier labeling, non-destructive receipt re-issue, unconditional tamper verification, and strict `cancelBatch(db, operationId)`.
- `proof/proof.test.mjs`: 18 comprehensive test contracts covering all SL-R12 and SL-R13 invariants.
- `proof/mutationChecks.mjs`: Pinned TAP mutation driver testing 14 distinct mutants against explicit output directory.
- `diagnostics/lineage-round4-review.test.mjs`: Verbatim copy of Round 4 reviewer diagnostic suite (8 assertions).
- `diagnostics/forwardingAdapter.mjs` & `forwardingLoader.mjs`: Resolve-only Node module loader and adapter forwarding imports to Round 5 model.
- `receipts/diagnostics-baseline.txt` & `.exit`: Baseline reviewer diagnostic log (4 passed / 4 failed, exit 1).
- `receipts/diagnostics-review-final.txt` & `.exit`: Final reviewer diagnostic log (8 passed / 0 failed, exit 0).
- `receipts/diagnostics-frozen-round1.txt` & `.exit`: Frozen Round 1 diagnostic log (7 passed, exit 0).
- `receipts/diagnostics-frozen-round2.txt` & `.exit`: Frozen Round 2 diagnostic log (4 passed / 2 retired, exit 1).
- `receipts/diagnostics-round2-reviewer.txt` & `.exit`: Round 2 reviewer diagnostic log (8 passed / 3 retired, exit 1).
- `receipts/diagnostics-round3-reviewer.txt` & `.exit`: Round 3 reviewer diagnostic log (10 passed / 2 retired, exit 1).
- `receipts/proof-run.txt` & `.exit`: Round 5 proof suite execution log (18 passed, exit 0).
- `receipts/mutation-checks.txt` & `.exit`: Run 1 mutation test summary log (14/14 caught, exit 0).
- `receipts/mutations/mutant-1..14.txt` & `.exit`: Run 1 per-mutant raw logs and exit codes.
- `receipts/mutations-run2/mutation-checks.txt` & `.exit`: Run 2 mutation test summary log (14/14 caught, exit 0).
- `receipts/mutations-run2/mutations/mutant-1..14.txt` & `.exit`: Run 2 per-mutant raw logs and exit codes.
- `source-hashes.json`: Cryptographic hashes of all 6 tracked project documents.
- `SHA256SUMS`: Cryptographic checksums of all files in this evidence pack.
