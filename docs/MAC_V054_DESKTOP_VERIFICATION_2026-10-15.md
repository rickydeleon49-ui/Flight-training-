# Native v0.5.4 desktop verification — 15 October 2026

**Desktop verification completed in the owner-approved administrator-account lane. Data-integrity checks passed; two follow-ups remain open. This is not full release acceptance.** No application source was changed or candidate rebuilt.

## Identity and authorization

Owner explicitly chose: “Use this account with fresh synthetic data only; record that it is an administrator-account test.” This supersedes launch deferral for this bounded run. macOS27.0.1, Apple Silicon, `rickymac` UID501, administrator. The default application data root was verified absent before the first launch. The old hfdtest account is unavailable; the UID502 standard-account gates have not passed.

Candidate source: `e9286017d3ca8b1faa1c8f5568c708d43e0b3050` (tree `655ccd11598ab88309eeb1d01ae57feb0b8b0760`). Documentation base: `55b52af183221ff12d9bbcd5748b4dab48e0f5e8`. Application/build inputs are unchanged between those commits.

- DMG: `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg`, SHA256 `7a93541a1fe7c9ccaa540deb8b164ac0ac09da8bc5c33b8ae1fed6755ad499b9`.
- Installed executable SHA256 `b60d2e6c04fd18ee31d4a8bd6439ed9388039c3c390ff62e09275c1464848822`, rechecked after testing.
- Installed copy: `/Users/rickymac/Applications/Her Flight Deck Verification e928601/Her Flight Deck.app`.
- Read-only DMG mounted, copied, strict ad-hoc signature verified, then detached. Normal launch worked. Gatekeeper assessment returned **exit3, rejected**; no quarantine attribute existed. No security bypass or Apple signing/notarization was attempted. Local launch success is not distribution acceptance.

## Executed checks

| Check | Actual result and evidence |
|---|---|
| Native install / launch | PASS. Exact installed executable ran as UID501. `prelaunch.json`, `running-identity.json`. |
| Profile / note save, quit and relaunch | PASS. Synthetic pilot name and saved note persisted; offline database confirms the saved note and successful migrations1–14. `first-quit-check.json`. |
| Native PDF picker and Open | PASS. Ten-page synthetic PDF imported into app-owned storage and opened in Preview; correct managed path and all page labels observed. |
| Native manual chapter | PASS. Pages2–4 saved as a separate3-page PDF; independent pypdf audit found P0002/P0003/P0004, original remains10 pages; lineage shown in UI. `pdf-page-audit.json`. |
| Current schema14 backup / restore | Data PASS. Every table/schema/document matched except exactly three backup-receipt keys. First restart visibly succeeded. `restore14-comparison.json`. |
| Genuine populated13→14 upgrade | PASS in this admin lane. Baseline made through the reviewed schema13 app (`36a7b39`): debrief, practice response, card rating, managed PDF and saved chapter. All36 pre-existing tables, retained schema objects, metadata and file bytes matched. Old13 ledger retained; migration14 success and SHA384 match the accepted SQL. All new schema definitions and exact15-entry/15-revision catalog seed match migration14; four other new tables empty. `upgrade-comparison.json`. |
| Schema13 complete-backup restore into14 | Data PASS. Original retained table rows/ledger and PDFs preserved; only three backup-receipt keys excluded; migration14 regenerated correctly. Automatic restart window unavailable; manual relaunch recovered. See finding02. |
| Native Skills | PASS for custom skill, Practicing status, confidence3/5, observation, edit, addressed state and follow-up link. Database contains the deliberate operation receipts and four observation revisions. `skills-native-saved-ax.txt`, frozen snapshots. |
| Cancel a Skills draft | PASS. Complete table/schema/document snapshots identical, including populated Skills history. No erased-observation tombstone was created in this run. `cancel-comparison.json`. |
| Guarded save with backup folder unwritable | PASS. Native chapter operation reports permission denied; complete rows/schema/document hashes unchanged. Exact original permission mode recovered, bound to the recorded inode/owner/operation. `guarded-save-comparison.json`. Custom-skill create does not require a safety backup; an exploratory successful create is disclosed separately, not counted as a failed guard. |
| Damaged backup refusal | PASS. A truncated local synthetic archive was rejected as unreadable before confirmation/replacement; all table/schema/document facts unchanged. `invalid-backup-comparison.json`. |
| Populated Skills schema14 backup / restore | Data PASS, including custom skills, status/confidence, observations/revisions/links/receipts. Only the exact three receipt keys differ. Automatic restart window unavailable again; see finding02. `skills-restore14-comparison.json`. |

Snapshots use read-only SQLite after normal Cmd-Q and an independent process-stopped check. Two windowless self-restart processes could not be quit through a window; only their verified test PIDs were terminated with SIGTERM before offline capture. Those exceptions are recorded, not labeled normal quits. No live database was used for a strict comparison. The production UID502 helper was not modified, patched or tricked into accepting UID501. These results are independent admin-lane measurements, not executions of that helper's standard-account contract.

## Findings for one correction assignment

### DESKTOP-V054-01 — P2: Added / Last reviewed show UTC day

At **2026-10-15 20:56 PDT**, the UI says **Friday, October16**, including immediately after clicking **Mark as reviewed today**. The chapter has `created_at=2026-10-16T02:26:19.480Z`, `last_reviewed_at=2026-10-16T03:56:14.075Z`; both fall on ThursdayOct15 locally. Source confirms UTC string slicing in `src/pages/StudyLibrary/MaterialDetail.tsx:1123` and `:1161`. Use the existing strict `localDayOf` conversion before calendar-day formatting; preserve date-only values and define invalid-date fallback. Add meaningful timezone regressions for ISO/SQLite timestamps, negative and positive offsets, and bare dates. `date-bug-confirmation.json` and UI observations are direct evidence. The bug is also visible in the older app; it is not claimed as a new regression.

### DESKTOP-V054-02 — P2 investigation: restore self-restart can leave no accessible window

First current-schema restore visibly restarted. Later schema13 restore (PID19387) and populated schema14 restore (PID19899) created the correct v0.5.4 process, but CUA repeatedly returned `noWindowsAvailable`; normal app activation did not recover the first case. Process sampling showed a live, idle AppKit process. After terminating only the verified test PID and manually reopening the same installed app, the first affected library loaded normally; final frozen data comparisons prove both restores preserved data. The second case was captured and stopped before cleanup. **Root cause unconfirmed**: distinguish actual hidden/missing-window behavior from automation accessibility/reconnect limitations, including multiple installed apps sharing the bundle identifier. Do not claim data loss, migration failure or a proven Tauri root cause. Inspect `src-tauri/src/backup.rs:5887` (`request_restart`), native reopen/window lifecycle and the settings restore continuation. Confirm with an independent native observation before choosing a code fix. No window/restore guarantee is waived.

[One model-neutral correction prompt](MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md) covers both findings and the remaining focused validation.

## Limits and final state

Not executed: fresh schema12 backup restore into this exact candidate; permanent erasure/tombstone UI flow; automatic large-file PDF splitting in this run; VoiceOver; standard-account testing; historical/minimum macOS; mid-save native fault injection; Developer ID/notarization or publication. Do not mark the entire original G1–G3/U1–U3/R1 standard-account matrix passed. The UID501 cancellation/failure checks cover populated current Skills data, but not a deliberately created erased-observation tombstone. Earlier automated/browser/native-source results remain historical evidence; no unchanged full test matrix or native build was rerun for this documentation task.

App is **stopped**. The original synthetic profile was returned to `/Users/rickymac/Library/Application Support/com.herflightdeck.app` and its Gemini key left untouched; no provider request was made by this verification. A final deliberate Mark reviewed today action is recorded there. The separate populated upgrade/Skills profile, genuine schema13 baseline, backup archives and process samples are recoverable in `/Users/rickymac/.codex/task-recovery/v054-desktop-verification-20261015/`. No profile was deleted. The temporary old13 installation was archived there; the current verification app remains installed. Frozen candidates and prior evidence are unchanged.

Evidence: [inventory and offline verifier](evidence/mac-v054-desktop-verification-2026-10-15/README.md). No app binary, private profile or backup archive is committed. The historical helper receipt files remain historical. Only its current20-path inventory is refreshed for the changed roadmap/status/handoff bytes, with its original baseline/allowlist preserved.
