# M2-4 / Card Reviews C2 — Conditional Implementation Prompt (7 October 2026)

> [!IMPORTANT]
> **CONDITIONAL ASSIGNMENT — DO NOT IMPLEMENT BEFORE APPROVAL.**
> Production execution of this prompt requires:
> 1. Independent scope acceptance of the completed [`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`](M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md) and its verification evidence.
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
2. Confirm current `main` contains the accepted C2 scope proposal and recorded owner approval note.
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
  topic?: string | null;
  statusFilter?: "all" | "due_today" | "new_only"; // default: "all"
  limit?: number; // default: 50, hard-capped at 250
  cursor?: string | null; // opaque candidate continuation cursor
  candidateBatchBudget?: number; // default: 250, hard-capped at 250
}

export interface LibraryReviewMaterialEntry {
  materialId: string;
  title: string;
  topic: string;
  priority: string;
  updatedAt: string;
  cardCount: number;
  againCount: number;
  dayCount: number;
  newCount: number;
  totalDueCount: number;
  retainedCardCount: number;
  earliestDueAt: string | null;
}

export interface LibraryReviewDueSummary {
  scannedCandidates: number;
  actionableCount: number;
  againCount: number;
  dayCount: number;
  totalDueCount: number;
  newCount: number;
  isComplete: boolean; // true if candidate stream was completely exhausted
  isPageLocal: boolean; // always true for page-scoped summaries
}

export interface LibraryReviewDueResult {
  summary: LibraryReviewDueSummary;
  materials: LibraryReviewMaterialEntry[];
  nextCursor: string | null;
}

export interface LibraryRecentReviewsInput {
  cursor?: string | null; // opaque base64 keyset cursor { t, id }
  limit?: number; // default: 20, hard-capped at 100
  topic?: string | null;
  materialId?: string | null;
}

export interface LibraryRecentReviewEntry {
  id: string;
  itemId: string;
  materialId: string;
  materialTitle: string;
  versionId: string;
  contentHash: string;
  ordinal: number;
  front: string;
  back: string;
  sourcePage: number | null;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
  schedulerVersion: string;
  step: number | null;
  dueAt: string | null;
  isEarlierVersion: boolean;
  contentStatus: "current" | "earlier" | "unavailable" | "malformed";
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: string | null;
}
```

### B. Pure Logic Parity
Directly reuse pure logic modules without re-implementing or duplicating logic:
- `src/logic/cardIdentity.ts`: `parseSavedCards`, `canonicalJson`, `cardVersion`, `deriveCurrentCards`, limits (`MAX_CARDS = 500`, `MAX_FRONT_CHARS = 1000`, `MAX_BACK_CHARS = 2000`, `MAX_SOURCE_PAGE = 1000`).
- `src/logic/cardScheduler.ts`: `scheduleCard`, ladder intervals (`LADDER_DAYS = [1, 3, 7, 16, 35, 75, 150, 180]`), `SCHEDULER_VERSION = 'simple-v1'`.
- `src/logic/localDay.ts`: `nextLocalMidnightUtc`, `localDate`.

### C. Database Reads with Real SQL Batching (`src-tauri/src/card_reviews.rs` & driver)
Implement real SQL batching across candidate boundaries:

1. **`get_library_review_due` Pipeline (3 SQL Calls):**
   - **Call 1 (Candidate Scan):** Keyset scan on `study_materials` joined with `ai_study_sets` where `flashcards_json IS NOT NULL AND flashcards_json != '[]'`, ordered by `(priority = 'next_up' ASC, updated_at DESC, id ASC)` with `LIMIT candidateBatchBudget + 1`.
   - **Call 2 (Batched Raw Flashcards):** Fetch raw cards for candidate IDs in batch: `SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (...)`.
   - **Call 3 (Batched Review State):** Fetch all review state rows for current derived version IDs: `SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag FROM card_items i JOIN card_review_state s ON s.item_id = i.id WHERE i.version_id IN (...)`.
   - **In-Memory Urgency Ranking:** Sort actionable materials by Bucket 0 (Again due) -> Bucket 1 (Day due) -> Bucket 2 (New only) -> Tie-breakers (`next_up` priority, earliest due instant, title, ID).
   - **Continuation Cursor:** Carry undisplayed items from the evaluated batch in `cursor.rem` so subsequent pages advance without re-scanning or losing items.
2. **`get_library_recent_reviews` Pipeline (2 SQL Calls):**
   - **Call 1 (Event Keyset Query):** Keyset query on `card_review_events` joined with items, versions, and study materials, ordered by `(e.reviewed_at DESC, e.id DESC)` with `LIMIT limit + 1`.
   - **Call 2 (Batched Distinct Materials):** Read `ai_study_sets.flashcards_json` for distinct material IDs on this page: `SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (...)`.
   - Compare derived current version ID against event version ID to assign `isEarlierVersion` and `contentStatus`.

### D. UI State Controller (`src/pages/StudyLibrary/useDeferredReviewRead.ts`)
Implement `DeferredReadController` pattern:
- **Synchronous Busy Lock (`busyPromise`):** Exclude duplicate calls on same turn; prevent repeat loads on terminal page.
- **Generation Tracking:** Tag each request with `reqGen = ++generation`. Settle and publish only if `currentGen === reqGen`.
- **Synchronous Filter Invalidation:** `setFilter()` immediately clears `results = []`, resets pagination, and bumps generation.
- **Authoritative Reads Following Mutation:** Material reset or deletion removes rows, resets cursor, and initiates fresh authoritative read.
- **Retry Semantics:** `retryRead()` retains failed cursor without replaying writes.

### E. Component & Route Integration
1. **Tabs in `StudyLibrary.tsx`:** Synchronize URL search params (`tab=library`, `tab=due`, `tab=history`). Support `/study/history` route redirect.
2. **Review Due View (`StudyLibraryReviewDue.tsx`):**
   - Render urgency-ranked list of actionable study materials.
   - Display page-local counts and candidate scan progress indicator.
   - Provide "Load more" button disabled while loading.
   - Include topic filter chips and status filter dropdown (`All actionable`, `Due today`, `New only`).
3. **Recent Reviews View (`StudyLibraryHistory.tsx`):**
   - Keyset pagination with "Load more".
   - Badges for ratings (`Again`, `Hard`, `Good`, `Easy`) and version provenance (`Earlier version`).
   - Disclaimers explicitly separating card reviews from practice test scores.

---

## 4. Verification & Acceptance Criteria

1. **Both Diagnostics Must Pass:**
   - Prior diagnostic (`scratch/diagnostic.test.mjs`): 9/9 pass.
   - New diagnostic (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): 12/12 pass.
2. **SQL Query Count Verification:** Due discovery consumes <= 4 SQL calls; history consumes <= 2 SQL calls.
3. **Vitest Test Suite:** Unit and component tests covering version-owned discovery, within-batch ranking, held promises, filter clearing, and error retry.
4. **Offline & Invariant Integrity:** Zero provider/network calls; Schema 12 preserved; reads remain read-only.
