# Her Flight Deck: M4 Document Navigation Scope Remaining Corrections Report

**Date**: October 11, 2026  
**Subject**: Remaining Review Corrections for Milestone 4 (Document Navigation and Local Retrieval Scope Preparation)  
**Reference Assignment**: [docs/M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md)  
**Independent Review**: [docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md)  
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)  
**Base Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65`  
**Remote HEAD**: `75f9f9300d3f219b3870ef98699641f3d36b7138` (`origin/main`)  
**Status**: COMPLETE — Ready for Senior Review and Owner Default Selection  

---

## 1. Executive Summary

This report completes all remaining review corrections (**M4-R5 through M4-R8**) for Milestone 4 (Document Navigation and Local Retrieval Scope Preparation). All identified gaps have been addressed with verifiable implementations, automated proofs, file-backed SQLite database lifecycle tests, sensitivity mutant demonstrations, and genuine PDF engine evaluation:

1. **M4-R5 (Complete Destination Resolution)**: Enforced `Number.isSafeInteger` consistently across all page counts, requests, and lineage ranges. Required explicit provenance for numeric references (numbers without provenance remain unresolved). Prevented physical page zero and string concatenation. Validated lineage range lengths (`parentPageEnd - parentPageStart + 1 === childPageCount`) and destination bounds. Guaranteed destination material IDs and coordinate spaces in all directions, including `root_to_child`.
2. **M4-R6 (Durable Navigation State & Bounded Revalidation)**: Bound bookmarks and reading state directly to `originating_content_sha256`. Enforced bounded revalidation: matching hashes alone cannot verify a bookmark if its `pageIndex` exceeds `totalPages`. Verified file-backed SQLite lifecycle across close/reopen, mixed bookmark generations, rollback, cascade deletion, and backup/restore with disk drift invalidation.
3. **M4-R7 (Opener Lifecycle & Durable Persistence)**: Advanced intent generation before input validation so newer failed or invalid requests supersede older pending opens. Scoped requested progress by material so failing material B never leaks material A's page 42. Pre-validated destinations before opener invocation. Integrated injected durable persistence, handling save failures with clear notices without replaying the opener. Kept missing-file recovery an enabled, distinct reachable action.
4. **M4-R8 (Truthful Research & Real Parser Proof)**: Evaluated the actual candidate engine `pdfjs-dist@6.3.289` in scratch dependencies across all synthetic fixtures. Proved genuine page catalog resolution (resolving actual 50 pages despite forged `/Count 99`) and graceful rejection of malformed PDFs (`InvalidPDFException`). Inspected package licenses and third-party notices (PDFium 3-clause BSD redistribution, Apache-2.0, bundled fonts > 4 MB). Corrected Safari 16.4 facts (WASM SIMD available on Monterey and Big Sur, [WebKit blog 13966](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)) while maintaining that desktop WKWebView runtime compatibility remains **explicitly unverified without physical hardware testing**.

---

## 2. Pre-flight Verification & Frozen Reproductions

Before making any edits, the following verification gates were satisfied:
1. **25 Submitted Hashes Verified**: All 25 paths in `docs/evidence/m4-document-navigation-scope-rereview-2026-10-11/submitted-hashes.json` matched the working tree with 100% SHA-256 verification.
2. **Rereview Diagnostics Reproduced**: Replaying `node --test diagnostics.test.mjs` against the unedited review files reproduced exactly **13 failures and 2 passing controls** (Exit code: 1).
3. **Frozen Current Controls Verified**: Replaying `node --test frozen-current.test.mjs` verified that all **10 historical diagnostic controls passed** (Exit code: 0).
4. **Historical Receipts Preserved**: Original receipts 02–04 and original SHA256SUMS from the first review submission were archived byte-for-byte in [archived-original-receipts/](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/archived-original-receipts/).
5. **Clean Working Tree**: Zero tracked production files or lockfiles modified.

---

## 3. Issue-to-Fix Matrix

| Issue | Deficiency / Finding | Corrective Implementation & Evidence | Files Changed |
| --- | --- | --- | --- |
| **M4-R5: Destination Resolution** | `validatePageIndex` accepted `Number.MAX_SAFE_INTEGER + 1`. `parsePageReference(42)` resolved without provenance. `parsePageReference('0')` resolved page 0. Parent start `'21'` concatenated string (`211`). Range 21–22 accepted 16-page child. Root page 103 succeeded despite `sourceTotalPages: 100`. `root_to_child` omitted child material ID. | 1. Enforced `Number.isSafeInteger` consistently on requests, totals, and lineage fields.<br>2. Required explicit provenance for numeric references; numbers without provenance remain unresolved (`physicalIndex: null`).<br>3. Rejected physical page zero and non-positive safe integers.<br>4. Enforced safe integers on parent start/end; prevented string concatenation.<br>5. Validated range lengths: `end - start + 1 === childPageCount`.<br>6. Validated root destination against `sourceTotalPages`.<br>7. Included `sourceMaterialId: child` and `destinationSpace: child_physical` in `root_to_child`. | `proof/contractModel.mjs`<br>`proof/proof.test.mjs` (M4-P1, M4-P2, M4-P3, M4-P9, M4-P10)<br>`proof/sensitivity.test.mjs` (Mutant 1, 4, 5) |
| **M4-R6: Durable State & Revalidation** | Matching hash alone verified bookmark at page 42 against 10-page document. Previous SQLite tests were in-memory only without close/reopen, mixed generations, or rollback. | 1. Bounded revalidation: bookmarks exceeding `totalPages` remain `'unverified'` even if hash matches.<br>2. Created `DocumentPersistenceProtocol` for file-backed SQLite lifecycle.<br>3. Proved close and reopen across database connections.<br>4. Proved content replacement A/50 -> B/10 with mixed bookmark generations.<br>5. Proved multi-table transaction rollback restoring state on failure.<br>6. Proved `ON DELETE CASCADE` cleans up all dependent navigation rows.<br>7. Proved backup/restore with disk drift invalidation. | `proof/contractModel.mjs`<br>`proof/persistenceProtocol.mjs`<br>`proof/databaseLifecycle.test.mjs`<br>`proof/proof.test.mjs` (M4-P4)<br>`proof/sensitivity.test.mjs` (Mutant 2) |
| **M4-R7: Opener Lifecycle & Intent Ownership** | Newer failed request (e.g. missing path) failed before advancing intent, letting older pending open publish "Opened". Failing material B leaked material A's page 42. Destination NaN was not pre-validated. Injected persistence was absent. | 1. Advanced intent generation ID at start of `requestOpen` before input validation.<br>2. Cleared stale notices immediately on all failure and abort paths.<br>3. Scoped progress by material ID; failing material B returns `lastRequestedPage: null`.<br>4. Pre-validated physical destinations before invoking opener; rejected NaN without opener call.<br>5. Added `injectedPersistence` callback; handled save failures with partial notice (`"opened but position not saved"`) without replaying opener.<br>6. Kept missing-file recovery an enabled distinct reachable action. | `proof/openerController.mjs`<br>`proof/proof.test.mjs` (M4-P8, M4-P10)<br>`proof/sensitivity.test.mjs` (Mutant 3) |
| **M4-R8: Truthful Research & Real Parser Proof** | Custom regex scanner could not detect page-tree corruption (/Count 99 with 50 leaves). PDFium license attribution omitted redistribution conditions. Safari 16.4 was assumed macOS 13+ only. | 1. Evaluated actual candidate engine `pdfjs-dist@6.3.289` in scratch dependencies.<br>2. Proved page catalog resolution: PDF.js warned of invalid /Count 99 and resolved actual 50 pages.<br>3. Proved graceful rejection of `malformed_sample.pdf` with `InvalidPDFException`.<br>4. Inspected PDFium LICENSE: documented 3-clause BSD redistribution conditions, Apache-2.0, and third-party notices.<br>5. Corrected Safari 16.4 facts: available on Big Sur and Monterey with WASM SIMD; desktop WKWebView runtime compatibility remains explicitly unverified without physical device testing.<br>6. Synchronized conditional implementation prompt and evaluation report. | `proof/realParserDemonstration.mjs`<br>`proof/proof.test.mjs` (M4-P6, M4-P7)<br>`docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md`<br>`docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md` |

---

## 4. Verification Suite Results & Receipts

All test suites execute deterministically under Node.js native test runner (`node:test`) and are coordinated by [scripts/run_remaining_proof.mjs](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scripts/run_remaining_proof.mjs):

| Test Suite | File | Expected Result | Measured Result | Receipt |
| --- | --- | --- | --- | --- |
| **Proof Suite (M4-P1–P10)** | `proof/proof.test.mjs` | 10 passed, Exit 0 | **10 passed, 0 failed** (Exit 0) | [03-proof-suite.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/03-proof-suite.txt) |
| **Database Lifecycle (M4-DB-LC-1–7)** | `proof/databaseLifecycle.test.mjs` | 7 passed, Exit 0 | **7 passed, 0 failed** (Exit 0) | [03-proof-suite.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/03-proof-suite.txt) |
| **Sensitivity Mutants (1–5)** | `proof/sensitivity.test.mjs` | 5 passed, Exit 0 | **5 passed, 0 failed** (Exit 0) | [03-proof-suite.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/03-proof-suite.txt) |
| **Rereview Diagnostics** | `diagnostics.test.mjs` (rereview pack) | 13 failed, 2 passed, Exit 1 | **13 failed, 2 passed** (Exit 1) | [05-diagnostics.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/05-diagnostics.txt) |
| **Frozen Current Controls** | `frozen-current.test.mjs` (rereview pack) | 10 passed, Exit 0 | **10 passed, 0 failed** (Exit 0) | [05-diagnostics.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/05-diagnostics.txt) |
| **Hygiene Check** | `git diff --check` + whitespace scan | Clean, 0 trailing whitespace | **Clean (Exit 0)** | [04-hygiene.txt](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/receipts/04-hygiene.txt) |
| **Final Checksum Manifest** | `shasum -a 256 -c SHA256SUMS` | 28/28 OK | **28/28 files OK** | [SHA256SUMS](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/SHA256SUMS) |

---

## 5. Honestly Disclosed Unverified Items

In accordance with strict technical rigor:
1. **macOS 12 Monterey WKWebView Runtime Compatibility**:
   - `react-pdf@11.0.0` specifies **Safari 18+** as its minimum requirement.
   - macOS 12 Monterey received a maximum browser release of Safari 17.6 and uses system WKWebView ~16.0.
   - While Safari 16.4 on Monterey enabled WASM SIMD ([WebKit blog 13966](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)), standalone Safari browser updates do not guarantee that system WKWebView embedded inside desktop applications supports the same modern WebKit primitives without physical hardware testing.
   - **Conclusion**: This compatibility boundary remains **unverified pending testing on physical macOS 12 hardware**.
2. **Embedded Canvas Memory Footprint on Low-RAM Hardware**:
   - Canvas/WASM memory usage for complex FAA publications remains an unmeasured estimate on target hardware. Physical device profiling is required before approving Step 2 embedded viewers.

---

## 6. Repository & Worktree Invariant Audit

- **Primary Working Tree** (`/Users/rickymac/code/Flight-training-`): **Untouched**.
- **Claude M3 Worktree** (`/Users/rickymac/code/Flight-training-m3-skills-scope`): **Untouched**.
- **Shared Tracking Files** (`ROADMAP.md`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`): **Untouched** (proposed entries supplied in report §9).
- **Production Code & Dependencies**: **Zero edits**.
- **Runtime Migrations**: Candidate 0015 remains strictly **provisional, unregistered, and unapplied**.
- **Git Status**: Clean working tree; zero tracked files modified; all new deliverables located in `docs/` and `docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/`.

---

## 7. Conclusion & Next Steps

All remaining corrections M4-R5 through M4-R8 are complete, substantiated by file-backed SQLite lifecycle tests, sensitivity mutants, evaluated PDF.js engine demonstrations, and verified against frozen review diagnostics.

The package is submitted for independent senior review and owner default selection (OD-1 through OD-10). All changes remain uncommitted and unpushed in accordance with workflow instructions.
