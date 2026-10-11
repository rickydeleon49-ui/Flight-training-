# M3 skills and feedback evidence: scope, contracts and prototype (10 October 2026)

**State: CORRECTED (M3-R1–R10), pending independent re-review. M3-D1–D9 remain PROPOSED, pending owner approval.** No production code, migration, dependency or registry changed. Candidate SQL and prototype code live only in [`docs/evidence/m3-skills-evidence-scope-2026-10-10/`](evidence/m3-skills-evidence-scope-2026-10-10/README.md).

**Corrections, 11 October 2026.** The [independent review](M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md) found seven defects (M3-R1–R7). They are corrected in place in the prototype, candidate fixtures and native proof, and in this document's §4 and §6–§11. The issue-to-fix report is [`M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md`](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md), and the new receipts are in [`docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/`](evidence/m3-skills-evidence-scope-corrections-2026-10-11/README.md). The original receipts and the review's frozen diagnostics are preserved unchanged. Candidate migration 0014 did not change.

**Remaining corrections, 11 October 2026.** The [independent re-review](M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md) verified R1–R7 and found three narrower defects:
- **M3-R8:** the form compared only wording before clearing a draft.
- **M3-R9:** restore validation checked receipt → history but not history → receipt.
- **M3-R10:** a confirmed erasure left already-loaded wording on screen.

They are corrected in §4, §8, §9 and §10, and in the prototype, fixtures and native proof. The report is [`M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md`](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md), with receipts in [`docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/`](evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/README.md).

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
| **M3-D5** | Edits and history | Every change appends a history entry: wording, date, attribution, name, link and addressed state. Earlier versions are always visible, back to the first wording (read in pages of at most 100). The **skill and source debrief are fixed** after creation; to move one, erase it and record it again. An edit based on an old version is refused, and she is asked to reload. | History is intelligible and nothing is silently rewritten or relinked. |
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
   - Save is disabled while that skill's save is in flight. A second click joins the save already in flight; it never creates a second observation.
   - **Whole-draft acknowledgment (M3-R8).** After a save, the form clears only if everything in it (wording, date, who said it, instructor name, and the skill and debrief it is bound to) is still exactly what was saved. Then only the wording clears; the date and attribution stay for the next note. If any field changed while the save was in flight, every field is kept and the same choices are offered. **Replace the saved wording with this** updates the saved observation to match the whole form. This applies equally to saving, replacing and saving as a new observation.
   - **After an uncertain save** (the app could not confirm it), trying again resolves the earlier save first. If she changed the wording meanwhile and the earlier save turns out to have gone through, it says *"Your earlier save had already gone through, so it was kept."* Everything she has in the form stays (wording, date, who said it and instructor name), with a line naming exactly what isn't saved, such as *"Not saved yet: your changes to the date."*, and two explicit choices: **Replace the saved wording with this** (an edit) or **Save it as a new observation**. If the earlier save went through and was later erased, nothing is recreated; her wording stays, with **Save it as a new observation**.
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
     - **View earlier versions:** every version, newest first, 20 per page (at most 100), with **Show older versions** until the first wording.
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
   - The list changed while paging (an edited date crossed the page boundary): "Your evidence changed while you were looking through it, so the list starts again from the newest." The list reloads from the first page; it never shows an observation twice or skips one.
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
   - **Receipt lookup.** A known id with the same hash → `replayed`, returning the stored result with no write. A different hash → `OPERATION_CONFLICT`. An erased tombstone → `ERASED`. The stored result is decoded exactly for its action (exact keys, value types and ranges) and must name the request's own subject; a damaged receipt is `STORAGE_FAILURE`, never returned as if it were true (M3-R5).
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
| Replay of a damaged receipt | `STORAGE_FAILURE`: a result naming another subject, or with missing, extra or mistyped fields, is never returned. |

## 7. Read contract

**`readEvidencePage({ skillId?, journalId?, attribution?, cursor?, limit })`:**
- Order: `observed_on` DESC, `created_at` DESC, `id` DESC. The order is chronological as before; it did not change.
- Page size: 1–50, default 20; outside that → `LIMIT_EXCEEDED`, enforced at the read boundary.
- Each item joins the current skill, debrief and action. The source fingerprint is recomputed only for the visible page.
- **Cursor (corrected, M3-R7).** An opaque, strictly validated JSON value: `[2, skillId, journalId, attribution, observed_on, created_at, id, fence]`.
  - **Bound to its normalized filters** (absent and empty are the same). Reusing it with other filters → `INVALID_ARGUMENT`. A forged or malformed cursor, or a fence beyond the current one → `INVALID_ARGUMENT`.
  - **Fence:** the highest receipt rowid when the page was read, read on the same serialized connection as the page. Receipts are never deleted, so rowids only grow.
  - **Before the next page,** every `edit_observation` committed after the fence is checked against the cursor. Each edit puts its observation on one side of the cursor before and after: *seen* (at or above it), *unseen* (below it) or *out* (not matching the filters). An edit that lands a still-matching observation on a different side → **`STALE_CURSOR`**, because it could repeat a row already shown or skip one never shown. A row re-entering the filters counts, because it may have been shown earlier.
  - **Harmless, so the cursor stays valid:** wording-only edits, date edits that stay on their side, edits in another list, leaving the filters, new rows and erasures. A newly recorded row newer than the cursor appears on the next first page (the controller refreshes after its own writes).
  - The controller treats `STALE_CURSOR` (or a refused cursor) by **restarting from the first page**, with a notice; it never appends a stale page. Deduplicating ids would not be enough, because it cannot recover a skipped row.
  - The check is conservative: a harmless re-entry below the cursor also restarts. Cursors are session-local; after a restore the app reloads.

**Plans** (node:sqlite, recorded in the receipts):
- Skill pages: `SEARCH o USING INDEX idx_skill_observations_skill_page (skill_id=? AND (observed_on,created_at,id)<(?,?,?))`.
- Full pages: `SCAN o USING INDEX idx_skill_observations_page`.
- Neither uses a temporary B-tree.
- Edits after a fence: `SEARCH skill_evidence_operations USING INTEGER PRIMARY KEY (rowid>?)`. The fence is the table's maximum rowid. No new index is needed and the candidate migration is unchanged.

**`readObservationHistory({ observationId, cursor?, limit })` (corrected, M3-R4):**
- One bounded page of revisions, newest first: 1–100 per page, default 20 (`LIMIT_EXCEEDED` outside). **100 is a page size, not a lifetime limit:** following `nextCursor` reaches revision 1, with no gap or repeat. Every stored revision is kept; there is no edit cap.
- Returns `{ observationId, currentRevision, items, nextCursor }`.
- Cursor `["history", observationId, beforeRevision]`, bound to the observation: another observation's cursor → `INVALID_ARGUMENT`; `beforeRevision` must be 2…current.
- Revisions are append-only, so newer revisions never move older pages.
- An erased observation → `ERASED`; an unknown one → `NOT_FOUND`. Absence is never confused with erasure.
- **API change:** the submitted `readObservationHistory(id)` returned at most the newest 100 revisions as an array. The review's frozen R4 diagnostic uses that legacy call and is kept unchanged; it now fails on the changed argument. The permanent equivalent follows pages to revision 1.

**Other reads:**
- **`readSkillSummary(skillId)`:** the latest status and confidence with their sequences, counts by attribution, distinct debriefs and the last observed date. Evidence is `none`, `limited` (< 3 observations, or < 2 debriefs) or `recorded`. No other derived field exists.
- `listSkills({ includeRetired })`.

## 8. Operation and publication ownership

[`prototype/evidenceController.ts`](evidence/m3-skills-evidence-scope-2026-10-10/prototype/evidenceController.ts) is the reference (corrected for M3-R1–R3).

**Reads**
- **Generation.** Each open of a skill and each first-page refresh starts a new read generation. Answers from older generations are dropped, so A→B→A shows only the last A answer. Late pages after a switch are dropped.
- **Older-page lock.** A second "Show older" waits for the first. Every first-page generation change (open, refresh, refresh after a save, restart) releases the lock, and the late older page is dropped.
- **Stale cursor.** A `STALE_CURSOR` restarts the list from the newest, with a notice.
- **Revision history** has its own generation and pages to revision 1.

**Writes.** There is one ownership record per form draft key.
- **Draft identity.** A record keeps the exact create request (operation id, observation id and content) until it is resolved. A second submit of the same content joins the request in flight, or returns its settled result, including while the refresh after it is pending. Acknowledgment alone never resets a draft; only an explicit new-draft transition does (the form does this when it clears the wording it saved).
- **Ownership by skill.** A write's notice, error, saving lock and follow-up refresh belong to the skill it was made for. A late answer for skill A never clears B's lock, announces on B or refreshes B. "Saving" is per skill on screen, not one global flag.
- **Uncertain outcome (lost acknowledgment, transport timeout).** It is resolved before anything new is sent:
  - **Same content:** the exact original request is resent, and the store replays it if it landed.
  - **Changed content:** the earlier observation id is read.
    - *Present* → the earlier save landed. The ids are minted for that request and can never be reused, so presence is proof.
    - *`ERASED`* → it landed and was erased. Nothing is recreated, and further sends are refused until she explicitly starts a new observation.
    - *`NOT_FOUND`* → this is **not** proof of failure, because the write may still be queued. The exact original request is replayed as a fence through the serialized writer: it either commits now or replays, and any delayed original then replays too.
  - Pending writes cannot coexist with a changed create: a changed submit waits for the in-flight request, then is decided.
- **Explicit outcomes.**

  | Outcome | Meaning |
  | --- | --- |
  | `saved` | This exact draft is stored. |
  | `earlier_saved` | An earlier submission is stored; the submitted wording was not sent. `justNow` says whether the fence stored it. |
  | `unknown` | Still undetermined; the draft and the original request are kept. |
  | `erased` | The earlier save landed and was erased. |
  | `refused` | Definitive; nothing was written. A refusal frees the next submission to use new ids. An id clash stays blocked with an explicit way forward. |

  `reviseSaved` (an edit with the saved revision) and `startNewDraft` are the explicit next steps. `savedContent(key)` returns what the key last stored, so the form can say exactly which fields are unsaved.
- **Form ownership (corrected for M3-R8).** These rules apply to all three submission paths (create, replace and save as new):
  - each submission captures the canonical fingerprint of the **complete** draft;
  - the live draft is updated synchronously in each field's change handler, never in an effect, so an answer that lands right after an edit still compares against what is on screen;
  - the form clears and starts a new draft only when the complete live draft equals the submitted one;
  - draft keys are scoped to the form instance, so a remounted form never inherits another instance's record;
  - an epoch counter and a mounted flag drop answers for an earlier draft or a gone form.
- **Refresh after an acknowledged write.** The write is never resent. If the refresh fails, the screen says it was saved and offers a read-only refresh.

**Confirmed erasure (corrected for M3-R10).** When a read or write answer says `ERASED` (opening or paging history, or a save whose earlier request was erased), that observation is evicted at once:
- its loaded revisions, cursor and current revision are cleared, and its pending history answers become obsolete;
- it leaves the visible evidence list, and the summary is re-read (reads only; nothing is resent);
- the history panel says "This observation was erased.";
- ids are never reused, so an erased id stays filtered from later list pages and history answers for the controller's lifetime.

A temporary read failure is **not** erasure: loaded versions and the cursor stay for retry, and unrelated observations are untouched.

**Lifecycle.** `activate()`/`deactivate()` are symmetric. The specimen declares the lifecycle effect before the load effect, so a StrictMode replay (setup → cleanup → setup on one instance) restores publication before loading. Requests from the replayed generation are dropped, and the live generation publishes. A real unmount leaves every late answer obsolete. A new client gets a new controller. StrictMode and meaningful cleanup are both kept.

The production hook (`src/state/useSkillEvidence.ts`) follows these rules. It also advances on `dataRevision`, so a debrief deletion elsewhere refreshes the visible page.

## 9. Migration, restore and older apps

- **Upgrade:** schema 13 → 14 adds only the M3 objects and the seeded catalog. **Every retained row is identical**, proven on a genuine library written by the shipped driver and repositories: debrief with action and question, practice attempt, rated card and split lineage. Proven on node:sqlite, sql.js and rusqlite.
- **A failed upgrade rolls back to 13 completely:** same rows, same `sqlite_master`, no version 14.
- **Validation at open and restore:** after the accepted 11/12/13 validators, the schema-14 check runs. Native: `verify_schema_14_skill_evidence_semantics`. TS: `validateSkillEvidenceState`. It requires:
  - exact columns, defaults, FKs, CHECKs, keys, indexes and **triggers**;
  - `foreign_key_check` clean;
  - built-in catalog equal to the shipped one (no unknown or missing ids, revision 1 text exact);
  - custom skills ≤ 200;
  - contiguous skill, observation and self-assessment histories whose latest entry equals the head (including the catalog version);
  - **catalog semantics on restored state (M3-R6):**
    - built-in label, description, topic and catalog version pinned in every revision and the head, with only retire/restore steps after revision 1;
    - custom revisions all the learner's, with no catalog version;
    - every later step one the write path can make: active→active changes wording (an edit), active↔retired keeps it, and retired→retired is refused;
  - **unique active names** under the write path's `labelKey` (NFC, JavaScript whitespace trimmed and collapsed, lower-cased), natively with the app's own `unicode-normalization` 0.1.25 and the same explicit whitespace set. Retired names may repeat, and a restore into an active name is refused;
  - no relinked debrief;
  - **receipts (M3-R5):**
    - each live receipt's result is decoded exactly for its action, names the receipt's own subject, and points at the history row (catalog revision, observation revision of the right change kind, or self-assessment) that this same operation wrote;
    - earlier receipts stay valid after later edits, a cleared status, or a deleted debrief or action;
    - tombstones are non-content observation receipts whose subject is gone, and a live erase receipt leaves no live receipt for its subject;
  - **history → receipt (M3-R9):** every operation-owned history row (user catalog revisions, observation revisions and self-assessments) must have the live receipt that wrote it: the same operation, an action of that family, the same subject and the same revision or sequence. Combined with receipt → history this is one-to-one, so a removed receipt or a reused operation id is refused. Catalog seeds (`changed_by` catalog, no operation) need none, and erased observations keep only their non-content tombstones;
- **Shared contract:** 85 validation cases (the original 25; 9 controls and 38 R5/R6 cases added on 11 October; then 1 control and 12 R9 `history-ownership` cases) and 29 constraint cases, with identical outcomes on all three engines.
  - For R9, hand-written controls that lacked their owning receipts were given them: the original `retired custom skill with history` control and the R6 helper-built cases.
  - A library written by the real candidate writer (`fixtures/writer-populated-schema14.sql`, regenerated byte for byte) is accepted on all three engines, and refused when any single history-owning receipt is removed.
- **Older binaries:** the shipped schema-13 TS driver refuses a 14 library ("newer format") and leaves its bytes unchanged. The shipped native ceiling test passes unchanged (receipt 09). The candidate refuses 15.
- **Backups:** format v2 still fits, because the database schema is bumped independently. A genuine schema-13 backup restores into the candidate and gains 14 with every row kept. Round trips node→node, node→sql.js, sql.js→node and the rusqlite backup API are byte-for-row identical. A backup with altered evidence is refused before anything would be replaced.

## 10. Prototype results (focused; source-level only)

### Remaining corrections M3-R8–R10 (11 October 2026)

Exact commands, output and exits are in the [remaining-corrections receipts](evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/README.md). The [report](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md) maps each finding to its fix and tests.

| Check | Result |
| --- | --- |
| Corrected submission reproduced (disposable copy) | 162 passed / 2 skipped; tsc clean; native 7. Re-review diagnostics: 6 failed / 1 outage control passed (TS/UI) and 1 failed / 1 control passed (native) |
| Final prototype Vitest (13 files) | **192 passed**, 3 opt-in skipped (benchmark and two fixture regenerators), exit 0 |
| Strict typecheck | exit 0 |
| Native crate (fresh target) | **8 passed** |
| Shared contract | 85 validation + 29 constraint cases, identical on node:sqlite, sql.js and rusqlite. The real-writer library is accepted on all three and refused without any of its history-owning receipts |
| Re-review's frozen diagnostics, current source | **7/7** TS/UI and **2/2** native pass |
| New tests on the corrected submission | 24 TS failures (10 passes are controls or already-correct guards); natively, 11 of the 12 new R9 negatives wrongly accepted and the writer-library test fails |
| Sensitivity | **17 of 17 decisive reversions caught** by behaviour assertions. One further reversion (live draft published from an effect) is an *equivalent* mutant under React 19, which flushes discrete-input effects synchronously; it is reported, not counted. All files restored |
| Restore validation timing | about 3–9% slower than before (257.9 ms at 10,000 observations on node:sqlite, was 244.9); pages unchanged |


Exact commands, output and exits are in the [corrections receipts](evidence/m3-skills-evidence-scope-corrections-2026-10-11/receipts/). The [report](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md) maps every finding to its fix and tests.

| Check | Result |
| --- | --- |
| Frozen submission reproduced (disposable copy) | 102 passed / 2 skipped; tsc clean; native 7 passed; review diagnostics 17 failed / 4 passed (TS/UI) and 3 failed / 2 passed (native), exactly as reviewed |
| Corrected prototype Vitest (10 files) | **162 passed**, 2 opt-in skipped, exit 0 |
| Corrected strict typecheck | exit 0 |
| Corrected native crate | **7 passed**, exit 0. The shared contract is now 72 validation + 29 constraint cases, with identical outcomes on node:sqlite, sql.js and rusqlite |
| Review's frozen native diagnostics on the corrected code | **5 passed** |
| Review's frozen TS/UI diagnostics on the corrected code | **18 passed / 3 failed.** The two R4 cases call the replaced legacy `history(id)` (documented API change; the paged equivalent passes). R2a's own setup sends an invalid erase request (`expectedRevision` instead of `confirm: "erase"`) that the submitted decoder also refused. With only that argument corrected, R2a fails on the frozen code (the observation is recreated) and passes on the corrected code |
| New regressions on the frozen code | 53 of 65 fail (the 12 that pass are positive controls); natively, 37 of the 38 new negative fixture cases are wrongly accepted |
| Reversions | 32 variants on the corrected code. The 9 original S1–S8 variants: 8 caught, and S4a still masked by `ConnectionOwner`'s rollback. **23 new variants (18 TS, 5 native): all caught** by their named tests |
| Candidate 0014 and production anchors | Candidate byte-identical to the submission; 30/30 anchors identical to `48fa47d` and `origin/main` |

**Benchmarks after correction** (same dataset and method; full data in the corrections pack's `bench-results.json`):

| Engine | Observations | Page of 20 median (was) | Full walk at 50, per page (was) | Restore validation (was) | Second page after 100 edits since its fence |
| --- | --- | --- | --- | --- | --- |
| node:sqlite | 100 | 0.125 ms (0.111) | 0.328 ms (0.239) | 17.2 ms (11.4) | 1.26 ms |
| node:sqlite | 10,000 | 0.111 ms (0.102) | 0.202 ms (0.186) | 244.9 ms (167.2) | 1.22 ms |
| sql.js | 10,000 | 0.236 ms (0.233) | 0.497 ms (0.480) | 380.7 ms (261.6) | 1.96 ms |

- **Pages** stay flat with size; the fence adds one maximum-rowid lookup.
- **The stale-cursor check** costs about 0.012 ms (node:sqlite) or 0.02 ms (sql.js) per edit committed since the previous page.
- **Restore validation** grows about 45%, to roughly 24 ms per 1,000 observations on node:sqlite and 38 ms on sql.js, because every receipt's owned row is looked up. It stays linear. These runs also include 100 extra edits.
- **History:** 1,000 revisions walk to revision 1 in 10 pages of 100 (median 0.13 ms on node:sqlite, 0.31 ms on sql.js).

### Original submission results (10 October 2026)

Exact commands, output and exits are in [`receipts/`](evidence/m3-skills-evidence-scope-2026-10-10/receipts/). The review's findings supersede these readiness claims.

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

- **R8 timing is safe by construction, not by a distinguishing test.** The live draft is updated in each change handler. The alternative (publishing it from an effect) behaves identically under React 19 and jsdom, because discrete-input effects flush synchronously, so no rendered test can tell them apart.
- **R9 preserves the review's frozen control unchanged.** The frozen built-in retirement control lacks its owning receipt, so it is now refused. A derived copy with that one receipt added passes on all three engines.
- **Corrections are source-level.** The controller, form and history view are proven on real node:sqlite and sql.js stores and in jsdom, including real `React.StrictMode`. The native readers (paged history, fenced cursors) and the native writer are specified in the implementation prompt, not built.
- **The stale-cursor check is conservative.** An edit that brings a row back into a filtered list below the cursor restarts the list even when that row was never shown. Cursors are session-local, and a restore reloads the screen.
- **Case mapping follows each runtime's Unicode tables.** `labelKey` lower-cases with JavaScript (V8/ICU) and Rust `std`. The shared fixtures prove parity for NFC, whitespace (including U+0085 and U+FEFF), German ß and Greek final sigma, but characters newer than one runtime's Unicode version could differ.
- **Two frozen diagnostics cannot pass as written:**
  - R4 uses the replaced `history(id)` API; the paged equivalent is a permanent test.
  - R2a's setup erase is invalid under the submitted contract. A copy with that single argument corrected is in the corrections pack, and the frozen file is unchanged.
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
