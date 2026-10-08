# M2-4 / Card Reviews C2 — Conditional Implementation Prompt (7 October 2026)

> [!IMPORTANT]
> **CONDITIONAL ASSIGNMENT — DO NOT IMPLEMENT BEFORE APPROVAL.**
> Production execution of this prompt requires:
> 1. Independent scope acceptance of [`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`](M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md) and its evidence.
> 2. Recorded owner approval of proposed defaults **C2-D1 through C2-D9**.
> Any owner-selected model can execute this prompt once activated; Codex remains independent reviewer and Git coordinator. The real-user check-in waiver persists.

---

## 1. Outcome

In the Study Library (`/study`), the student pilot can:
1. View a unified library-wide **"Review due"** tab that surfaces which materials have actionable flashcards (due Again cards, Day cards due before local midnight, and new unrated cards).
2. See review status badges on material cards in the main **"Library"** binder (e.g., `2 due`, `8 new`, `Caught up`).
3. Click any material in "Review due" to launch a focused offline C1 review session for that material.
4. Inspect a library-wide **"History"** hub with keyset-paginated ratings, timestamps, and version provenance (`Earlier version` badge for retired snapshots).
5. Maintain strict separation between spaced-repetition flashcard ratings and practice test attempt scores, with explicit disclaimers on both views.

It operates entirely offline with zero provider/network requests, requires **zero database schema migrations** (Schema 12 is preserved), and respects the C1 invariant: *"Reads never write."*

---

## 2. Start Conditions

1. Work in `/Users/rickymac/code/Flight-training-pr70-integration`.
2. Confirm current `main` contains the accepted C2 scope and recorded owner approval note.
3. Create `codex/m2-card-review-c2` from clean `main`.
4. Confirm `CURRENT_SCHEMA_VERSION = 12` in `src-tauri/src/lib.rs`. Do not add Migration 0013.
5. One active implementation branch only.

---

## 3. Implementation Contract

### A. Domain Types (`src/domain/types.ts`)
Extend domain types with typed query inputs, material review summaries, and recent review entries:
```typescript
export interface LibraryReviewDueInput {
  nowUtc: string;
  nextLocalMidnightUtc: string;
  topic?: Topic | "";
  statusFilter?: "all" | "due_today" | "new_only";
  limit?: number; // default 50, max 250
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

export interface LibraryReviewDueResult {
  summary: {
    totalMaterialsWithDue: number;
    totalMaterialsWithNew: number;
    totalDueCards: number;
    totalNewCards: number;
  };
  materials: LibraryReviewMaterialEntry[];
  nextCursor: string | null;
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
  isEarlierVersion: boolean;
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: { reviewedAt: string; id: string } | null;
}
```

### B. Repository Methods (`src/data/repositories/cardReviewRepository.ts`)
Add library-wide read methods implementing **Bounded On-Demand Discovery**:

1. `getLibraryReviewDue(input: LibraryReviewDueInput): Promise<LibraryReviewDueResult>`:
   - Queries `card_review_state` joined with `card_items`, `card_versions` (`is_active = 1`), and `study_materials` for materials with active due work.
   - For candidates returned by the due query, reads `ai_study_sets.flashcards_json` and verifies `content_hash`. If content changed (A → B unmaterialized), version A's due work is excluded and B's cards are marked new.
   - Discovers materials with unreviewed/new cards up to the bounded limit.
   - Sorts deterministically: Urgent Again materials first, then Day due materials, then New-only materials; tie-breaks by `next_up` priority, earliest due date, title ASC, and material ID ASC.
2. `getLibraryRecentReviews(options)`:
   - Queries `card_review_events` joined with `card_items`, `card_versions`, and `study_materials`.
   - Keyset pagination with cursor `(reviewedAt, id)` ordering `ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?`.
   - Computes `isEarlierVersion = (v.is_active !== 1)`.

### C. UI Implementation (`src/pages/StudyLibrary/`)
1. **`StudyLibrary.tsx`**:
   - Add top-level tab switcher: `[ Library ]` `[ Review due (count) ]` `[ History ]`.
   - URL synchronization via query parameter `tab` (`/study`, `/study?tab=due`, `/study?tab=history`).
   - Material cards in Library binder display review badges (e.g. `2 due`, `8 new`, `Caught up`).
2. **`LibraryReviewDuePanel.tsx` (New Component)**:
   - Displays summary banner: Total materials with due work, total due cards, total new cards.
   - Filter chips: `All actionable`, `Due today only`, `New cards only`, and Topic filter.
   - Ranked material queue cards showing title, topic badge, priority badge, counts of Again/Day/New cards.
   - Direct button to launch review: navigates to `/study/:materialId?review=start` (initiating C1 review session).
   - Empty state when 0 due/new cards.
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

## 4. Required Tests

1. **Contract Tests (`src/data/cardReviewContract.test.ts`)**:
   - Port all 15 test cases from `docs/evidence/m2-card-review-c2-scope-2026-10-07/proof/proof.test.mjs` to Vitest.
   - Test on both `node:sqlite` (tests) and `sql.js` (browser).
   - Verify: unmaterialized B discovery, retired A exclusion, A → B → A schedule reuse, Again exact instant, Day next local midnight, keyset cursor without duplicates/omissions, and separation from practice attempts.
2. **UI Component Tests (`src/pages/StudyLibrary/LibraryReviewDuePanel.test.tsx`)**:
   - Renders queue with correct counts and ranking.
   - Topic and status filters work as expected.
   - Route and request epoch guards prevent race conditions and unmount errors.
   - Clicking "Start review" navigates to the selected material session.
   - "Check again" retries failed reads cleanly.
3. **History View Tests (`src/pages/StudyLibrary/PracticeHistory.test.tsx`)**:
   - Tab switching between Flashcard Reviews and Practice Tests.
   - Keyset cursor "Load more" pagination.
   - Visual separation and disclaimer verification.
4. **Performance & Integration**:
   - Query latency verification: Review due query completes in < 35 ms on 5,000 synthetic materials.
   - Full test suite passes: `npm test`, `npm run typecheck`, `npm run build`, `cargo test`, `cargo clippy`.

---

## 5. Stopping Point

1. All code implemented and tests passing.
2. Generate evidence directory `docs/evidence/m2-card-review-c2-<date>/` with test receipts, checksums, and source hashes.
3. Update `STATUS.md` and `docs/PROJECT_HANDOFF.md` to record completion of C2.
4. Leave all changes uncommitted and unpushed for independent Codex review.
