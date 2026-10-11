# M3 skills and feedback evidence: scope, contracts and prototype (10 October 2026)

**State: PROPOSED, pending senior scope review and owner approval of M3-D1–D9.** No production code, migration, dependency or registry changed. Candidate SQL and prototype code live only in [`docs/evidence/m3-skills-evidence-scope-2026-10-10/`](evidence/m3-skills-evidence-scope-2026-10-10/README.md).

**Where this was done:**
- Worktree: `/Users/rickymac/code/Flight-training-m3-skills-scope`
- Branch: `codex/m3-skills-evidence-scope`
- Base: `origin/main` `48fa47d` (#132)
- Work is uncommitted and unpushed.

The primary checkout's pending read-only Mac preflight report was left untouched. **Installed hfdtest verification remains deferred:** G1–G3 are DEFERRED/UNEXECUTED/UNVERIFIED, and post-receipt recovery is BLOCKED/source-covered.

## 1. What M3's first slice does

After a lesson, she can deliberately say: *this part of the debrief is evidence about this skill*. The app then:
- keeps her exact words, the date and **who said it**;
- can link the observation to a follow-up action she already has;
- shows each skill's evidence as a calm, paged history.

**Status and confidence stay hers.** Status is Learning, Practicing or Needs review; confidence is an optional 1–5. Nothing in the app turns a quiz result, a finished action or a count of notes into "proficient", "ready", "endorsed" or "signed off".

**The first slice is one cohesive change:**
- the catalog;
- durable debrief observations;
- the evidence history;
- explicit action links.

Readiness views, ACS mappings and AI extraction come later.

## 2. What M1/M2 already supply, and what M3 still needs

| Area | Already shipped (read in source) | M3 consequence |
| --- | --- | --- |
| Debrief | `journal_entries` fields `went_well`, `was_difficult`, `instructor_feedback`, `practiced`, `confidence` (1–5 per entry). Saved by the atomic `save_debrief_operation` (`src-tauri/src/debrief.rs`), twinned by `src/data/debriefTransaction.ts`, with `debrief_operations` replay receipts. | Observations reference a debrief and may fingerprint one of those fields. The debrief contract and per-entry confidence are **unchanged**. |
| Feedback chronology | `src/logic/feedback.ts` collects `instructorFeedback` text into a list (storage only, no themes). | Kept as is. M3 adds structured observations beside it; it does not parse the free text. |
| Actions | `next_actions` with polymorphic `related_type`/`related_id`, `material_id` (0010) and the material-provenance trigger. Debrief-owned actions are created atomically. | Observations link an **existing** action. There is no second action system, and M3 never writes `next_actions`. |
| Questions | `questions.journal_id`, with source-provenance triggers (0010). | Untouched. A follow-up question is not an observation. |
| Practice, cards, split lineage | Accepted M2 transactions and validators (schemas 11–13). | Never consulted to infer skill status. Restore validators run unchanged, before the new schema-14 check. |
| Global data | `AppDataContext` loads journal, actions, questions and the rest in one snapshot, with `dataRevision`. | Evidence history is **not** added there. It is read in bounded pages by its own controller. |

**Residual M2 items, recorded but not assumed complete:**
- Installed/physical G1–G3 are deferred.
- Device benchmarks, the timezone-on-device check and the remaining installed M2 exit checks are not claimed here.

**What is genuinely missing for M3:**
- any record of a skill;
- any attribution beyond the field name "Instructor feedback";
- any link between feedback and the action meant to address it;
- confidence per skill rather than per lesson.

## 3. Proposed owner defaults (M3-D1–D9), all PROPOSED

| # | Decision | Recommended default | Impact |
| --- | --- | --- | --- |
| **M3-D1** | Skill catalog | A small built-in catalog v1 of **15 plain-language skills** with permanent `builtin.*` ids, such as `builtin.crosswind_landing`. Built-in names are read-only to her. A future catalog version ships as an additive migration that appends a revision. Custom skills get `custom.<uuid>` ids, up to **200**. Two *active* skills may not share a name (case and spacing ignored); a retired skill's name may be reused. **No ACS codes in v1.** | Stable identity without claiming official FAA elements. FAA-02 mappings stay a separate, source-verified task. |
| **M3-D2** | Skill status | Learning / Practicing / Needs review, **set only by her**, with "Not set" as the default and a way to clear it. Evidence, quizzes, cards and actions never change it. There is no "proficient", "ready" or "complete" state. | Status means what she says it means; the app never implies an instructor's judgement. |
| **M3-D3** | Attribution | Two kinds only: **"My own observation"** (`self_report`) and **"My instructor said (as I wrote it down)"** (`instructor_transcribed`), with an optional instructor name she types. **No verified-instructor state** exists in storage, the interface or restore. | Honest on a single-user local app with no identity mechanism. A verified kind would need a separately scoped, reviewed mechanism. |
| **M3-D4** | Creating observations | Only deliberately, one at a time, against a debrief she picked. She may say which debrief field it came from (its text is fingerprinted, never copied). There is **no automatic backfill, AI extraction or creation from quiz or action results**. Limits: wording 1–2,000 characters (≤ 8,000 bytes); 50 per debrief. | Existing debriefs stay valid and usable. Nothing appears that she did not record. |
| **M3-D5** | Edits and history | Every change appends a history entry: wording, date, attribution, name, link and addressed state. Earlier versions are always visible. The **skill and source debrief are fixed** after creation; to move one, erase it and record it again. An edit based on an old version is refused, and she is asked to reload. | History is intelligible and nothing is silently rewritten or relinked. |
| **M3-D6** | When sources change | **Deleting a debrief keeps its observations** with a snapshot of the debrief's title and date, shown as "from a debrief that was deleted". They are never re-attached to another debrief. A renamed debrief shows its new and recorded names; an edited source field shows "edited since you recorded this". **Deleting a linked action** keeps its name in the observation. **Skills are never deleted**, only retired (hidden from the picker, history kept, restorable). | Matches the accepted split-lineage (SL-D5) and question-provenance behaviour. Deleting a lesson never quietly destroys feedback history. |
| **M3-D7** | Erasure and retention | Kept until she chooses otherwise; nothing expires automatically. **Erase permanently** works on one observation, with explicit confirmation. It removes its wording and every history entry. Only non-content tombstones remain (ids, request hash, time), so a late retry can never bring it back. Erasing does not touch the debrief. Backups made earlier still contain the observation, and the confirmation says so. | A clear, bounded privacy control, separate from deleting a lesson. Needs owner approval because it sets retention policy. |
| **M3-D8** | Follow-up actions and "addressed" | She can link one existing action, and later unlink it. **"Mark addressed"** is her own explicit choice, recorded in history. **Completing the action never marks the feedback addressed.** The page says so: "Finishing it doesn't mean this was resolved in flight." Repeating the same request replays it; a conflicting one is refused. | Keeps "I did the homework" separate from "the problem is solved in the airplane". |
| **M3-D9** | Confidence and wording boundaries | An optional **1–5 confidence per skill**, with history, separate from status and from the per-lesson debrief confidence (unchanged). Evidence is described in words, never as a score: "No observations yet", "Only a few observations so far: not enough to show a pattern" (fewer than 3, or all from one lesson), or "N observations from M lessons". Every skill page carries "This is your own record. It isn't an instructor sign-off or a proficiency rating." | Small samples read as insufficient, and no percentage or readiness claim appears. |

Ordinary implementation choices (ids, indexes, page sizes, error wording) are the implementer's judgement. Only the nine rows above need the owner.

## 4. Interface flow

1. **From a debrief** (`JournalEntryDetail`), a new "Skill evidence" card:
   - It lists this debrief's observations, paged by debrief.
   - "Add an observation" opens a `<dialog>` through the existing `useModalDialog`. The dialog has:
     - **Skill:** active skills, built-in first, custom marked "(your skill)".
     - **Who said it?** A named radio group: *My instructor (I'm writing down what they said)* / *Me (my own observation)*.
     - **Instructor name (optional):** shown only for the first choice.
     - **What was said or noticed:** a textarea with a live count out of 2,000.
     - **Came from:** none, or Instructor feedback / What went well / What was difficult / What you practiced.
     - **Date observed:** defaults to the debrief date.
   - Save is disabled while saving. A second click joins the save already in flight.
2. **Skill page**, a "Skills" view inside Flight Path, `/flight-path/skills/:skillId`:
   - **Summary:**
     - Your status (or Not set), with a menu to change it.
     - Your confidence (or Not rated).
     - The evidence sentence (M3-D9) and the fixed disclaimer.
   - **History:** newest first, 20 per page, "Show older". Each item shows:
     - the attribution in words ("Your note" / "Instructor feedback, as you wrote it down (Name)");
     - the date and "edited" when revised;
     - the exact wording;
     - the source line (current, renamed, edited since, or deleted);
     - the recorded skill name if it has since been renamed;
     - the action line ("Follow-up: …", "… is done. Finishing it doesn't mean this was resolved in flight.", or "… was deleted");
     - "You marked this addressed".
   - **Item menu:**
     - **Edit:** stale edits ask her to reload.
     - **Link a follow-up:** picks from her existing actions.
     - **Mark addressed / Not addressed.**
     - **View history:** every version, newest first, up to 100.
     - **Erase permanently:** a confirm dialog that names what will be erased and notes that earlier backups still contain it.
3. **Skills list**, in Flight Path:
   - Active skills grouped by the existing broad Topic, each with its status and evidence sentence.
   - "Show retired skills".
   - "Add your own skill".
   - Built-in skills show "Built-in". Custom skills can be renamed or retired.
4. **States:**
   - Loading: "Loading your evidence…", announced as a status.
   - Empty: "No observations for this skill yet. Add one from a lesson debrief."
   - Read error: "We couldn't load this right now. Your saved observations are safe.", with **Try again** (read only).
   - Saved but the list could not refresh: "Saved. We couldn't refresh the list.", with **Refresh list** (read only, never resaves).
   - Write refusal: the plain message for its code.
   - Browser mode works on the sql.js twin. Nothing needs a provider or a network connection.

A working jsdom specimen of the panel is [`prototype/SkillEvidenceSpecimen.tsx`](evidence/m3-skills-evidence-scope-2026-10-10/prototype/SkillEvidenceSpecimen.tsx).

## 5. Storage contract: candidate migration 0014 (schema 14)

The authoritative text is [`candidate/0014_skills_evidence.sql`](evidence/m3-skills-evidence-scope-2026-10-10/candidate/0014_skills_evidence.sql). It is **additive only** and alters no existing table. Main had 0001–0013 at `48fa47d`. **Recheck main before allocating the number**; if another migration lands first, renumber and keep the content.

| Table | Purpose | Key rules |
| --- | --- | --- |
| `skill_catalog_entries` | One row per skill | `id` PK; `origin` builtin\|custom, consistent with the `builtin.`/`custom.` prefix and `catalog_version`; label 1–80; description ≤ 500; topic ∈ the existing 12 `Topic` values; status active\|retired ⇔ `retired_at`; `revision` ≥ 1. Never deleted: every revision references it `ON DELETE RESTRICT`. |
| `skill_catalog_revisions` | Append-only name/topic/status history | PK (`skill_id`, `revision`). `changed_by` catalog\|user ⇔ `operation_id`. Triggers forbid UPDATE and DELETE. |
| `skill_observations` | The current state of each observation | **Ids and snapshot:** `id` (client UUID v4); `skill_id` RESTRICT; `skill_label_snapshot`.<br>**Debrief:** `journal_id` → `journal_entries` **SET NULL**, plus `source_journal_id`/date/title snapshot (NOT NULL), with CHECK `journal_id IS NULL OR journal_id IS source_journal_id` (no relinking).<br>**Source field:** `source_field` ∈ none + 4 debrief fields ⇔ `source_text_sha256` (lower hex 64).<br>**Attribution:** self_report\|instructor_transcribed; `instructor_name` (≤ 120) only for transcribed.<br>**Wording and date:** wording 1–2,000 characters and ≤ 8,000 bytes; `observed_on` must satisfy `date(x) IS x` (a real calendar date).<br>**Action link:** `action_id` → `next_actions` **SET NULL**, plus `linked_action_id`/title snapshot, with CHECK `action_id IS NULL OR action_id IS linked_action_id`.<br>**State:** `addressed_at`; `revision`; `created_at`/`updated_at` (ISO-8601 UTC milliseconds). |
| `skill_observation_revisions` | Append-only history of every change | PK (`observation_id`, `revision`), CASCADE from the observation. `change_kind` ∈ created/edited/linked_action/unlinked_action/marked_addressed/cleared_addressed, with revision 1 ⇔ created. Each row is a full snapshot including link and addressed state. Triggers forbid UPDATE, and forbid DELETE while the observation still exists, so history can only go with an erase. |
| `skill_self_assessments` | Append-only status and confidence | `kind` status\|confidence; status ∈ learning/practicing/needs_review/NULL (cleared); confidence 1–5/NULL; UNIQUE (`skill_id`, `kind`, `sequence`). Triggers forbid UPDATE and DELETE. |
| `skill_evidence_operations` | Idempotency receipts | PK `operation_id`; `action` ∈ the 12 actions; `request_hash` (lower hex 64); `subject_id`; `result_json` NULL ⇔ `is_erased` = 1 (a non-content tombstone). |

**Indexes:**
- `idx_skill_observations_page` (`observed_on`, `created_at`, `id`)
- `…_skill_page` (`skill_id`, `observed_on`, `created_at`, `id`)
- `…_journal`, `…_source_journal`, `…_action`
- `idx_skill_evidence_operations_subject`

The catalog v1 rows and their revision-1 rows are seeded by the migration with fixed text and time.

**Dates.** `observed_on` is a local calendar date (`YYYY-MM-DD`, the same convention as `journal_entries.date`), displayed as written with no timezone shift. Timestamps are UTC instants, used for ordering and history only.

**Copies versus authority.** The observation's wording and attribution are authoritative. The debrief title/date snapshot, the skill-name snapshot and the action-title snapshot are context copies; they are never treated as the current source. The source fingerprint only detects drift.

## 6. Write contract

There is one entry point, `executeSkillEvidenceAction(action)`, natively `save_skill_evidence_action`. It takes 12 actions:
- `create_custom_skill`, `edit_custom_skill`, `retire_skill`, `restore_skill`
- `create_observation`, `edit_observation`
- `link_action`, `unlink_action`, `set_addressed`
- `set_status`, `set_confidence`
- `erase_observation` (requires `confirm: "erase"`)

**Order of checks:**
1. **Decode strictly**, before any transaction:
   - exact keys per action (natively `deny_unknown_fields`);
   - exact types;
   - UUID v4 operation and observation ids; skill ids `builtin.[a-z0-9_]+` or `custom.<uuid>`;
   - control characters refused (newline and tab allowed in wording);
   - lone surrogates refused;
   - code-point and byte limits;
   - real calendar dates.
2. Canonical JSON (the existing `canonicalJson`) is bounded to **16 KiB**, then hashed with SHA-256.
3. **`BEGIN IMMEDIATE`** on the one owned connection. Inside it:
   - **Receipt lookup.** A known id with the same hash → `replayed`, returning the stored result with no write. A different hash → `OPERATION_CONFLICT`. An erased tombstone → `ERASED`.
   - **All safety checks before the first write:**
     - existence → `NOT_FOUND` / `SOURCE_MISSING`;
     - retired skill → `SKILL_RETIRED`;
     - built-in names → `BUILTIN_READ_ONLY`;
     - active-name duplicate → `DUPLICATE_LABEL`;
     - expected revision or sequence → `STALE_REVISION`;
     - limits → `LIMIT_EXCEEDED`;
     - no-op change → `INVALID_ARGUMENT`;
     - observation id already used, or previously erased → `OPERATION_CONFLICT` / `ERASED`.
   - **Writes:** the head row change, one appended history row, and the receipt. Updates are conditional on the expected revision.
   - `COMMIT`.

**Any failure** → `ROLLBACK`; the whole change, including the receipt, is absent and `STORAGE_FAILURE` is reported. The TS drivers also roll back through the existing `ConnectionOwner` net. That second net is why reversion S4a is masked and S4b is the meaningful one.

**Behaviour by situation:**

| Situation | Behaviour |
| --- | --- |
| Duplicate request (retry, double click) | Same id and content → one write, then `replayed` with the original result. It never re-applies over a later edit. |
| Two different requests at once | Serialized by the connection owner (TS) or the pinned native connection; both land. Two edits from the same revision → the first applies, the second gets `STALE_REVISION`. |
| Debrief deleted | FK sets `journal_id` NULL; the snapshot remains. New observations against it → `SOURCE_MISSING`. A same-titled replacement debrief is never adopted. |
| Debrief renamed or field edited | Shown as drift (`renamed`, `textChanged`). Nothing is relinked or rewritten. |
| Linked action deleted | FK sets `action_id` NULL; `linked_action_id`/title remain, shown as "was deleted"; unlink clears them. |
| Linked action completed or dismissed | The live status is shown; `addressed_at` is untouched. |
| Material deleted | Not linked in v1, so there is no effect. Debriefs keep their own `journal_materials` behaviour. |
| Skill retired | Hidden from pickers; history and existing observations stay readable; new observations → `SKILL_RETIRED`; restore re-checks name duplicates. |
| Erase | Earlier receipts for the subject become tombstones, then the observation is deleted (its history cascades), then the erase receipt is written. Later replays → `ERASED`; reusing the id → `ERASED`. |
| Acknowledged write, failed refresh | The result is final. The screen says "Saved" and the reload is retried read-only. **A read retry never resends a write.** |

## 7. Read contract

**`readEvidencePage({ skillId?, journalId?, attribution?, cursor?, limit })`:**
- Order: `observed_on` DESC, `created_at` DESC, `id` DESC.
- Keyset cursor: an opaque JSON triple, validated strictly; a forged cursor → `INVALID_ARGUMENT`.
- Page size: 1–50, default 20; outside that → `LIMIT_EXCEEDED`, enforced at the read boundary.
- Each item joins the current skill, debrief and action. The source fingerprint is recomputed only for the visible page.
- Rows added or erased between pages never shift the next page.

**Plans** (node:sqlite, recorded in receipt 03):
- Skill pages: `SEARCH o USING INDEX idx_skill_observations_skill_page (skill_id=? AND (observed_on,created_at,id)<(?,?,?))`.
- Full pages: `SCAN o USING INDEX idx_skill_observations_page`.
- Neither uses a temporary B-tree.

**Other reads:**
- **`readSkillSummary(skillId)`:** the latest status and confidence with their sequences, counts by attribution, distinct debriefs and the last observed date. Evidence is `none`, `limited` (< 3 observations, or < 2 debriefs) or `recorded`. No other derived field exists.
- `listSkills({ includeRetired })` and `readObservationHistory(id)` (≤ 100 revisions).

## 8. Operation and publication ownership

[`prototype/evidenceController.ts`](evidence/m3-skills-evidence-scope-2026-10-10/prototype/evidenceController.ts) is the reference.

- **Generation.** Each open of a skill starts a new generation. Answers from older generations are dropped, so A→B→A shows only the last A answer. Late pages after a switch are dropped. A second "Show older" waits for the first. Nothing publishes after dispose (unmount).
- **Draft ids.** A draft keeps its operation and observation ids while its content is unchanged; Try again resends them and the store replays. A second click joins the save in flight.
- **Changed content after an unknown outcome.** The controller first reads whether the earlier observation exists. If it does, it reports "Your earlier save had already gone through" and never sends a second, different create. A definite refusal frees the draft to go out under new ids.
- **Refresh after an acknowledged write.** The write is never resent. If the refresh fails, the screen says it was saved and offers a read-only refresh.

The production hook (`src/state/useSkillEvidence.ts`) follows these rules. It also advances on `dataRevision`, so a debrief deletion elsewhere refreshes the visible page.

## 9. Migration, restore and older apps

- **Upgrade:** schema 13 → 14 adds only the M3 objects and the seeded catalog. **Every retained row is identical**, proven on a genuine library written by the shipped driver and repositories: debrief with action and question, practice attempt, rated card and split lineage. Proven on node:sqlite, sql.js and rusqlite.
- **A failed upgrade rolls back to 13 completely:** same rows, same `sqlite_master`, no version 14.
- **Validation at open and restore:** after the accepted 11/12/13 validators, the schema-14 check runs. Native: `verify_schema_14_skill_evidence_semantics`. TS: `validateSkillEvidenceState`. It requires:
  - exact columns, defaults, FKs, CHECKs, keys, indexes and **triggers**;
  - `foreign_key_check` clean;
  - built-in catalog equal to the shipped one (no unknown or missing ids, revision 1 text exact);
  - custom skills ≤ 200;
  - contiguous skill, observation and self-assessment histories whose latest entry equals the head;
  - no relinked debrief;
  - live receipts holding results for their own action;
  - erased tombstones whose subject is really gone.
- **Shared contract:** 25 validation cases and 29 constraint cases, with identical outcomes on all three engines.
- **Older binaries:** the shipped schema-13 TS driver refuses a 14 library ("newer format") and leaves its bytes unchanged. The shipped native ceiling test passes unchanged (receipt 09). The candidate refuses 15.
- **Backups:** format v2 still fits, because the database schema is bumped independently. A genuine schema-13 backup restores into the candidate and gains 14 with every row kept. Round trips node→node, node→sql.js, sql.js→node and the rusqlite backup API are byte-for-row identical. A backup with altered evidence is refused before anything would be replaced.

## 10. Prototype results (focused; source-level only)

Exact commands, output and exits are in [`receipts/`](evidence/m3-skills-evidence-scope-2026-10-10/receipts/).

| Check | Result |
| --- | --- |
| Prototype Vitest (7 files; node:sqlite 3.53.4, sql.js 1.14.2/SQLite 3.49.1, jsdom) | **102 passed**, 2 opt-in skipped (benchmark, fixture regenerator), exit 0 |
| Prototype `tsc --noEmit` under the app's strict config | exit 0 |
| Native crate (rusqlite 0.32.1, bundled SQLite 3.46.0, the app's own resolution) | **7 passed**, exit 0 |
| Fixtures regenerate byte-identically | exit 0 |
| Production guards unchanged (`migrations`, `migrationSafety`, split-lineage parity) | 103 passed, exit 0 |
| Shipped native future-schema refusal (`backup::tests::current_practice_test_schema_can_be_backed_up_but_future_schema_cannot`) | 1 passed, exit 0 |
| Reversions | 9 variants: **8 caught** by their named tests, and S4a **masked as expected** (see §6). S7 is caught at open by the validator ("missing required trigger"). |

**Benchmarks** (Node 22.23.3 on an Apple Silicon Mac, in-memory databases):
- Dataset: 215 skills, 400 debriefs, observations written one at a time through the real transaction.
- Not WKWebView, not an installed app, no peak-memory figure.

| Engine | Observations | Write median / p95 | Page of 20 median | Skill page median | Full walk at 50 | Restore validation |
| --- | --- | --- | --- | --- | --- | --- |
| node:sqlite | 100 | 0.104 / 0.146 ms | 0.111 ms | 0.060 ms | 2 pages | 11.4 ms |
| node:sqlite | 2,500 | 0.103 / 0.117 ms | 0.107 ms | 0.107 ms | 50 pages, 0.195 ms each | 42.9 ms |
| node:sqlite | 5,000 | 0.102 / 0.119 ms | 0.102 ms | 0.104 ms | 100 pages, 0.184 ms | 87.3 ms |
| node:sqlite | 10,000 | 0.105 / 0.123 ms | 0.102 ms | 0.105 ms | 200 pages, 0.186 ms | 167.2 ms |
| sql.js | 10,000 | 0.137 / 0.183 ms | 0.233 ms | 0.229 ms | 200 pages, 0.480 ms | 261.6 ms |

Page latency stays flat with size (keyset). Restore validation is linear, about 17–26 ms per 1,000 observations, because it checks each history. Full data is in [`receipts/bench-results.json`](evidence/m3-skills-evidence-scope-2026-10-10/receipts/bench-results.json).

**Found and fixed during prototyping:** the first candidate wrote `CHECK (action_id IS NULL OR action_id = linked_action_id)`. In SQLite a NULL comparison passes a CHECK, so an action link without its snapshot was accepted. The shared constraint contract caught it on both TS engines. Both relationship CHECKs now use the null-safe `IS`, and the case stays in the contract.

## 11. Limitations (honest)

- **Native writes are not prototyped.** The write path is prototyped in TypeScript on real node:sqlite and sql.js connections. The native writer (Rust, pinned connection) is specified here and in the implementation prompt but not built. The rusqlite crate proves the constraints, validator, upgrade and backup copy, not the native write transaction.
- **Bookkeeping differs.** The prototype records migrations in `schema_migrations`, like the TS drivers. The desktop app records them in `_sqlx_migrations` with its SHA-384 checksum, which production registration must add.
- **Test-only UI.** The UI is a jsdom specimen with no routing, styling review or installed-WebKit behaviour. Benchmarks are Node-only and source-level.
- **Backups made before an erase** still contain the erased content (disclosed in M3-D7).
- **No ACS mappings, and nothing extracted from free-text feedback.**
- **Physical installed verification (G1–G3) remains DEFERRED/UNEXECUTED/UNVERIFIED.** Nothing here is an installed or release claim.

## 12. Production implementation order (one cohesive change)

Build in this order, inside one reviewable branch:
1. Register migration 0014 (byte-identical to the candidate), schema 14, ceiling-test updates.
2. Rust `skill_evidence.rs` writer, readers and validator, with fixtures.
3. TS twins and the driver wiring.
4. Repository, hook and logic.
5. The debrief card, then the Flight Path skills list and skill page.
6. The restore/upgrade proof.

The full assignment is in [`M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md`](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md). It is **conditional on scope acceptance and owner approval of M3-D1–D9**.

## 13. Not included

- ACS/FAA-02 code mappings.
- Weather and FAA dataset imports.
- FSRS adoption.
- PDF viewer changes.
- AI parsing of feedback (M6).
- Readiness or requirement views (M5).
- Verified instructor identity.
- Material-linked observations.
- Bulk erase.
- Automatic retention expiry.
- New dependencies, provider calls, signing or release work.
