# M2-4 / Card Reviews C2 — Product Scope, Recommended Defaults, and Query Contract (7 October 2026)

**Planning proposal and disposable query proof for review. Do not implement production C2 yet.**

C1 delivered durable, material-level card reviews within `MaterialDetail` (`/study/:materialId`), featuring content-addressed version identity, deterministic `simple-v1` scheduling, atomic generation-guarded resets, and replay-safe operation receipts ([C1 Acceptance](M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md)).

C2 expands card reviews to the library level inside the existing Study Library (`/study`). It allows a student pilot to see which study materials have current cards due for review, choose any material for a focused offline review session, and inspect a bounded chronological history of card reviews with clear version provenance, completely separated from practice test attempt scores.

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
     If the user subsequently regenerates or edits M1's flashcards into Version B (12 cards), Version B is raw in `ai_study_sets` and has no row in `card_versions`. In C2, Version A's due cards (Cards 0 and 1) are recognized as belonging to a retired snapshot and are **strictly excluded** from due work. All 12 cards of Version B appear as new cards. If the user reverts M1 back to Version A's exact text (A → B → A), Version A's retained schedule and due cards immediately reactivate.

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
| **C2-D1** | **Navigation & Workspace Layout** | Tabbed sub-views inside existing Study Library (`Library` \| `Review due` \| `History`) with URL synchronization (`/study`, `/study?tab=due`, `/study?tab=history`). | Separate top-level navigation routes or a distinct study application. | Avoids fragmenting the application; keeps notes, guides, tests, and cards unified per ROADMAP section 7C. | **Yes** |
| **C2-D2** | **Session Entry Model** | **Material-selected C1 sessions first.** Clicking a material in "Review due" launches a focused session for that specific material. | Blended multi-material review collections across different topics. | Preserves C1's robust per-material transaction boundary, atomic generation barrier, and simple offline model. Multi-material sessions are deferred. | **Yes** |
| **C2-D3** | **Default Ordering in "Review due"** | **Urgency-first bucket ranking:**<br>1. Materials with due Again cards (step -1)<br>2. Materials with due Day cards (step >= 0)<br>3. Materials with only New cards.<br>Tie-break by `next_up` priority, then earliest due instant, then title ASC. | Chronological `updated_at` order or pure alphabetical order. | Surfaces urgent relearning and daily review work immediately, avoiding pilot cognitive overload. | **Yes** |
| **C2-D4** | **Default Filters in "Review due"** | Default filter: **"All actionable"** (due or new cards). Options: "Due today only", "New cards only", and Topic filter. | Only showing due cards; hiding new cards until manually started. | Allows students to choose whether to clear due reviews or learn new concepts, while keeping new content discoverable. | **Yes** |
| **C2-D5** | **Empty, Loading, & Error States** | Friendly empty card ("All caught up! No cards due for review"). Shimmer loading with route epoch guards. Non-blocking error banner with sanitized message and manual "Check again" retry. | Hard blocking error dialogs or silent failure. | Carries C1 request-ownership principles forward; prevents stale flashes and race conditions during rapid navigation. | **Yes** |
| **C2-D6** | **History Paging & Scope** | **Keyset cursor pagination** (`reviewed_at DESC, id DESC`), bounded at 20 items per page. "Load more" button disabled while loading. | Full array in React memory, or offset pagination. | Scales efficiently to 10,000+ review events; prevents row skipping or duplication across tied timestamps. | **Yes** |
| **C2-D7** | **Separation from Practice Tests** | **Strict semantic & visual separation.** Card reviews display spaced-repetition ratings (`Again`, `Hard`, `Good`, `Easy`) and interval progression. Practice tests display test scores, percentages, and completed attempts. Explicit disclaimers on both views. | Blended composite "Study Score" or inferred FAA exam readiness score. | ROADMAP 7C explicitly forbids claiming mastery or exam readiness from card repetitions. | **Yes** |
| **C2-D8** | **New-Card Discovery Architecture** | **Bounded On-Demand Discovery** (Design 1) with targeted SQL queries and candidate hash checks. **Zero database migrations** (Schema 12 preserved). | Rebuildable cache table (Migration 0013) or persistent backfill. | Benchmarks prove p50 latency is **22.5ms** at 5,000 materials without schema changes, eliminating upgrade risk and backup incompatibilities. | **Yes** |
| **C2-D9** | **Candidate & Session Bounds** | Library candidate list capped at **250 materials** per query; individual review sessions retain C1 caps (**MAX_NEW = 10**, **MAX_TOTAL = 20**). | Uncapped global queries or unlimited session lengths. | Prevents memory exhaustion and preserves spaced-repetition pedagogical effectiveness. | **Yes** |

---

## 2. Comparison of New-Card Discovery Architectures

C1 materializes snapshots into `card_versions` and `card_items` only upon the first mutation (rating, suspend, or flag) and derives current identity in pure code from raw saved cards in `ai_study_sets.flashcards_json`. A library-wide query cannot silently assume the last materialized snapshot is current, nor can it ignore unreviewed materials that have never been materialized.

We evaluated three architectural options across 100, 2,500, and 5,000 materials:

```
+---------------------------------------------------------------------------------------------------+
| Architecture Comparison                                                                           |
+------------------------------+---------------------------+-----------------------+----------------+
| Metric / Criterion           | Design 1: Bounded On-     | Design 2: Rebuildable | Design 3:      |
|                              | Demand Discovery (Rec.)   | Cache (Mig. 0013)     | Persistent     |
|                              |                           |                       | Backfill       |
+------------------------------+---------------------------+-----------------------+----------------+
| Schema Migration Required    | NONE (Schema 12 preserved)| YES (Migration 0013)  | YES (Mig. 0013)|
| 5,000 Materials p50 Latency  | 22.5 ms                   | 8.2 ms                | 7.9 ms         |
| 5,000 Materials p95 Latency  | 24.7 ms                   | 11.4 ms               | 10.8 ms        |
| Old Backup Restore (Schema 11/12)| Instantaneous (0 ms)  | Requires table rebuild| Heavy backfill |
| Application Upgrade Overhead | Zero downtime             | Checksum & DDL exec   | Heavy I/O lock |
| A -> B -> A Reversion Safety | Automatic & immediate     | Requires cache sync   | Fragile sync   |
| DB Storage Footprint         | Minimal                   | Moderate (+1-2 MB)    | High (+15 MB)  |
| Read-Only Invariant          | Preserved ("Reads never   | Mutates cache on read | Writes on boot |
|                              | write")                   | or sync               |                |
+------------------------------+---------------------------+-----------------------+----------------+
```

### Recommendation:
We recommend **Design 1: Bounded On-Demand Discovery**.
- It runs well under the 50 ms interactive UI budget (22.5 ms at 5,000 materials).
- It requires **zero schema migrations**, keeping `CURRENT_SCHEMA_VERSION = 12`.
- It completely eliminates migration risk for desktop macOS and prospective iOS clients.
- It honors the C1 architectural invariant: *"Reads never write."*

---

## 3. Concrete Read/Write and Compatibility Contract

### A. Routes and View Hierarchy
Inside `src/App.tsx` and `src/pages/StudyLibrary/StudyLibrary.tsx`:
- `/study`: Study Library binder (default `tab=library`).
- `/study?tab=due`: Review Due queue.
- `/study?tab=history` (or `/study/history`): History hub with distinct tabs:
  - Sub-tab A: **Flashcard Reviews** (`card_review_events`, keyset paginated).
  - Sub-tab B: **Practice Tests** (`practice_attempts`, completed attempts from Slice B).

### B. Minimal Proposed Files
1. `src/domain/types.ts`: Extend with `LibraryReviewDueInput`, `LibraryReviewMaterialEntry`, `LibraryReviewDueSummary`, and `LibraryRecentReviewEntry`.
2. `src/data/repositories/cardReviewRepository.ts`: Add `getLibraryReviewDue()` and `getLibraryRecentReviews()`.
3. `src/pages/StudyLibrary/StudyLibrary.tsx`: Add tab switcher (`Library`, `Review due`, `History`), integrate review status badges into `MaterialCard`, and render `LibraryReviewDuePanel`.
4. `src/pages/StudyLibrary/LibraryReviewDuePanel.tsx`: New component displaying the ranked materials queue, filter chips, loading/empty states, and session launcher.
5. `src/pages/StudyLibrary/PracticeHistory.tsx`: Add sub-tab toggle for Flashcards vs Practice Tests, preserving all existing attempt review routes.
6. `src/pages/StudyLibrary/studyLibrary.css`: Minimal styles for review badges and queue cards.

### C. Executable Candidate SQL Queries

#### Query 1: Active Due Cards Aggregation
```sql
SELECT
  m.id AS material_id,
  m.title,
  m.topic,
  m.review_status,
  m.priority,
  m.updated_at,
  v.id AS active_version_id,
  v.content_hash AS active_content_hash,
  v.card_count AS active_card_count,
  SUM(CASE WHEN s.step < 0 AND s.due_at <= :nowUtc THEN 1 ELSE 0 END) AS again_count,
  SUM(CASE WHEN s.step >= 0 AND s.due_at < :nextLocalMidnightUtc THEN 1 ELSE 0 END) AS day_count,
  MIN(CASE WHEN ((s.step < 0 AND s.due_at <= :nowUtc) OR (s.step >= 0 AND s.due_at < :nextLocalMidnightUtc)) THEN s.due_at ELSE NULL END) AS earliest_due_at,
  (SELECT COUNT(*) FROM card_review_state crs
   WHERE crs.source_material_id = m.id
     AND (crs.due_at IS NOT NULL OR crs.suspended = 1 OR crs.flag IS NOT NULL)) AS touched_count
FROM card_review_state s
JOIN card_items i ON i.id = s.item_id
JOIN card_versions v ON v.id = i.version_id
JOIN study_materials m ON m.id = v.source_material_id
WHERE v.is_active = 1
  AND s.suspended = 0
  AND s.flag IS NULL
  AND s.due_at IS NOT NULL
  AND ((s.step < 0 AND s.due_at <= :nowUtc) OR (s.step >= 0 AND s.due_at < :nextLocalMidnightUtc))
GROUP BY m.id, m.title, m.topic, m.review_status, m.priority, m.updated_at, v.id, v.content_hash, v.card_count;
```

#### Query 2: Unmaterialized New-Card Candidate Discovery
```sql
SELECT
  m.id AS material_id,
  m.title,
  m.topic,
  m.review_status,
  m.priority,
  m.updated_at,
  a.flashcards_json,
  v.id AS active_version_id,
  v.content_hash AS active_content_hash,
  v.card_count AS active_card_count
FROM study_materials m
JOIN ai_study_sets a ON a.source_material_id = m.id
LEFT JOIN card_versions v ON v.source_material_id = m.id AND v.is_active = 1
WHERE a.flashcards_json IS NOT NULL
  AND a.flashcards_json != '[]'
  AND a.flashcards_json != ''
ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END, m.updated_at DESC
LIMIT :maxNewDiscovery;
```

#### Query 3: Library-Wide History Keyset Pagination
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

## 4. Disposable Proof and Performance Measurements

Comprehensive verification was conducted using the disposable proof suite in `docs/evidence/m2-card-review-c2-scope-2026-10-07/`:

### A. Assertion Suite Results (`node --test proof.test.mjs`)
- **15 tests passed / 0 failed** in 170 ms (Node v26.10.0, Apple M5, macOS arm64).
- Verified:
  1. Discovery of unmaterialized materials (`mat-nav-02` shows 8 new cards, 0 due).
  2. Exclusion of retired snapshot due rows on content change (`mat-changed-03` shows 0 due, 7 new).
  3. Schedule reactivation on A → B → A reversion (`mat-revert-04` reuses version A's due schedule).
  4. Exact time boundaries: Again card included at exact instant, excluded 1ms prior; Day card included before next local midnight; 25-hour DST boundary handled accurately.
  5. Paused/flagged never-rated cards excluded from due and new counts.
  6. Keyset pagination over tied timestamps produces zero duplicates and zero omissions.
  7. History provenance correctly marks retired snapshot events as earlier versions.
  8. Material deletion cascades card data, preserving tombstoned receipts (`is_erased = 1`).
  9. Three deliberate semantic negative controls failed their assertions as expected, proving test sensitivity.

### B. Scalability Benchmarks (`results.json`)

```
+----------------------------------------------------------------------------------------+
| Measured Latency Across Library Scales (Apple M5, arm64, Node v26, SQLite 3.54)        |
+--------------------------+--------------------+--------------------+-------------------+
| Operation / Query        | 100 Materials      | 2,500 Materials    | 5,000 Materials   |
|                          | (476 cards,        | (12,476 cards,     | (24,976 cards,    |
|                          | 190 events)        | 4,933 events)      | 9,874 events)     |
+--------------------------+--------------------+--------------------+-------------------+
| Review Due (End-to-End)  | p50: 1.51 ms       | p50: 11.71 ms      | p50: 22.51 ms     |
|                          | p95: 1.80 ms       | p95: 13.09 ms      | p95: 24.70 ms     |
+--------------------------+--------------------+--------------------+-------------------+
| SQL Portion Alone        | p50: 0.11 ms       | p50:  2.28 ms      | p50:  4.97 ms     |
| Hash & JSON Verification | p50: 0.06 ms       | p50:  0.20 ms      | p50:  0.21 ms     |
+--------------------------+--------------------+--------------------+-------------------+
| History Page 1 (20 items)| p50: 0.18 ms       | p50:  4.21 ms      | p50:  9.30 ms     |
| History Page 2 (Cursor)  | p50: 0.15 ms       | p50:  2.71 ms      | p50:  5.81 ms     |
+--------------------------+--------------------+--------------------+-------------------+
```

### C. Proposed Performance Budgets
Based on the measured evidence, the following production budgets are proposed:
- **Review Due Query:** p50 <= 15 ms, p95 <= 35 ms.
- **History Keyset Page Query:** p50 <= 5 ms, p95 <= 15 ms.
- **Candidate Content-Hash Verification:** p50 <= 2 ms.
- **UI Render Preparation:** p50 <= 10 ms.
- **Total User-Perceived Interaction Budget:** <= 50 ms.

---

## 5. Next Steps and Gate

Production implementation of C2 requires:
1. Independent scope acceptance of this document and its disposable evidence.
2. Owner approval of the recommended product defaults (C2-D1 through C2-D9).
3. Execution of the conditional implementation prompt ([`docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`](M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md)).
