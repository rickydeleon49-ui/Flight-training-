# Settings / Data Recovery Open folder: independent review — 16 October 2026

## Decision and scope

**ACCEPTED AND MERGED** in PR #180 at `2a203df7820617caf4b3ce2ef8d15ba2cf7487ef` after successful current-base, exact-head CI. Reviewed PR #180 application head `a83a70244ed717a42588bbc9d4b0e4891917e9e5`; its nine changed paths are frozen in the evidence source manifest. The branch was updated through GitHub to include accepted main; the application hashes were verified identical before and after merging. This accepts the folder-opening correction for a future release, and does not authorize release publication or replacement of v0.5.5 assets.

The native `open_data_folder` command resolves `storage::app_root` itself, and accepts no frontend path. On macOS it reveals the database (or another existing child) using the opener plugin's native Finder API, avoiding Launch Services interpreting `com.herflightdeck.app` as an executable application. Other platforms retain the existing open-path behavior. Settings and Data Recovery use the command and display rejected string/Error messages. The webview's bare application-config open-path permission is removed; document permissions remain scoped.

## Finding OPENFOLDER-01 — non-blocking empty-folder boundary

`src-tauri/src/backup.rs:7331` still calls plain `open_path(root)` when `item_to_reveal_in` returns `None`. On macOS this is the same Launch Services path that cannot open the `.app`-suffixed support directory. The helper also converts directory-enumeration errors into `None`. Thus a completely empty folder, or an enumeration failure with no readable database, does not receive the successful child-reveal behavior. The existing unit test explicitly selects this fallback for an empty directory.

This is non-blocking for the reported installed case and normal startup: a successful upgrade/first-run preparation creates `backups` and the version marker, and a loaded library has the database. Both screens now display the real failure rather than silently hiding it. No new native reproduction of the empty-folder case was performed by the reviewer. Track a bounded follow-up before extending the claim to every recovery-state directory.

Acceptance for that follow-up: keep the existing database/child reveal, choose a non-launching fallback when the directory is empty (revealing the directory in its parent is acceptable for an empty directory), distinguish an empty listing from an I/O failure and preserve useful error text. Test database-present, database-absent/nonempty, empty `.app` directory and listing-error branches using a test adapter rather than launching Finder in automated tests. Keep native command resolution and narrow permissions; no placeholder files, bundle-ID change, AppleScript permission request or shell-based application launch is needed.

## Installed evidence boundary

Claude reports a successful Settings click on the second local test build: Finder showed the support-folder contents with `her-flight-deck.db` selected and no UI error. This is an implementer observation, not a second reviewer-executed installed test. The review did not launch any application, switch profiles, access the key, call a provider, rebuild a native installer or sign/publish anything.

Read-only inspection identified the two preserved NOT-FOR-RELEASE binaries (both still advertise version 0.5.5):

- First `d2b99ce` test executable: `b41037a57d611e390c5f5fe1871b40f49bbe0437c5c50f704edd846357834aca`.
- Second, built from then-uncommitted reveal correction: `2be208eda42b8e535a29e76c0cc39b508a128cd123b2604e0badd4ec1e9ea4e8`.

The implementer's saved before/returned root metadata records match. Their directory listings differ only in the parent (`..`) row, whose child count/time changed. The listed profile entries match. This verifies the saved metadata records; it does not independently prove every profile file's content. No secret content was inspected or hashed. Test binaries remain outside Git and are not release candidates. Installed Windows behavior remains unverified.

## Independent validation

Independent local gate: **9/9 exit 0** on the frozen application source: full frontend **3,252 passed / 6 skipped**, typecheck, frontend build, Rust **475 passed / 6 ignored**, Clippy `-D warnings`, fmt, Cargo-lock synchronization, diff hygiene, and schema-helper **26/26**. Commands and elapsed times for the sequential eight checks are in `results.json`; helper TAP is in `schema-helper.log`. Node 22.23.3, Homebrew Rust/Cargo 1.99.0, scoped SDK 26.5. No production source edits were made. All nine application hashes matched again after the checks.

GitHub's normal branch update produced head `0b81886015b20b0bf6866a7a547ef0db91cb4a25` on base `a76fa9b048d0d66160746047385dcec52d153a83`. Each reviewed application file at that head was compared directly with the frozen SHA-256 values: 9/9 identical. Earlier runs on `d2b99ce` and `a83a702` were cancelled when newer commits superseded them; neither is used as the final CI receipt. Final-head workflow [38949154063](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38949154063) completed successfully on the exact head with current main and merge state CLEAN. `exact-head-ci.json` preserves the gate decision; `merge-receipt.json` and `merged-source-verification.json` bind the merged source.

Raw results are preserved under `docs/evidence/open-data-folder-review-2026-10-16/`.

## Other work and next assignment

PR #179 is already merged at `b88e80a`; its owner-scoped Open Anyway rule is documentation and does not execute an OS override. PR #178 remains open for RELREC-01 (six missing native screenshots and complete evidence inventory). M4 remains evidence-only with R33–R36 required, as assigned in `docs/M4_RELEASE_REVIEW_CORRECTIONS_PROMPT_2026-10-16.md`. Neither this review nor the Open folder fix accepts M4 production adoption, proposed OD decisions, migration 0015 or a new release. The eight-item post-release queue retains its order.
