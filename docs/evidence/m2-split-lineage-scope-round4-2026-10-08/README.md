# M2 Split-Source Lineage Scope — Correction Evidence Pack (Round 4)

> [!IMPORTANT]
> **ROUND 4 CORRECTIONS COMPLETE — SCOPE AND CONTRACT PROVEN FOR SENIOR REVIEW.**
> This evidence pack documents the bounded corrections for review findings **SL-R10** and **SL-R11** on Milestone 2 split-source lineage.
> All owner defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent scope review and recorded owner approval.
> No production migration, schema-version bump, application source change, installed/package testing, or release work is authorized.

---

## 1. Executive Summary & Review Findings Addressed

Following the senior review of Round 3, Round 4 corrections were completed in `/Users/rickymac/code/Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`).

### SL-R10: The Receipt is the Sole Authority
- **Receipt-Less Save Path Removed Entirely:**
  - Removed `expectedParentSha256` and `currentParentBytes` save inputs.
  - Removed caller `parts` passed alongside a receipt.
  - Removed caller-supplied `operationId`.
  - Removed `parts[0].sourceTotalPages` fallback and the 1,000-page arbitrary fallback.
  - `validateAndSaveSplitBatch` accepts only a typed `SplitSourceReceipt` (with optional tags and cleanup callbacks); anything else is refused before any database or filesystem write.
- **Tamper-Evident Receipts Bound to the Database:**
  - At split time, `createSplitSourceReceipt` persists the receipt in `split_operation_log` with status `pending`, along with its canonical serialized JSON and its SHA-256 hash.
  - The save path requires a receipt whose canonical JSON hash matches an active `pending` row in `split_operation_log` for the exact source material. Any alteration to page total, plan selections, output identities, source hash, or lineage snapshot results in refusal before writing.
  - **Production Architecture Specified:** In production, the native split worker (`pdf.rs`) issues the receipt directly upon inspection/splitting, and the webview cannot mint or forge receipts.
- **Strict Stored File Requirement:**
  - Missing or unreadable source file on disk strictly refuses both receipt creation and save with verdict `missing`.
  - Caller bytes are never accepted as a substitute. A material without a stored, readable file cannot be split.
- **In-Transaction Snapshot Verification Inside `BEGIN IMMEDIATE`:**
  - Inside `BEGIN IMMEDIATE`, the parent's persisted lineage row (root ID, root hash, root range, total, and nested level) and current file path are compared directly against the receipt's snapshot.
  - Any detected discrepancy aborts the transaction, unlinks only this operation's staged files, and refuses the save.
  - The meaningless redundant double-read file check has been deleted; disk verification sits honestly before the transaction, and the database lock guarantees transactional integrity.
- **Engine Page Total Authority:**
  - The receipt's total is the engine's authoritative page count measured at split time.
  - The JavaScript model accepts this total as input from the split engine. In production, this value must originate exclusively from `pdf.rs`, never from the webview.

### SL-R11: Idempotency, Cancellation, and Evidence Integrity
- **`split_operation_log` Moved to `candidate_migration_0013.sql`:**
  - Schema definition:
    - `operation_id TEXT PRIMARY KEY NOT NULL`
    - `source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE`
    - `receipt_canonical_json TEXT NOT NULL`
    - `receipt_hash TEXT NOT NULL`
    - `status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled'))`
    - `created_at INTEGER NOT NULL`
    - `updated_at INTEGER NOT NULL`
  - Completely omitted from the test helper `createDisposableLineageDb`, so baseline setup under migrations `0001` through `0012` exactly mirrors the shipped database schema. Contract 13 explicitly asserts that `split_operation_log` does not exist prior to candidate migration 0013.
- **Operation IDs Derived Exclusively from the Receipt:**
  - `operation_id = sha256(canonicalJson(receipt))` is minted at split time and stored in the receipt.
  - Replay of an already-committed receipt is fully idempotent: it detects the `committed` state in `split_operation_log` and returns the persisted database rows without re-executing writes or duplicating files.
  - Attempting to submit a *different* receipt whose output identities collide with already-committed materials in the library is refused before any write with a named `OutputMaterialAlreadyExistsError` (not an unhandled primary key constraint violation).
  - Reconciliation reads by operation ID (`reconcileBatch(db, operationId)`).
- **Real `cancelBatch(db, operationId)`:**
  - Before commit: transition status from `pending` to `cancelled`, and physically unlinks only the staged output files recorded for that operation ID.
  - After commit: leaves the committed operation and its output files entirely untouched (no-op).
  - Any subsequent attempt to save a cancelled receipt is refused (`Operation was cancelled`).
  - Proven with real files on disk across two independent operations.
- **Sandboxed Mutation Driver:**
  - `mutationChecks.mjs` accepts an explicit output directory as `argv[2]` and executes against a temporary isolated workspace (`mkdtempSync`), ensuring it never modifies or pollutes a sealed evidence pack.
  - Added 4 new targeted mutants (12 total):
    1. Receipt-less save restored.
    2. Receipt hash check skipped.
    3. Nested snapshot comparison removed.
    4. Operation log restored in test helper.
  - All 12/12 mutants are killed by named assertions (exit 0).
- **Superseded Diagnostic Disclosed:**
  - `lineage-round2-review.test.mjs` is preserved unmodified as superseded. Controls 1–2 and case 11 fail as expected because they relied on receipt-less saves which are now rejected. All 8 other cases continue to pass.

---

## 2. Requirements-to-Test Mapping

The following matrix categorizes all test cases across controls, guards, reproductions, and disclosed retirements:

| Requirement | Category | Test Case (`proof.test.mjs` / `diagnostics/`) | Verifies / Enforces |
| --- | :---: | --- | --- |
| **SL-R10: Mandatory Receipt Enforcement** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Receipt-less save strictly rejected (`A valid SplitSourceReceipt is required; unverified split refused`). |
| **SL-R10: No Caller Provenance Overrides** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Caller hash/range overrides rejected; plan and bounds derived only from receipt. |
| **SL-R10: Tamper-Evident Receipt Binding** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Edited total or plan yields hash mismatch against `split_operation_log` and is refused. |
| **SL-R10: Missing Source Refusal** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Missing/unreadable source file refuses receipt creation and save with verdict `missing`. |
| **SL-R10: In-Transaction Snapshot Check** | **Guard** | `Contract 11: Authoritative Receipt and Save Validation` | Changed parent lineage row or file path inside `BEGIN IMMEDIATE` refuses save and cleans staging. |
| **SL-R11: Migration 0013 Operation Log** | **Control** | `Contract 13: Candidate Migration 0013 and Baseline Parity` | `split_operation_log` absent under 0001–0012; present and fully constrained after 0013. |
| **SL-R11: Operation ID Replay** | **Control** | `Contract 18: Deterministic Operation-ID Idempotency & Real Cancellation` | Replaying committed receipt returns persisted rows without duplicating database rows or files. |
| **SL-R11: Output Identity Collision Refusal** | **Guard** | `Contract 18: Deterministic Operation-ID Idempotency & Real Cancellation` | Conflicting receipt reusing output identities throws named `OutputMaterialAlreadyExistsError` before write. |
| **SL-R11: Real Cancellation Before Commit** | **Control** | `Contract 18: Deterministic Operation-ID Idempotency & Real Cancellation` | `cancelBatch` marks operation `cancelled` and unlinks recorded staging files. Subsequent save refused. |
| **SL-R11: Cancellation No-op After Commit** | **Control** | `Contract 18: Deterministic Operation-ID Idempotency & Real Cancellation` | `cancelBatch` on committed operation preserves database state and committed files. |
| **SL-R7/8: Structural Tiers & CHECKs** | **Control** | `Contract 6: Candidate DDL Constraints` | Structural tier DDL constraints validated (`nested_level = 1` vs `> 1`). |
| **SL-R7/8: Real File Two-Tier Veracity** | **Control** | `Contract 8: Source Version Evaluation` | Two-tier verdict correctly distinguishes match/changed/missing/unknown based on disk and snapshot. |
| **SL-R7/8: Effective Identity Sibling Isolation** | **Control** | `Contract 9: Sibling Navigation Isolates Editions` | Sibling navigation isolates editions using root hash (direct) or parent hash (nested). |
| **SL-R7/8: Parent Deletion Retention** | **Control** | `Contract 10: Parent Deletion Preserves Child Material` | Parent material deletion sets parent foreign key to NULL while retaining child record and snapshot. |
| **SL-R9: Lifecycle History Preservation** | **Control** | `Contract 14: Disposable Export/Reopen & Lifecycle History Preservation` | Full lifecycle under shipped 0001–0012 + candidate 0013 survives export/reopen with FKs ON. |
| **Reviewer Round 3 Diagnostic (Baseline)** | **Reproduction** | `diagnostics/lineage-round3-review.test.mjs` (Baseline) | Exactly reproduces 5 passed / 7 failed baseline (exit 1). |
| **Reviewer Round 3 Diagnostic (Final)** | **Control** | `diagnostics/lineage-round3-review.test.mjs` (Final) | All 12 assertions pass verbatim (exit 0). |
| **Frozen Round 1 Diagnostic** | **Control** | `lineage-review.test.mjs` via `forwardingAdapter.mjs` | All 7 assertions pass (exit 0). |
| **Frozen Round 2 Diagnostic** | **Control** | `lineage-round2.test.mjs` via `forwardingAdapter.mjs` | All 6 assertions pass (exit 0). |
| **Superseded Round 2 Diagnostic** | **Disclosed Retirement**| `lineage-round2-review.test.mjs` | 8 passed / 3 failed (exit 1). Controls 1–2 and case 11 retired due to mandatory receipt enforcement. |

---

## 3. Verification Receipts & Results Summary

| Suite / Check | Command | Exit Code | Result | Receipt File |
| --- | --- | :---: | :---: | --- |
| **Baseline Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/lineage-round3-review.test.mjs` | **1** | 5 passed / 7 failed (baseline reproduced) | `receipts/diagnostics-baseline.txt` & `.exit` |
| **Final Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/lineage-round3-review.test.mjs` | **0** | **12 passed / 0 failed** | `receipts/diagnostics-review-final.txt` & `.exit` |
| **Frozen Round 1 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** | `receipts/diagnostics-frozen-round1.txt` & `.exit` |
| **Frozen Round 2 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/round2CompatAdapter.mjs --test docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs` | **0** | **6 passed / 0 failed** | `receipts/diagnostics-frozen-round2.txt` & `.exit` |
| **Superseded Round 2 Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round4-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-scope-round3-2026-10-08/diagnostics/lineage-round2-review.test.mjs` | **1** | **8 passed / 3 failed** (Controls 1–2, Case 11 retired) | `receipts/diagnostics-round2-superseded.txt` & `.exit` |
| **Round 4 Proof Suite (18 Contracts)** | `node --test docs/evidence/m2-split-lineage-scope-round4-2026-10-08/proof/proof.test.mjs` | **0** | **18 passed / 0 failed** | `receipts/proof-run.txt` & `.exit` |
| **Sandboxed Mutation Checks** | `node docs/evidence/m2-split-lineage-scope-round4-2026-10-08/proof/mutationChecks.mjs docs/evidence/m2-split-lineage-scope-round4-2026-10-08/receipts` | **0** | **12/12 mutants killed by named assertions (exit 0)** | `receipts/mutation-checks.txt` & `.exit` |
| **Original Scope Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **9/9 OK** | Preserved immutable |
| **First Review Pack Checksums** | `(cd docs/evidence/m2-split-lineage-review-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **20/20 OK** | Preserved immutable |
| **Round 1 Corrections Checksums** | `(cd docs/evidence/m2-split-lineage-scope-corrections-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **18/18 OK** | Preserved immutable |
| **Round 2 Re-review Checksums** | `(cd docs/evidence/m2-split-lineage-rereview-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **19/19 OK** | Preserved immutable |
| **Round 2 Corrections Checksums** | `(cd docs/evidence/m2-split-lineage-scope-round2-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **22/22 OK** | Preserved immutable |
| **Round 3 Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-round3-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **38/38 OK** | Preserved immutable |
| **Round 4 Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-round4-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **46/46 OK** | Self-verified |

---

## 4. Mutation Sensitivity Results (`mutationChecks.mjs`)

Every mutant was evaluated in a fresh, isolated temporary workspace (`mkdtempSync`), killed by a specific named assertion, and recorded in separate per-mutant receipt files (`mutant-1..12.txt` and `.exit`):

| Mutant ID | Targeted Logic | Mutation Description | Named Killing Assertion | Exit | Receipt |
| --- | --- | --- | --- | :---: | --- |
| **MUTANT-1** | `lineageContract.mjs` | Off-by-one in `composeNestedRanges` (`+ 1` instead of `- 1`) | Contract 3 assertion: `composed.sourcePageStart === 120` | **1** | `receipts/mutations/mutant-1.txt` |
| **MUTANT-2** | `lineageContract.mjs` | Upper bound removed from `mapChildPageToSource` | Contract 2 named error: `Child page exceeds document length` | **1** | `receipts/mutations/mutant-2.txt` |
| **MUTANT-3** | `candidate_migration_0013.sql` | `TYPEOF(...) = 'integer'` checks removed from DDL | Contract 6 named rejection: fractional page bounds rejected | **1** | `receipts/mutations/mutant-3.txt` |
| **MUTANT-4** | `candidate_migration_0013.sql` | `CHECK (material_id != parent_material_id)` removed from DDL | Contract 7 named rejection: self-parenting rejected | **1** | `receipts/mutations/mutant-4.txt` |
| **MUTANT-5** | `lineageContract.mjs` | Hash-nullness tier heuristic restored over structural check | Contract 8 named assertion: nested parentStatus must be unknown | **1** | `receipts/mutations/mutant-5.txt` |
| **MUTANT-6** | `lineageContract.mjs` | Sibling `COALESCE` grouping restored over effective identity | Contract 9 named assertion: nested siblings isolated from root | **1** | `receipts/mutations/mutant-6.txt` |
| **MUTANT-7** | `lineageContract.mjs` | Planned output material ID collision check skipped | Contract 18 named error: `Planned output material ID already exists` | **1** | `receipts/mutations/mutant-7.txt` |
| **MUTANT-8** | `lineageContract.mjs` | Cancellation after commit allowed to mutate database/delete files | Contract 18 named assertion: cancellation after commit must be no-op | **1** | `receipts/mutations/mutant-8.txt` |
| **MUTANT-9** | `lineageContract.mjs` | Receipt-less save path restored | Contract 11 named error: `A valid SplitSourceReceipt is required` | **1** | `receipts/mutations/mutant-9.txt` |
| **MUTANT-10** | `lineageContract.mjs` | Receipt hash check against `split_operation_log` skipped | Contract 11 named error: `Receipt hash mismatch or unrecorded receipt` | **1** | `receipts/mutations/mutant-10.txt` |
| **MUTANT-11** | `lineageContract.mjs` | In-transaction nested parent snapshot comparison removed | Contract 11 named error: `Parent lineage snapshot has changed since split` | **1** | `receipts/mutations/mutant-11.txt` |
| **MUTANT-12** | `proof.test.mjs` | `split_operation_log` restored inside test helper | Contract 13 named assertion: table must not exist in 0001–0012 | **1** | `receipts/mutations/mutant-12.txt` |

---

## 5. Pack File Manifest

- `candidate_migration_0013.sql`: Authoritative candidate DDL containing `material_split_lineage` and `split_operation_log`.
- `proof/package.json`: ES module package configuration.
- `proof/lineageContract.mjs`: Complete contract model enforcing mandatory receipts, database-bound tamper resistance, structural tiers, idempotency, and cancellation.
- `proof/proof.test.mjs`: 18 comprehensive test contracts covering all SL-R10 and SL-R11 requirements.
- `proof/mutationChecks.mjs`: Sandboxed mutation driver evaluating 12 mutants against named assertions.
- `diagnostics/lineage-round3-review.test.mjs`: Verbatim copy of Round 3 reviewer diagnostic suite (12 assertions).
- `diagnostics/forwardingAdapter.mjs` & `forwardingLoader.mjs`: Node loader and import adapter forwarding tests to Round 4 contract.
- `diagnostics/round2CompatAdapter.mjs`: Compatibility adapter for frozen Round 2 legacy test suite.
- `receipts/diagnostics-baseline.txt` & `.exit`: Baseline reviewer diagnostic log (5 passed / 7 failed, exit 1).
- `receipts/diagnostics-review-final.txt` & `.exit`: Final reviewer diagnostic log (12 passed / 0 failed, exit 0).
- `receipts/diagnostics-frozen-round1.txt` & `.exit`: Frozen Round 1 diagnostic log (7 passed, exit 0).
- `receipts/diagnostics-frozen-round2.txt` & `.exit`: Frozen Round 2 diagnostic log (6 passed, exit 0).
- `receipts/diagnostics-round2-superseded.txt` & `.exit`: Superseded Round 2 reviewer diagnostic log (8 passed / 3 failed, exit 1).
- `receipts/proof-run.txt` & `.exit`: Round 4 proof suite execution log (18 passed, exit 0).
- `receipts/mutation-checks.txt` & `.exit`: Overall mutation testing run log (12/12 killed, exit 0).
- `receipts/mutations/mutant-1..12.txt` & `.exit`: Per-mutant raw logs and exit codes.
- `source-hashes.json`: Cryptographic hashes of all 6 tracked project documents.
- `SHA256SUMS`: Cryptographic checksums of all files in this evidence pack.
