# P54-05 part A (lesson brief) receipts, 2026-10-17

Paths are relative to this directory. All receipts are from base 32582f2 plus the branch changes listed in `source-hashes.json`.

- **Final gate on the final source:** each check has a `.log` and `.exit`.
  - `frontend`: full vitest, 3,584 passed and 6 skipped.
  - `native`: full `cargo test --locked`, 532 passed and 6 ignored.
  - `native-study-export`: the export tests only, 14 passed.
  - `focused`: the brief and P54-04 export suites, 42/42.
  - `typecheck`, `build`, `clippy`, `fmt`, `lock` and `helper` (26/26).
- `first-attempt/`: the failed first `typecheck` and `clippy` runs, kept as they were. The fixes are described in the report.
- `node-version.txt`: the Node and rustc versions.

`SHA256SUMS` covers every other file here. `git-blob-verification.json`, written after staging, records each member's hash read from its Git index blob.
