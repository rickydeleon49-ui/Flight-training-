# Her Flight Deck — Milestone 4 Integration Corrections Evidence Pack (2026-10-11)

## Executive Summary

This evidence pack delivers the integrated, reproducible correction package for Her Flight Deck's **Milestone 4 (Document navigation and local retrieval)** evaluation, completing groups **M4-R9**, **M4-R10**, **M4-R11**, and **M4-R12** in full alignment with the independent review ([`docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_REREVIEW_2026-10-11.md`](../../M4_DOCUMENT_NAVIGATION_INTEGRATION_REREVIEW_2026-10-11.md)) and the active prompt ([`docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_PROMPT_2026-10-11.md`](../../M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_PROMPT_2026-10-11.md)).

All 32 frozen submitted hashes from commit `b64ac84` were verified 100% prior to editing. The production application code, dependencies, shipped migrations (0001–0013), and shared tracking files (`ROADMAP.md`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`) remain untouched. Primary checkout and Claude's M3 worktrees remain protected.

---

## Technical Summary of Delivered Corrections

### 1. M4-R9: Complete Destination Validation & Nullable Schema 13 Lineage
- **Trusted Bounded Destination Contract**: Bounded physical indices and printed label maps require a trusted safe integer `totalPages >= 1`. Missing or malformed counts (`undefined`, `null`, `NaN`, `Infinity`, `2.5`, `'50'`) strictly refuse resolution (`isResolved: false`).
- **Direction-Specific Translation**: Validation depends strictly on the navigation direction:
  - `child_to_root`: Supports genuine first-level split rows where `parentMaterialId`, `parentPageStart`, and `parentPageEnd` are `null` (matching shipped schema 13). Requires complete root ranges (`sourcePageStart`, `sourcePageEnd`), live root ID, and safe integer arithmetic (`sourcePageStart + page - 1`).
  - `child_to_parent`: Requires live parent ID, complete parent ranges, and safe integer arithmetic.
  - `root_to_child`: Enforces live destination child material ID; refuses reverse translation if child ID is missing.
- **Snapshot Guidance**: Missing or deleted parent/root documents return structured snapshot guidance (`ROOT_DELETED`, `PARENT_DELETED`) without inventing coordinates.

### 2. M4-R10: Atomic Content Replacement & Persisted Navigation Enforcement
- **Single Revalidation Transaction**: Replaced separate identity caching and optional reconciliation calls with `DocumentPersistenceProtocol.replaceContentIdentity(materialId, contentSha256, totalPages)`. Inside one atomic SQLite transaction (`BEGIN IMMEDIATE TRANSACTION ... COMMIT`):
  1. Updates `material_content_identities`.
  2. Sets `status = 'unverified'` for bookmarks with mismatched hashes or out-of-bounds indices (`page_index > totalPages`).
  3. Sets `status = 'unverified'` for reading state rows with mismatched hashes or out-of-bounds positions (`last_requested_page > totalPages`).
- **Bound-Checking Writers**: `addBookmark` and `saveReadingState` consult persisted active content identity and reject or mark unverified any out-of-bounds inputs. Matching hash without trusted bounds cannot reverify.
- **SQLite Lifecycle Verification**:
  - Populated upgrade from shipped schema 1–13 verified with realistic study materials, notes, and split lineage.
  - Transaction rollback upon injected SQLite trigger failure proves 100% prior row state restoration.
  - File-backed disk database close and reopen verified.
  - Synthetic backup/restore tested with real disk PDF files and SHA-256 drift detection.
  - Older-binary schema probe proves older binaries refuse databases with candidate version 0015 applied.
  - Foreign key cascade delete verified.

### 3. M4-R11: Durable Save Ownership & Controller Commit Fencing
- **Commit Ownership Fencing**: `OpenerController` enforces ownership through an active persistence fence. When a newer open request completes (e.g. page 3), a held obsolete persistence callback (e.g. page 42) is prevented from committing stale data to SQLite. If an unfenced callback executes late, the controller immediately re-asserts the newer active destination in SQLite and marks the old intent aborted.
- **Content-Scoped Reading State**: Progress is keyed strictly by material ID AND content SHA-256 (`${materialId}:${contentSha256}`). Replacing a document with new content cannot inherit prior page progress. Public `lastRequestedPage` getter returns `null` after a subsequent request fails.
- **Early Bounds Validation**: Validates `targetPage <= material.totalPages` BEFORE invoking native openers, preventing unnecessary OS process launches on malformed inputs.
- **Honest Partial-Save Recovery**: If document opening succeeds but persistence fails, reports `state: 'opened_unsaved'` and offers a deliberate `retrySave()` method that does not re-open the viewer.

### 4. M4-R12: Evidence, Real PDF.js Demonstration & Disposable Mutation Sensitivity
- **Real PDF.js Parser Demonstration**: Evaluated upstream `pdfjs-dist@6.3.289` with `finally` task destruction (`await task.destroy()`) across all 5 synthetic fixtures and page-tree corruption tests.
- **Runtime Transparency**: Disclosed Node.js v26.10.0 success and Node.js v22.23.3 runtime limitation (`Promise.try is not a function`) honestly without requesting production polyfills.
- **Pinned Scratch Dependencies**: Committed `package.json` with exact version `6.3.289` and `package-lock.json` with exact SHA-512 integrity hashes. Complete license and asset inventory recorded in `scratch-artifacts.json`.
- **Disposable Module Mutation Testing**: Tested 5 actual temporary module copies with single guard reversions against unchanged regressions, proving exit 1 with exact named `AssertionError`s, followed by verification of untouched source hashes.
- **Separated Historical Reproductions**: Unified runner (`scripts/run_integration_proof.mjs`) executes current source proofs and separately labels historical rereview reproductions with verified exits.

---

## Directory Inventory

```
docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/
├── README.md                                    # This document
├── SHA256SUMS                                   # Authoritative sha256 checksum manifest
├── issue-to-test-map.json                       # Comprehensive issue-to-test traceability matrix
├── candidate/
│   └── candidate_migration_0015.sql             # Provisional candidate migration DDL (unregistered)
├── fixtures/
│   ├── fixtures-manifest.json                   # Synthetic test PDF manifest
│   ├── handbook_root_sample.pdf                 # 50-page root handbook PDF
│   ├── malformed_sample.pdf                     # Corrupted syntax PDF fixture
│   ├── multi_page_sample.pdf                    # 10-page study guide PDF
│   ├── single_page.pdf                          # 1-page reference PDF
│   └── split_part_sample.pdf                    # 16-page split chapter PDF
├── proof/
│   ├── contractModel.mjs                        # Complete coordinate & destination validator (M4-R9)
│   ├── databaseLifecycle.test.mjs               # SQLite upgrade, rollback, backup & refusal tests (M4-R10)
│   ├── openerController.mjs                     # Controller with commit fence & content scoping (M4-R11)
│   ├── persistenceProtocol.mjs                  # Atomic replacement transaction & writers (M4-R10)
│   ├── proof.test.mjs                           # Regressions for R9-R12 (21 tests, all passing)
│   ├── realParserDemonstration.mjs              # PDF.js proof with task cleanup in finally (M4-R12)
│   └── sensitivityMutants.test.mjs              # Actual disposable module mutation tests (M4-R12)
├── receipts/
│   ├── 01-toolchain.txt                         # Runtime environment receipt
│   ├── 02-baseline.txt                          # 32 frozen submitted hashes verification receipt
│   ├── 03-proof-suite.txt                       # Unified proof execution output
│   ├── 04-hygiene.txt                           # Git diff and tree cleanliness check
│   ├── 05-diagnostics.txt                       # Current vs historical diagnostics outputs
│   └── 06-sensitivity-mutants.txt               # Mutation sensitivity verification output
├── scratch/
│   └── pdfjs-engine/
│       ├── package.json                         # Pinned scratch package (pdfjs-dist: 6.3.289)
│       ├── package-lock.json                    # Pinned lockfile with sha512 integrity
│       └── scratch-artifacts.json               # Package license and asset inventory
└── scripts/
    └── run_integration_proof.mjs                # Unified proof runner and receipt generator
```

---

## Verification & Execution Commands

```bash
# 1. Run all integration proofs, database lifecycle tests, sensitivity mutants, and historical reproductions:
node docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/scripts/run_integration_proof.mjs

# 2. Run proof suite standalone:
node --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/proof.test.mjs

# 3. Run database lifecycle standalone:
node --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/databaseLifecycle.test.mjs

# 4. Run sensitivity mutants standalone:
node --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/sensitivityMutants.test.mjs

# 5. Check git hygiene (0 errors expected):
git diff --check
```
