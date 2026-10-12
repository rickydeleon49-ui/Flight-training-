# Her Flight Deck: M4 Document Navigation Scope Corrections Report

**Date**: October 11, 2026
**Subject**: Review Corrections for Milestone 4 (Document Navigation and Local Retrieval Scope Preparation)
**Reference Assignment**: [docs/M4_DOCUMENT_NAVIGATION_SCOPE_CORRECTIONS_PROMPT_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_CORRECTIONS_PROMPT_2026-10-11.md)
**Independent Review**: [docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md)
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)
**Base Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)
**Status**: COMPLETE — Ready for Senior Review and Owner Default Selection

---

## 1. Executive Overview

This report details the resolution of all findings from the independent review (M4-R1 through M4-R4). The evaluation package has been thoroughly corrected, verified, and hardened:
1. **M4-R1 (Supported Compatibility & Real Evidence)**: Hard-coded browser matrices and unmeasured performance claims were replaced with primary source citations and exact package metadata. A structural PDF-1.4 parser demonstration was built and executed across all synthetic fixtures (including graceful rejection of malformed PDFs and buffer teardown). Historical macOS 12 Monterey WebKit compatibility is explicitly marked **unverified without physical hardware testing**.
2. **M4-R2 (Page-Coordinate Contract & Provenance)**: Enforced finite safe integer validation on all requested pages and page totals. Prevented unmapped printed labels and numeric strings without declared provenance from inventing physical page destinations (`physicalIndex: null`). Handled split lineages, nested parent coordinates, and deleted roots safely without misrouting coordinates.
3. **M4-R3 (Durable Content Ownership & Invalidation)**: Bound bookmarks and reading state directly to `originating_content_sha256` with strict 64-character hexadecimal format constraints and field length limits. Verified candidate schema in genuine populated SQLite databases for pre-existing schema-13 row retention, malformed hash rejection, cascade cleanup, transaction rollback, and drift invalidation.
4. **M4-R4 (Complete Conditional Handoff & Honest Reading Semantics)**: Separated `last_requested_page` from `confirmed_read`. Implemented an injected opener controller state machine proving error recovery (no false success announcements) and late callback cancellation on route changes. Synchronized the evaluation report, owner defaults (OD-1–OD-10), acceptance criteria (AC-1–AC-9), and the conditional implementation prompt.

---

## 2. Issue-by-Issue Resolution Matrix

| Review Item | Finding / Deficiency | Corrective Action & Verification | Files Changed |
| --- | --- | --- | --- |
| **M4-R1: Compatibility Evidence** | Hard-coded browser matrix asserted compatibility without proof. Monterey Safari 17.6 denied features shipped in Safari 17.4 ([WebKit blog 15063](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)). React-PDF 11 requires Safari 18+ ([React-PDF README](https://raw.githubusercontent.com/wojtekmaj/react-pdf/main/packages/react-pdf/README.md)). | 1. Removed synthetic compatibility matrix. Cited primary sources.<br>2. Explicitly disclosed: macOS 12 Monterey WKWebView runtime compatibility is **unverified without physical hardware testing**.<br>3. Pinned package metadata: `react-pdf@11.0.0` (336 KB, depends on `pdfjs-dist@6.3.289` 34.8 MB), `@embedpdf/pdfium@2.15.1` (7.55 MB, bundled WASM).<br>4. Replaced unmeasured RAM/speed claims with labeled estimates.<br>5. Implemented structural PDF parser demonstrating loading of all fixtures and graceful rejection of malformed PDF without process crash. | `docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md`<br>`proof/pdfParserDemonstration.mjs`<br>`proof/proof.test.mjs` (M4-P6, M4-P7) |
| **M4-R2: Page Coordinates & Provenance** | `validatePageIndex` accepted NaN, Infinity, and fractions. Split translation accepted NaN and strings. `parsePageReference('3-12')` invented page 1; `'42'` was assumed physical. Deleted root misrouted root coordinates to parent part. | 1. `validatePageIndex` validates finite safe integers $\ge 1$ for both page and `totalPages`.<br>2. `parsePageReference` preserves string labels; unmapped labels remain unresolved (`physicalIndex: null`). Verified `labelToPhysicalMap` supported.<br>3. Clamping applies only to explicit physical requests with known bounds.<br>4. Split translation returns explicit destination space (`"root_physical"` vs `"parent_physical"`). Deleted root returns `sourceMaterialId: null`, `code: "ROOT_DELETED"` without substituting parent ID with root coordinates.<br>5. Clarified Gemini contract: typed schema is `INTEGER \| null`, but coordinate provenance is ambiguous. | `proof/contractModel.mjs`<br>`proof/proof.test.mjs` (M4-P1, M4-P2, M4-P3, M4-P10)<br>`docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md` |
| **M4-R3: Durable Content Ownership** | Candidate DDL bound bookmarks only to material ID; current hash was overwritten independently. Accepted malformed hashes like `'not-a-sha256'`. Helper compared values, but no persistence protocol verified saved hash. | 1. Updated candidate DDL (`candidate_migration_0015.sql`): bound bookmarks and reading state to `originating_content_sha256`.<br>2. Added strict 64-character hex CHECK constraint: `LENGTH(...) = 64 AND ... NOT GLOB '*[^0-9a-fA-F]*'`.<br>3. Added length constraints: title $\le 500$, notes $\le 20,000$, label $\le 100$.<br>4. Added status column (`'verified'`, `'unverified'`, `'drifted'`).<br>5. Tested in genuine SQLite databases: retains pre-existing schema-13 rows, rejects malformed hashes, marks drifted bookmarks as `unverified`, cascades deletions, and rolls back failed transactions.<br>6. Noted migration number as provisional (candidate 0015). | `candidate/candidate_migration_0015.sql`<br>`proof/databaseVerification.test.mjs`<br>`scripts/verify_schema_probe.py`<br>`proof/contractModel.mjs`<br>`proof/proof.test.mjs` (M4-P4, M4-P9) |
| **M4-R4: Conditional Handoff & Honest Semantics** | Conditional prompt omitted drift requirements, opening failure/late callback rules, and provenance. Hard-coded migration 0015 without noting provisional numbering. Requested page was reported as read; failed opener announced success. | 1. Distinguish `last_requested_page` from `confirmed_read` (default 0). A requested page is not reported as read.<br>2. Built `OpenerController` state machine (`idle` -> `opening` -> `opened` / `failed` / `aborted`). Failed opening reports error without announcing success or advancing reading state. Route changes abort in-flight requests and cancel late callbacks.<br>3. Missing file recovery remains accessible when disabled button is shown.<br>4. Candidate migration number noted as provisional until accepted main reconciliation.<br>5. Synchronized prompt, defaults OD-1–OD-10, and criteria AC-1–AC-9. | `proof/openerController.mjs`<br>`proof/proof.test.mjs` (M4-P8)<br>`docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md`<br>`docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md` |

---

## 3. Reproduction & Verification Results

### 3.1 Frozen Review Diagnostics Reproduction
Running `node --test docs/evidence/m4-document-navigation-scope-review-2026-10-11/diagnostics.test.mjs` against the unedited review files reproduces the exact review findings:
- **Result**: **8 failed, 2 passed controls** (Exit Code: 1).
- **Control 1 (PASS)**: Valid bounded physical page and child-to-root translation.
- **Control 2 (PASS)**: Root page outside child range is rejected.
- **Diagnostics 1–8 (FAIL on frozen submission)**:
  1. `validatePageIndex(1, NaN)` rejected (failed on frozen model).
  2. `validatePageIndex(1, Infinity)` rejected (failed on frozen model).
  3. `validatePageIndex(1, 2.5)` rejected (failed on frozen model).
  4. `translateSplitCoordinates({ direction: "child_to_root", page: NaN }, lineage)` rejected (failed on frozen model).
  5. `translateSplitCoordinates({ direction: "child_to_root", page: "3" }, lineage)` rejected (failed on frozen model).
  6. `parsePageReference('3-12')` physical index is null (failed on frozen model).
  7. `parsePageReference('42')` pure index is false (failed on frozen model).
  8. Deleted root does not substitute parent with root coordinates (failed on frozen model).

Receipt stored in: `receipts/05-frozen-diagnostics.txt`.

### 3.2 Corrected Test Suite Execution
Running the corrected proof suite (`proof/proof.test.mjs`):
- **Result**: **10 passed, 0 failed** (Exit Code: 0).
  - `M4-P1`: Physical Page Indexing & Safe Clamping
  - `M4-P2`: Provenance-Aware Page Reference Resolution & Printed Labels
  - `M4-P3`: Split-Lineage Coordinate Space & Navigation Safety
  - `M4-P4`: Content Replacement, Strict Hash Validation & Drift Invalidation
  - `M4-P5`: Native Jump Fallback Messaging
  - `M4-P6`: WebKit & Engine Boundary Audit (Unverified Disclosures)
  - `M4-P7`: Synthetic PDF Structural Parser Demonstration
  - `M4-P8`: Injected Opener Controller State Machine & Honest Reading State
  - `M4-P9`: Database Candidate Migration 0015 Verification
  - `M4-P10`: **Corrected Execution of all 10 Review Diagnostics Cases** (all 10 pass)

### 3.3 Database Migration & Ownership Tests
Running `proof/databaseVerification.test.mjs` against genuine in-memory SQLite instances migrated from 0001 through 0013 to candidate 0015:
- **Result**: **5 passed, 0 failed** (Exit Code: 0).
  - `M4-DB-1`: Upgrade retains pre-existing schema-13 rows without modification.
  - `M4-DB-2`: Strict hash validation rejects malformed SHA-256 strings (`CHECK constraint failed`).
  - `M4-DB-3`: Bookmarks bind to originating content hash and detect drift (`status: 'unverified'`).
  - `M4-DB-4`: `ON DELETE CASCADE` cleans up all dependent navigation records when a material is deleted.
  - `M4-DB-5`: Transaction rollback restores previous state on failed update.

### 3.4 Python Schema Probe
Running `scripts/verify_schema_probe.py`:
- **Result**: **All 3 probe checks passed** (Exit Code: 0).
  - Malformed content hash correctly rejected by CHECK constraint.
  - Originating content hash preserved; bookmark correctly transitioned to 'unverified'.
  - `ON DELETE CASCADE` cleaned up all dependent navigation records.

Receipts stored in: `receipts/03-proof-suite.txt`.

---

## 4. Honestly Disclosed Unverified Items

In accordance with engineering integrity principles, the following platform capabilities remain **explicitly unverified**:
1. **macOS 12 Monterey WKWebView Runtime Compatibility**:
   - `react-pdf@11.0.0` specifies Safari 18+ as its minimum requirement.
   - macOS 12 Monterey received a maximum browser release of Safari 17.6 and uses system WKWebView ~16.0.
   - Whether modern PDF.js or React-PDF 11 can render without syntax errors or missing WebKit primitives on macOS 12 cannot be verified by Node test runners or modern macOS 15/27 WebKit simulations.
   - **Conclusion**: This compatibility boundary remains **unverified pending testing on physical macOS 12 hardware**.
2. **Embedded Canvas Memory Footprint on Low-RAM Hardware**:
   - Rendering 400-page complex FAA publications in canvas or WASM linear memory could exceed available memory on 8 GB unified memory Macs.
   - **Conclusion**: Memory usage claims remain **unverified estimates**; physical profiling is required before approving Step 2 embedded viewers.

---

## 5. Invariant & Repository Protection Audit

1. **Primary Working Tree & Claude M3 Worktree**:
   - `/Users/rickymac/code/Flight-training-` (primary dirty checkout): **Untouched**.
   - `/Users/rickymac/code/Flight-training-m3-skills-scope`: **Untouched**.
2. **Shared Tracking Files**:
   - `ROADMAP.md`: **Untouched** (proposed entries provided in report §9.1).
   - `STATUS.md`: **Untouched** (proposed entries provided in report §9.2).
   - `docs/PROJECT_HANDOFF.md`: **Untouched** (proposed entries provided in report §9.3).
3. **Production Application & Dependencies**:
   - `src/` and `src-tauri/src/`: **Zero edits**.
   - `package.json` and `Cargo.toml`: **Zero edits**.
   - Runtime migrations: Candidate 0015 remains strictly **unregistered and unapplied**.
4. **Git Tree Hygiene**:
   - `git diff --check` executed; **zero trailing whitespace or conflict markers detected**.

---

## 6. Conclusion & Next Steps

The M4 technical evaluation and scope package is fully corrected and substantiated by rigorous, reproducible evidence. It is submitted for senior review and project owner decision:
- **Decision Required**: Approve proposed defaults **OD-1 through OD-10** (specifically approving Step 1 Native Open + HUD navigation while deferring Step 2 embedded viewer pending physical device testing).
- **Execution**: Upon approval, use [docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md) to implement M4 Slice 1 in a dedicated feature branch.
