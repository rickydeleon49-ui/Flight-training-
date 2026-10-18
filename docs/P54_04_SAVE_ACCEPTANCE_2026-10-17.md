# P54-04 export Save correction: independent source acceptance

**ACCEPTED (source review).** Codex implemented the correction as PR195, merged into PR193's branch at `27c39711b46f0737c0b7e42b7b2f4d81b752b02c`. Claude reviewed it. Claude did **not** author the correction. Claude did write the original P54-04 feature, PR193, which this correction modifies, and that relationship is disclosed here. This is not PR193 main-integration acceptance and not installed/release acceptance. Codex still performs PR193's final review, current-main retarget/reconciliation and exact-head CI.

## Reviewed source (verified byte-for-byte against the assignment's hashes)

| Path at 27c3971 | SHA-256 |
| --- | --- |
| `src/pages/StudyLibrary/ExportStudyDialog.tsx` | `8d3a71345825a50152ae85816cc67eb3378309c72c40200b1d36e132d3916a11` |
| `src/pages/StudyLibrary/ExportStudyDialog.test.ts` | `06bd6822970bd8f4a0fcc849f9c40b59aa60766bcbc5b9c5e048c9fa3387585b` |
| `src-tauri/src/study_export.rs` | `0a85d06aa0ee5b61751980b6538d9efa760301a5cfbfe3efe761cf2f28d75617` |

There is no newer source and no earlier acceptance on main or PR193. The submitted evidence (`docs/evidence/p54-04-save-recovery-2026-10-16/SHA256SUMS`) verifies with 0 failures.

## Findings

- **Single dispatch.** The `busy` ref is set synchronously before any state update. It guards output construction, the native await, cancellation (a `null` result), rejection, and the early packet-validation refusal (`return` inside `try`). It is released only in `finally`. Two Save events delivered in the same render dispatch exactly one native save.
- **Pending controls describe the dispatched bytes.**
  - The bytes are built from the selection at click time.
  - While a save is pending, both choice fieldsets and the answer-key option are disabled, the dialog is not dismissible, and Cancel is disabled.
  - So the visible choices cannot diverge from the dispatched bytes, and a stale completion cannot land in a reopened dialog.
- **Retry paths.**
  - A rejection followed by a deliberate retry dispatches a second save that succeeds.
  - A validation refusal (an API-key-shaped string in a packet) opens no save dialog and releases the lock. The corrected selection then saves once.
  - A review-only check (below) confirmed that the bytes dispatched after correcting the selection **do not contain the refused content**.
- **Native.**
  - `write_export` delegates to a private `write_export_with(path, bytes, limit, persist)` with a typed persistence callback. There is no environment, PATH or public-command bypass.
  - The size limits, chooser, symlink/folder refusals, path-free errors and atomic temporary-file-then-rename contract are unchanged.
  - Real fault tests cover: a partial write followed by an error, a flush failure on a new file, a panic during persistence (temp removed during unwind), and a rename failure after a complete write, using a directory created at the destination. In each case the original destination stays intact or unpublished, and the temporary file is removed.
  - The module comment correctly limits the cleanup claim: a forced kill or an OS-denied cleanup can leave a temporary file. The retracted Windows handle-leak claim is not revived, and no Windows or installed behavior is claimed.
- **No defects found.**

## Independent checks (Node 22.23.3, rustc 1.99.0; receipts in [evidence](evidence/p54-04-save-acceptance-2026-10-17/README.md))

| Check | Result |
| --- | --- |
| Focused frontend: `ExportStudyDialog`, `logic/studyExport`, `logic/studyHandout`, `services/studyExport` | 4 files, **36/36**, exit 0 |
| Native `cargo test --locked --lib study_export` | **13/13**, exit 0 |
| Typecheck / production web build | exit 0 / exit 0 |
| Correction regressions against the original PR193 dialog (a490dac) | **2 fail** as intended: same-render double dispatch and editable pending controls. The other 9 pass |
| Review-only: bytes dispatched after a corrected selection exclude the refused content | Pass. The appended check ran in a disposable copy of the test file, which was removed afterwards |

**Not repeated:** the full frontend and native matrices, strict Clippy, fmt and lock checks. The correction's own gate (3,320 frontend / 490 Mac native, green exact-head CI on 27c3971) is separate author/CI evidence. PR193's final current-base CI is still required.

**Not verified by these source checks:** the installed save dialog, WebKit printing and any Windows behavior. No app launch, profile/key, provider, installer, signing or release operation occurred.
