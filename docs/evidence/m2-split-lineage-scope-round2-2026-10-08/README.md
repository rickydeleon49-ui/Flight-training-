# M2 Split-Source Lineage Scope — Correction Evidence Pack (Round 2)

> [!IMPORTANT]
> **ROUND 2 CORRECTIONS COMPLETE — SCOPE AND CONTRACT PROVEN FOR SENIOR RE-REVIEW.**
> This evidence pack documents the focused corrections for review findings **SL-R4**, **SL-R5**, and **SL-R6** on Milestone 2 split-source lineage.
> All owner defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent scope review and recorded owner approval.
> No production migration, schema-version bump, application source change, installed/package testing, or release work is authorized.

---

## 1. Executive Summary & Review Findings Addressed

Following the senior re-review (`docs/M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md`), Round 2 corrections were completed in `/Users/rickymac/code/Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`).

### SL-R4: Coherent Direct-Split Tier & Nested Version Verification
- **Direct Representation Resolution:** Direct splits store source identity in root fields (`source_*`) and NULL the duplicate parent fields. Implemented an effective immediate-source accessor `COALESCE(parent_content_sha256, source_content_sha256)`. For direct splits (`nested_level = 1`), the immediate parent IS the root handbook, so immediate source verification and sibling grouping evaluate against the recorded root edition hash (`source_content_sha256`).
- **Full Direct Verification Matrix:** Proved directly split root reports `"matching"` for matching live bytes, `"changed"` for altered bytes, `"unknown"` for unread bytes, `"missing"` for absent file, and `"deleted"` when the parent material entity is deleted.
- **Edition-Correct Sibling Isolation:** `listSiblings` queries with `COALESCE(parent_content_sha256, source_content_sha256) = effectiveParentHash`. Proved two editions under the same parent material ID never mix in siblings. Independently imported materials with identical bytes remain distinct because `parent_material_id` filters strictly by parent ID.
- **Conservative Unknown Hash Policy:** Unknown hashes never establish edition equality; parts with NULL or empty hashes return an empty sibling list (`[]`).
- **Distinct Nested Version Statuses:** For nested splits (`nested_level > 1`), `getMaterialWithLineage` exposes distinct `parentStatus` (status of immediate parent $A$) and `rootStatus` (status of original root $R$). A matching $A$ does not certify $R$. Preserves canonical coordinates: $R = 400$, $A = 101\text{–}300$, $B = A20\text{–}40 \implies R120\text{–}140$, child length 21; parent navigation 20, root navigation 120.

### SL-R5: Binding Saves to Authoritative Source Context & Nested Validation
- **Typed Save Context & Refusal:** If `expectedParentSha256` is specified, `currentParentBytes` is required. If omitted or null, `validateAndSaveSplitBatch` immediately throws and invokes rollback cleanup. Saves are bound strictly to verified split-time bytes.
- **Nested Range Validation & Derivation:** When saving parts with a parent that already has split lineage, `validateAndSaveSplitBatch` queries the parent's persisted lineage, validates that child parent range $[s_c, e_c]$ does not exceed parent child page count, and derives canonical root coordinates:
  $$S_R = S_A + s_c - 1, \quad E_R = S_A + e_c - 1$$
  Any contradictory caller-supplied root range (such as $R = 1\text{–}21$ vs derived $120\text{–}140$), contradictory `rootMaterialId`, wrong `sourceTotalPages`, or conflicting `nestedLevel` is rejected before any database write occurs.
- **Parent Deletion Safety:** Foreign keys use `ON DELETE SET NULL`. If parent material is deleted, child materials survive completely intact with immutable snapshot metadata preserved.
- **Bounded Retry & Reconciliation:** If save transaction commits but subsequent UI refresh fails, the model boundary invokes read-only reconciliation `reconcileFailedRefresh` using existing IDs, preventing duplicate parts or re-splitting.
- **Explicit Engine & Page Bounds:** Explicitly stated JS safe-integer limits ($2^{53}-1$), SQLite 64-bit integer limits ($2^{63}-1$), and PDF 32-bit positive page index limits ($2^{31}-1$).

### SL-R6: Promoted Rollback, Populated Lifecycle, & Isolated Mutation Testing
- **Promoted Mid-Transaction Rollback Control:** Promoted the reviewer's trigger control into Contract 11. An injected trigger raises failure during the second lineage insert after earlier material and tag writes. Verified complete transaction rollback (0 batch rows in `study_materials`, `material_split_lineage`, `material_tags`, `tags`) and verified that real temporary staging files on disk are deleted by `onRollbackCleanup`.
- **Retained Child History Lifecycle (Contract 14):**
  - Database initialized from exact shipped migrations `0001_initial_schema.sql` through `0012_card_reviews.sql`.
  - Distinct synthetic PDF files on disk for parent (`synthetic_parent.pdf`) and child (`synthetic_child.pdf`).
  - Seeded parent practice version, item, attempt, and responses.
  - Applied candidate migration 0013 and split child part with lineage referencing parent.
  - Seeded representative practice version, item, attempt, and responses owned by the **retained child part** under real constraints.
  - Seeded representative card version, items, review state, and review events owned by the **retained child part** under real constraints.
  - Deleted parent material (`DELETE FROM study_materials WHERE id = 'mat-parent'`).
  - Verified parent attempt was preserved with `source_material_id = NULL` (SET NULL transition).
  - Verified child material, lineage, practice histories, and card review state/events survived completely intact.
  - Verified distinct synthetic files on disk remained byte-for-byte unaltered.
  - Verified SQLite `VACUUM INTO` database export, closed in-memory DB, reopened exported DB, and verified all child records and histories survived.
- **Repaired Mutation Driver (`mutationChecks.mjs`):**
  - Creates a fresh temporary workspace via `mkdtempSync(join(tmpdir(), "m2-lineage-mutations-"))`.
  - Copies model, DDL, tests, and package configuration into the temporary workspace.
  - Applies mutations ONLY to files inside the temporary workspace, never touching immutable evidence files in-place.
  - Runs mutants with explicit shipped migrations path, verifies all 4 mutants are caught (exit 1), and confirms exact hash restoration.
  - Recursively cleans up the temporary workspace in `finally`.
  - Asserts that original evidence files remain 100% byte-for-byte immutable.
- **Separate Distinct Receipts:** Captured separate raw receipts for every test command (`proof-run.txt`, `diagnostics-baseline.txt`, `diagnostics-final.txt`, `diagnostics-adapted-round2.txt`, `diagnostics-frozen-round1.txt`, `mutation-checks.txt`) with corresponding `.exit` files.

---

## 2. Verification Receipts & Results Summary

| Suite / Check | Command | Exit Code | Result | Receipt File |
| --- | --- | :---: | :---: | --- |
| **Baseline Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs` | **1** | 2 passed / 4 failed (baseline reproduced) | `receipts/diagnostics-baseline.txt` |
| **Final Reviewer Diagnostic** | `node --test docs/evidence/m2-split-lineage-scope-round2-2026-10-08/diagnostics/lineage-round2.test.mjs` | **0** | **6 passed / 0 failed** | `receipts/diagnostics-final.txt` |
| **Adapted Reviewer Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round2-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs` | **0** | **6 passed / 0 failed** (frozen reviewer file untouched) | `receipts/diagnostics-adapted-round2.txt` |
| **Frozen Round 1 Diagnostic** | `node --import ./docs/evidence/m2-split-lineage-scope-round2-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` | **0** | **7 passed / 0 failed** (frozen reviewer file untouched) | `receipts/diagnostics-frozen-round1.txt` |
| **Corrected Proof Suite (16 Contracts)** | `node --test docs/evidence/m2-split-lineage-scope-round2-2026-10-08/proof/proof.test.mjs` | **0** | **16 passed / 0 failed** | `receipts/proof-run.txt` |
| **Real Mutation Checks** | `node docs/evidence/m2-split-lineage-scope-round2-2026-10-08/proof/mutationChecks.mjs` | **0** | **4/4 mutations caught (exit 1) in isolated scratch workspace** | `receipts/mutation-checks.txt` |
| **Original Scope Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **9/9 OK** | Preserved immutable |
| **First Reviewer Pack Checksums** | `(cd docs/evidence/m2-split-lineage-review-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **20/20 OK** | Preserved immutable |
| **Round 1 Correction Pack Checksums** | `(cd docs/evidence/m2-split-lineage-scope-corrections-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **18/18 OK** | Preserved immutable |
| **Round 2 Rereview Pack Checksums** | `(cd docs/evidence/m2-split-lineage-rereview-2026-10-08 && shasum -a 256 -c SHA256SUMS)` | **0** | **19/19 OK** | Preserved immutable |
| **Submitted Manifest Checksums** | Verified via Node script against `docs/evidence/m2-split-lineage-rereview-2026-10-08/submitted-manifest.json` | **0** | **25/25 OK** | Preserved immutable |

---

## 3. Real Mutation Sensitivity Results (`mutationChecks.mjs`)

| Mutant ID | Targeted Component & Description | Semantic Change | Actual Test Failure | Status |
| --- | --- | --- | --- | :---: |
| **MUTANT-1** | `lineageContract.mjs`<br>`composeNestedRanges` | Omit `- 1` in composed range start calculation | Contract 3 fails on composed start assertion (expected 120, got 121) | **CAUGHT (Exit 1)** |
| **MUTANT-2** | `lineageContract.mjs`<br>`mapChildPageToSource` | Remove `childPage > childLength` upper-bound check | Contract 2 fails with `Missing expected exception` on page 201 | **CAUGHT (Exit 1)** |
| **MUTANT-3** | `candidate_migration_0013.sql`<br>Column constraints | Remove `TYPEOF(...) = 'integer'` checks across table | Contract 6 fails: SQLite admits `101.5`, missing expected exception | **CAUGHT (Exit 1)** |
| **MUTANT-4** | `candidate_migration_0013.sql`<br>Cycle constraints | Remove `CHECK (material_id != root_material_id)` constraint | Contract 7 fails: SQLite admits `rootMaterialId: 'self-doc'`, missing exception | **CAUGHT (Exit 1)** |

All 4 mutants caused genuine semantic assertion failures and exited with code 1 in the isolated scratch workspace. Original evidence files were never touched and remained 100% byte-for-byte identical.

---

## 4. Pack File Manifest

- `candidate_migration_0013.sql`: Authoritative candidate DDL migration for split lineage metadata.
- `proof/lineageContract.mjs`: Corrected exported contract model, page translation arithmetic, two-tier navigation, version evaluation, and SQLite database helpers.
- `proof/proof.test.mjs`: 16 comprehensive automated test contracts covering SL-R4, SL-R5, and SL-R6.
- `proof/mutationChecks.mjs`: Repaired isolated-workspace mutation testing script verifying assertion sensitivity without mutating evidence files in-place.
- `proof/package.json`: Package configuration declaring ES module type for test execution.
- `diagnostics/lineage-round2.test.mjs`: Diagnostic assertions mirroring the Round 2 reviewer suite, directed to Round 2 contract.
- `diagnostics/forwardingAdapter.mjs` & `forwardingLoader.mjs`: Custom Node loader adapter directing frozen reviewer diagnostics to Round 2 contract without modifying frozen files.
- `receipts/proof-run.txt` & `.exit`: Raw test execution log and exit code for `proof.test.mjs` (exit 0).
- `receipts/diagnostics-baseline.txt` & `.exit`: Raw test execution log and exit code for baseline reviewer diagnostic (exit 1).
- `receipts/diagnostics-final.txt` & `.exit`: Raw test execution log and exit code for final reviewer diagnostic (exit 0).
- `receipts/diagnostics-adapted-round2.txt` & `.exit`: Raw test execution log and exit code for adapted Round 2 reviewer diagnostic (exit 0).
- `receipts/diagnostics-frozen-round1.txt` & `.exit`: Raw test execution log and exit code for adapted Round 1 reviewer diagnostic (exit 0).
- `receipts/mutation-checks.txt` & `.exit`: Raw test execution log and exit code for `mutationChecks.mjs` (exit 0).
- `source-hashes.json`: SHA-256 digests of all tracked project documents.
- `SHA256SUMS`: Cryptographic checksums of all files in this evidence pack.

---

## 5. Scope Boundaries, Preserved State & Limitations

1. **Proposed Defaults (SL-D1–SL-D8):** Product defaults remain **PROPOSED**. Owner approval is required before production implementation.
2. **Preserved Production State:** Shipped migrations 0001–0012, `CURRENT_SCHEMA_VERSION = 12`, application source code (`src/`, `src-tauri/`), and accepted Milestone 2 Slice C2 library review source remain untouched.
3. **Preserved Prior Evidence Packs:** All prior evidence packs (Original Scope Pack: 9 checksums; First Reviewer Pack: 20 checksums; Round 1 Correction Pack: 18 checksums; Round 2 Rereview Pack: 19 checksums) remain 100% byte-for-byte identical.
4. **No Unauthorized Work:** No installed-app, real-user, signing, or release work was conducted during this planning round.
