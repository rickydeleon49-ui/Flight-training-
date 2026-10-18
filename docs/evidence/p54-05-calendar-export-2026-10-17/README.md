# P54-05 part B (single-lesson calendar export) receipts, 2026-10-17

Paths are relative to this directory. All receipts are from base `2fc27b90aacd33183a8e5c0f3047008df37383b4` plus the branch changes listed in `source-hashes.json`.

- **Final gate on the final source:** each check has a `.log` and `.exit`.
  - `frontend`: full vitest, 3,629 passed and 6 skipped (`npx vitest run`).
  - `native`: full `cargo test --locked --manifest-path src-tauri/Cargo.toml`, 533 passed and 6 ignored.
  - `native-study-export`: the export tests only (`cargo test --locked --manifest-path src-tauri/Cargo.toml study_export`), 15 passed.
  - `focused`: calendar export logic, brief logic, event detail cost, lesson brief dialog, and calendar export dialog suites, 70/70 passed.
  - `typecheck`: `npm run typecheck` (`tsc --noEmit`), exit 0.
  - `build`: `npm run build` (`tsc --noEmit && vite build`), exit 0.
  - `clippy`: `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings`, exit 0.
  - `fmt`: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, exit 0.
  - `lock`: `node scripts/test-cargo-lock-sync.mjs`, exit 0.
  - `helper`: `node scripts/mac-schema14-profile-snapshot.test.mjs`, 26/26 passed.
- `node-version.txt`: the Node and rustc versions.
- `source-hashes.json`: SHA-256 and byte counts for all 8 source files changed/added for this feature.

`SHA256SUMS` covers every other file here. `git-blob-verification.json`, written after staging, records each member's hash read from its Git index blob.
