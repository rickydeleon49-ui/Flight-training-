# Operator walkthrough — Mac schema‑13 physical gates (corrected, MACV‑R1/R2)

**Lane:** isolated standard account `hfdtest`, synthetic disposable data, **local ad hoc unsigned**
candidates. Everything here is **UNVERIFIED until a person performs it and records the observation.**
Never run any step in the everyday admin account, and never point either app at the other's library.

## 0. Candidates and provenance (verify hashes before anything else)

| Role | source commit | dmg sha256 | inner exe sha256 (post ad hoc signing) |
| --- | --- | --- | --- |
| **NEW** (app under test, schema 13) | `36a7b39acd291cba14be4f137798b3ad6f7272f1` | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` | `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28` |
| **OLD** (schema 12 baseline + older binary) | `2a6a41536b676559db94b476c71dd645af03fbab` | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` | `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a` |

Both are **local ad hoc signed** (`Signature=adhoc`, `flags=…(adhoc,runtime)`, `TeamIdentifier=not set`,
`Sealed Resources version=2`), and strict bundle + executable verification now exit 0. They are **not**
Developer ID signed, **not** notarized, **not** publicly distributable. The earlier unsealed builds
(`NEW-schema13-36a7b39.dmg` `6aecab86…`, `OLD-schema12-2a6a415.dmg` `455eb12d…`) are retained
byte‑for‑byte with their failed verification receipts; their hashes are no longer used for the runs.

Fixtures (`node scripts/generate-pdf-fixtures.mjs "$TMPDIR/hfd-fixtures"`, hashes must match):
- **A** `synthetic-small-checklist.pdf` — 10 pages, 3,360 B, `f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134`
- **B** `synthetic-long-manual.pdf` — 1,050 pages, 330,934 B, `0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1`
- **C** `synthetic-illustrated-charts.pdf` — 60 pages, 54,032,644 B, `b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d`

Study packet (offline, no provider/network): `src/testing/fixtures/study-packets/02-flashcards-and-test.json`
— "Letters and labels", **3 flashcards + 2 practice questions**,
sha256 `d5101e8c58c70c21943295bb22ec5c88394c8db81aeec402bd8f7836612e1f99`. Re‑record it with
`shasum -a 256 src/testing/fixtures/study-packets/02-flashcards-and-test.json` before transfer.

Transfer all of the above into files `hfdtest` can read (e.g. `/Users/Shared/hfd-schema13/`), then
re‑verify each hash **inside `hfdtest`** after copying.

## 1. Install into distinct directories (both apps share name, id and version — never mix them)

```bash
mkdir -p /Users/hfdtest/Applications/HFD-NEW-36a7b39 /Users/hfdtest/Applications/HFD-OLD-2a6a415
# copy NEW-schema13-36a7b39-adhoc.dmg and OLD-schema12-2a6a415-adhoc.dmg into those two folders
```
Mount one DMG at a time and copy `Her Flight Deck.app` into its own folder; never install to a global
`/Applications`. Launch always by **full path**:
- NEW: `/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app`
- OLD: `/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app`

**Before the first launch, in the `hfdtest` session, confirm and record:**
```bash
id -u                                          # must print 502
dseditgroup -o checkmember -m "$(whoami)" admin # must print "no ..."  (standard account)
```
Resolved data root (verify against the running app, do not guess or set an env var):
`/Users/hfdtest/Library/Application Support/com.herflightdeck.app`, containing
`her-flight-deck.db`, `documents/`, `backups/`. `storage.rs` uses `app_config_dir()` and `lib.rs`
uses `sqlite:her-flight-deck.db`; **nothing overrides it**, so the only way to change library is to
change the macOS account or move that whole folder (steps below).

**First‑launch/Gatekeeper:** record what this macOS actually does. Locally built files carry no
`com.apple.quarantine` attribute and `spctl --assess` reports *rejected* for ad hoc builds, so a
double‑click may either run or be blocked. If blocked, use only the per‑app flow in
[Apple's guidance](https://support.apple.com/en-us/102445) (right‑click ▸ Open, or
System Settings ▸ Privacy & Security ▸ Open Anyway). **Never** disable Gatekeeper globally, never
bulk‑clear quarantine, and if no permitted per‑app flow works, **record the blocked result and stop**
— that is a finding, not a pass.

Helper used throughout (read‑only; refuses a wrong uid/root, a running app, and never checkpoints the
live database):
```bash
node scripts/mac-schema13-profile-snapshot.mjs snapshot --expect-uid 502 --json <name>.json
node scripts/mac-schema13-profile-snapshot.mjs compare --before <a>.json --after <b>.json   # exit 1 = changed
```

## 2. Chronological sequence (one pass, all switches explicit and reversible)

**Always quit the app completely before copying/switching any profile, and verify nothing is running:**
```bash
pgrep -f "Her Flight Deck.app/Contents/MacOS/her-flight-deck" || echo "no app running"
```

### Step A — OLD on a fresh schema‑12 library
1. Launch **OLD** by full path. First run creates the profile; record the ledger at rest:
   `… snapshot --expect-uid 502 --json s12-initial.json` → `ledger.table = "_sqlx_migrations"`, `maxVersion = 12`,
   `schema13Tables.*.absent = true`.
2. Study Library ▸ **Add material** ▸ the file/PDF chooser button (native picker,
   `pickAndImportDocument`) ▸ import **A**, saving the form; repeat **Add material** for **B**. Confirm
   each appears with its PDF and that the title defaults to the file name.
3. Study Library ▸ **Import study packet…** ▸ choose `02-flashcards-and-test.json` ▸ the preview shows
   3 flashcards + 2 practice questions ▸ **Import as new material**. This creates real history
   offline — no provider key, no network.
4. Open that imported material ▸ practice test ▸ answer **both questions** (choose an option, then
   **Continue**; use **See score** at the end) so a **completed** attempt with two responses exists.
5. Open its flashcards ▸ **Show answer** ▸ rate one card (**Good: again in 1 day**, or Again/Hard/Easy)
   so `card_review_state` and `card_review_events` rows exist.
6. Settings ▸ Data management ▸ **Save complete backup** ▸ choose
   `~/Downloads/hfd-schema12-<date>.hfdbackup`. Record its sha256, and the app identity from the
   archive's `manifest.json` (`unzip -p <file> manifest.json | head`). This is the genuine schema‑12 backup.
7. Snapshot the populated library **before** quitting:
   `… snapshot --expect-uid 502 --json s12-populated.json` (this is the G2 "before" anchor).
8. Quit OLD. Confirm no process. Preserve a complete task‑owned copy for G3:
   `cp -R "/Users/hfdtest/Library/Application Support/com.herflightdeck.app" /Users/Shared/hfd-schema13/profile-schema12`
   (whole folder — database **plus** `documents/`; never copy only the loose `.db`).

### Step B — NEW upgrades the same active profile (G2), then G1
1. Do **not** move anything: the active root is still the populated schema‑12 profile.
2. **Capture the upgrade "before" now, before any new user action:** `snapshot … --json pre-upgrade.json`.
3. Launch **NEW** by full path (first run performs migration 13), then immediately
   `snapshot … --json post-upgrade.json` and
   `compare --before pre-upgrade.json --after post-upgrade.json` (no `--history-only`).
   **Pass criteria (record actual values):** `retainedHistoryUnchanged: true`, exit 0;
   `ledger.maxVersion = 13` from `_sqlx_migrations`; both `material_split_lineage` and
   `split_operation_log` present; the `documents/` file anchors identical to before.
   (`compare` is deliberately run **before** creating anything new, so new activity is never mixed
   into the upgrade proof; later histories are compared separately.)
4. **G1 flows**, with these exact expectations (`of 400` was wrong — nothing here has 400 pages):
   - **Manual split of A, pages 3–7** → one child of **5 pages**; its page shows
     *Original … **pages 3–7 of 10*** and "In the original, that is page **3**"; **Copy page 3** puts `3`
     on the clipboard (the viewer opens the child at its own page 1).
   - **Direct companion siblings:** split A again, pages **1–5**, and once more pages **6–10**. All three
     children share the same root material **and** the same source content hash, so each child's
     "Other parts from the same copy" must list the **other two** — different selected ranges do **not**
     mean a different edition. Record the listed ids/titles.
   - **Automatic split of B** → parts with complete, ordered, non‑overlapping coverage of all **1,050**
     pages; each part ≤ 1,000 pages and ≤ 50 MiB. Record part count/ranges/sizes.
   - **Nested parent:** manual‑split **B pages 101–300** → parent part **P** (200 pages,
     *pages 101–300 of 1,050*).
   - **Nested children:** split **P's own pages 20–40** → child **C1**; then split **P's own pages
     41–60** → child **C2**. Expected for C1: *Taken from … **pages 20–40 of 200***,
     *Original … **pages 120–140 of 1,050***, child length **21 pages**, "In P, page **20**",
     **Copy page 20** (into P) and **Copy page 120** (into B). C2's coordinates are 60–80 of 1,050.
     C1's sibling list must contain **C2** and must **not** contain A's direct children or P's siblings
     of B — nested grouping uses the immediate parent's identity + content hash, direct grouping the
     root's. Record which entries appear.
   - **Automatic split of C** (51.53 MiB, 60 pages) → 2 parts, each ≤ 50 MiB, ordered
     non‑overlapping coverage of 1–58 and 59–60; record sizes/RSS/responsiveness.
5. Reopen one part after **quitting and relaunching** NEW: same lineage, same sibling list, and
   **no duplicated parts** (record material counts before/after relaunch).
6. **Reachable failure + recovery (safety‑copy abort, real production path, no seam needed):**
   ```bash
   chmod u-w "/Users/hfdtest/Library/Application Support/com.herflightdeck.app/backups"
   ```
   In the manual split dialog choose pages 3–7 of A ▸ **Save this chapter**. Expected: the split fails
   before any receipt exists, showing the native backup error text or the dialog's fallback
   *"Could not save a safety copy, so nothing was changed."* (`backupErrorMessage` prefers the command's
   own message, so record the string actually shown). **Nothing is created** — no `material_split_lineage`
   row, no `split_operation_log` row, **no new file** under `documents/`, the source PDF's hash unchanged,
   and no orphan to clean. Capture a screenshot, the `… snapshot` diff (must be empty) and `ls documents/`
   before/after. Then `chmod u+w …/backups` and repeat the same split successfully — proving retry works.
7. Settings ▸ **Save complete backup** → `~/Downloads/hfd-schema13-<date>.hfdbackup`; record sha256 +
   manifest identity. Snapshot the upgraded+active profile: `snapshot … --json s13-upgraded.json`.
8. Quit NEW, confirm no process, and preserve its complete profile:
   `cp -R "…/com.herflightdeck.app" /Users/Shared/hfd-schema13/profile-schema13`.

### Step C — older binary refuses a schema‑13 backup (G3 refusal)
1. With **both apps closed**, switch the active root to the preserved **schema‑12 baseline**:
   ```bash
   mv "/Users/hfdtest/Library/Application Support/com.herflightdeck.app" /Users/Shared/hfd-schema13/profile-schema13.active
   cp -R /Users/Shared/hfd-schema13/profile-schema12 "/Users/hfdtest/Library/Application Support/com.herflightdeck.app"
   ```
2. `snapshot … --json s12-baseline-before-refusal.json`, then launch **OLD by full path**
   (never against the schema‑13 root), Settings ▸ **Restore backup** ▸ choose the **schema‑13**
   `.hfdbackup`. Expected refusal text: **"That backup was created by a newer database format. Update
   the app first."** Screenshot it.
3. Quit OLD, `snapshot … --json s12-baseline-after-refusal.json`, then
   `compare --before s12-baseline-before-refusal.json --after s12-baseline-after-refusal.json`
   → must report **no diff** (exit 0): the existing library, ledger 12, and every document anchor unchanged.
   Also confirm no restore journal/rollback leftovers: `ls "…/com.herflightdeck.app/backups"`.

### Step D — new app restores a genuine schema‑12 backup (G3 restore)
1. Both apps closed; restore the upgraded root:
   ```bash
   rm -rf "/Users/hfdtest/Library/Application Support/com.herflightdeck.app"     # the copy, not the preserved snapshot
   mv /Users/Shared/hfd-schema13/profile-schema13.active "/Users/hfdtest/Library/Application Support/com.herflightdeck.app"
   ```
2. Launch **NEW** by full path ▸ Settings ▸ **Restore backup** ▸ choose the genuine **schema‑12**
   `.hfdbackup` from Step A.6. Expected: pre‑restore preview shows the payload file count + uncompressed
   byte sum (this is the archive payload, **not** `unzip -l`'s entry count or the file size on disk), the
   restore verifies each file against `integrity.json`, applies migration 13, and restarts cleanly.
3. Verify materials, `documents/` file anchors (hashes equal Step A), practice attempts/responses and
   card state/events all present, then `snapshot … --json s13-restored.json` and
   `compare --before s12-populated.json --after s13-restored.json --history-only` → retained history
   identical. Screenshot the restored library.
4. Quit. Keep every profile copy, backup, snapshot JSON, comparison JSON and screenshot for review —
   nothing needs deleting.

## 3. Post‑receipt pending/reconcile/cancel subcase — **BLOCKED in the frozen bundle** (disclosed)

The dialogs run receipt creation and save **back to back** (`ManualSplitDialog.tsx` save() →
`splitPdf()` → `saveSplitParts()`), and while working both dialogs are `dismissible={false}` with Cancel
disabled. So there is **no human‑reachable window** in the packaged app to alter the source between the
receipt and the save, and no fault‑injection seam exists in the frozen bundle. Per the review, this is
recorded as **blocked / source‑covered**, not passed:

- Source coverage: `an_edited_or_unrecorded_receipt_saves_nothing`,
  `a_source_moved_to_another_file_or_removed_before_saving_is_refused`,
  `an_existing_output_id_or_a_mid_save_failure_saves_nothing` (rollback + stays `pending`),
  `a_cancelled_split_stays_cancelled_and_cannot_be_saved`,
  `cancelling_removes_only_its_own_files_and_never_touches_a_saved_split`, the `splitSave` read‑back UI
  tests, and sensitivity variants **S1/S3** (each guard fails its named test when reverted).
- Smallest seam proposal (separate, reviewed, **not implemented here**): a debug‑only
  `#[cfg(debug_assertions)]` pause/fault hook in `save_split_batch` keyed to a private dev build, or a
  dev‑build‑only test command that cancels a pending operation between issue and save. It must be absent
  from release binaries, add no production bypass, and be reviewed on its own.
- Cancel‑**before**‑save **is** installed‑testable and belongs in G1: closing the dialog before pressing
  Save performs no split at all, so assert **no** `split_operation_log` row, **no** part file in
  `documents/`, source hash unchanged, nothing to clean.

## 4. Recording rules
Per phase: exact command + exit, the snapshot/compare JSON names, one screenshot for each desktop flow
(import, part page with lineage, nested coordinates, sibling list, failure message, refusal message,
restore preview), and the candidate hash verified in‑session. Record **whatever macOS actually does** at
first launch. A local ad hoc build can certify behaviour only — never Developer ID, notarization or
distributability. Do not mark any phase pass without its observation; keep unexecuted phases UNVERIFIED.
