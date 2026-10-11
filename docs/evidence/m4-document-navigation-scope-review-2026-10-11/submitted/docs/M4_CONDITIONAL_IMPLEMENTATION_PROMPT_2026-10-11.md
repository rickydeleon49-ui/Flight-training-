# Model-Neutral Implementation Prompt: M4 Document Navigation Slice 1

**Purpose**: Provide a copy-ready, unambiguous prompt for implementing **Milestone 4 Slice 1** (Source Links, Bookmarks, Last-Read Position, and Native Navigation HUD) once senior review and the project owner approve the evaluation report and proposed defaults (OD-1 through OD-10).

---

```markdown
Implement Milestone 4 Slice 1: Document Navigation, Bookmarks, and Last-Read Tracking in Her Flight Deck.

Read before starting:
- docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md (Scope, defaults OD-1–OD-10, and architecture).
- docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql (Candidate DDL).
- docs/evidence/m4-document-navigation-eval-2026-10-11/proof/contractModel.mjs (Domain reference logic).
- docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md (Roles, verification gates, and Git workflow).
- ROADMAP.md §9 (M4 specification).

Your task is implementing Slice 1 only. Do not install any embedded PDF rendering libraries (no react-pdf, no pdfjs-dist, no @embedpdf). Production package.json and Cargo.toml must remain unchanged.

### Requirements:

1. **Storage & Migration**:
   - Register the next sequential migration (candidate 0015) in `src-tauri/migrations/` and `src/data/migrations.ts`.
   - Update `migration-checksums.json` and `src-tauri/src/lib.rs` consistently.
   - The migration adds:
     - `material_reading_state` (material_id PK, last_read_page INT >= 1, last_read_page_label TEXT, updated_at TEXT)
     - `material_bookmarks` (id PK, material_id FK CASCADE, page_index INT >= 1, page_label TEXT, title TEXT, notes TEXT, created_at, updated_at)
     - `material_content_identities` (material_id PK, content_sha256 TEXT, total_pages INT, verified_at TEXT)
   - Ensure foreign key cascading and indices match candidate DDL.

2. **Domain Logic & Repository**:
   - Implement navigation methods in `src/data/repositories/documentRepository.ts`:
     - `saveReadingPosition(materialId: string, page: number, label?: string): Promise<void>`
     - `getReadingPosition(materialId: string): Promise<{ page: number, label?: string } | null>`
     - `addBookmark(bookmark: NewBookmark): Promise<Bookmark>`
     - `listBookmarks(materialId: string): Promise<Bookmark[]>`
     - `deleteBookmark(bookmarkId: string): Promise<void>`
   - Implement split coordinate translation in `src/logic/documentNavigation.ts`:
     - Child-to-root and root-to-child translation using `material_split_lineage`.
     - Validates page bounds ($1 \le P \le \text{childPageCount}$); clamps gracefully with warning for invalid values.
     - Discriminate physical 1-based page indices from printed labels (e.g. "iv", "3-12").

3. **UI Integration**:
   - **Interactive Source Badges**:
     - In `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `CardReviewPanel.tsx`, and `MaterialDetail.tsx`, transform static `Source p. X` badges into accessible interactive buttons (`type="button"`).
     - Clicking triggers `navigateToSource(materialId, sourcePage)`.
   - **Native Navigation HUD**:
     - When `navigateToSource` invokes `openDocument(filePath)`, display a non-blocking toast/banner:
       `"Opened '<Title>' in default viewer. Turn to page X."`
     - If the file is a split part, also display the root handbook page:
       `"Turn to page X in this chapter (page Y in the complete handbook)."`
   - **Bookmarks Drawer / Section**:
     - In `MaterialDetail.tsx`, add a collapsible "Bookmarks" section displaying saved bookmarks for this material.
     - Provide a quick form to bookmark the current or custom page with a short note.
   - **Last-Read Indication**:
     - In `StudyLibrary` material cards, show a subtle reading marker (e.g. "Page 24 read") if reading state exists.
   - **Missing File State**:
     - If `documentExists` is false or file is missing, source badges are visibly disabled with tooltip explaining the file must be restored.

4. **Testing & Verification**:
   - Add unit tests for `documentNavigation.ts` covering coordinate translation, clamping, and label parsing.
   - Add repository tests for bookmarks and reading state persistence, upgrade from populated schema, and cascade deletion.
   - Add component tests for interactive source badges and bookmark creation.
   - Run the complete local verification matrix:
     - `npm test`
     - `npm run typecheck`
     - `npm run build`
     - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
     - `git diff --check`

Leave all changes uncommitted and unpushed in the agreed branch for Codex senior review.
```
