# M2-4 / Card Reviews C2 — Product Scope, Recommended Defaults, and Verified Query Contract (7 October 2026)

**Corrected planning proposal and verified query proof for re-review. Do not begin production C2 implementation.**

C1 delivered durable, material-level card reviews within `MaterialDetail` (`/study/:materialId`), featuring content-addressed version identity, deterministic `simple-v1` scheduling, atomic generation-guarded resets, and replay-safe operation receipts ([C1 Acceptance](M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md)).

C2 expands card reviews to the library level inside the existing Study Library (`/study`). It allows a student pilot to see which study materials have current cards due for review, choose any material for a focused offline review session, and inspect a bounded chronological history of card reviews with authoritative version provenance, completely separated from practice test attempt scores.

---

## Concrete Introductory Example

To ground the design, consider a pilot's Study Library containing the following synthetic materials:

1. **Material M1: "Aerodynamics & Principles of Flight"** (`mat-aero-01`, topic: `aerodynamics`, priority: `next_up`):
   - Created with 10 cards in `ai_study_sets.flashcards_json`.
   - Materialized into snapshot Version A (`ver-aero-vA`) during a previous review session:
     - **Card 0 (Due Again card):** Rated "Again" 10 minutes ago (step -1). It is due at its exact instant (`T0 - 5min`).
     - **Card 1 (Due Day card):** Rated "Good" yesterday (step 0, 1-day interval). It is due today (`T0 - 2h`), before the exclusive next local midnight.
     - **Card 2 (Future card):** Rated "Easy" yesterday (step 2, 3-day interval). It is due in 2 days (not due today).
     - **Card 3 (Flagged card):** Flagged as `unclear` before rating. It has `due_at IS NULL`, `reps = 0`, and `flag = 'unclear'`. It is excluded from both due work and new card counts.
     - **Cards 4–9 (New cards):** Never rated or flagged (6 eligible new cards).
   - **Regeneration Scenario (A → B unmaterialized):**
     If the user subsequently regenerates or edits M1's flashcards into Version B (12 cards), Version B is raw in `ai_study_sets` and has no row in `card_versions`. In C2, Version A's due cards (Cards 0 and 1) are recognized as belonging to a retired snapshot and are **strictly excluded** from due work. All 12 cards of Version B appear as new cards. If the user reverts M1 back to Version A's exact text (A → B → A), Version A's retained schedule and due cards immediately reactivate with zero database writes.

2. **Material M2: "Cross-Country Navigation & VORs"** (`mat-nav-02`, topic: `navigation`, priority: `important`):
   - Created with 8 flashcards in `ai_study_sets.flashcards_json`.
   - Never reviewed by the user. There is **no row** in `card_versions`, `card_items`, or `card_review_state`.
   - In C2, M2 is automatically discovered as having **8 new cards** and 0 due cards.

### What Changes from C1's Material-Only View:
- **In C1:** Reviews are strictly siloed inside `MaterialDetail` (`/study/:materialId`). A student pilot cannot see which materials have reviewable cards without opening each material one by one. Unreviewed materials with new cards remain invisible unless viewed directly. History only displays recent ratings for the single open material.
- **In C2:** The Study Library provides three unified library-wide views:
  1. **Library View (`/study`):** The primary material binder, enhanced with review indicators on material cards (e.g., `2 due`, `8 new`, or `Caught up`).
  2. **Review Due View (`/study?tab=due`):** A dedicated, ranked queue of all materials with actionable work. Materials with urgent Again cards appear first, followed by Day cards due today, followed by materials with new unrated cards. Clicking a material initiates a focused offline review session.
  3. **History View (`/study?tab=history` or `/study/history`):** A bounded chronological audit trail of card reviews across all materials, indicating exact version provenance (`Earlier version` badge for retired cards), completely distinct from practice test scores.

---

## 1. Product Scope and Owner Defaults

The following decision table resolves all product defaults for C2. One owner approval covers all recommended defaults:

| ID | Decision Area | Recommended Default | Alternative Considered | Impact / Rationale | Owner Approval Needed? |
| --- | --- | --- | --- | --- | :---: |
| **C2-D1** | **Navigation & Workspace Layout** | Tabbed sub-views inside existing Study Library (`Library` \| `Review due` \| `History`) with URL synchronization (`/study`, `/study?tab=due`, `/study?tab=history`), while preserving `/study/history` as a compatible route. | Separate top-level navigation routes or a distinct study application. | Avoids fragmenting the application; keeps notes, guides, tests, and cards unified per ROADMAP section 7C. | **Yes** |
| **C2-D2** | **Session Entry Model** | **Material-selected C1 sessions first.** Clicking a material in "Review due" launches a focused session for that specific material. | Blended multi-material review collections across different topics. | Preserves C1's robust per-material transaction boundary, atomic generation barrier, and simple offline model. Multi-material sessions are deferred. | **Yes** |
| **C2-D3** | **Default Ordering in "Review due"** | **Urgency-first bucket ranking within candidate scan batches:**<br>1. Materials with due Again cards (step -1)<br>2. Materials with due Day cards (step >= 0)<br>3. Materials with only New cards.<br>Tie-break by `next_up` priority, then earliest due instant, then title ASC, then ID ASC. | Pure chronological `updated_at` order or alphabetical order. | Surfaces urgent relearning and daily review work immediately, avoiding pilot cognitive overload while maintaining deterministic paging. | **Yes** |
| **C2-D4** | **Default Filters in "Review due"** | Default filter: **"All actionable"** (`totalDueCount > 0 \|\| newCount > 0`). Filter options:<br>- `"due_today"`: materials with `totalDueCount > 0`<br>- `"new_only"`: materials with `totalDueCount === 0 && newCount > 0`<br>- Topic filter chip selector. | Only showing due cards; hiding new cards until manually started. | Mixed materials (having both due and new cards) match "due_today" and "all", but are excluded from "new_only". Allows pilots to focus purely on unlearned concepts without mixing due relearning. | **Yes** |
| **C2-D5** | **Empty, Loading, & Error States** | Friendly empty card ("All caught up! No cards due for review" when candidate stream is exhausted). Progressive continuation prompt if scan budget reached without finding actionable items. Shimmer loading with route epoch guards. Non-blocking error banner with sanitized message and manual "Check again" retry without replaying writes. | Hard blocking error dialogs or silent failure. | Carries C1 request-ownership principles forward; prevents stale flashes and race conditions during rapid navigation. | **Yes** |
| **C2-D6** | **History Paging & Scope** | **Keyset cursor pagination** (`reviewed_at DESC, id DESC`), bounded at 20 items per page. "Load more" button disabled while loading. | Full array in React memory, or offset pagination. | Scales efficiently to 10,000+ review events; prevents row skipping or duplication across tied timestamps. | **Yes** |
| **C2-D7** | **Separation from Practice Tests** | **Strict semantic & visual separation.** Card reviews display spaced-repetition ratings (`Again`, `Hard`, `Good`, `Easy`) and interval progression. Practice tests display test scores, percentages, and completed attempts. Explicit disclaimers on both views. | Blended composite "Study Score" or inferred FAA exam readiness score. | ROADMAP 7C explicitly forbids claiming mastery or exam readiness from card repetitions. | **Yes** |
| **C2-D8** | **New-Card Discovery Architecture** | **Bounded Candidate Discovery with Keyset Continuation** (Design 1) with candidate batch budget (250 items per call). **Zero database migrations** (Schema 12 preserved). | Rebuildable cache table (Migration 0013) or persistent backfill. | Benchmarks prove p50 latency is **3.24 ms** per page at 5,000 materials without schema changes, eliminating upgrade risk and backup incompatibilities. | **Yes** |
| **C2-D9** | **Candidate & Session Bounds** | Candidate evaluation budget capped at **250 materials** per query; individual review sessions retain C1 caps (**MAX_NEW = 10**, **MAX_TOTAL = 20**). | Uncapped global queries or unlimited session lengths. | Prevents memory exhaustion and preserves spaced-repetition pedagogical effectiveness. | **Yes** |

---

## 2. Comparison of New-Card Discovery Architectures

C1 materializes snapshots into `card_versions` and `card_items` only upon the first mutation (rating, suspend, or flag) and derives current identity in pure code from raw saved cards in `ai_study_sets.flashcards_json`. A library-wide query cannot silently assume the last materialized snapshot is current, nor can it ignore unreviewed materials that have never been materialized.

We evaluated three architectural options across 100, 2,500, and 5,000 materials:

```
+---------------------------------------------------------------------------------------------------+
| Architecture Comparison                                                                           |
+------------------------------+---------------------------+-----------------------+----------------+
| Metric / Criterion           | Design 1: Bounded         | Design 2: Rebuildable | Design 3:      |
|                              | Discovery with            | Cache Table           | Persistent     |
|                              | Continuation (Rec.)       | (Provisional Mig. 0013)| Backfill      |
+------------------------------+---------------------------+-----------------------+----------------+
| Schema Migration Required    | NONE (Schema 12 preserved)| YES (Migration 0013)  | YES (Mig. 0013)|
| 5,000 Materials Page 1 (p50) | 3.24 ms (Measured)        | Estimated ~2-4 ms     | Estimated ~2 ms|
| Full Discovery p50 (84 pages)| 251.27 ms (Measured)      | Single read           | Single read    |
| Old Backup Restore (11/12)   | Instantaneous (No DDL)    | Requires DDL + sync   | Heavy backfill |
| Application Upgrade Risk     | Zero (Code only)          | Checksum registry +   | Large I/O lock |
|                              |                           | DDL migration         | on startup     |
| A -> B -> A Reversion Safety | Automatic & immediate     | Fragile sync hook     | Fragile sync   |
| Read-Only Invariant          | Preserved ("Reads never   | Mutates cache on sync | Writes on boot |
|                              | write")                   | or mutation           |                |
| Desktop IPC / UI Cost        | Unmeasured in Node        | Unmeasured in Node    | Unmeasured in  |
|                              | micro-benchmarks          | micro-benchmarks      | Node benchmarks|
+------------------------------+---------------------------+-----------------------+----------------+
```

### Recommendation:
We recommend **Design 1: Bounded Discovery with Continuation**.
- It runs in **3.24 ms** (p50) and **4.19 ms** (p95) for the first page at 5,000 materials.
- It requires **zero schema migrations**, keeping `CURRENT_SCHEMA_VERSION = 12`.
- It completely eliminates migration risk for desktop macOS and prospective iOS clients.
- It honors the C1 architectural invariant: *"Reads never write."*
- Proposing provisional Migration 0013 is preserved under C2-D8 as an unapproved future alternative, should persistent indexing ever be desired by the owner.

---

## 3. Concrete Read/Write and Compatibility Contract

### A. Routes and View Hierarchy
Inside `src/App.tsx` and `src/pages/StudyLibrary/StudyLibrary.tsx`:
- `/study`: Study Library binder (default `tab=library`).
- `/study?tab=due`: Review Due queue.
- `/study?tab=history`: History hub inside Study Library (with sub-tabs for Flashcards and Practice Tests).
- `/study/history`: Preserved for backwards route compatibility, synchronizing seamlessly with `tab=history`.

### B. Typed Query Contracts

```typescript
export interface LibraryReviewDueInput {
  nowUtc: string; // ISO 8601 UTC instant
  nextLocalMidnightUtc: string; // ISO 8601 UTC instant of next local calendar midnight
  topic?: string | null;
  statusFilter?: "all" | "due_today" | "new_only"; // default: "all"
  limit?: number; // default: 50
  cursor?: string | null; // opaque candidate continuation cursor
  candidateBatchBudget?: number; // default: 250
}

export interface LibraryReviewMaterialEntry {
  materialId: string;
  title: string;
  topic: string;
  reviewStatus: string;
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
  topic?: string | null;
  materialId?: string | null;
}

export interface LibraryRecentReviewEntry {
  id: string;
  itemId: string;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
  schedulerVersion: string;
  generation: number;
  front: string;
  sourcePage: number | null;
  materialId: string;
  materialTitle: string;
  materialTopic: string;
  versionId: string;
  isEarlierVersion: boolean; // determined by comparing event versionId to current raw cards
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: { reviewedAt: string; id: string } | null;
}
```

### C. Executable Candidate SQL Queries

#### Query 1: Candidate Selection with Deterministic Keyset Cursor
```sql
SELECT
  m.id AS material_id,
  m.title,
  m.topic,
  m.review_status,
  m.priority,
  m.updated_at
FROM study_materials m
JOIN ai_study_sets a ON a.source_material_id = m.id
WHERE a.flashcards_json IS NOT NULL
  AND a.flashcards_json != '[]'
  AND a.flashcards_json != ''
  AND (:topic IS NULL OR m.topic = :topic)
  AND (
    :cursorP IS NULL
    OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END > :cursorP)
    OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = :cursorP AND m.updated_at < :cursorU)
    OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = :cursorP AND m.updated_at = :cursorU AND m.id > :cursorId)
  )
ORDER BY
  CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC,
  m.updated_at DESC,
  m.id ASC
LIMIT :candidateBatchBudgetPlusOne;
```

#### Query 2: Review State Scoped Strictly to Current Version Items
```sql
SELECT
  s.step,
  s.due_at,
  s.suspended,
  s.flag
FROM card_review_state s
JOIN card_items i ON i.id = s.item_id
WHERE i.version_id = :currentVersionId;
```

#### Query 3: Library-Wide History Keyset Pagination with Tie-Breaker
```sql
SELECT
  e.id AS event_id,
  e.item_id,
  e.rating,
  e.reviewed_at,
  e.scheduler_version,
  e.generation,
  i.front,
  i.source_page,
  v.id AS version_id,
  v.content_hash,
  v.is_active,
  m.id AS material_id,
  m.title AS material_title,
  m.topic AS material_topic
FROM card_review_events e
JOIN card_items i ON i.id = e.item_id
JOIN card_versions v ON v.id = i.version_id
JOIN study_materials m ON m.id = v.source_material_id
WHERE (:topic IS NULL OR m.topic = :topic)
  AND (:materialId IS NULL OR m.id = :materialId)
  AND (:cursorReviewedAt IS NULL OR (e.reviewed_at < :cursorReviewedAt OR (e.reviewed_at = :cursorReviewedAt AND e.id < :cursorId)))
ORDER BY e.reviewed_at DESC, e.id DESC
LIMIT :limitPlusOne;
```

### D. Single-Connection Pool & Transaction Boundary
- Reads remain strictly **read-only**.
- All multi-statement card review mutations continue to pass through the atomic driver method (`saveCardReviewAtomically`), preserving the owned native connection invariant. Pooled `BEGIN`/`COMMIT` calls are forbidden.

### E. Backup and Restore Ceiling
- Current schema version remains `12`.
- Backups created on Schema 11 or 12 restore cleanly. Backups with schema >= 13 are refused by the schema ceiling in `src-tauri/src/backup.rs`.

---

## 4. Verified Proof and Performance Measurements

All five review findings (C2-R1 through C2-R5) were resolved and verified in `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`:

### A. Frozen Reviewer Diagnostic (`diagnostic.test.mjs`)
- Executed unchanged via `C2_REVIEW_MODEL` against the corrected contract model:
- **9 tests passed / 0 failed, exit 0** in 102 ms (receipt: `receipts/frozen-diagnostic.txt`).

### B. Comprehensive Proof Suite (`proof.test.mjs`)
- **15 tests passed / 0 failed, exit 0** in 191 ms (receipt: `receipts/proof-run.txt`).
- Proves:
  1. Discovery of unmaterialized materials (`mat-nav-02` has 8 new cards, 0 due).
  2. Immediate exclusion of retired version A due cards upon unmaterialized B replacement (`mat-changed-03`).
  3. Immediate reuse of retained schedule upon raw A reversion (`mat-revert-04`) with zero writes.
  4. Isolation of touched states: retired A state rows cannot reduce current B new counts.
  5. Exact time boundaries: Again card at exact instant, Day card before next local midnight, 25-hour DST boundary.
  6. Keyset pagination over tied timestamps produces zero duplicates and zero omissions, matching independent SQL oracle.
  7. DeferredReadController generation barriers, held continuations, and deliberate read retries without replaying writes.
  8. Deletion cascades real version and item IDs, tombstones operations (`is_erased = 1`).
  9. Three deliberate semantic negative controls failed as expected (receipt: `receipts/negative-controls.txt`).

### C. Scalability Benchmarks (`results.json`)
Measured on Apple M5 (10 cores, Node v22.23.3, SQLite 3.53.4, receipt: `receipts/benchmark-run.txt`):

```
+----------------------------------------------------------------------------------------+
| Measured Latency Across Library Scales (Apple M5, arm64, Node v22.23.3, SQLite 3.53.4) |
+--------------------------+--------------------+--------------------+-------------------+
| Operation / Query        | 100 Materials      | 2,500 Materials    | 5,000 Materials   |
|                          | (976 cards,        | (12,976 cards,     | (25,476 cards,    |
|                          | 200 events)        | 5,000 events)      | 10,000 events)    |
+--------------------------+--------------------+--------------------+-------------------+
| Review Due Page 1        | p50: 1.86 ms       | p50: 2.26 ms       | p50: 3.24 ms      |
| (limit 50, budget 250)   | p95: 5.46 ms       | p95: 2.92 ms       | p95: 4.19 ms      |
+--------------------------+--------------------+--------------------+-------------------+
| Full Discovery           | 2 pages            | 42 pages           | 84 pages          |
| (Traversing Entire DB)   | p50: 3.89 ms       | p50: 97.80 ms      | p50: 251.27 ms    |
+--------------------------+--------------------+--------------------+-------------------+
| Candidate SQL Query      | p50: 0.10 ms       | p50: 1.01 ms       | p50: 1.93 ms      |
| JSON + Canonical + Hash  | p50: 0.85 ms       | p50: 0.76 ms       | p50: 0.78 ms      |
| (50 materials, ~89 KB)   |                    |                    |                   |
+--------------------------+--------------------+--------------------+-------------------+
| History Page 1 (20 items)| p50: 1.09 ms       | p50: 4.61 ms       | p50: 9.63 ms      |
| History Page 2 (Cursor)  | p50: 0.99 ms       | p50: 3.15 ms       | p50: 6.22 ms      |
+--------------------------+--------------------+--------------------+-------------------+
| Adversarial 500-Card Set | Full parse, canonicalize, content hash & 500 item hashes:  |
| Pipeline Benchmark       | p50: 0.48 ms | p95: 0.87 ms | max: 0.97 ms             |
+--------------------------+-------------------------------------------------------------+
```

### D. Truthful Performance Budget Evaluation
- **Candidate Discovery & Page 1 Read:** Measured p50 = 3.24 ms <= proposed budget 15 ms (**PASS** in SQLite/Node).
- **History Keyset Page Query:** Measured p50 = 9.63 ms (Page 1) and 6.22 ms (Page 2) <= proposed budget 15 ms (**PASS** in SQLite/Node).
- **500-Card Full Pipeline Hashing:** Measured p50 = 0.48 ms <= proposed budget 5 ms (**PASS**).
- **Desktop IPC & Safari/WebKit UI Rendering:** Explicitly labeled as **UNMEASURED** in Node micro-benchmarks; requires end-to-end measurement in the Tauri runtime.

---

## 5. Next Steps and Gate

Production implementation of C2 requires:
1. Independent scope acceptance of this corrected package and evidence.
2. Owner approval of the recommended product defaults (C2-D1 through C2-D9).
3. Execution of the conditional implementation prompt ([`docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`](M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md)).
