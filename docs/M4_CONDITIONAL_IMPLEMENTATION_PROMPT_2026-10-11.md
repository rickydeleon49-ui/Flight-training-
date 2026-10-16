# Model-Neutral Implementation Prompt: M4 Document Navigation Slice 1

**Purpose**: Provide a copy-ready, unambiguous prompt for implementing **Milestone 4 Slice 1** (Source Links, Bookmarks, Last-Requested Page Tracking, Split Coordinate Translation, Opener Controller, Durable Commit Fencing, and Native Navigation HUD) once senior review and the project owner approve the evaluation report and proposed defaults (OD-1 through OD-10).

---

```markdown
Implement Milestone 4 Slice 1: Document Navigation, Bookmarks, and Last-Requested Page Tracking in Her Flight Deck.

Read before starting:
- docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md (Scope, defaults OD-1–OD-10, architecture, and acceptance criteria AC-1–AC-9).
- docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/candidate/candidate_migration_0015.sql (Provisional candidate DDL).
- docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/contractModel.mjs (Domain reference logic for safe integer coordinates, complete destination validation, nullable schema13 lineage, label map content binding, and bounded revalidation).
- docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/persistenceProtocol.mjs (Atomic replacement transaction protocol, generation-fenced persistence writer, and bound-checking navigation writers).
- docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/openerController.mjs (Lifecycle state machine, commit-time generation fencing, content scoping, and deliberate save-only recovery).
- docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md (Roles, verification gates, and Git workflow).
- ROADMAP.md §9 (M4 specification).

Your task is implementing Slice 1 only. Do not install any embedded PDF rendering libraries (no react-pdf, no pdfjs-dist, no @embedpdf). Production package.json and Cargo.toml must remain unchanged.

### Requirements:

1. **Storage & Migration**:
   - Note on migration numbering: Candidate 0015 is provisional. On accepted origin/main, M3 migration 0014 (`0014_skills_evidence.sql`) is already shipped (schema version 14). Candidate 0015 applies on top of shipped 0014 as the next sequential provisional migration; it remains unapplied and unregistered in this evaluation.
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
   - Backup Compliance: All three tables participate in standard SQLite backup/restore (`backup.rs`); no rebuildable search caches may be placed in authoritative backup scope. Older binaries running schema 0014 must refuse or safely handle databases with candidate version 0015 applied.

2. **Domain Logic & Repository Protocol**:
   - Implement navigation methods in `src/data/repositories/documentRepository.ts`:
     - **Atomic Replacement Protocol**:
       `replaceContentIdentity(materialId: string, contentSha256: string, totalPages: number): Promise<{ success: boolean }>`
       Executes in one atomic SQLite transaction (`BEGIN IMMEDIATE TRANSACTION ... COMMIT`):
       1. Inserts/updates `material_content_identities`.
       2. Sets `status = 'unverified'` for bookmarks with mismatched hashes or out-of-bounds indices (`page_index > totalPages`).
       3. Sets `status = 'unverified'` for reading positions with mismatched hashes or out-of-bounds pages (`last_requested_page > totalPages`).
     - **Navigation Writers Bound Enforcement**:
       - `addBookmark(bookmark: NewBookmark)`: consults persisted `material_content_identities`; if identity is missing, hash mismatches, or `pageIndex > totalPages`, persists visibly as `'unverified'` even if requested as `'verified'`.
       - `saveReadingState(materialId: string, lastRequestedPage: number, options: ReadingOptions)`: consults persisted identity; if out-of-bounds or hash mismatches, persists as `'unverified'`.
     - `getReadingState(materialId: string): Promise<ReadingState | null>`
     - `markReadingConfirmed(materialId: string, confirmed: boolean): Promise<void>`
     - `listBookmarks(materialId: string): Promise<Bookmark[]>`
     - `deleteBookmark(bookmarkId: string): Promise<void>`
     - `reconcileBookmarksOnContentDrift(materialId: string, currentContentSha256: string, options?: { totalPages?: number }): Promise<{ drifted: boolean, updatedCount: number }>`
   - Implement navigation logic in `src/logic/documentNavigation.ts`:
     - `validatePageIndex(page: number, totalPages?: number): { valid: boolean, error?: string }`:
       Validates both `page` and `totalPages` are finite safe integers $\ge 1$ via `Number.isSafeInteger`. Rejects NaN, Infinity, fractions, negative values, and zero.
     - `parsePageReference(input: unknown, options?: { provenance?: string, labelToPhysicalMap?: Record<string, number>, totalPages?: number }): ResolvedReference`:
       - Missing or malformed counts (`undefined`, `null`, `NaN`, `Infinity`, fractions, strings) strictly refuse resolution (`isResolved: false`).
       - Numeric inputs WITHOUT explicit coordinate provenance remain UNRESOLVED (`isResolved: false`, `physicalIndex: null`).
       - Explicit physical requests require `provenance: 'physical_index'` and trusted safe integer `totalPages >= 1`.
       - Printed labels remain unresolved unless matched in verified, bounded `labelToPhysicalMap` ($1 \le M \le \text{totalPages}$) that matches the current document `contentSha256`.
     - `translateSplitCoordinates(request: SplitTranslateRequest, lineage: SplitLineage): SplitTranslateResult`:
       - Mandates trusted safe-integer destination count (`destinationTotalPages >= 1`) for both translation directions.
       - Direction-specific validation:
         - `child_to_root`: supports legitimate first-level schema13 rows where `parentMaterialId`, `parentPageStart`, `parentPageEnd` are null (`nested_level: 1`). Requires complete root ranges (`sourcePageStart`, `sourcePageEnd`), live root ID, and safe integer arithmetic.
         - `child_to_parent`: requires live parent ID, complete parent ranges, and safe integer arithmetic.
         - `root_to_child`: requires live destination child material ID; returns `child_physical` destination.
       - Missing or deleted ancestor documents return structured snapshot guidance (`ROOT_DELETED`, `PARENT_DELETED`) without inventing coordinates.
     - `reconcileBookmarksOnContentDrift(bookmarks, currentContentSha256, options?: { totalPages?: number })`:
       Marks bookmarks with mismatched hash as `'unverified'`.
       Matching hash WITHOUT trusted safe integer `totalPages` cannot verify. Out-of-bounds bookmarks remain `'unverified'`.

3. **Opener Controller & Durable Save Fencing**:
   - Implement Opener Controller in `src/logic/openerController.ts`:
     - Lifecycle states: `idle` -> `opening` -> `opened` / `failed` / `aborted` / `opened_unsaved`.
     - **Pre-Validation Intent Advancement**: Allocates new `intentId = ++this.intentCounter` at the very start of `requestOpen` before input validation. Clears stale notices immediately.
     - **Content & Material Scoped Progress**: Scopes requested progress by material ID AND content SHA-256 (`${materialId}:${contentSha256}`). Replacing document bytes prevents inheriting prior page progress. Public `lastRequestedPage` getter returns null after a subsequent open fails.
     - **Destination Pre-Validation**: Validates physical destinations against `material.totalPages` before invoking opener. Rejects out-of-bounds destinations without launching native opener.
     - **Durable Commit Fencing**: Enforces commit ownership inside the durable persistence layer. The injected persistence writer validates operation generation ownership (`UPDATE material_reading_state SET ... WHERE material_id = ? AND owner_generation <= ?` or equivalent serialized commit contract) so obsolete or superseded writes are rejected at commit time. The controller consumes the commit verdict and does not perform secondary compensating rewrites. Surviving rows carry the complete immutable tuple (`page`, `originating_content_sha256`, `page_label`) of the winning operation.
     - **Honest Partial-Save Recovery**:
       - If opening succeeds but persistence fails, sets `state: 'opened_unsaved'` with descriptive warning (`"opened but position not saved"`).
       - Provides deliberate `retrySave()` method carrying the same immutable ownership; does NOT re-invoke native opener.
     - **Reading Semantics**:
       - Opening a document updates `last_requested_page` ONLY upon successful opener resolution.
       - A requested page is NOT reported as confirmed read (`confirmed_read` remains 0 until explicitly marked).
       - Confirmed page reading does NOT imply whole-document completion.
     - **Distinct Reachable Recovery**: If file is missing from disk, source badges show unavailable styling, but a distinct "Restore / Locate File" action remains fully enabled and reachable.
   - **Interactive Source Badges**:
     - In `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `CardReviewPanel.tsx`, and `MaterialDetail.tsx`, transform static `Source p. X` badges into interactive accessible buttons (`type="button"`, `aria-label="Navigate to source page X"`, keyboard focusable).
   - **Bookmarks Section**:
     - In `MaterialDetail.tsx`, add a collapsible "Bookmarks" section displaying saved bookmarks for this material.
     - Display bookmark title, page index, page label, and status. If status is `unverified`, display an amber badge: `"Document updated — verify page"`.
   - **Last-Requested Marker**:
     - In `StudyLibrary` material cards, show a subtle marker: `"Last opened: Page X"` (or `"Confirmed read: Page X"` if `confirmed_read` is 1).

4. **Testing & Verification**:
   - Unit tests for `documentNavigation.ts`: safe integer validation, provenance resolution, clamping, split coordinate translation, deleted root safety, nullable first-level parent ranges.
   - Unit tests for `openerController.ts`: success lifecycle, failed opening, supersession on newer invalid request, cross-material and content scoping, destination pre-validation, durable commit fencing, partial-save retry, explicit abort.
   - Database lifecycle tests in file-backed SQLite: pre-existing schema 1–14 row retention and M3 skills-evidence preservation, check constraint validation (rejects malformed SHA-256), bookmark hash ownership, atomic replacement transaction and rollback on fault, close/reopen, backup/restore with drift detection, older-binary refusal probe (schema 14 refusing candidate 15).
   - Full verification matrix:
     - `npm test`
     - `npm run typecheck`
     - `npm run build`
     - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
     - `git diff --check`

Leave all changes uncommitted and unpushed in the agreed branch for senior review.
```
