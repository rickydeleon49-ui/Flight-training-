# M2 PR 1 independent review evidence, 4 October 2026

This pack records an unaccepted local source submission and independent synthetic diagnostics. It is evidence, not executable approval for a release or PR 2.

- `submitted-changes.json`: exact base/branch, 26 verified file hashes, tracked unified diff and full new source files. Source changes remain uncommitted in the implementation checkout. Read this snapshot to review them; do not overwrite a working checkout with it.
- `submitted-SHA256SUMS`: original receipt. Paths are relative to the implementation checkout, not this evidence directory. All 26 matched before and after independent diagnostics.
- `submitted-report.md` and `submitted-gate/`: byte-preserved implementer report/eight gate logs. Counts/claims are reported evidence; report test-name/validator overstatements are identified in the independent review.
- `codex-diagnostic.test.ts`: seven focused frontend regressions using actual Node SQLite adapter/repositories and disposable stores. Copy temporarily to `src/data/` to run; all seven fail on the frozen submission.
- `codex_backup_diagnostic.rs`: append temporarily to `src-tauri/src/backup.rs` to access the actual private read-only verifier/native operations. Six assertions: five fail, valid schema control passes. Restore the original source immediately afterward. Native answer-time proof uses a brief clock separation; permanent regression should use a deterministic clock seam.
- `run_diagnostics.py`: exact sequential runner, with byte restoration and temporary-test removal in finally. Its checkout path is the reviewed Mac clone; adapt paths deliberately for another checkout. It reads no real application profile.
- `frontend-diagnostics.txt`: independent exit 1, seven failing assertions. `native-diagnostics.txt`: independent exit 101, five failures/one pass. Failures expose the approved behavior gaps, not setup/build failures.
- `diagnostic-results.json`: exit values and source-restoration confirmation. `SHA256SUMS`: this evidence pack's relative file hashes (excluding itself).

The full source gate was not independently repeated in this review. No app launch, provider request, account/installed test, signing or release work occurred. The frozen source and its submitted gate logs are preserved so another agent can independently inspect both passing and failing evidence.
