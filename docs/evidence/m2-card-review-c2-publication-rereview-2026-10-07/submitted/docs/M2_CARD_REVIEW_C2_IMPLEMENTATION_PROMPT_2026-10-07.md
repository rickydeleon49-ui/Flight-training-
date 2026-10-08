# M2-4 / Card Reviews C2 — Conditional Implementation Prompt (7 October 2026)

> [!IMPORTANT]
> **CONDITIONAL ASSIGNMENT — DO NOT IMPLEMENT BEFORE APPROVAL.**
> Production execution of this prompt requires:
> 1. Independent scope acceptance of the completed [`M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`](M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md) and its verification evidence.
> 2. Recorded owner approval of proposed defaults **C2-D1 through C2-D9**.
> Any owner-selected model can execute this prompt once activated; Codex remains independent reviewer and Git coordinator. The real-user check-in waiver persists.

---

## 1. Outcome

In the Study Library (`/study`), the student pilot can:
1. View a unified library-wide **"Review due"** tab that surfaces which study materials have actionable flashcards (due Again cards, Day cards due before local midnight, and new unrated cards) through bounded candidate discovery with deterministic continuation.
2. Filter actionable materials by spaced-repetition status (`All actionable`, `Due today`, `New only`) and topic chips, distinct from material metadata `reviewStatus`.
3. See review status badges on material cards in the main **"Library"** binder (e.g., `2 due`, `8 new`, `Caught up`).
4. Click any material in "Review due" to launch a focused offline C1 review session for that material.
5. Inspect a library-wide **"History"** hub (`/study?tab=history`, compatible with `/study/history`) with keyset-paginated ratings, timestamps, prior/next interval state, filterable by material and topic, and authentic version provenance (`Earlier version` badge derived from current raw cards, never stale `is_active` flags).
6. Inspect historical card contents in a read-only modal/viewer without mutating current material cards or versions.
7. Maintain strict separation between spaced-repetition flashcard ratings and practice test attempt scores, with explicit disclaimers on both views.

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
Extend domain types with typed query inputs, material review summaries, recent review entries, and inspection modal contracts:
```typescript
export interface LibraryReviewDueInput {
  nowUtc: string; // ISO 8601 UTC instant
  nextLocalMidnightUtc: string; // ISO 8601 UTC instant of next local calendar midnight
  topic?: string | null;
  statusFilter?: "all" | "due_today" | "new_only"; // default: "all"
  limit?: number; // default: 50, hard-capped at 250
  cursor?: string | null; // opaque candidate continuation cursor
  candidateBatchBudget?: number; // default: 250, hard-capped at 250
  maxBatchCardsBudget?: number; // default: 2500
  maxBatchRawJsonBytesBudget?: number; // default: 2097152 (2 MiB)
}

export interface LibraryReviewOversizeIssue {
  materialId: string;
  title: string;
  code: "PAYLOAD_TOO_LARGE";
  rawBytes: number;
  allowedBytes: number;
  inspectionTarget: string;
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
  evaluatedCandidates: number;
  attemptedCards: number; // cumulative cards reserved/attempted across raw sets (stays charged on parse failure)
  evaluatedCards: number; // valid cards successfully parsed and evaluated
  rawReads: number; // count of raw SQLite ai_study_sets read operations
  rawBytesTransferred: number;
  actionableCount: number;
  againCount: number;
  dayCount: number;
  totalDueCount: number;
  newCount: number;
  isComplete: boolean; // true if candidate stream was completely exhausted
  isPageLocal: boolean; // always true for page-scoped summaries
  issues: LibraryReviewOversizeIssue[]; // explicit issues for reported oversize sets
}

export interface LibraryReviewDueResult {
  summary: LibraryReviewDueSummary;
  materials: LibraryReviewMaterialEntry[];
  nextCursor: string | null;
}

export interface LibraryRecentReviewsInput {
  cursor?: string | null; // opaque base64 keyset cursor { v: 1, type: "history", t, id, ctx }
  limit?: number; // default: 20, hard-capped at 100
  topic?: string | null;
  materialId?: string | null;
  maxBatchRawJsonBytesBudget?: number; // default: 2097152 (2 MiB)
  enrichMaterialIds?: string[] | null; // optional targeted material enrichment
}

export interface ValidatedCardSchedule {
  schedulerVersion: "simple-v1";
  step: number; // -1 to 7
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number | null;
  lapses: number | null;
  intervalDays: number | null;
  intervalMinutes: number | null;
  intervalLabel: string | null;
}

export interface LibraryRecentReviewEntry {
  id: string; // unique review event ID
  itemId: string;
  materialId: string;
  materialTitle: string;
  topic: string;
  versionId: string;
  contentHash: string;
  ordinal: number;
  front: string;
  back: string;
  sourcePage: number | null;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
  schedulerVersion: string;
  priorStateRaw: string | null;
  nextStateRaw: string | null;
  priorState: Record<string, unknown> | null;
  nextState: Record<string, unknown> | null;
  priorSchedule: ValidatedCardSchedule | null;
  nextSchedule: ValidatedCardSchedule | null;
  step: number | null;
  dueAt: string | null;
  intervalDays: number | null;
  intervalMinutes: number | null;
  intervalLabel: string | null;
  isEarlierVersion: boolean | null; // null if raw set unread under budget cap
  contentStatus: "current" | "earlier" | "valid_empty" | "unavailable" | "malformed" | "pending";
}

export interface HistoryMaterialEnrichmentRecord {
  materialId: string;
  contentStatus: "current" | "earlier" | "valid_empty" | "unavailable" | "malformed" | "pending";
  isEarlierVersion: boolean | null;
  currentVersionId: string | null;
  currentContentHash: string | null;
  reason?: string;
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: string | null;
  pendingMaterialIds: string[];
  enrichment: HistoryMaterialEnrichmentRecord[];
}

export interface ReadOnlyCardInspectionTarget {
  eventId: string;
  materialId: string;
  materialTitle: string;
  topic: string;
  versionId: string;
  ordinal: number;
  front: string;
  back: string;
  sourcePage: number | null;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
  step: number | null;
  dueAt: string | null;
  intervalLabel: string | null;
  contentStatus: "current" | "earlier" | "valid_empty" | "unavailable" | "malformed" | "pending";
  isEarlierVersion: boolean | null;
}
```

### B. Pure Logic Parity
Directly reuse pure logic modules without re-implementing or duplicating logic:
- `src/logic/cardIdentity.ts`: `parseSavedCards`, `canonicalJson`, `cardVersion`, `deriveCurrentCards`, limits (`MAX_CARDS = 500`, `MAX_FRONT_CHARS = 1000`, `MAX_BACK_CHARS = 2000`, `MAX_SOURCE_PAGE = 1000`).
- `src/logic/cardScheduler.ts`: `scheduleCard`, `isIsoInstant`, ladder intervals (`LADDER_DAYS = [1, 3, 7, 16, 35, 75, 150, 180]`), `SCHEDULER_VERSION = 'simple-v1'`.
- `src/logic/localDay.ts`: `nextLocalMidnightUtc`, `localDate`.

### C. Database Reads with Real SQL Batching (`src-tauri/src/card_reviews.rs` & driver)
Implement real SQL batching across candidate boundaries:

1. **`get_library_review_due` Pipeline:**
   - **Candidate Keyset Scan:** Scan `study_materials` joined with `ai_study_sets` where `flashcards_json IS NOT NULL AND flashcards_json != '[]' AND flashcards_json != ''`, ordered by `CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC` with `LIMIT candidateBatchBudget + 1`.
   - **Preflight Byte Check:** Execute `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len FROM ai_study_sets WHERE source_material_id IN (...)`.
     - If `byte_len > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES` (8 MiB), do NOT transfer raw JSON; report in `issues: [{ materialId, title, code: 'PAYLOAD_TOO_LARGE', rawBytes, allowedBytes, inspectionTarget: '/study/' + encodeURIComponent(materialId) }]`. Advance keyset continuation past this reported candidate so later materials remain discoverable. Metadata-only oversize candidates do not consume the single-set admission exception.
     - Enforce conservative card work reservation: reserve 500 cards before every raw fetch/parse attempt (`attemptedCards += 500; rawAttempts++`). If `rawAttempts > 0 && attemptedCards > maxBatchCardsBudget`, break and retain candidate for continuation. If parsing fails, the reservation remains spent. Valid parsed sets reconcile the reservation to their actual card count. Single-set admission lane allows admitting at most one set when `rawAttempts === 0`.
   - **Raw Cards Fetch:** Fetch raw cards only for admitted candidates: `SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?`.
   - **Batched Review State:** Fetch review state rows for derived versions: `SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag FROM card_items i JOIN card_review_state s ON s.item_id = i.id WHERE i.version_id IN (...)`.
   - **Filters:** Apply `statusFilter` (`all`, `due_today`, `new_only`) and topic filter after deriving current card counts and before urgency ranking.
   - **In-Memory Urgency Ranking:** Sort actionable materials by Bucket 0 (Again due) -> Bucket 1 (Day due) -> Bucket 2 (New only) -> Tie-breakers (`next_up` priority, earliest due instant, title, ID).
   - **Strict Cursor Schema & Stream Revalidation:** Continuation cursor validated before SQL: requires `v === 1`, `type === 'due'`, `ctx`, boolean `isExhausted`, unique string IDs in `remIds` array $\le 250$, keyset boundary `lc` ($\le 64$ chars), integer rank `lp` strictly matching `lp === 0 || lp === 1` (rejecting invalid ranks with `INVALID_CURSOR`), and canonical ISO `lu`. Carry leftover undisplayed material IDs (`remIds: [...]`) in the cursor. On continuation, validate ownership (`STALE_CURSOR`), track evaluated vs discarded candidates (`consumedCount`), and re-query live database state for those IDs.
2. **`get_library_recent_reviews` Pipeline:**
   - **Event Keyset Query:** Keyset query on `card_review_events` joined with items, versions, and study materials, filtered by `materialId` and `topic` in SQL before LIMIT, ordered by `e.reviewed_at DESC, e.id DESC` with `LIMIT limit + 1`.
   - **Preflight Byte Check & Bounded Raw Cards:** Preflight byte lengths via `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len FROM ai_study_sets WHERE source_material_id IN (...)`. Apply absolute 8 MiB bound and 2 MiB batch raw JSON budget before reading individual sets. Oversize materials are permanently marked blocked (`contentStatus: "unavailable"`, code `'PAYLOAD_TOO_LARGE'`). Budget-deferred materials remain deferred (`contentStatus: "pending"`, `isEarlierVersion: null`) without wire transfer.
   - **Independent History Enrichment:** Support `enrichMaterialIds` option querying target materials directly under single-call budgets, returning explicit target-only `enrichment` records with `currentVersionId` alongside unchanged paged rows and cursor without disrupting event stream pagination.
   - **Strict Cursor Schema:** Validated before SQL: requires `v === 1`, `type === 'history'`, `ctx`, canonical ISO `t` (`isIsoInstant(t)`), and non-empty string `id` ($\le 64$ chars).
   - **Scheduler Ownership Validation:** Pass event's actual `scheduler_version` into `validateScheduleState(next_state_json, row.scheduler_version)`. Unsupported scheduler versions yield null validated schedule fields. Validate canonical ISO timestamps, non-negative integer reps/lapses, and ladder bounds.

### D. UI State Controller (`src/pages/StudyLibrary/useDeferredReviewRead.ts`)
Implement `DeferredReadController` pattern:
- **Synchronously Owned Operation Lock (`busyPromise` & `currentOp`):** Installed synchronously with a unique operation token (`Symbol('op')`) before calling reader. Synchronous throws and asynchronous promise rejections clear `busyPromise` only if generation and operation match, preventing an obsolete synchronous throw from clearing a newer held operation.
- **Dedup Keys:** Deduplicate by `item.materialId` for review due materials, and by event `item.id` for history events (preserving multiple events from the same material).
- **Generation Tracking:** Tag each request with `reqGen = ++generation`. Settle and publish only if `currentGen === reqGen`.
- **Publication of Issues & Summaries:** Publish typed `issues` and relevant `summary` under exact generation/operation ownership. Retain earlier-page issues across multi-page loading (deduplicating by `materialId + ':' + code`).
- **Caught-Up vs. Blocked Traversal:** `isCaughtUp` is true only when `isComplete && results.length === 0 && issues.length === 0`. If a terminal page has issues, `hasBlockedContent` is true and `isCaughtUp` is false (exposing unavailable content).
- **Authoritative Refresh Invalidation:** Calling `onReset(materialId)` clears `results = []`, `issues = []`, resets the cursor to null, idles loading, and bumps generation. Page 1 replaces the prior generation, adopting fresh urgency ordering and eliminating surviving no-longer-actionable rows.
- **Retry Semantics:** `retryRead()` retains failed cursor without replaying writes.
- **Targeted Enrichment Action (`enrichMaterials(targetIds)`):** Callable even after event pagination is complete (`isComplete === true`). Preserves event order, event IDs, and next cursor. Applies target patches to loaded rows without downgrading untargeted provenance (`b` remains `current`). Rejects stale completions and deduplicates same-turn target requests.

### E. Component & Route Integration
1. **Tabs in `StudyLibrary.tsx`:** Synchronize URL search params (`tab=library`, `tab=due`, `tab=history`). Support `/study/history` route redirect.
2. **Review Due View (`StudyLibraryReviewDue.tsx`):**
   - Render urgency-ranked list of actionable study materials.
   - Display page-local counts, candidate scan progress indicator, and explicit issue notifications with clickable links pointing to `/study/<encoded-id>`.
   - Provide "Load more" button disabled while loading.
   - Include topic filter chips and status filter dropdown (`All actionable`, `Due today`, `New only`).
3. **Recent Reviews View (`StudyLibraryHistory.tsx`):**
   - Keyset pagination with "Load more".
   - Badges for ratings (`Again`, `Hard`, `Good`, `Easy`) and version provenance (`Earlier version`).
   - Material and topic filters.
   - Read-only card inspection modal/view.
   - Disclaimers explicitly separating card reviews from practice test scores.

---

## 4. Verification & Acceptance Criteria

1. **All Seven Reviewer Diagnostics Must Pass Unchanged (74 / 74 total):**
   - Diagnostic 1 (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): 9/9 pass.
   - Diagnostic 2 (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): 12/12 pass.
   - Diagnostic 3 (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): 16/16 pass.
   - Diagnostic 4 (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): 11/11 pass.
   - Diagnostic 5 (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): 8/8 pass.
   - Diagnostic 6 (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`): 11/11 pass.
   - Diagnostic 7 (`docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs`): 7/7 pass.
2. **Comprehensive Proof Test Suite (`proof.test.mjs`):** 57 / 57 pass across 14 test suites.
3. **Reliable Mutation Verification:**
   - Isolated child process runs kill all 4 semantic mutants with `AssertionError`.
   - Survival control confirms verifier fails when mutant assertions are disabled.
4. **Resource Limit Verification:** Card budget (2,500), byte ceiling (2 MiB), and absolute single-set bound (8 MiB) strictly enforced via preflight with conservative 500-card reservation before parse that remains spent on parse failure.
5. **Cursor Bounds & Validation:** 32 KiB maximum cursor length supporting 250 candidate IDs; strict `v: 1` versioning, priority rank domain `lp === 0 || lp === 1`, and mandatory context ownership enforced before SQL.
6. **Executed SQL Audit:** Confirmed call counts on 5,000-material/10,000-event fixture: Due first/continuation/filter = **175 / 150 / 177**, History first/next/filter = **22 / 22 / 22**.
7. **Offline & Invariant Integrity:** Zero provider/network calls; Schema 12 preserved without migrations; reads remain strictly read-only.

