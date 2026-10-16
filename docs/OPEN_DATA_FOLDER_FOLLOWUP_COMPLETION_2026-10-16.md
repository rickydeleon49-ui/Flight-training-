# Open folder empty-directory follow-up (OPENFOLDER-01) — completion report

**Date:** 16 October 2026  
**Assignment:** [OPEN_DATA_FOLDER_FOLLOWUP_PROMPT_2026-10-16.md](OPEN_DATA_FOLDER_FOLLOWUP_PROMPT_2026-10-16.md)  
**Review reference:** [OPEN_DATA_FOLDER_REVIEW_2026-10-16.md](OPEN_DATA_FOLDER_REVIEW_2026-10-16.md)  
**Assigned agent:** Gemini  
**Reviewer:** Codex  

---

## 1. Scope and background

This is the bounded **OPENFOLDER-01** maintenance follow-up.

In PR #180, native folder opening on macOS was corrected by resolving `storage::app_root` and revealing the database (or first existing child) using `tauri_plugin_opener::reveal_item_in_dir`, avoiding Launch Services treating `com.herflightdeck.app` as an executable bundle. However, as noted in Finding OPENFOLDER-01:
- When the data folder was truly empty, `item_to_reveal_in` returned `None`, falling back to `open_path(&root)`. On macOS, Launch Services would attempt to launch the `.app` bundle and fail.
- Enumeration and I/O errors during folder inspection were swallowed into `None`, resulting in the same `open_path` fallback rather than preserving a descriptive inspection error.

## 2. Corrections implemented

1. **Empty directory reveal:**
   When `root` exists and is a directory with 0 entries, `item_to_reveal_in` returns `Ok(root.to_path_buf())`. On macOS, `open_data_folder_with` calls `reveal_item_in_dir(&root)`. Finder highlights the `com.herflightdeck.app` folder in its parent (`~/Library/Application Support`), cleanly displaying the folder without triggering Launch Services application launch.

2. **Distinct inspection error preservation:**
   `item_to_reveal_in` returns `std::io::Result<PathBuf>`. Any `read_dir` or entry-reading I/O failure (such as missing directory or permission denied) produces `Err(e)`. The command preserves the error, formatting it as `Could not open <root>: <io_error>`, without dispatching to `open_path` or swallowing the error.

3. **Preserved database and child reveal:**
   If `her-flight-deck.db` is present, it is revealed directly. If absent but other children exist, the first child in lexical order is revealed.

4. **Zero-bypass command routing test adapter:**
   Command routing is mediated by `FolderOpener` (implemented in production by `SystemFolderOpener`). In unit tests, `TestFolderOpener` records opener dispatch without launching Finder. Tests verify:
   - Empty `.app` root dispatches `OpenerCall::Reveal(root)` (fails under the reviewed fallback, which called `OpenPath(root)`).
   - Non-existent/unreadable root returns `Err` and dispatches nothing (fails under reviewed fallback, which called `OpenPath(root)`).
   - Database-present root dispatches `OpenerCall::Reveal(db)`.
   - Database-absent nonempty root dispatches `OpenerCall::Reveal(first_child)`.
   - Non-macOS routes directly to `OpenerCall::OpenPath(root)`.
   - Opener errors are formatted with `Could not open <root>: <err>`.
   No environment variables, PATH modifications, AppleScript, shell launches, or dummy files are used.

---

## 3. Verification results

All required verification checks were executed locally and passed with exit code 0:

| Check | Command | Result |
|---|---|---|
| Rust unit tests | `cargo test --locked` | **476 passed, 0 failed, 6 ignored** (37.46s) |
| Rust linter | `cargo clippy --locked -- -D warnings` | **PASS (exit 0)**, 0 warnings |
| Rust formatter | `cargo fmt --check` | **PASS (exit 0)**, clean |
| Lock synchronization | `npm run test:cargo-lock` | **PASS (exit 0)**, synchronized at 0.5.5 |
| Frontend typecheck | `npm run typecheck` | **PASS (exit 0)**, `tsc --noEmit` clean |
| Frontend build | `npm run build` | **PASS (exit 0)**, built in 953ms |
| Frontend full test suite | `npm test` | **PASS (exit 0)**, 146 passed, 4 skipped; 3,252 passed, 6 skipped (58.89s) |
| Diff hygiene | `git diff --check` | **PASS (exit 0)**, 0 errors |
| Schema-14 helper suite | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | **PASS (exit 0)**, 26 passed, 0 failed (3.38s) |

---

## 4. Source inventory and hashes

The primary modified code file:
- `src-tauri/src/backup.rs`

All modified paths and SHA-256 digests will be recorded in the tracking PR. No app profiles, encryption keys, installers, or Claude M4 worktrees were touched.
