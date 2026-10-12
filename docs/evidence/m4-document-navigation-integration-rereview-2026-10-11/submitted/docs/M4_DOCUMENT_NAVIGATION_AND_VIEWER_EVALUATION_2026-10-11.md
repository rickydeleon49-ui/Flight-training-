# Her Flight Deck: M4 Document Navigation and Open-Source PDF Viewer Evaluation

**Date**: October 11, 2026 (Updated Submission M4-R5–R8)
**Status**: Comprehensive Technical Evaluation & Scope Proposal (Prepared for Senior Review & Owner Approval)
**Author**: Independent Technical Evaluation
**Starting Baseline Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)
**Production Code Impact**: Zero production edits; zero lockfile modifications; candidate schema unapplied and unregistered.

---

## 1. Executive Summary & Roadmap Alignment

Milestone 4 ("Document navigation and local retrieval") is planned in two distinct stages:
1. **Step 1**: Source links, bookmarks, last-requested page tracking, and destination coordinate navigation with strict bounds validation and split-document coordinate translation. Unsupported native page jumps visibly fall back to opening the document while displaying the target page.
2. **Step 2**: Evaluation of an embedded PDF viewer with lazy rendering, bounded memory, keyboard navigation, zoom, and text search, while retaining native OS Open/Reveal as an authoritative baseline.

Following the independent review ([docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md)), this corrected package delivers:
- **R5 (Complete Destination Resolution)**: Enforces `Number.isSafeInteger` consistently across all page counts, requests, and lineage fields. Requires explicit provenance for numeric source references (numbers without provenance remain unresolved). Rejects physical page zero and string concatenation. Enforces lineage range length matching (`parentPageEnd - parentPageStart + 1 === childPageCount`) and destination bounds. Returns destination material ID in all directions (including `root_to_child`).
- **R6 (Durable Navigation State & Bounded Revalidation)**: Binds bookmarks and reading state directly to `originating_content_sha256`. Enforces bounded revalidation: a matching hash cannot verify an out-of-bounds bookmark ($P > \text{totalPages}$). Verifies file-backed SQLite lifecycle across close/reopen, mixed bookmark generations, cascade deletion, transaction rollback, and backup/restore with disk drift invalidation.
- **R7 (Opener Lifecycle & Durable Persistence)**: Implements pre-validation intent advancement so newer failed or invalid requests supersede older pending opens. Scopes requested progress by material so failing material B never exposes material A's page 42. Pre-validates destinations before opener invocation. Integrates injected durable persistence and handles save failures with clear notices without replaying the opener. Preserves a distinct reachable recovery action.
- **R8 (Truthful Research & Real Parser Proof)**: Evaluates the actual candidate engine `pdfjs-dist@6.3.289` in scratch dependencies across all synthetic fixtures. Proves real page catalog resolution (resolving actual 50 pages despite forged `/Count 99`) and graceful rejection of malformed PDFs (`InvalidPDFException`). Inspects package licenses and third-party notices (PDFium 3-clause BSD redistribution, Apache-2.0, bundled fonts > 4 MB). Corrects Safari 16.4 facts (WASM SIMD available on Monterey and Big Sur, [WebKit blog 13966](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)) while maintaining that desktop WKWebView runtime compatibility remains **unverified without physical hardware testing**.

---

## 2. Current Behavior and Gap Analysis

### 2.1 Document Storage & Material Identity

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Storage Root** | Private app data subdirectory `documents/` (never repo). Subdirectory `.trash/` handles recoverable staged deletions. | [documents.rs:20-85](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L20-L85) `documents_root`, `stored_document_path` | Verified filesystem isolation; files remain strictly app-private. |
| **Path Safety** | Refuses absolute paths, `..` traversals, backslashes, colons, NULs, and trailing dots/spaces. | [documents.rs:92-119](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L92-L119) `safe_relative_path`, `is_hidden_or_ambiguous` | Stored relative path is verified on every native read/delete call. |
| **Identity in DB** | `study_materials.id` (UUID or imported string) is primary key. `file_path` stores relative path. | [0001_initial_schema.sql:96-112](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/migrations/0001_initial_schema.sql#L96-L112) | **Gap**: `study_materials` lacks a `content_sha256` column or `total_pages` column for non-split materials. |
| **Fingerprinting** | Native command computes SHA-256 for up to 20 stored files on demand. | [lineage.rs:927-949](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/lineage.rs#L927-L949) `fingerprint_stored_documents_at` | Available via IPC (`invokeFingerprintStoredDocuments`), but not persisted on material record. |

### 2.2 Split-Parent Page Ranges & Lineage

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Split Provenance** | Shipped schema 13 records `source_page_start`, `source_page_end`, `parent_page_start`, `parent_page_end`, `child_page_count`, `source_content_sha256`, `nested_level`. | [0013_split_source_lineage.sql:29-58](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/migrations/0013_split_source_lineage.sql#L29-L58) `material_split_lineage` | Lineage is fully recorded and validated by database constraints. |
| **Page Counts** | Read via `lopdf::Document::load` on demand. Limits splits to 1,000 pages and 50 MiB. | [pdf.rs:41-80](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/pdf.rs#L41-L80) `inspect_pdf`, `page_count` | `total_pages` is not cached for non-split materials; must re-parse PDF file on demand. |
| **Range Translation** | Lineage maps child pages to root handbook pages: $P_{\text{root}} = \text{source\_page\_start} + P_{\text{child}} - 1$. | [lineage.rs:43-77](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/lineage.rs#L43-L77) `SplitPlanPart`, `SplitParentSnapshot` | **Gap**: Frontend components do not expose coordinate translation. Furthermore, if a root document is deleted, coordinates must not be misrouted to parent parts. |

### 2.3 Source References in Study Features

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Data Types** | `sourcePage: number \| null` on `StudyFlashcard`, `PracticeQuestion`, `PracticeTestItem`, and `CardReviewSnapshotItem`. | [types.ts:374,405,446,684](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/domain/types.ts#L374) | Typed consistently across all AI and practice entities. |
| **AI Generation** | Gemini schema declares `sourcePage: INTEGER \| null`. | [gemini.rs:516,658](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/gemini.rs#L516) `generate_study_aid_inner` | **Clarification (R2/R5)**: Gemini's typed contract is integer-or-null. However, coordinate provenance is ambiguous; numbers without explicit provenance must remain unresolved. |
| **UI Presentation** | Displayed as static `<Badge tone="study">{item.sourcePage ? \`Source p. ${item.sourcePage}\` : "Check source"}</Badge>`. | [PracticeTestPanel.tsx:1253](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/PracticeTestPanel.tsx#L1253), [MaterialDetail.tsx:794](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/MaterialDetail.tsx#L794), [CardReviewPanel.tsx:380](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/CardReviewPanel.tsx#L380) | **Critical Gap**: Badges are completely static and non-clickable. They do not trigger an open action or page jump. |

### 2.4 Native Opening, Reveal, and IPC Capabilities

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Open Native** | Resolves absolute path via `document_path`, then calls `openPath(absolute)` via `@tauri-apps/plugin-opener`. | [documents.ts:90-94](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/services/documents.ts#L90-L94) `openDocument` | **Native OS Limit**: macOS Preview.app and Windows default handler do not accept CLI page arguments via `openPath`. Opens at page 1 or last window state. |
| **Tauri Capabilities** | Grants `opener:allow-open-path` and `opener:allow-reveal-item-in-dir` for `$APPCONFIG/documents/**`. | [default.json:13-20](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/capabilities/default.json#L13-L20) `capabilities/default.json` | **Security Limit**: No `fs:allow-read-file` permission is granted to frontend. Webview cannot load `file:///` URLs or read document bytes without native IPC commands. |

### 2.5 Missing-File Recovery & Backup Invariants

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Missing Check** | `documentExists(rel)` checks physical file; `check_library` reports missing documents vs database. | [documents.rs:491,1081](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L491) `document_exists`, `check_library` | Accurately identifies missing files without database corruption. |
| **File Restore** | `restoreDocumentCopy` prompts user to pick replacement, copies to app storage, updates `study_materials`. | [documentRecovery.ts:16-56](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/logic/documentRecovery.ts#L16-L56), [MaterialDetail.tsx:359](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/MaterialDetail.tsx#L359) | **Recovery Action**: Missing-file badges must visibly indicate unavailable state, but recovery must remain a distinct reachable action. |
| **Backup Scope** | Scans `study_materials.file_path` (`query_referenced_documents`) to pack database and `documents/` into zip archive. | [backup.rs:2931-2990](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/backup.rs#L2931-L2990) `query_referenced_documents` | **Invariant**: Navigation metadata must participate in standard backup. Rebuildable text caches must be excluded from backup. Older binaries must not fail on candidate tables. |

---

## 3. First Implementation Slice Specification (M4 Slice 1)

### 3.1 Scope & Corrected Domain Rules

1. **Explicit Coordinate Provenance Resolution (R5)**:
   - Make static `Source p. X` badges interactive buttons with keyboard focus (`Enter`/`Space`) and `aria-label`.
   - Resolve coordinate space explicitly:
     - Pure numbers without declared provenance (e.g. legacy Gemini `sourcePage`) remain **unresolved** (`isResolved: false`, `physicalIndex: null`).
     - Explicit physical references require `provenance: 'physical_index'` and must be safe integers $\ge 1$ within document bounds.
     - Printed labels (e.g. "3-12", "iv") check a verified label-to-physical map ($1 \le M \le \text{totalPages}$); unmapped labels remain unresolved without inventing physical page 1.
2. **Lineage Range Validation & Navigation Safety (R5)**:
   - Lineage ranges require `Number.isSafeInteger` and length consistency: `parentPageEnd - parentPageStart + 1 === childPageCount` and `sourcePageEnd - sourcePageStart + 1 === childPageCount`. String coordinates are rejected.
   - Translation returns destination material ID and coordinate space in every successful direction (including `root_to_child`).
   - If root or parent is deleted, returns `sourceMaterialId: null`, code `ROOT_DELETED` or `PARENT_DELETED` with snapshot guidance.
3. **Durable Content Ownership & Bounded Revalidation (R6)**:
   - Persists `originating_content_sha256` (strict 64-char hex) and `status` (`'verified'` | `'unverified'`).
   - **Bounded Revalidation**: When document content is replaced or updated, matching hashes alone cannot verify a bookmark if its `pageIndex` exceeds `totalPages`. Out-of-bounds bookmarks remain `'unverified'`.
   - File-backed SQLite lifecycle guarantees persistence across reopen, mixed bookmark generations, rollback, and cascade deletion.
4. **Opener Controller Lifecycle & Supersession (R7)**:
   - Advance intent generation before validation. Clear stale notices on all paths.
   - Newer requests (including invalid/missing-path requests) supersede older pending open operations.
   - Reading progress is scoped by material ID; failing material B never exposes material A's requested page.
   - Destinations are pre-validated before opener invocation.
   - Injected durable persistence saves reading position; save failures report partial notice (`"opened but position not saved"`) without replaying the opener.
   - Opening never marks reading confirmed (`confirmed_read: 0`). A confirmed page marker does NOT imply whole-document completion.
   - Missing-file recovery remains an enabled, distinct reachable action.

### 3.2 Candidate Migration Schema (Provisional 0015)

Provided in [`candidate/candidate_migration_0015.sql`](evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/candidate/candidate_migration_0015.sql):

```sql
-- 1. Reading state: tracks the last physical page requested and optional confirmed reading progress.
CREATE TABLE IF NOT EXISTS material_reading_state (
  material_id                 TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  last_requested_page         INTEGER NOT NULL CHECK (TYPEOF(last_requested_page) = 'integer' AND last_requested_page >= 1),
  last_requested_page_label   TEXT CHECK (last_requested_page_label IS NULL OR LENGTH(last_requested_page_label) <= 100),
  confirmed_read              INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_read IN (0, 1)),
  originating_content_sha256  TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unverified', 'drifted')),
  updated_at                  TEXT NOT NULL
);

-- 2. Bookmarks: user-created navigation points bound to originating document content.
CREATE TABLE IF NOT EXISTS material_bookmarks (
  id                          TEXT PRIMARY KEY NOT NULL,
  material_id                 TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  page_index                  INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1),
  page_label                  TEXT CHECK (page_label IS NULL OR LENGTH(page_label) <= 100),
  originating_content_sha256  TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  title                       TEXT NOT NULL CHECK (LENGTH(title) <= 500),
  notes                       TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 20000),
  status                      TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'unverified', 'drifted')),
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_material ON material_bookmarks(material_id);
CREATE INDEX IF NOT EXISTS idx_material_bookmarks_page ON material_bookmarks(material_id, page_index);
CREATE INDEX IF NOT EXISTS idx_material_bookmarks_hash ON material_bookmarks(originating_content_sha256);

-- 3. Document content identity: caches verified SHA-256 and total page counts.
CREATE TABLE IF NOT EXISTS material_content_identities (
  material_id    TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL CHECK (LENGTH(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  total_pages    INTEGER NOT NULL CHECK (TYPEOF(total_pages) = 'integer' AND total_pages >= 1),
  verified_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_content_sha ON material_content_identities(content_sha256);
```

---

## 4. Open-Source PDF Viewer Evaluation (Corrected Evidence)

### 4.1 Upstream Package Identities & Primary Licensing Evidence (R1/R8)

1. **React-PDF (`react-pdf`)**:
   - Version: `11.0.0` | License: `MIT`
   - Git Head: `ca2330bcb862dc27aa39849c74657ccf28c4e13f`
   - Unpacked Size: **336,660 bytes** (336 KB)
   - Direct Dependencies: `pdfjs-dist@6.3.289` (Apache-2.0, unpacked: ~34.8 MB), `clsx`, `dequal`, `es-toolkit`, `make-cancellable-promise`, `make-event-props`, `merge-refs`, `tiny-invariant`, `warning`.
   - Upstream Documentation: [React-PDF README](https://raw.githubusercontent.com/wojtekmaj/react-pdf/main/packages/react-pdf/README.md) explicitly specifies: **"Supports Safari 18 (iOS 18) or newer."**
2. **EmbedPDF (`@embedpdf/pdfium` & `@embedpdf/engines`)**:
   - Version: `2.15.1` | Package License: `MIT`
   - Unpacked Size: `@embedpdf/pdfium`: **7,554,316 bytes** (7.55 MB, dominated by `dist/pdfium.wasm`); `@embedpdf/engines`: **4,014,315 bytes** (4.01 MB).
   - Bundled Fonts: `@embedpdf/engines` bundles language font packages (`@embedpdf/fonts-jp`, `kr`, `sc`, `tc`, `latin`, `arabic`, `hebrew`) totaling > 4 MB.
   - Bundled Engine: Chromium / Google PDFium compiled to WebAssembly.
   - Licensing Conditions: [Chromium PDFium LICENSE](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE) contains 3-clause BSD redistribution conditions, Apache-2.0 text, and third-party notices for libjpeg-turbo, libpng, zlib, freetype2, lcms2, openjpeg, abseil-cpp.

### 4.2 WebKit, Safari & macOS Engine Boundaries (Corrected Facts)

- **Primary Source Correction**: WebKit Feature Release Notes ([WebKit blog 13966](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)) document that Safari 16.4 shipped on March 27, 2023 for **macOS 13 Ventura, macOS 12 Monterey, and macOS 11 Big Sur**, enabling WebAssembly SIMD (`-msimd128`).
- **Engine Distinction**:
  - Minimum Declared OS: **macOS 12 Monterey**. The last Safari release available on Monterey was Safari 17.6 (July 2024).
  - Upstream Requirement: React-PDF 11 default documentation lists **Safari 18+**, which was never released for macOS 12 Monterey.
  - **Explicitly Unverified Status**: Whether React-PDF 11 or modern PDF.js can render reliably on macOS 12 Monterey WKWebView is **explicitly unverified without testing on physical macOS 12 hardware**. Node test runners or modern macOS WebKit simulations cannot prove macOS 12 runtime compatibility.

### 4.3 Evaluated Real PDF Parser Demonstration (pdfjs-dist 6.3.289)

We evaluated the actual candidate engine `pdfjs-dist@6.3.289` (isolated in scratch dependencies) across all synthetic fixtures ([proof/realParserDemonstration.mjs](evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/realParserDemonstration.mjs)):
- `handbook_root_sample.pdf` (17,878 bytes): **Parsed successfully**, 50 pages enumerated, verified buffer cleanup.
- `multi_page_sample.pdf` (3,809 bytes): **Parsed successfully**, 10 pages.
- `single_page.pdf` (581 bytes): **Parsed successfully**, 1 page.
- `split_part_sample.pdf` (5,947 bytes): **Parsed successfully**, 16 pages.
- `malformed_sample.pdf` (173 bytes): **Gracefully rejected**: `InvalidPDFException ("Invalid PDF structure.")` without process crash.
- **Page-Tree Corruption Test**: When `/Count 50` was forged to `/Count 99` while leaving all 50 leaves intact, PDF.js warned: `checkLastPage - invalid /Pages tree /Count: 99` and correctly resolved the actual 50 page objects.

---

## 5. Comparison Table & Capability Matrix

| Evaluation Dimension | Option A: Native Open + In-App HUD | Option B: React-PDF 11 / PDF.js 6.3 | Option C: EmbedPDF / PDFium WASM 2.15 |
| --- | --- | --- | --- |
| **Exact Packages** | `@tauri-apps/plugin-opener` 2.5.0 | `react-pdf@11.0.0`, `pdfjs-dist@6.3.289` | `@embedpdf/pdfium@2.15.1`, `@embedpdf/engines@2.15.1` |
| **Licenses** | MIT OR Apache-2.0 | MIT (`react-pdf`) + Apache-2.0 (`pdfjs-dist`) | MIT SDK + Apache-2.0 / BSD redistribution (PDFium engine) |
| **macOS 12 Monterey Compatibility** | **Supported** (OS default handler) | **UNVERIFIED** (Upstream specifies Safari 18+; Monterey received max Safari 17.6) | **UNVERIFIED** (Requires testing if compiled with WASM SIMD / Safari 16.4+) |
| **Offline Operation** | 100% Offline (Local system viewer) | Offline if worker & CMaps bundled locally | Offline if `pdfium.wasm` bundled locally |
| **Unpacked Package Footprint** | **0 KB added** | **~35.1 MB unpacked** (336 KB + 34.8 MB) | **~11.5 MB unpacked** (7.55 MB WASM + 4.01 MB engines/fonts) |
| **Runtime Webview Memory** | **0 MB** in webview (Managed by OS Preview) | **Not measured on target OS** (Estimated high canvas memory) | **Not measured on target OS** (Estimated 128–256 MB WASM linear heap) |
| **Tauri File Access** | Uses existing `opener:allow-open-path` | Requires native binary streaming IPC | Requires native binary streaming IPC |
| **Recommendation** | **Adopt for M4 Slice 1** | Defer pending physical Mac evidence | Defer pending physical Mac evidence |

---

## 6. Numbered Proposed Owner Defaults (OD-1–OD-10)

All defaults remain **PROPOSED** pending senior scope acceptance and owner decision:
- **OD-1 (Two-Stage Delivery)**: Implement Step 1 (document navigation, bookmarks, reading tracking, coordinate translation) now; evaluate embedded canvas viewer conditionally in Step 2.
- **OD-2 (Retain Native Open as Baseline)**: Never replace or deprecate native OS opening via `@tauri-apps/plugin-opener`. Preview/Edge remains the 100% reliable reader for complex FAA publications.
- **OD-3 (Preserve macOS 12 Support)**: Do not raise the minimum supported macOS version to macOS 14 Sonoma merely to adopt `react-pdf@11`. Keep historical WebKit compatibility unverified until tested on physical hardware.
- **OD-4 (Strict Integer Physical Page Indexing)**: Persisted physical page indices must be finite safe integers $\ge 1$ matching PDF leaf order.
- **OD-5 (Separate Printed Page Labels)**: Store printed labels (e.g. "iv", "3-12", "Cover") in optional text fields (`page_label`), preventing string labels from corrupting numeric jump logic.
- **OD-6 (Safe Bounds Clamping for Explicit Coordinates)**: If an explicitly physical page coordinate is $< 1$, clamp to 1 with warning; if $> \text{totalPages}$, clamp to $\text{totalPages}$ with warning.
- **OD-7 (Split-Lineage Coordinate Mapping & Deleted Root Safety)**: Translate child pages to root handbook pages using lineage. If root is deleted, do not misroute coordinates to a parent part.
- **OD-8 (Durable Content Hash Ownership & Bounded Revalidation)**: Bind bookmarks and reading state directly to `originating_content_sha256`. If document content changes, flag bookmarks as `unverified`. Matching hash cannot verify out-of-bounds bookmarks.
- **OD-9 (Honest Reading Semantics & Opener Error Handling)**: Store `last_requested_page` and `confirmed_read`. Failed opening must not announce success or advance reading progress.
- **OD-10 (Strict Backup State Isolation)**: Navigation entities participate in standard backup/restore. No rebuildable search caches may enter authoritative backup scope.

---

## 7. Explicit Exclusions

1. **In-PDF Annotations & Ink Drawing**: Deferred until navigation is proven.
2. **Optical Character Recognition (OCR)**: Scanned PDFs remain viewable; OCR is deferred until measured search failures justify heavy OCR sidecars.
3. **Vector Embeddings & Semantic Search**: Local retrieval will use deterministic keyword / SQLite indexing only.
4. **Cloud PDF / AI Indexing Services**: No third-party viewer backends or automatic document uploads.
5. **PDF Modification in Reader**: The reader is strictly read-only.

---

## 8. Acceptance Criteria for M4 Slice 1

- [ ] **AC-1 (Interactive Source Badges)**: Static `Source p. X` badges become interactive buttons with keyboard focus (`Enter`/`Space`) and `aria-label`. Numeric references without provenance remain unresolved.
- [ ] **AC-2 (Navigation HUD & Opener State Machine)**: Clicking an active source badge invokes `openDocument` via the opener controller. On success, displays HUD toast. On failure, displays error notice without claiming success. In-flight supersession cancels stale notifications.
- [ ] **AC-3 (Bookmark Management with Originating Hash)**: Pilot can add a bookmark bound to active `content_sha256`, view bookmarks, jump to page, and delete bookmarks.
- [ ] **AC-4 (Honest Reading Position Tracking)**: Reading state persists `last_requested_page` and `confirmed_read`. Requested page is not marked confirmed read. Confirmed page does not imply whole-document completion.
- [ ] **AC-5 (Split Coordinate Translation & Deleted Root Safety)**: Accurately translates child page to root handbook page; if root is deleted, displays snapshot guidance without misrouting coordinates to parent.
- [ ] **AC-6 (Content Drift Protection & Bounded Revalidation)**: Replacing a document with different bytes flags existing bookmarks as `unverified`. Same hash cannot verify out-of-bounds bookmarks.
- [ ] **AC-7 (Missing File Handling & Distinct Recovery)**: If file is missing from disk, source links show unavailable styling, but a distinct "Restore / Locate File" action remains fully enabled and reachable.
- [ ] **AC-8 (Zero Production Dependency Changes)**: Production `package.json` and `Cargo.toml` remain unchanged.
- [ ] **AC-9 (Clean Verification Matrix)**: All standard repository gates pass (`npm test`, `npm run typecheck`, `cargo test`, `git diff --check`).

---

## 9. Proposed Tracking Entries (Not Yet Applied)

### 9.1 For `ROADMAP.md` (under Section 9: M4)
```markdown
- **M4 Step 1 (Scope Defined)**: Interactive source links, bookmarks, reading state, split coordinate translation, and native navigation HUD designed. Evaluated open-source viewers (Native Open vs PDF.js vs EmbedPDF); WebKit macOS 12 constraint documented as unverified pending device test.
```

### 9.2 For `STATUS.md`
```markdown
### Milestone 4 — Document Navigation (October 11, 2026)
- **Status**: M4 evaluation and Slice 1 specification completed with remaining corrections (M4-R5–R8).
- **Evidence**: `docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/` (10 proof tests, 7 database tests, 5 sensitivity tests, real pdfjs-dist demonstration, provisional candidate migration 0015).
- **Next Step**: Senior review of M4 correction package and owner approval of proposed defaults OD-1–OD-10 before beginning Slice 1 implementation.
```

### 9.3 For `docs/PROJECT_HANDOFF.md`
```markdown
### 2026-10-11: Milestone 4 Document Navigation & Viewer Evaluation Corrections (M4-R5–R8)
- Completed M4-R5–R8 remaining corrections in isolated worktree `Flight-training-m4-viewer-evaluation`.
- Base commit: `c28ab8482c8635b0b2bf74686b081e02bf448f65`.
- Verified WebKit boundary: Safari 16.4 shipped WASM SIMD on Monterey & Big Sur; React-PDF 11 requires Safari 18+; Monterey received max Safari 17.6; desktop WKWebView runtime compatibility remains unverified without physical device testing.
- Real PDF engine evaluated: `pdfjs-dist@6.3.289` in scratch dependencies demonstrated page catalog enumeration, resolution of actual 50 pages despite forged /Count 99, and graceful rejection of malformed PDFs.
- Bounded revalidation proved in file-backed SQLite: out-of-bounds bookmarks cannot become verified; multi-table rollback and backup/restore verified.
- OpenerController state machine verified: pre-validation intent advancement, supersession of older opens by newer requests, material-scoped reading progress, and injected durable persistence.
- Provisional candidate migration 0015 defined and verified; left unregistered and unapplied.
```
