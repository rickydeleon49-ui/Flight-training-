# OFFLINE-ON-1 — implementation awaiting Claude review

Uncommitted on `codex/offline-gen`. No shipped release switch, dependency, migration, real PDF/key/profile or pressure-mode run. Existing `node_modules` symlink preserved.

Kit message: "Making a study kit from your PDF isn't available in this version yet. It's coming in a later update." Disabled/no-cache is typed `EXTRACTION_UNAVAILABLE`; valid cache still works; no unavailable retry action. Gemini unchanged.

FLAKE-CR-01: test-only completion race. Modal-hidden history and a reset acknowledgement were mistaken for completed refresh. Held promises demonstrate that the existing epoch guard rejects the obsolete page; waits now require the closed dialog and unlocked refresh, actual read completion and each binder badge. [Diagnosis](evidence/offline-on1-2026-10-20/FLAKE_CR01_DIAGNOSIS.md).

Historical card-review failure did not reproduce in 3 pre-fix executable pairs (the first overlapped kit-red test addition). All 3 post-fix pairs had zero card-review/Review-due failures. Full concurrent suites remain red in benchmarks and, in pair 2, Questions paging, StudySetEditing and Flight Path remaining-ui. [Every failing name](evidence/offline-on1-2026-10-20/FAILED_TEST_NAMES.md). No timeouts/retries/skips added.

Baseline on owner M5 / 32 GiB is weaker evidence than a minimum-spec Mac. Production release-profile worker + supervisor, synthetic fixtures, disposable target removed. `/usr/bin/time -l` fails `sysctl kern.clockrate: Operation not permitted`; counted allocation bytes are not RSS, so baseline acceptance is **not passed**. Schema-14 helper also needs an outside-sandbox rerun. Pressure mode was not run. [Runbook](OFFLINE_ON_PRESSURE_CHECK.md).

| Synthetic file | Pages | Outcome | Counted peak MiB | RSS MiB | Wall seconds |
| --- | ---: | --- | ---: | --- | ---: |
| synthetic-illustrated-charts.pdf | 60 | ok | 115.881 | unavailable | 0.665 |
| synthetic-long-manual.pdf | 1050 | ok | 4.846 | unavailable | 0.241 |
| synthetic-small-checklist.pdf | 10 | ok | 0.068 | unavailable | 0.021 |

Receipts below are `.log` basenames under `docs/evidence/offline-on1-2026-10-20`; each EXIT is preserved. [All counts, commands and failures](evidence/offline-on1-2026-10-20/receipts.json).

| Receipt(s) | EXIT(s), same order | Count / outcome |
| --- | --- | --- |
| `red-kit-native` | 101 | 0 passed / 1 failed / 961 filtered (expected red) |
| `red-kit-ui` | 1 | 2 failed / 34 skipped (expected red) |
| `flake-repro-1`, `flake-repro-2` | 1, 1 | Vite EPERM before tests; permitted runner loader used thereafter |
| `flake-repro-runner-1`, `flake-repro-runner-2` | 1, 1 | each 4282 passed / 2 kit-red failures / 6 skipped; overlapped addition of kit tests |
| `flake-repro-3`, `flake-repro-4` | 1, 1 | each 4281 passed / 3 failed / 6 skipped (benchmarks) |
| `flake-repro-5`, `flake-repro-6` | 1, 1 | each 4283 passed / 2 failed / 6 skipped (benchmarks) |
| `flake-after-1-1`, `flake-after-1-2` | 1, 1 | Tests  3 failed  /  4284 passed  /  6 skipped (4293); Tests  2 failed  /  4285 passed  /  6 skipped (4293) |
| `flake-after-2-1`, `flake-after-2-2` | 1, 1 | Tests  4 failed  /  4283 passed  /  6 skipped (4293); Tests  6 failed  /  4281 passed  /  6 skipped (4293) |
| `flake-after-3-1`, `flake-after-3-2` | 1, 1 | Tests  3 failed  /  4284 passed  /  6 skipped (4293); Tests  3 failed  /  4284 passed  /  6 skipped (4293) |
| `npm-test-1` | 0 | Tests  4287 passed  /  6 skipped (4293) |
| `npm-test-2` | 0 | Tests  4287 passed  /  6 skipped (4293) |
| `kit-ui` | 0 | 36 passed |
| `flake-deterministic`, `flake-deterministic-final` | 0, 0 | each 1 passed; final late page has distinct ID |
| `focused-final` | 0 | 89 passed across 5 files |
| `cargo-test-1`, `cargo-test-2` | 0, 0 | each 979 passed / 11 ignored (951 unit + 13 service + 15 worker) |
| `format`, `fmt`, `clippy`, `cargo-lock`, `pressure-script-syntax` | 0, 0, 0, 0, 0 | no test count; default fmt/clippy/lock/syntax commands passed |
| `typecheck`, `typecheck-final`, `build`, `build-final` | 0, 0, 0, 0 | no test count; Node 22; build uses permitted runner loader |
| `schema14-helper` | 1 | 25 passed / 1 failed: sandbox pgrep stderr precedes expected REFUSED |
| `schema14-checksums`, `source-checksums` | 0, 0 | 21 schema-14 checksums and 16 changed-source checksums passed |
| `pressure-harness-tests`, `pressure-harness-tests-r2` | 1, 0 | 8 tests / 12 mock-fixture subcase errors, then 8 passed after isolating platform metadata mock |
| `baseline` | 1 | 3 worker outcomes ok / worker exits 0; 3 time-tool exits 1 / RSS unavailable; temporary release build EXIT 0 |
| `diff-check` | 0 | no whitespace errors |
| `evidence-checksums` | 0 | all final inventory checksums passed |

SHA-256 of the 16 changed source/docs/manifest files (report and raw evidence are additionally bound in the evidence `SHA256SUMS`; it excludes itself and its verification receipt):
```text
6280fc13203a3e7d11efa2bf7c0a59364d0ab211276372562f09108f542e4053  ROADMAP.md
87b3d6baee4dba4d90fc00e83621571e86ede54e24dd967532fd6ed14fc6fb57  docs/OFFLINE_ON_PRESSURE_CHECK.md
c05cd9838dc39a0106dfdec1f6f7476716b076e826c50b682925a1f7ca13da37  docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS
fda4f1b8df50c69bed5558db89cfcc0f5ee5900bf9156c5e05d5d71810f3347d  docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json
649d4a684bc5f4b1e5342e2cf56ed09d4a027d9c71433288db6c22e39f2dae6d  scripts/offline-extraction-pressure-check.py
03eaded5d9b36126e7d58830ca622b629cc888694da08f3352645dd75fb980da  scripts/offline-extraction-pressure-check.sh
9ce30663925860312a869c749dbceba7b37bdec3de18635ac45c1cad3b4c742e  scripts/offline-extraction-pressure-check.test.py
7a6aef9bd71cd3ee16735edac59e4015d5aa55a857cae2fdc3891ad550020b2e  src-tauri/examples/offline_pressure_probe.rs
ddf4fab838ef8bf4087236f4331cf6d93087d5aaaecacb58a2524528e77e9b19  src-tauri/src/pdf_kit.rs
ca2ca117e3f558adecfb848bc3f46b990700dd90f7bf0eb6551a6351b5f58679  src-tauri/src/pdf_kit_tests.rs
0e2f50dee061cfcb5eafffec83d71b4aff85f5f74c1c03bc1518caa12fcfda86  src/pages/StudyLibrary/CardReviewPanel.test.ts
bc0371ffd2bf44ea32159406c104d6f78f0ee8c085e6b8b9f485d2100af90701  src/pages/StudyLibrary/CardReviewResetTiming.test.ts
3575b85d5eb13c0094c8f98f02ba037cfa7d3f1f860fb659065e23b39937c1e8  src/pages/StudyLibrary/MaterialDetailPdfKit.test.ts
22bc70a5aaf121929eba2f203bf5dbcc31871c138c21d7f89cd2f0520872204c  src/pages/StudyLibrary/PdfStudyKitPanel.tsx
6af94a0dd26ea0a1d2697f4896e36e2a06d4c081594819c5a90b56dc72a15445  src/pages/StudyLibrary/ReviewDueClockRecovery.test.ts
2fa847ef18253f385f53bb56eed8ac52f778fe92a901ea50ce61455ac59ef319  src/pages/StudyLibrary/StudyLibraryReviews.test.ts
```
