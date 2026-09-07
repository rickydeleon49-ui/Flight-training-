# Release candidate audit — 6 September 2026

Version 0.5.0 remains unreleased. **Do not publish, tag, or run release.yml.**
The authorized endpoint is green CI, PR merge, and both test installer builds.
Starting remote main was verified at babba51d04a6890384d3b4dfaea06c0f616cbd9d.
The old checkout was clean and left untouched; this branch is
`fix/notes-recovery-release-audit` in a fresh checkout.

## Findings fixed

1. Material notes followed stale autosave refresh snapshots. The keyed editor
   now owns active text and drains later edits after the in-flight save.
2. Async beforeunload could not guarantee SQLite completion. Each keystroke now
   synchronously stores a recovery draft. Successful matching saves clear it;
   failed saves retain it and offer Retry. Storage-full warnings and ownership
   across remounted editors are covered, including saving when storage fills.
3. General draft recovery cancelled its final 400ms on navigation. Layout-time
   mirroring replaces that debounce. Existing Notes edits now recover too, and
   saving cannot clear newer typing or accept duplicate submissions.
4. Settings, Journal and edit dialogs reset on unrelated refresh. Initialization
   now follows editing sessions/record identity. Material metadata editing leaves
   notes to their dedicated autosaving editor.
5. Concurrent read-modify-write repository operations could lose independent
   fields. Application writes/refreshes are queued; stale refresh results are
   ignored. Successful writes remain successful when a subsequent refresh fails.
6. Toolkit updates carried stale full snapshots. They now read current state
   inside queued mutations. Deferred certificate deletion also reads current
   state and does not recursively queue a mutation.
7. Rapid deletions could replace the wrong waiting Undo request. The latest
   request is installed synchronously while earlier deletes settle.
8. Same-name imports could overwrite saved attachments before Save or on Cancel.
   Atomic filename reservation preserves existing bytes for imports and PDF
   splits. Failed writes clean up reserved destinations. Windows drive-relative
   and alternate-stream paths are refused on all platforms.
9. Multiple dialogs reused one title ID. Each now has a unique accessible ID.

## Validation

- 303 TypeScript tests across 32 files (283 baseline plus 20 new regressions).
- 51 Windows Rust tests passed (49 baseline plus 2); Unix has an additional
  permissions test, so 52 are expected in Linux CI and macOS builds.
- Explicit typecheck, production build, cargo fmt --check, and
  cargo clippy --all-targets -- -D warnings passed locally.
- Substantially changed TypeScript files passed pinned Prettier 3.6.2 checks,
  including PilotToolkit. No repository-wide formatter rollout was added.
- npm audit: zero vulnerabilities.
- React integration tests exercise the real provider, router, pages and SQLite.
  Tests cover delayed refresh, closing with IPC unfinished, navigation, remount
  ownership, failed saves/retry, empty notes, storage quota, rapid toolkit edits,
  rapid Undo, modal refresh, and newer typing during a Notes save.
- Browser smoke: all main pages and all eight Toolkit panels rendered. Material
  notes survived immediate navigation/reload; standalone draft recovery appeared.

Reviewed persistence/migrations, backup/restore and path checks, documents, PDF
splitting, Gemini submission/key handling, finance and flight-record validation,
actions, reminders, navigation, and editing behavior. Existing tests also cover
migration checksums, upgrades, WAL/backup recovery, financial totals, AI refusal
and file limits, and cross-feature repository workflows.

Gemini model support was checked against official documentation; no shutdown was
announced for the pinned models. This is not a live API test:
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/document-processing

## Limits and continuation

No live Gemini key, native file-chooser test, macOS hands-on test, or installation
over populated v0.4.0 data was performed. Browser smoke uses the development
SQLite driver, not Tauri IPC. Closing recovery is tested by destroying/remounting
editors with save promises permanently unresolved and by browser reload; native
Windows/macOS close/reopen remains a hands-on check. Drafts live in local webview
storage and are excluded from portable backups. If draft storage fails, keep the
window open until Saved. Cancelled imports may leave unreferenced private files,
but cannot overwrite saved attachments. Installers remain unsigned.

Read the task handoff for PR number, exact head/merge, CI and installer results.
Use the connected GitHub tools for PR creation/merge: the existing gh credential
can clone/push and access Actions/releases but PR GraphQL access is denied.
Merge only when Checks is green for the exact head. Then dispatch
`build-desktop.yml` on main with `platform=both` and verify Windows EXE and Apple
Silicon macOS DMG jobs/artifacts. **Never dispatch release.yml or tag v0.5.0.**
