# App polish audit evidence

Read `../../APP_POLISH_AUDIT_2026-10-19.md` first. This is source/browser evidence only; no installed or VoiceOver claim.

- `browser-checks.json`: ten narrow-route checks, ten desktop-route checks, numeric before/after geometry, five confirmation cases and form references.
- `short-dialog-checks.json`: keyboard access to Send and Escape dismissal in short native/fallback dialogs with enlarged text.
- `browser-console.json`: retained console event and its fixture hot-reload context; no whole-session zero-error claim.
- `confirmation-after-detail.jpg`: corrected three-action confirmation, actual ConfirmDialog with synthetic props.
- `progress-after.jpg`: corrected wrapping with the same long synthetic progress identifier.
- `raw-receipts.tar.gz`: unchanged failed-regression/first-gate/final-gate output and synthetic fixture source, with exits and member hashes. Tool-emitted whitespace is preserved inside the archive.
- `source-hashes.json`: owned source/doc hashes against accepted main `fdbf290`, excluding this evidence directory.
- `SHA256SUMS`: evidence hashes, excluding itself; run from repository root.

Node22.23.3, existing dependencies, real browser-mode UI for route/form checks; actual component fixtures for otherwise unavailable Gemini/native modal actions. No new dependency or application test hook was added. The ignored fixture is not part of the shipped app. Native Rust checks/benchmarks were not repeated for unchanged native code.
