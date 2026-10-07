# M2 PR2 finish-corrections evidence manifest, 5 October 2026

Implementer submission evidence for `docs/M2_PRACTICE_SESSION_PR2_FINISH_CORRECTIONS_PROMPT_2026-10-05.md`
(closure of M2UI-R5–R10 from `docs/M2_PRACTICE_SESSION_PR2_REREVIEW_2026-10-05.md`). Application source stays
**uncommitted and unpushed** in `/Users/rickymac/code/Flight-training-pr70-integration` on
`codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`.

## Contents

- `submitted-report.md` — the corrected implementation report: controller design, R5–R10 closure with
  **exact existing file/case names**, documented choices, the repaired gate claim, and remaining limits.
- `source-hashes.json` — SHA-256 of the **29** source/documentation paths this submission touches, keyed
  relative to the **repository root** (not this directory).
- `SHA256SUMS` — SHA-256 of the evidence files in this directory, relative to **this directory**, excluding
  `SHA256SUMS` itself. Separate root by design.
- `gate/` — the final sequential source gate, one log plus one raw process exit per step:
  `01-typecheck`, `02-npm-test`, `03-build`, `04-cargo-test`, `05-clippy`, `06-fmt`, `07-cargo-lock`,
  `08-git-diff` (tracked `git diff --check` plus per-new-file whitespace/final-newline hygiene),
  `09-migrations-unchanged` (migrations 0001–0011 and the checksum registry vs the base commit).
  All nine exits are `0`, and they come from one final run taken after every source edit. Commands and counts are inside the logs and in report §7.
- `diagnostics/` — the reviewer's frozen `codex-pr2-rereview.test.ts` copied temporarily into
  `src/pages/StudyLibrary/` and run **verbatim** against the changed source, then deleted:
  `frozen-rereview-verbatim.txt` (18 diagnostics + 6 existing suites, `92 passed / 0 failed`, exit 0) and
  `finish-suite-with-frozen.txt` (the same set plus the new permanent 23-case suite and the 1-case browser
  erasure suite, `116 passed / 0 failed`, exit 0). Both were re-run against the **final** source state after
  every edit in this submission, not against an intermediate one. Each `.exit` file holds the value returned
  by the same shell invocation that produced its log.
- `validation-r10/` — the M2UI-R10 investigation kept separate from the gate: one full pre-gate frontend
  run (`full-run-preregist.*`, exit 0, zero unhandled errors) and three isolated runs of the implicated
  `ImportStudyPacketDialog.test.ts` (`import-repeat-1..3.*`, each exit 0, zero unhandled errors), plus
  `full-run-repeat.*` — a second complete `npm test` after the final fixes (exit 0, 2,545 passed,
  4 skipped, zero unhandled), kept because an earlier round of this work failed once under full-suite
  CPU contention on a load-dependent focus race that is now fixed and documented in the report.

## Notes on method and preservation

- Exits were captured before any pipe could mask them: `"$@" > log 2>&1` then `$?` into a sibling `.exit`
  file, with `set -u -o pipefail` in the runner. Nothing here relies on printed pass counts alone.
- The **prior** failed receipt is *not* restated or replaced: it remains byte-unchanged at
  `docs/evidence/m2-practice-session-pr2-corrections-2026-10-05/gate/02-npm-test.txt`, and the earlier UI
  submission stays at `docs/evidence/m2-practice-session-pr2-ui-2026-10-05/`. The rereview receipts stay on
  `main`. This directory holds only new evidence.
- The 26 hashes from `docs/evidence/m2-practice-session-pr2-rereview-2026-10-05/source-hashes.json` were
  re-verified against this clone **before** any edit: 26/26 matched, so the start point was exactly the
  reviewed state and no competing changes had to be reported or overwritten.
- The one-time baseline reproduction of the eight failures (`84 passed / 8 failed`, exit 1) was observed in
  an interactive run whose output was not retained as a file; the authoritative baseline receipt for that
  result is the reviewer's own `frontend.txt` and `results.json` in the rereview directory on `main`.
- Toolchain, scoped per command: `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`,
  `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Node v22.23.3, npm 10.9.9,
  rustc/cargo 1.99.0, Vitest 4.1.11, host macOS 27.0.1 on arm64.
- Every test here is a disposable synthetic check against temporary SQLite/sql.js state or a component
  boundary. None of it certifies the installed application, VoiceOver behavior, a real pilot profile,
  provider calls, packaging, signing or release readiness. Implementer runs are submitted evidence, not
  independent review.
