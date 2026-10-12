# Independent review: practice dates and restore receipt baseline

11 October 2026. **ACCEPT for the bounded source change in PR #143, Merged as `b178066eaf3d645c4541837629499e8cbf1515d9` after the required check passed on reviewed head `9fefcb538913f11bd9fcb74aefb4c603824c6d7d`.** One nonblocking metadata-key edge case is assigned to the next preparation task. No installed, standard-account, mid-save-failure, signing or release gate is closed by this source review.

Reviewed head: `9fefcb538913f11bd9fcb74aefb4c603824c6d7d`; base: `e8720003a76be680812dfe3605d58e7eb6372d00`. Five changed paths, frozen in the evidence manifest. Claude's checkout `/Users/rickymac/code/Flight-training-pr142-fixes` was clean and used read-only. Its full local matrix is reported in the PR; this review reran the focused tests and helper, leaving the required whole-app confirmation to the exact-head GitHub check. No production Rust, dependency or migration changed.

## Accepted behavior and measured verification

- Completion timestamps are converted to their local calendar day before the existing calendar-day formatter is called. App ISO timestamps, explicit offsets, SQLite's space-separated UTC form and bare dates are handled; unreadable data produces “Completed”. The string is normalized to ISO before parsing, addressing the WebKit space-separated-input concern. No current WKWebView or installed-build run was performed here.
- All **10 submitted date tests pass** independently: seven unit cases plus three rendered real-repository/node:sqlite cases, each exercising the group, attempts and attempt-review screens. In a disposable copy with the **unfixed screen**, all three rendered cases fail with exactly `Completed undefined, undefined NaN`. The unchanged tests were used; source in the submitted checkout was never reverted.
- The new snapshot records one framed digest per metadata key, without recording metadata values. Only the restore comparison excludes `last_complete_backup_at`, `last_complete_backup_path` and `last_complete_backup_version`. The frontend writes them after native export completes; an archive cannot include the receipt written by its own export. Other metadata, retained records and PDF bytes remain strict, as do receipt comparisons for unchanged/history/upgrade purposes.
- Helper self-check on **Node 22.23.3 and Node 26.10.0: 98/99 pass, exit 1**. All 13 added checks (12 receipt cases plus the exact-key anchor) pass. The sole failure is the existing schema-ceiling anchor: this historical helper targets 13, while accepted source is 14. Independently executing the base helper gives **85/86, exit 1, with the identical failed anchor**. This is disclosed pre-existing drift, not a newly green helper or a regression from this PR.
- Replaying the original PR #142 snapshots still gives **FAIL**, exit 1, with the exact original `diffs` array. Older snapshots lack per-key metadata digests and remain strict. The physical archive-fidelity PASS remains supplemental; no prior failure is erased or silently reinterpreted.

The independent review is also recorded [on PR #143](https://github.com/rickydeleon49-ui/Flight-training-/pull/143#issuecomment-6115334156). Exact-head CI must pass before integration; check the live PR/merge identity rather than treating this document's existence as proof of merge.

## Nonblocking finding PR143-N1: valid special metadata key omitted

`scripts/mac-schema13-profile-snapshot.mjs`, function `metadataKeyDigests`, initializes `out = {}` and assigns `out[key] = digest`. A valid SQLite `app_metadata` key named `__proto__` invokes the ordinary object's inherited setter rather than adding an own digest entry. The reviewer scratch case inserts that one valid key and measures **rowCount 1, own keys []**. A subsequent comparison refuses the inconsistent snapshot. This is **fail-closed**: it does not erase data or falsely pass a restore. Existing app-written metadata keys are unaffected, so this is not a release blocker for the date/receipt change.

Small correction: create an own-key-safe digest map (`Object.create(null)` or equivalent), keep the JSON representation, and cover `__proto__`, `constructor` and `toString` with real SQLite capture/compare checks. Every special key is ordinary protected metadata; never add it to the receipt exclusion. A changed or deleted such key must fail restore. The [next source-only verification preparation assignment](MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md) includes this small fix and current-schema coverage.

## Installed evidence and remaining boundaries

PR #142 contains the owner's actual synthetic installed schema-12→13 run in the administrator account. It reports upgrade/split/cancel/safe-failure-retry/newer-backup-refusal passes, archive-payload fidelity, the preserved strict restore metadata failure and the observed date defect. Those results must remain linked and distinct from this source fix. They do not test the M3 schema-14 binary, establish the original standard-account gate, or establish mid-save fault/signing/release acceptance.

The current-source helper work is the next eligible preparation slice. Preserve the historical schema-13 tool/evidence and the frozen kit; do not raise old verdicts to PASS, create another installer, launch either candidate, alter account isolation, call a provider, or change a release tag. The primary dirty checkout and Gemini's in-flight M4 work remain protected.

## Evidence

[Review evidence](evidence/pr143-date-restore-review-2026-10-11/README.md): five source hashes, exact commands/cwd/exits and raw focused/helper/baseline/replay/probe receipts, the disposable regression/probe runner, and final checksums. A sandbox cache startup refusal is preserved separately and is not counted as a product/test failure; the subsequent authorized scratch run produces the measured three failing old-screen regressions. The metadata probe runs only a temporary helper copy. No real profile, app process or installed data was written.
