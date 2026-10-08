# M2-4 / Card Reviews C2 — Library-Wide Review Due and History Scope Proposal (7 October 2026)

> [!IMPORTANT]
> **PROPOSED PLANNING SCOPE — CORRECTED, PENDING INDEPENDENT REVIEW.**
> This document specifies the complete, verified product and architectural design for Milestone 2, Card Review C2 (Library-Wide Review Due and History Discovery). All recommended defaults (**C2-D1 through C2-D9**) are **PROPOSED** pending independent scope acceptance and recorded owner choice.
> Production C2 implementation is not authorized until owner approval is recorded.

---

## Executive Summary & Problem Framing

In C1 (delivered and accepted in PR #70), flashcard review capabilities were introduced inside individual study materials (`/study/:materialId`). While C1 established a sound deterministic scheduling engine (`simple-v1`), content-addressed card identity, and atomic write-transaction boundaries, it left review activities siloed:
- A pilot cannot determine which study materials currently have cards due for review without opening each material individually.
- Study materials that were generated with flashcards but never opened for review remain completely invisible in any review context.
- Historical review activity is scoped strictly to the single open material.

Milestone 2 C2 expands this foundation across the entire Study Library:
1. **Library-Wide Review Due View (`/study?tab=due`):** A ranked queue surfacing all materials with actionable review work (Again relearning, Day cards due before next local midnight, and new unrated cards).
2. **Library-Wide History View (`/study?tab=history`):** A unified, keyset-paginated audit trail of card reviews across all materials with genuine content-addressed version provenance (`Earlier version` badge derived from current raw cards, never stale flags).
3. **Library Binder Review Indicators (`/study`):** Lightweight status badges on material cards indicating actionable review counts.

### Key Example Scenario: Material M2 ("Cross-Country Navigation")
- Created with 8 flashcards in `ai_study_sets.flashcards_json`.
- Never reviewed by the pilot. There is **no row** in `card_versions`, `card_items`, or `card_review_state`.
- In C2, M2 is automatically discovered as having **8 new cards** and 0 due cards, without requiring any background mutation, backfill, or database migration.

---

## 1. Product Scope and Proposed Owner Defaults (C2-D1 – C2-D9)

The following decision table defines the proposed product defaults for C2. All defaults are currently **PROPOSED**:

| ID | Decision Area | Recommended Default | Alternative Considered | Impact / Rationale | Status |
| --- | --- | --- | --- | --- | :---: |
| **C2-D1** | **Navigation & Workspace Layout** | Tabbed sub-views inside existing Study Library (`Library` \| `Review due` \| `History`) with URL synchronization (`/study`, `/study?tab=due`, `/study?tab=history`), while preserving `/study/history` as a compatible route. | Separate top-level navigation routes or a distinct study application. | Avoids fragmenting the application; keeps notes, guides, tests, and cards unified per ROADMAP section 7C. | **Proposed** |
| **C2-D2** | **Session Entry Model** | **Material-selected C1 sessions first.** Clicking a material in "Review due" launches a focused session for that specific material. | Blended multi-material review collections across different topics. | Preserves C1's robust per-material transaction boundary, atomic generation barrier, and simple offline model. Multi-material sessions are deferred. | **Proposed** |
| **C2-D3** | **Default Ordering in "Review due"** | **Urgency-first bucket ranking within candidate batches:**<br>1. Materials with due Again cards (step -1)<br>2. Materials with due Day cards (step >= 0)<br>3. Materials with only New cards.<br>Tie-break by `next_up` priority, earliest due instant, title ASC, ID ASC. Bounded pagination revalidates undisplayed batch items against live database. | Pure metadata order or alphabetical order without urgency sort. | Surfaces urgent relearning and daily review work immediately, avoiding pilot cognitive overload while maintaining deterministic paging without row loss. | **Proposed** |
| **C2-D4** | **Default Filters in "Review due"** | Default filter: **"All actionable"** (`totalDueCount > 0 \|\| newCount > 0`). Filter options:<br>- `"due_today"`: materials with `totalDueCount > 0`<br>- `"new_only"`: materials with `totalDueCount === 0 && newCount > 0`<br>- Topic filter chip selector.<br>Distinct from material metadata `reviewStatus`. | Only showing due cards; hiding new cards until manually started. | Mixed materials (having both due and new cards) match "due_today" and "all", but are excluded from "new_only". Allows pilots to focus purely on unlearned concepts. | **Proposed** |
| **C2-D5** | **Empty, Loading, & Error States** | Friendly empty card ("All caught up! No cards due for review" when candidate stream is exhausted and no issues exist). Progress continuation prompt if scan budget reached without finding actionable items. Synchronous busy lock and route generation guards. Non-blocking error banner with manual retry without replaying writes. Exposes blocked unavailable content if terminal result contains issues. | Hard blocking error dialogs or silent failure. | Carries C1 request-ownership principles forward; prevents duplicate loads, stale flashes, and race conditions during rapid navigation. | **Proposed** |
| **C2-D6** | **History Paging & Scope** | **Keyset cursor pagination** (`reviewed_at DESC, id DESC`), bounded at 20 items per page. Filters by `materialId` and `topic` executed in SQL before LIMIT. "Load more" button disabled while loading. Targeted enrichment resolves deferred provenance independently of event pagination. | Full array in React memory, or offset pagination. | Scales efficiently to 10,000+ review events; prevents row skipping or duplication across tied timestamps. | **Proposed** |
| **C2-D7** | **Separation from Practice Tests** | **Strict semantic & visual separation.** Card reviews display spaced-repetition ratings (`Again`, `Hard`, `Good`, `Easy`) and interval progression. Practice tests display test scores, percentages, and completed attempts. Explicit disclaimers on both views. | Blended composite "Study Score" or inferred FAA exam readiness score. | ROADMAP 7C explicitly forbids claiming mastery or exam readiness from card repetitions. | **Proposed** |
| **C2-D8** | **New-Card Discovery Architecture** | **Bounded Candidate Discovery with Real SQL Batching & Revalidated Keyset Continuation** (Design 1). **No additional database migrations** (shipped Schema 12 preserved). | Rebuildable cache table (Migration 0013) or persistent backfill. | Benchmarks prove p50 latency is **6.16 ms** per page at 5,000 materials on shipped schema 12, eliminating migration overhead. | **Proposed** |
| **C2-D9** | **Candidate & Session Bounds** | Candidate evaluation budget capped at **250 materials** per query; batch card work reservation at **500 cards** per set, batch card ceiling at **2,500 cards** and **2 MiB raw JSON**; single-set lane for oversize sets; individual review sessions retain C1 caps (**MAX_NEW = 10**, **MAX_TOTAL = 20**). | Uncapped global queries or unlimited session lengths. | Prevents memory exhaustion and preserves spaced-repetition pedagogical effectiveness. | **Proposed** |

---

## 2. Comparison of New-Card Discovery Architectures

C1 materializes snapshots into `card_versions` and `card_items` only upon the first mutation (rating, suspend, or flag) and derives current identity in pure code from raw saved cards in `ai_study_sets.flashcards_json`. A library-wide query cannot assume the last materialized snapshot is current, nor can it ignore unreviewed materials that have never been materialized.

We evaluated three architectural options:

| Criterion | Design 1: Bounded Discovery with Real SQL Batching (Recommended) | Design 2: Rebuildable Cache Table (Provisional Migration 0013) | Design 3: Persistent Migration Backfill |
|---|---|---|---|
| **Database Migration Required** | **NONE** (Shipped Schema 12 preserved) | **YES** (Requires Migration 0013) | **YES** (Requires Migration 0013) |
| **5,000 Materials / 10,000 Events (p50)** | **6.16 ms** (Measured in Node/SQLite) | Unmeasured theoretical prediction | Unmeasured theoretical prediction |
| **Full Discovery Traversal (92 pages)** | **257.93 ms** (Measured in Node/SQLite) | Unmeasured | Unmeasured |
| **Schema-11 Backup Restore** | Restores via shipped migration 0012 DDL; **C2 adds no further DDL upon restore** | Requires additional DDL + startup cache rebuild | Large startup mutation lock |
| **Migration & Schema Overhead** | **No additional migration**; schema version remains 12 | Requires new migration 0013 and schema bump | Heavy migration lock |
| **A -> B -> A Reversion Safety** | **Automatic & immediate** (Zero writes) | Fragile cache invalidation | Fragile cache invalidation |
| **Read-Only Invariant** | **Preserved** (*"Reads never write"*) | Mutates cache on sync | Writes on startup |
| **Desktop IPC / WebKit UI Cost** | **UNMEASURED** (Requires desktop Tauri runtime) | **UNMEASURED** | **UNMEASURED** |

### Recommendation:
We recommend **Design 1: Bounded Discovery with Real SQL Batching**.
- It requires **no additional schema migrations**, keeping `CURRENT_SCHEMA_VERSION = 12`.
- Real batched queries with SQLite preflight reduce database overhead while enforcing strict memory and card budgets.
- It honors the C1 architectural invariant: *"Reads never write."*
- An optional comparison index (`idx_materials_priority_updated`) is documented in `optional_migration_0013.sql` as an unapproved variant with distinct migration impact.

---

## 3. Concrete Read Pipeline, Batching & Ranking Architecture

### A. Real SQL Batching, Work Reservation & Preflight Byte Checks
Rather than looping unbounded queries or transferring excessive JSON strings, the read pipeline executes bounded, preflighted queries:

1. **Review Due Pipeline:**
   - **Query 1 (Candidate Headers Scan):** Selects up to `candidateBatchBudget + 1` materials (capped at 250) ordered by `CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC` using keyset continuation.
   - **Query 2 (SQLite Byte Preflight):** Selects `source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len` for candidates in the batch.
     - **Explicit Oversize Admission Check:** If `byte_len > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES` (8 MiB), the raw set is **not** transferred. Instead, an explicit issue `{ materialId, title, code: 'PAYLOAD_TOO_LARGE', rawBytes: byte_len, allowedBytes: 8388608, inspectionTarget: '/study/' + encodeURIComponent(materialId) }` is emitted in `issues`. The inspection target points directly to the registered Study route (`study/:materialId`, e.g. `/study/a`). The keyset boundary advances past this reported candidate, ensuring subsequent normal materials remain discoverable without livelock or silent drop. Metadata-only oversize candidates do not consume the single-set admission exception.
     - **Conservative Card Work Reservation:** When exact card counts are unindexed, the reader conservatively reserves `MAX_CARDS_PER_SET = 500` before querying raw JSON for any candidate (`attemptedCards += 500; rawAttempts++`).
       - If `rawAttempts > 0 && attemptedCards > maxBatchCardsBudget`, the loop stops and retains remaining candidates in continuation.
       - If parsing fails (e.g. malformed or invalid card objects), the 500-card work reservation **remains spent**, preventing repeated expensive parsing of unparseable sets under a tight budget.
       - Successful valid sets reconcile the reservation to their actual parsed count (`attemptedCards += (cards.length - 500)`).
       - Single-set admission exception allows at most one raw-work admission when `rawAttempts === 0` (for budgets smaller than 500 cards).
   - **Query 3 (Admitted Raw Cards Fetch):** Queries `flashcards_json` only for admitted candidates passing preflight and card reservation: `SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?`.
   - **Query 4 (Batched Review State):** For all derived versions with cards, reads review state rows via `SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag FROM card_items i JOIN card_review_state s ON s.item_id = i.id WHERE i.version_id IN (...)`.
2. **Recent Reviews History Pipeline:**
   - **Query 1 (Event Keyset Query):** Selects up to `limit + 1` events joined with card items, versions, and study materials, filtered by `materialId` and `topic` in SQL before LIMIT, ordered by `e.reviewed_at DESC, e.id DESC`.
   - **Query 2 (Preflight Byte Check):** Selects `source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len` for distinct material IDs on this page before reading raw JSON blobs.
   - **Query 3 (Bounded Per-Set Raw Card Fetches):** Enforces `ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES` (8 MiB) and `maxBatchRawJsonBytesBudget` (2 MiB). Oversize materials are permanently marked blocked (`contentStatus: "unavailable"`, exposing code `'PAYLOAD_TOO_LARGE'`). Budget-deferred materials are marked pending (`contentStatus: "pending"`, `isEarlierVersion: null`) without transferring megabytes.
   - **Independent History Enrichment:** Supports targeted `enrichMaterialIds` option on subsequent reads, returning explicit target-only `enrichment` records alongside unchanged paged rows and next cursor without inserting old events into a new event page.

### B. Urgency Ranking within Evaluated Batches
Within each evaluated batch of candidates:
1. **Urgency Buckets:**
   - **Bucket 0:** Urgent sub-day relearning (`againCount > 0`).
   - **Bucket 1:** Scheduled review due today (`dayCount > 0 && againCount === 0`).
   - **Bucket 2:** New unrated concepts (`totalDueCount === 0 && newCount > 0`).
   - **Bucket 3:** Other.
2. **Tie-Breaker Hierarchy:**
   - Material priority `next_up` (0) before others (1).
   - Earliest `earliestDueAt` timestamp ASC.
   - Material title ASC, then material ID ASC.
3. **Cursor Continuation with Pending Stream Revalidation:**
   When an evaluated batch produces more actionable materials than the requested `limit`, remaining candidate IDs are encoded into the continuation cursor (`remIds: [...]`). On subsequent continuation calls, the reader validates query and clock ownership (`STALE_CURSOR`), tracks evaluated vs discarded candidates (`consumedCount`), and re-queries `study_materials` and `ai_study_sets` for those IDs.
   - Deleted materials are discarded without duplicating subsequent live rows.
   - Materials whose flashcards were cleared to `[]` produce 0 due/new cards and are discarded cleanly.
   - Clock shifts across midnight re-evaluate due eligibility accurately.
   - Page-size adjustments consume the stream without item loss or duplication.
   - **Strict Cursor Schema:** validated before SQL; continuation requires `v === 1`, `type === 'due'`, `ctx`, boolean `isExhausted`, unique bounded `remIds` array $\le 250$, and complete keyset boundary `lc`, `lp`, `lu`.
   - **Priority Domain Validation:** Enforces `lp === 0 || lp === 1` matching the SQL priority domain `{0, 1}`. Rejects invalid rank values (e.g. `lp: 2`) with `INVALID_CURSOR` before SQL. Also validates canonical clock instants, topic/material bounds, and status filters (`all`, `due_today`, `new_only`).

### C. Page-Local Summaries vs. Library Cumulative Totals
- The summary returned by a single page query is explicitly defined as **page-local** (`isPageLocal: true`).
- An `isComplete: true` flag on a terminal page indicates candidate stream exhaustion, but does not convert page-local counts into whole-library totals. Cumulative totals across loaded pages are maintained exclusively by the UI state controller.
- Exposes typed work counters:
  - `scannedCandidates`: candidate rows inspected from database headers.
  - `evaluatedCandidates`: candidates whose card items were parsed and evaluated.
  - `attemptedCards`: cumulative cards reserved/attempted across raw sets (stays charged on parse failure).
  - `evaluatedCards`: valid cards successfully parsed and evaluated.
  - `rawReads`: count of raw SQLite `ai_study_sets` read operations.
  - `rawBytesTransferred`: total raw SQLite JSON bytes transferred across the wire.
  - `issues`: explicit issues for reported oversize sets (`PAYLOAD_TOO_LARGE`).

---

## 4. UI Asynchronous State Controller Contract (`DeferredReadController`)

The UI controller manages page streaming, held requests, and lifecycle events:
- **Synchronously Owned Reader Lock (`busyPromise` & `currentOp`):** Installed synchronously with a unique operation token (`Symbol('op')`) before calling the reader. If reader A synchronously throws or invalidates, catch/finally handlers clear locks only if generation and operation match. An obsolete synchronous throw from A cannot clear a newer held operation B.
- **Dedup Identity by Reader Kind:**
  - Due discovery rows are deduplicated by `materialId`.
  - History event rows are deduplicated by event `id` (preserving multiple distinct events from the same material).
- **Generation Isolation:** Every request captures `reqGen = ++this.generation`. When responses resolve or reject, results and issues are published only if `this.generation === reqGen`.
- **Publication of Issues and Summaries:**
  - Publishes typed `issues` and relevant page `summary` under exact generation/operation ownership.
  - Multi-page retention: retains earlier-page issues across pagination, deduplicated by `materialId + ':' + code`.
  - Safe Caught-Up vs. Blocked Traversal: `isCaughtUp` is true only when traversal is complete (`isComplete: true`) AND `results.length === 0 && issues.length === 0`. If a terminal page has issues, `hasBlockedContent` is true and `isCaughtUp` is false (ensuring unavailable content is exposed rather than a false "All caught up" message).
- **Authoritative Refresh Invalidation:** Calling `onReset(materialId)` clears `results = []`, `issues = []`, bumps generation, resets cursor to null, and idles loading state. The next page read starts from page 1, adopting fresh urgency ordering and eliminating surviving no-longer-actionable rows.
- **Retry Semantics:** `retryRead()` retains the exact failed request cursor without replaying writes.
- **Targeted History Enrichment Action (`enrichMaterials(targetIds)`):**
  - Callable even after event pagination is complete (`isComplete === true`).
  - Preserves event order, event IDs, and next cursor.
  - Applies target-only patches to loaded events without overwriting or downgrading untargeted rows (`b` stays `current`, `a` becomes `current`).
  - Rejects stale completions and excludes same-turn duplicate target requests.
  - Authoritative content invalidation still clears stale provenance across generations.

---

## 5. Historical Context Provenance, Inspection & Scheduler Ownership Contract

- **Content Provenance Classification:**
  - `current`: Saved cards in `ai_study_sets` hash to the version of the reviewed item (`isEarlierVersion: false`).
  - `earlier`: Saved cards exist but have a different content hash (`isEarlierVersion: true`).
  - `valid_empty`: `ai_study_sets.flashcards_json === '[]'` (guide-only set without flashcards). Distinct from missing rows.
  - `unavailable`: Study set row is missing from database, or set exceeds absolute byte ceiling.
  - `malformed`: Saved JSON format is corrupted.
  - `pending`: Deferred due to batch budget ceiling. Resolved via targeted `enrichMaterials` without re-paging event stream.
- **Independent Targeted History Enrichment:**
  - `enrichMaterialIds` queries requested materials directly and returns target-only `enrichment` records.
  - Exposes `currentVersionId` so historical events compare against their own version identity, correctly preserving retired-version meaning (`isEarlierVersion: true`) even after enrichment.
  - Applying target patches to loaded history rows preserves resolved untargeted fields within the same live generation.
  - Distinguishes temporary budget deferral from permanently oversized blocked content (exposing reason/action).
- **Scheduler Ownership & State Validation:**
  - `validateScheduleState(stateJsonStr, eventSchedulerVersion)` receives the event's actual `scheduler_version`.
  - Explicit unsupported event version yields null validated schedule/interval fields while raw audit strings remain intact.
  - Missing legacy state version may inherit only from an explicitly supported event version (`simple-v1`), never defaulting unsupported versions to `simple-v1`.
  - Rejects non-canonical calendar dates (e.g. Feb 30), negative or non-integer reps/lapses, and out-of-bounds ladder steps.
- **Read-Only Inspection Target:**
  - Clicking a history row navigates to the read-only card inspection modal or `/study/:materialId/cards` in inspection mode.
  - Historical card views are read-only; they do not trigger mutations or rewrite active versions.

---

## 6. Worst-Case Budgets, JSON Escaping & Safety Caps

- **Theoretical Worst-Case Analysis & Honest Serialization Arithmetic:**
  - C1 allows up to 500 cards per material, with up to 1,000 front code points and 2,000 back code points (3,000 code points per card).
  - In ASCII (1 byte/character): 3,000 bytes/card × 500 cards = ~1.5 MB raw JSON per study set. For 250 candidates without caps, this would transfer **~375 MB**.
  - In astral multi-byte Unicode (up to 3–4 bytes/character): up to ~11,000 bytes/card × 500 cards = ~5.5 MB raw JSON per study set (measured fixture: **5.26 MB**). For 250 candidates without caps, this would transfer **~1,375 MB (1.37 GB)**.
  - **Honest JSON Escaping Reality:** Code points alone do not bound serialized JSON length. Control characters like `\u0001` expand from 1 byte in memory to 6 serialized ASCII bytes (`\u0001`). For a valid C1 500-card set with 1,000 front and 2,000 back `\u0001` characters, `JSON.stringify` produces **9,020,501 bytes** (~8.60 MiB). Whitespace, indentation, and extra JSON properties further expand raw size.
  - This proves why preflight `LENGTH(CAST(flashcards_json AS BLOB))` checks before SQLite wire transfer and deserialization are strictly required.
- **Enforced Executable Safety Caps:**
  - `candidateBatchBudget`: 250 materials.
  - `maxBatchCardsBudget`: 2,500 cards (enforced via preflight 500-card conservative work reservation).
  - `maxBatchRawJsonBytesBudget`: 2,097,152 bytes (2 MiB).
  - `ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES`: 8,388,608 bytes (8 MiB).
  - Single-set admission lane: admits a single set (<= 8 MiB) if budget is exceeded on item 0 and no raw sets have been attempted (`rawAttempts === 0`), ensuring terminating forward progress without empty-page livelock.
- **IPC & WebKit Rendering:** Explicitly marked **UNMEASURED**. Node/SQLite in-process measurements do not establish Desktop Tauri IPC or WebKit render latency.

---

## 7. Verified Proof, Diagnostics & Gate

The complete planning proof package in `docs/evidence/m2-card-review-c2-state-publication-2026-10-07/` proves all contracts:

1. **All Seven Frozen Reviewer Diagnostics Pass Unchanged (74 / 74 total):**
   - Diagnostic 1 (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed (exit 0)**.
   - Diagnostic 2 (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed (exit 0)**.
   - Diagnostic 3 (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed (exit 0)**.
   - Diagnostic 4 (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed (exit 0)**.
   - Diagnostic 5 (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): **8 / 8 passed (exit 0)**.
   - Diagnostic 6 (`docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed (exit 0)**.
   - Diagnostic 7 (`docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs`): **7 / 7 passed (exit 0)** (promoted from 1 pass / 6 fail baseline).
2. **Comprehensive Proof Suite (`proof.test.mjs`):** **57 / 57 passed (exit 0)** across 14 test suites (Assertion 14 verifies all 6 state-publication findings).
3. **Reliable Semantic Mutation Verifier (`runMutants.mjs` & `mutantSurvivalControl.mjs`):** Shared independently held A/B fixture verifies baseline passes (exit 0) and 4 mutants are killed with `AssertionError` (exit 1). Survival control confirms verifier fails if assertions are disabled (exit 0).
4. **SQL Pipeline Audit (`query-audit.mjs`):**
   - Executed SQL calls on 5,000-material / 10,000-event fixture:
     - Due first page: **175 calls** (1 candidate header scan + 1 byte preflight + 172 raw card fetches + 1 review state batch)
     - Due continuation page: **150 calls** (revalidation of pending IDs: 1 metadata scan + 1 byte preflight + 147 raw card fetches + 1 review state batch)
     - Due status filter page (`new_only`): **177 calls** (1 candidate header scan + 1 byte preflight + 174 raw card fetches + 1 review state batch)
     - History first page: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
     - History next page: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
     - History filtered page: **22 calls** (1 event keyset scan + 1 distinct byte preflight + 20 raw card fetches)
5. **Latency Budget Status:**
   - **Review Due Page 1 p50:** **6.16 ms** at 5,000 materials (budget target: 10 ms) -> **PASS** in SQLite/Node.
   - **History Page 1 p50:** **9.81 ms** at 5,000 materials / 10,000 events (budget target: 15 ms) -> **PASS** in SQLite/Node.
   - **Desktop Tauri IPC & WebKit Rendering:** **UNMEASURED**.

---

## 8. Next Steps and Gate

Production implementation of C2 requires:
1. Independent scope acceptance of this completed proposal and evidence.
2. Owner approval of the recommended product defaults (**C2-D1 through C2-D9**).
3. Execution of the conditional implementation prompt ([`M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`](M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md)).
