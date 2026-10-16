# M4 document navigation: round-4 corrections report (16 October 2026)

**CORRECTED, PENDING INDEPENDENT (CODEX) REVIEW.** Evidence-only work on [the round-4 assignment](M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md) (M4-R28–R32).

- **Branch:** uncommitted on `claude/m4-round4-corrections`, worktree `/Users/rickymac/code/Flight-training-m4-round4`, based on `main` at `7e49558`.
- **Not touched:** no production file, migration registration, dependency, build, app launch, profile or provider call.

## Ownership and starting point

On 16 October 2026 the owner reassigned M4 and P54-01 to Claude ("Claude takes over M4"). Gemini owned round 4 before that.

| Check | Result |
|---|---|
| Gemini's checkout `Flight-training-m4-viewer-evaluation` (HEAD `c28ab84`, 19 untracked entries) | **Left untouched.** The pack and the other untracked M4 packs were copied into this worktree. The three packs that already exist in `main` were compared and are identical. |
| Ten submitted hashes frozen by the round-3 review | **1/10 still matched** in Gemini's checkout (`contractModel.mjs`). The other nine were edited on 11 October between 22:25 and 22:50, after the reviewed submission. |
| What those edits were | Unreviewed, unfinished round-4 work by Gemini: ownership reservation, cancellation and post-await rechecks; new R28–R32 tests and mutants; `historical-specimens/round3-submitted/` (whose report and SHA256SUMS match the frozen hashes). There was no round-4 report. |
| Frozen copies available | Only the three proof modules are preserved in `m4-round3-senior-review-2026-10-11/submitted/`. The submitted test suites, runner, README and map are not preserved anywhere, so the exact reviewed pack cannot be rebuilt. |
| Starting point used | Gemini's latest work, with every starting file's SHA-256 recorded in [`starting-point-hashes.txt`](evidence/m4-round4-claude-2026-10-16/starting-point-hashes.txt) (125 files) |

### The five frozen diagnostics

| Target | Node 22.23.3 | Node 26.10.0 |
|---|---|---|
| Frozen round-3 submission | 0/5 pass (exit 1) | 0/5 pass (exit 1) |
| Gemini's unreviewed round-4 state | 5/5 pass (exit 0) | 5/5 pass (exit 0) |

Outputs: [`diag-*`](evidence/m4-round4-claude-2026-10-16/). No fixture adapter was needed.

## What Claude found and changed

### 1. The R31/R32 tests could not fail

Gemini's six R31/R32 cases passed without testing the runner. Replaced cases: [`replaced-gemini-r31-r32-tests.txt`](evidence/m4-round4-claude-2026-10-16/replaced-gemini-r31-r32-tests.txt).

- **Tamper test:** ran `shasum` on a folder the test itself built, not the runner.
- **Installer test:** set `exit = 42` and then asserted `exit` was 42.
- **Payload test:** checked a FAILED string it had written itself.
- **R32 validator tests:** re-implemented the validator inside the test file.
- **Executed-mutant test:** asserted a literal 16.

**Fix:** the runner's checks moved to `scripts/evidenceChecks.mjs`. The runner uses them, and the new permanent cases call them or the real runner:

- `[M4-R31] the real runner rejects a delivered receipt altered after sealing`
- `[M4-R31] a failing final manifest check produces a FAILED outcome and never a PASS`
- `[M4-R31] an interrupted run leaves its outcome receipts marked incomplete, never an earlier success`
- `[M4-R31] an installer failure is recorded with its real non-zero exit and a FAILED result`
- `[M4-R32] the runner's validator accepts claims that match what executed`
- `[M4-R32] the runner's validator rejects a cited mutant that never executed`
- `[M4-R32] the runner's validator rejects an executed mutant missing from the report`
- `[M4-R32] the runner's validator rejects a cited test that did not run`
- `[M4-R32] the runner's validator rejects stale counts`
- `[M4-R32] executed mutant IDs and failure outcomes are derived from execution records`

**Six checks of these cases:** each was broken in a disposable copy, the matching case failed, and the file was restored byte-identical ([record](evidence/m4-round4-claude-2026-10-16/mutation-checks-of-new-r31-r32-tests.txt)):

- stale counts ignored;
- missing executed mutants ignored;
- incomplete marker made a no-op;
- manifest check always passing;
- install exit ignored;
- historical lines treated as current.

### 2. An interrupted run could leave an earlier success behind (R31)

`15-run-summary.json` and `16-manifest-verification.txt` were only written at the end. A run that stopped part-way therefore left the previous run's success in place.

**Fix:** the runner now marks both receipts **incomplete** before its first step, after the read-only `--verify-manifest-only` branch.

### 3. `--install` was unreachable from a clean checkout (R31)

The runner stopped on a missing engine before reading `--install`, so the live-install lane could never run from a clean checkout.

**Fix:** only the reuse lane now requires an existing engine.

### 4. A test that only worked in Gemini's checkout

`[M4-R21] pointing the ledger back at this worktree's own migrations fails the verification` read the surrounding checkout's migrations and assumed there were 13. That is true only of `c28ab84`, so anywhere else it failed its precondition.

**Fix:** the test now builds the stale 13-migration ledger itself (the accepted ledger without 0014). The assertion is unchanged.

### 5. Claims validated against execution (R32)

The runner validates the current report (this file) and the pack README against what ran:

- every cited test executed;
- every cited mutant executed, and every executed mutant is cited;
- cited counts match the measured counts.

Lines labelled historical keep earlier claims without being validated as current ones.

## R28–R30 (Gemini's implementation, reviewed and retained)

- **R28, durable ownership:** a request reserves a unique ordered durable token under the write lock before any asynchronous work. The tests use two connections to one file-backed database:
  - `[M4-R28] file-backed DB: overlapping controllers, earlier completion released first, later request wins`
  - `[M4-R28] file-backed DB: overlapping controllers, later completion released first, earlier completion rejected`
  - `[M4-R28] earlier pending operation is fenced from becoming a durable stale winner once later claim exists`
- **R29, cancellation at the commit boundary:**
  - `[M4-R29] abort while persistence is pending fences the operation before commit and preserves previous saved tuple`
  - `[M4-R29] an old operation cancellation cannot cancel or release a newer operation claim`
  - `[M4-R29] post-commit delayed acknowledgement retains storage result but suppresses publication`
- **R30, publishing only for the current operation:**
  - `[M4-R30] late fulfilled commit acknowledgement cannot overwrite newer controller progress`
  - `[M4-R30] late retry acknowledgement cannot overwrite newer controller progress`
  - `[M4-R30] obsolete opener failure must leave winner notice and state intact`
  - `[M4-R30] route navigation A -> B -> A with delayed persistence leaves final winner intact`

Each guarantee has a guard-reversion mutant that fails an unchanged regression: `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION`, `M15_DISABLE_COMMIT_CANCELLATION_FENCE` and `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK`.

The thirteen earlier mutants stay unchanged:

- `M1_RELAX_SHARED_COUNT_VALIDATOR`
- `M2_REJECT_NULLABLE_PARENT`
- `M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION`
- `M4_DISABLE_COMMIT_GENERATION_FENCE`
- `M5_IGNORE_CONTENT_PROGRESS_SCOPE`
- `M6_DROP_DESTINATION_COUNT_REQUIREMENT`
- `M7_DROP_LABEL_CONTENT_BINDING`
- `M8_TRUST_CALLER_DESTINATION_BOUNDS`
- `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE`
- `M10_HARDCODE_STALE_LEDGER_CEILING`
- `M11_OMIT_TUPLE_PROPAGATION`
- `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING`
- `M13_RETRY_SENDS_NEWEST_GENERATION`

In total there are 16 executed mutants and 72 mapped tests.

## Verification

Both lanes run from clean disposable checkouts: `prepare-accepted-main.mjs e8720003…`, then `run_integration_proof.mjs --install`. Results and receipts are in the lane folders of [`evidence/m4-round4-claude-2026-10-16/`](evidence/m4-round4-claude-2026-10-16/) and are summarised in `lane-results.md` there.

## Still open

- **Exact reviewed pack:** it cannot be rebuilt, because the submitted suites, runner, README and map were not preserved. The review compares against Gemini's latest state through `starting-point-hashes.txt`.
- **Not started:** P54-01 production work. It starts only after Codex accepts this round.
- **Unchanged:** OD-1–OD-10 stay proposed; candidate migration 0015 stays unregistered; installed gates stay deferred.
