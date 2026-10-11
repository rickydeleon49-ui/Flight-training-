# Model-Neutral Implementation Prompt: M4 Document Navigation Slice 1

**Purpose**: Provide a copy-ready, unambiguous prompt for implementing **Milestone 4 Slice 1** (Source Links, Bookmarks, Last-Requested Page Tracking, Split Coordinate Translation, Opener Controller, and Native Navigation HUD) once senior review and the project owner approve the evaluation report and proposed defaults (OD-1 through OD-10).

---

```markdown
Implement Milestone 4 Slice 1: Document Navigation, Bookmarks, and Last-Requested Page Tracking in Her Flight Deck.

Read before starting:
- docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md (Scope, defaults OD-1–OD-10, architecture, and acceptance criteria AC-1–AC-9).
- docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql (Candidate DDL).
- docs/evidence/m4-document-navigation-eval-2026-10-11/proof/contractModel.mjs (Domain reference logic for coordinate translation, provenance, and drift).
- docs/evidence/m4-document-navigation-eval-2026-10-11/proof/openerController.mjs (Lifecycle state machine for opener and honest reading semantics).
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
   - Backup Compliance: All three tables participate in standard SQLite backup/restore (`backup.rs`); no rebuildable search caches may be placed in authoritative backup scope.

2. **Domain Logic & Repository**:
   - Implement navigation methods in `src/data/repositories/documentRepository.ts`:
     - `saveReadingPosition(materialId: string, lastRequestedPage: number, options?: { label?: string, originatingContentSha256: string, confirmedRead?: boolean }): Promise<void>`
     - `getReadingState(materialId: string): Promise<ReadingState | null>`
     - `markReadingConfirmed(materialId: string, confirmed: boolean): Promise<void>`
     - `addBookmark(bookmark: NewBookmark): Promise<Bookmark>`
     - `listBookmarks(materialId: string): Promise<Bookmark[]>`
     - `deleteBookmark(bookmarkId: string): Promise<void>`
     - `reconcileBookmarksOnContentDrift(materialId: string, currentContentSha256: string): Promise<{ drifted: boolean, updatedCount: number }>`
     - `getContentIdentity(materialId: string): Promise<ContentIdentity | null>`
     - `saveContentIdentity(materialId: string, contentSha256: string, totalPages: number): Promise<void>`
   - Implement navigation logic in `src/logic/documentNavigation.ts`:
     - `validatePageIndex(page: number, totalPages?: number): { valid: boolean, error?: string }`:
       Validates both `page` and optional `totalPages` are finite safe integers $\ge 1$. Rejects NaN, Infinity, and fractions.
     - `parsePageReference(input: unknown, options?: { labelToPhysicalMap?: Record<string, number> }): ResolvedReference`:
       Distinguishes physical 1-based leaf numbers from printed labels (e.g. "iv", "3-12"). Does NOT invent physical page 1 for unmapped printed labels. Does NOT treat numeric strings without coordinate provenance as pure physical indices.
     - `clampPageIndex(page: number, totalPages: number): ClampedResult`:
       Applies ONLY to explicitly physical references with known bounds. Clamps to $[1, \text{totalPages}]$ and returns `{ clampedPage, isClamped, notice }`.
     - `translateSplitCoordinates(request: SplitTranslateRequest, lineage: SplitLineage): SplitTranslateResult`:
       Validates lineage integrity. For `child_to_root`: translates child page to root page ($P_{\text{root}} = \text{sourcePageStart} + P_{\text{child}} - 1$).
       **Deleted root safety**: If root document was deleted (`rootMaterialId: null`), returns `{ success: false, sourceMaterialId: null, code: "ROOT_DELETED" }`. Never substitutes parent ID with root coordinates.
       For nested splits: returns destination space (`"parent_physical"`) with parent coordinates.
     - `detectContentDrift(currentBytes: Uint8Array, originatingSha256: string)`:
       Computes SHA-256 and detects drift. When drifted, marks status as `'unverified'`/`'drifted'`, preserving the originating hash.

3. **Opener Controller & UI Integration**:
   - Implement Opener Controller in `src/logic/openerController.ts`:
     - Lifecycle states: `idle` -> `opening` -> `opened` / `failed` / `aborted`.
     - Uses injected opener function wrapping `@tauri-apps/plugin-opener` (`openDocument`).
     - **Honest Reading Semantics**:
       - Opening a document updates `last_requested_page` ONLY upon successful opener resolution.
       - A requested page is NOT reported as confirmed read (`confirmed_read` remains 0 until explicitly marked by the user).
       - On success: displays HUD toast: `"Opened '<Title>' in default viewer. Turn to page X."` (or split format: `"Turn to page X in this chapter (page Y in the complete handbook)."`).
     - **Failure & Abort Safety**:
       - If opening fails (file missing, OS handler error): transitions to `failed`, displays error toast: `"Could not open document: <error>"`. Does NOT announce success; does NOT advance reading progress.
       - If user navigates away or material changes while open is pending: aborts pending operation; ignores late callbacks.
     - **Missing File Handling**:
       - If file is missing from disk, source badges are visibly styled as disabled.
       - Clicking displays a recovery prompt or guidance; missing-file recovery via `restoreDocumentCopy` remains fully accessible.
   - **Interactive Source Badges**:
     - In `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `CardReviewPanel.tsx`, and `MaterialDetail.tsx`, transform static `Source p. X` badges into interactive accessible buttons (`type="button"`, `aria-label="Navigate to source page X"`, keyboard focusable).
     - Clicking invokes opener controller with provenance resolution.
   - **Bookmarks Drawer / Section**:
     - In `MaterialDetail.tsx`, add a collapsible "Bookmarks" section displaying saved bookmarks for this material.
     - Display bookmark title, page index, page label, and status. If status is `unverified`, display an amber badge: `"Document updated — verify page"`.
     - Provide form to add a bookmark for current or specified page with optional notes.
   - **Last-Requested Marker**:
     - In `StudyLibrary` material cards, show a subtle marker: `"Last opened: Page X"` (or `"Completed"` if `confirmed_read` is 1).

4. **Testing & Verification**:
   - Unit tests for `documentNavigation.ts`: safe integer validation, provenance resolution, clamping, split coordinate translation, deleted root safety, nested parent coordinates.
   - Unit tests for `openerController.ts`: success lifecycle, failed opening (no false success), abort on route change, honest reading progress.
   - Unit tests for repository in SQLite: pre-existing schema-13 row retention, check constraint validation (rejects malformed SHA-256), bookmark hash ownership, drift status update, cascade deletion, transaction rollback.
   - Component tests for interactive source badges and bookmarks UI.
   - Full verification matrix:
     - `npm test`
     - `npm run typecheck`
     - `npm run build`
     - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
     - `git diff --check`

Leave all changes uncommitted and unpushed in the agreed branch for Codex senior review.
```
