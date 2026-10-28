# ORAL-01: oral-exam scenarios she answers in writing — 28 October 2026

Plan only, inspected at `f4ea44d`, branch `roadmap/oral-01`.
No feature, migration, dependency, AI use or release is approved or proven here.
This is queue row 13 (DIFF-04, COMP-09; M6 follow-on) and does not reorder the queue (`ROADMAP.md:79`).
It follows DIFF plan §5 (`docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md:89`), acceptance DIFF04-A–E (`:99`–`:103`),
the M6 rule "text oral practice comes before voice" (`ROADMAP.md:1531`) and COMP-09 (`docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md:130`).

## The student experience

One scenario at a time: **Read the scenario → Write your answer → Show discussion points → Tick what I covered → Done**.
The scenario and its discussion points are hers: she writes them, or copies them from her instructor, like a manual question.
"Show discussion points" is a deliberate button; the points are not on screen (or in the page) before she presses it.
Writing is optional: "Show points without writing" is allowed, because some days she will answer out loud to herself.
After reveal, each point has an ordinary checkbox, "I covered this". That is her own judgement, labelled as such.
There is no score, percentage, count, pass/fail, "satisfactory", readiness or AI grading. No timer and no streak.
Two optional ordinary buttons after reveal: **Ask my instructor** (adds a question to Questions) and **Write a note**.
Lives inside the material's page in Study Library, beside Practice test; no new dashboard, tab bar or statistics view.
No school, instructor, account, Gemini key or connection is needed. Voice is not part of this row at all.
A small line under her points: "Your own outline. Check it with your instructor and current FAA material."
This follows simplicity, privacy and authority rules (`PRODUCT_SPEC.md:1568`, `:1574`, `:1576`; safety `:1374`).

## What the code already provides

| Foundation | Actual source and implication |
| --- | --- |
| Manual practice authoring | `src/data/practiceAuthoring.ts:1` gives exact-key snapshots, server-assigned versions and durable receipts (`src-tauri/migrations/0017_practice_authoring.sql:34`). `src/pages/StudyLibrary/PracticeTestEditing.tsx:209` has "My instructor corrected this"; origins live in `src-tauri/migrations/0016_manual_study.sql:43`. Copy these patterns for scenario authoring; do not reuse the tables. |
| Why practice tables do not fit | `src-tauri/migrations/0011_practice_sessions.sql:34` requires `correct_index`, `:58` stores `score_percent`, and `:82` forces a selected option or "don't know". DIFF plan `:95` forbids faking a correct choice for an oral answer. `0016_manual_study.sql:23` and `0017_practice_authoring.sql:37` CHECKs cannot gain an oral kind without editing shipped migrations. |
| Deliberate reveal and focus | `src/pages/StudyLibrary/CardReviewPanel.tsx:403` reveals and moves focus to the heading; `:428` handles Space/Enter; `:456` is an `aria-live` region that mounts the answer only after reveal (`:459`); `:491` is the plain "Show answer" button. Reuse this pattern for "Show discussion points". |
| MISTAKES short saved review | `src/pages/StudyLibrary/PracticeMistakeFollowupPanel.tsx:335` toggles "Show saved answer"; `:342` shows the source page badge; `:364` says "Notes stay separate from practice history" with a "Write a note" link (`:368`). Oral self-review should copy this separation and wording style. |
| Notes | `src/data/repositories/noteRepository.ts:44` inserts a plain title/body note. Notes are never categorised, scored or analysed (`PRODUCT_SPEC.md:895`). "Write a note" may prefill her own words only; a note is never parsed back into a scenario. |
| Questions for her instructor | `src-tauri/migrations/0001_initial_schema.sql:180` already has `questions` with an optional `material_id`; `src/data/repositories/questionRepository.ts:68` inserts one. "Ask my instructor" reuses this with no new storage (`PRODUCT_SPEC.md:840`). |
| Homework answer field | `src-tauri/migrations/0023_homework_answers.sql:1` adds a 20,000-character `answer`; `src/pages/StudyLibrary/HomeworkView.tsx:346` shows it for reflection/questions with an ordinary textarea (`:353`). Reuse the textarea, limit and Save wording. Activity kinds are fixed by `0020_homework.sql:22`, so a homework "oral" activity needs later add-only storage. |
| Source pills | `0024_study_page_sources.sql:2` stores exact page snapshots; `:15` limits bindings to card/question kinds. `src/pages/StudyLibrary/navigation/SourcePageBadge.tsx:39` already works from a plain page and material (as the mistake panel uses it), and `:99` gives honest "Go to page" guidance. First version stores a plain page number; exact bookmark pills wait. |
| Study-aid labels | `src/pages/StudyLibrary/MaterialDetail.tsx:867` and `:1324` label AI material "Verify everything against the source, current FAA material, aircraft documents, and your instructor". Any non-her content reuses this wording. |
| Backup/restore | `src-tauri/src/backup.rs:44` writes archive format 3; `:628` refuses newer schemas; `:693` and `:728` are per-schema verifiers; TS twin homework checks at `src/data/practiceStateValidation.ts:1828`. Schema ceiling is `src-tauri/src/lib.rs:60` (24). New tables need the same Rust and TS verifiers. |

## Bounded slices (assign separately after review)

### ORAL-01b — try one scenario, nothing new saved

1. In a material's page, "Practice an oral question" opens a `useModalDialog` form: scenario text, optional assumptions
   (aircraft, weather, "imagine you are…"), and 1–12 discussion points. Then Write → Show points → Tick.
2. The screen says "Try it — the scenario is not saved yet." Close/Cancel clears everything; no database rows.
3. Only existing, explicit saves: **Ask my instructor** (`questions`, with `material_id`) and **Write a note** (prefilled
   with her scenario, answer and ticked points as plain text she can edit). Nothing is written without her pressing a button.
4. Tests: points absent from DOM before reveal; keyboard-only path; long answer (20,000 chars); 200% text; narrow width;
   no "score/%/correct/pass" strings in the component. Stop for a student run before any schema work.

### ORAL-01c — save her scenarios (owner gate: new tables)

1. Author, edit, reorder and remove scenarios under one material, with "My instructor gave me this" origin.
   Edits create a new frozen version (DIFF04-B); earlier versions stay readable for any saved answer.
2. Practice from the saved list one at a time: "Next scenario" only, no grid. Answers still go only to notes/questions.
3. Ship Rust and TS verifiers, migration registration, checksums, schema ceiling and restore tests in the same slice.

### ORAL-01d — keep her answers and resume (owner gate: answer retention)

1. Save the typed answer and ticked points as one finished practice, frozen to the scenario version.
   An unfinished answer survives restart; one open answer per scenario. "Earlier answers" shows her text, not a trend.
2. Delete one answer, or "Delete my answers for this scenario"; deleting the material removes everything (cascade).
3. Answers are in complete backups only; never in study packets, CSV, handouts or Markdown export unless separately approved.

### Later, each separately gated

- **01e** homework activity that points at a scenario (sidecar table; `0020_homework.sql:22` CHECK cannot change).
- **01f** exact bookmark source pill for scenarios (new binding table; `0024_study_page_sources.sql:15` CHECK cannot change).
- **01g** AI-drafted or bundled scenarios: off by default, origin `study_aid`, labelled, she must review/edit before first use.
- **Voice** remains a separate experiment with microphone, retention and accuracy gates (`ROADMAP.md:1531`).

## Proposed add-only storage shape for 01c/01d (owner gate)

No migration number is reserved; allocate at assignment against then-current main. Never edit a shipped migration.

```sql
CREATE TABLE oral_scenarios (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
 removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_oral_scenario_order ON oral_scenarios(material_id, position) WHERE removed_at IS NULL;
CREATE TABLE oral_scenario_versions (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 scenario_id TEXT NOT NULL REFERENCES oral_scenarios(id) ON DELETE CASCADE,
 version_number INTEGER NOT NULL CHECK (typeof(version_number) = 'integer' AND version_number >= 1),
 prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 4000),
 assumptions TEXT NOT NULL DEFAULT '' CHECK (length(assumptions) <= 2000),
 points_json TEXT NOT NULL,
 source_page INTEGER CHECK (source_page IS NULL OR (typeof(source_page) = 'integer' AND source_page >= 1)),
 origin TEXT NOT NULL CHECK (origin IN ('user', 'instructor', 'study_aid')),
 content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL,
 UNIQUE (scenario_id, version_number)
);
CREATE TABLE oral_answers (            -- 01d only
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 version_id TEXT NOT NULL REFERENCES oral_scenario_versions(id) ON DELETE CASCADE,
 answer TEXT NOT NULL DEFAULT '' CHECK (length(answer) <= 20000),
 covered_json TEXT NOT NULL DEFAULT '[]',
 revealed_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK (finished_at IS NULL OR revealed_at IS NOT NULL)
);
CREATE TABLE oral_save_operations (
 operation_id TEXT PRIMARY KEY NOT NULL,
 material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK (action IN ('create','edit','reorder','remove','answer','finish','erase')),
 payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT NOT NULL, applied_at TEXT NOT NULL
);
```

- `points_json`: 1–12 strings, each 1–500 characters, validated by one codec in Rust and TS (exact keys, no extra fields).
  No shipped migration uses SQLite JSON functions, so JSON shape is enforced in the codecs and verifiers, as `0017` does.
- `covered_json`: sorted unique point indexes of that frozen version; never a stored total or percentage.
- Open-answer uniqueness ("one per scenario") is enforced in the transaction, since it spans versions.
- `study_aid` is reserved now because a later CHECK cannot widen; 01c/01d UI writes only `user`/`instructor`.
- No answer text in `oral_save_operations` (hash only), so erasing an answer leaves no copy behind in receipts.
- Retain versions referenced by any answer; no eager pruning. Verifiers check hash, bounds, ordering, FK links and
  that covered indexes exist in the frozen version, refusing restore on corruption or a newer schema.

## Content source and review risk

- First and default: scenarios and outlines she writes or copies from her instructor. The app cannot check them;
  a wrong outline teaches a wrong answer, so the "check with your instructor" line stays visible on every reveal.
- Bundled starter scenarios: not recommended. If ever wanted, each needs named human (CFI) review against the
  current ACS/FAA source and edition, a source page, and the `study_aid` label; unsupported claims gain no authority
  from an ACS code (DIFF04-C).
- AI-drafted scenarios/outlines (Gemini): off by default, 01g only. Labelled with the `MaterialDetail.tsx:867`
  wording, editable, never auto-saved, and never used to grade her answer. No AI comparison of answer to points.
- Do not copy competitor wording such as automated "satisfactory/unsatisfactory" (`docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md:41`).

## Risks and synthetic fixtures

Risks: points leaking before reveal (DOM, `aria-label`, tooltip); a tick count read as a score; lost long answers
on close or restart; typed answers ending up in exports; authority creep from bundled or AI text; scope creep
into a dashboard. Mitigations are in the slices above; reviewers grep UI copy for score/percent/pass/ready.
Fixtures are fictional and non-operational: "Scenario Alpha — explain the three lights on the fictional practice panel
(Alpha/Bravo/Charlie)", with Unicode, line breaks, a 20,000-character answer, 1 and 12 points, an edited version with
an earlier answer, a removed scenario, and corrupt `points_json`/`covered_json`/out-of-range index for restore refusal.
No real profile, PDF, key, provider or network; never touch the installed data folder.

## Decisions for the owner, with recommended defaults

| Actual choice | Recommended default and consequence |
| --- | --- |
| Start the temporary try-it slice? | Yes, 01b only: nothing new saved; notes and instructor questions via existing tables. A student run decides whether to save scenarios. |
| Where scenarios live | Under a study material, beside Practice test. Reuses cascade deletion and backup; a standalone list would need its own home screen. |
| Save scenarios (new tables)? | After 01b: approve the 01c add-only shape above. |
| Keep her typed answers? | 01d: keep each finished answer with Delete and "Delete my answers"; complete backup only, never exported. Alternative: keep none. |
| Show "3 of 5 covered"? | No. Ticks only, no counts or totals, to avoid a score. |
| Bundled or AI-drafted scenarios | None now; 01g separately gated with human content review. |
| Homework link, exact source pill, voice | Later and separate (01e, 01f, voice experiment). |

This planning round ran no app tests and claims no installed, release or learning result.
