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
   When `root` exists and is a directory with 0 entries, `item_to_reveal_in` returns `Ok(root.to_path_buf())`. On macOS, `open_data_folder_with` calls `reveal_item_in_dir(&root)`. The command now asks the opener to *reveal* the folder instead of *opening* it, and Finder's behaviour on an installed Mac was **not observed** because no app launch was performed.

2. **Distinct inspection error preservation:**
   `item_to_reveal_in` returns `std::io::Result<PathBuf>`. Any `read_dir` or entry-reading I/O failure (such as missing directory or permission denied) produces `Err(e)`. The command preserves the error, formatting it as `Could not open <root>: <io_error>`, without dispatching to `open_path` or swallowing the error. An unreadable individual entry inside the folder now stops the reveal with an error, where it was previously skipped.

3. **Preserved database and child reveal:**
   If `her-flight-deck.db` is present, it is revealed directly. If absent but other children exist, the first child in lexical order is revealed.

4. **Zero-bypass command routing test adapter:**
   Command routing is mediated by `FolderOpener` (implemented in production by `SystemFolderOpener`). In unit tests, `TestFolderOpener` records opener dispatch without launching Finder. Tests verify:
   - Empty `.app` root dispatches `OpenerCall::Reveal(root)` (fails under the reviewed fallback, which called `OpenPath(root)`).
   - Non-existent/unreadable root returns `Err` and dispatches nothing (fails under reviewed fallback, which called `OpenPath(root)`).
   - Permission-denied listing on Unix (`0o000` directory mode with drop guard cleanup) returns `Err` starting with `Could not open <root>` and dispatches nothing.
   - Database-present root dispatches `OpenerCall::Reveal(db)`.
   - Database-absent nonempty root dispatches `OpenerCall::Reveal(first_child)`.
   - Non-macOS routes directly to `OpenerCall::OpenPath(root)`.
   - Opener errors are formatted with `Could not open <root>: <err>`.
   No environment variables, PATH modifications, AppleScript, shell launches, or dummy files are used.

5. **Private helper scope:**
   `open_data_folder_in` is marked private (`fn`, not `pub fn`) as it is only called by `open_data_folder`.

---

## 3. Verification results

All required verification checks were executed locally and passed with exit code 0:

| Check | Command | Result |
|---|---|---|
| Rust unit tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **PASS (exit 0)**, 477 passed, 0 failed, 6 ignored |
| Rust linter | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **PASS (exit 0)**, 0 warnings |
| Rust formatter | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | **PASS (exit 0)**, clean |
| Lock synchronization | `npm run test:cargo-lock` | **PASS (exit 0)**, synchronized at 0.5.5 |
| Frontend typecheck | `npm run typecheck` | **PASS (exit 0)**, `tsc --noEmit` clean |
| Frontend full test suite | `npm test` | **PASS (exit 0)**, 146 passed, 4 skipped; 3,252 passed, 6 skipped |
| Schema-14 helper suite | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | **PASS (exit 0)**, 26 passed, 0 failed |
| Schema-14 checksums | `shasum -a 256 -c docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS` | **PASS (exit 0)**, 21/21 OK |
| Diff hygiene | `git diff --check` | **PASS (exit 0)**, 0 errors |

---

## 4. Source inventory and hashes

The primary modified code file:
- `src-tauri/src/backup.rs` (`open_data_folder_in` made private; permission-denied test added)

All modified paths and SHA-256 digests will be recorded in the tracking PR. No app profiles, encryption keys, installers, or Claude M4 worktrees were touched.
