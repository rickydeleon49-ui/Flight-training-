# Her Flight Deck: M4 Document Navigation and Open-Source PDF Viewer Evaluation

**Date**: October 11, 2026 (Corrected Submission M4-R1–R4)
**Status**: Comprehensive Technical Evaluation & Scope Proposal (Prepared for Senior / Owner Review)
**Author**: Independent Technical Evaluation
**Starting Baseline Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)
**Production Code Impact**: Zero production edits; zero lockfile modifications; candidate schema unapplied and unregistered.

---

## 1. Executive Summary & Roadmap Alignment

Milestone 4 ("Document navigation and local retrieval") is planned in two distinct stages:
1. **Step 1**: Source links, bookmarks, last-requested page tracking, and destination coordinate navigation with strict bounds validation and split-document coordinate translation. Unsupported native page jumps visibly fall back to opening the document while displaying the target page.
2. **Step 2**: Evaluation of an embedded PDF viewer with lazy rendering, bounded memory, keyboard navigation, zoom, and text search, while retaining native OS Open/Reveal as an authoritative baseline.

Following the independent review ([docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md)), this corrected package delivers:
- **R1 (Evidence & Artifact Research)**: Replaces hard-coded browser assertions with primary-source documentation; distinguishes the macOS 12 minimum OS from modern WebKit engines; explicitly discloses that historical macOS 12 Monterey WebKit runtime compatibility is **unverified without physical hardware testing**; replaces unmeasured performance claims with exact npm package metadata; and proves actual PDF loading and cleanup on synthetic fixtures using a structural parser.
- **R2 (Page-Coordinate Contract)**: Enforces finite safe integer validation on requests and totals; prevents unknown printed labels from inventing physical destinations; requires explicit coordinate provenance or verified label mapping; and prevents deleted roots from misrouting coordinates to parent materials.
- **R3 (Durable Content Ownership)**: Binds bookmarks and reading positions directly to their `originating_content_sha256` in candidate DDL; enforces strict 64-character hex format; proves transactional drift invalidation (`unverified` status); and verifies pre-existing schema-13 row retention and cascade safety in genuine SQLite databases.
- **R4 (Complete Conditional Handoff)**: Implements honest reading semantics ("Last requested page" distinct from confirmed reading); adds an injected opener controller state machine proving error handling and late callback abortion; notes migration numbering as provisional until accepted main / M3 reconciliation; and provides a synchronized conditional implementation prompt.

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
| **AI Generation** | Gemini schema declares `sourcePage: INTEGER \| null`. | [gemini.rs:516,658](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/gemini.rs#L516) `generate_study_aid_inner` | **Clarification (R2)**: Gemini's typed contract is integer-or-null (not arbitrary string). However, because the LLM extracts numbers from page text, coordinate provenance is ambiguous (printed number vs physical leaf). |
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
| **File Restore** | `restoreDocumentCopy` prompts user to pick replacement, copies to app storage, updates `study_materials`. | [documentRecovery.ts:16-56](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/logic/documentRecovery.ts#L16-L56), [MaterialDetail.tsx:359](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/MaterialDetail.tsx#L359) | **Gap (R3)**: Does not verify whether replacement file has identical content hash. Stale bookmarks must not be silently assumed valid. |
| **Backup Scope** | Scans `study_materials.file_path` (`query_referenced_documents`) to pack database and `documents/` into zip archive. | [backup.rs:2931-2990](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/backup.rs#L2931-L2990) `query_referenced_documents` | **Invariant**: Navigation metadata must use standard foreign keys (`study_materials(id) ON DELETE CASCADE`). Rebuildable text caches must be excluded from backup. |

---

## 3. First Implementation Slice Specification (M4 Slice 1)

### 3.1 Scope & Corrected Domain Rules

1. **Interactive Source Badges with Provenance Awareness (R2)**:
   - Make static `Source p. X` badges interactive buttons with keyboard focus (`Enter`/`Space`) and `aria-label`.
   - When clicked, resolves coordinate space:
     - Pure numeric references with declared physical provenance navigate to physical leaf.
     - Printed labels (e.g. "3-12", "iv") check a verified page-label map; if unmapped, physical index remains `null` (unknown stays unknown).
     - Clicking an unmapped printed label launches native viewer with snapshot guidance rather than inventing physical page 1.
2. **Bookmarks Bound to Originating Content Hash (R3)**:
   - Persists `page_index` (1-based physical integer), `originating_content_sha256` (strict 64-char hex), `title` ($\le 500$ chars), `notes` ($\le 20,000$ chars), and `status` (`'verified'` / `'unverified'`).
   - If a document is replaced with different bytes, bookmarks retain their original hash and become `'unverified'`, alerting the pilot.
3. **Honest Reading Semantics (R4)**:
   - Table `material_reading_state` persists `last_requested_page` and `confirmed_read` (0 or 1).
   - Launching a document updates `last_requested_page` upon opener resolution, but does NOT mark `confirmed_read: 1`.
   - "Resume at page X" indicates the last requested destination.
4. **Split-Document Coordinate Translation & Deleted Root Safety (R2)**:
   - For split parts with live root: translates child page $P_{\text{child}}$ to root handbook page $P_{\text{root}} = \text{source\_page\_start} + P_{\text{child}} - 1$.
   - **Deleted Root Handling**: If `rootMaterialId` is null, returns `sourceMaterialId: null`, `code: "ROOT_DELETED"`. Does **not** misroute root coordinates to a parent part.
   - For nested splits with live parent: returns `destinationSpace: "parent_physical"` using `parentPageStart`.
5. **Injected Opener Controller State Machine (R4)**:
   - Opener lifecycle transitions: `idle` -> `opening` -> `opened` / `failed` / `aborted`.
   - On opener error: transitions to `failed`, displays error toast, does **not** announce success, does **not** update reading progress. Missing-file recovery remains accessible.
   - On route/material change while open is in flight: operation is aborted; late resolution is ignored.

### 3.2 Candidate Migration Schema (Provisional 0015)

Provided in [`docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql`](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql):

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

### 4.1 Upstream Package Identities & Primary Evidence (R1)

Exact npm registry responses and commit identities (verified against review upstream fixtures):

1. **React-PDF (`react-pdf`)**:
   - Version: `11.0.0` | License: `MIT`
   - Git Head: `ca2330bcb862dc27aa39849c74657ccf28c4e13f`
   - Tarball SHA-1: `779067bee2c7cbd0f0df580df2d865ac12f1c94a`
   - Unpacked Size: **336,660 bytes** (336 KB)
   - Direct Dependencies:
     - `pdfjs-dist`: `6.3.289` (Apache-2.0, unpacked: ~34.8 MB)
     - `clsx`: `^2.0.0` (MIT), `dequal`: `^2.0.3` (MIT), `es-toolkit`: `^1.52.0` (MIT), `make-cancellable-promise`: `^2.0.0` (MIT), `make-event-props`: `^2.0.0` (MIT), `merge-refs`: `^2.0.0` (MIT), `tiny-invariant`: `^1.0.0` (MIT), `warning`: `^4.0.0` (MIT)
   - Upstream Documentation: [React-PDF README](https://raw.githubusercontent.com/wojtekmaj/react-pdf/main/packages/react-pdf/README.md) explicitly states: **"Supports Safari 18 (iOS 18) or newer."**
2. **EmbedPDF (`@embedpdf/pdfium` & `@embedpdf/engines`)**:
   - Version: `2.15.1` | Package License: `MIT`
   - `@embedpdf/pdfium` Tarball SHA-1: `25c34539ef2a2982d6da6bf8021c2c31e67ee1c8`
   - Unpacked Size: **7,554,316 bytes** (7.55 MB, dominated by `dist/pdfium.wasm`)
   - Bundled Engine: Chromium / Google PDFium compiled to WebAssembly (Apache-2.0).
   - Bundled Notices: Third-party components include libjpeg-turbo, libpng, zlib, lcms2, freetype2, abseil-cpp.
   - Upstream Licensing Scope: [LICENSING.md](https://raw.githubusercontent.com/embedpdf/embed-pdf-viewer/main/LICENSING.md) notes client SDK packages are MIT/Apache-2.0; server components (`cloudpdf/server`) use Fair Core License (FCL-1.0-ALv2).

### 4.2 WebKit, Safari & macOS Engine Boundaries (Corrected Facts)

- **Primary Source Correction**: WebKit Feature Release Notes ([WebKit blog 15063](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)) document that `Promise.withResolvers` and `Object.groupBy` shipped in **Safari 17.4 (March 2024)**.
- **Engine Distinction**:
  - Minimum Declared OS: **macOS 12 Monterey** (released October 2021). The last Safari release available on Monterey was Safari 17.6 (July 2024). System WKWebView inside desktop applications matches the OS build (~WebKit 15/16) unless system WebKit was updated.
  - Upstream Requirement: React-PDF 11 default documentation lists **Safari 18+**. Safari 18 shipped for macOS 13 Ventura, macOS 14 Sonoma, and macOS 15 Sequoia, but was **never released for macOS 12 Monterey**.
  - **Explicitly Unverified Status**: Whether React-PDF 11 or legacy PDF.js can render reliably on macOS 12 Monterey WKWebView is **explicitly unverified without testing on physical macOS 12 hardware**. Node test runners or modern macOS 15/27 WebKit simulations cannot prove macOS 12 runtime compatibility.
  - **WASM SIMD Risk**: WebAssembly SIMD (`-msimd128`) was enabled in Safari in version 16.4 (macOS 13+). If `@embedpdf/pdfium` is compiled with SIMD, it will fail on base macOS 12 WebKit.

### 4.3 Actual Structural PDF Parser Demonstration

Rather than asserting boolean flags, we implemented and executed a structural PDF-1.4 parser ([proof/pdfParserDemonstration.mjs](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-eval-2026-10-11/proof/pdfParserDemonstration.mjs)) across all synthetic fixtures:
- `handbook_root_sample.pdf` (17,878 bytes): **Parsed successfully**, 50 pages, 102 objects, 50 text snippets extracted.
- `multi_page_sample.pdf` (3,809 bytes): **Parsed successfully**, 10 pages, 22 objects, 10 snippets.
- `single_page.pdf` (581 bytes): **Parsed successfully**, 1 page, 4 objects, 1 snippet.
- `split_part_sample.pdf` (5,947 bytes): **Parsed successfully**, 16 pages, 34 objects, 16 snippets.
- `malformed_sample.pdf` (173 bytes): **Gracefully rejected**: `"Malformed PDF: startxref pointer (99999) exceeds file size (173)."`, zero process crash.
- Explicit cleanup verified buffer de-referencing and memory teardown.

---

## 5. Comparison Table & Capability Matrix

| Evaluation Dimension | Option A: Native Open + In-App HUD | Option B: React-PDF 11 / PDF.js 6.3 | Option C: EmbedPDF / PDFium WASM 2.15 |
| --- | --- | --- | --- |
| **Exact Packages** | `@tauri-apps/plugin-opener` 2.5.0 | `react-pdf@11.0.0`, `pdfjs-dist@6.3.289` | `@embedpdf/pdfium@2.15.1`, `@embedpdf/engines@2.15.1` |
| **Licenses** | MIT OR Apache-2.0 | MIT (`react-pdf`) + Apache-2.0 (`pdfjs-dist`) | MIT SDK + Apache-2.0 (PDFium engine) |
| **macOS 12 Monterey Compatibility** | **Supported** (OS default handler) | **UNVERIFIED** (Upstream specifies Safari 18+; Monterey received max Safari 17.6) | **UNVERIFIED** (Requires testing if compiled with WASM SIMD / Safari 16.4+) |
| **Offline Operation** | 100% Offline (Local system viewer) | Offline if worker & CMaps bundled locally | Offline if `pdfium.wasm` bundled locally |
| **Unpacked Package Footprint** | **0 KB added** | **~35.1 MB unpacked** (336 KB + 34.8 MB) | **~7.55 MB unpacked** (primarily WASM) |
| **Runtime Webview Memory** | **0 MB** in webview (Managed by OS Preview) | **Not measured on target OS** (Estimated high canvas memory) | **Not measured on target OS** (Estimated 128–256 MB WASM linear heap) |
| **Tauri File Access** | Uses existing `opener:allow-open-path` | Requires native binary streaming IPC | Requires native binary streaming IPC |
| **Recommendation** | **Adopt for M4 Slice 1** | Defer pending physical Mac evidence | Defer pending physical Mac evidence |

---

## 6. Numbered Proposed Owner Defaults

- **OD-1 (Two-Stage Delivery)**: Implement Step 1 (document navigation, bookmarks, reading tracking, coordinate translation) now; evaluate embedded canvas viewer conditionally in Step 2.
- **OD-2 (Retain Native Open as Baseline)**: Never replace or deprecate native OS opening via `@tauri-apps/plugin-opener`. Preview/Edge remains the 100% reliable reader for complex FAA publications.
- **OD-3 (Preserve macOS 12 Support)**: Do not raise the minimum supported macOS version to macOS 14 Sonoma merely to adopt `react-pdf@11`. Keep historical WebKit compatibility unverified until tested on physical hardware.
- **OD-4 (Strict Integer Physical Page Indexing)**: Persisted physical page indices must be finite safe integers $\ge 1$ matching PDF leaf order.
- **OD-5 (Separate Printed Page Labels)**: Store printed labels (e.g. "iv", "3-12", "Cover") in optional text fields (`page_label`), preventing string labels from corrupting numeric jump logic.
- **OD-6 (Safe Bounds Clamping for Explicit Coordinates)**: If an explicitly physical page coordinate is $< 1$, clamp to 1 with warning; if $> \text{totalPages}$, clamp to $\text{totalPages}$ with warning.
- **OD-7 (Split-Lineage Coordinate Mapping & Deleted Root Safety)**: Translate child pages to root handbook pages using lineage. If root is deleted, do not misroute coordinates to a parent part.
- **OD-8 (Durable Content Hash Ownership)**: Bind bookmarks and reading state directly to `originating_content_sha256`. If document content changes, flag bookmarks as `unverified`.
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

- [ ] **AC-1 (Interactive Source Badges)**: Static `Source p. X` badges become interactive buttons with keyboard focus (`Enter`/`Space`) and `aria-label`.
- [ ] **AC-2 (Navigation HUD & Opener State Machine)**: Clicking an active source badge invokes `openDocument` via the opener controller. On success, displays HUD toast. On failure, displays error notice without claiming success.
- [ ] **AC-3 (Bookmark Management with Originating Hash)**: Pilot can add a bookmark bound to active `content_sha256`, view bookmarks, jump to page, and delete bookmarks.
- [ ] **AC-4 (Honest Reading Position Tracking)**: Reading state persists `last_requested_page` and `confirmed_read`. Requested page is not marked confirmed read.
- [ ] **AC-5 (Split Coordinate Translation & Deleted Root Safety)**: Accurately translates child page to root handbook page; if root is deleted, displays snapshot guidance without misrouting coordinates to parent.
- [ ] **AC-6 (Content Drift Protection)**: Replacing a document with different bytes flags existing bookmarks as `unverified`.
- [ ] **AC-7 (Missing File Handling)**: If file is missing from disk, source links are visibly disabled with clear recovery prompt; recovery remains accessible.
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
- **Status**: M4 evaluation and Slice 1 specification corrected (M4-R1–R4).
- **Evidence**: `docs/evidence/m4-document-navigation-eval-2026-10-11/` (10 passed tests, 5 database tests, structural parser demonstration, provisional candidate migration 0015).
- **Next Step**: Senior review of M4 correction package and owner approval of proposed defaults OD-1–OD-10 before beginning Slice 1 implementation.
```

### 9.3 For `docs/PROJECT_HANDOFF.md`
```markdown
### 2026-10-11: Milestone 4 Document Navigation & Viewer Evaluation Corrections
- Completed M4-R1–R4 correction package in isolated worktree `Flight-training-m4-viewer-evaluation`.
- Base commit: `c28ab8482c8635b0b2bf74686b081e02bf448f65`.
- Verified WebKit compatibility boundary: React-PDF 11 default build requires Safari 18+; Monterey received max Safari 17.6; macOS 12 WebKit runtime compatibility is explicitly unverified without physical device testing.
- Formulated M4 Slice 1: Interactive source badges, bookmarks with durable originating hash ownership, last-requested tracking, opener controller, and native HUD fallback without adding risky frontend dependencies.
- Provisional candidate migration 0015 defined and verified in genuine SQLite databases; left unregistered and unapplied.
```
