# Model-Neutral Implementation Prompt: M4 Document Navigation Slice 1

**Purpose**: Provide a copy-ready, unambiguous prompt for implementing **Milestone 4 Slice 1** (Source Links, Bookmarks, Last-Requested Page Tracking, Split Coordinate Translation, Opener Controller, and Native Navigation HUD) once senior review and the project owner approve the evaluation report and proposed defaults (OD-1 through OD-10).

---

```markdown
Implement Milestone 4 Slice 1: Document Navigation, Bookmarks, and Last-Requested Page Tracking in Her Flight Deck.

Read before starting:
- docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md (Scope, defaults OD-1–OD-10, architecture, and acceptance criteria AC-1–AC-9).
- docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/candidate/candidate_migration_0015.sql (Provisional candidate DDL).
- docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/contractModel.mjs (Domain reference logic for safe integer coordinates, explicit provenance, and bounded revalidation).
- docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/openerController.mjs (Lifecycle state machine for opener, supersession, material scoping, and persistence).
- docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md (Roles, verification gates, and Git workflow).
- ROADMAP.md §9 (M4 specification).

Your task is implementing Slice 1 only. Do not install any embedded PDF rendering libraries (no react-pdf, no pdfjs-dist, no @embedpdf). Production package.json and Cargo.toml must remain unchanged.

### Requirements:

1. **Storage & Migration**:
   - Note on migration numbering: Candidate 0015 is provisional. Allocate the actual sequential migration number based on the accepted `origin/main` baseline at implementation time (after reconciling with M3 candidate 0014).
   - Register the migration in `src-tauri/migrations/`, `src/data/migrations.ts`, `migration-checksums.json`, and `src-tauri/src/lib.rs`.
   - The migration adds:
     - `material_reading_state`:
       - `material_id` TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE
       - `last_requested_page` INTEGER NOT NULL CHECK (TYPEOF(last_requested_page) = 'integer' AND last_requested_page >= 1)
       - `last_requested_page_label` TEXT CHECK (last_requested_page_label IS NULL OR LENGTH(last_requested_page_label) <= 100)
       - `confirmed_read` INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_read IN (0, 1))
       - `originating_content_sha256` TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*')
       - `status` TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unverified', 'drifted'))
       - `updated_at` TEXT NOT NULL
     - `material_bookmarks`:
       - `id` TEXT PRIMARY KEY NOT NULL
       - `material_id` TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE
       - `page_index` INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1)
       - `page_label` TEXT CHECK (page_label IS NULL OR LENGTH(page_label) <= 100)
       - `originating_content_sha256` TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*')
       - `title` TEXT NOT NULL CHECK (LENGTH(title) <= 500)
       - `notes` TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 20000)
       - `status` TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'unverified', 'drifted'))
       - `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL
       - Indices: `idx_material_bookmarks_material`, `idx_material_bookmarks_page`, `idx_material_bookmarks_hash`
     - `material_content_identities`:
       - `material_id` TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE
       - `content_sha256` TEXT NOT NULL CHECK (LENGTH(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-fA-F]*')
       - `total_pages` INTEGER NOT NULL CHECK (TYPEOF(total_pages) = 'integer' AND total_pages >= 1)
       - `verified_at` TEXT NOT NULL
       - Index: `idx_material_content_sha`
   - Backup Compliance: All three tables participate in standard SQLite backup/restore (`backup.rs`); no rebuildable search caches may be placed in authoritative backup scope. Older binaries running schema 0013 must continue executing standard queries on `study_materials` without error.

2. **Domain Logic & Repository**:
   - Implement navigation methods in `src/data/repositories/documentRepository.ts`:
     - `saveReadingPosition(materialId: string, lastRequestedPage: number, options?: { label?: string, originatingContentSha256: string, confirmedRead?: boolean }): Promise<void>`
     - `getReadingState(materialId: string): Promise<ReadingState | null>`
     - `markReadingConfirmed(materialId: string, confirmed: boolean): Promise<void>`
     - `addBookmark(bookmark: NewBookmark): Promise<Bookmark>`
     - `listBookmarks(materialId: string): Promise<Bookmark[]>`
     - `deleteBookmark(bookmarkId: string): Promise<void>`
     - `reconcileBookmarksOnContentDrift(materialId: string, currentContentSha256: string, options?: { totalPages?: number }): Promise<{ drifted: boolean, updatedCount: number }>`
     - `getContentIdentity(materialId: string): Promise<ContentIdentity | null>`
     - `saveContentIdentity(materialId: string, contentSha256: string, totalPages: number): Promise<void>`
   - Implement navigation logic in `src/logic/documentNavigation.ts`:
     - `validatePageIndex(page: number, totalPages?: number): { valid: boolean, error?: string }`:
       Validates both `page` and optional `totalPages` are finite safe integers $\ge 1$ via `Number.isSafeInteger`. Rejects NaN, Infinity, fractions, negative values, and zero.
     - `parsePageReference(input: unknown, options?: { provenance?: string, labelToPhysicalMap?: Record<string, number>, totalPages?: number }): ResolvedReference`:
       - Numeric inputs WITHOUT explicit coordinate provenance (e.g. legacy Gemini `sourcePage`) remain UNRESOLVED (`isResolved: false`, `physicalIndex: null`).
       - Explicit physical requests require `provenance: 'physical_index'` and must be safe integers $\ge 1$ within document bounds.
       - Printed labels remain unresolved unless matched in verified `labelToPhysicalMap` with bounds check ($1 \le M \le \text{totalPages}$).
       - Does NOT invent physical page 1 for unmapped printed labels.
     - `clampPageIndex(page: number, totalPages: number): ClampedResult`:
       Applies ONLY to explicitly physical references with known bounds. Clamps to $[1, \text{totalPages}]$ with a descriptive notice.
     - `translateSplitCoordinates(request: SplitTranslateRequest, lineage: SplitLineage): SplitTranslateResult`:
       - Validates range lengths: `parentPageEnd - parentPageStart + 1 === childPageCount` and `sourcePageEnd - sourcePageStart + 1 === childPageCount`. Rejects string coordinates and length mismatches.
       - For `child_to_root`: translates to root page ($P_{\text{root}} = \text{sourcePageStart} + P_{\text{child}} - 1$). Validates $P_{\text{root}} \le \text{sourceTotalPages}$. Returns `sourceMaterialId: rootMaterialId`, `destinationSpace: 'root_physical'`.
       - For `child_to_parent`: translates to immediate parent page ($P_{\text{parent}} = \text{parentPageStart} + P_{\text{child}} - 1$). Returns `sourceMaterialId: parentMaterialId`, `destinationSpace: 'parent_physical'`.
       - For `root_to_child`: translates to child page ($P_{\text{child}} = P_{\text{root}} - \text{sourcePageStart} + 1$). Returns `sourceMaterialId: materialId`, `destinationSpace: 'child_physical'`.
       - **Deleted Root/Parent Safety**: If root or parent is missing/deleted, returns `success: false`, `sourceMaterialId: null`, code `ROOT_DELETED` or `PARENT_DELETED` with snapshot guidance. Never substitutes parent ID with root coordinates.
     - `reconcileBookmarksOnContentDrift(bookmarks, currentContentSha256, options?: { totalPages?: number })`:
       Marks bookmarks with mismatched hash as `'unverified'` while preserving their original `originating_content_sha256`.
       **Bounded Revalidation**: Even if hash matches, if `totalPages` is known and `pageIndex > totalPages`, the bookmark MUST remain `'unverified'`.

3. **Opener Controller & UI Integration**:
   - Implement Opener Controller in `src/logic/openerController.ts`:
     - Lifecycle states: `idle` -> `opening` -> `opened` / `failed` / `aborted`.
     - **Pre-Validation Intent Advancement**: Allocates new `intentId = ++this.intentCounter` at the very start of `requestOpen` before input validation. Clears stale notices immediately on all paths.
     - **In-Flight Supersession**: Newer requests (including failed/missing-path requests) advance intent ID, causing older pending opener promises to abort silently upon resolution without publishing stale notices.
     - **Material-Scoped Progress**: Scopes requested progress by material ID. Failing material B never exposes material A's page 42.
     - **Destination Pre-Validation**: Validates physical destinations (`Number.isSafeInteger(page) && page >= 1`) before invoking opener. Rejects NaN/zero destinations without calling opener.
     - **Injected Durable Persistence**: Accepts `injectedPersistence` callback. Invokes it upon opener resolution. If save fails, reports partial notice (`"opened but position not saved: <error>"`) without replaying opener or asserting saved position.
     - **Honest Reading Semantics**:
       - Opening a document updates `last_requested_page` ONLY upon successful opener resolution.
       - A requested page is NOT reported as confirmed read (`confirmed_read` remains 0 until explicitly marked).
       - Confirmed page reading does NOT imply whole-document completion.
     - **Distinct Reachable Recovery**: If file is missing from disk, source badges show unavailable styling, but a distinct "Restore / Locate File" action remains fully enabled and reachable.
   - **Interactive Source Badges**:
     - In `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `CardReviewPanel.tsx`, and `MaterialDetail.tsx`, transform static `Source p. X` badges into interactive accessible buttons (`type="button"`, `aria-label="Navigate to source page X"`, keyboard focusable).
     - Clicking invokes opener controller with provenance resolution.
   - **Bookmarks Section**:
     - In `MaterialDetail.tsx`, add a collapsible "Bookmarks" section displaying saved bookmarks for this material.
     - Display bookmark title, page index, page label, and status. If status is `unverified`, display an amber badge: `"Document updated — verify page"`.
   - **Last-Requested Marker**:
     - In `StudyLibrary` material cards, show a subtle marker: `"Last opened: Page X"` (or `"Confirmed read: Page X"` if `confirmed_read` is 1).

4. **Testing & Verification**:
   - Unit tests for `documentNavigation.ts`: safe integer validation, provenance resolution, clamping, split coordinate translation, deleted root safety, nested parent coordinates.
   - Unit tests for `openerController.ts`: success lifecycle, failed opening, supersession on newer invalid request, cross-material scoping, destination pre-validation, injected persistence, save failure handling, explicit abort.
   - Database lifecycle tests in file-backed SQLite: pre-existing schema-13 row retention, check constraint validation (rejects malformed SHA-256), bookmark hash ownership, bounded revalidation (rejects page 42 in 10-page doc), cascade deletion, transaction rollback, backup/restore.
   - Full verification matrix:
     - `npm test`
     - `npm run typecheck`
     - `npm run build`
     - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
     - `git diff --check`

Leave all changes uncommitted and unpushed in the agreed branch for Codex senior review.
```
