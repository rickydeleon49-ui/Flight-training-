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
