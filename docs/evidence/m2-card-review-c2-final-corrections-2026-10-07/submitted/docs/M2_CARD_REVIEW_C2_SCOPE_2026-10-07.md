# M2-4 / Card Reviews C2 — Library-Wide Review Due and History Scope Proposal (7 October 2026)

> [!IMPORTANT]
> **PROPOSED PLANNING SCOPE — REQUIRES OWNER APPROVAL BEFORE IMPLEMENTATION.**
> This document specifies the complete, verified product and architectural design for Milestone 2, Card Review C2 (Library-Wide Review Due and History Discovery). All recommended defaults (**C2-D1 through C2-D9**) are **PROPOSED** pending independent scope acceptance and recorded owner choice.
> Production C2 implementation is not activated until owner approval is recorded.

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
| **C2-D3** | **Default Ordering in "Review due"** | **Urgency-first bucket ranking within candidate batches:**<br>1. Materials with due Again cards (step -1)<br>2. Materials with due Day cards (step >= 0)<br>3. Materials with only New cards.<br>Tie-break by `next_up` priority, earliest due instant, title ASC, ID ASC. Bounded pagination preserves undisplayed batch items. | Pure metadata order or alphabetical order without urgency sort. | Surfaces urgent relearning and daily review work immediately, avoiding pilot cognitive overload while maintaining deterministic paging without row loss. | **Proposed** |
| **C2-D4** | **Default Filters in "Review due"** | Default filter: **"All actionable"** (`totalDueCount > 0 \|\| newCount > 0`). Filter options:<br>- `"due_today"`: materials with `totalDueCount > 0`<br>- `"new_only"`: materials with `totalDueCount === 0 && newCount > 0`<br>- Topic filter chip selector. | Only showing due cards; hiding new cards until manually started. | Mixed materials (having both due and new cards) match "due_today" and "all", but are excluded from "new_only". Allows pilots to focus purely on unlearned concepts. | **Proposed** |
| **C2-D5** | **Empty, Loading, & Error States** | Friendly empty card ("All caught up! No cards due for review" when candidate stream is exhausted). Progressive continuation prompt if scan budget reached without finding actionable items. Synchronous busy lock and route epoch guards. Non-blocking error banner with manual retry without replaying writes. | Hard blocking error dialogs or silent failure. | Carries C1 request-ownership principles forward; prevents duplicate loads, stale flashes, and race conditions during rapid navigation. | **Proposed** |
| **C2-D6** | **History Paging & Scope** | **Keyset cursor pagination** (`reviewed_at DESC, id DESC`), bounded at 20 items per page. "Load more" button disabled while loading. | Full array in React memory, or offset pagination. | Scales efficiently to 10,000+ review events; prevents row skipping or duplication across tied timestamps. | **Proposed** |
| **C2-D7** | **Separation from Practice Tests** | **Strict semantic & visual separation.** Card reviews display spaced-repetition ratings (`Again`, `Hard`, `Good`, `Easy`) and interval progression. Practice tests display test scores, percentages, and completed attempts. Explicit disclaimers on both views. | Blended composite "Study Score" or inferred FAA exam readiness score. | ROADMAP 7C explicitly forbids claiming mastery or exam readiness from card repetitions. | **Proposed** |
| **C2-D8** | **New-Card Discovery Architecture** | **Bounded Candidate Discovery with Real SQL Batching & Keyset Continuation** (Design 1). **Zero database migrations** (Schema 12 preserved). | Rebuildable cache table (Migration 0013) or persistent backfill. | Benchmarks prove p50 latency is **7.93 ms** per page at 5,000 materials on shipped schema 12, eliminating upgrade risk and backup incompatibilities. | **Proposed** |
| **C2-D9** | **Candidate & Session Bounds** | Candidate evaluation budget capped at **250 materials** per query; individual review sessions retain C1 caps (**MAX_NEW = 10**, **MAX_TOTAL = 20**). | Uncapped global queries or unlimited session lengths. | Prevents memory exhaustion and preserves spaced-repetition pedagogical effectiveness. | **Proposed** |

---

## 2. Comparison of New-Card Discovery Architectures

C1 materializes snapshots into `card_versions` and `card_items` only upon the first mutation (rating, suspend, or flag) and derives current identity in pure code from raw saved cards in `ai_study_sets.flashcards_json`. A library-wide query cannot assume the last materialized snapshot is current, nor can it ignore unreviewed materials that have never been materialized.

We evaluated three architectural options:

| Criterion | Design 1: Bounded Discovery with Real SQL Batching (Recommended) | Design 2: Rebuildable Cache Table (Provisional Migration 0013) | Design 3: Persistent Migration Backfill |
|---|---|---|---|
| **Database Migration Required** | **NONE** (Schema 12 preserved) | **YES** (Requires Migration 0013) | **YES** (Requires Migration 0013) |
| **5,000 Materials / 10,000 Events (p50)** | **7.93 ms** (Measured in Node/SQLite) | Estimated ~2–4 ms | Estimated ~2 ms |
| **Full Discovery Traversal (90 pages)** | **143.88 ms** (Measured in Node/SQLite) | Single read | Single read |
| **Schema-11 Backup Restore** | **Clean read-only; no DDL or writes required** | Requires DDL + sync hook | Large startup mutation lock |
| **Upgrade / Client Risk** | **Zero** (Pure logic & queries) | Schema bump + migration | Backup ceiling barrier |
| **A -> B -> A Reversion Safety** | **Automatic & immediate** (Zero writes) | Fragile cache invalidation | Fragile cache invalidation |
| **Read-Only Invariant** | **Preserved** (*"Reads never write"*) | Mutates cache on sync | Writes on startup |
| **Desktop IPC / WebKit UI Cost** | **Unmeasured** (Node micro-benchmarks) | **Unmeasured** | **Unmeasured** |

### Recommendation:
We recommend **Design 1: Bounded Discovery with Real SQL Batching**.
- It requires **zero schema migrations**, keeping `CURRENT_SCHEMA_VERSION = 12`.
- Real batched queries reduce database calls to **3 calls** for due discovery and **2 calls** for history.
- It completely eliminates migration risk for desktop macOS and prospective iOS clients.
- It honors the C1 architectural invariant: *"Reads never write."*
- An optional comparison index (`idx_materials_priority_updated`) is documented in `optional_migration_0013.sql` as an unapproved variant with distinct migration impact.

---

## 3. Concrete Read Pipeline, Batching & Ranking Architecture

### A. Real SQL Batching
Rather than looping individual `.get()` queries per candidate or distinct material (which produced 124 SQL calls for due and 21 for history in earlier prototypes), the final read pipeline executes bounded batched queries:

1. **Review Due Pipeline (3 SQL Calls Total):**
   - **Query 1 (Candidate Headers Scan):** Selects up to `candidateBatchBudget + 1` materials (capped at 250) ordered by `(priority = 'next_up' ASC, updated_at DESC, id ASC)` using keyset continuation.
   - **Query 2 (Batched Raw Cards):** Reads `ai_study_sets.flashcards_json` for all candidates in the batch via `WHERE source_material_id IN (?, ..., ?)`.
   - **Query 3 (Batched Review State):** For all derived versions with cards, reads review state rows via `SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag FROM card_items i JOIN card_review_state s ON s.item_id = i.id WHERE i.version_id IN (?, ..., ?)`.
2. **Recent Reviews History Pipeline (2 SQL Calls Total):**
   - **Query 1 (Event Keyset Query):** Selects up to `limit + 1` events joined with card items, versions, and study materials, ordered by `e.reviewed_at DESC, e.id DESC`.
   - **Query 2 (Batched Distinct Raw Cards):** Reads raw flashcards for all distinct materials on the page via `WHERE source_material_id IN (?, ..., ?)`.

### B. Urgency Ranking within Evaluated Batches
Within each evaluated batch of candidates:
1. **Urgency Buckets:**
   - **Bucket 0:** Urgent sub-day relearning (`againCount > 0`).
   - **Bucket 1:** Scheduled review due today (`dayCount > 0 && againCount === 0`).
   - **Bucket 2:** New unrated concepts (`totalDueCount === 0 && newCount > 0`).
   - **Bucket 3:** Other.
2. **Tie-Breaker Hierarchy:**
   - Material priority `next_up` (0) before others (1).
   - Earliest `nextDueAt` timestamp ASC.
   - Title ASC, then ID ASC.
3. **Cursor Continuation Without Undisplayed Item Loss:**
   When the number of actionable materials in an evaluated batch exceeds the requested page `limit`, the leftover actionable summaries are encoded directly into the continuation cursor (`rem: [...]`). Subsequent requests serve remaining items immediately without repeating database scans or losing items. Once `rem` is exhausted, continuation proceeds to the next candidate batch from the last scanned material.

### C. Page-Local Summaries vs. Library Cumulative Totals
- The summary returned by a single page query is explicitly defined as **page-local** (`isPageLocal: true`).
- An `isComplete: true` flag on a terminal page indicates stream exhaustion (caught up), but does not convert page-local counts into whole-library totals. Cumulative totals across pages are maintained exclusively by the UI state controller.

---

## 4. UI Asynchronous State Controller Contract (`DeferredReadController`)

The UI controller manages page streaming, held requests, and lifecycle events:
- **Synchronous Busy Lock (`busyPromise`):** Excludes two same-turn activations from running duplicate reads. Terminal page exhaustion blocks repeat loading.
- **Generation Isolation:** Every request captures `reqGen = ++this.generation`. When responses resolve or reject, results are published only if `this.generation === reqGen`.
- **Synchronous Filter Invalidation:** Calling `setFilter(newFilter)` immediately clears `this.results = []`, resets the pagination cursor, and bumps generation. Old rows from a previous filter never survive.
- **Authoritative Reads Following Mutations:** When a card rating, reset, or deletion occurs, the controller clears the target material, resets pagination, and initiates a fresh authoritative read.
- **Retry Semantics:** `retryRead()` retains the exact failed request cursor without replaying writes.

---

## 5. Verified Proof, Benchmarks & Latency Budget Status

The complete planning proof package in `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/` proves all contracts:

1. **Both Frozen Reviewer Diagnostics Pass Unchanged:**
   - Prior diagnostic (`scratch/diagnostic.test.mjs`): **9 / 9 passed (exit 0)**.
   - New diagnostic (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed (exit 0)**.
2. **Comprehensive Proof Suite (`proof.test.mjs`):** **21 / 21 passed (exit 0)** across 6 test suites, including held read promises, file-backed DB close/reopen, and schema-11 upgrade without backfill.
3. **SQL Call Audit (`query-audit.mjs`):** Confirms **3 SQL calls** (due) and **2 SQL calls** (history) on a 5,000-material / 10,000-event fixture.
4. **Latency Budget Status:**
   - **Review Due Page 1 p50:** **7.93 ms** (budget target: 10 ms) -> **PASS** in SQLite/Node.
   - **History Page 1 p50:** **9.72 ms** (budget target: 15 ms) -> **PASS** in SQLite/Node.
   - **Adversarial 500-Card Set Parse & Hash p50:** **0.56 ms** (budget target: 5 ms) -> **PASS**.
   - **Desktop Tauri IPC & WebKit Webview Rendering:** **UNMEASURED** (pending production UI integration).

---

## 6. Next Steps and Gate

Production implementation of C2 requires:
1. Independent scope acceptance of this completed proposal and evidence.
2. Owner approval of the recommended product defaults (**C2-D1 through C2-D9**).
3. Execution of the conditional implementation prompt ([`docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`](M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md)).
