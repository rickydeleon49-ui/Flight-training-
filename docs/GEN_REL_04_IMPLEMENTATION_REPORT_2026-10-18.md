# GEN-REL-04 implementation report: honest progress, Cancel and stage-appropriate recovery

**Status:** implemented by Claude on 18 October 2026, pending Codex review. Under the owner's GEN-REL instruction, it merges after a GREEN Codex review and green exact-head CI.

## Identity

- Worktree `/Users/rickymac/code/Flight-training-gen-rel-04`, branch `claude/gen-rel-04`.
- Base: main 49ac022, which is the GEN-REL-03 merge (PR #215).
- Node 22.23.3, with `SDKROOT` scoped to MacOSX26.5 for cargo.

## What changed

**Job-scoped, honest progress.** Every `gemini-progress` event now carries the job it belongs to: its `jobId` once the job has begun, its `materialId` and `kind`, the stage actually reached, any message, the attempt in progress and the maximum.
- Stages come from the one budget (`Budget::observe`, called outside its locks): preparing, uploading, Google preparing the PDF, checking the uploaded PDF, waiting for Gemini, receiving, checking the answer, pausing. "Saving" is the window's own phase.
- The window shows a progress line only beside its own job, matched by id, or by material and output before the id is known.
- `GeminiProgressView` shows the stage in her words, the attempt once there has been a retry ("attempt 2 of 3"), and the elapsed time. It is an `aria-live="polite"` status. There is no percentage, because nothing measures Gemini's own progress.

**Cancel.** A real, keyboard-reachable **Cancel** button sits beside the progress.
- **Atomic decision.** Whether a job is cancelled or completes is decided once, in the journal, under its lock and on disk first. `Journal::cancel` acts only on a job that is still running, and the journal's own completion (`settle`) likewise acts only on a running job.
- **Only then is the work stopped.** `cancel_gemini_job` → `cancel_job` wakes the job's work through `gemini_cancel`. Its `Cancellable` wrapper drops the work at once, so requests in flight are abandoned and the existing lease and flight guards run.
- **Cancelled jobs.** A job recorded as cancelled hands over nothing, even an answer that had just arrived. `JobStage::Cancelled` survives a restart and is never resent, and a cancelled job can be evicted like a failed one.
- **Cancel at any point.** A cancel during the local checks sends nothing at all. A cancel asked for before the job has its native id is sent with the job's first event.
- **Honest wording.** The cancel message does not promise that Google had not already received or processed a request sent before it.
- **Completion first.** If the answer completed before the cancel, the cancel reports `ready`. The window then offers the answer to save or discard ("Gemini finished … before your cancel reached it"); it never saves it by itself.

**Stage-appropriate recovery.** After a failed, cancelled or interrupted generation, **Try again** goes through the usual Send confirmation. A PDF still prepared with Google is reused, so only the generation is repeated. A failed save keeps GEN-REL-02's **Save again**, which uses the checkpoint and never calls Gemini.

**GENREL03-R1.** `lookup` sets its own stage ("checking the uploaded PDF") and records the HTTP status before any early return, so the failure details name a file check correctly.

**Two corrections found while testing:**
- **Recovery mistook this window's own job.** A job this window started now learns its native id early, from its first progress event, so the reload-recovery logic, which follows running jobs that have an id, would have treated it as a job found after a reload. Local jobs are marked `local` and are exempt from reconciliation and the follow-up timer. Regression: "this window's own job is never mistaken for one found after a reload", which fails without the exemption (`prefix-local-job-recovery.log`).
- **Try again appeared only after an unrelated event.** The lock is a ref, so releasing it did not change the context value. Pages reading `locked()` stayed disabled until something else rendered. Releasing it now bumps a counter in the value's dependencies.

## Acceptance map

| Plan requirement | Evidence |
| --- | --- |
| Actual stages, offline, retry-wait and error states; no fake percentages | native `progress_names_its_job_and_reports_the_stages_actually_reached`, `progress_counts_the_attempt_in_progress`; page "shows the stage actually reached, the attempt and the time…" |
| Progress and errors scoped by job and source | the same tests (another job's and another material's events are ignored); every native event carries `materialId`, `kind` and `jobId` |
| Cancel stops local work, is durable, and suppresses obsolete publication | `cancelling_while_gemini_works…`, `cancelling_during_the_upload…`, `cancelling_during_a_retry_pause…`, `a_cancelled_job_stays_cancelled_after_a_restart…`, `a_cancel_that_cannot_be_written_changes_nothing`; page "Cancel is a keyboard-reachable button…", "cancelling during the local checks sends nothing at all", "a cancel asked for before the job has an id…" |
| Completion and cancellation resolved atomically; no "cancelled" while a late save replaces content | `a_cancel_recorded_first_wins_over_an_answer_that_has_just_arrived`, `a_job_that_finished_first_keeps_its_answer_and_cancel_says_so`; page "an answer that beat the cancel is never saved by itself" |
| No post-cancel writes or new calls | the generation counts and missing results in the native cancel tests; page "nothing is saved"; a late event does not revive the spinner |
| Retry only the failed safe stage | page "after a failure, Try again goes through the usual confirmation…"; GEN-REL-02 Save again remains checkpoint-only |
| Navigation and restart | page "a job cancelled before a restart is shown as cancelled and never resent"; GEN-REL-02's navigation tests rerun |
| Accessible controls and live status | Cancel is a real button reachable by focus; the status has `aria-live="polite"` |
| GENREL03-R1 | `r1_a_refused_file_check_names_its_own_stage_and_status` |

## Gate

The receipts are in `docs/evidence/gen-rel-04-2026-10-18/gate/`, and every step exited 0:
- typecheck and build;
- `npm test`: 3,684 passed, 6 skipped;
- `cargo test --locked`: 656 passed, 6 ignored;
- strict Clippy, fmt and cargo-lock;
- schema-14 helper 26/26;
- `git diff --check`;
- migrations, checksums, manifests, locks and tauri.conf unchanged since 49ac022.

## Limits

- Live-provider and installed-Mac behavior are UNVERIFIED. This includes WKWebView event delivery and real network cancellation.
- Cancelling cannot recall a request Google already has; the wording says so.
- No streaming preview was added (optional in the plan).
- Byte-level upload progress is not shown, because no server-confirmed measure exists.

## Review round 1 corrections (18 October 2026)

Codex round 1 (`docs/evidence/gen-rel-04-2026-10-18/review-r1/codex-review-round1.md`) was RED with four blocking findings, all about how reliable cancel itself is. Corrected gate (`review-r1/01…10`), all EXIT 0: npm 3,690 passed / 6 skipped, cargo 660 passed / 6 ignored.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R1: the job id was announced before its cancel token existed, so a cancel in that gap was recorded but the work ran on | `as_job_with` registers the token first, rereads the journal (a cancel that already landed cancels the token), and only then announces the id. `Cancellable` never polls work whose token is already cancelled | `r1_a_cancel_the_moment_the_job_is_announced_stops_it_before_any_work`, which fails on the old ordering (`prefix-r1-announce-before-register.log`) |
| R2: a cancel while progress listening was being set up did not stop the request | The cancel check sits immediately before the request is sent, with no await in between, so a cancel during the checks or the listener setup (whether it succeeds or fails) sends nothing | page "R2: a cancel while progress is still being set up (it resolves / rejects) sends nothing" |
| R3: cancel depended on courtesy progress events to learn the job id | Every request carries the window's own `requestId`, recorded on the job. `cancel_gemini_job` accepts it, and `Journal::cancel_request` cancels the running job by it. If the job has not begun yet, the cancel is held under the journal lock and `begin_request` refuses that request, before anything is sent | native `r3_a_cancel_by_request_before_the_job_begins_is_held_and_nothing_is_sent`, `r3_a_cancel_by_request_reaches_a_running_job_without_knowing_its_id`, `r3_a_cancel_by_request_after_the_job_finished_reports_its_outcome`; page "R3: with no progress events at all, Cancel still reaches the native work" |
| R4: the window ignored the native outcome and called a job cancelled just because a cancel had been asked for | A cancel that cannot be recorded is reported ("Cancelling did not go through…") and Cancel works again. "Cancelled" is shown only when the native side ends the job with its cancel message, so the journal decides. Any answer that arrives after she pressed Cancel is offered to save or discard, never saved by itself | page "R4: a cancel that does not go through…", "R4: when the native side reports the job had already failed…"; "the window's cancel message is the native one, word for word" |

Pre-fix proof for the frontend corrections: with the round-1 `GeminiJobs.tsx` swapped in, all five new page regressions fail (`prefix-r2-r4-frontend.log`). The fixed file was then restored, and `cmp` confirms it is byte-identical. Held cancels are bounded (32) and in memory only. A held cancel for a request that never arrives is harmless, because request ids are never reused.

## Review round 2 corrections (18 October 2026)

Codex round 2 (`review-r2/codex-review-round2.md`) confirmed R1–R3 fixed. It found R4 not fully fixed and raised R5 and R6. Corrected gate (`review-r2/01…10`), all EXIT 0: npm 3,691 passed / 6 skipped, cargo 663 passed / 6 ignored.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R4 (rest): a cancel outcome neither recorded nor held left "Cancelling…" with Cancel disabled | The window reads the native outcome. If the cancel was neither recorded nor held and the job has not finished, it reports "Cancelling did not go through…" and Cancel works again | page "R4: a cancel the native side neither recorded nor held…", which fails on the round-2 store (`prefix-r4-unaccepted-outcome.log`) |
| R5: `Cancellable` checked only between polls, so one poll could run on into another request | The budget, which every step already uses, carries the job's cancel token (`attach_cancel`, attached in `as_job_with`). Every boundary checks it immediately before acting: the generation request, both upload requests, the file check, and every pause (backoff, retry and readiness). A cancel recorded before the next submission prevents it, however far a poll runs | `r5_a_cancel_recorded_as_gemini_is_about_to_be_asked_prevents_the_request`, `r5_a_cancel_recorded_as_the_upload_begins_prevents_the_upload`. Both cancel from inside the work at that stage, with no outer wrapper, and both fail without the checks (`prefix-r5-boundary-checks.log`) |
| R6: a cancelled record could disappear before its command settled, so a late answer was handed over | The journal tracks **live** jobs, whose command has not yet settled. A live job cannot be acknowledged, replaced or evicted, and no new job begins while one is live (`BUSY`). Settling, on any outcome, ends liveness. A record that vanished never counts as a success: `RECORD_LOST`, nothing handed over. The registration reread can therefore always see the cancel | `r6_a_cancelled_job_keeps_its_record_until_its_command_settles`; `cancelled_jobs_make_room_like_failed_ones` now settles each job, as every command does |

Pre-fix proofs are kept beside the earlier ones. The fixed files were restored after each one, and `cmp` confirms they are byte-identical.

## Review round 3 corrections (18 October 2026)

Codex round 3 (`review-r3/codex-review-round3.md`) confirmed R1–R4 and R6 fixed. It found R5 not fully fixed and raised R7 and R8. Gate (`review-r3/01…10`), all EXIT 0 after one correction: npm 3,692 passed / 6 skipped, cargo 665 passed / 6 ignored. The first Clippy run was refused because `Option::is_none_or` is newer than the crate's MSRV 1.77.2. It is kept as `05a-clippy-failed-msrv.log`, and the method was replaced with a `match`.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R7: after a reload, Cancel on a recovered running job never called native | Only this window's own request, not yet sent (`local && !invoked`), is stopped by the flag alone. A recovered job is cancelled by its job id, and its outcome follows from the journal | page "R7: a job found still running after a reload can be cancelled, by its job id", which fails with the old shortcut (`prefix-r7-recovered-cancel.log`) |
| R8 (completes R5): request admission was not ordered against the journal's cancel decision | Each cancel token has a **gate**. `cancel_job` and `cancel_request` take the job's token gate, record the journal decision, and mark the token, all in one step (`CancelToken::decide`). Every request boundary (generation, both upload requests, the file check) takes the same gate to be admitted (`Budget::admit`). Whichever comes first wins: a cancel that wins means no further request; a request admitted first is already on its way, which the cancel message never denies. A job with no token yet is covered by the registration reread | `gemini_cancel::tests::r8_a_request_cannot_be_admitted_while_the_cancel_is_being_decided` (admission waits through the interval after the journal commit and is then refused), `r8_a_request_admitted_first_goes_and_every_later_one_is_refused`; the R5 boundary tests now go through `admit` |

Lock order is always the token gate, then the journal. Nothing takes the journal and then a gate, so the two cannot deadlock.

## Review round 4 corrections (18 October 2026)

Codex round 4 (`review-r4/codex-review-round4.md`) confirmed R1–R4, R6 and R7 fixed. It found R5 and R8 not fully fixed, and raised R9 and R10. Gate (`review-r4/01…10`), all EXIT 0: npm 3,692 passed / 6 skipped, cargo 665 passed / 6 ignored. The two token-gate tests from round 3 are replaced by the journal-ordering test below.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R9 (completes R8 and R5): a cancel that found no token could still decide without the gate, racing newly registered work | **Admission now asks the journal itself.** `Budget::admit` calls `Journal::admits(job)` under the journal lock: is the job still running? A cancel is recorded under that same lock. Ordering therefore needs no token discovery at all: once the journal records a cancel, no further request is admitted, whether or not the work has been woken. The token now only wakes and drops the work sooner. The round-3 gate (`decide`/`admit` on the token, `token_for`) is removed | `r9_once_the_journal_records_a_cancel_no_request_is_admitted_even_before_the_work_is_woken` (journal-only cancel, no wake): no request. It fails when admission asks only the token (`prefix-r9-token-only-admission.log`) |
| R10: a cancel during a fresh upload's readiness check led straight into an unadmitted DELETE | Cleanup that a generation causes goes through admission (`retire_admitted`, `finish_admitted`). This covers its own unusable upload, copies retired while claiming, eviction during publication, and the cleanup after generation. Once cancelled, nothing more is sent: the copies are queued for a later cleanup (the next generation's finish, or disconnect) and in any case expire at Google | `r10_a_cancel_at_a_fresh_uploads_readiness_check_sends_no_check_delete_or_generation`: run without the outer wrapper, it sends no lookup, DELETE or generation request after the cancel. It fails with unconditional cleanup (`prefix-r10-cleanup.log`) |

Lock use is simpler now: admission and the cancel decision both take only the journal lock, and the token takes none of the journal's.

## Review round 5 correction (18 October 2026)

Codex round 5 (`review-r5/codex-review-round5.md`) confirmed R1–R4, R6, R7 and R9 fixed. It left one blocking finding.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R11 (completes R5, R10): generation-owned cleanup admitted a whole batch once, so a cancel recorded while one DELETE was outstanding did not stop the next | `retire_admitted` asks admission immediately before **each** DELETE. When it is refused, that copy and the rest are queued for later cleanup. `finish_admitted` releases the lease at once, then uses the same per-DELETE admission. Copies made with another key are still left to expire, as before | `r11_retiring_admits_each_delete_and_stops_at_a_cancel`, `r11_finishing_admits_each_delete_and_stops_at_a_cancel`. Two copies; the first DELETE is held; the cancel is recorded through admission alone, with no token or wake. Only that first DELETE arrives, and the second is queued. Both fail with round 5's one-check-per-batch admission (`prefix-r11-batch-admission.log`) |

Gate (`review-r5/01…10`): npm 3,692 passed / 6 skipped, cargo 667 passed / 6 ignored, and all other steps EXIT 0. The first `npm test` run there failed only in `DocumentPagesPanel.test.ts` ("a deleted file explains itself…"). This is the pre-existing click-ownership failure, fixed separately in PR #216 (not yet merged, so not in this branch). The run is kept as `02a-…log`. No frontend file changed in this round.

## Round 6: GREEN, and integration (18 October 2026)

Codex round 6 (`review-r6/codex-review-round6-green.md`) confirmed R1–R11 fixed. Its one non-blocking finding, R12, is carried into GEN-REL-05: if a cancel drops the cleanup future while one DELETE is outstanding, the copies not yet sent should return to the queue. No extra request is sent either way, and the copies expire at Google.

Before integration, the branch was fast-forwarded onto main 5b80cd8, which includes PR #216 (the click-ownership fix, merged first). The final gate ran on that combination (`review-r6/01…10`), all EXIT 0: npm 3,693 passed / 6 skipped, cargo 667 passed / 6 ignored. The trackers gained the acceptance entry, and the current schema-14 manifest was rebound to them. Claude integrates once exact-head CI is green, under the owner's instruction.
