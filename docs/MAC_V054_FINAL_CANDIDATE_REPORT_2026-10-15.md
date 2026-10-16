# Private local v0.5.4 candidate from fbff255 — report and reviewer checklist (15–16 October 2026)

**BUILT AND VERIFIED ON THE INSTALLED CANDIDATE; PENDING INDEPENDENT REVIEW.** Assignment: [`MAC_V054_FINAL_CANDIDATE_PROMPT_2026-10-15.md`](MAC_V054_FINAL_CANDIDATE_PROMPT_2026-10-15.md).

- **Two sessions:** the source, build, packaging, helper and install steps ran first (recorded in the evidence files at the top of the folder, and summarised in the resume note). Claude (`claude-opus-5-5`) then finished the installed verification.
- **Local test only:** this is a private, ad-hoc-sealed Apple Silicon build. It is not Developer ID signed and not notarized, and Gatekeeper rejects it (see Security).
- **Lane:** owner-authorized administrator account (UID501) with operation-owned synthetic data only. This is **not** an hfdtest/UID502 or standard-account pass.
- **State:** uncommitted and unpushed in `/Users/rickymac/code/Flight-training-` on clean `main` at `fbff255`; only new or updated docs.

## Identity

| Item | Value |
|---|---|
| Accepted source | `fbff255312d3b900f1aa9c64b742cef8d4dd9df5` (merged #174; PR-head and post-merge CI green) |
| Source tree | `713eb74f909367c72b31bdf3da0bf63301256dd1`. The resume note had dropped a "2"; corrected there, original kept as `RESUME-STATE.md.before-tree-correction`. No receipt contained the typo. |
| Candidate folder | `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-fbff255/` |
| DMG | `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg`, 5,086,379 B, `1048e4636190d07afcbf2da76fc38822cd13189552b03a0ed69265870857676d` |
| ZIP | `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.app.zip`, 4,828,093 B, `7e55ccc7d749be19f526ef0eb083f90672d6d2594a4431b1915ca10596bc1017` |
| Sealed executable | `a809e7b16743c9410b790dfb7634ef4d6aee956f23777aca6d9583bf3a181a8f` (raw build `55dfcf50…fc282`) |
| Installed app | `/Users/rickymac/Applications/Her Flight Deck Verification fbff255/Her Flight Deck.app`. Its executable hash, rechecked on 16 October, is `a809e7b1…a181a8f`. |
| Package facts | 0.5.4, `com.herflightdeck.app`, `LSMinimumSystemVersion` 12.0, arm64, `Signature=adhoc`, `TeamIdentifier=not set` |

`ARTIFACT_SHA256SUMS` re-verified 6/6 on 16 October.

**Preserved unchanged:**

- the e928601 and fee7869 candidates: every entry in their own `ARTIFACT_SHA256SUMS` checks OK;
- the desktop-corrections-UNCOMMITTED executable: `721460a2…`;
- the frozen v0.5.3 installer;
- the dirty implementation checkout: still at `7f2a624` with 16 entries.

## Build, package and helper checks (first session, reused)

| Check | Exit | Evidence |
|---|---|---|
| `npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --ci` (SDK 26.5, Node 22.23.3, rustup stable 1.99.0) | 0 | `native-build.txt` |
| Raw `--no-sign` envelope `codesign --verify` | **1, expected** | `package-checks.txt` |
| Packaging: copy, ad-hoc seal, verify, ZIP, DMG, read-only attach and verify, detach | all 0 | `package-checks.txt`, `dmg-readonly-proof.txt` |
| Helper tests and cargo-lock check | **first run failed 25/1**: a Finder `.DS_Store` in `target/` tripped the intentional build-output guard. The junk file was removed and no guard changed; the rerun passed 26/26 and cargo-lock exited 0. | `helper-lock-checks-first-failed.txt`, `helper-lock-checks.txt` |
| Fresh database audit by the candidate binary | migrations 1–14; migration 14 checksum matches the shipped SQL; seed 15/15 | `fresh-candidate-db-audit.json` |

The full source suite was not repeated: application inputs are identical to the accepted, CI-green #174 tree.

## Security

- `spctl -a -vv` on the installed app prints `rejected` (exit 3), recorded verbatim. Nothing was bypassed.
- The first session opened the app by exact path. The macOS warning dialog, if a person sees one, was not captured.
- Ad-hoc sealing is not Developer ID signing or notarization.

## Installed verification (16 October, 05:57–06:05 UTC = 15 October, 22:57–23:05 PDT)

**Setup:**

- **Automation:** my own desktop-control tool, confirmed working. The Qwen SDK and its blocked postinstall were neither used nor approved, because native control did not need them.
- **Profile protocol:**
  - confirmed no `her-flight-deck` process was running;
  - recorded the root's `ls -laR`, inode, owner and mode;
  - **moved** the whole default profile into the task folder;
  - created a fresh, empty, operation-owned synthetic root.
- **Launching:** every launch used `open` with the exact installed path. Every running PID's executable path was recorded.

**Observer:** `installed-run/observe.py` polled about every 0.15 s and logged:

- each PID and its executable;
- on-screen windows taller than 100 px, from the window server (`CGWindowListCopyWindowInfo`), not accessibility;
- the frontmost app, from `NSWorkspace`;
- whether a restore was staged.

When armed, it ran `tell application "Claude" to activate` once, as soon as a restore was staged, so each restart happened while another app was in front.

**Comparisons:** `installed-run/compare.py` compares the restored library read-only with the database and documents inside the archive. It checks:

- every retained table's columns and rows;
- every original schema object's SQL;
- every original ledger row, with all columns including `installed_on` and `execution_time`;
- every managed document's SHA-256;
- `pragma integrity_check`.

Only `app_metadata` keys `last_complete_backup_at`, `last_complete_backup_path` and `last_complete_backup_version` are excluded. New ledger rows are validated separately against the SHA-384 of the shipped SQL and `success`.

### Fixtures (provenance checked before use)

| Fixture | SHA-256 | Manifest | Database |
|---|---|---|---|
| `…/v054-desktop-verification-20261015/private-backups/synthetic-skills-schema14.hfdbackup` | `e211caa0…bdae46` | format 3, app 0.5.4 | migrations 1–14, 42 tables, 2 PDFs |
| `…/private-backups/her-flight-deck-20synthetic-schema13.hfdbackup26-10-16.hfdbackup` | `afb0feb2…bb2bc` | format 3, app 0.5.3 | migrations 1–13, 36 tables, 2 PDFs |
| `…/run-current-account-20261011/hfdbackup-schema12.hfdbackup` | `6845044f4743b9a4031fd2a9170b76ff9e217bc8a801b8022ce3c143726b3155` (matches the assignment) | format 3, app 0.5.3 (old app, 11 October) | migrations 1–12, 34 tables, 3 PDFs (54 MB) |

Full paths and hashes are in [`installed-run/fixtures/`](evidence/mac-v054-final-candidate-2026-10-15/installed-run/fixtures/fixture-hashes.txt).

### Restores and foreground recovery

All three were done through **Settings → Restore backup**, the native file picker (Go to Folder with the exact path), then **Restore and restart**. All times are UTC from the observer.

| Restore | Old PID / window | Claude in front | New PID / first on-screen window | New process frontmost |
|---|---|---|---|---|
| Schema 14 (0.5.4) | 57574 / 4685 | 05:58:31.187: new PID 58134 is running with no window, and Claude is frontmost | 58134 / 4719 at 05:58:31.514 | Already frontmost by 05:58:31.345, straight after the activate call |
| Schema 13 (0.5.3) | 59951 / 4740 | At 06:02:18.569 Claude was already frontmost (the old process had exited and the new PID 60392 had no window yet). It was activated and confirmed frontmost again at **06:02:18.719**. | 60392 / 4766 at 06:02:18.889 | **06:02:18.889**, 0.17 s after Claude was confirmed in front |
| Schema 12 (0.5.3) | 61073 / 4780 | Activated at 06:03:28.700 while the **old** process was still staging; still frontmost at 06:03:29.012 with new PID 62109 running | 62109 / 4799 at 06:03:29.455 | **06:03:29.455** |

**Results:**

- **Every restart was automatic.** The old PID was gone when the new one appeared, and the new executable was the exact installed path.
- **DESKTOP-V054-03 is confirmed on the candidate bytes:**
  - In the schema-13 and schema-12 runs, another app was demonstrably frontmost while the new process was running, and the restored app then brought itself forward without any input.
  - In the schema-14 run, the activate call and the restored app's own activation landed within the same 0.15 s sample, so that run shows Claude in front only immediately before.
- **Screenshots:** each restore showed a usable Flight Deck with the restored synthetic data.
- **No disconnects or missing windows:**
  - There was no automation disconnect. The window server reported an on-screen main window for every live PID within 0.5 s of its appearance.
  - Background accessibility clicks were refused whenever the app was not frontmost. That is a known limit of the tool, not a missing window; full-screen control was used instead.

### Date labels (observed at 22:58–23:04 PDT, when the UTC date was already 16 October)

| Screen | Stored value | Shown |
|---|---|---|
| Material detail "Added" (synthetic-small-checklist) | `created_at 2026-10-16T03:45:45.318Z` | **Thursday, October 15** |
| **Mark as reviewed today**, then "Last reviewed" | `last_reviewed_at 2026-10-16T06:01:32.036Z`, read back from SQLite | **"Last reviewed Thursday, October 15."** |
| Settings "Safety copies kept" (1, then 2 copies) | `2026-10-16-055831-before-restore`, `…060218…` | **Thursday, October 15** |
| Settings restore confirmation | the same copy | "This copy was saved before a restore, on **Thursday, October 15**." |
| Data Recovery list (3 copies) and its confirmation | `…055831…`, `…060218…`, `…060329…` | **Thursday, October 15**, and "…on Thursday, October 15." |

**How Data Recovery was reached safely:**

- The restored root was set aside unchanged. A **copy** of it had its database replaced with a plain-text file and its `-wal`/`-shm` removed.
- The candidate then showed "Your training data could not be opened… (code: 26) file is not a database", with the three copies listed.
- Both confirmations were **cancelled**; nothing was restored there.

The Mac clock and timezone were not changed.

### Normal quit

- Every session ended with **Cmd-Q**.
- About 3–4 s later, `pgrep -x her-flight-deck` found no process, and `ps` showed no matching process. These checks were at 05:59:56, 06:02:44, 06:04:04 and 06:05:09 UTC.
- No SIGTERM was used in this session. The first session's quit used SIGTERM (`first-quit-check.txt`).

### Offline comparisons

All four were made with the app stopped. Full JSON is in [`installed-run/comparisons/`](evidence/mac-v054-final-candidate-2026-10-15/installed-run/comparisons/).

| Restore | Retained rows | Original schema objects | Original ledger rows (all columns) | Managed PDFs | New migrations | `integrity_check` |
|---|---|---|---|---|---|---|
| 14 | **identical** (161) | identical | 1–14 identical | 2/2 identical | none | ok |
| 13 | **identical** (111) | identical | 1–13 identical | 2/2 identical | 14: checksum = shipped SQL, success 1; 6 tables, 13 indexes, 6 triggers; builtin seed 15, revisions 15 | ok |
| 12 | **one difference, below** | identical | 1–12 identical | 3/3 identical (54 MB) | 13 and 14: checksums = shipped SQL, success 1; 8 new tables; builtin seed 15, revisions 15 | ok |

**The schema-12 difference is retained honestly, not excluded.**

- `app_metadata.daily_plan_session` changed from the archive's plan dated 2026-10-11 to a plan for 2026-10-15, with `updatedAt 2026-10-16T06:03:29.553Z`.
- That is 0.54 s after the restored process appeared and as the Flight Deck rendered. It is the app regenerating a stale daily plan for the new day: a runtime write after restore, not a restore change.
- It is outside the three allowed exclusions, so it is reported as a difference.
- The schema-14 and schema-13 archives held plans for 2026-10-15, so nothing was regenerated there.
- No personal record, document or ledger row differed.

**Corrections to my own tooling:**

- `restore14-compare.json` reported `skillCatalogSeed: 0` because my query used `origin='catalog'`; the shipped value is `'builtin'`. The file is kept, and `restore14-compare-seedquery-fixed.json` (seed 15) followed.
- My first background-click attempt on the Restore button was refused, because the app had lost focus. I continued with full-screen control.

## Local data

- **Your default profile:** moved back at 23:05 PDT. Root inode 21671262, uid 501, gid 20 and `drwxr-xr-x` are identical. The `ls -laR` differs only in the parent directory's timestamp. The saved Gemini key was never read, hashed, displayed or deleted. There were no provider calls. ([record](evidence/mac-v054-final-candidate-2026-10-15/installed-run/profile-handoff.txt))
- **Synthetic roots kept** under `/Users/rickymac/.codex/task-recovery/v054-final-candidate-20261015/installed-run-20261016/`:
  - `test-profile-after-restores` (schema-12-restored library plus 3 safety copies);
  - `test-profile-datarecovery` (the unreadable-database copy);
  - extracted fixtures and the raw observer logs.
- **No old binary** was opened. No installed app was deleted.

## Not executed / limits

- **Not run:**
  - an old app creating a new schema-12 backup today (the 11 October old-app archive was used instead, with provenance and hash checked);
  - permanent erasure/tombstone UI;
  - VoiceOver;
  - standard account/hfdtest;
  - minimum macOS 12.0–12.2;
  - mid-save native fault injection;
  - Skills cancellation and backup-unwritable repeats (no code they exercise changed in #174).
- **Observation limits:**
  - the observer samples about every 0.15 s;
  - full-screen control hides apps not granted to it (Claude, the host, stayed visible);
  - DESKTOP-V054-02's original no-window outputs remain unexplained, although none recurred here.
- **Still open:**
  - Gatekeeper rejection;
  - no Developer ID or notarization;
  - several installed copies share `com.herflightdeck.app`, so launch only by exact path.

## Local use

1. Use the installed test app: `open "/Users/rickymac/Applications/Her Flight Deck Verification fbff255/Her Flight Deck.app"`. Or copy the app from `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-fbff255/Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg`.
2. Open it by that exact path. Do not open the 0.5.3 copy in `/Applications` against this library: schema 14 must never be opened by an old binary.
3. If macOS shows a security warning, record its exact text. Do not bypass Gatekeeper.
4. Save a complete backup before relying on it.

## Reviewer checklist

1. `shasum -a 256 -c docs/evidence/mac-v054-final-candidate-2026-10-15/SHA256SUMS`, then `cd /Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-fbff255 && shasum -a 256 -c ARTIFACT_SHA256SUMS`.
2. Confirm the installed executable hash `a809e7b1…` and the verbatim `spctl` rejection.
3. Read `installed-run/observations/r13.summary.txt` and `r12.summary.txt`: Claude frontmost with the new PID running, then the new PID frontmost with an on-screen window.
4. Check the screenshots against the stored timestamps in the date table.
5. Check the `verdict` blocks in `installed-run/comparisons/*.json`, and decide whether the schema-12 `daily_plan_session` regeneration is acceptable as a runtime write.
6. Confirm `installed-run/profile-handoff.txt`, and that no secret, profile or archive is in Git.
7. Decide on installed acceptance and next steps: signing, standard-account and VoiceOver remain open.
