# M2 Split-Source Lineage — Scope and Executable Proof Evidence (8 October 2026)

This directory contains disposable synthetic evidence, contract models, schema designs, and test verification receipts for the **M2 Split-Source Lineage Scope Proposal** ([`docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md`](../../M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md)).

No application source files (`src/`, `src-tauri/`), production dependencies, package lockfiles, shipped migrations, or release configurations are modified by this planning assignment.

---

## 1. Evidence Manifest

| Path | Contents |
| --- | --- |
| [`proof/package.json`](proof/package.json) | Isolated package manifest declaring ESM module type for disposable Node scripts. Zero external dependencies. |
| [`proof/lineageContract.mjs`](proof/lineageContract.mjs) | Pure page validation, 1-based page translation arithmetic, nested range composition, SHA-256 calculation, and disposable SQLite schema runner. |
| [`proof/proof.test.mjs`](proof/proof.test.mjs) | 13 `node:test` assertion suites covering all split lineage contracts, arithmetic, SQL constraints, parent deletion/replacement, legacy coexistence, and restore compatibility. |
| [`proof/negativeControls.mjs`](proof/negativeControls.mjs) | 4 deliberate semantic negative controls verifying test sensitivity to logic and constraint mutations. |
| [`candidate_migration_0013.sql`](candidate_migration_0013.sql) | Evaluated candidate Migration 0013 DDL (`material_split_lineage` table, indexes, and constraints). |
| [`receipts/proof-run.txt`](receipts/proof-run.txt) | Raw output of `node --test proof/proof.test.mjs`: **13 passed / 0 failed**, exit 0. |
| [`receipts/negative-controls.txt`](receipts/negative-controls.txt) | Raw output of `node proof/negativeControls.mjs`: **4/4 mutations caught**, exit 0. |
| [`source-hashes.json`](source-hashes.json) | SHA-256 hashes of the scope document, proposal, and project handoff files. |
| [`SHA256SUMS`](SHA256SUMS) | Cryptographic checksums of all files in this evidence directory. |

---

## 2. How to Rerun

All scripts run on modern Node.js (v22+ or v26+) with built-in `node:sqlite` and `node:test`. No external packages or network access are required:

```bash
cd docs/evidence/m2-split-lineage-scope-2026-10-08

# 1. Run the 13-suite correctness proof:
node --test proof/proof.test.mjs

# 2. Run the deliberate semantic negative controls:
node proof/negativeControls.mjs
```

---

## 3. What This Proves and What It Doesn't

### Meaningful Invariants Proved:

1. **Page Range Validation & 1-Based Bounds:**
   - 1-based, inclusive physical PDF page ranges are strictly enforced.
   - Negative, zero, reversed (`last < first`), non-integer, and out-of-bounds ranges exceeding document total pages are rejected cleanly with helpful messages.

2. **Page Translation & Nested Composition Arithmetic:**
   - Single-level mapping translates child page positions directly to root source pages (e.g. child covering [101, 300] maps child page 1 to original page 101, and child page 50 to original page 150).
   - Multi-level nested composition maps sub-chapter selections within a child part accurately back to root source pages (e.g. child covering [101, 300] split at pages [20, 40] yields original pages [120, 140]; grandchild page 1 = root page 120).
   - 3-level deep transitive nesting composed without loss of precision.

3. **SQL Schema Constraints in Disposable SQLite:**
   - `CHECK (source_page_start >= 1)` and `CHECK (source_page_end >= source_page_start)` prevent corrupt ranges at the database engine level.
   - `CHECK (material_id != parent_material_id)` prevents recursive self-parenting loops.
   - `CHECK (source_total_pages IS NULL OR source_total_pages >= source_page_end)` prevents ranges exceeding declared source length.

4. **Parent Deletion Safety (No Cascade Deletion of Children):**
   - Foreign key `parent_material_id REFERENCES study_materials(id) ON DELETE SET NULL` ensures that deleting a parent material **never** deletes child parts.
   - When a parent is deleted, `parent_material_id` is set to NULL, while the child's `material_split_lineage` record retains the immutable snapshot of `source_title`, `source_file_name`, `source_page_start`, `source_page_end`, and `source_content_sha256`.
   - The child's study guide, flashcards, practice sessions, and review history remain 100% intact.

5. **Parent Replacement / Modification Invariance:**
   - Child lineage records the cryptographic SHA-256 hash of the parent PDF at split time.
   - If the parent document is replaced with a newer edition or modified, the child retains its historical content hash; hash mismatch is detectable without invalidating or corrupting child data.

6. **Repeated Imports Disambiguation:**
   - Importing the same PDF multiple times creates distinct material IDs with identical content hashes.
   - Child lineage correctly references the specific parent material instance from which it was generated.

7. **Legacy Coexistence without Inferred Provenance:**
   - Existing materials without lineage rows query seamlessly via `LEFT JOIN` and return `lineage: null`.
   - The contract explicitly prohibits guessing or inventing lineage from filenames or title strings (e.g. `" — Part 1 of 5"`).

8. **Immutable Document Bytes & Review History Preservation:**
   - Stored PDF file bytes and all existing study history tables (`practice_sessions`, `card_review_states`, `card_review_events`, `ai_study_sets`) remain byte-for-byte identical before and after lineage operations.

9. **Schema 12 -> 13 Migration & Backup/Restore Compatibility:**
   - Migration 0013 applies additively over shipped Schema 12 without modifying existing tables.
   - An older application binary (at Schema 12) attempting to restore a Schema 13 database cleanly refuses the restore per `src-tauri/src/backup.rs:631` (`newest_migration > CURRENT_SCHEMA_VERSION`), preventing silent corruption.
   - A newer binary at Schema 13 restores Schema 12 backups and upgrades them seamlessly.

10. **Test Sensitivity (Mutation Testing):**
    - 4 deliberate mutations (off-by-one arithmetic, zero-based page acceptance, cascade child deletion, self-parenting cycle) are caught by the test assertions and schema constraints.

### What This Does Not Prove:

- This is a disposable in-memory proof using synthetic metadata.
- It does not represent shipped native desktop builds, WebKit/Safari-specific rendering costs, or cross-platform SQLite driver quirks under Tauri IPC.
- It does not authorize production database migrations or feature activation until approved by the repository owner.
