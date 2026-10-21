# HOMEWORK-01: assignment and evidence proposal — 21 October 2026

Status: HW-01a, awaiting owner decisions and Claude's review. This document proposes migration 0020; it does not register or ship it. Recheck that number before HW-01b.
Contract: [HOMEWORK-01](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md#homework-01--one-place-for-assigned-and-self-directed-study), the HOMEWORK-01 roadmap row, and PRODUCT_SPEC.md.

## Her outcome

She can keep assigned and self-directed study together in Homework inside Study Library, even before she chooses a school or instructor.
An assignment can say: “Before Saturday: read chapter 6 pages 4–12; review the linked cards; take the linked quiz; write two questions.”
She can follow the sources offline, see what she actually finished, and return to unfinished work without losing earlier effort.
Today's Flight Plan explains why that homework matters and takes her back to the assignment.

## Domain and existing foundations

- Assignment and activity IDs are fresh UUIDs, stable across edits, reordering and reopening; an activity belongs to exactly one assignment. IDs are never reused or moved between assignments. Order is a zero-based position among non-removed activities; order guides presentation, not a prerequisite lock.
- Assignment `revision` advances for every aggregate operation; activity `revision` versions its completion specification (kind/body/target), while `cycle` advances on reopening or specification changes. Presentation-only title/order edits and assignment date edits advance the aggregate revision without changing the activity specification revision. State transitions are protected by aggregate revision + cycle, not by clocks alone.
- Both have `upcoming`, `in_progress`, `completed`, `reopened` states. Upcoming means no deliberate start, irrespective of due date; overdue is a separate date label. Start changes upcoming/reopened to in progress. Completion records evidence; reopening clears the current completion stamp, increments the activity cycle and retains every earlier completion.
- Assignment state summarizes its non-removed activities: all completed means completed; otherwise any started/completed activity means in progress, or upcoming if none. Explicit reopening records reopened until the next start/completion. An empty assignment never completes automatically. Reopening a completed assignment must select at least one activity to reopen; assignment completion has its own history entry, separate from activity evidence.
- A title is required. Instructions, civil due date, school name, instructor name and lesson are optional. School/instructor are local text, matching existing profile/event conventions, with no enrollment/account dependency. Zero activities and activities awaiting a source are valid drafts; material-free reflection/questions/checklist work is fully usable.
- Six kinds: `read`, `cards`, `test`, `reflection`, `questions`, `checklist`. Each can optionally reference a material; read/cards/test require a verified target before Start or completion. Reflection/questions/checklist can remain unlinked.
- A reading target stores material UUID + inspected PDF SHA-256 + physical page range (inclusive, 1-based); printed labels are display-only. Use `navigationRepository`, `material_content_identities`, bookmarks and the existing navigation controller; a bookmark/open/read-state callback never completes homework.
- Cards store material UUID + the exact derived version ID/content hash from `deriveCurrentCards` (`src/logic/cardIdentity.ts`). No title/timestamp matching, and no required FK to `card_versions`: snapshots exist only after a first rating. Tests store material UUID + `practice_test_versions.id` + content hash, never “whichever quiz is current.”
- Reuse `actionRepository.ts`, `actions.ts`, `recommendations.ts`, `dailyPlan.ts`, and `preparation.ts`; [HUB-04/07](STUDY_HUB_ROADMAP_2026-10-17.md) require explainable, editable study/preparation and deliberate instructor-content use. Practice attempts already have version/status/start/revision; card reviews have per-item events, generation barriers and receipts, but **no durable session entity**. The homework run below supplies attribution, not another card scheduler.

## Proposed additive migration 0020 (SQL for review only)

New tables only; migrations 0001–0019 remain byte-identical. UUID/timestamp/hash/JSON semantics are also enforced by both validators below. SQL CHECKs reject NULL ambiguities explicitly; integer fields require SQLite integer storage. Existing external tables and delete triggers remain unchanged.

```sql
CREATE TABLE homework_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instructions TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 20000),
  school TEXT CHECK (school IS NULL OR length(school) <= 200),
  instructor TEXT CHECK (instructor IS NULL OR length(instructor) <= 200),
  lesson_id TEXT REFERENCES schedule_events(id) ON DELETE SET NULL,
  source_lesson_id TEXT,
  due_date TEXT CHECK (due_date IS NULL OR (length(due_date)=10 AND date(due_date,'+0 days') IS due_date)),
  state TEXT NOT NULL CHECK (state IN ('upcoming','in_progress','completed','reopened')),
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  action_id TEXT UNIQUE REFERENCES next_actions(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  CHECK (lesson_id IS NULL OR lesson_id IS source_lesson_id),
  CHECK ((state='completed') = (completed_at IS NOT NULL))
);
CREATE TABLE homework_activities (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (typeof(position)='integer' AND position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('read','cards','test','reflection','questions','checklist')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_material_id TEXT,
  source_revision TEXT CHECK (source_revision IS NULL OR (length(source_revision)=64 AND source_revision NOT GLOB '*[^0-9a-f]*')),
  card_set_id TEXT, test_version_id TEXT REFERENCES practice_test_versions(id) ON DELETE SET NULL,
  source_test_version_id TEXT,
  page_start INTEGER CHECK (page_start IS NULL OR (typeof(page_start)='integer' AND page_start >= 1)),
  page_end INTEGER CHECK (page_end IS NULL OR (typeof(page_end)='integer' AND page_end >= 1)),
  state TEXT NOT NULL CHECK (state IN ('upcoming','in_progress','completed','reopened')),
  cycle INTEGER NOT NULL CHECK (typeof(cycle)='integer' AND cycle >= 1),
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, removed_at TEXT,
  CHECK (material_id IS NULL OR material_id IS source_material_id),
  CHECK (test_version_id IS NULL OR test_version_id IS source_test_version_id),
  CHECK ((page_start IS NULL) = (page_end IS NULL)),
  CHECK (page_start IS NULL OR (kind='read' AND page_end >= page_start)),
  CHECK (card_set_id IS NULL OR kind='cards'),
  CHECK (source_test_version_id IS NULL OR kind='test'),
  CHECK ((state='completed') = (completed_at IS NOT NULL))
);
CREATE TABLE homework_runs (
  id TEXT PRIMARY KEY NOT NULL,
  activity_id TEXT NOT NULL REFERENCES homework_activities(id) ON DELETE RESTRICT,
  cycle INTEGER NOT NULL CHECK (typeof(cycle)='integer' AND cycle >= 1),
  activity_revision INTEGER NOT NULL CHECK (typeof(activity_revision)='integer' AND activity_revision >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('cards','test')),
  scope_json TEXT NOT NULL, evidence_json TEXT,
  attempt_id TEXT UNIQUE REFERENCES practice_attempts(id) ON DELETE SET NULL,
  source_attempt_id TEXT UNIQUE,
  started_at TEXT NOT NULL, finished_at TEXT, invalidated_at TEXT,
  CHECK (attempt_id IS NULL OR attempt_id IS source_attempt_id),
  CHECK ((kind='test') = (source_attempt_id IS NOT NULL)),
  CHECK ((finished_at IS NOT NULL) = (evidence_json IS NOT NULL))
);
CREATE UNIQUE INDEX idx_homework_run_open ON homework_runs(activity_id)
  WHERE finished_at IS NULL AND invalidated_at IS NULL;
CREATE TABLE homework_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL, applied_at TEXT NOT NULL,
  CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE homework_history (
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  operation_id TEXT NOT NULL UNIQUE REFERENCES homework_operations(operation_id) ON DELETE RESTRICT,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('create','edit','start','record_evidence','complete','reopen','reorder','remove_activity','relink','archive')),
  snapshot_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, revision)
);
CREATE TRIGGER homework_history_no_update BEFORE UPDATE ON homework_history
BEGIN SELECT RAISE(ABORT,'Homework history is append-only'); END;
CREATE TRIGGER homework_history_no_delete BEFORE DELETE ON homework_history
BEGIN SELECT RAISE(ABORT,'Homework history is append-only'); END;
CREATE UNIQUE INDEX idx_homework_activity_order ON homework_activities(assignment_id,position) WHERE removed_at IS NULL;
CREATE INDEX idx_homework_due ON homework_assignments(archived,state,due_date,id);
CREATE INDEX idx_homework_lesson ON homework_assignments(lesson_id);
CREATE INDEX idx_homework_material ON homework_activities(material_id);
CREATE INDEX idx_homework_test ON homework_activities(test_version_id);
CREATE INDEX idx_homework_operations_assignment ON homework_operations(assignment_id);
```

Assignments own activities; RESTRICT and soft removal/archive prevent losing history through ordinary deletes. History's primary key orders all aggregate changes; its snapshot is the **after** state of the assignment, every activity (including removed ones), and runs/evidence, with codec version 1. Initial revision 1 records creation. Subsequent snapshots retain prior instructions, due dates, ordering, responses and completions without rewriting earlier records.
Live material/test/lesson/attempt FKs use SET NULL. Their `source_*` identities and captured revision/title facts in history/run scope are deliberately not foreign keys: external deletion cannot cascade into homework. `source_lesson_id` is set when linking, before deletion; relink records both old and new facts. Card set IDs are derived, not a new content store. Indexes support ordered editor loads, due filters, preparation, source repair and receipt reads; the open-run index prevents simultaneous starts for one activity.
FK nullification is availability bookkeeping, not an authored edit: comparisons with the latest snapshot permit a live pointer to become NULL while requiring its retained source identity to stay exact. They never rewrite the snapshot or automatically clear a past completion. Repair is a new authored revision.
The action FK allows at most one bound Next Action per assignment, with no polymorphic `related_type` extension. Removing that action clears its live link; the next deliberate plan operation can recreate it atomically, retaining the assignment history. No automatic write on read.
The shared codec additionally requires canonical UTC millisecond timestamps, valid UUIDs (derived card IDs are 64 hex), Unicode scalar text without NUL, code-point limits above and UTF-8 bytes ≤4× those limits. Max 100 non-removed activities per assignment; each request/snapshot ≤1 MiB before parsing; no silent truncation. Validate real civil dates in both runtimes.
Validate kind-specific fields, paired target identity/hash, page bounds against the inspected revision, test ownership/content hash, card ID derivation, source/live equality, aggregate states, contiguous revision history, receipt canonical bytes/hash/result and run attribution. Detached identities are valid missing sources, not broken required FKs. Snapshot/run JSON uses exact versioned keys; arbitrary filesystem paths, credentials and provider payloads are forbidden. SQL alone cannot validate these cross-table facts.

## Completion evidence and ownership

| Kind | What completes this activity in its current cycle |
| --- | --- |
| Read page range | Her explicit “Mark reading complete” for the saved range/revision; snapshot includes range and confirmation time. Merely opening the PDF or its read confirmation is insufficient. |
| Review card set | A nonempty homework-bound session started after activity creation, on the exact linked set. Freeze the existing bounded due/new queue (≤20 items), generation and item IDs at Start. Every selected item must have one persisted rating in that run after Start; all ratings, including Again, count as participation. One tap/reveal or a partial queue does not complete it. |
| Take practice test | Its bound attempt on the linked immutable version reaches `completed`, with `started_at > activity.created_at` and start in the current cycle. Abandoned/in-progress attempts and attempts started before assignment activity creation never count. No pass-score requirement in this release. |
| Write reflection | Explicit “Mark reflection complete” after saving nonblank reflection text in `body`; frozen text/time retained as evidence. Opening the editor or autosaving alone is insufficient. |
| Prepare instructor questions | Explicit completion after saving ≥1 nonblank question in `body` (one per line); the count/text/time are retained. Preparing does not mean asked/answered. No automatic Questions record or lesson-prep duplicate is created. |
| Manual checklist | Explicit checkbox confirmation with activity ID, revision, cycle and timestamp; it may have no material. |

`homework_runs.scope_json` freezes codec version, material ID, source hash, card version + queue + generation or test version + attempt ID, and activity revision/cycle. Card evidence lists rating-event IDs, operation IDs, item IDs, generations and rating instants; test evidence freezes attempt ID/version/start/finish and recorded score/counts. Manual evidence lives in the completion history snapshot. No copied PDF/card/test answer text is needed.
Start creates a run and the specific practice attempt in the **same transaction**, or freezes the card queue; it never adopts an existing unrelated attempt. An existing in-progress practice attempt must first be finished/abandoned through its existing controls. Card rating operations gain an optional validated homework-run context; record the underlying rating and its run evidence atomically. Rating the same cards elsewhere remains ordinary review and cannot complete homework.
For a partial card run, each accepted rating appends `record_evidence` history containing the accumulated run/event associations; `evidence_json` remains NULL until the full queue finishes. Restart reads those durable associations, never infers membership from timestamps alone. At completion freeze their aggregate in `evidence_json`; later event deletion cannot remove it. Validators cross-check live events when present and the accepted historical associations when detached.
Completion reloads persisted attempt/events and validates the exact run, activity revision, cycle, generation and frozen source in the transaction; callbacks are notification only. A non-advancing/backward clock cannot satisfy the strict after-creation/start comparison; report that the session cannot yet be started rather than invent time. Reopen/target or task-text edits invalidate pending runs and advance cycle; reorder/title-only presentation changes and due-date changes preserve evidence eligibility. Each operation still compares the latest aggregate revision.
Assignment completion is a separate aggregate fact when all retained activities complete, never a test score. Card recall scheduling remains owned by card reviews; quiz scores remain attempt outcomes. Neither homework completion nor a high score establishes proficiency or readiness to fly. History is retained even if original card events/attempts later disappear; show “Source missing” on the evidence, with captured facts clearly labeled historical.

## One daily-plan and next-action contract (HW-01d)

Homework owns task wording, due date and completion; the shared action system owns the sole planner representation. Each nonempty assignment maps to one persisted `next_actions` row, not an action per activity plus another recommendation. Atomically project the next ordered incomplete activity's title, category `prepare`, and assignment due date. Its action is open while work remains, completed when all activities complete, dismissed while archived/empty, and reopened with the same ID when work resumes. Empty drafts create no action. Estimates remain unknown unless she supplies one through the existing plan contract.
Resolve action ID → assignment through `action_id` and Start → `/study/homework/:assignmentId?activity=:activityId`. Bound action Complete opens the required activity/evidence flow; it cannot call the generic completion update. Editing/rescheduling redirects to Homework; skip/defer/pin remain planner decisions. No other repository may mutate a bound action's source-owned fields; both drivers enforce this guard. No second scheduler or copied `event_prep_items`/Questions rows.
Extend existing recommendation input with the ownership map: emit only `action:<id>`, explain “Homework due today”, “Homework overdue since …”, “Preparation for [lesson]”, or “Self-directed homework”. Use existing pin precedence, due comparisons and `computeDailyPlan`; newly urgent homework waits behind healthy locked selections until Refresh/budget change/day rollover, with only vacated slots refilled. Preserve pinned work, capacity and skip/defer metadata across restart.
`lessonPreparation` may describe linked assignments as named readiness lines with assignment links, counting their actual activities; the recommendation builder suppresses a second prep candidate for those owned actions. Keep existing independent checklist/questions unchanged. In a single dashboard surface use the ownership key to avoid repeating the same homework as both a task and an actionable prep line; readiness summary may link to the assignment.

## Failure, concurrency, dates and recovery

- Multi-activity saves, history, run changes, action projection and operation receipt use one `BEGIN IMMEDIATE` transaction and the driver persistence boundary. Inject failure after activity 2 and at final persistence: all changes roll back, including history/receipt. Never fall back to sequential repository calls. Native IPC uses one owned transaction; browser persistence restores prior bytes on failure, following existing atomic drivers.
- Repeated clicks reuse one operation UUID and canonical request/hash; identical replay returns its original result before stale checks, changed payload with that UUID refuses. Compare assignment revision and affected activity revision/cycle inside the transaction. Two native windows racing the same base yield one winner and one actionable stale result; reload without discarding the losing draft. A busy/persistence failure has no success receipt.
- Native windows share SQLite's transaction lock. Browser sql.js handles do **not** share that lock: before exposing any writable browser driver, hold a lifetime Web Lock keyed to the whole localStorage database; a second tab is read-only with an explanation. If cross-tab locking is unavailable, refuse browser writes. Every writer to those same database bytes must honor that guard, including ordinary actions/cards/tests; a homework-only lock or storage-event notification is insufficient. Test a second browser driver being refused, plus two independent native connections racing.
- Stale completion: deleted/replaced targets, old run IDs, reset card generations, removed activities and old cycles refuse without changing homework. A retried accepted result is acknowledged without reapplying it. After an unrelated edit, reconcile against durable run evidence and a fresh revision rather than letting an old callback overwrite state.
- Reorder uses a transaction-local offset above the maximum position before assigning final contiguous positions, avoiding transient UNIQUE conflicts; activity IDs/cycles/evidence stay put. Soft removal sets `removed_at`; it never physically deletes activity history. Reopen selects work to repeat, preserves prior cycles and requires fresh current-cycle evidence.
- Editing kind/body/target on completed work reopens that activity and its assignment while preserving old completion snapshots; title, assignment instructions and due-date edits alone do not. Adding unfinished work to a completed assignment also reopens it. Removing the last activity produces upcoming, never a vacuously completed empty assignment.
- Missing link: preserve assignment, activity and evidence; show “Source missing — choose a source to continue.” Hash/version drift says the source changed and requires deliberate relink, never title-based repair. Replaced/relinked reading/cards/tests reopen the affected activity with a new cycle; other completed activities remain complete.
- Cancelled lessons stop contributing upcoming-lesson priority; homework remains available with “Lesson cancelled”. Rescheduling shows the new lesson time but does not silently change her homework due date; offer an explicit date edit. Deleted lessons keep `source_lesson_id` and historical label, with repair/unlink controls.
- Due dates are optional `YYYY-MM-DD` civil dates, compared with `todayIso()` in the device's current timezone; never parse a due date as UTC midnight. Timezone travel changes “today”, not the stored date. Instants/evidence are UTC; use existing exclusive next-local-midnight card bounds (DST included). Reuse daily-plan local-day rollover for skips/deferrals, with date/zone recomputation on resume.
- Restart reloads durable runs, receipts, history and the locked plan; interrupted saves have no partial state. An unfinished bound test resumes its exact attempt; a card session resumes its frozen queue or is explicitly invalidated if reset/drifted. Never infer completion from component memory.
- Backup v3 already snapshots SQLite: include all five tables, bodies/reflections/questions, evidence, history, receipts and action links; derived search stays excluded. Validate staged DB before replacing current data, restore all rows exactly, then revalidate links. Missing external sources are supported. Do not change the archive format solely for schema 20.
- Upgrade old backups through the existing validation/migration ladder. A pre-0020 app must reject a schema-20 backup with “Update the app first”, before moving current data; never strip homework or pretend downgrade works. The newer app accepts supported older backups, adds empty homework tables and preserves every old row.

## Parity and validation acceptance

HW-01b adds `homeworkRepository.ts`/`homeworkTransaction.ts` and native `homework.rs`, wired through `db.ts`, `sqlJsDb.ts`, `testing/nodeSqliteDb.ts`, `tauriDb.ts`, repository index and native command registration in `lib.rs`. Follow existing practice/card/navigation atomic contracts; unsupported drivers refuse, with no non-atomic fallback.
Register 0020 in `src/data/migrations.ts`, its checksum registry and native migration list/ceiling only after review. Add TS `validateHomeworkState` in `practiceStateValidation.ts` and native `verify_schema_20_homework_semantics` in `backup.rs`, reached by startup and backup/restore ladders. Both compare columns, CHECKs, FKs, indexes, triggers and actual FK integrity against the migration reference, then apply the semantic codec checks above, including receipts/history and detached evidence.
Add one shared `src-tauri/fixtures/homework-validation/cases.json`, consumed after close/reopen by sql.js, node:sqlite and Rust; include valid unlinked/deleted-source cases and refusals for wrong owner/version/cycle, forged evidence, invalid dates, changed receipt bytes/hash, duplicate positions/action bindings, missing constraints/triggers, malformed/oversized JSON and broken history. Do not let both validators merely trust the same fixture's expected output; independently recompute evidence and aggregate states.
Follow `pdfKitUpgrade.test.ts`, `pdfKitValidationParity.test.ts`, practice-authoring parity, and native schema-17/18/19 archive tests: populated **0019→0020**, complete table dumps before/after, empty additive tables, repeated open, interrupted migration rollback, v20 round-trip archive with source deletion/reopening, and tampered archive refusal after recomputing archive integrity. Explicitly test old-app rejection without changing its existing library. Extend schema-14 helper's later-schema alarms when 0020 actually lands; its frozen ceiling remains 14.

## Search joins when Homework ships

The [OFFLINE-02c addendum §8](OFFLINE_02C_SAVED_CONTENT_SEARCH_ADDENDUM_2026-10-19.md) defers Homework only until HW-01. Include it in HW-01c before exposing Homework: extend the existing read-only temporary saved-content index, `contentTypes`, coverage, bounded rebuild and stale-hit validation; no separate index service or persistent FTS migration. Search current non-archived assignment titles/instructions and non-removed activity titles/bodies, including saved reflection/questions; exclude history, scores, receipts and copied source answers. Archived work remains accessible through Homework filters.
Use assignment/activity UUID plus content digest for results under “Homework”; open that record in `/study/homework/:id`, never a title match. Unlinked homework is searchable with the Homework type; when material filters are active include only matching linked activities (and their assignment heading), with no unrelated bodies. Reuse `data_version` snapshot/rebuild/deadline/byte/record limits, text-only snippets, cancellation and feature gates. HW-01b has no search/UI; HW-01c must not claim search delivered until native/API/UI parity and missing/edited/reordered result tests pass.

## Reviewable slices (estimates, not commitments)

| Slice | Files and boundary | Failing-first acceptance and size |
| --- | --- | --- |
| HW-01b | `0020_homework.sql`; `migrations.ts`, `migration-checksums.json`, `lib.rs`; new `domain/homework.ts`, `data/homeworkTransaction.ts`, `data/repositories/homeworkRepository.ts`, `src-tauri/src/homework.rs`; drivers/repository index and validators above; `docs/backup-format.md`; shared fixture, `homework{Contract,Parity,Upgrade,ValidationParity}.test.ts`, native tests. Persistence only; reserve runs/action links, no UI or planner writes. | First fail rollback/retry/conflicting windows, retained identity/deletion/reorder/reopen, forged history/receipt/evidence and 19→20 round-trip/rejection cases in all engines. L: ~1,500–2,200 source + ~1,200–1,800 test lines, 2–3 bounded review rounds. |
| HW-01c | New `pages/StudyLibrary/Homework{View,Editor}.tsx` and tests; `App.tsx`, `AppDataContext.tsx`, Study Library entry; existing `extraction/search/saved.rs`, `search_api.rs`, `services/offlineContent.ts`, `logic/savedSearch.ts`, `DocumentSearchPanel.tsx` and tests. Reuse dialog fallback and source navigation. | First fail all six editors, optional/unlinked work, stale draft preservation, keyboard/focus/narrow view, source repair, search bounds/privacy/digest/result destinations. Browser walkthrough uses synthetic records. M/L: ~900–1,400 source + ~700–1,100 test lines, 2 review rounds. |
| HW-01d | `homeworkTransaction.ts`/`homework.rs`, practice/card atomic drivers + repository/IPC context; `logic/{actions,recommendations,dailyPlan,preparation}.ts`; Homework Start/evidence UI, Flight Deck controls/context; matching contract/native/selector/UI tests and shared fixture additions. | First fail unrelated/pre-created/partial sessions, stale/reset/reopened callbacks, atomic attempt/rating attribution, direct bound-action mutation, duplicate prep/action candidates, pinned/locked-session changes, restart, DST/travel/date rollover and backup evidence. L: ~900–1,400 source + ~900–1,500 test lines, 2–3 review rounds. |

Each slice stops for Claude's full independent review and required gates; estimates include no dependency/provider/install work. HW-01d completes HOMEWORK-01; HW-01c alone does not deliver automatic evidence or plan integration.

## Owner decisions (recommended defaults; pending)

1. Include reflection/question text and all completion history in private backups: **yes**; exports remain separate, deliberate selections.
2. Automatically archive completed homework: **no**; keep it in Completed until she archives it.
3. Card completion means a finished bounded queue, not every card in a large set: **yes**, show “Review N linked cards” and the exact queue before Start; empty queues do not complete homework.
4. Require a passing quiz score: **no**; finishing completes the task and shows its score separately. Any future threshold needs an explicit versioned rule.
5. Assignment completion after every activity completes: **automatic**, with its own durable event; an empty assignment stays upcoming.
6. Follow lesson date changes automatically: **no**; preserve the homework due date and offer a deliberate reschedule.

## Out of scope

No instructor portal, messages, sharing, school account, calendar sync or external task service. No new scheduler, proficiency claim, provider call, dependency or export inclusion by default. No code, migration or new tests in HW-01a; only this proposal, workflow/roadmap notes, manifest rebinding and the requested existing documentation gates.
