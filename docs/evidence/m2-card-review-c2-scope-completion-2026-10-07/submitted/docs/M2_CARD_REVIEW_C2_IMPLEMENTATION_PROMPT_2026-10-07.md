# M2-4 / Card Reviews C2 — Conditional Implementation Prompt (7 October 2026)

> [!IMPORTANT]
> **CONDITIONAL ASSIGNMENT — DO NOT IMPLEMENT BEFORE APPROVAL.**
> Production execution of this prompt requires:
> 1. Independent scope acceptance of the corrected [`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`](M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md) and its verification evidence.
> 2. Recorded owner approval of proposed defaults **C2-D1 through C2-D9**.
> Any owner-selected model can execute this prompt once activated; Codex remains independent reviewer and Git coordinator. The real-user check-in waiver persists.

---

## 1. Outcome

In the Study Library (`/study`), the student pilot can:
1. View a unified library-wide **"Review due"** tab that surfaces which study materials have actionable flashcards (due Again cards, Day cards due before local midnight, and new unrated cards) through bounded candidate discovery with deterministic continuation.
2. See review status badges on material cards in the main **"Library"** binder (e.g., `2 due`, `8 new`, `Caught up`).
3. Click any material in "Review due" to launch a focused offline C1 review session for that material.
4. Inspect a library-wide **"History"** hub (`/study?tab=history`, compatible with `/study/history`) with keyset-paginated ratings, timestamps, and authentic version provenance (`Earlier version` badge derived from current raw cards, never stale `is_active` flags).
5. Maintain strict separation between spaced-repetition flashcard ratings and practice test attempt scores, with explicit disclaimers on both views.

It operates entirely offline with zero provider/network requests, requires **zero database schema migrations** (Schema 12 is preserved), and respects the C1 invariant: *"Reads never write."*

---

## 2. Start Conditions

1. Work in `/Users/rickymac/code/Flight-training-pr70-integration`.
2. Confirm current `main` contains the accepted C2 scope corrections and recorded owner approval note.
3. Create `codex/m2-card-review-c2` from clean `main`.
4. Confirm `CURRENT_SCHEMA_VERSION = 12` in `src-tauri/src/lib.rs`. Do not add Migration 0013.
5. One active implementation branch only.

---

## 3. Implementation Contract

### A. Domain Types (`src/domain/types.ts`)
Extend domain types with typed query inputs, material review summaries, and recent review entries:
```typescript
export interface LibraryReviewDueInput {
  nowUtc: string; // ISO 8601 UTC instant
  nextLocalMidnightUtc: string; // ISO 8601 UTC instant of next local calendar midnight
  topic?: Topic | "";
  statusFilter?: "all" | "due_today" | "new_only"; // default: "all"
  limit?: number; // default: 50
  cursor?: string | null; // opaque candidate continuation cursor
  candidateBatchBudget?: number; // default: 250
}

export interface LibraryReviewMaterialEntry {
  materialId: string;
  title: string;
  topic: Topic;
  reviewStatus: ReviewStatus;
  priority: string;
  updatedAt: string;
  cardCount: number;
  againCount: number;
  dayCount: number;
  newCount: number;
  totalDueCount: number;
  earliestDueAt: string | null;
  hasActiveVersion: boolean;
  activeVersionId: string | null;
}

export interface LibraryReviewDueSummary {
  totalMaterialsWithDue: number;
  totalMaterialsWithNew: number;
  totalDueCards: number;
  totalNewCards: number;
  scannedCandidates: number;
  isComplete: boolean; // true if candidate stream was completely exhausted
}

export interface LibraryReviewDueResult {
  summary: LibraryReviewDueSummary;
  materials: LibraryReviewMaterialEntry[];
  nextCursor: string | null;
}

export interface LibraryRecentReviewsInput {
  cursor?: { reviewedAt: string; id: string } | null;
  limit?: number; // default: 20
  topic?: Topic | "";
  materialId?: string | null;
}

export interface LibraryRecentReviewEntry {
  id: string;
  itemId: string;
  rating: CardRating;
  reviewedAt: string;
  schedulerVersion: string;
  generation: number;
  front: string;
  sourcePage: number | null;
  materialId: string;
  materialTitle: string;
  materialTopic: Topic;
  versionId: string;
  isEarlierVersion: boolean; // computed by comparing event versionId to derived current raw card version
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: { reviewedAt: string; id: string } | null;
}
```

### B. Repository Methods (`src/data/repositories/cardReviewRepository.ts`)
Add library-wide read methods implementing **Bounded Candidate Discovery with Keyset Continuation**:

1. `getLibraryReviewDue(input: LibraryReviewDueInput): Promise<LibraryReviewDueResult>`:
   - Evaluates candidates in deterministic keyset order: `(priority ASC, updated_at DESC, id ASC)`.
   - Bounded by `candidateBatchBudget` (default 250) per request.
   - For each candidate, parses raw saved cards from `ai_study_sets.flashcards_json` and derives current version via `deriveCardVersion(materialId, cards)`.
   - Looks up `card_versions` by derived `versionId` directly, without filtering on `is_active = 1`.
   - If snapshot exists: queries `card_review_state` strictly scoped by `i.version_id = derived.versionId`.
     - `againCount`: items with `step < 0 AND due_at <= nowUtc AND suspended = 0 AND flag IS NULL`.
     - `dayCount`: items with `step >= 0 AND due_at < nextLocalMidnightUtc AND suspended = 0 AND flag IS NULL`.
     - `touchedCount`: items with `due_at IS NOT NULL OR suspended = 1 OR flag IS NOT NULL`.
     - `newCount`: `Math.max(0, cards.length - touchedCount)`.
   - If snapshot does not exist: all cards are new (`totalDueCount = 0`, `newCount = cards.length`).
   - Stops scanning candidates immediately when `materials.length >= limit`.
   - Returns consumable `nextCursor` pointing to the candidate evaluation progress point if more candidates remain in the database.
   - Summarizes scanned candidates, returned counts, and sets `isComplete: nextCursor === null`.

2. `getLibraryRecentReviews(input: LibraryRecentReviewsInput): Promise<LibraryRecentReviewsResult>`:
   - Queries `card_review_events` joined with `card_items`, `card_versions`, and `study_materials`.
   - Keyset cursor pagination: `ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?`.
   - Batch-loads current raw saved cards for all distinct materials appearing on the page.
   - Computes `isEarlierVersion = (row.version_id !== currentDerivedVersionId)`.
   - Correctly marks unmaterialized B replacements as earlier A events, and inactive A reversions as current A events.

### C. Deferred-Read Controller Pattern (`src/pages/StudyLibrary/`)
Implement the `DeferredReadController` pattern to govern asynchronous library queries:
- **Generation Barriers:** Changing filter (`topic`, `statusFilter`) bumps query generation; in-flight results from older generations are discarded on resolution.
- **Held Continuations:** Retains valid cursor across non-invalidating UI actions; clears cursor on reset, material deletion, or filter change.
- **Retry Semantics:** "Check again" retries the held read cursor without replaying any write mutations.
- **Reset Invalidation:** When a material's review state is reset, generation increments, cached entries for that material are dropped, and authoritative re-read is forced.

### D. UI Implementation (`src/pages/StudyLibrary/`)
1. **`StudyLibrary.tsx`**:
   - Add top-level tab switcher: `[ Library ]` `[ Review due (count) ]` `[ History ]`.
   - URL synchronization via query parameter `tab` (`/study`, `/study?tab=due`, `/study?tab=history`).
   - Synchronize `/study/history` route as an alias to `/study?tab=history`.
   - Material cards in Library binder display review badges (e.g. `2 due`, `8 new`, `Caught up`).
2. **`LibraryReviewDuePanel.tsx` (New Component)**:
   - Displays summary banner: Total materials with due work, total due cards, total new cards.
   - Filter chips: `All actionable`, `Due today only`, `New cards only` (mixed materials with both due and new cards are excluded from `new_only`), and Topic filter.
   - Ranked material queue cards showing title, topic badge, priority badge, counts of Again/Day/New cards.
   - Direct button to launch review: navigates to `/study/:materialId?review=start` (initiating C1 review session).
   - Empty state when 0 due/new cards with friendly "All caught up!" card when `isComplete = true`.
   - Progressive continuation prompt if scan budget reached without finding actionable items.
   - Loading shimmer with request epoch guards (C1 request ownership).
   - Non-blocking error banner with sanitized message and manual "Check again" retry button.
3. **`PracticeHistory.tsx`**:
   - Integrate sub-tabs: `Flashcard Reviews` vs `Practice Tests`.
   - `Flashcard Reviews` renders keyset-paginated table of ratings, intervals, front text, source page, material title link, and `Earlier version` badge.
   - Displays clear disclaimer: *"Flashcard review ratings reflect spaced-repetition memory scheduling on local study materials, not test scores or FAA exam readiness."*
   - Preserves all existing practice attempt review views and routes verbatim.
4. **`studyLibrary.css`**:
   - Minimal styles matching existing design system tokens for tabs, queue cards, and badges.

---

## 4. Required Verification & Test Suite

1. **Contract Tests (`src/data/cardReviewContract.test.ts`)**:
   - Port all 15 corrected assertions from `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/proof/proof.test.mjs` to Vitest.
   - Verify on both `node:sqlite` (test environment) and `sql.js` (browser fallback).
   - Verify:
     - Unmaterialized B discovery with all cards new.
     - Retired version A due exclusion upon raw B replacement.
     - Zero-write schedule recovery upon raw A reversion (`A -> B -> A`).
     - Touch isolation: retired A state cannot reduce current B new-card count.
     - Again card at exact instant, Day card before next local midnight, 25-hour DST boundary.
     - Keyset pagination across tied timestamps produces zero duplicates and zero omissions, matching SQL oracle.
     - Consumable candidate continuation cursor reaches items past 250 ineligible materials.
     - DeferredReadController generation barriers, held continuations, and retry without replay.
     - Deletion cascades real version and item IDs, tombstones operations.
     - Strict separation from practice test attempts.
2. **UI Component Tests (`src/pages/StudyLibrary/LibraryReviewDuePanel.test.tsx`)**:
   - Renders queue with correct counts and ranking.
   - Topic and status filters work as expected (including mixed due/new semantics).
   - Route and request epoch guards prevent race conditions and unmount errors.
   - Clicking "Start review" navigates to the selected material session.
   - "Check again" retries failed reads cleanly.
3. **History View Tests (`src/pages/StudyLibrary/PracticeHistory.test.tsx`)**:
   - Tab switching between Flashcard Reviews and Practice Tests.
   - Keyset cursor "Load more" pagination.
   - Visual separation and disclaimer verification.
4. **Performance & Integration**:
   - Full test suite passes: `npm test`, `npm run typecheck`, `npm run build`, `cargo test`, `cargo clippy`.

---

## 5. Stopping Point

1. All code implemented and tests passing.
2. Generate evidence directory `docs/evidence/m2-card-review-c2-<date>/` with test receipts, checksums, and source hashes.
3. Update `STATUS.md` and `docs/PROJECT_HANDOFF.md` to record completion of C2.
4. Leave all changes uncommitted and unpushed for independent Codex review.
