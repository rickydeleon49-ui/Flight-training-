# App polish audit — 12 September 2026

This pass starts from `main` after the macOS data-safety audit. It focuses on startup, compact-window navigation, study-library file handling, long-running PDF actions, and backup feedback. It does not change the published `v0.5.1` release or claim the installed Mac app has been smoke-tested.

## Findings and changes

- **Startup:** The production build originally placed every route in a 504.27 kB JavaScript entry file (149.69 kB gzip). Section-level lazy loading reduces that entry to 351.85 kB (110.24 kB gzip); each section loads when first opened. The current route keeps the app shell visible with a loading indicator while its code loads.
- **Compact windows:** At widths at or below 900 px, Settings was hidden and the search button took the full navigation row. The compact header now keeps Search and Settings visible and allows the labeled section links to scroll horizontally. This is a code/CSS check; actual Mac and Windows window-size inspection remains to be done.
- **Long PDF jobs:** Automatic and manual split dialogs disabled their Cancel buttons while working, but Escape, backdrop clicks, and Close still dismissed them. Those dismissal paths are now blocked until the job finishes. A dialog regression test covers Escape/backdrop/Close and later dismissal.
- **Manual page input:** `parseInt` accepted an input such as `1.5` as page 1. The form now uses strict numeric conversion and the existing integer range validator rejects fractions.
- **Abandoned imports:** An uploaded file is copied into app-owned storage before its library record is saved. Canceling or replacing the file could leave an unused copy. The form now tracks files imported during that editing session, removes unused copies before saving, and removes them on Cancel. It preserves the chosen file after a failed save so the user can retry, and waits for the save to finish to prevent duplicate submissions. If cleanup fails, the form stays open and explains why.
- **Backup feedback:** The archive is finalized and validated before the separate database reminder is recorded. If that reminder write fails, Settings now says the backup file was saved and identifies its path, while warning that the reminder was not updated.

## Validation

- `npm ci`: passed, zero reported vulnerabilities.
- `npm test`: 39 files, 336 tests passed, including new dialog and import regressions.
- `npm run build`: passed; initial bundle measurement above.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo test`: passed, 86 Rust tests passed, one intentionally slow benchmark ignored.
- `npm run tauri build -- --bundles nsis`: passed on Windows x64, including a clean rebuild from the final front-end assets. This proves packaging, not installed-app behavior.
- `git diff --check`: passed.

## Device checks still required

On an installed Apple Silicon Mac running macOS 12 or newer, resize the window near 900 and 600 px and verify all navigation is usable; import a test document, cancel it, and confirm no unused copy remains; save a material with a document and open it; start an automatic and a manual PDF split and try Escape/Close while they run; save and restore a complete backup in Downloads; confirm Finder opens the app-data folder; and run one Gemini study guide and practice test with a non-sensitive PDF. Repeat the compact navigation and PDF action checks on Windows. The earlier Mac installation checklist and Gemini-key isolation limitation remain in `docs/MAC_AUDIT_2026-09-12.md`.
