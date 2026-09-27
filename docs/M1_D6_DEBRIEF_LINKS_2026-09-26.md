# M1 D6 — Connect improvement → action → study material → instructor question

_Prepared 26 September 2026, corrected 27 September 2026 · Branch: `feature/m1-d6-debrief-links` · Base: `0ad0a578eca73e43dc48438bd4ed3278053433bc` (D5, PR #34)_

**Status:**
- **Implemented:** the first independent review's four findings are corrected.
- **Waiting on:** another independent review.
- **Not done:** nothing is committed, and no installed-app verification has been performed on Windows or a Mac.

## 1. What she can do

In the debrief form (quick or full), she can:
- turn "What was difficult?" or "Instructor feedback" into a proposed action;
- edit the action, accept it into her Flight Plan, and link a Study Library material;
- save the debrief's question to the Questions list;
- link that question to a material and carry it to an upcoming lesson.

Nothing is accepted without her ticking the box. There is no AI interpretation, and no proficiency change.

Where the links surface:
- Linked actions appear under the material (`actionsFor(..., "material", id)`).
- Carried questions appear in that lesson's preparation (`lessonPreparation`).

## 2. The save contract (finding 1)

There is one canonical operation, used unchanged by:
- the form;
- `DebriefSaveOperation` in `src/data/db.ts`;
- the Tauri adapter (`invoke("save_debrief_operation", { operation })`);
- the Rust `DebriefSaveOperation`;
- the browser/test transaction in `src/data/debriefTransaction.ts`.

```text
{ operationId, targetId,
  journal: { eventId, date, title, …, goalId, materialIds },   // no journal.id
  action: { id, title, materialId } | null,
  withdrawActionId: string | null,
  question: { id, text, eventId, materialId } | null,
  withdrawQuestionId: string | null }
```

- Removed contradictory fields:
  - `isNew`: sent but never read. Existence in the database decides insert versus update.
  - Rust's `journal.id` and `withdrawn*` expectations are gone.
- The Rust structs use `deny_unknown_fields`, so any future drift fails loudly instead of deserializing to `None`.
- **Fixtures captured from the real form:** `src/pages/FlightJournal/debriefContract.test.ts` drives the real `JournalForm` through:
  1. create;
  2. a lost-response retry;
  3. a deliberate edit;
  4. action withdrawal;
  5. question withdrawal.

  It captures each operation exactly as the form hands it to the driver. Generated ids and the date are normalized, and the result must equal `src-tauri/fixtures/debrief-contract/0{1..4}-*.json`. The Rust tests deserialize those same files into `DebriefSaveOperation` and run them through the native transaction.
- **Parity:** both implementations run the fixtures plus identical seed and "later progress" SQL, and must produce the rows in `expected.json`. That covers the journal, links, actions, questions, provenance and ledger, excluding timestamps.
- **Defaults** for a newly accepted action or question are the same on both sides and match the pre-D6 form:
  - action: `prepare` / `next_up` / `open`;
  - question: `general` / `to_ask` with an empty answer.
- Both write ISO timestamps with milliseconds.

## 3. Retry versus deliberate edit (finding 2)

- **Retry.** `operationId` identifies one exact save.
  - The form stores `{ id, fingerprint }` in the draft before any database write.
  - It reuses the id while the operation's content is identical.
  - An id that has already committed is recorded in `debrief_operations`; replaying it changes nothing at all.
  - So a retry after an interrupted response can't undo completion, answers or any later edit.
- **Deliberate edit.** Any change to the content makes a new operation, which:
  - writes the journal as shown in the form;
  - on an action this journal owns, writes only the title and material;
  - on a question it owns, writes only the text, lesson and material.

  Status, completion, answers, answer date, topic, priority, category, description, due date and estimate are never written on update.
- **Distinct operations** with identical text have different ids and stay separate records.
- **Ownership at the database boundary.**
  - An existing action or question id that isn't owned by this journal is refused, and the whole operation rolls back.
  - Withdrawal deletes only a record this journal owns.
  - Ownership checks are null-safe.
  - A failed existence query is an error, never treated as "not found".

## 4. Deletion and provenance (finding 3)

Migration `0010_debrief_links.sql` (unshipped; checksum re-registered in `src/data/migration-checksums.json`; registered in both Rust and TypeScript) adds:
- `next_actions.material_id` (`ON DELETE SET NULL`) and its index;
- provenance columns: `next_actions.source_material_id`, and `questions.source_journal_id`, `source_material_id` and `source_event_id`;
- `BEFORE DELETE` triggers on `journal_entries`, `study_materials` and `schedule_events`, which copy the id into the provenance column before the foreign key clears the link;
- the `debrief_operations` ledger.

Behaviour:
- **Nothing cascades.** The action and question survive, and the action keeps `related_type = 'journal'` and its `related_id`.
- **The UI tells "never linked" apart from "linked record deleted".** It shows:
  - "Source entry unavailable", "Source material unavailable" and "Source lesson unavailable" on the Questions page;
  - "Material: … unavailable" and "Lesson: … unavailable" on the debrief page.

  A question that was never linked shows none of these.
- **A deliberate relink clears the stale provenance:**
  - through the debrief save, when the link actually changes;
  - through `questionRepository.update` and `actionRepository.update`.

  Re-saving with the link unchanged keeps it.

## 5. Validation gaps corrected (finding 4)

- **Complete backup:** `complete_backup_export_validation_and_restore_keep_debrief_links` (Rust) runs the real sequence: `create_consistent_complete_backup_with_retry` → `inspect_archive` → `stage_complete_restore_in` → `apply_pending_restore_in`. The restored rows equal the original, including the provenance of a deleted lesson. Complete backups exist only in Rust. The frontend test that copies the SQLite file is now labelled as a file copy, not a backup.
- **No false success:** `journalRepository.saveAtomically` refuses before any write when the driver has no atomic support. Two regressions prove it:
  - test 11: the repository rejects and nothing is written;
  - test 12: the form shows "Unable to save debrief right now", stays on the page, and nothing is saved.
- **No installed-app claim:** the earlier note's claim of physical Windows installed-app verification is removed. Integration tests are not installed-app evidence, and no installer was built or run for this change.

## 6. Tests

| Test | Proves |
| --- | --- |
| `debriefContract.test.ts` › create, lost-response retry, deliberate edit, and both withdrawals | Real form payloads equal the fixtures. The retry reuses the operation id. Every operation has exactly the canonical keys, and there is no `journal.id`. |
| `debriefContract.test.ts` › replays the captured fixtures through the browser transaction | Replay after completing and answering changes nothing. The deliberate edit preserves progress. Both withdrawals work. The rows equal `expected.json`. |
| `debriefLinks.test.ts` 1–5, 7–8 | Existing workflow, idempotency, rollback, reopen, ownership and preparation integration (updated to the new contract) |
| `debriefLinks.test.ts` 6 | Real repository deletions of material, debrief and lesson with foreign keys on. The records survive, provenance is kept, exactly one label of each kind shows, a never-linked question shows none, and a relink clears provenance. |
| `debriefLinks.test.ts` 9 | A copied database file reopens with links (labelled as a file copy) |
| `debriefLinks.test.ts` 10 | The debrief page shows deleted material and lesson as unavailable |
| `debriefLinks.test.ts` 11–12 | An unsupported driver can't report success |
| Rust `frontend_contract_fixtures_persist_the_same_rows_as_the_browser_transaction` | The native transaction on the real payloads gives the same rows as the browser |
| Rust `contract_rejects_the_old_and_drifted_payload_shapes` | `isNew`, `journal.id`, `withdrawnActionId` and a missing `operationId` are all rejected |
| Rust `both_withdrawal_fixtures_carry_the_ids_into_rust` | Withdrawal ids arrive as `Some`, not `None` |
| Rust `retry_after_a_committed_operation_changes_nothing` | Interrupted-response retry after commit |
| Rust `distinct_operations_with_identical_text_stay_distinct` | Identical-text operations stay separate |
| Rust `a_request_cannot_overwrite_or_delete_a_record_it_does_not_own` | Ownership refusals, with full rollback |
| Rust `references_that_no_longer_exist_degrade_to_no_link` | Missing references become no link |
| Rust `a_failure_part_way_through_rolls_back_the_whole_operation` | An injected trigger failure leaves nothing behind |
| Rust `a_held_write_lock_fails_within_the_busy_timeout` | A held lock fails boundedly |
| Rust `normal_deletions_keep_the_records_and_remember_the_deleted_source` | Real deletions with foreign keys on |
| Rust `choosing_a_new_link_replaces_the_deleted_source_provenance` | Relink semantics |
| Rust `complete_backup_export_validation_and_restore_keep_debrief_links` | Real complete-backup round trip |

### Reproductions (mutation checks)

Each defect was reintroduced temporarily, the tests run, and the files restored and byte-compared afterwards.

| Defect reintroduced | Failing tests |
| --- | --- |
| Update resets status (the review's reproduction) | Rust parity |
| Replay ledger ignored | Rust retry, Rust parity |
| Unknown fields accepted | Rust contract rejection |
| Rust expects `withdrawnActionId` | 8 Rust tests |
| Material-deletion provenance trigger disabled | Rust deletion and relink |
| False-success fallback in `saveAtomically` | Frontend 11 and 12 |
| `isNew` put back into the form payload | Contract capture |
| Browser update resets status | Browser parity |

## 7. Verification (27 September 2026, Windows x64)

These are implementation checks, not an independent review.

| Command | Result |
| --- | --- |
| `npx vitest run src/pages/FlightJournal/debriefLinks.test.ts src/pages/FlightJournal/debriefContract.test.ts` | 14 passed |
| `npm test` | 54 files passed, 2 skipped; 528 passed, 2 skipped |
| `npm run build` | `tsc --noEmit` and `vite build` succeeded |
| `cargo fmt --check` (from `src-tauri`) | Clean |
| `cargo clippy --all-targets -- -D warnings` (from `src-tauri`) | Clean |
| `cargo test` (from `src-tauri`) | 153 passed, 2 ignored (benchmarks) |
| `git diff --check`, plus a whitespace and conflict-marker scan of new files | Clean |

## 8. Remaining limitations

- **Installed app:** not tested on Windows or a Mac. The native command is proven through `save_debrief_operation_at` and serde. The Tauri IPC layer itself (argument key `operation`) isn't exercised by an automated test.
- **Deliberate edits win:** a deliberate debrief save writes the action title and material, and the question text and links, as shown in the form. That overrides an edit made elsewhere between opening the draft and saving it. Exact retries never do.
- **Ledger growth:** the `debrief_operations` ledger grows by one small row per successful debrief save and is kept in backups. It has no foreign key, so deleting a debrief leaves its ledger rows.
- **Not in scope:** D7 (end-to-end acceptance and demo). The Windows release hold is unchanged.

## 9. Manual Windows and Mac checklist (not yet performed)

1. Quick debrief: turn "What was difficult?" into an action, edit it, accept it and link a material. Save a question, carry it to an upcoming lesson and link a material. Save.
2. The material page lists the action. The lesson's preparation lists the question. Questions shows all three links.
3. Complete the action and answer the question. Then reopen and edit the debrief and save. The completion and the answer remain.
4. Delete the material, then the lesson, then the debrief. The action and question remain, with "unavailable" labels.
5. Make a complete backup in Settings, restore it, and confirm the links and "unavailable" labels are unchanged.

Independent review on 27 September: 98 focused frontend tests and 12 native debrief tests passed, including the real complete-backup restore round trip. Shipped migrations were unchanged and diff checks passed. Approved for the PR/CI gate; installed Windows and Mac behavior remains unverified.
