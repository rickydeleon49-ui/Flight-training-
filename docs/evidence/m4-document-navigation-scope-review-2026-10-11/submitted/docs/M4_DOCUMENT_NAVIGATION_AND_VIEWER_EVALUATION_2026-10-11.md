# Her Flight Deck: M4 Document Navigation and Open-Source PDF Viewer Evaluation

**Date**: October 11, 2026  
**Status**: Comprehensive Technical Evaluation & Scope Proposal (Prepared for Senior / Owner Review)  
**Author**: Independent Technical Evaluation  
**Starting Baseline Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)  
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)  
**Production Code Impact**: Zero production edits; zero lockfile modifications; candidate schema unapplied and unregistered.

---

## 1. Executive Summary & Roadmap Alignment

Milestone 4 ("Document navigation and local retrieval") is scheduled to deliver:
1. **Step 1**: Source links, bookmarks, last-read page position, and material/page destination navigation with robust page-range validation and split-document coordinate translation. Unsupported native page jumps fall back visibly to launching the document while displaying the target page.
2. **Step 2**: Evaluation and potential integration of a maintained embedded PDF viewer with lazy rendering, bounded memory, keyboard navigation, zoom, and text search, while retaining native OS Open/Reveal.

This package provides:
- A thorough audit of existing material/document storage, split-lineage page ranges, source references, native opening/reveal, missing-file recovery, and backup contracts.
- A well-bounded first implementation slice for Step 1 that delivers immediate user value with zero new production dependencies.
- A rigorous evaluation of three PDF viewing strategies:
  1. Retaining native OS Open (`@tauri-apps/plugin-opener`) with enhanced in-app navigation linkage.
  2. Mozilla PDF.js / React-PDF (`pdfjs-dist` / `react-pdf`).
  3. EmbedPDF / PDFium WebAssembly (`@embedpdf/pdfium` + `@embedpdf/engines`).
- A disposable automated proof suite (`docs/evidence/m4-document-navigation-eval-2026-10-11/`) demonstrating core mathematical coordinate translation, page label discrimination, content drift detection, and WebKit compatibility boundaries.
- Numbered proposed owner defaults (OD-1 through OD-10), explicit exclusions, and a copy-ready conditional implementation prompt.

---

## 2. Current Behavior and Gap Analysis

### 2.1 Document Storage & Material Identity

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Storage Root** | Private app data subdirectory `documents/` (never repo). Subdirectory `.trash/` handles recoverable staged deletions. | [documents.rs:20-85](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L20-L85) `documents_root`, `stored_document_path` | None in filesystem isolation; files remain strictly app-private. |
| **Path Safety** | Refuses absolute paths, `..` traversals, backslashes, colons, NULs, and trailing dots/spaces. | [documents.rs:92-119](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L92-L119) `safe_relative_path`, `is_hidden_or_ambiguous` | Stored relative path is verified on every native read/delete call. |
| **Identity in DB** | `study_materials.id` (UUID or imported string) is primary key. `file_path` stores relative path. | [0001_initial_schema.sql:96-112](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/migrations/0001_initial_schema.sql#L96-L112) | **Gap**: `study_materials` lacks a `content_sha256` column or `total_pages` column for non-split materials. Content drift upon file replacement cannot be verified without recomputing SHA on demand. |
| **Fingerprinting** | Native command computes SHA-256 for up to 20 stored files on demand. | [lineage.rs:927-949](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/lineage.rs#L927-L949) `fingerprint_stored_documents_at` | Available via IPC (`invokeFingerprintStoredDocuments`), but not persisted on material record. |

### 2.2 Split-Parent Page Ranges & Lineage

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Split Provenance** | Shipped schema 13 records `source_page_start`, `source_page_end`, `parent_page_start`, `parent_page_end`, `child_page_count`, `source_content_sha256`, `nested_level`. | [0013_split_source_lineage.sql:29-58](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/migrations/0013_split_source_lineage.sql#L29-L58) `material_split_lineage` | Lineage is fully recorded and validated by database triggers/constraints. |
| **Page Counts** | Read via `lopdf::Document::load` on demand. Limits splits to 1,000 pages and 50 MiB. | [pdf.rs:41-80](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/pdf.rs#L41-L80) `inspect_pdf`, `page_count` | `total_pages` is not cached for non-split materials; must re-parse PDF file on demand. |
| **Range Translation** | Lineage maps child pages to root handbook pages: $P_{\text{root}} = \text{source\_page\_start} + P_{\text{child}} - 1$. | [lineage.rs:43-77](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/lineage.rs#L43-L77) `SplitPlanPart`, `SplitParentSnapshot` | **Gap**: Frontend components do not expose or execute this translation. If a flashcard has `sourcePage: 12`, the UI displays "Source p. 12" without indicating whether it means page 12 of the chapter or page 12 of the handbook. |

### 2.3 Source References in Study Features

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Data Types** | `sourcePage: number \| null` on `StudyFlashcard`, `PracticeQuestion`, `PracticeTestItem`, and `CardReviewSnapshotItem`. | [types.ts:374,405,446,684](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/domain/types.ts#L374) | Typed consistently across all AI and practice entities. |
| **AI Generation** | Gemini prompt instructs model to return `sourcePage` as integer or null. | [gemini.rs:479,516,627,658](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/gemini.rs#L479-L658) `generate_study_aid_inner` | Gemini emits whatever number it extracts from text, which is often a printed page number (e.g. 15 or 3-12) rather than physical index. |
| **Study Packets** | Imported packets parse `sourcePage` as null during canonical import. | [payload.ts:80,95](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/logic/studyPacket/payload.ts#L80-L95) `canonicalAiStudySet` | Validated safely against schema. |
| **UI Presentation** | Displayed as static `<Badge tone="study">{item.sourcePage ? \`Source p. ${item.sourcePage}\` : "Check source"}</Badge>`. | [PracticeTestPanel.tsx:1253](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/PracticeTestPanel.tsx#L1253), [MaterialDetail.tsx:794](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/MaterialDetail.tsx#L794), [CardReviewPanel.tsx:380](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/CardReviewPanel.tsx#L380) | **Critical Gap**: Badges are completely static and non-clickable. They do not trigger an open action, page jump, or copy action. |

### 2.4 Native Opening, Reveal, and IPC Capabilities

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Open Native** | Resolves absolute path via `document_path`, then calls `openPath(absolute)` via `@tauri-apps/plugin-opener`. | [documents.ts:90-94](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/services/documents.ts#L90-L94) `openDocument` | **Native OS Limit**: macOS Preview.app and Windows default handler do not accept CLI page arguments via `openPath`. Opens at page 1 or last window state. |
| **Reveal in Finder** | Calls `revealItemInDir(absolute)` via `@tauri-apps/plugin-opener`. | [documents.ts:97-101](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/services/documents.ts#L97-L101) `revealDocument` | Works as expected on macOS and Windows. |
| **Tauri Capabilities** | Grants `opener:allow-open-path` and `opener:allow-reveal-item-in-dir` for `$APPCONFIG/documents/**`. | [default.json:13-20](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/capabilities/default.json#L13-L20) `capabilities/default.json` | **Critical Security Limit**: No `fs:allow-read-file` permission is granted to frontend. Webview cannot load `file:///` URLs or directly read document bytes without native IPC commands. |

### 2.5 Missing-File Recovery & Backup Invariants

| Dimension | Current Implementation | Files & Functions | Gaps / Limitations |
| --- | --- | --- | --- |
| **Missing Check** | `documentExists(rel)` checks physical file; `check_library` reports missing documents vs database. | [documents.rs:491,1081](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/documents.rs#L491) `document_exists`, `check_library` | Accurately identifies deleted/missing files without database corruption. |
| **File Restore** | `restoreDocumentCopy` prompts user to pick replacement, copies to app storage, updates `study_materials`. | [documentRecovery.ts:16-56](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/logic/documentRecovery.ts#L16-L56), [MaterialDetail.tsx:359](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src/pages/StudyLibrary/MaterialDetail.tsx#L359) | **Gap**: Does not verify whether replacement file has identical pages or content hash. Bookmarks may point past end of new file. |
| **Backup Scope** | Scans `study_materials.file_path` (`query_referenced_documents`) to pack database and `documents/` into zip archive. | [backup.rs:2931-2990](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/src-tauri/src/backup.rs#L2931-L2990) `query_referenced_documents` | **Invariant**: Any new table holding navigation metadata must use standard foreign keys (`study_materials(id) ON DELETE CASCADE`). Rebuildable text caches must be excluded from backup. |

---

## 3. Proposal for First Implementation Slice (M4 Slice 1)

### 3.1 Scope & Purpose

The first implementation slice delivers robust document navigation without adopting risky, unverified webview rendering libraries or raising the supported macOS minimum:

1. **Interactive Source / Page Links**:
   - Turn static `<Badge tone="study">Source p. X</Badge>` elements in `PracticeTestPanel`, `CardReviewPanel`, and `MaterialDetail` into interactive controls with hover affordances, keyboard accessibility (`Enter`/`Space`), and descriptive aria-labels.
   - Clicking triggers the navigation workflow: if a native viewer is used, opens the file externally and displays a persistent, non-blocking HUD toast informing the pilot of the exact target page:  
     `"Opened '<Material Title>' in system viewer. Navigate to page 42 (printed '3-12')."`
2. **Bookmarks & Notes**:
   - Allow pilots to add, view, and delete page bookmarks for any study material.
   - Each bookmark records `pageIndex` (1-based physical integer), optional `pageLabel` (e.g. "3-12"), a user `title`, and optional `notes`.
3. **Last-Read Position Tracking**:
   - Persist the last-read physical page index and label per material whenever a pilot marks progress or navigates to a source page.
   - Display "Resume at page X" on material cards in Study Library.
4. **Physical Page Index vs Printed Page Label Discrimination**:
   - The contract model strictly differentiates 1-based physical PDF page indexes ($1 \le P \le N$) from human-readable printed page labels (e.g. "iv", "3-12", "Cover").
   - When Gemini or user notes provide a printed string like "3-12", the application stores `pageLabel: "3-12"` alongside physical index `pageIndex: 45`.
5. **Split-Document Coordinate Translation**:
   - For split materials with lineage (`material_split_lineage`):
     - Translates child part page index $P_{\text{child}}$ to root handbook page index $P_{\text{root}} = \text{source\_page\_start} + P_{\text{child}} - 1$.
     - When navigating a reference originating from a root handbook, if the requested page is within the child part's range, jumps directly to $P_{\text{child}} = P_{\text{root}} - \text{source\_page\_start} + 1$.
     - If outside the range, provides clear guidance: `"Page 215 is outside this chapter (pages 101–150). Open the original handbook?"`
6. **Replaced Content & Hash Drift Handling**:
   - Computes SHA-256 upon initial import and restoration.
   - When a replacement file has a different content hash, flags bookmarks with a warning: `"Document modified since bookmarks were created. Check page references."`
7. **Missing-File Handling**:
   - If `documentExists` is false, source links are visibly disabled with tooltip: `"Document missing from storage. Restore file to open."`

### 3.2 Candidate Migration Schema (Unregistered)

The proposed schema is fully additive, safe against foreign key cascades, and compatible with authoritative backup format v2. It is provided in [`docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql`](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql):

```sql
-- 1. Reading state: tracks the last physical page and optional label viewed by the pilot.
CREATE TABLE IF NOT EXISTS material_reading_state (
  material_id          TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  last_read_page       INTEGER NOT NULL CHECK (TYPEOF(last_read_page) = 'integer' AND last_read_page >= 1),
  last_read_page_label TEXT,
  updated_at           TEXT NOT NULL
);

-- 2. Bookmarks: user-created navigation points within a study document.
CREATE TABLE IF NOT EXISTS material_bookmarks (
  id           TEXT PRIMARY KEY NOT NULL,
  material_id  TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  page_index   INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1),
  page_label   TEXT,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_material
  ON material_bookmarks(material_id);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_page
  ON material_bookmarks(material_id, page_index);

-- 3. Document content identity: caches verified SHA-256 and total page counts.
CREATE TABLE IF NOT EXISTS material_content_identities (
  material_id    TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL,
  total_pages    INTEGER CHECK (total_pages IS NULL OR (TYPEOF(total_pages) = 'integer' AND total_pages >= 1)),
  verified_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_content_sha
  ON material_content_identities(content_sha256);
```

*Note: Per repository workflow, this migration is NOT registered in `src-tauri/src/lib.rs` or `src/data/migrations.ts` until senior review and owner approval.*

---

## 4. Open-Source PDF Viewer Evaluation

We evaluated three serious technical options for Her Flight Deck's PDF viewing capability against upstream documentation, exact versions, licenses, offline asset requirements, WebKit/macOS 12 constraints, and memory behavior:

### 4.1 Option A: Retaining Native Open (Enhanced with In-App Navigation HUD)

- **Upstream Component**: System default viewer (Preview.app on macOS, Edge/Acrobat on Windows) launched via Tauri's `@tauri-apps/plugin-opener` (v2.5.0) and Rust `tauri-plugin-opener` (v2).
- **Licenses**: MIT OR Apache-2.0.
- **Dependencies**: Zero added dependencies. Production lockfiles unchanged.
- **Offline & Assets**: 100% offline; uses OS-installed binaries. 0 KB bundle increase.
- **Tauri File Access**: Uses existing capability `opener:allow-open-path` on `$APPCONFIG/documents/**`.
- **WebKit / macOS Minimum**: **100% compatible with macOS 12 Monterey and all newer releases**. Zero WKWebView canvas or memory overhead.
- **Rendering & Memory**: Bounded strictly to native OS processes. Even a 1,000-page, 400 MB FAA handbook opens smoothly in macOS Preview without consuming webview RAM or causing WKWebView WebContent terminations.
- **Limitations**: Cannot programmatically scroll external Preview.app to a specific page on launch (macOS `open` command does not support page parameters). Context switch out of the app window.

### 4.2 Option B: Mozilla PDF.js / React-PDF (`pdfjs-dist` & `react-pdf`)

- **Upstream Components**:
  - `pdfjs-dist`: v6.4.299 (latest) / v6.3.289 (pinned in `react-pdf@11.0.0`). License: Apache-2.0. Unpacked size: ~34.8 MB.
  - `react-pdf`: v11.0.0 (default branch). License: MIT. Unpacked size: 336 KB.
- **Transitive Dependency Licenses**: `clsx` (MIT), `dequal` (MIT), `es-toolkit` (MIT), `tiny-invariant` (MIT), `make-cancellable-promise` (MIT). Clean permissive licenses.
- **Offline & Bundling Requirements**:
  - Web Worker (`pdf.worker.mjs`, ~1.5 MB) must be bundled locally into `dist/assets/` using Vite `?url` import. Cannot rely on CDN (`cdnjs` or `unpkg`).
  - Standard fonts / CMap assets (`cmaps/`) must be bundled locally (~4 MB) for non-Latin and special typography.
- **WebKit / macOS 12 Monterey Hard Blockers**:
  - Official React-PDF 11 documentation explicitly states: **"Supports Safari 18 (iOS 18) or newer."**
  - Modern `pdfjs-dist` (v4.x, v5.x, v6.x) actively relies on ES2024 features including `Promise.withResolvers`, `Object.groupBy`, and top-level await.
  - **macOS 12 Monterey is frozen at Safari 17.6**. Its built-in WKWebView engine (WebKit ~16.0) does **NOT** support these language features and throws fatal runtime syntax errors upon loading modern `pdfjs-dist`.
  - Adopting standard `react-pdf@11` would silently break macOS 12 Monterey support, requiring macOS 14 Sonoma as the new minimum.
- **Memory & Cancellation Constraints**:
  - Rendering large handbooks requires strict virtualization (e.g. rendering only active page $\pm 1$).
  - Every `<canvas>` render creates a `RenderTask`. Navigating away must call `renderTask.cancel()` and `page.cleanup()`; otherwise, WKWebView canvas memory spikes rapidly to hundreds of megabytes, triggering `WebContent process terminated (WKErrorWebContentProcessDidTerminate)` crashes.
- **Tauri File Access**:
  - Webview cannot access `file:///` paths. Requires a custom Tauri IPC command (`read_document_bytes` or asset protocol) to transfer binary `Uint8Array` to the worker.

### 4.3 Option C: EmbedPDF / PDFium WebAssembly (`@embedpdf/pdfium` & `@embedpdf/engines`)

- **Upstream Components**:
  - `@embedpdf/pdfium`: v2.15.1. License: MIT SDK wrapper; core PDFium engine under Apache-2.0. Unpacked size: 7.55 MB.
  - `@embedpdf/engines`: v2.15.1. License: MIT.
  - `@embedpdf/models`: v2.15.1. License: MIT.
  - *Note*: Server components in the upstream repository (`cloudpdf/server`) use Fair Core License (FCL-1.0-ALv2); only client SDK packages are permissive.
- **Offline & Bundling Requirements**:
  - `pdfium.wasm` (uncompressed binary: ~7.2 MB) must be bundled locally in `public/` and loaded offline via `WebAssembly.instantiate`.
- **WebKit / macOS 12 Monterey Risks**:
  - Emscripten builds of PDFium frequently enable WebAssembly SIMD (`-msimd128`) for vector rendering performance.
  - **WASM SIMD was only introduced to Apple WebKit in Safari 16.4 (macOS 13 Ventura)**. On macOS 12 Monterey (Safari 15/16.0 WKWebView), WASM SIMD binaries throw `CompileError: WebAssembly.instantiate(): Compiling function failed: opcode not supported`.
  - Multithreaded WASM requires `SharedArrayBuffer` and HTTP response headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (COOP/COEP), which standard desktop Tauri webview local protocols do not serve by default.
- **Memory & Lifecycle**:
  - C++ PDFium allocations within the WASM linear memory heap do not participate in JavaScript garbage collection.
  - Every opened document and rendered page must explicitly invoke native destructors (`closeDocument`, `destroyPage`); a missing teardown hook leaks linear memory indefinitely during study sessions.

---

## 5. Comparison Table & Capability Matrix

| Evaluation Criterion | Option A: Native Open + In-App Navigation | Option B: PDF.js / React-PDF (Modern) | Option C: EmbedPDF / PDFium WASM |
| --- | --- | --- | --- |
| **Exact Version** | Pinned `@tauri-apps/plugin-opener` 2.5.0 | `react-pdf` 11.0.0 / `pdfjs-dist` 6.3.289 | `@embedpdf/pdfium` 2.15.1 |
| **Licenses** | MIT OR Apache-2.0 | MIT (`react-pdf`) + Apache-2.0 (`pdfjs-dist`) | MIT SDK + Apache-2.0 (PDFium engine) |
| **macOS 12 Monterey Support** | **100% Compatible** (No webview engine constraint) | **INCOMPATIBLE** (Requires Safari 18 / Sonoma) | **HIGH RISK** (Fails if compiled with WASM SIMD) |
| **Offline Study Operation** | 100% Offline (Uses system viewer) | Offline if worker & CMaps bundled locally | Offline if `pdfium.wasm` bundled locally |
| **Production Bundle Size Delta** | **0 KB** | +4.5 MB (compressed) / ~35 MB unpacked | +3.2 MB (compressed) / ~8 MB unpacked |
| **Webview Memory Overhead** | **0 MB** (Handled by external OS process) | High (Canvas bitmaps; 150–400 MB on long manuals) | Moderate-High (WASM linear heap 128–256 MB) |
| **Crash Risk on Oversized PDFs** | Zero (OS handles virtual memory) | High (WKWebView WebContent termination) | Moderate (WASM heap out-of-memory) |
| **Page-Level Jump Support** | External viewer (HUD shows target page) | Native in-app canvas scroll | Native in-app canvas scroll |
| **Text Search** | External viewer search (Cmd+F) | In-app text layer search | In-app PDFium text search |
| **First Slice Viability** | **Recommended for Slice 1** | Defer to Step 2 after legacy build audit | Defer to Step 2 after physical Mac check |

---

## 6. Numbered Proposed Owner Defaults

The following defaults are proposed for owner review and decision:

- **OD-1: Deliver M4 in two deliberate stages.**  
  Implement Step 1 (document navigation, bookmarks, last-read tracking, and coordinate translation) immediately, while evaluating Step 2 (embedded canvas viewer) conditionally.
- **OD-2: Retain native Open/Reveal as authoritative baseline.**  
  Never replace or deprecate native OS opening via `@tauri-apps/plugin-opener`. The system viewer (Preview/Acrobat) remains the 100% reliable reader for complex, illustrated FAA handbooks.
- **OD-3: Preserve macOS 12 Monterey minimum support.**  
  Do not raise the minimum supported macOS version to macOS 14 Sonoma merely to adopt `react-pdf@11`. Any embedded viewer must be proven compatible with WebKit ~16.0 or remain behind an opt-in flag.
- **OD-4: Enforce 1-based physical page indexing in database.**  
  All persisted page indices (`page_index`, `last_read_page`) must be strictly integers $\ge 1$ matching the physical PDF leaf order.
- **OD-5: Maintain separate printed page labels.**  
  Store printed labels (e.g. "iv", "3-12", "Cover") in optional text fields (`page_label`), preventing string labels from corrupting numeric jump logic.
- **OD-6: Graceful clamping for invalid page jumps.**  
  If a source reference or bookmark points to a page $< 1$, clamp to 1 with a warning; if $> \text{totalPages}$, clamp to $\text{totalPages}$ with a warning. Never crash or present an unhandled rejection.
- **OD-7: Automatic split-lineage coordinate mapping.**  
  When viewing split parts, translate child pages to root handbook pages using `material_split_lineage.source_page_start`. Visibly warn if a root page reference falls outside a child part's range.
- **OD-8: Content drift detection upon document replacement.**  
  Store verified SHA-256 content hashes. If a missing or updated document is restored with different bytes, alert the pilot that bookmarks may have shifted.
- **OD-9: Non-blocking HUD toast for native page navigation.**  
  Because external viewers cannot accept CLI page flags on macOS, opening a document to a specific page must visibly display a persistent HUD toast: `"Opened '<Title>' in system viewer. Turn to page X."`
- **OD-10: Strict isolation of authoritative backup state.**  
  All bookmarks and reading progress participate in standard backup/restore. No rebuildable text search caches or derived indexes may be placed in authoritative backup scope.

---

## 7. Explicit Exclusions

To keep M4 Slice 1 bounded, safe, and focused on core user value, the following capabilities are **explicitly excluded** from the initial slice:

1. **In-PDF Annotations & Highlights Drawing**:  
   Persisting freehand ink, highlight coordinates, or bounding boxes onto PDF streams requires complex geometry storage and is deferred until after basic navigation is stabilized.
2. **Optical Character Recognition (OCR)**:  
   Scanned PDFs without text streams remain viewable, but OCR extraction is deferred until measured search failures justify adding a heavy local OCR sidecar.
3. **Vector Embeddings & Semantic Search**:  
   No vector databases, embedding models, or Python sidecars. Local retrieval in M4 will use deterministic keyword / SQLite FTS indexing only.
4. **Cloud PDF / AI Indexing Services**:  
   No third-party cloud viewer APIs, CloudPDF server backends, or automatic document uploads. Her Flight Deck remains strictly local-first.
5. **PDF Modification / Page Deletion in Reader**:  
   The reader is read-only. PDF structural modification remains the sole domain of the existing Rust splitter (`lopdf`).

---

## 8. Acceptance Criteria for M4 Slice 1

Before M4 Slice 1 can be merged into `main`, the implementation must satisfy:

- [ ] **AC-1 (Interactive Source Badges)**: All `<Badge tone="study">` elements referencing a page in `PracticeTestPanel`, `CardReviewPanel`, and `MaterialDetail` become interactive buttons with proper keyboard focus and `aria-label`.
- [ ] **AC-2 (Navigation HUD Action)**: Clicking an active source badge opens the material via `openDocument` and displays a user-facing notice displaying the target physical page and printed label.
- [ ] **AC-3 (Bookmark Management)**: The pilot can add a bookmark with a title and notes, view a list of bookmarks for that material, jump to a bookmarked page, and delete bookmarks.
- [ ] **AC-4 (Last-Read Tracking)**: Reading state persists the last navigated page per material and displays it in the Study Library card.
- [ ] **AC-5 (Split Coordinate Translation)**: When viewing a split part, clicking a source badge accurately computes both chapter page and root handbook page; out-of-range pages display an explanatory notice.
- [ ] **AC-6 (Content Drift Protection)**: Replacing a document with different bytes flags existing bookmarks as "unverified / modified".
- [ ] **AC-7 (Missing File Handling)**: If a file is missing from disk, source links are disabled with a clear recovery prompt; clicking does not error out.
- [ ] **AC-8 (Zero Production Dependency Changes)**: Production `package.json` and `Cargo.toml` remain unchanged.
- [ ] **AC-9 (Clean Verification Matrix)**: All standard repository gates pass (`npm test`, `npm run typecheck`, `npm run build`, `cargo test`, `git diff --check`).

---

## 9. Proposed Tracking Entries (Not Yet Applied)

To preserve Claude's active work in other worktrees, the following entries are proposed for future integration into shared tracking files once authorized:

### 9.1 For `ROADMAP.md` (under Section 9: M4)
```markdown
- **M4 Step 1 (Scope Defined)**: Interactive source links, bookmarks, reading state, split coordinate translation, and native navigation HUD designed. Evaluated open-source viewers (Native Open vs PDF.js vs EmbedPDF); WebKit macOS 12 constraint documented.
```

### 9.2 For `STATUS.md`
```markdown
### Milestone 4 — Document Navigation (October 11, 2026)
- **Status**: M4 evaluation and Slice 1 specification complete.
- **Evidence**: `docs/evidence/m4-document-navigation-eval-2026-10-11/` (7 passed tests, fixtures, candidate migration 0015).
- **Next Step**: Senior review of M4 evaluation report and owner approval of proposed defaults OD-1–OD-10 before beginning Slice 1 implementation.
```

### 9.3 For `docs/PROJECT_HANDOFF.md`
```markdown
### 2026-10-11: Milestone 4 Document Navigation & Viewer Evaluation
- Completed independent technical evaluation of M4 in isolated worktree `Flight-training-m4-viewer-evaluation`.
- Base commit: `c28ab8482c8635b0b2bf74686b081e02bf448f65`.
- Verified WebKit compatibility risk: React-PDF 11 default build requires Safari 18+ (macOS 14 Sonoma), which conflicts with macOS 12 Monterey target.
- Formulated M4 Slice 1: Interactive source badges, bookmarks, last-read tracking, and native HUD fallback without adding risky frontend dependencies.
- Candidate migration 0015 defined and tested; left unregistered and unapplied.
```
