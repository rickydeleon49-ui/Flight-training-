# GEN-REL-02 implementation report: recoverable background jobs and checkpoints

**Status:** implemented by Claude on 18 October 2026, pending Codex review. Under the owner's GEN-REL instruction, it merges after a GREEN Codex review and green exact-head CI.

## Identity

- Worktree `/Users/rickymac/code/Flight-training-gen-rel-02`, branch `claude/gen-rel-02`.
- Base: main 36c5d48, which is the GEN-REL-01 merge (PR #212).
- Node 22.23.3, with `SDKROOT` scoped to MacOSX26.5 for cargo.

## What changed

**A generation belongs to the app, not the page.**
- `src/state/GeminiJobs.tsx` is an app-wide job store, mounted inside `AppDataProvider`, so it lives as long as the app data.
- `MaterialDetail` no longer owns generation. It shows the job for its own material, and starts jobs through the store.
- The shared lock is taken synchronously before any await, as before, but now spans every screen. The native journal enforces it as well (`BUSY`).

**Source-bound saves.** An answer is saved to the material it was made from, only if all of these still hold:
- the material still exists;
- its `filePath` is unchanged (checked inside the `mutate` write queue, so no edit can slip in between);
- the stored bytes still match the SHA-256 of the bytes that were sent (`contentSha256`, now returned with every answer), where native fingerprints are available.

If any check fails, nothing is saved and she is told. The previous rule, "a result that arrives after leaving its material is discarded", is replaced by this stricter binding. The guards against a replaced attachment and a deleted material are kept and now apply wherever she is.

**Checkpoints.**
- `src-tauri/src/gemini_jobs.rs` is a native journal (`gemini-jobs.json` in the app data folder, beside the key file).
- It records each generation as `running`, then `ready` (with the validated answer), `failed` or `interrupted`.
- A failed save keeps the answer and offers **Save again**, which uses the checkpoint and never calls Gemini.
- A waiting answer disables **Create/Regenerate** for that output until she saves or discards it, so it is never overwritten.
- After a successful save or a dismissal, the job is acknowledged and removed from the journal.

**Restart and reload.**
- The journal is opened once per data folder per process.
- Anything still `running` at that point was cut off by the app closing. It becomes `interrupted`, is shown as such, and is never resent, because nobody knows whether Google finished or charged for it.
- A `ready` answer waits for a deliberate **Save** or **Discard**.
- A job still running after a window reload holds the lock and is followed through the `gemini-job` event until it finishes.

**Lifetime safety.** `RunningJob` marks a job failed if its work stops without an outcome (a dropped future, a panic), so the lock can never stay held until restart.

**Durable format.**
- `{"schema":"hfd-gemini-jobs/1","jobs":[…]}`, written to `.writing` and renamed over the target.
- An unreadable file, or one with the wrong schema, is renamed to `gemini-jobs.unreadable.json`, never trusted or deleted.
- Bounded: 8 jobs (a ready answer is given up last, and a running job never), 2 MB per answer, a 16 MB file.
- Identities are validated on the way in and out.
- It holds no key, provider file name or URI, upload id or document bytes.
- It is not part of a backup: `backup.rs` archives only the manifest, the database, its log and `documents/`. No SQLite migration.

## Acceptance map

| Plan requirement | Evidence |
| --- | --- |
| Jobs observable while changing pages; navigation A→B→A and unmount | `MaterialDetailJobs.test.ts`: "A → B → A: the job stays visible on A…", "leaving the material page entirely does not discard the answer"; updated lock tests in `MaterialDetailGemini.test.ts` |
| Source replacement or deletion, and stale targets refused | "a material deleted while Gemini works receives nothing…", "changed file contents at the same path are detected…", "a recovered answer for a material whose file was replaced is not saved", plus the existing "attachment is replaced" test |
| A completed checkpoint retries saving without another provider call; duplicate saves | "a failed save is retried from the checkpoint without asking Gemini again…" (double click; `generateStudyAid` called once; acknowledged once) |
| App-restart reconstruction; interrupted outcomes are honest; no silent resend | native: `a_job_running_when_the_app_closed_is_interrupted_not_resent`, `a_validated_answer_survives_a_restart_as_a_checkpoint`; page: "after a restart a finished answer waits for a deliberate save…", "…shown as interrupted and never resent", "a job still running after a reload holds the lock…" |
| Concurrent jobs | native `only_one_job_runs_at_a_time_whatever_page_asked`, `while_one_job_runs_another_is_refused_before_anything_is_sent`; the existing cross-material lock tests |
| Missing credentials or a refusal | "a refused generation is explained, saves nothing and frees the lock"; native `a_failed_generation_is_recorded_and_frees_the_lock` |
| Previous content and history retained | the save-failed test keeps "Old guide" visible; the existing `MaterialDetailOffline` and `SourceChoice` failure tests |
| Durable-format safety and privacy | `an_unreadable_journal_is_set_aside…`, `recorded_identities_are_checked…`, `the_journal_is_replaced_whole…`, `asking_again_replaces…and_the_journal_is_bounded`, `an_answer_too_large_to_keep_fails_honestly`, `a_finished_generation_is_checkpointed…nothing_secret` |
| No stuck lock | `work_that_stops_without_an_outcome_does_not_hold_the_lock` |

## Gate

The receipts are in `docs/evidence/gen-rel-02-2026-10-18/gate/`. The results are summarized in the evidence README.

## Limits

- Live-provider and installed-Mac behavior are UNVERIFIED. This includes WKWebView reload timing and the Tauri event delivery after a reload.
- Mid-token resume is not attempted: an interrupted job needs a deliberate new request.
- Retry policy, budgets and attempt limits are GEN-REL-03. Cancel and progress UX are GEN-REL-04.
- In browser mode, fingerprints are unavailable and the file-path binding alone applies (Gemini is disabled there anyway).

## Review round 1 corrections (18 October 2026)

Codex round 1 (`docs/evidence/gen-rel-02-2026-10-18/review-r1/codex-review-round1.md`) was RED with eight blocking findings. Corrected gate receipts are in `review-r1/01…10`. The first typecheck and build runs failed on three test-file type errors and are kept as `01a`/`03a`.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R1: a failed journal write left a `running` record that held the lock | Every journal change is written first (`commit`) and only then made in memory. A failed write changes nothing | `r1_a_job_that_cannot_be_written_down_never_holds_the_lock` |
| R2: a failed checkpoint write was reported as success | `settle` propagates the failure and releases the job (`abandon`). `JobAnswer.checkpointed` is false and `jobId` is none. The window then says Save again works only while the app stays open, and a restart never presents that job as a saveable answer | native `r2_a_checkpoint_that_cannot_be_written_is_reported_and_releases_the_lock`, `r2_an_answer_that_cannot_be_checkpointed_is_handed_over_marked_as_not_kept`; page "R2: an answer that could not be kept natively…" |
| R3: save and acknowledgement were not idempotent across a restart | Each job records the `updatedAt` of the content she asked to replace (`baseRevision`, kept in the journal). A save is refused if anything newer was saved since. An answer that already equals the saved content is recognized as already saved (on save and on recovery), so it is never saved twice. A failed acknowledgement is retried later (`pendingAcks`), and the native acknowledgement is written first | native `r3_an_acknowledgement_that_cannot_be_written_can_be_retried`, `r3_the_revision_a_job_was_asked_to_replace_is_kept_with_it`; page "R3: an answer already saved before the app closed…", "R3: something saved while Gemini worked is never overwritten", "R3: a recovered answer whose base was replaced since…", "R3: an acknowledgement that fails is retried later" |
| R4: recovery after a reload could miss the only completion event | The change listener is installed before the snapshot, a final reconciliation follows it, and a running job found after a reload is also checked every 3 s | "R4: a job that finishes between the snapshot and the listener…", "R4: a change event that arrives while the snapshot is pending…", "R4: a running job is followed on a timer…" |
| R5: dropped work did not notify a reloaded window | `RunningJob` emits the change on drop as well as on finish | `work_that_stops_without_an_outcome_does_not_hold_the_lock` now asserts the event |
| R6: a new request could erase a waiting checkpoint before recovery finished | Natively, `begin` refuses with `WAITING` while a ready answer exists for that material and output. In the window, nothing starts until recovery is `ready`; if recovery fails she is told and can **Check again** | native `r6_a_waiting_answer_is_never_replaced_by_asking_again`; page "R6: nothing starts while…", "R6: if earlier work cannot be read back…" |
| R7: the content check ran outside the write queue | The material, path, fingerprint and revision checks all run inside the queued `mutate`, immediately before the write | "R7: a file changed while the save waited in the queue…" |
| R8: a restore did not invalidate jobs | When a backup restore is installed at startup (`lib.rs`), `gemini_jobs::clear_after_restore` empties the journal (or removes the file if it cannot be rewritten) before the window opens | `r8_restoring_a_backup_forgets_every_job_of_the_replaced_library` |

Pre-fix proof for the frontend corrections: with the round-1 `GeminiJobs.tsx` swapped in temporarily, all 11 new page regressions fail (`review-r1/prefix-frontend-regressions.log`). The fixed file was then restored, and `cmp` confirms it is byte-identical. The native regressions use the corrected signatures (`begin` now takes `base_revision`), so their pre-fix behavior is shown by the round-1 reproductions.

Corrected results: npm 3,670 passed / 6 skipped, cargo 607 passed / 6 ignored, typecheck, build, strict Clippy, fmt, cargo-lock, helper 26/26, protected paths unchanged.

## Review round 2 corrections (18 October 2026)

Codex round 2 (`review-r2/codex-review-round2.md`) was RED. It confirmed R1, R2 and R5 fixed, and R6 and R7 fixed for their sequences. It found R3, R4 and R8 incomplete, and raised R9–R13. The corrected gate is in `review-r2/01…10`, all EXIT 0: npm 3,673 passed / 6 skipped, cargo 610 passed / 6 ignored.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R9 (completes R3): acknowledgement failures were invisible and retried only on unrelated events | **Discard or Dismiss** finishes only once the journal records it. If that fails she sees "might come back after the app restarts" with **Try again**, and the draft keeps blocking a new request. Acknowledgements after a save are retried on a 3 s timer until written. Jobs saved or dismissed here are never shown again, whatever an older snapshot says | page "R9: a discard the journal could not record…", "R9: after a save, a failed acknowledgement is retried on its own…" |
| R10: the capacity bound could evict a waiting answer | Only failed or interrupted records make room. If all eight slots hold waiting answers, `begin` refuses with `FULL` before anything is sent | `r10_a_full_journal_of_waiting_answers_refuses_a_new_request_and_loses_none` |
| R11 (completes R8): restore invalidation sat outside the restore lifecycle | `backup.rs` forgets Gemini jobs as part of a committed restore, both on the immediate path and when an interrupted committed restore is resumed at launch. The restore journal is removed only after that succeeds, so a failure or interruption is retried at the next launch. `clear` reports success only if no old job can be read back (rewritten empty, or removed). The earlier `lib.rs` hook is removed | backup `a_committed_restore_forgets_gemini_jobs_even_after_an_interruption` (folder-scoped failure switch); `r11_clearing_succeeds_only_when_no_old_job_can_be_read_back`, `r8_restoring_a_backup_forgets_every_job_of_the_replaced_library` |
| R12 (completes R4): concurrent reconciliations could overwrite newer state | Reconciliations run one at a time. Their slow reads happen first, then the merge is made against the current state, skipping anything this window saved or dismissed | page "R12: a slow, older snapshot never brings back an answer already dismissed" |
| R13: calling without a material bypassed the native lock | `materialId` is required by both commands, and `as_job` always records. The test that preserved the bypass is replaced | `r13_every_generation_is_recorded_so_none_can_bypass_the_lock` (both orders: another material, and another output for the held material) |

**Applied identity (R9).** No migration was added for this, and the reasoning is as follows. A save writes the answer as the material's whole saved content in one statement (study guide) or one native transaction (practice test). Recovery treats an answer as applied exactly when the saved content equals it. Re-applying identical content would change nothing, so content equality is the idempotency key for this operation. It is backed by the revision check, so an answer is never saved over anything saved after she asked.

One residual case is known and is not harmful. Suppose a save's acknowledgement never succeeds while the app runs, and newer content is saved later in that same session. After a restart, the old answer is then shown as "Something newer was saved…", and it is never written. Making this exact would need a schema-16 migration, which is left for review rather than adopted inside a correction round.

Pre-fix proof: with the round-2 `GeminiJobs.tsx` swapped in temporarily, the three new page regressions fail (`review-r2/prefix-frontend-regressions.log`). The fixed file was restored and is byte-identical (`cmp`).

## Review round 3 correction (18 October 2026)

Codex round 3 (`review-r3/codex-review-round3.md`) confirmed R1–R7, R9, R10, R12 and R13 fixed, and accepted the content-equality decision for R3/R9. One blocking finding remained.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R14 (completes R8/R11): when clearing failed, startup continued and the old checkpoints were still usable | The journal has a **quarantine** that acts as a lasting boundary. A journal opened beside a restore marker (`restore-journal.json`, which the restore keeps until clearing succeeds), or whose clearing failed, offers no jobs (`list` is empty), acknowledges nothing and starts nothing (`RESTORING`). Only a successful clear lifts it. If clearing fails, the quarantine lasts the whole launch, so the next launch's retried clear can never remove answers made in the meantime. The rest of the app opens normally | backup `a_committed_restore_forgets_gemini_jobs_even_after_an_interruption` (now asserts that during the failed launch nothing is offered, acknowledged or started, and that it is normal after a successful retry); `r14_a_journal_beside_an_unfinished_restore_offers_nothing_until_cleared`; `r14_a_clear_that_really_fails_keeps_the_launch_quarantined` (a real read-only folder, with the file still on disk but never offered) |

The new tests use the new `RESTORING` contract, so their pre-fix failure is shown by the round-3 reproduction. Gate (`review-r3/01…10`), all EXIT 0: npm 3,673 passed / 6 skipped, cargo 612 passed / 6 ignored.

## Review round 4 corrections (18 October 2026)

Codex round 4 (`review-r4/codex-review-round4.md`) confirmed R1–R14 fixed. It raised one blocking finding and one non-blocking finding. Gate (`review-r4/01…10`), all EXIT 0: npm 3,676 passed / 6 skipped, cargo 613 passed / 6 ignored.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R15 (blocking): an answer for a deleted material had no reachable controls and could fill the journal | `src/components/gemini/GeminiOrphanNotices.tsx`, rendered by `AppShell` above every screen, lists finished, failed or interrupted jobs whose material no longer exists. It says plainly that nothing was saved, and **Dismiss** acknowledges the job, which frees its journal place. A dismissal the journal could not record shows **Try again** (the same path as R9). Running jobs are not listed, because the material page and the lock already cover them | page "R15: an answer for a material deleted mid-generation is shown everywhere and can be dismissed", "R15: after a restart, orphaned answers are offered for dismissal…" (including an acknowledgement failure, then a retry), "R15: the app shell shows orphaned answers above every screen" |
| R16 (non-blocking): the writer did not enforce the journal's total size bound | `write` refuses any journal larger than the reader accepts, so the earlier file and every checkpoint in it stay intact. A refused checkpoint is then reported as not kept (R2) | `r16_a_journal_too_large_to_read_back_is_never_written` (near-limit answers; everything kept reads back after a restart; nothing is set aside) |

The R15 tests depend on the new component, and R16 on the new bound, so their pre-fix failure is shown by the round-4 reproductions.

## Round 5: GREEN, and integration (18 October 2026)

Codex round 5 (`review-r4/codex-review-round5-green.md`) confirmed R1–R16 fixed and raised no new findings. The trackers gained the acceptance entry, and the current schema-14 manifest was rebound to them. The helper suite was then run again (`review-r4/11-…log`). Under the owner's GEN-REL instruction, Claude merges once exact-head CI is green.
