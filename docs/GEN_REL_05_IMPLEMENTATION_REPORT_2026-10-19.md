# GEN-REL-05 implementation report — 19 October 2026

**Review round 1 corrections implemented; ready for independent review, with the schema-14 sandbox result recorded separately.** Implemented in the assigned worktree, uncommitted, on base `3d50a64976da1c4ab5afca72edaa73f02802d4a6`. Pending independent review and coordinator integration. No commit, push, merge, migration, dependency or version change. No real provider request, real key, personal profile or application launch.

This report **supersedes the previous BLOCKED report**. The original report and reviewer prompt are preserved in [prior-blocked-implementation-report.md](evidence/gen-rel-05-2026-10-19/prior-blocked-implementation-report.md) and [prior-blocked-reviewer-prompt.md](evidence/gen-rel-05-2026-10-19/prior-blocked-reviewer-prompt.md). Earlier failure receipts remain unchanged. Loopback is now permitted; the R12 native HTTP regressions pass.

## Design and request policy

New generation and deliberate regeneration offer 20, 40 or 60 target cards, default 40. Native code rejects every other target before source preparation. Practice-test question count and its generation path remain unchanged. A target is a maximum: the UI, batch prompt, final source notes and acceptance notice explain that fewer distinct grounded cards may be returned.

`gemini_batches.rs` runs one guide-only unit followed by at most two/four/six card units, each accepting no more than ten cards. It uses the existing prepared-source transport; PDFs remain `file_data` references, never inline. Every unit retains the same selected file, byte hash and local page coordinate system. The source is re-read and hashed before each unit and after its response; changed, missing or unreadable bytes prevent publication. The existing final-save material/hash/revision guard still applies. PDF cards must have a 1-based page within that selected PDF; non-PDF cards must have null page references. Missing/null PDF pages, zero/out-of-range pages and malformed types fail validation.

The finite **generation-submission cap declared before implementation was nine**: one guide + six batches + two extra submissions shared across the entire job. Planned units do not spend recovery allowance. Each unit still has at most three submissions, including fallback and missing-file recovery. A durable seven-slot request ledger reserves each submission before dispatch. A cancelled or interrupted request remains spent even if no answer arrived. Deleting/discarding a draft and deliberately starting a new job is a new job; resuming a retained draft preserves its ledger.

There is also a conservative **512 HTTP-dispatch upper bound per retained job**, including preparation, checks, readiness polling and generation-owned DELETEs. The admission callback durably counts every admission check under the journal lock; because pauses/probes may also ask admission, the backstop can stop earlier than 512 actual HTTP requests. It never permits more. This bound survives resume. Existing preparation/poll/delete bounds remain in force, and the shared time budget normally stops work much sooner. Reservation-write failure prevents dispatch. A transport-bound refusal is reported as an allowance/reservation failure, not a user cancellation.

One existing monotonic 300-second budget covers all units, preparation, pauses, retries and cleanup; it is never reset between batches. A persisted deadline further shortens a resumed command's budget. This deliberately conservative restart policy charges closed-app time too: it never grants a new five minutes after a restart. A retained draft whose allowance has expired stays visible, but cannot acquire more allowance by pressing Try again; discard it before deliberately starting a fresh job. This is a policy refinement, not a claim of resumable unlimited generation. Live timing and provider quality remain UNVERIFIED.

Guide output remains capped at 8,192 tokens; card units use 4,096. HTTP response reading stops at 1 MiB, including error bodies, rather than buffering unlimited text. Validation also bounds title, summary, sections, notes and card text. Empty text/byte sources make no provider request. Short/unsupported fixture responses may finish with zero cards; nothing pads them. Exact normalized `(question, answer)` pairs use Unicode lowercase plus collapsed whitespace, retaining the first occurrence and its order. This does not detect semantic paraphrases or prove factual grounding; those remain prompt requirements and require learner verification.

## Drafts, cancellation and publication

The native journal gains an optional `draft`, separate from the final publishable `result`. It holds the guide, accepted cards, next unit, completion marker, target, deadline and request/admission ledger. Existing journal files remain readable; no SQLite migration or schema-14 manifest change is needed. Partial drafts do not become `ready`, are not automatically acknowledged after failure, and cannot be silently evicted to make journal capacity. Each validated batch is written before the next starts. Checkpoint reloads preserve reservations made during requests. A completed/short-source marker prevents a repeated completion from requesting or accumulating the same unit again.

Try again still passes through Send confirmation. A matching material/file/hash/base revision carries its draft into the deliberate request; changed identity refuses, asking for explicit discard instead. Target mismatch also refuses without a new provider call. Cancellation still goes through the existing journal lock and `Cancellable`, preventing all later requests and publication. Restart never sends anything automatically. Kept draft counts appear in the recovery notice; running progress reports checked/target counts, and completed acceptance shows the final source notes/counts.

Completed sets now wait for **Save the new study guide and cards**. No batch appends to live cards, reorders an existing set, or reassigns progress. Acceptance uses the existing atomic replacement/version contract. Save again uses the completed checkpoint only. A failed database save preserves the old guide, cards, versions and history. A failed final journal write no longer erases a partial draft: the prior on-disk record remains recoverable as interrupted.

GENREL04-R12's carried-over `PendingRetirements` guard is retained: a dropped cleanup future returns only unsent copies to `orphaned`; it never retries the in-flight DELETE with an uncertain outcome. Both retire and finish paths are exercised through `Cancellable` while the first loopback DELETE is held.

## Acceptance map

All new native names below are in `gemini::batches::tests`; all inputs and servers are synthetic.

| Requirement | Named coverage |
| --- | --- |
| 20/40/60, default 40, invalid counts | `targets_default_and_invalid_counts`; frontend `GEN-REL-05 card targets > sends target %i and leaves practice question count alone` |
| Ten-card units, PDF reuse, measured upload bytes, bounded output | `targets_use_ten_card_batches_single_upload_and_bounded_tokens` |
| Short/empty sources; no duplicate padding; repeated completion | `short_empty_duplicate_and_repeated_batches_never_pad_or_commit_twice`; `empty_source_and_transport_admission_cap_dispatch_nothing` |
| Exact normalized duplicates, preserving first order | `short_empty_duplicate_and_repeated_batches_never_pad_or_commit_twice` |
| Changed source between units/resume | `source_change_between_batches_and_resume_are_refused`; existing final-save hash/material/revision tests in `MaterialDetailJobs.test.ts` |
| Missing/bad PDF pages; malformed, truncated, too many cards, byte limit | `missing_bad_pages_malformed_truncated_and_oversized_batches_keep_draft` |
| Token caps and 20/40/60 request measurements | `targets_use_ten_card_batches_single_upload_and_bounded_tokens` |
| Shared budget, deadline, retry exhaustion, durable caps | `durable_request_cap_retry_exhaustion_and_shared_deadline`; `one_active_budget_covers_later_batches_and_failed_final_journal_write_keeps_draft`; existing `gemini_budget` and `gemini::recovery_tests` |
| Exact nine-submission maximum path with two retries | `sixty_cards_with_two_recoveries_has_exactly_nine_submissions` |
| Cancel/drop, restart, deliberate resume; no twice-recorded batch | `cancellable_drop_restart_resume_preserves_ledger_and_unique_batches`; frontend `GEN-REL-05 interrupted drafts survive recovery without a provider call` |
| Draft retained after final journal failure | `one_active_budget_covers_later_batches_and_failed_final_journal_write_keeps_draft` |
| Deliberate acceptance, failed final database save, old set/versions/history preserved, Save again makes no call | frontend `GEN-REL-05 completed batches wait for acceptance; failed final save preserves the prior set`; existing checkpoint-only Save again and replacement tests |
| R12 held DELETE cancellation, both paths | `gemini_files::tests::r12_dropped_retire_returns_unsent_copies_to_orphaned`; `r12_dropped_finish_returns_unsent_copies_to_orphaned`; socket-free `r12_cancellable_drop_keeps_only_unsent_entries_without_transport` |

Focused batch receipt: `batches-final-focused.log`, 10 passed. Captured synthetic PDF bytes = **427 uploaded / 427 source bytes** for every target. Normal 20/40/60 runs use **3/5/7 generation submissions**, **7/11/15 total HTTP requests**; the 60-card two-recovery run uses **9 generation submissions / 17 total HTTP requests**. No source bytes are embedded in generation requests. These are measured fixture values, not estimates for real documents.

## Failure record

Earlier loopback-denied R12 and full native/schema receipts are retained and superseded, not erased. Their failures were infrastructure failures, not product-red reproductions.

During this continuation, the first compilation failed because an initializer was inserted into a function argument list (`compile-batches-first.log`). The first new test compilation also used an unavailable tempfile crate and the wrong gate constructor (`batches-first.log`); it was corrected using the repository's disposable-folder pattern, without adding a dependency. `batches-second.log` caught an inconsistent expired-draft fixture whose unit index already indicated completion; the fixture was corrected to represent unfinished work. `batches-third.log` caught the cancellation test holding the guide instead of the next batch; its progress hook was narrowed to checked-count messages. These are test/setup failures, not claimed pre-fix product reproductions.

`typecheck-development-2.log` and `frontend-focused-first.log` retain an incorrect repository helper signature in the new save test and old recovery-wording expectations. Both were corrected; recovery wording remains appropriate for local completion versus restart. `clippy-development-first.log` caught a complex callback type; a named alias corrected it. Focused corrected receipts are separate. The implementation also corrected draft loss on a failed final journal write and added a named regression; no pre-fix failing receipt is claimed for that finding.

## Prior implementation gate and limits (superseded by review round 1 below)

Final gate results are recorded in `final-gate-results.json` and the nine `final-*.log` receipts. Node 22 is on PATH; the requested SDKROOT is scoped to Cargo. The original gate receipts remain historical. The gate was run once; its frontend wording failure was corrected with a test-only fixture update and the frontend checks rerun. Rust/application source was unchanged after its green checks. The schema helper failure is unrelated to generated output: no regenerable files could correct the process-list denial, and no permission bypass or helper change was attempted.

| Gate | Current result / receipt |
| --- | --- |
| Typecheck | PASS; `corrected-typecheck.log` after the test-only correction |
| Frontend suite | PASS; 3,698 passed / 6 skipped; `corrected-frontend-tests.log` |
| Build | PASS; `final-build.log` (unchanged application source) |
| Cargo tests | PASS; 680 passed / 6 ignored; `final-cargo-test.log` |
| Strict all-target Clippy | PASS; `final-clippy.log` |
| Cargo fmt check | PASS; `final-fmt.log` |
| Cargo lock sync | PASS; `final-cargo-lock.log` |
| Schema-14 helper | **FAIL: 25 passed / 1 failed**; `final-schema14.log` |
| Diff whitespace | PASS; final handoff receipt |

The helper's sole failure is `snapshot outside the approved lane refuses and writes nothing`: sandbox process-list denial produces `sysmon request failed ... sysmond service not found` and `pgrep: Cannot get process list` ahead of the expected `REFUSED:` prefix. The safety refusal itself still occurs. This is the same environment restriction observed in the earlier run; enabling loopback did not enable process enumeration. `flycheck0` was absent at the final helper check. No generated diagnostic output caused this failure. The frozen helper and manifest remain unchanged. The implementation cannot be represented as having an entirely green final gate until that existing helper passes in a suitable environment.

The first full frontend run (`final-frontend-tests.log`) passed 3,697 tests with one old assertion still expecting `attempt 2 of 3`. Its study-job fixture now emits nine as its submission bound and asserts `request 2 of 9`; production behavior was unchanged by the correction. The original failure receipt remains separate from the corrected suite.

Protected coordinator files, shipped migrations, dependency locks, versions and the schema-14 manifest are unchanged. No installed-app, Finder, Gatekeeper, accessibility or live-provider behavior is claimed. Exact duplicate detection and syntactically valid citations do not establish factual accuracy. Independent Claude review and exact-head CI remain required before integration.

The existing REST file-reference and `generateContent` contract was checked against Google's primary [file input documentation](https://ai.google.dev/gemini-api/docs/file-input-methods) and [generateContent reference](https://ai.google.dev/api/generate-content) during this continuation. No endpoint/model migration or provider call was made.

## Review round 1 corrections

Claude's findings are preserved verbatim in `claude-review-round1.md`. R1–R4 are addressed in this same uncommitted worktree. This section and the `round1-*` receipts supersede the earlier gate status above. Claude independently reported schema-14 **26/26 outside the sandbox**; that is coordinator/reviewer evidence, not a result of this run.

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| **GENREL05-R1 (blocking)** | Unit 0 sends a guide-only schema with no `flashcards` property or requirement. Before typed deserialization, any returned guide `flashcards` are replaced with an empty array, so even malformed unsolicited cards cannot enter the set or fail guide validation. Card units retain their existing schema, ten-card validation and duplicate rules. | `guide_cards_are_discarded_without_extra_requests`: omitted, empty, one-card, eleven-card and malformed guide-card fields all complete with precisely 20 separately validated cards and **3 generation requests**. Captured request schemas omit cards only on unit 0. Existing 20/40/60 measurements remain 3/5/7 generation calls. |
| **GENREL05-R2** | Acceptance is now enforced by job kind inside `GeminiJobs.tsx`; the service wrapper no longer injects a policy flag. Every completed study aid waits for acceptance, including directly mocked service responses. Practice tests retain automatic saving unless cancellation requires a decision. | `GEN-REL-05 completed batches wait for acceptance; failed final save preserves the prior set` now uses an ordinary service spy with no acceptance flag. Existing navigation, replacement, hash, queued-save, retry and acknowledgement tests explicitly accept before saving. `GENREL05-R2 practice tests still auto-save` verifies the other policy branch. |
| **GENREL05-R3** | Drafts persist `remainingMillis`, reduced from the active monotonic budget at request reservations and validated-unit checkpoints. Resume uses the smaller of that stored allowance and the wall-clock deadline. Reservations persist the remaining-time ceiling under the existing journal lock before dispatch, including retries. Older drafts default to the original 300-second ceiling while retaining their deadline. | `resumed_allowance_cannot_exceed_persisted_remaining_time` simulates a backward clock change with a deadline an hour ahead and an exhausted persisted allowance; resume makes **zero additional requests**. `remaining_allowance_is_checkpointed_from_monotonic_time` advances the injected monotonic clock between units and verifies the durable 240-second remainder, plus legacy-field compatibility. |
| **GENREL05-R4** | The kept-draft notice now uses the surrounding `stack stack--3` spacing, `ai-disclaimer`, alert icon, tiny text and small buttons; its status role remains on the disclaimer. | The interrupted-draft page regression verifies `.ai-disclaimer[role=status]`, retained card count, discard control, no provider request, no acknowledgement and no saved set. |

The remaining-time ceiling prevents a resumed command gaining more than the last durable remaining allowance when the wall clock moves backward. The persisted wall deadline still charges closed-app time and can shorten allowance after a forward clock change. Elapsed time after the last durable reservation/checkpoint cannot be reconstructed across a process crash; no stronger crash-time precision is claimed.

### Failing receipts retained

- `round1-before-native-serial.log`: **10 pass / 2 fail**, clean pre-fix reproductions of guide-card rejection (R1) and resumed generation despite an exhausted stored allowance (R3).
- `round1-before-native.log`: the first parallel reproduction also exposed collisions in the existing test fixture's timestamp-only temporary paths. A per-process atomic counter now makes those test directories unique. Its unrelated fixture failures are not claimed as review-defect reproductions.
- `round1-before-frontend.log`: both selected tests fail, reproducing auto-save through a direct service spy (R2) and absent disclaimer markup (R4).
- `round1-frontend-development.log`: retained transitional failures from the old auto-save expectations after moving policy into job state. The tests now explicitly perform acceptance before asserting save guards and outcomes.
- `round1-native-focused-expanded.log`: **13 passed**; `round1-frontend-focused.log`: **58 passed**; `round1-typecheck-development.log`: pass. All fixtures are synthetic and all HTTP servers are loopback.

### Refreshed full gate

The first full-gate attempt exposed eight additional old auto-save expectations across the Gemini boundary, model-label and offline suites. These were corrected to assert that the answer waits, then accept explicitly on its source material; the replacement guard is awaited before asserting no save. `round1-first-gate-results.json` and `round1-first-gate-*.log` preserve that attempt (frontend 3,691 pass / 8 fail; other code checks pass, helper 25/26). `round1-all-affected-frontend.log` then passes all **82 tests across six suites**.

The complete nine-check gate is rerun once after all final source/test changes using `run-round1-final-gate.py`. Current results are in `round1-final-gate-results.json` and `round1-final-*.log`; prior gate logs remain unchanged. The refreshed `current-gate-summary.json` maps the current receipts. Source patch, status and source digests use `round1-*` names; `SHA256SUMS` covers all evidence files other than itself.

No commit, push, merge, provider call, real key/profile or app launch. Coordinator-owned files, migrations, dependencies, versions and the schema-14 helper/manifest remain unchanged. Live-provider and installed-app behavior remain **UNVERIFIED**.

Final review-correction gate results:

| Check | Result |
| --- | --- |
| Typecheck | PASS |
| Frontend suite | PASS — **3,699 passed / 6 skipped** |
| Build | PASS |
| Cargo tests | PASS — **683 passed / 6 ignored** |
| Strict all-target Clippy | PASS |
| Cargo fmt check | PASS |
| Cargo lock sync | PASS |
| Schema-14 helper | **25 passed / 1 failed**, sandbox process-enumeration denial |
| Diff whitespace | PASS |

The helper's only failed case remains `snapshot outside the approved lane refuses and writes nothing`: `sysmond service not found` / `pgrep: Cannot get process list` precedes the expected `REFUSED:` prefix. Its refusal still occurs. No helper or manifest change was made. The coordinator reruns this helper outside the sandbox; the sandbox failure is not claimed as a product regression or a green gate. **Implementation is ready for independent review.**
