# Combined generation candidate: installed failure and source correction

**Status: source correction awaiting independent review; no public release.** Codex authored GEN-REL-05 and this correction, so this report is implementation evidence, not independent acceptance.

## Physical result: v0.5.6 is failed and private

The owner requested the combined GEN-REL-01–05 candidate via `scripts/release.sh` and an installed real-upload test. The owner entered a test key directly in Settings and confirmed the cleared field. A synthetic three-page, 64-term PDF was imported through the installed native UI; Standard and the default 40-card target were selected.

The installed v0.5.6 candidate at source `bb68b9af62d5573626f2f162eea68002fe5085f2` immediately refused the source with **“The selected source is no longer available. The draft was not published.”** Diagnostics reported preparing, attempt 0, elapsed 0 seconds. The native journal records zero admissions and seven zero request counters. This is a product regression before any upload, not evidence about the friend's internet or the provider's generation speed. Settings connection succeeded; successful upload, guide/card generation and practice-test generation were not established by this candidate.

Immutable failed DMG: `Her.Flight.Deck_0.5.6_aarch64_LOCAL_ADHOC.dmg`, SHA-256 `36c18ed8b60caa06a9e9ebe573d5a4aaf5ac510907df1ee3bec8e4cd20042020`. Sealed/installed executable SHA-256 `cb4ad8332747ef89f8a984194086cfb8bb6f2bb84f9ec260524b1e7f22bc3b71`. Full local paths and ZIP identity are in the curated evidence. No tag was pushed and no GitHub release/draft was created.

## Confirmed cause and bounded fix: GENREL-INST-R1

`documents::ImportedDocument.relative_path` and SQLite `study_materials.file_path` are relative to the **documents directory**. `prepare_submission` resolves that contract through `documents::stored_document_path` and then preserves the relative spelling in `LoadedSource.scope`. The batch journal uses the **app-data root**. `gemini_batches::unchanged` incorrectly joined scope directly onto that root, so all ordinary imported sources were rejected even after preparation had successfully read them.

The correction resolves `root / documents::DOCUMENTS_DIR / documents::safe_relative_path(scope)`. It retains SHA-256 comparison before and after every batch and refuses missing/changed/unsafe paths. The journal remains in app data. No file is copied into the wrong location, no retry/budget/cancellation rule is relaxed, and no migration, dependency, permission or credential implementation changes.

The old Rig invented `documents/source.pdf` as its stored path, hiding the production mismatch. It now stores `source.pdf` and writes under documents, including the existing changed-source and empty-source cases. With only this realistic fixture correction, the original 20/40/60 batching test fails with the installed error (exit 101). After the source correction it passes, preserving its upload-byte, request-count and token-bound assertions. Three new tests cover nested managed paths with root decoys, unsafe stored paths, and deletion while a response is held (no guide/cards checkpointed, no complete draft).

## Other bounded corrections

The initial study-aid description still promised 10–20 cards and automatic saving. It now describes the 20/40/60 choice, a potentially shorter grounded result, and deliberate draft saving. `scripts/release-policy.json` permanently retires the failed private v0.5.6 version and designates v0.5.7 as the next candidate. Existing retired versions and the Windows v0.5.1 hold remain intact. Candidate metadata is not publication approval.

## Data and installed evidence limits

This is a physical Apple Silicon **administrator-account** synthetic test on macOS 27.0.1. The original profile was held by atomic rename, without reading/copying/hashing its key, and returned with all recorded inode/ownership/mode/size/mtime facts unchanged. The app was stopped before each profile handoff. The user-connected test key remains private in the owned synthetic profile; it is never in the evidence or Git. Disconnect was not used because it can remove the legacy OS-keychain credential.

The failed candidate did successfully install from the read-only mounted DMG, launch by exact path, verify ad-hoc signing, and upgrade the synthetic populated schema-14 library to schema 15. All old ledger rows and old tables were preserved except the expected migration row and daily-plan date rollover. Gatekeeper assessment rejected the unsigned build (exit 3), as recorded; no bypass was performed. Developer ID/notarization, standard-account/minimum-macOS/VoiceOver behavior remain unverified.

The original packaging check expected read-only field names absent on this macOS. Its failed assertion and cleanup are retained; the same immutable DMG was remounted and verified using actual Writable/WritableMedia/WritableVolume false fields, then installed and detached. No DMG rebuild hid the failed receipt. The build also emitted a missing-libLLVM debug-stripping warning despite exiting zero; retained verbatim.

## Checks and continuation

See the evidence README and raw per-command exit receipts for the final check results and preserved failures. The initial Node 22 full frontend run failed the existing bounded-command test (expected output truncation, got timeout), and it also failed isolated. This was traced to the Homebrew library upgrade: the preflight intentionally sanitizes child environments, so its direct process.execPath child lost the private library override and aborted. Its signal is reported as timeout. This is not established as a timing flake or an application generation failure. Startup failures and both failed test receipts are retained; no environment allowlist, timeout, expectation or production source was changed. A bundled standalone Node 24.19.0 made that isolated probe pass, but eight unchanged SQLite validation-fixture cases then failed because that runtime refuses their sqlite_master edits; that failed full receipt is also retained. Final verification uses the official standalone **Node 22.23.3** downloaded from nodejs.org and matched against its official SHA-256 listing, with rustup 1.99.0 and SDK 26.5. This avoids the Homebrew library dependency without changing the runtime major, test expectations or global tools. The runtime download provenance is retained. Exact-head Linux CI remains required.

**Final source gate:** all ten recorded checks exit 0: typecheck; isolated preflight 34/34; frontend 3,699 passed / 6 skipped; production build; Rust 686 passed / 6 ignored; strict Clippy; fmt; cargo-lock; release-version retirement/eligibility probe; diff hygiene. The 16 focused batch tests also pass. All five application version files remain at accepted main 0.5.5; only the next-candidate policy changes to 0.5.7. No corrected v0.5.7 installer has been built or launched. The source fix is ready for independent review and exact-head CI; the next candidate follows acceptance. Before publication, finish the exact corrected candidate's live 40-card study aid, navigation/checkpoint/deliberate acceptance, practice-test and backup/restore verification and record the real outcomes. Keep any unmet gate explicitly unverified. Do not publish or overwrite the failed v0.5.6 bytes or push its local tag.

After the combined release passes its gates, resume P54-06 (including paused PR210 coverage correction, no adoption/migration implied), then P54-07 weather, then P54-08 FAA references. The feature loop stays stopped during this release correction.

Raw logs are gzip-compressed with original decompressed hashes retained. The initial staged hygiene check rejected trailing whitespace in captured build/test output; its failed receipt is retained. Final staged hygiene must pass without altering raw log bytes or adding checker exceptions.
