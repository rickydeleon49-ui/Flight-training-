# v0.5.4 desktop corrections — DESKTOP-V054-01, -03, -04 fixed; DESKTOP-V054-02 investigated (15 October 2026)

**IMPLEMENTED (01, 03, 04) AND INVESTIGATED (02); PENDING INDEPENDENT REVIEW.** Claude (`claude-opus-5-5`), per [`MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md`](MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md).

- **Where:** uncommitted on `codex/v054-desktop-corrections` in `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`.
- **Starting identity:** `7f2a624` (`main` after #171). The checkout was clean, and the app was not running.
- **Scope extension:** after the first submission, the owner instructed: complete all the fixes found, and do not merge. DESKTOP-V054-03 and -04 were implemented under that instruction (see the section at the end).
- **Not changed:** dependencies, migrations, version, bundle ID, signing, provider calls. Rust changed only for 03 (`lib.rs` setup and `handle_startup_restore`'s return value).
- **Preserved:** the frozen e928601 app, DMG and ZIP and every earlier receipt, untouched.

## DESKTOP-V054-01 — "Added" and "Last reviewed" showed the UTC day: **FIXED**

**Cause.** `MaterialDetail.tsx` printed `createdAt.slice(0, 10)` and `lastReviewedAt.slice(0, 10)`. That is the UTC date, so at 20:56 PDT on Thursday 15 October both labels read "Friday, October 16".

**Fix.**

- **New helper:** `formatLocalDay` in `src/lib/dates.ts` runs a stored timestamp through the existing strict `localDayOf`, then `formatLongDate`, and returns `null` when the value can't be read. ISO with or without an offset, SQLite's UTC form and bare calendar days are all handled by `localDayOf`.
- **Material detail:** both labels use it.
  - An unreadable value shows "Unknown" (Added) or "Reviewed before; the date can't be read." (Last reviewed), instead of the old "undefined, undefined NaN, NaN".
  - Stored timestamps are not changed, and no clock or offset is hard-coded.

**Tests.**

- **`src/lib/dates.test.ts`:** a new `formatLocalDay` block, using the file's existing `inTimeZone` isolation.
  - **Los Angeles:**
    - the native run's exact timestamps;
    - the 06:59:59/07:00Z boundary;
    - both 2026 daylight-saving transitions;
    - a bare day, an explicit `+05:30` offset, and every malformed input.
  - **Kiritimati (UTC+14):** the 10:00Z boundary.
  - **UTC:** the UTC day, plus the year suffix outside the current year.
- **New `src/pages/StudyLibrary/MaterialDetailLocalDates.test.ts`** (rendered, real SQLite) covers the two actual labels:
  - the native evening values;
  - **Mark as reviewed today** at 20:56 PDT, which now reads Thursday;
  - SQLite UTC form in Kiritimati;
  - bare calendar days;
  - unreadable values.

| Check (Node v22.23.3) | Exit | Result |
|---|---|---|
| Rendered test against the **original** `MaterialDetail.tsx` | 1 | **4 failed**, 1 passed (the bare-day case is correct on both).<br>Failures include `'Last reviewed Friday, October 16.'` and `'undefined, undefined NaN, NaN'`. [Output](evidence/mac-v054-desktop-corrections-2026-10-15/01-rendered-before.txt) |
| Six date suites under `TZ=UTC`, `America/Los_Angeles`, `Pacific/Kiritimati` | 0 / 0 / 0 | 63/63 each |
| `npm run typecheck` | 0 | passed. The **first run failed** (exit 2) on an invalid `materialType` in my new test, kept as `typecheck-first-failed.txt`. After correcting it, the failing-before check and all zone runs were repeated. |
| `npm test -- --maxWorkers=2` | 0 | 142 files passed / 4 skipped; **3,232 passed** / 6 skipped |
| `npm run build` | 0 | passed. The first run failed for the same typecheck reason (`build-first-failed.txt`). |
| `git diff --check` | 0 | passed |

**Adjacent same-class finding** (fixed later as DESKTOP-V054-04, below). Settings and Data Recovery show `backup.name.slice(0, 10)`. Rust names safety copies from the UTC date (`backup.rs` `timestamp()`/`civil_from_days`). On the Mac this run used, copies made on the evening of 15 October PDT were listed as "2026-10-16". `BackupInfo.createdAt` already holds the real seconds, so the fix is small. These are different screens, though, and the prompt asked to avoid a broad refactor, so this is recorded as **DESKTOP-V054-04** for a focused follow-up.

## DESKTOP-V054-02 — no window after a restore restart: **NOT REPRODUCED; one related behaviour confirmed**

**Read first:** both `*-window-observation.json` receipts and both local process samples. The samples show a live process idle in `-[NSApplication run]`, with a `WebCore: Scrolling` thread. A web view was created; this is neither a hang nor a crash.

**Mechanism in source.** Tauri 2.11.5's macOS `restart()` (`src/process.rs`) spawns `Contents/MacOS/her-flight-deck` directly and exits. It does not relaunch through LaunchServices.

**Native run.**

- **Lane:** the owner-authorized administrator account (UID501) with synthetic data only. This is not a standard-account or hfdtest pass.
- **Binary:** the exact installed `b60d2e6c…` app, launched only by its full path.
- **Profile handling:** the default profile and its credential were preserved and returned intact (see Local data).
- **Observation:** independent of the automation tool. The window server (`CGWindowListCopyWindowInfo`, [`windows.swift`](evidence/mac-v054-desktop-corrections-2026-10-15/windows.swift)) and LaunchServices (`lsappinfo`) were sampled every 0.5 s ([`monitor.sh`](evidence/mac-v054-desktop-corrections-2026-10-15/monitor.sh)), alongside full-screen screenshots and the automation tool's own window list.

| Run | From process | Result |
|---|---|---|
| Normal launch | `open` → PID 23002 | On-screen main window 4389; app frontmost (Foreground, in front) |
| Restore populated schema-14 archive (`synthetic-skills-schema14`, app 0.5.4) | 23002, launched via LaunchServices | New PID 23416 (parent launchd). **On-screen main window 4436 within about 1 s.** Usable Flight Deck UI. Automation tool lists the window. **Not frontmost.** |
| Restore genuine schema-13 archive (app 0.5.3) | 23416, itself started by a self-restart: **the condition of both original failures** | New PID 25794. **On-screen main window 4465 within about 2 s.** Restored library visible and usable. Automation tool lists the window. **Not frontmost.** |

**Disposition.**

- **The reported defect** (process alive, no window) did **not** reproduce in two attempts, including the original failing condition. The window server reported an on-screen main window each time, independently of the automation tool.
- **The confirmed behaviour** is that a self-restarted app is **never activated**: another app stays frontmost. That follows directly from Tauri's direct-exec restart. For a user, the restored app can reappear behind other windows, which plausibly looks like "it vanished".
- **The original "noWindowsAvailable" receipts:** still unexplained. They are consistent with the automation tool losing its connection to a new PID, but that can't be proven after the fact. Six installed copies share `com.herflightdeck.app` (see below), which could also confuse anything that targets the app by bundle ID.

**No application code was changed for 02.** The prompt allows a fix only for a confirmed window defect, never to mask tooling. The window defect is unconfirmed; non-activation is a separate behaviour, so changing code for it needs its own decision.

**Proposed fix (DESKTOP-V054-03)** (implemented later, below):

- have `handle_startup_restore` return its decision to `setup`;
- after `RestoreCompleted` only, `show()` and `set_focus()` the main webview window, so a restored app comes to the front;
- keep the guarantee that the pending restore finishes before SQLite opens, and that an ambiguous restore blocks;
- test it natively on a new, separately identified local candidate.

**Restored data (schema 13).** After a normal quit, the restored library was compared offline (read-only) with the earlier run's frozen `restore13-after.json`, which restored the same archive with the same binary:

- 42 tables, the schema and both documents are **identical**;
- retained ledger rows 1–13 are identical, and migration 14 is present with the catalog seed at 15/15;
- the only exclusions are the three `last_complete_backup_*` keys and migration 14's `installed_on`/`execution_time`.

**Duplicate bundle identifiers.** Six copies are registered under `com.herflightdeck.app` ([list](evidence/mac-v054-desktop-corrections-2026-10-15/duplicate-bundle-ids.json)), including **0.5.3 in `/Applications`** and two other 0.5.3 copies. The restart itself always spawns the exact running binary. But anything that launches or activates by bundle ID could open an old binary against a schema-14 profile, which must never happen. This run therefore launched by exact path only. The owner may want the old copies removed or archived; nothing was deleted here.

## Not executed (UNVERIFIED / deferred)

- **Schema-14 restore data comparison:** that restore was checked for window behaviour only, because the schema-13 restore then replaced its data.
- **Older-backup matrix:** schema-12 exact-candidate restore was not run. The older-backup matrix is **not** complete.
- **Other gaps:**
  - erased-observation/tombstone UI;
  - VoiceOver;
  - standard account / hfdtest;
  - minimum macOS;
  - signing, notarization, publication.
- **Untouched evidence:** Skills-cancel and guarded-backup evidence stay valid, because no code they exercise changed.
- **No release candidate:** the only new build is the private, separately labelled 03 test build described below.

## Local data

- **Original profile:** back at `~/Library/Application Support/com.herflightdeck.app`.
  - Its `ls -laR` names, sizes and modes and its root inode, owner and mode are identical to before.
  - The Gemini credential file is present and was never read.
- **Test profile:** after both restores, kept at `/Users/rickymac/.codex/task-recovery/v054-desktop-corrections-20261015/test-profile-after-restores/`.
- **Other recovery data:** the earlier verification's profiles and archives are unchanged under `…/v054-desktop-verification-20261015/`.
- **In Git:** no profile, archive or binary.

## Files

- **Modified:** `src/lib/dates.ts`, `src/lib/dates.test.ts`, `src/pages/StudyLibrary/MaterialDetail.tsx`, `src/services/backups.ts`, `src/lib/backups.test.ts`, `src/components/recovery/DataRecovery.tsx`, `src/pages/Settings/Settings.tsx`, `src-tauri/src/backup.rs`, `src-tauri/src/lib.rs`, `ROADMAP.md`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`.
- **New:**
  - `src/pages/StudyLibrary/MaterialDetailLocalDates.test.ts`;
  - `src/components/recovery/DataRecoveryLocalDates.test.ts`;
  - this report;
  - `docs/evidence/mac-v054-desktop-corrections-2026-10-15/`: raw outputs, monitor logs, tools, facts, and an inventory with `SHA256SUMS`.
- **Tracker side effect:** the schema-14 helper's current inventory hashes the trackers. Refresh it after merge, as before, with its baseline and allowlist unchanged.

## Reviewer checklist

1. Diff of `dates.ts` and `MaterialDetail.tsx`: only `localDayOf`-based display, with an explicit unreadable fallback.
2. `01-rendered-before.txt` (4 failing on old source) and the three zone runs (63/63).
3. `restore13-monitor.jsonl` / `restore14-monitor.jsonl`: PID handoff, on-screen main window, and the frontmost app.
4. Review the DESKTOP-V054-03 and -04 fixes (section at the end), and decide the old-copy cleanup.
5. `shasum -a 256 -c docs/evidence/mac-v054-desktop-corrections-2026-10-15/SHA256SUMS`, then `npm test`, `npm run typecheck` and `npm run build`.

## Follow-up on the owner's instruction: DESKTOP-V054-03 and -04 implemented

### DESKTOP-V054-04 — backup lists showed the UTC day: **FIXED**

- **Fix:** new `backupLocalDay(name)` in `src/services/backups.ts` reads the `YYYY-MM-DD-HHMMSS` UTC prefix every Rust backup name starts with, then formats the local day through `formatLocalDay`. Names without a readable time return `null`.
- **Used by:** the Settings "Safety copies kept" list and restore confirmation, and the Data Recovery list and confirmation. Unreadable names show "Date unknown" / "date unknown" / "an unknown date".
- **Why the name, not `createdAt`:** `createdAt` is the folder's modification time, which can drift; the name records when the copy was made.
- **Tests:**
  - `src/lib/backups.test.ts`: Los Angeles evening and 07:00Z boundary, disambiguated and upgrade names, year suffix, eight unreadable names; Kiritimati 10:00Z boundary; UTC.
  - New rendered `src/components/recovery/DataRecoveryLocalDates.test.ts` (list row, unknown-date row, confirmation text): **3/3 fail on the original `DataRecovery.tsx`** ([output](evidence/mac-v054-desktop-corrections-2026-10-15/04-rendered-before.txt)); pass after.
  - Settings has no rendered backup-list test (its list renders only in the desktop shell); it uses the same helper and was checked natively.
- **Native:** in the test build, every copy named `2026-10-16-…` (made the evening of 15 October PDT) is listed as "Thursday, October 15", and the confirmation reads "on Thursday, October 15." ([list](evidence/mac-v054-desktop-corrections-2026-10-15/04-settings-safety-copies-after.jpg), [confirmation](evidence/mac-v054-desktop-corrections-2026-10-15/04-settings-restore-confirmation-after.jpg)).

### DESKTOP-V054-03 — restored app not brought to the front: **FIXED**

- **Fix:**
  - `handle_startup_restore` now returns `Result<bool, String>`: `true` only for `RestoreCompleted`. The mapping is a separate `startup_restore_outcome` so it can be tested. Refused and rolled-back restores still log and continue; an unresolved restore still blocks startup with the same message.
  - `setup` calls `bring_main_window_forward` only when that is `true`: `show()` then `set_focus()` on the `main` window. In tao 0.35.3, `set_focus` on macOS calls `makeKeyAndOrderFront` and `activateIgnoringOtherApps`. Failures are logged, never fatal.
  - The restore still finishes before SQLite opens; nothing about install order changed.
- **Tests:** `only_a_completed_restore_asks_for_the_window_to_come_forward` and `an_unresolved_restore_still_blocks_startup`. Activation itself can only be checked natively.
- **Test build:** `npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --ci` (exit 0, [log](evidence/mac-v054-desktop-corrections-2026-10-15/fix-native-build.log)), copied and ad-hoc sealed as a separate folder:
  - `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-desktop-corrections-UNCOMMITTED/`
  - raw executable `5cc57949…bcc526`; sealed executable `721460a2a9ba775f3de640e9411c3a805e245ebed1fb72fd2e46620e992763ba`
  - built from base `7f2a624` plus this uncommitted tree; **a private test build, not a release candidate**. The e928601 and fee7869 candidates were not touched.
  - Version and bundle ID unchanged (0.5.4, `com.herflightdeck.app`), so this is a **seventh** copy under that ID; it was launched only by exact path.
- **Native run** (same UID501 lane and profile protocol as above; synthetic profile copied from `test-profile-after-restores`; your default profile set aside and returned):

| Run | Frontmost before the restart | Result |
|---|---|---|
| 1 | The test app itself (it had just been launched with `open`) | New PID 35594 frontmost. **Not counted:** the app was already in front. |
| 2 | — | Not measured: my watcher's 120 s timer expired before the click. The restore itself worked. |
| 3 | **Claude**, confirmed by `NSWorkspace.frontmostApplication` while the new PID 47312 was already running and finishing the restore ([watch log](evidence/mac-v054-desktop-corrections-2026-10-15/03-run3-watch.log)) | About 3 s later **the restored app (PID 47312, the exact test-build path) was frontmost**, with no click or other input in between. Window server: window 4543 on the old PID, then window 4555 on-screen on the new PID within 1 s ([monitor](evidence/mac-v054-desktop-corrections-2026-10-15/03-run3-monitor.jsonl)). |

  - **Contrast:** with the e928601 binary, both restores earlier left Claude in front.
  - **Limits:**
    - one counted run; the watcher's front check has whole-second timestamps;
    - my clicks used full-screen control, which hides apps not granted to it (Claude, the host, stayed visible);
    - not checked: a user who deliberately switches away for a long time before the restart, Stage Manager, multiple Spaces or displays.
- **Quit:** normally from the app menu; no process was left running. The monitor and watcher were stopped.
- **Your profile:** returned; the `ls -laR` listing is identical apart from the parent folder's timestamp, and the root inode, owner and mode are identical. The Gemini credential was never read. The test profile from this run is kept at `/Users/rickymac/.codex/task-recovery/v054-desktop-corrections-20261015/test-profile-after-fix-run/`.

### Checks after all fixes (Node v22.23.3, Rust 1.99.0)

| Check | Exit | Result |
|---|---|---|
| `cargo clippy --locked … --all-targets -- -D warnings` | 0 | clean ([output](evidence/mac-v054-desktop-corrections-2026-10-15/fix-clippy.txt)) |
| `cargo test --locked` | 0 | 467 passed / 6 ignored ([output](evidence/mac-v054-desktop-corrections-2026-10-15/fix-cargo-test.txt)) |
| `cargo fmt --check` | 0 | clean |
| `npm run typecheck` | 0 | passed |
| `npm test -- --maxWorkers=2` | 0 | 143 files passed / 4 skipped; **3,242 passed** / 6 skipped |
| `npm run build` | 0 | passed |
| Date and backup suites under UTC, Los Angeles, Kiritimati | 0 / 0 / 0 | 44/44 each |
| `git diff --check` | 0 | passed |

### Still not done

- **Old installed copies:** not removed. Deleting apps is the owner's call; with this test build there are now seven copies sharing the bundle ID.
- **No merge, commit or push;** no release, signing or publication.
- Everything listed under "Not executed" above remains open.
