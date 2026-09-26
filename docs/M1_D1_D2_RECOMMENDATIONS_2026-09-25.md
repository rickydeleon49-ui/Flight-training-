# M1 D1–D2 — Daily Flight Plan recommendations and debrief characterization

Date: 25 September 2026
Repository: `H:\Ai Repo clones\Flight-training-`
Branch: `feature/m1-d1-d2-recommendations`
Baseline HEAD: `193d3e138a288ea63fc7e64668982842b997d068`

## 1. Overview and Scope

This document provides architectural documentation and validation evidence for M1 issues **D1** (debrief behavior characterization) and **D2** (pure recommendation selector) under the [ROADMAP.md](../ROADMAP.md) Daily Training Loop milestone.

**Status:** Implemented; awaiting independent review/merge. (Preceding milestone D0 merged through PR #31 at `193d3e1`).

**Explicit Scope Boundaries:**
- **D1 and D2 only.**
- **D3 UI** (Flight Deck suggestions UI, available-minutes control, Start/Why/Skip/Defer) is **not implemented** in this increment.
- **D4 persistence** (per-day session decisions, skip today vs defer) is **not implemented** in this increment.
- **D5 quick debrief mode** and **D6 link connections** are **not implemented** in this increment.
- No schema migrations, no new dependencies, no Rust modifications, no AI coaching.

---

## 2. D1: Current Link Behavior, Repository Tracing, and Future D6 Gaps

Characterized through real SQLite persistence against disk in [`src/logic/debriefCharacterization.test.ts`](../src/logic/debriefCharacterization.test.ts).

### Debrief Creation Workflow
1. A flight lesson exists on the schedule (`schedule_events`).
2. Completing a lesson generates a debrief journal entry (`journal_entries`) with flight times, landings, mission, strengths, difficulties, instructor feedback, questions for next time, and confidence.
3. Debrief actions created from the form (`next_actions`) store `relatedType = "journal"` and `relatedId = journalEntry.id`.
4. Debrief questions created from the form (`questions`) store `journalId = journalEntry.id`. Crucially, `eventId` is initialized to `null`.

### Persistence Across Disk Reloads
Closing and reopening the database connection on an actual SQLite disk file (`PRAGMA foreign_keys = ON`) verifies:
- Journal records, debrief actions, and debrief questions are preserved.
- User edits to fields (e.g., confidence, instructor feedback, action priority, due date, estimated minutes, question answer, question status) persist without link loss.

### Deletion and Link Integrity
- **Questions:** The `questions` table schema enforces `FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE SET NULL`. Deleting a journal entry automatically sets `journal_id = NULL` on the question.
- **Actions:** The `next_actions` table defines `related_id TEXT` as a polymorphic identifier without foreign key enforcement. When a journal entry is deleted, `related_id` survives as a **dangling reference** (a stored identifier pointing to a non-existent record).

### Tracing and Future D6 Gaps
1. **Debrief Questions $\leftrightarrow$ Upcoming Flight Lesson:** In [`src/logic/preparation.ts`](../src/logic/preparation.ts), `lessonPreparation` only selects questions where `q.eventId === event.id`. Because debrief questions have `eventId = null`, they are omitted from upcoming lesson preparation lines until explicitly associated. (In [`src/logic/dashboard.ts`](../src/logic/dashboard.ts), `unansweredBeforeLesson` includes questions where `q.eventId === upcoming.id || q.eventId === null`, so they appear on the dashboard overview, but not in lesson-specific prep).
2. **Debrief Actions $\leftrightarrow$ Study Library Materials:** Actions created from debriefs only link to the journal entry (`relatedType: "journal"`). There is no existing schema association linking an action to a `study_material` ID. Connecting improvement $\rightarrow$ action $\rightarrow$ material is future D6 work.
3. **Dashboard Linking:** `dashboard.ts` places debrief actions in `planGroups` under category `"prepare"`, but does not link them to `nextFlight`, `currentMilestone`, or `studyFocus` because `relatedAction` only resolves `"goal"` and `"material"`.

---

## 3. D2: Pure Recommendation Selector

Implemented in [`src/logic/recommendations.ts`](../src/logic/recommendations.ts) and tested in [`src/logic/recommendations.test.ts`](../src/logic/recommendations.test.ts).

### Purity Guarantees
- Zero database writes or side effects.
- Zero silent action acceptance or status modifications.
- Zero flight skill proficiency mutations.
- Pure input immutability: candidates and sources are not mutated.
- Clock independence: no implicit `new Date()` or `Date.now()` calls. The explicit reference date (`sources.today` or `options.today`) is used throughout candidate transformation and recommendation selection.

### Precedence Hierarchy
Candidates are sorted deterministically according to strict priority tiers:
1. **Tier 1 — `pinned`:** User-pinned work (pinned notes, pinned actions).
2. **Tier 2 — `due_action`:** Open actions with genuine due dates (overdue actions first, oldest overdue first; then actions due today).
3. **Tier 3 — `lesson_prep`:** Next-lesson preparation for the upcoming flight lesson (prep checklist items by position, then questions scheduled for the lesson).
4. **Tier 4 — `study`:** Study materials needing review (`reviewStatus === "needs_review"`), followed by active study materials (`"studying"`), followed by general debrief/instructor questions.
5. **Tier 5 — `open_action`:** Open next actions ordered by priority weight (`next_up` $>$ `important` $>$ `later`).

### Deterministic Tie-Breaking
When candidates share precedence tier, due dates, sub-rank, and priority weights, ties are broken strictly by:
1. `title.localeCompare(b.title)` (alphabetical).
2. `id.localeCompare(b.id)` (lexicographical unique ID).
Identical inputs and date yield identical ordering on every evaluation.

### Duration Policy and Time Budgets (10, 20, 30 min)
- **Zero Duration Fabrication:** Tasks lacking an estimated duration (`estimatedMinutes: null`, such as notes, checklist items, questions, and unestimated actions) are **never** assigned an invented duration and are **never** treated as zero minutes.
- **Reachable by Priority:** High-priority work lacking estimates (e.g. pinned notes, due actions without estimates) is not excluded from recommendations. In a timed session, it is suggested in its natural precedence order up to `maxItems`, displaying an explicitly unknown duration (`Duration unknown (included by priority; not counted in X-min timed allocation)`).
- **Allocated Minutes Accounting:** `totalEstimatedMinutes` and `allocatedMinutes` strictly sum only items with known duration. `suggestedUnestimatedCount` explicitly records how many suggested items have unknown durations.
- **Estimates for Timed Items Only in Mixed Sessions:** When any suggested item has an unknown duration (`suggestedUnestimatedCount > 0`), the selector describes known allocations explicitly as estimates for timed items only (e.g. `X min estimated for timed item (Y of Z min allocated; total duration indeterminate)`). It does **not** claim a guaranteed session fit or actual remaining session time.
- **Two-Pass Placement and Ordering Independence:** The selector determines candidate placement in a first pass and formats explanations in a second pass. As a result, whether an unknown-duration item appears before or after a known-duration item in the sorted candidate list, previously evaluated candidates receive accurate explanations reflecting the presence of unestimated work.
- **Guaranteed Complete Fit Only for All-Estimated Sessions:** Only when all suggested items have known estimates (`suggestedUnestimatedCount === 0`) does the selector claim full session fit (`Fits X-min session (Y min, Z min remaining)`) and set `fitsBudgetCompletely = true`.
- **Candidate Overflow:** Tasks whose known duration exceeds the remaining timed allocation are placed in `remaining` with an explanation disclosing the minutes required vs remaining timed allocation (`Exceeds remaining timed allocation (X min vs Y min left)`).

### Source ID Validation and Dangling Reference Defense
- Every recommendation reason includes `sourceType` and `sourceId`.
- `isSourceIdValid` verifies that the `sourceId` exists in the provided domain sources.
- Deletion and unlinked source behavior:
  - **Actions with deleted journal entries:** Because `next_actions.related_id` is an unconstrained `TEXT` column without foreign keys, deleting a journal entry leaves `related_id` as a dangling identifier. When this action is evaluated, `buildRecommendationCandidates` detects that the parent journal entry does not exist in `sources.journalEntries`, and gracefully falls back to `sourceType: "action"` and `sourceId: action.id` with summary `"Action from flight debrief (source entry unavailable)"`.
  - **Persisted questions with deleted journal entries:** Under SQLite foreign keys, deleting a journal entry automatically sets `questions.journal_id = NULL` via `ON DELETE SET NULL`. The question persists cleanly as a general question with `sourceType: "question"` and `sourceId: question.id` (using the question's own ID, not an action ID).
  - **Synthetic / stale in-memory questions:** If a question object containing a stale, non-existent `journalId` is passed directly to the pure selector (such as in an in-memory test fixture or cached snapshot), `buildRecommendationCandidates` checks `journalExists`, finds it missing, and safely falls back to `sourceType: "question"` and `sourceId: question.id` (using the question's own ID, never an action ID) with summary `"Question from flight debrief (source entry unavailable)"`.

---

## 4. Known Limitations

1. **Flight Deck UI Integration:** The new selector is not yet wired to `src/pages/FlightDeck/FlightDeck.tsx`. Flight Deck currently continues to render the existing unbudgeted `dashboard.planGroups`.
2. **Per-Day Session State:** Dismissals, skips, and session locks are not yet persisted to local SQLite (D4).
3. **Missing Foreign Keys on Actions:** `next_actions.related_id` remains an unconstrained string column; deleting a referenced journal or goal leaves a dangling reference in the database.
4. **Debrief to Next Lesson Association:** Creating a question in the debrief does not automatically schedule it for the next flight lesson; the student or instructor must attach it manually.

---

## 5. Validation Evidence

### Focused D1 & D2 Test Suite
Command:
```bash
npx vitest run src/logic/debriefCharacterization.test.ts src/logic/recommendations.test.ts
```
Result:
- **Test Files:** 2 passed (2 total)
- **Tests:** 22 passed (22 total, 0 failed, 0 skipped)

#### Breakdown of Passed Tests:
- `src/logic/debriefCharacterization.test.ts` (4 tests):
  1. `creates debrief action and question and preserves links across normal user edits`
  2. `reloads from persistent SQLite database on disk and verifies all IDs, fields, user edits, and links survive`
  3. `characterizes deletion: demonstrates foreign key ON DELETE SET NULL on question and dangling reference on action`
  4. `traces debrief interactions with actions.ts, preparation.ts, and dashboard.ts, documenting missing D6 links`
- `src/logic/recommendations.test.ts` (18 tests):
  1. `Candidate sets & empty set handling > handles an empty candidate set cleanly`
  2. `Candidate sets & empty set handling > handles 3-item candidate sets within maxItems`
  3. `Candidate sets & empty set handling > handles 20-item candidate sets without dropping unfinished work`
  4. `Precedence & Overdue sorting > orders user-pinned work and due actions before lesson prep and study`
  5. `Precedence & Overdue sorting > prioritizes overdue tasks over tasks due today, and orders older overdue tasks first`
  6. `Time Budgets (10, 20, 30 min) and Unknown Estimates > handles an all-unknown candidate set without producing an empty session`
  7. `Time Budgets (10, 20, 30 min) and Unknown Estimates > respects a 10-minute budget with mixed known and unknown duration candidates`
  8. `Time Budgets (10, 20, 30 min) and Unknown Estimates > mixed session regression (unknown before known): formats timed item as estimate without claiming full fit`
  9. `Time Budgets (10, 20, 30 min) and Unknown Estimates > mixed session regression (known before unknown): previously generated explanations remain accurate`
  10. `Time Budgets (10, 20, 30 min) and Unknown Estimates > respects a 20-minute budget combining tasks that fit`
  11. `Time Budgets (10, 20, 30 min) and Unknown Estimates > respects a 30-minute budget and marks complete fit when all suggested tasks are estimated`
  12. `Stable tie-breaking & Determinism > breaks ties deterministically by title and unique ID`
  13. `Stable tie-breaking & Determinism > yields identical ordering and explanations for identical inputs and date`
  14. `Unavailable Sources & Source ID Validity > validates that all displayed reasons reference real source IDs even when sources are archived`
  15. `Debrief-created actions and questions > preserves both debrief-created actions and debrief questions without loss or duplication`
  16. `Purity, Date handling, and Category Uniqueness > never mutates input candidates or options`
  17. `Purity, Date handling, and Category Uniqueness > does not read the clock implicitly: changing reference today shifts overdue status deterministically`
  18. `Purity, Date handling, and Category Uniqueness > ensures no single source entity appears twice across different recommendation categories`
