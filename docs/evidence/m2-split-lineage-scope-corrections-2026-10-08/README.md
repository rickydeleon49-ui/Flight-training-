# M2 Split-Source Lineage Scope — Correction Evidence Pack (Round 1)

> [!IMPORTANT]
> **ROUND 1 CORRECTIONS COMPLETE — SCOPE AND CONTRACT PROVEN FOR SENIOR RE-REVIEW.**
> This evidence pack documents the focused corrections for review findings **SL-R1**, **SL-R2**, and **SL-R3** on Milestone 2 split-source lineage.
> All owner defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent scope re-review and recorded owner approval.
> No production migration, schema-version bump, application source change, installed/package testing, or release work is authorized.

---

## 1. Executive Summary & Review Findings Addressed

Following the independent scope review (`docs/M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md`), one focused correction round was conducted in `/Users/rickymac/code/Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`).

### SL-R1: Source Identity, Versions, and Navigation Contract
- **Root vs Immediate Parent Tiering:** Separated original root document ($R$) identity/snapshot from immediate parent part ($A$).
  - Every field unambiguously defined: `source_page_start`, `source_page_end`, `source_file_name`, `source_title`, `source_content_sha256`, `source_total_pages` represent root $R$; `parent_page_start`, `parent_page_end`, `parent_file_name`, `parent_title`, `parent_content_sha256`, `parent_total_pages` represent parent $A$.
- **Persisted Two-Tier Canonical Example:** Persisted and proved the required example in disposable SQLite:
  - Root $R = 400$ pages.
  - Part $A$ covers $R$ pages 101–300 (length = 200).
  - Child $B$ takes $A$ pages 20–40 (length = 21).
  - Composed root range for $B$: $R$ pages 120–140 ($101 + 20 - 1 = 120$ to $101 + 40 - 1 = 140$).
  - Opening $A$ in viewer at $B$ requires **page 20**; opening $R$ in viewer at $B$ requires **page 120**.
  - Child length is **21**, neither 400 nor 200.
- **Read-Only Source Version Verdict:** Implemented `evaluateSourceVersion` at the model boundary returning `"matching"`, `"changed"`, `"missing"`, `"deleted"`, or `"unknown"`. Live file byte hashing is conducted outside render loops.
- **Sibling Isolation Across Editions:** `listSiblings` groups parts sharing `parent_material_id` AND matching `parent_content_sha256`. Parts from an older parent handbook edition do not mix with parts from a newer replaced edition.
- **Atomic Batch Save & Error Lifecycle:** `validateAndSaveSplitBatch` enforces pre-validation, stale-source parent hash verification, pinned transaction across `study_materials`, `material_tags`, and `material_split_lineage`, rollback on failure, and staging file cleanup. Acknowledged save followed by failed UI refresh guarantees database consistency.
- **Unmeasured Claims Removed:** Removed unmeasured "~30–50 ms" hashing speed and "90%+" prevalence claims.

### SL-R2: Bounds and Relational Invariants
- **Upper-Bound & Safe Integer Enforcement:** `mapChildPageToSource` receives recorded range end or child length; rejects child positions $> \text{childLength}$ (e.g. child covering 101–300 has length 200; page 201 is rejected). Rejects non-integers, fractional numbers, zero, negative numbers, non-finite values (`NaN`, `Infinity`), and unsafe values.
- **Authoritative Candidate DDL:** Single authoritative file `candidate_migration_0013.sql` executed in proof and exported directly:
  - Enforces `material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE`.
  - Enforces physical page integer bounds via SQLite `CHECK (TYPEOF(...) = 'integer' AND ...)`, strictly rejecting fractional floats (e.g. `101.5`).
  - Enforces `CHECK (material_id != parent_material_id)` and `CHECK (material_id != root_material_id)`.
  - Enforces `CHECK (child_page_count = (source_page_end - source_page_start + 1))`.
  - Enforces `CHECK ((parent_page_start IS NULL AND parent_page_end IS NULL) OR (parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL AND parent_page_end >= parent_page_start))`.

### SL-R3: Faithful Schema & Genuine Sensitivity Evidence
- **Shipped Migrations 0001–0012 Baseline:** `createDisposableLineageDb` executes the actual shipped SQL migrations `0001_initial_schema.sql` through `0012_card_reviews.sql` directly against SQLite. No invented tables; `practice_attempts` and `card_review_state` tables exist and are populated with representative accepted rows.
- **Disk File & Database Preservation:** Tested using synthetic temporary PDF files written to disk; verified byte-for-byte preservation through candidate migration 0013, split operations, and parent deletion (`ON DELETE SET NULL`). Verified database export (`VACUUM INTO`) and reopen.
- **Honest Simulation Boundaries:** Explicitly documented numeric version check as a simulation of `backup.rs:631` while citing existing accepted native backup test suites.
- **Genuine Mutation Sensitivity Testing:** Replaced disconnected negative controls with `mutationChecks.mjs`. Tested 4 real code mutations in scratch copies of the exported helper and candidate DDL. Each mutant resulted in an actual test failure (exit 1), followed by exact SHA-256 restoration check.

---

## 2. Verification Receipts & Results Summary

| Suite / Check | Command | Exit Code | Result | Receipt File |
| --- | --- | :---: | :---: | --- |
| **Baseline Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **1** | 2 passed / 5 failed (baseline reproduced) | `receipts/diagnostics-baseline.txt` |
| **Final Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** | `receipts/diagnostics-final.txt` |
| **Frozen Diagnostic via Adapter** | `node --import ./docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** (frozen reviewer file untouched) | `receipts/diagnostics-final.txt` |
| **Corrected Proof Suite (15 Contracts)** | `node --test docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/proof.test.mjs` | **0** | **15 passed / 0 failed** | `receipts/proof-run.txt` |
| **Real Mutation Checks** | `node docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/mutationChecks.mjs` | **0** | **4/4 mutations caught (exit 1), exact hashes restored** | `receipts/mutation-checks.txt` |
| **Original Proof (Preserved)** | `node --test docs/evidence/m2-split-lineage-scope-2026-10-08/proof/proof.test.mjs` | **0** | **13 passed / 0 failed** | Preserved immutable |
| **Original Evidence SHA256SUMS** | `(cd docs/evidence/m2-split-lineage-scope-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **9/9 OK** | Preserved immutable |
| **Reviewer Evidence SHA256SUMS** | `(cd docs/evidence/m2-split-lineage-review-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **20/20 OK** | Preserved immutable |

---

## 3. Real Mutation Sensitivity Results (`mutationChecks.mjs`)

| Mutant ID | Targeted Component & Description | Semantic Change | Actual Test Failure | Status |
| --- | --- | --- | --- | :---: |
| **MUTANT-1** | `lineageContract.mjs`<br>`composeNestedRanges` | Omit `- 1` in composed range start calculation | Contract 3 fails on `Composed R start` assertion (expected 120, got 121) | **CAUGHT (Exit 1)** |
| **MUTANT-2** | `lineageContract.mjs`<br>`mapChildPageToSource` | Remove `childPage > childLength` upper-bound check | Contract 2 & Reviewer test fail with `Missing expected exception` on page 201 | **CAUGHT (Exit 1)** |
| **MUTANT-3** | `candidate_migration_0013.sql`<br>Column constraints | Remove `TYPEOF(...) = 'integer'` checks across table | Contract 6 & Reviewer test fail: SQLite admits `101.5`, missing expected exception | **CAUGHT (Exit 1)** |
| **MUTANT-4** | `candidate_migration_0013.sql`<br>Cycle constraints | Remove `CHECK (material_id != root_material_id)` constraint | Contract 7 & Reviewer test fail: SQLite admits `rootMaterialId: 'c'`, missing exception | **CAUGHT (Exit 1)** |

All 4 mutants caused genuine semantic assertion failures and exited with code 1. In every case, immediate restoration was confirmed by matching exact SHA-256 digests.

---

## 4. Pack File Manifest

- `candidate_migration_0013.sql`: Authoritative candidate DDL migration for split lineage metadata.
- `proof/lineageContract.mjs`: Corrected exported contract model, page translation arithmetic, two-tier navigation, version evaluation, and SQLite database helpers.
- `proof/proof.test.mjs`: 15 comprehensive automated test contracts covering SL-R1, SL-R2, and SL-R3.
- `proof/mutationChecks.mjs`: Genuine mutation testing script verifying assertion sensitivity against scratch copies.
- `proof/package.json`: Package configuration declaring ES module type for test execution.
- `diagnostics/lineage-review.test.mjs`: Diagnostic assertions mirroring the reviewer suite, directed to corrected contract.
- `diagnostics/forwardingAdapter.mjs` & `forwardingLoader.mjs`: Custom Node loader adapter directing the frozen reviewer diagnostic to the corrected contract without modifying frozen files.
- `receipts/proof-run.txt` & `.exit`: Raw test execution log and exit code for `proof.test.mjs` (exit 0).
- `receipts/diagnostics-baseline.txt` & `.exit`: Raw test execution log and exit code for baseline reviewer diagnostic (exit 1).
- `receipts/diagnostics-final.txt` & `.exit`: Raw test execution log and exit code for final reviewer diagnostic (exit 0).
- `receipts/mutation-checks.txt` & `.exit`: Raw test execution log and exit code for `mutationChecks.mjs` (exit 0).
- `source-hashes.json`: SHA-256 digests of all tracked project documents.
- `SHA256SUMS`: Cryptographic checksums of all files in this evidence pack.

---

## 5. Scope Boundaries, Preserved State & Limitations

1. **Proposed Defaults (SL-D1–SL-D8):** Product defaults remain **PROPOSED**. Owner approval is required before production implementation.
2. **Preserved Production State:** Shipped migrations 0001–0012, `CURRENT_SCHEMA_VERSION = 12`, application source code (`src/`, `src-tauri/`), and accepted Milestone 2 Slice C2 library review source remain untouched.
3. **Preserved Evidence Packs:** Original scope pack `docs/evidence/m2-split-lineage-scope-2026-10-08/` (9 checksums) and reviewer pack `docs/evidence/m2-split-lineage-review-2026-10-08/` (20 checksums) remain 100% byte-for-byte identical.
4. **No Unauthorized Work:** No installed-app, real-user, signing, or release work was conducted during this planning round.
