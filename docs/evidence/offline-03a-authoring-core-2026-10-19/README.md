# OFFLINE-03a authoring core evidence

Read `../../OFFLINE_03A_AUTHORING_CORE_REPORT_2026-10-19.md` and `../../PR234_235_REVIEW_AND_INTEGRATION_2026-10-19.md` first.

- `raw-receipts.tar.gz`: complete unchanged focused/full frontend/type/build/whitespace output and explicit exits. Raw tool whitespace is preserved inside the archive.
- `archive-members.json`: exact per-member sizes/hashes. Focused authoring tests: 55 passed. Full frontend tests on main including both accepted PRs plus the new core: **3,835 passed / 6 skipped, zero unhandled errors**. Typecheck, build and whitespace all exit 0.
- `source-hashes.json`: owned source/doc files against accepted main `fc3ef34`; excludes this evidence directory.
- `SHA256SUMS`: evidence files excluding itself; verify from repository root.

This is source-only authoring logic. No runtime component imports it; it is not a finished editor, persisted history or migration. No new provider/dependency/lock/native/release path changed. Native Rust tests/benchmarks were not repeated locally for unchanged code. Installed, backup/restore of future schema16, native-origin hashing parity and UI acceptance remain unverified.

These are new-feature acceptance tests. No import failure on old source is presented as a meaningful regression reproduction. The authoring module is Codex-authored and requires independent review before acceptance. The owner's five scope choices are already approved; no approval of the new implementation is implied.
