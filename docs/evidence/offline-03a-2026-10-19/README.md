# OFFLINE-03a local gate receipts — 19 October 2026

Run sequentially on this Mac, with Node 22 and `SDKROOT=…/MacOSX26.5.sdk`, on branch `claude/offline-03a-core-fixes`, before the commit that adds this folder. Each log ends with its exit code.

| Receipt | Result |
| --- | --- |
| `typecheck.log` | exit 0 |
| `vitest-full.log` | 3,906 passed, 6 skipped (186 files, 4 skipped); exit 0 |
| `build.log` | exit 0 |
| `cargo-test.log` | 816 + 13 + 15 = 844 passed, 11 ignored; exit 0 |
| `clippy.log` | `-D warnings`, exit 0 |
| `fmt.log` | `--check`, exit 0 |
| `cargo-lock.log` | exit 0 |
| `diff-check.log` | exit 0 |
| `schema14-helper.log` | 26/26 |

**Earlier attempt.** One frontend run before these failed 4 tests:
- the two upgrade tests compared `ai_study_sets` rows without allowing for 0016's defaulted columns;
- an editor-safety test found the material title twice, because the closed "Write your own" dialog was rendered.

Both were corrected, and the run above is clean.

No provider, real profile, key, installer or release was involved.

## After the Codex round-1 fixes (`ca8e319` plus test-timing fixes)

| Receipt | Result |
| --- | --- |
| `r2-typecheck.log`, `r2-build.log`, `r2-diff-check.log` | exit 0 |
| `r2-schema14-helper.log` | 26/26 |
| `r2-vitest-full.log` | **failed**: 1 of the new regressions timed out under full-suite load (it waited for the default 1 s) |
| `r2b-vitest-full.log` | **failed**: another new regression clicked a choice before the review's comparison loaded (the Save button renders first) |
| `r2c-vitest-full.log` | **3,909 passed, 6 skipped; exit 0** — after the tests waited for the choices themselves, with slow-runner timeouts |

Those two failures were test timing only; product code is unchanged since `ca8e319`. The round-1 fixes are TypeScript only, so the native receipts above still apply.

## After the Codex round-2 fixes

| Receipt | Result |
| --- | --- |
| `codex-r2-regressions-before-fix.log` | the 2 new regressions fail on the pre-fix source (2 failed, 10 passed) |
| `r3-typecheck.log`, `r3-build.log`, `r3-diff-check.log` | exit 0 |
| `r3-vitest-full.log` | 3,910 passed, 6 skipped, **1 failed: C1-R2 in `CardReviewPanel.test.ts`** |
| `r3-flake-cr-01-isolated.log` | that file alone: 29/29 |

**About the C1-R2 failure.** C1-R2 is the pre-existing load-sensitive card-review test, tracked as FLAKE-CR-01. It also fails on a clean main under load. This branch does not change `CardReviewPanel.tsx` or its tests. Per the workflow, the failure is recorded rather than rerun until it passes; every OFFLINE-03a test passed in this run.

## After the Codex round-3 fix

| Receipt | Result |
| --- | --- |
| `codex-r3-regressions-before-fix.log` | the 2 new regressions fail on the pre-fix source (2 failed, 31 passed) |
| `r4-typecheck.log`, `r4-build.log`, `r4-diff-check.log` | exit 0 |
| `r4-vitest-full.log` | **3,913 passed, 6 skipped; exit 0** |

## After the Codex round-4 fix

| Receipt | Result |
| --- | --- |
| `codex-r4-regression-before-fix.log` | the new regression fails on the pre-fix source (1 failed, 12 passed) |
| `r5-typecheck.log`, `r5-build.log`, `r5-diff-check.log` | exit 0 |
| `r5-vitest-full.log` | **3,914 passed, 6 skipped; exit 0** |

## After the Codex round-5 fix

| Receipt | Result |
| --- | --- |
| `codex-r5-regression-before-fix.log` | the new regression fails on the pre-fix source (1 failed, 13 passed) |
| `r6-typecheck.log`, `r6-build.log`, `r6-diff-check.log` | exit 0 |
| `r6-vitest-full.log` | **failed**: one editing test waited the default 1 s for the editor panel under load |
| `r6b-vitest-full.log` | **3,915 passed, 6 skipped; exit 0**, after this file's async wait limit was raised to 10 s |

## Codex round 6 and Qwen correction, independently tested

Source correction: `9d3a90c7832525cb831dacb1a41b2dbd3628b5ed`, based on Claude stop point `7562324`. Owner workflow is Qwen implementation, Codex independent review/test and gated integration. Both Qwen CLI runs were bounded; the first reached its turn limit and was resumed with feedback, and Codex ended the second edit pass after the finished patch passed the independent gates. Qwen did not run the checks or claim independent acceptance. Raw CLI transcripts stay local; the published receipts below are test/build evidence only.

| Receipt | Result |
| --- | --- |
| `codex-review-r6-result.md` | original RED finding, preserved |
| `codex-r6-false-ack-first-pass.log` | first correction still repeats a save after false acknowledgement: expected failure, exit 1 |
| `codex-r6-regressions-before-fix.log` | four maintained UI cases over original `7562324`: 4 failed as expected, 14 unrelated skipped, exit 1 |
| `r7-focused.log` | six suites, 164 passed, exit 0 |
| `r7-independent-restart.log` | two independent rejected/false-ack restart cases passed, exit 0 |
| `r7-typecheck.log`, `r7-build.log`, `r7-cargo-lock.log`, `r7-diff-check.log` | exit 0 |
| `r7-vitest-full.log` | 3,925 passed, 6 skipped; no unhandled errors reported; exit 0 |
| `r7-source.json` | exact code commit and five changed-file SHA256 values; source unchanged during fresh gate |

The negative baseline source copy was created from `git archive 7562324 src src-tauri/migrations vite.config.ts package.json tsconfig.json`, with a shared dependency symlink and only the maintained `StudySetEditing.test.ts` overlaid. Command: Node22 `node_modules/vitest/vitest.mjs run src/pages/StudyLibrary/StudySetEditing.test.ts -t 'acknowledgement failed because|re-confirming a committed|discarding an answer she never' --reporter=verbose`. All four failed; the discard case times out waiting for cleanup absent in the old source. No source checkout was reset. Full gate command was Node22 `vitest run`, then `npm run build`, `npm run test:cargo-lock`, `git diff --check`; typecheck and focused commands are in the acceptance report/controller receipts.

Native source has been unchanged since `f02e850`; original native 844/11-ignored, clippy and fmt receipts are reused. Schema helper is rerun after tracker/manifest changes and recorded separately. Exact-head CI and installed behavior are separate gates.

**Schema helper after documentation updates:** `r7-schema14-helper-sandbox.log` records 25/26 and exit 1: sandbox `pgrep` errors preceded the expected refusal line. `r7-schema14-helper-host.log` records the same synthetic suite with host process visibility: 26/26, exit 0. No profile operation ran. `r7-commands.json` records focused/full/build/typecheck/lock/whitespace/helper commands and exits. The rebound 20-file manifest and all receipt checksums were verified before publication.

## Round-7 already-absent journal correction (latest code `d6ce015370dae0acfa81ba4b18a80c46925640cf`)

The initial PR head `72f2be2` was not merged. Codex independently reproduced an already-removed journal entry leaving discard-failed; the PR stayed draft and CI run 39353697326 was cancelled as superseded (terminal conclusion verified: cancelled, no failed steps). Qwen corrected it. Its intermediate fallback incorrectly handled rejection too: **5 failed / 46 passed** in `r7-intermediate-focused-failure.log`; preserved, then fixed. No test weakening or timeout changes.

| Receipt | Result |
| --- | --- |
| `codex-review-r7-result.md`, `codex-r7-independent-before-fix.log` | original P2 and independently failing UI diagnostic |
| `codex-r7-regressions-before-fix.log` | two new maintained cases over `72f2be2`: 2 expected failures, 18 unrelated skipped, exit1 |
| `r8-focused.log`, `r8-typecheck.log` | 166 passed; typecheck exit0 |
| `r8-independent-absent.log` | independent missing-entry case passed |
| `r8-vitest-full.log` | 3,927 passed / 6 skipped; no unhandled errors reported; exit0 |
| `r8-build.log`, `r8-cargo-lock.log`, `r8-diff-check.log` | exit0 |
| `r8-source.json`, `r8-commands.json` | final code identity, source hashes and current commands/exits |

The two new baseline cases use the same owned temporary-source-copy method as round6, with production at `72f2be2` and the maintained editing test file overlaid. Command: Node22 vitest run `src/pages/StudyLibrary/StudySetEditing.test.ts -t 'a false answer' --reporter=verbose`. Both old-source cases time out waiting for cleanup the prior code never completes. Source stayed unchanged during the fresh gate. False-with-present fixtures now include the actual ready journal record after regeneration; they retain every existing safety assertion. The native restore quarantine's hidden old jobs are treated according to its existing logical journal view, without native/profile changes. Native844/11-ignored receipts remain applicable. Final schema-helper rerun follows tracker/manifest rebinding.

**Final round-7 helper:** `r8-schema14-helper-host.log` records 26/26, exit0, after the latest tracker/source-manifest rebinding. `r8-commands.json` includes that exact command and boundary. All73 receipt checksums and all20 frozen inventory entries match.
