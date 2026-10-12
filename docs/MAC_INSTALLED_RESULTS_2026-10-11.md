# Flight Training installed-app verification — 2026-10-11

Executed at the owner's request in the everyday rickymac account (uid 501, administrator), using only newly created synthetic data. The application data folder was absent before testing. Both candidates launched normally; no Gatekeeper exception or security setting change was made.

| Check | Result |
| --- | --- |
| Schema 12 → 13 upgrade, retained records and PDFs | PASS |
| Manual splits, siblings, nested lineage and source-page copy actions | PASS |
| Automatic page-limit and size-limit splits | PASS |
| All 11 generated PDF artifacts: pages and maximum size | PASS |
| Cancel leaves data unchanged | PASS |
| Unwritable backup folder: safe refusal, unchanged data, successful retry | PASS |
| Schema 12 rejects newer schema 13 backup without changing data | PASS |
| Restored schema 12 archive payload: all 33 tables and 3 PDFs | PASS |
| Supplied strict restore comparison against post-export profile | FAIL: backup-receipt metadata differs |
| Completed practice-history date rendering | FAIL: displays “undefined, undefined NaN” |

## Findings

1. The schema 12 archive contains two app_metadata rows. The post-export baseline contains five: three last_complete_backup fields are written after archive creation. Restoration matches the actual archive exactly, including metadata. The original strict comparison remains preserved as FAIL in cmp-g3-restore.json. Supplemental restore-archive-payload-comparison.json proves archive fidelity; it does not erase that failure or change the comparison policy.
2. The restored completed practice attempt and its 50% score are present, but its completion date is malformed in the UI. PracticeHistory.tsx passes completed timestamps to formatLongDate, whose parser expects a calendar date. This is a source-supported explanation of the observed defect, not a tested fix. No source files were changed.

## Evidence

Machine-readable comparisons and snapshots are committed beside this report in docs/evidence/mac-installed-results-2026-10-11. Full synthetic profiles and native backups remain in the local final-workspace archive. Both backup ZIP integrity checks pass. Schema 12 has 4 data payload files; schema 13 has 15. Each archive additionally contains manifest.json and integrity.json, so counting everything except manifest includes one extra integrity file.

The split audit verifies automatic ranges 1–1000 / 1001–1050 and 1–58 / 59–60. Nested child ranges resolve to original pages 120–140 and 141–160.

## Limits

This owner-authorized administrator lane does not establish the original hfdtest standard-account isolation gate. Mid-save failure after a backup receipt remains untested: the packaged app provides no reachable fault-injection seam. Signing/notarization and release distribution gates remain open. Restore restarted the application process; the UI automation connection could not observe its restarted window. Manual relaunch then verified the restored materials, card-review state and practice history. This is not evidence of an application crash.

## Cleanup and handoff

Both candidate processes are stopped. The temporary active profile was archived as final-workspace/profiles/run-current-account-20261011/schema13-restored-final; the everyday account's default application-data folder is again absent. Test profiles and backups remain recoverable. Original /Applications installation and shared kit were not modified. Main and the user's existing working changes were left untouched. Every copied evidence/profile file was SHA-256 checked against the scratch source; the local checksum manifest is preserved with the full archive.

The bounded on-demand agent workflow remains available, with recurring polling paused. This run does not mark all release gates passed. Next eligible work should address the practice-history date defect and review the restore comparison baseline before claiming full verification.

## GitHub evidence scope

This upload includes the report and 21 JSON snapshots/comparisons/audits. Databases, backup archives, PDFs, application bundles and installers stay local under the repository data-safety rule. All test content was synthetic; no authentication files or API keys are included.
