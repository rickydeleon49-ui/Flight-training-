# M2 Split-Source Lineage Scope — Correction Evidence Pack (Round 3)

> [!IMPORTANT]
> **ROUND 3 CORRECTIONS COMPLETE — SCOPE AND CONTRACT PROVEN FOR SENIOR RE-REVIEW.**
> This evidence pack documents the bounded corrections for review findings **SL-R7**, **SL-R8**, and **SL-R9** on Milestone 2 split-source lineage.
> All owner defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent scope review and recorded owner approval.
> No production migration, schema-version bump, application source change, installed/package testing, or release work is authorized.

---

## 1. Executive Summary & Review Findings Addressed

Following the senior review of Round 2, Round 3 corrections were implemented in `/Users/rickymac/code/Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`).

### SL-R7: Mandatory, Authoritative Source Receipt
- **Typed `SplitSourceReceipt`:** Created deterministically by `createSplitSourceReceipt(...)`, capturing:
  - Source material ID, file path, size, authoritative page total.
  - SHA-256 hash of the exact bytes split.
  - Lineage snapshot for nested sources (root ID, root title, root file, root hash, root total, and parent root range).
  - Deterministic plan of selections and output identities.
- **Caller Provenance Overrides Removed:** Parts carry only selection, title, and output identity (`id`). Persisted hashes, ranges, totals, and nested levels are derived strictly from the receipt and database state. Caller attempts to supply contradictory hashes, root ranges, totals, or levels are refused.
- **Honest File-Read Boundary:** Source file reading (`fs.readFileSync`) sits honestly outside the SQLite transaction. The model computes the live file SHA-256 and compares it with the receipt hash before any database transaction begins.
- **Pinned-Transaction-Owner Re-Checks:** Inside `BEGIN IMMEDIATE`, before any table insert:
  - Re-verifies that the source material row still exists in `study_materials` and points to the receipt's file path.
  - For nested splits, re-verifies that the parent's persisted lineage snapshot remains unchanged.
  - If the source was deleted or replaced concurrently between split and commit, refuses the save and cleans up only this operation's staged files.
- **Authoritative Total Bounds:** Ranges are bounded by the receipt's authoritative total (`last_page <= receipt.authoritativeTotalPages`). Nested derivation is preserved ($S_R = S_A + s_c - 1$, $E_R = S_A + e_c - 1$, length $= e_c - s_c + 1$).
- **Historical Root Preservation:** On root deletion, foreign keys nullify `root_material_id` while preserving historical snapshot metadata. The immediate parent is never recorded as root.

### SL-R8: Structural Tier Classification & Edition Isolation
- **Structural Classification:** Classification of direct vs nested tiers is determined strictly by structure (`nested_level = 1` AND `parent_page_start IS NULL` for direct; `nested_level > 1` for nested). Never uses hash presence or nullness.
- **Candidate DDL CHECK Constraints:**
  - `CHECK ((nested_level = 1 AND parent_page_start IS NULL AND parent_page_end IS NULL AND parent_total_pages IS NULL) OR (nested_level > 1 AND parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL AND parent_total_pages IS NOT NULL))`
- **Two-Tier Source Verdicts:** For nested splits, `parentStatus` evaluates immediate parent $A$ and `rootStatus` evaluates root $R$. If `parent_content_sha256` is NULL, `parentStatus` is strictly `"unknown"`, even when root bytes match. Matching root bytes never certify an unknown parent tier.
- **Strict Effective Identity Sibling Isolation:** Direct siblings group on `root_material_id` + `source_content_sha256`. Nested siblings group on `parent_material_id` + `parent_content_sha256`. Unknown hashes never establish siblinghood (returns `[]`). Independently imported identical bytes remain isolated.

### SL-R9: Evidence Matching Claims & Mutation Robustness
- **Isolated Staging Cleanup:** `onRollbackCleanup` runs exactly once per failed operation and touches only the staging files owned by that failed operation, preserving concurrent staging files owned by other operations.
- **Deterministic Operation-ID Idempotency:** Operation ID derived deterministically from receipt and plan (`operationId = sha256(receiptHash:planHash)`). Resubmitting an acknowledged batch returns existing parts without duplicating database rows or files. Conflicting resubmissions are rejected.
- **Model-Level Reconciliation:** `reconcileBatch(db, operationId)` reads by operation ID, not caller memory.
- **Cancellation Semantics:** Cancellation before commit removes staging files; cancellation after commit keeps data intact.
- **Rebuilt Populated Lifecycle (Contract 14):**
  - Database initialized from shipped migrations `0001` through `0012`.
  - Parent and child histories (practice attempts, responses, card review state, review events) seeded *before* migration 0013.
  - Candidate migration 0013 applied.
  - Split performed through validated save with `SplitSourceReceipt`, creating distinct synthetic files.
  - Retained child practice and card histories added.
  - Source bytes replaced in-place, showing `changed` verdict.
  - Parent deleted (`ON DELETE SET NULL`), showing child histories survive.
  - Exported via `VACUUM INTO` and reopened with `PRAGMA foreign_keys = ON`, verifying 100% record integrity.
- **8 Genuine Mutants Killed by Named Assertions:** All 8 mutants evaluated in an isolated scratch directory (`mkdtempSync`), each killed by a specific named assertion with separate raw log, exit code, and hash verification receipts.
- **Page Translation API:** Main API uses explicit options `{ sourcePageEnd, childLength }`. Positional magnitude-guessing moved into a narrow compatibility adapter `mapChildPageToSourcePositionalCompat` used only by frozen legacy calls.

---

## 2. Requirements-to-Test Mapping

The following matrix categorizes all test cases across controls, guards, and reproductions:

| Requirement | Category | Test Case (`proof.test.mjs` / `lineage-round2-review.test.mjs`) | Verifies / Enforces |
| --- | :---: | --- | --- |
| **SL-R7: Authoritative Receipt** | **Control** | `Contract 11: Authoritative Receipt and Save Validation` | Valid batch save succeeds with valid receipt and hash. |
| **SL-R7: Missing Receipt Refusal** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Refuses save without receipt (`Invalid or missing SplitSourceReceipt`). |
| **SL-R7: Caller Hash Precedence Refusal** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Caller hash ignored; receipt hash is authoritative. |
| **SL-R7: In-Transaction Re-checks** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Concurrent source deletion/replacement detected inside `BEGIN IMMEDIATE`. |
| **SL-R7: Receipt Total Bounds** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Child ranges exceeding receipt total pages are rejected. |
| **SL-R7: Historical Root Preservation** | **Guard** | `Contract 10: Parent Deletion Preserves Child Material` | Root deletion sets `root_material_id = NULL`; snapshot metadata preserved; parent never recorded as root. |
| **SL-R8: Structural Tier Classification** | **Control** | `Contract 8: Source Version Evaluation` | Direct (`level=1`) evaluates root tier; nested (`level>1`) evaluates parent tier. |
| **SL-R8: Unknown Parent Tier** | **Guard** | `Contract 8: Source Version Evaluation` | NULL parent hash yields `parentStatus: 'unknown'` even when root matches. |
| **SL-R8: DDL Tier Constraints** | **Guard** | `Contract 6: Candidate DDL Constraints` | Rejects `nested_level = 1` with parent fields or `nested_level > 1` without parent fields. |
| **SL-R8: Sibling Effective Identity** | **Control** | `Contract 9: Sibling Navigation Isolates Editions` | Groups on root hash for direct, parent hash for nested; unknown returns `[]`. |
| **SL-R9: Isolated Cleanup** | **Control** | `Contract 17: Concurrent Staged Cleanup Isolation` | Failed operation cleans only its files; concurrent staged operation files untouched. |
| **SL-R9: Operation Idempotency** | **Control** | `Contract 18: Deterministic Operation-ID Idempotency & Cancellation` | Resubmitting acknowledged batch returns existing parts without duplicating rows/files. |
| **SL-R9: Conflict Refusal** | **Guard** | `Contract 18: Deterministic Operation-ID Idempotency & Cancellation` | Resubmission with different plan/receipt rejected as conflict. |
| **SL-R9: Rebuilt Lifecycle** | **Control** | `Contract 14: Disposable Export/Reopen & Lifecycle History Preservation` | Full lifecycle: pre-0013 seeding, candidate 0013, split with receipt, in-place change, parent delete, export/reopen. |
| **SL-R9: Explicit Page Mapping** | **Control** | `Contract 2: Page Translation Maps Child Position` | Explicit options `{ sourcePageEnd, childLength }` verified; adapter tested. |
| **Reviewer Baseline Reproduction** | **Reproduction** | `diagnostics/lineage-round2-review.test.mjs` (Baseline) | Exactly reproduces 3 passed / 8 failed baseline (exit 1). |
| **Reviewer Final Verification** | **Control** | `diagnostics/lineage-round2-review.test.mjs` (Final) | All 11 assertions pass verbatim (exit 0). |

---

## 3. Verification Receipts & Results Summary

| Suite / Check | Command | Exit Code | Result | Receipt File |
| --- | --- | :---: | :---: | --- |
| **Baseline Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/lineage-round2-review.test.mjs` | **1** | 3 passed / 8 failed (baseline reproduced) | `receipts/diagnostics-baseline.txt` & `.exit` |
| **Final Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/lineage-round2-review.test.mjs` | **0** | **11 passed / 0 failed** | `receipts/diagnostics-review-final.txt` & `.exit` |
| **Frozen Round 1 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** | `receipts/diagnostics-frozen-round1.txt` & `.exit` |
| **Frozen Round 2 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs` | **0** | **6 passed / 0 failed** | `receipts/diagnostics-frozen-round2.txt` & `.exit` |
| **Round 3 Proof Suite (18 Contracts)** | `node --test docs/evidence/m2-split-lineage-scope-round3-2026-10-08/proof/proof.test.mjs` | **0** | **18 passed / 0 failed** | `receipts/proof-run.txt` & `.exit` |
| **Isolated Mutation Checks** | `node docs/evidence/m2-split-lineage-scope-round3-2026-10-08/proof/mutationChecks.mjs` | **0** | **8/8 mutants killed by named assertions (exit 0)** | `receipts/mutation-checks.txt` & `.exit` |
| **Original Scope Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **9/9 OK** | Preserved immutable |
| **First Review Pack Checksums** | `(cd docs/evidence/m2-split-lineage-review-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **20/20 OK** | Preserved immutable |
| **Round 1 Corrections Checksums** | `(cd docs/evidence/m2-split-lineage-scope-corrections-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **18/18 OK** | Preserved immutable |
| **Round 2 Re-review Checksums** | `(cd docs/evidence/m2-split-lineage-rereview-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **19/19 OK** | Preserved immutable |
| **Round 2 Corrections Checksums** | `(cd docs/evidence/m2-split-lineage-scope-round2-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **22/22 OK** | Preserved immutable |
| **Round 3 Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-round3-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **37/37 OK** | Self-verified |

---

## 4. Mutation Sensitivity Results (`mutationChecks.mjs`)

Every mutant was evaluated in a fresh, isolated temporary workspace (`mkdtempSync`), killed by a specific named assertion, and recorded in separate per-mutant receipt files (`mutant-1..8.txt` and `.exit`):

| Mutant ID | Targeted Logic | Mutation Description | Named Killing Assertion | Exit | Receipt |
| --- | --- | --- | --- | :---: | --- |
| **MUTANT-1** | `lineageContract.mjs` | Off-by-one in `composeNestedRanges` (`+ 1` instead of `- 1`) | Contract 3 assertion: `composed.sourcePageStart === 120` | **1** | `receipts/mutations/mutant-1.txt` |
| **MUTANT-2** | `lineageContract.mjs` | Upper bound removed from `mapChildPageToSource` | Contract 2 named error: `Child page exceeds document length` | **1** | `receipts/mutations/mutant-2.txt` |
| **MUTANT-3** | `candidate_migration_0013.sql` | `TYPEOF(...) = 'integer'` checks removed from DDL | Contract 6 named rejection: fractional page `101.5` rejected | **1** | `receipts/mutations/mutant-3.txt` |
| **MUTANT-4** | `candidate_migration_0013.sql` | `CHECK (material_id != root_material_id)` removed from DDL | Contract 7 named rejection: self-referential root rejected | **1** | `receipts/mutations/mutant-4.txt` |
| **MUTANT-5** | `lineageContract.mjs` | Receipt verification gate made optional in `validateAndSaveSplitBatch` | Contract 11 named rejection: missing receipt must throw | **1** | `receipts/mutations/mutant-5.txt` |
| **MUTANT-6** | `lineageContract.mjs` | Caller hash precedence restored over receipt | Contract 11 named rejection: caller hash override refused | **1** | `receipts/mutations/mutant-6.txt` |
| **MUTANT-7** | `lineageContract.mjs` | Hash-nullness tier heuristic restored over structural check | Contract 8 named assertion: nested parentStatus must be unknown | **1** | `receipts/mutations/mutant-7.txt` |
| **MUTANT-8** | `lineageContract.mjs` | Sibling `COALESCE` grouping restored over effective identity | Contract 9 named assertion: nested siblings isolated from root | **1** | `receipts/mutations/mutant-8.txt` |

---

## 5. Pack File Manifest

- `candidate_migration_0013.sql`: Authoritative candidate DDL with structural tier CHECK constraints.
- `proof/package.json`: ES module package configuration.
- `proof/lineageContract.mjs`: Corrected exported contract model (`SplitSourceReceipt`, structural tiers, operation-ID idempotency, isolated cleanup, bounds).
- `proof/proof.test.mjs`: 18 comprehensive test contracts covering all SL-R7–SL-R9 requirements.
- `proof/mutationChecks.mjs`: Isolated scratch workspace mutation runner evaluating 8 mutants against named assertions.
- `diagnostics/lineage-round2-review.test.mjs`: Verbatim copy of new reviewer diagnostic suite (11 assertions).
- `diagnostics/forwardingAdapter.mjs` & `forwardingLoader.mjs`: Node loader adapter mapping test imports to Round 3 contract.
- `receipts/diagnostics-baseline.txt` & `.exit`: Baseline reviewer diagnostic execution log (3 passed / 8 failed, exit 1).
- `receipts/diagnostics-review-final.txt` & `.exit`: Final reviewer diagnostic execution log (11 passed / 0 failed, exit 0).
- `receipts/diagnostics-frozen-round1.txt` & `.exit`: Frozen Round 1 diagnostic log (7 passed, exit 0).
- `receipts/diagnostics-frozen-round2.txt` & `.exit`: Frozen Round 2 diagnostic log (6 passed, exit 0).
- `receipts/proof-run.txt` & `.exit`: Proof suite execution log (18 passed, exit 0).
- `receipts/mutation-checks.txt` & `.exit`: Overall mutation testing run log (8/8 killed, exit 0).
- `receipts/mutations/mutant-1..8.txt` & `.exit`: Per-mutant raw logs and exit codes.
- `source-hashes.json`: Cryptographic hashes of all 6 tracked project documents.
- `SHA256SUMS`: Cryptographic checksums of all files in this evidence pack.
