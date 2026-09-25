# M1 D0 — Study Library file check

Date: 25 September 2026. Reviewed and completed on Windows x64 from `main` at `bdad35d`. This is a feature review, not a release or an installed Mac test.

## Behavior

Settings → **Check library** compares Study Library references with files under the app-owned `documents` directory. It reports materials whose files are missing and files without a material. The user can select a replacement file for a missing material (copied into app storage before attachment), import an unlinked file as a new material, or explicitly move an unlinked file to private trash. Re-attachment changes only the file fields; existing notes and study records remain with the same material ID. The result list initially renders 50 entries and can reveal more in batches.

The native scan refuses to report a clean library if the database is missing, its expected schema cannot be queried, a document entry is unreadable, a symbolic link appears among active documents, or staged-trash metadata is unreadable. It has a 16-directory depth and 50,000-entry bound. Each repair command rechecks current file and database state. Writes use an immediate SQLite transaction with a two-second busy timeout; a referenced file cannot be moved to trash. Repair file paths are restricted to real, visible files within app-owned storage. A failed attachment cleanup uses the reference-checked trash operation, so it cannot delete a file if the attachment actually committed.

Moving an unlinked file to trash is reversible **only until app restart**. The existing startup reconciliation purges unreferenced staged files. The confirmation and success messages state that limit. The file is excluded from a complete backup while unlinked; anyone who needs it should import or re-attach it before creating a backup. Changing this to long-term recoverable trash would require retention, a post-restart Restore/Purge UI, and backup semantics, and is outside D0.

## Review findings resolved

- Gemini's native repair commands were not registered with Tauri, so the frontend could not call them. Registered all four check/repair commands.
- New material defaults did not match the app's domain values. They now use `study_guide`, `needs_review`, and `later`.
- Duplicate checks masked database errors and could act on stale scan results. They now fail closed inside bounded write transactions.
- A forged path could target hidden trash or an intermediate linked directory. Repair actions now validate visible regular files and canonical parent containment.
- Legacy Windows records may contain backslash-separated document paths. The scan normalized them, but an exact-match repair query did not; duplicate checks now normalize separators in SQLite as well, preventing a referenced file from being trashed or imported twice.
- The shared staging helper used millisecond-based IDs and macOS `rename` could replace an existing staged file on an ID collision. IDs now use nanosecond timestamps, metadata is created exclusively, and the move uses the existing atomic no-replace helper. A collision leaves the original file and older trash copy intact.
- Settings had no check or repair controls. Added status, explicit confirmation for trash, per-file actions, and undo during the current session. Failed checks clear stale results.
- The new scan counted files but not empty directories toward its entry bound. It now counts every traversed entry.

## Validation

On this Windows x64 development host:

| Check | Result |
| --- | --- |
| `npm ci --cache .npm-cache` | Passed; 164 packages, 0 audit vulnerabilities. The workspace cache was removed after validation. The first run using the shared system cache failed with `EPERM`; a second attempt without network permission failed fetching packages, then the permitted workspace-cache install passed. |
| `npm test` | 407 passed, 2 skipped across 47 files. |
| `npm run build` | TypeScript and Vite production build passed. |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Passed. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed with no warnings. |
| `cargo test --manifest-path src-tauri/Cargo.toml --quiet` | 141 passed, 2 intentionally ignored; no failures on the final Rust diff. |

Focused Rust tests cover missing/unlinked detection, staged deletion exclusion, fail-closed schema/trash failures, preserving an existing material during re-attachment, stale/duplicate action refusal, legacy Windows separators, valid new-material defaults, and trash undo/path refusal. Frontend service tests cover native command dispatch and desktop-only behavior. This does not substitute for clicking the packaged Settings controls on Windows or Apple Silicon.

## Remaining device checks and release gate

In an installed build, check a missing PDF re-attachment, importing an unlinked PDF, moving one to trash and undoing before restart, and a large library list. On Apple Silicon, also verify the native picker, Finder/app-owned paths, and backup warning behavior. The Windows Defender clearance/signing and physical installed-app release gates in `STATUS.md` remain in force. No version, tag, or release was changed.
