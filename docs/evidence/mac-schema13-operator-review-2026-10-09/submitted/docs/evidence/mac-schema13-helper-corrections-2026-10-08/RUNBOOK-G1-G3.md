# Her Flight Deck — Mac schema-13 physical gates G1–G3: standalone operator walkthrough

**Status of this document: PREPARED, NOT EXECUTED.** Nothing below has been observed. Every gate
stays **UNVERIFIED** until a person performs it in the `hfdtest` desktop session and records what
actually happened, including blocks and failures.

**Lane (already approved by the owner, do not re-derive it):** the standard non-admin macOS account
`hfdtest` (uid 502), synthetic disposable fixtures only, **local ad hoc signed** candidates that are
**not** Developer ID signed, **not** notarized and **not** publicly distributable. Never run any step
in the everyday admin account, and never point either app at the other's library.

**This kit is self-contained.** Everything you need is under
`/Users/Shared/hfd-schema13-kit-2026-10-08/` — installers, fixtures, the study packet, the snapshot
helper and this walkthrough. You do not need the repository, and you must not copy anything out of
another user's private home folder. `/Users/Shared` is world-writable, so **verify the transfer
manifest before using any file** (§1.2); if a hash does not match, stop and report it.

---

## 0. Exact identities being tested

| Role | Source commit | Installer (in `installers/`) | DMG SHA-256 | Inner executable SHA-256 |
| --- | --- | --- | --- | --- |
| **NEW** (schema 13, app under test) | `36a7b39acd291cba14be4f137798b3ad6f7272f1` | `NEW-schema13-36a7b39-adhoc.dmg` | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` | `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28` |
| **OLD** (schema 12, the older binary) | `2a6a41536b676559db94b476c71dd645af03fbab` | `OLD-schema12-2a6a415-adhoc.dmg` | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` | `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a` |

Both are arm64, bundle id `com.herflightdeck.app`, `Signature=adhoc`, `flags=0x10002(adhoc,runtime)`,
`Sealed Resources version=2`, `TeamIdentifier=not set`, and both pass `codesign --verify --strict` on
the executable and `--verify --deep --strict` on the bundle with exit 0. `spctl --assess` still reports
**rejected** and there is **no stapled ticket**. These artifacts certify **behaviour only**. These are
the same two installers the previous review already verified — nothing was rebuilt or re-signed for
this round.

Fixtures in `fixtures/` (deterministic; regenerate only from `scripts/generate-pdf-fixtures.mjs` in the
repository, never by hand):

| Name | File | Pages | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| **A** | `synthetic-small-checklist.pdf` | 10 | 3,360 | `f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134` |
| **B** | `synthetic-long-manual.pdf` | 1,050 | 330,934 | `0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1` |
| **C** | `synthetic-illustrated-charts.pdf` | 60 | 54,032,644 | `b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d` |

Offline study packet `packet/02-flashcards-and-test.json` — title "Letters and labels", **3 flashcards +
2 practice questions**, SHA-256 `d5101e8c58c70c21943295bb22ec5c88394c8db81aeec402bd8f7836612e1f99`.
Importing it creates real history with **no provider key and no network call**.

Tooling: `bin/mac-schema13-profile-snapshot.mjs` (read-only snapshot/compare) and
`bin/hfd-operator.sh` (validated profile switches + permission restore). Their hashes are in
`TRANSFERSHA256SUMS.txt` and are re-verified in §1.2.

---

## 1. Prepare the session

### 1.1 Log in as `hfdtest` and open Terminal

Confirm the lane before anything else (record all four outputs):

```bash
id -u
id -un
dseditgroup -o checkmember -m hfdtest admin
/bin/ls -d "/Users/hfdtest/Library/Application Support"
```

Expected: `502`, `hfdtest`, a "no …" line (standard account, **not** admin), and the Application
Support directory. If the third command says `yes`, stop and report it.

### 1.2 Verify every transferred file

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
cd "$HFD_KIT"
/usr/bin/shasum -a 256 -c TRANSFERSHA256SUMS.txt
```

Expected: one `: OK` line per file and exit 0. Any `FAILED`/`WARNING` means the kit was modified —
**stop and report it**; do not continue with a mismatched installer or helper.

### 1.3 Install the two candidates into distinct folders

Both share the same name, bundle id and version, so they must never sit in the same folder:

```bash
/bin/mkdir -p /Users/hfdtest/Applications/HFD-NEW-36a7b39 /Users/hfdtest/Applications/HFD-OLD-2a6a415
/usr/bin/hdiutil attach -readonly -nobrowse "$HFD_KIT/installers/NEW-schema13-36a7b39-adhoc.dmg"
/bin/cp -R "/Volumes/Her Flight Deck/Her Flight Deck.app" /Users/hfdtest/Applications/HFD-NEW-36a7b39/
/usr/bin/hdiutil detach "/Volumes/Her Flight Deck"
/usr/bin/hdiutil attach -readonly -nobrowse "$HFD_KIT/installers/OLD-schema12-2a6a415-adhoc.dmg"
/bin/cp -R "/Volumes/Her Flight Deck/Her Flight Deck.app" /Users/hfdtest/Applications/HFD-OLD-2a6a415/
/usr/bin/hdiutil detach "/Volumes/Her Flight Deck"
```

Then verify the installed binaries are the ones from §0 (record both outputs):

```bash
/usr/bin/shasum -a 256 "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
/usr/bin/shasum -a 256 "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
```

**First launch / Gatekeeper:** record **whatever this macOS actually does**. Locally built files carry
no quarantine attribute and `spctl` rejects ad hoc builds, so a double-click may run or may be blocked.
If blocked, use only the per-app flow (right-click ▸ Open, or System Settings ▸ Privacy & Security ▸
Open Anyway) per [Apple's guidance](https://support.apple.com/en-us/102445). **Never** disable
Gatekeeper globally and never bulk-clear quarantine. If no permitted per-app flow works, record the
blocked result and stop — that is a finding, not a pass.

### 1.4 Create this run's evidence folder (used by every command below)

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
export HFD_EVID="/Users/Shared/hfd-schema13-kit-2026-10-08/evidence/run-$(/bin/date -u +%Y%m%dT%H%M%SZ)"
/bin/mkdir -p "$HFD_EVID"
/usr/bin/printf '%s\n' "$HFD_EVID" > "$HFD_KIT/evidence/CURRENT-RUN.txt"
export HFD_BACKUP12="$HFD_EVID/hfdbackup-schema12.hfdbackup"
export HFD_BACKUP13="$HFD_EVID/hfdbackup-schema13.hfdbackup"
/bin/echo "$HFD_EVID"
```

`$HFD_BACKUP12` / `$HFD_BACKUP13` are the exact paths you type into the app's **Save complete backup**
chooser, so the backups land beside the evidence that proves them. The app writes into this folder you
created as `hfdtest` — no other location is used.

**In every later Terminal session** restore the same folder instead of making a new one:

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
export HFD_EVID="$(/bin/cat /Users/Shared/hfd-schema13-kit-2026-10-08/evidence/CURRENT-RUN.txt)"
export HFD_BACKUP12="$HFD_EVID/hfdbackup-schema12.hfdbackup"
export HFD_BACKUP13="$HFD_EVID/hfdbackup-schema13.hfdbackup"
```

The helper refuses to overwrite an existing output file, so if a command fails because the destination
already exists, **choose a new suffix** (for example `s12-initial-retry1.json`) rather than deleting
anything.

### 1.5 The rule that makes every snapshot trustworthy

**Never take a snapshot, capture a comparison baseline, or copy/switch a profile while an app is
running.** Quit it with **Cmd-Q** in its own window (never `kill`), then confirm:

```bash
"$HFD_OP" stopped
```

Expected `OK: no Her Flight Deck process is running`. If it prints `REFUSED`, the app is still alive
(quit it properly) or macOS would not let the check run — **both mean "not confirmed stopped"**, so do
not snapshot. The helper enforces the same rule itself and refuses a snapshot it cannot confirm.

### 1.6 Which comparison each gate uses (never the wrong one)

| Gate | Command purpose | What it proves |
| --- | --- | --- |
| G2 upgrade | `--purpose upgrade` | genuine schema-12 baseline → schema-13: all retained data identical, migration applied, only 0013's objects added |
| G1 (optional spot-check) | `--purpose unchanged` | nothing at all changed in the library |
| G3 refusal | `--purpose unchanged` | the older binary left the schema-12 library byte-for-content identical |
| G3 restore | `--purpose restore` | schema-12 backup restored, migrated, every retained row and document present |
| any | `--purpose history` | **partial by design** — can never set a gate verdict; use it only for a quick look |

`--history-only` is accepted as an alias for `--purpose history` and is labelled partial in the receipt.
Read `verdict` (`PASS` / `FAIL` / `PARTIAL`) in the comparison JSON: **only `PASS` counts**, and `PARTIAL`
never does. Exit status is `0` for a clean comparison and `1` when anything differs.

---

## 2. Step A — OLD on a fresh schema-12 library (builds the baseline)

1. Launch OLD and create the profile:
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app"
   ```
   Record: launch outcome, any Gatekeeper prompt, and the window's library state.
2. Quit OLD (Cmd-Q), confirm stopped (§1.5), then capture the empty baseline:
   ```bash
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-fresh.json"
   ```
   Expected in the JSON: `ledger.table = "_sqlx_migrations"`, `ledger.maxVersion = 12`, 12 versions,
   `schema13Tables.*.absent = true`, `inventory.complete = true`, `isolation.processInspection.state =
   "stopped"`, `operator: true`, and zero rows in `practice_attempts`, `card_review_state`.
3. Study Library ▸ **Add material** ▸ the PDF/file chooser ▸ `fixtures/synthetic-small-checklist.pdf`
   (**A**) ▸ save. Repeat for `fixtures/synthetic-long-manual.pdf` (**B**). Record each new material's
   **id and title** as the app shows them, and confirm the title defaulted to the file name.
4. Study Library ▸ **Import study packet…** ▸ `packet/02-flashcards-and-test.json` ▸ preview must show
   **3 flashcards and 2 practice questions** ▸ **Import as new material**. Record its id/title.
5. Open that imported material ▸ practice test ▸ answer **both** questions (pick an option ▸
   **Continue**, then **See score**) so one **completed** attempt with two responses exists.
6. Open its flashcards ▸ **Show answer** ▸ rate one card (**Good: again in 1 day**, or Again/Hard/Easy)
   so `card_review_state` **and** `card_review_events` both have a row.
7. Settings ▸ Data management ▸ **Save complete backup**. In Terminal, print the exact destination, then
   in the save dialog press **Cmd+Shift+G** and paste that one line:
   ```bash
   /usr/bin/printf 'Save the backup to: %s\n' "$HFD_BACKUP12"
   ```
   Record:
   ```bash
   /usr/bin/shasum -a 256 "$HFD_BACKUP12"
   /usr/bin/unzip -p "$HFD_BACKUP12" manifest.json
   /usr/bin/unzip -l "$HFD_BACKUP12"
   ```
   Save all three outputs. The manifest's app version **and** the archive's file count + uncompressed
   byte sum are the identity of this backup — the version number alone is `0.5.3` in **both** candidates
   and cannot tell OLD from NEW.
8. Quit OLD, confirm stopped, then capture the populated baseline (**this is the G2/G3 "before" anchor**):
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-populated.json"
   ```
   Expected: `practice_attempts ≥ 1`, `practice_responses = 2`, `card_review_state ≥ 1`,
   `card_review_events ≥ 1`, `study_materials = 3`, two `documents/` file anchors, `ledger.maxVersion = 12`.
   If any of those counts is missing, the upgrade comparison will **refuse** — an empty library cannot
   certify populated-data retention.
9. Quit OLD, confirm stopped, preserve the **whole** profile folder for G3:
   ```bash
   "$HFD_OP" stopped
   "$HFD_OP" copy "$HFD_ROOT" "$HFD_PROFILES/schema12-baseline"
   ```
   `copy` refuses if the destination already exists or if anything is still running, so a re-run can
   never nest or clobber. Record its `OK:` line.

---

## 3. Step B — NEW upgrades that same active profile (G2), then G1

1. Do **not** move anything: the active root is still the populated schema-12 profile. Capture the
   upgrade baseline now, **before** any new user action, with the app quit:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-pre-upgrade.json"
   ```
2. Launch NEW and let it migrate:
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"
   ```
   Record the first-launch outcome and any prompt exactly as it appears.
3. **Quit NEW (Cmd-Q) immediately** — before opening anything else — confirm stopped, snapshot, and
   compare with the upgrade contract:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-post-upgrade.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-pre-upgrade.json" --after "$HFD_EVID/s13-post-upgrade.json" --purpose upgrade --json "$HFD_EVID/cmp-g2-upgrade.json"
   /bin/cat "$HFD_EVID/cmp-g2-upgrade.json"
   ```
   Expected: `verdict = "PASS"`, `diffs = []`, `gateEligible = true`, `retainedHistoryUnchanged = true`,
   after `ledger.maxVersion = 13` with 13 recorded versions whose first 12 are identical to before, both
   `material_split_lineage` and `split_operation_log` present with `absent: false`, `documents/` anchors
   identical, and the only added schema objects being migration 0013's two tables + four indexes. Record
   the whole JSON. Anything else is a **finding for G2**.
4. **G1 flows.** Relaunch NEW (`/usr/bin/open "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"`),
   and quit + confirm stopped between every recorded check. Exact expectations (no "of 400" anywhere —
   nothing here has 400 pages):
   - **A, manual split pages 3–7** → one child of **5 pages**; its lineage reads *Original … pages 3–7 of
     10* and "In the original, that is page **3**"; **Copy page** gives `3` (the child's viewer is on its
     own page 1 — coordinate guidance and viewer page are different things). Record the child id/title.
   - **Direct companion siblings:** split **A** again at pages **1–5** and once more at **6–10**. All three
     children share the same root material **and** the same source content hash, so each child's "Other
     parts from the same copy" must list the **other two**. Different selected ranges are **not** different
     editions. Record the listed ids/titles verbatim.
   - **Automatic split of B** → parts covering all **1,050** pages completely, in order, without overlap;
     every part ≤ 1,000 pages and ≤ 50 MiB. Record part count, each page range, each size, and whether the
     window stayed responsive during the split.
   - **Nested parent:** manual split of **B pages 101–300** → parent **P**: 200 pages, *pages 101–300 of
     1,050*. Record P's id/title.
   - **Nested child C1:** split **P's own pages 20–40** → 21 pages; *Taken from … pages 20–40 of 200*;
     *Original … pages **120–140** of **1,050***; "In P, page **20**"; **Copy page** → `20` for P and `120`
     for B.
   - **Nested child C2:** split **P's own pages 41–60** → **20 pages**; *Taken from … pages 41–60 of 200*;
     *Original … pages **141–160** of **1,050***; "In P, page **41**"; **Copy page** → `41` for P and `141`
     for B. (The earlier draft said 60–80 — that was wrong: P starts at original page 101, so its own
     41–60 lands at root **141–160**.)
   - **Sibling grouping:** C1's "other parts" list must contain **C2** and must **not** contain A's direct
     children or P itself — nested grouping uses the **immediate parent's** id + content hash, direct
     grouping the root's. Record exactly which entries appear.
   - **Automatic split of C** (51.53 MiB, 60 pages) → **2** parts, each ≤ 50 MiB, ordered non-overlapping
     coverage of pages 1–58 and 59–60. Record sizes, RSS if the app shows it, and responsiveness.
   - **Cancel before saving:** open the manual split dialog for A pages 1–2 and close it **without**
     pressing **Save this chapter**. Expected: **no** `split_operation_log` row, **no** part file in
     `documents/`, the source hash unchanged, nothing to clean up — closing before saving performs no
     split at all. Verify with a stopped-app snapshot + `--purpose unchanged` comparison:
     ```bash
     "$HFD_OP" stopped
     "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-before-cancel.json"
     ```
     (relaunch NEW, close the dialog, quit NEW, confirm stopped)
     ```bash
     "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-after-cancel.json"
     "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s13-before-cancel.json" --after "$HFD_EVID/s13-after-cancel.json" --purpose unchanged --json "$HFD_EVID/cmp-g1-cancel.json"
     ```
     Expected `verdict = "PASS"`, `diffs = []`.
   - **Relaunch persistence:** quit and relaunch NEW, reopen one part: same lineage, same sibling list, no
     duplicated parts. Record material counts before and after the relaunch.
5. **Reachable installed failure — safety copy cannot be written.** Capture the "before" state first, with
   NEW closed, then block write permission on the backups directory (the script records the original mode
   in your evidence folder before changing anything):
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-before-failed-split.json"
   /bin/ls "$HFD_ROOT/documents" > "$HFD_EVID/documents-before-failure.txt"
   "$HFD_OP" block-backups
   /usr/bin/stat -f '%Sp %N' "$HFD_ROOT/backups"
   ```
   Launch NEW ▸ Study Library ▸ open **A** ▸ manual split pages **3–7** ▸ **Save this chapter**.
   Expected: the split fails **before any receipt exists**, showing the native backup error text or the
   dialog's fallback *"Could not save a safety copy, so nothing was changed."* (`backupErrorMessage` prefers
   the command's own message, so record the string actually shown.) Nothing is created: no
   `material_split_lineage` row, no `split_operation_log` row, no new file in `documents/`, the source PDF
   unchanged, no orphan to clean. Screenshot the message. Then quit NEW and **always** restore the
   permission — after success, after failure, or if you abort this subcase:
   ```bash
   "$HFD_OP" unblock-backups
   /usr/bin/stat -f '%Sp %N' "$HFD_ROOT/backups"
   ```
   Expected: the recorded original mode back, verified by the script itself. Confirm stopped and prove the
   failed attempt changed nothing at all:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-after-failed-split.json"
   /bin/ls "$HFD_ROOT/documents" > "$HFD_EVID/documents-after-failure.txt"
   /usr/bin/diff "$HFD_EVID/documents-before-failure.txt" "$HFD_EVID/documents-after-failure.txt"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s13-before-failed-split.json" --after "$HFD_EVID/s13-after-failed-split.json" --purpose unchanged --json "$HFD_EVID/cmp-g1-failure.json"
   /bin/cat "$HFD_EVID/cmp-g1-failure.json"
   ```
   Expected: `diff` prints nothing and `verdict = "PASS"` with `diffs = []` — all 33 retained tables
   (including `material_split_lineage`/`split_operation_log` **presence** facts, which stay unchanged), the
   ledger at 13, and every `documents/` file identical. New files under `backups/` from the app's own
   startup are listed in the snapshot but are **not** part of this proof.
6. Settings ▸ **Save complete backup**. Print and paste the destination exactly as in A.7:
   ```bash
   /usr/bin/printf 'Save the backup to: %s\n' "$HFD_BACKUP13"
   /usr/bin/shasum -a 256 "$HFD_BACKUP13"
   /usr/bin/unzip -p "$HFD_BACKUP13" manifest.json
   /usr/bin/unzip -l "$HFD_BACKUP13"
   ```
   This is G3's schema-13 backup (the one OLD must refuse).
7. Quit NEW, confirm stopped, snapshot the upgraded+active profile, and preserve it:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-upgraded.json"
   "$HFD_OP" copy "$HFD_ROOT" "$HFD_PROFILES/schema13-upgraded"
   ```

---

## 4. Step C — the older binary refuses a schema-13 backup (G3 refusal)

1. Both apps closed. Switch the active root to the preserved schema-12 baseline. `move` validates the
   lane, that nothing is running, and that the destination is absent; **it never deletes**:
   ```bash
   "$HFD_OP" stopped
   "$HFD_OP" move "$HFD_ROOT" "$HFD_PROFILES/schema13-active-set-aside"
   "$HFD_OP" copy "$HFD_PROFILES/schema12-baseline" "$HFD_ROOT"
   ```
   On a re-run, use a new destination name (`schema13-active-set-aside-retry1`) instead of overwriting.
2. Confirm the switch is faithful, then capture the refusal baseline:
   ```bash
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-before-refusal.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-populated.json" --after "$HFD_EVID/s12-before-refusal.json" --purpose unchanged --json "$HFD_EVID/cmp-g3-switch-fidelity.json"
   ```
   Expected `verdict = "PASS"` — the copied profile is byte-for-content identical to the library OLD left.
3. Launch OLD, then Settings ▸ Data management ▸ **Restore backup** ▸ choose the **schema-13** backup
   (paste `/usr/bin/printf '%s\n' "$HFD_BACKUP13"` into the chooser with Cmd+Shift+G). Expected refusal,
   word for word:
   **"That backup was created by a newer database format. Update the app first."** Screenshot it.
4. Quit OLD, confirm stopped, and compare with the **unchanged** contract (never the upgrade one — this
   library must stay at schema 12):
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-after-refusal.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-before-refusal.json" --after "$HFD_EVID/s12-after-refusal.json" --purpose unchanged --json "$HFD_EVID/cmp-g3-refusal.json"
   /bin/cat "$HFD_EVID/cmp-g3-refusal.json"
   ```
   **Expected: `verdict = "PASS"` and `diffs = []`.** Concretely that means all 33 retained tables are
   identical — including `practice_attempts`, `practice_responses`, `practice_session_operations`,
   `card_review_state`, `card_review_events`, `card_review_operations`, `debrief_operations`,
   `study_materials`, `tags`, `material_tags` and the rest — the ledger still holds the same 12 versions
   with `maxVersion = 12`, both schema-13 tables remain absent, and every `documents/` file keeps its hash.
   A refusal must **not** score as a failure for lacking schema-13 tables; if the receipt shows that,
   the wrong purpose was used.
   `backups/`, `last-run-version.txt` and the raw `.db`/`-wal`/`-shm` bytes are recorded but **not**
   protected: a new startup/safety artifact is not evidence that the refusal failed. Check for leftovers
   separately and record them as text:
   ```bash
   /bin/ls -la "$HFD_ROOT/backups"
   ```
   Expected: no `restore-journal.json`, no `.restore-pending`, no `.restore-staging`, no new
   `before-restore-*` directory from the refused attempt.
5. Keep this profile: `move` it to `$HFD_PROFILES/schema12-refusal-test` in Step D.1 (never delete it).

---

## 5. Step D — the new app restores a genuine schema-12 backup (G3 restore)

1. Both apps closed. Retain the refusal-test profile by moving it aside, then put the upgraded profile
   back as the active root:
   ```bash
   "$HFD_OP" stopped
   "$HFD_OP" move "$HFD_ROOT" "$HFD_PROFILES/schema12-refusal-test"
   "$HFD_OP" move "$HFD_PROFILES/schema13-active-set-aside" "$HFD_ROOT"
   ```
2. Launch NEW, then Settings ▸ **Restore backup** ▸ choose the genuine **schema-12** backup
   (paste `/usr/bin/printf '%s\n' "$HFD_BACKUP12"` into the chooser with Cmd+Shift+G). Expected: the
   pre-restore preview shows the payload **file count and uncompressed byte sum** (the
   archive payload, not `unzip -l`'s entry count and not the size on disk), the restore verifies each file
   against `integrity.json`, applies migration 13, and restarts cleanly. Screenshot the preview and the
   outcome.
3. Quit NEW, confirm stopped, snapshot and compare with the **restore** contract:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-restored.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-populated.json" --after "$HFD_EVID/s13-restored.json" --purpose restore --json "$HFD_EVID/cmp-g3-restore.json"
   /bin/cat "$HFD_EVID/cmp-g3-restore.json"
   ```
   Expected `verdict = "PASS"`: every retained table identical to the schema-12 baseline, **all
   `documents/` files identical by hash**, ledger versions 1–12 preserved with migration 13 added, both
   schema-13 tables present, and only 0013's objects added. A changed document must fail this even when
   history matches — that is the point of the contract.
4. Open the restored material in the UI: confirm A/B + the imported packet are listed, the practice
   attempt shows its recorded score, the rated card shows its schedule, and any split parts still show
   their lineage. Screenshot the restored library and record the material ids/titles you see.
5. Quit. Keep every profile folder, backup, snapshot JSON, comparison JSON, screenshot and terminal
   output — nothing needs deleting.

---

## 6. Post-receipt pending / reconcile / cancel subcase — **BLOCKED in the frozen bundle** (disclosed, unchanged)

The installed dialogs run receipt creation and save back to back (`ManualSplitDialog.tsx` `save()` →
`splitPdf()` → `saveSplitParts()`), and while working both dialogs are `dismissible={false}` with Cancel
disabled. There is therefore **no human-reachable window** in the packaged app to alter the source between
the receipt and the save, and the frozen bundle contains no fault-injection seam. This subcase stays
**blocked / source-covered**, not passed:

- Source coverage: `an_edited_or_unrecorded_receipt_saves_nothing`,
  `a_source_moved_to_another_file_or_removed_before_saving_is_refused`,
  `an_existing_output_id_or_a_mid_save_failure_saves_nothing`,
  `a_cancelled_split_stays_cancelled_and_cannot_be_saved`,
  `cancelling_removes_only_its_own_files_and_never_touches_a_saved_split`, the `splitSave` read-back UI
  tests, and sensitivity variants **S1/S3**.
- Smallest seam proposal (separate review, **not implemented here**): a debug-only
  `#[cfg(debug_assertions)]` pause/fault hook in `save_split_batch`, or a dev-build-only cancel command,
  absent from release binaries. Fixing the helper does **not** authorize adding it.
- Cancel **before** save **is** installed-testable and belongs in G1 (§3.4).

---

## 7. Recording rules

Per phase: the exact command, its exit status, the snapshot/compare file names, one screenshot for each
desktop flow (import, part page with lineage, nested coordinates, sibling list, automatic-split coverage,
failure message, refusal message, restore preview), and the candidate hash verified in-session. Record
**whatever macOS actually does**, not what this document hopes for. A local ad hoc build certifies
behaviour only — never Developer ID, notarization or distributability.

**A gate is only PASS when a person observed it.** Do not mark any phase passed without its observation,
and do not treat the helper's own checks, the review diagnostics or the source tests as installed evidence.
Send the whole `$HFD_EVID` folder plus `$HFD_PROFILES` listings back for review; until then G1–G3 remain
**UNEXECUTED / UNVERIFIED**.
