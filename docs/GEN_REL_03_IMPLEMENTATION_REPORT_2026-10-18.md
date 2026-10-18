# GEN-REL-03: completion of bounded recovery and failure diagnosis

**Implemented by Codex after Claude's interrupted task; pending independent review. Not accepted or merged.** Base: `17c80ee` (PR #214, accepted GEN-REL-02). Working directory: `/Users/rickymac/code/Flight-training-gen-rel-03`; branch: `codex/gen-rel-03-completion`.

## Starting state and preserved work

GEN-REL-01 (#212) and GEN-REL-02 (#214) are integrated. Claude had started GEN-REL-03 in `claude/gen-rel-03`, but left three tracked files dirty (`gemini.rs`, `gemini_files.rs`, `lib.rs`) and an untracked `gemini_budget.rs`. The first native compilation reproduced **16 test compilation errors**: existing callers/tests had not been updated for the budget signatures and message policy. No completed GEN-REL-03 report or evidence existed.

Before editing, Codex captured that diff, the new file and four SHA-256 hashes outside the repository, in `/Users/rickymac/.codex/task-recovery/gen-rel03-inherited-20261018/`. The four initial hashes are also kept in this package's `inherited/`. The same worktree was retained, on a new Codex branch, rather than copying into a competing checkout. The primary checkout's unrelated `.claude/settings.json` edit was not touched. The separate evidence PR #213 and paused scheduler PR #210 were not merged or changed.

## Result and implementation

A deliberate generation now owns **one 300-second active provider-work budget**, measured on a monotonic clock. Upload start/finalization, provider-file readiness and checks, joining shared preparation, generation headers/body, retry backoff, fallback and awaited cache cleanup all draw from that budget. A connection has at most 15 seconds to establish; each request otherwise gets only the remaining time. An outer deadline also bounds waits with no HTTP request of their own. Local preflight/source loading occurs before this network budget; local validation/checkpoint/save does not obtain another provider allowance.

There are **at most three `generateContent` submissions**, including the backup model and recovery from a missing prepared PDF. Transient 408/429/500/502/503/504 and connection interruptions have finite backoff with jitter. Every automatic retry, including a fallback, honors a valid `Retry-After` delay when present; supported forms are delta seconds and standard IMF HTTP dates. A delay that cannot fit leaves an actionable error without another submission. Permanent invalid request, authentication, permission, payment and missing-model errors do not loop. Persistent daily/zero quota is identified from structured quota facts, including mixed per-minute/per-day violations; neither arbitrary provider prose nor an unqualified 429 is treated as proof of daily exhaustion.

Errors distinguish inability to connect, stalled upload/preparation, generation header timeout, stalled response body, dropped connection, HTTP refusal/quota and blocked/truncated/unreadable output. A 404 no longer asserts that Google definitely retired a model: a healthy prepared-file check preserves the model/request availability failure. Complete-looking JSON is still refused when the provider's finish reason reports truncation or blocking. No output retry is performed merely to obtain a different answer.

Failures returned to the window and native journal include a fixed diagnostic line: category, stage, generation attempts, elapsed duration and last observed HTTP status. No provider error body, key, document text, file locator or source path is copied into that line. Existing journal job IDs remain the operation identifiers; no additional identifier or secret is introduced.

An interrupted connection does **not** prove Google cancelled processing. Progress before a repeat submission and terminal timeout/drop messages disclose uncertain remote completion and possible additional charges. An upload interrupted before a usable provider reference is confirmed is not blindly restarted in the same run and is never called “resumed.” Metadata/upload failures stop with stage-specific advice; this package does not introduce a new upload-resume protocol.

**GENREL01-R12 is closed in source:** cached reuse rechecks the provider-reported expiration after the awaited confirmation; shared adoption checks expiration at adoption. Copies that have crossed the reuse margin cannot be handed out as reused copies.

## Recovery boundary and policy interpretation

GEN-REL-02 has no automatic inference-resume entry point. Restart reconstructs an interrupted or finished journal job, never resends it. A finished checkpoint's Save again only performs the acknowledged local save. Accordingly an automatic run's budget/attempt object lives for that run and is shared across all its preparation/retry/fallback work; it is not re-created by navigation or file recovery. A restart cannot reset automatic requests because no automatic request is made at restart. A user's deliberate new generation creates a new job with a new allowance. This package retains that existing contract rather than adding a persistent inference-resume mechanism or changing the journal format. GEN-REL-04 must preserve it when adding retry/resume controls.

## Acceptance map

| Requirement | Evidence |
| --- | --- |
| Shared 300-second budget; 15-second connect limit | `gemini_budget.rs`; `remaining_time_never_resets_across_stages_or_attempts`; spent-budget, slow-header/body/upload/readiness and coalesced-wait tests in `gemini_recovery_tests.rs` |
| Three attempts including fallback and file re-preparation | transient matrix, finite-exhaustion and `source_repreparation_does_not_reset_generation_attempts` |
| Retry-After and bounded backoff | seconds/date parser tests; per-retry/fallback waits; outside-budget waits; all delays use the injected budget clock in policy tests |
| Permanent refusals and structured quota | 400/401/402/403/404/413 matrix; mixed daily/minute/zero quota cases; model-404 test |
| Uncertain remote completion | dropped and partial-body transport tests; charge-warning progress; header/body deadline tests |
| Blocked and incomplete responses | finish-reason matrix; existing invalid-response and practice-test sanitization tests |
| Sanitized recorded diagnostics | sentinel test and actual `as_job` failure written/read through the synthetic native journal |
| Restart/save-only recovery | unchanged GEN-REL-02 journal and frontend recovery regressions, rerun in the full gates; new journal-reopen test confirms no new provider call |
| R12 expiration after awaiting | `r12_shared_copy_crossing_expiry_margin_is_not_adopted`; `r12_expiry_is_rechecked_after_a_slow_cached_confirmation` |
| Existing data/source/ownership guarantees | all old native and frontend tests rerun; migration/lock/version/protected-path comparison against base |

Twenty-nine permanent tests were added: 22 recovery tests, five budget tests, two expiry tests. Several cases contain explicit status/output matrices. Existing tests were adapted only for explicit budget arguments and changed behavior: the three-total-attempt policy, truthful 404 wording and the common usable-answer error. No old test case was removed and no timeout or assertion was weakened to mask a failure.

## Validation and failures retained

Final receipts and their raw exit codes are in `docs/evidence/gen-rel-03-completion-2026-10-18/gate/`; see its README for counts and results. The initial inherited compilation failure is retained separately. The first focused run had **141 pass / 4 fail**: three old wording assertions still expected the replaced policy text, and one new assertion expected a different phrase from the same correct Retry-After message. These were corrected to assert the intended behavior, with all request-count/cache invariants retained. The later focused run passed 148 tests; the final full native gate includes those same tests after the last retry-delay adjustment. The first full gate passed frontend/native tests but strict Clippy rejected the eight-argument readiness function. The correction carries the already-validated MIME type on `RemoteFile`, removing the separate argument without relaxing any lint. Native tests, strict Clippy and fmt were rerun after that change. The frontend inputs did not change, so their existing successful receipts remain valid. The first inventory refresh also caught stale tracker hashes before final publication; that correction is disclosed in `diagnostics/inventory-refresh-first.txt`. Scratch intermediate compilation diagnostics remain outside the repo; they are not final-gate successes.

No app was launched, no profile or real key was opened, no private document was sent and no live-provider request was made. All new HTTP tests use loopback and synthetic content. Native test compilation and the frontend bundle build are source gates, not an installed-app build or acceptance result. No dependency, migration, version, bundle identity, capability or release workflow was changed.

## Limits and next step

**Live Google behavior, real weak-network performance, installed WKWebView presentation and production output quality remain UNVERIFIED.** No release was produced. An upload that completes remotely after the local deadline may leave an unconfirmed temporary copy at Google; the app cannot delete a remote file whose identifier was never received. This retains the disclosed temporary provider storage, with no false cleanup/resume guarantee.

Have a separate reviewer follow `docs/GEN_REL_03_REVIEWER_PROMPT_2026-10-18.md`. Do not self-accept or merge this implementation. GEN-REL-04 (job-scoped progress, Cancel and stage-appropriate recovery) follows review and integration; GEN-REL-05 (larger flashcard sets) remains after 04. The friend supplied the exact timeout screenshot in PR #213, but her installed version, duration and document size remain unknown; this package is not evidence that her installed build includes these corrections.

Provider contracts checked read-only on 18 October 2026: [Google troubleshooting and retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting), [generateContent response and finish reasons](https://ai.google.dev/api/generate-content). No provider/model migration is implied.
