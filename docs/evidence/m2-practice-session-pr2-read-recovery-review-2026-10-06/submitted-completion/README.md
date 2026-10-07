# M2 PR2 controller fix — completion evidence manifest, 6 October 2026

Implementer evidence for `docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_FIX_PROMPT_2026-10-06.md`
(M2UI-R11–R13 from `docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_REVIEW_2026-10-06.md`). Application source is
**uncommitted and unpushed** in `/Users/rickymac/code/Flight-training-pr70-integration`, branch
`codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`. Implementation is complete
and locally verified; it is **not** independently accepted.

## Contents

- `submitted-report.md` — competing-work disclosure (reported before touching affected files), R11–R13
  implementation and exact permanent case names, the defect I found in the in-flight work plus the
  with-fix / without-fix evidence, the gate table, the correction to the earlier §6 count mismatch, and the
  load-dependence findings.
- `source-hashes.json` — SHA-256 for the **29** submission paths, keyed relative to the **repository root**.
- `SHA256SUMS` — SHA-256 for the files in this directory, relative to **this directory**, excluding itself.
- `gate/` — final sequential gate: one log plus one raw process exit per step (`01-typecheck`,
  `02-npm-test`, `03-build`, `04-cargo-test`, `05-clippy`, `06-fmt`, `07-cargo-lock`, `08-git-diff`
  hygiene, `09-migrations-unchanged`). All nine exits are `0`.
  `gate/02-npm-test.attempt1-failed.*` is the **preserved failed attempt** (exit 1, 2 failed tests and 4
  unhandled connection-lifetime rejections) recorded on the same source before the clean retry, kept
  because R10 requires that a full-run failure be shown rather than quietly re-rolled.
- `diagnostics/` — the reviewer's frozen `codex-pr2-finalreview.test.ts` copied temporarily into
  `src/pages/StudyLibrary/` and executed **unmodified** beside the affected permanent suites
  (`frozen-controller-review-verbatim.txt`: 160 passed, exit 0, zero unhandled). The temporary copy was
  deleted afterwards; no reviewer diagnostic is part of the submitted tree.
- `load-investigation/` — two additional full-suite runs on identical source used to separate a genuine
  defect from machine contention: `full-run-attempt2-timeout.txt` (exit 1 on a subprocess-spawning accepted
  test that passes in 0.7 s in isolation; 2,555 passed / 1 failed / zero unhandled) and
  `full-run-idle-retry-pass.txt` (exit 0, 2,556 passed / 4 skipped / zero unhandled).

## Method and preservation notes

- Exits are captured from the process itself (`"$@" > log 2>&1`, then `$?` into a sibling `.exit`) under
  `set -u -o pipefail`; no result in this directory is inferred from `tee`-masked pipeline status.
- The reviewer's 29-path manifest was verified before any edit: **27 matched, 2 differed**
  (`PracticeTestPanel.tsx`, `PracticeSessionPR2Finish.test.ts`) — that in-flight R11–R13 work was kept and
  verified, not overwritten or reverted.
- `docs/evidence/m2-practice-session-pr2-controller-fix-2026-10-06/` (a different agent's **partial**
  receipts: typecheck pass, one failing `npm test`, `cargo fmt` exit 127 from a missing toolchain path, two
  diagnostic logs, no report or manifests) is preserved **byte-unchanged** alongside this directory.
- `docs/evidence/m2-practice-session-pr2-finish-corrections-2026-10-05/` and
  `docs/evidence/m2-practice-session-pr2-ui-2026-10-05/` remain untouched, including the earlier invalid
  full-run receipt that R10 required to stay visible.
- Toolchain, scoped per command: `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`,
  `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` — Node v22.23.3, npm 10.9.9,
  rustc/cargo 1.99.0, Vitest 4.1.11, macOS 27.0.1 on arm64.
- All tests are disposable synthetic checks against temporary SQLite/sql.js state or a component boundary.
  Nothing here certifies the installed application, VoiceOver behavior, a real pilot profile, provider
  calls, packaging, signing or release readiness. Implementer runs are submitted evidence, not independent
  review.
