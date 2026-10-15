# PR161 CI failure and coordinator recovery assignment

**Current status — 15 October 2026:** PR161 is closed as superseded. Its application clock increment and corrected rendered tests were independently reviewed and merged through [PR163](https://github.com/rickydeleon49-ui/Flight-training-/pull/163) at `16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78`. CI-161-01 is complete; do not restart the original feature or its stale source checkout. PIPE-161-01 remains pending external-controller work. Continue only step 3 and its controller verification/handoff requirements below; source repair steps 1–2 and app tests in step 4 are historical. Read the current main roadmap and consolidation review first.

**Historical diagnostic verdict before PR163:** corrections required; PR161 was open and unmerged. Reviewed against live main `42077ccd00b70ad406e30d236a34e0ab556745d5` and exact PR161 head `4ab1a1582cf974ff81a0f073872565bcc585894b`. No implementation or merge is authorized by this document alone beyond the owner's existing source-development delegation. Next implementer is owner-selected; assignment is model-neutral. One implementer and the existing Codex Git coordinator own the continuation.

## What stopped

The coordinator did not suffer an unexplained process crash. Required GitHub CI failed, `integrator.py` recorded `ci_failed` and raised, and the lead caught that exception and exited with `status=blocked`. This correctly prevented a red merge. The promised failure-to-implementer recovery transition was never implemented; the controller only prints that instruction.

- [Superseded source PR161](https://github.com/rickydeleon49-ui/Flight-training-/pull/161).
- [Failed exact-head CI run](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38687320702).
- Final CI result: **3 failed, 3,138 passed, 6 skipped**, 134 files passed, 1 failed, 4 skipped. The failing file is the newly added `CardReviewClockRecovery.test.ts`. Later build/native steps were not completed by this failed run and must not be described as passing CI.
- Job `8e0519b83ddb`, branch `codex/auto-8e0519b83ddb`. Saved source: controller `runs/20261014-221139-402612/worktree`; independent review: `runs/20261014-221139-402612/summary.json`; integration receipt: `integrations/8e0519b83ddb/integration.json`.
- Controller bundle: `/Users/rickymac/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an/outputs/flight-deck-team`. Failed CI log, coordinator diagnostic output and frozen controller hashes are retained under `integrations/8e0519b83ddb/crash-review/`.

## Confirmed findings

### CI-161-01 — P1: submitted rendered verification is red

**Location:** `src/pages/StudyLibrary/CardReviewClockRecovery.test.ts:110` (`settle`), assertions at lines 180, 192 and 289 in PR161 head.

**Trigger and observation:** GitHub's supported Node22 full-suite lane failed three new rendered assertions:

1. `reaching the saved Again instant enables Review cards, and starting selects the now-due card`: expected `Card 1 of 1`, but the DOM still showed the idle `1 card due` panel.
2. `a delayed timer is reconciled on return to a visible window`: `Review cards` was absent when `reviewDisabled()` queried it.
3. `an open session, revealed answer and unconfirmed rating survive the instant; Try again resends the same rating`: expected `Card 2 of 3`, which was absent.

**Impact:** the PR cannot satisfy its actual CI acceptance or merge. These are assertion failures, not the historical baseline timeout cases.

**Confirmed diagnostic:** `settle()` advances fake timers by zero exactly 20 times; it is not tied to a repository acknowledgement or a DOM readiness condition. In a disposable clone of this exact submitted head, the reviewer held a real database `select` behind a controlled promise. The helper returned while the read was pending and the Review cards button was absent; releasing that read allowed the button to appear. The diagnostic passed (1 selected test, 8 intentionally unselected original tests); it proves the helper is not a completion barrier. It does not by itself prove that this exact latency caused every GitHub failure.

**Limit:** the unmodified eight-test file passed locally on Node22 with `TZ=UTC` (8/8, exit0). A timezone-only explanation is not established. No production root cause is proven yet. Reproduce on Ubuntu or with deterministic read/write scheduling before deciding this is solely a test correction.

**Required correction:** wait for the actual state transition or controlled operation acknowledgement at each asynchronous boundary; preserve intermediate-state assertions, clocks, fake timers and substantive expectations. Do not merely add sleeps, more zero-timer iterations, larger timeouts, retries or skips. If a production race is demonstrated, correct it within an explicit reviewed scope. Keep timer callbacks display-only: no automatic reads/writes/session starts, no pending-rating replacement, no changed operation identity.

**Regression evidence:** reproduce the current failure or a deterministic equivalent on final test bytes; then exercise slow initial reads, delayed start acknowledgement, rating before/after persistence, focus/visibility and pending retry. Verify actual UI readiness rather than elapsed scheduler turns. Original assertions must still fail if the recovery behavior is removed. Record failed observations separately from successful runs.

### PIPE-161-01 — P2: CI failure has no correction transition

**Locations in the external controller bundle:** `integrator.py:165`, `codex_lead.py:63`, `codex_lead.py:82`, `codex_lead.py:88`.

**Trigger and observation:** when CI is failed, the integrator saves one status and raises `CI failed; preserve logs and send the failure to the implementer`. `integrate_job` marks the queue job blocked and rethrows. The session catches it at the outermost entrypoint, writes generic blocker JSON and exits. It neither downloads failed logs nor constructs a correction assignment nor resumes the implementer. `test_integrator.py` tested safe-stop behavior, not end-to-end recovery.

**Impact:** ordinary repairable CI findings halt the delegated delivery session and need owner intervention, despite the intended Codex-led correction workflow. The failed-merge guard itself is correct and must remain.

**Required correction:** add a bounded, idempotent failed-CI transition that captures exact PR/head/run/check/log receipts, classifies actionable CI findings separately from auth/service failures, and feeds one consolidated same-task correction to the owner-selected implementer. Use at most two automatic CI repair attempts per failure lineage; persist attempt/fingerprint state across restarts. Do not rerun unchanged failed work forever. Require fresh Codex approval and verification of changed hashes before publishing or merging; preserve the failed head and logs. The single Git coordinator owns updating the PR. Never bypass CI, force-push, approve modified files with stale hashes, dismiss security alerts or start a parallel task. Out-of-scope fixes, repeated identical failures and genuinely missing product decisions stop with a precise receipt.

**Regression evidence:** deterministic mocked GitHub and real disposable Git tests for failed-CI -> one repair task -> new approval -> new exact head -> successful CI -> verified merge; duplicate/restarted watcher; two-attempt exhaustion; same failure without changed evidence; changed head/hash; missing approval; failed/pending/skipped required checks; auth/service errors. No duplicate implementations, merges or PRs; dirty primary checkout and implementer index/files remain preserved. Local CI waiting uses no model calls. Gemma may summarize facts but cannot approve code or merges.

## One ordered, bounded implementation assignment

1. **Verify identities before edits.** Fetch first. Confirm PR161 head, current main and sole ownership. Verify `integration.json` source hashes against both saved source and PR source. Read repository `CLAUDE.md`, relevant `PRODUCT_SPEC.md`, the current material-relearning report and review, this document, and controller `OWNER_REVIEW_WORKFLOW.md`. Do not pull into the dirty primary checkout. If another coordinator changed this task, stop with the exact conflict.
2. **Repair the PR161 verification first.** Use an isolated continuation of that reviewed PR. Editable app scope remains its five files: `useCardReview.ts`, `useCardReviewClock.ts`, `useCardReviewClock.test.ts`, `CardReviewClockRecovery.test.ts` (all under `src/pages/StudyLibrary/`) and `docs/M2_MATERIAL_RELEARNING_CLOCK_REPORT_2026-10-14.md`. Preserve accepted behavior and existing meaningful assertions. No persistence/schema/scheduling-rule changes without a separately justified scope decision. Produce one uncommitted corrected source package and reproducible failed/passing receipts.
3. **Repair the local coordinator transition.** Separate external-bundle scope: `integrator.py`, `codex_lead.py`, relevant `automation.py` queue transitions, `test_integrator.py` and a focused new recovery test if needed. Record baseline/final controller hashes and local tests. Do not copy this tool bundle, credentials or private local logs into application source. Finish one reviewable controller patch; do not launch it against real PRs until independent verification accepts it.
4. **Verification proportional to change.** Use supported Node22 first; run the clock hook and rendered suites plus relevant existing card review/controller suites sequentially. Include UTC and America/Chicago for the rendered lane. Typecheck and whitespace pass. Preserve current full-CI failure; after final source changes run one applicable consolidated gate and confirm GitHub CI on the exact final head, without overlapping matrices. For controller changes use deterministic GitHub/Git simulations rather than spending model calls on CI polling. Do not claim local macOS success proves Linux or installed-webview behavior.
5. **Evidence and handoff.** Map both issue IDs to exact fixes/tests. Record cwd/branch/base/final hashes, runtime, commands, exits/counts and limitations. Preserve failures and prior accepted work. Mark this roadmap item corrected pending independent review. The implementer leaves changes uncommitted/unpushed; the Codex Git lead publishes and integrates only fresh approved snapshots with passing exact-head checks.

## Preserve and exclude

The primary checkout's dirty ROADMAP and unique schema14 note; accepted but unmerged keyboard guards, parity isolation, schema14 preparation, MAINT-143-KEYS, timezone PR152 and REL03 packages; separately owned M4; already merged PR154/155/157/159/160. No release/version changes, installer tests, real profiles, signing, publication, destructive commands, security/permission bypass or dependency/configuration weakening. Selected v0.5.4 release remains separate. Scheduled chat monitoring stays off.

**Stopping point:** one independently reviewable source correction and one reviewable local-controller recovery patch with actual evidence. Do not start a new roadmap milestone, relaunch a broad unattended session, or merge red CI. No repair implementation or restart was performed by this diagnostic review.
