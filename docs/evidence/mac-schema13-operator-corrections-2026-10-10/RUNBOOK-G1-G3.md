# Runbook: Physical Installed Gates G1, G2, G3 on macOS

**Audience:** A person logged into the Mac as `hfdtest` (UID 502, standard non-admin account).
**Input kit:** `/Users/Shared/hfd-schema13-kit-2026-10-08/` (read-only input).
**Task workspace:** `/Users/hfdtest/Downloads/hfd-schema13-workspace/` (user-owned, writable).
**Candidate binaries:**
* `NEW` — `schema13-36a7b39-adhoc` (Milestone 2 split-lineage implementation).
* `OLD` — `schema12-2a6a415-adhoc` (Milestone 2 card-review baseline; shipped schema 12).

Both candidates are unsigned local ad hoc builds. They share the bundle identifier
`com.herflightdeck.app` and version `0.5.3`.

---

## 0. Exact candidate hashes (verify before installing)

| Role | DMG file name | DMG SHA-256 |
| --- | --- | --- |
| `NEW` | `NEW-schema13-36a7b39-adhoc.dmg` | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` |
| `OLD` | `OLD-schema12-2a6a415-adhoc.dmg` | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` |

Inside the mounted DMGs, each payload executable has its own SHA-256:

* `NEW` binary: `47a3fd97e743da00259f97fc7eb64491745427181cbfba7b30f789d71597f9e5`
* `OLD` binary: `7e997f7fa2032e2938a1cb965219fdfa7be68393e83fa3097c5e2ef7245dd9c1`

---

## 1. Environment and installation (run once per desktop session)

### 1.1 Verify account identity and isolation

Log into macOS as `hfdtest`. Open Terminal:

```bash
/usr/bin/id -u
/usr/bin/id -un
/usr/sbin/dseditgroup -o checkmember -m hfdtest admin
/bin/ls -d "/Users/hfdtest/Library/Application Support"
```

Expected output: `502`, `hfdtest`, exit status 1 from `dseditgroup` ("... is not a member of admin"),
and the Application Support directory. If `dseditgroup` reports admin membership (exit 0), **stop and report it**.

### 1.2 Verify transferred kit manifest

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
cd "$HFD_KIT"
/usr/bin/shasum -a 256 -c TRANSFERSHA256SUMS.txt
```

Expected: all 10 files report `: OK` and exit 0. Any failure means kit files were modified — **stop immediately**.

### 1.3 Install the candidates to isolated folders with task-owned mountpoints

Each candidate must be mounted to an explicit task mountpoint, verified, copied, and cleanly detached.
Refuse existing installation destinations before mutation:

```bash
# Verify installation targets do not already exist
[ ! -e "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app" ] || { echo "REFUSED: NEW app already installed" >&2; exit 2; }
[ ! -e "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app" ] || { echo "REFUSED: OLD app already installed" >&2; exit 2; }

/bin/mkdir -p /Users/hfdtest/Applications/HFD-NEW-36a7b39 /Users/hfdtest/Applications/HFD-OLD-2a6a415
/bin/mkdir -p /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old

# Mount and install NEW
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new "$HFD_KIT/installers/NEW-schema13-36a7b39-adhoc.dmg"
/usr/bin/shasum -a 256 "/Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
/bin/cp -R "/Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new/Her Flight Deck.app" /Users/hfdtest/Applications/HFD-NEW-36a7b39/
/usr/bin/hdiutil detach /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new

# Mount and install OLD
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old "$HFD_KIT/installers/OLD-schema12-2a6a415-adhoc.dmg"
/usr/bin/shasum -a 256 "/Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
/bin/cp -R "/Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old/Her Flight Deck.app" /Users/hfdtest/Applications/HFD-OLD-2a6a415/
/usr/bin/hdiutil detach /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old

/bin/rmdir /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-new /Users/hfdtest/Downloads/hfd-schema13-workspace/mnt-old
```

Verify installed binaries match §0:

```bash
/usr/bin/shasum -a 256 "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
/usr/bin/shasum -a 256 "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
```

**Gatekeeper handling:** If blocked by Gatekeeper, use right-click ▸ Open (or System Settings ▸ Privacy & Security ▸ Open Anyway). Never disable Gatekeeper globally.

### 1.4 Create task workspace and run evidence folder

Create the user-owned task workspace under `/Users/hfdtest/Downloads/hfd-schema13-workspace`.
This ensures output files are owned and writable by `hfdtest` (UID 502), while the kit remains read-only:

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
/bin/mkdir -p "$HFD_WORKSPACE/profiles" "$HFD_WORKSPACE/evidence"
export HFD_EVID="$HFD_WORKSPACE/evidence/run-$(/bin/date -u +%Y%m%dT%H%M%SZ)"
/bin/mkdir -p "$HFD_EVID"
/usr/bin/printf '%s\n' "$HFD_EVID" > "$HFD_WORKSPACE/evidence/CURRENT-RUN.txt"
export HFD_BACKUP12="$HFD_EVID/hfdbackup-schema12.hfdbackup"
export HFD_BACKUP13="$HFD_EVID/hfdbackup-schema13.hfdbackup"
/bin/echo "Active run evidence folder: $HFD_EVID"
```

In any subsequent Terminal session, restore the active run folder:

```bash
source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
export HFD_EVID="$(/bin/cat /Users/hfdtest/Downloads/hfd-schema13-workspace/evidence/CURRENT-RUN.txt)"
export HFD_BACKUP12="$HFD_EVID/hfdbackup-schema12.hfdbackup"
export HFD_BACKUP13="$HFD_EVID/hfdbackup-schema13.hfdbackup"
```

### 1.5 Strict process stop requirement

**Never take a snapshot, compare profiles, or switch profiles while either app is running.**
Quit the app with **Cmd-Q**, then confirm:

```bash
"$HFD_OP" stopped
```

Expected: `OK: no Her Flight Deck process is running`.

### 1.6 Comparison purpose matrix

| Gate | Command purpose | What it proves |
| --- | --- | --- |
| G2 upgrade | `--purpose upgrade` | genuine schema-12 baseline → schema-13: all retained data identical, migration 13 applied, exactly two tables and four indexes added, empty new tables |
| G1 unchanged | `--purpose unchanged` | library unchanged: all retained and schema-13 rows/objects identical |
| G3 refusal | `--purpose unchanged` | older binary left schema-12 library byte-for-content identical |
| G3 restore | `--purpose restore` | schema-12 backup restored into NEW, migrated to 13, all retained rows and documents present, no residual lineage/operation rows |
| inspection | `--purpose history` | **partial by design** — never gate eligible |

---

## 2. Step A — OLD on a fresh schema-12 library (Baseline Creation)

1. Launch OLD to initialize the default profile:
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app"
   ```
2. Quit OLD (Cmd-Q), confirm stopped, then capture the fresh baseline:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-fresh.json"
   ```
   Expected: `ledger.maxVersion = 12`, 12 versions, schema-13 tables absent, zero rows in `practice_attempts`.

3. **Explicitly relaunch OLD** to continue UI operations:
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app"
   ```

4. Study Library ▸ **Add material** ▸ choose `fixtures/synthetic-small-checklist.pdf` (**A**). Repeat for `fixtures/synthetic-long-manual.pdf` (**B**).
5. Study Library ▸ **Import study packet…** ▸ `packet/02-flashcards-and-test.json` ▸ Import as new material.
6. Open imported material ▸ practice test ▸ complete both questions (score displayed).
7. Open flashcards ▸ rate one card (**Good**).
8. Settings ▸ Data management ▸ **Save complete backup**. In Terminal, print destination:
   ```bash
   /usr/bin/printf 'Save backup to: %s\n' "$HFD_BACKUP12"
   ```
   Paste path into chooser (Cmd-Shift-G). Verify archive:
   ```bash
   /usr/bin/shasum -a 256 "$HFD_BACKUP12"
   /usr/bin/unzip -p "$HFD_BACKUP12" manifest.json
   /usr/bin/unzip -l "$HFD_BACKUP12"
   ```
9. Quit OLD, confirm stopped, capture populated baseline (**G2/G3 before anchor**):
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-populated.json"
   ```
10. Preserve the populated schema-12 profile for Step C and G3:
    ```bash
    "$HFD_OP" stopped
    "$HFD_OP" copy "$HFD_ROOT" "$HFD_PROFILES/schema12-baseline"
    ```

---

## 3. Step B — NEW upgrades active profile (G2), then G1 splits

1. Confirm stopped, capture pre-upgrade baseline:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-pre-upgrade.json"
   ```
2. Launch NEW to trigger in-place migration:
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"
   ```
3. **Quit NEW immediately (Cmd-Q)**, confirm stopped, snapshot, and compare:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-post-upgrade.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-pre-upgrade.json" --after "$HFD_EVID/s13-post-upgrade.json" --purpose upgrade --json "$HFD_EVID/cmp-g2-upgrade.json"
   /bin/cat "$HFD_EVID/cmp-g2-upgrade.json"
   ```
   Expected: `verdict = "PASS"`, `gateEligible = true`, `ledger.maxVersion = 13`, both schema-13 tables present and empty, exactly 2 tables + 4 indexes added matching 0013 definitions.

4. **G1 Split Flows:** Relaunch NEW (`/usr/bin/open "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"`):
   - Manual split of **A** (pages 3–7) → 5 pages.
   - Sibling splits of **A** (pages 1–5, 6–10) → companion siblings visible.
   - Automatic split of **B** (1,050 pages) → complete, ordered parts ≤ 50 MiB.
   - Nested parent **P** (B pages 101–300) → 200 pages.
   - Nested child **C1** (P pages 20–40) → 21 pages (root pages 120–140).
   - Nested child **C2** (P pages 41–60) → 20 pages (root pages 141–160).
   - Sibling grouping check: C1 lists C2; excludes direct parts and P.
   - Auto-split of **C** (60 pages, 51.53 MiB) → 2 parts.
   - Cancel before saving: open manual split dialog, cancel without saving. Verify unchanged:
     ```bash
     "$HFD_OP" stopped
     "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-before-cancel.json"
     # Relaunch, open dialog, cancel, quit:
     "$HFD_OP" stopped
     "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-after-cancel.json"
     "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s13-before-cancel.json" --after "$HFD_EVID/s13-after-cancel.json" --purpose unchanged --json "$HFD_EVID/cmp-g1-cancel.json"
     ```

5. **Pre-receipt intentional backup failure test:**
   With NEW stopped, snapshot and block backups:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-before-failed-split.json"
   /bin/ls "$HFD_ROOT/documents" > "$HFD_EVID/documents-before-failure.txt"
   "$HFD_OP" block-backups
   ```
   Launch NEW ▸ Study Library ▸ open **A** ▸ manual split pages **3–7** ▸ Save this chapter.
   Expected: split aborts before receipt with safety copy error message.
   Quit NEW, confirm stopped, and **restore permissions**:
   ```bash
   "$HFD_OP" unblock-backups
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-after-failed-split.json"
   /bin/ls "$HFD_ROOT/documents" > "$HFD_EVID/documents-after-failure.txt"
   /usr/bin/diff "$HFD_EVID/documents-before-failure.txt" "$HFD_EVID/documents-after-failure.txt"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s13-before-failed-split.json" --after "$HFD_EVID/s13-after-failed-split.json" --purpose unchanged --json "$HFD_EVID/cmp-g1-failure.json"
   /bin/cat "$HFD_EVID/cmp-g1-failure.json"
   ```
   Expected: `diff` empty, `verdict = "PASS"`.

   **Explicitly relaunch and retry split successfully:**
   ```bash
   /usr/bin/open "/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"
   ```
   Reopen **A**, manual split pages **3–7**, click **Save this chapter**.
   With permissions restored, the split completes successfully!
   Quit NEW, confirm stopped:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-after-retry-split.json"
   ```

6. Settings ▸ **Save complete backup** (`$HFD_BACKUP13`):
   ```bash
   /usr/bin/printf 'Save backup to: %s\n' "$HFD_BACKUP13"
   /usr/bin/shasum -a 256 "$HFD_BACKUP13"
   /usr/bin/unzip -p "$HFD_BACKUP13" manifest.json
   /usr/bin/unzip -l "$HFD_BACKUP13"
   ```
7. Quit NEW, confirm stopped, snapshot and copy upgraded profile:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-upgraded.json"
   "$HFD_OP" copy "$HFD_ROOT" "$HFD_PROFILES/schema13-upgraded"
   ```

---

## 4. Step C — OLD binary refuses schema-13 backup (G3 refusal)

1. Switch active profile to preserved schema-12 baseline:
   ```bash
   "$HFD_OP" stopped
   "$HFD_OP" move "$HFD_ROOT" "$HFD_PROFILES/schema13-active-set-aside"
   "$HFD_OP" copy "$HFD_PROFILES/schema12-baseline" "$HFD_ROOT"
   ```
2. Verify profile switch fidelity:
   ```bash
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-before-refusal.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-populated.json" --after "$HFD_EVID/s12-before-refusal.json" --purpose unchanged --json "$HFD_EVID/cmp-g3-switch-fidelity.json"
   ```
   Expected: `verdict = "PASS"`.
3. Launch OLD ▸ Settings ▸ Data management ▸ **Restore backup** ▸ choose `$HFD_BACKUP13`.
   Expected refusal message:
   **"That backup was created by a newer database format. Update the app first."**
4. Quit OLD, confirm stopped, snapshot and compare:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s12-after-refusal.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-before-refusal.json" --after "$HFD_EVID/s12-after-refusal.json" --purpose unchanged --json "$HFD_EVID/cmp-g3-refusal.json"
   /bin/cat "$HFD_EVID/cmp-g3-refusal.json"
   /bin/ls -la "$HFD_ROOT/backups"
   ```
   Expected: `verdict = "PASS"`, no journal or staging files left in backups.
5. Move refusal profile aside:
   ```bash
   "$HFD_OP" move "$HFD_ROOT" "$HFD_PROFILES/schema12-refusal-test"
   ```

---

## 5. Step D — NEW restores genuine schema-12 backup (G3 restore)

1. Put upgraded profile back as active root:
   ```bash
   "$HFD_OP" stopped
   "$HFD_OP" move "$HFD_PROFILES/schema13-active-set-aside" "$HFD_ROOT"
   ```
2. Launch NEW ▸ Settings ▸ Data management ▸ **Restore backup** ▸ choose `$HFD_BACKUP12`.
   Verify pre-restore preview shows file count and byte sum, confirms restore, applies migration 13.
3. Quit NEW, confirm stopped, snapshot and compare with restore contract:
   ```bash
   "$HFD_OP" stopped
   "$HFD_NODE" "$HFD_HELPER" snapshot --json "$HFD_EVID/s13-restored.json"
   "$HFD_NODE" "$HFD_HELPER" compare --before "$HFD_EVID/s12-populated.json" --after "$HFD_EVID/s13-restored.json" --purpose restore --json "$HFD_EVID/cmp-g3-restore.json"
   /bin/cat "$HFD_EVID/cmp-g3-restore.json"
   ```
   Expected: `verdict = "PASS"`, all 33 retained tables identical, files identical, migration 13 applied, zero residual lineage/operation rows.
4. Open restored material in UI, verify cards and attempts intact.
5. Quit. Keep all profiles, snapshots, and receipts intact.

---

## 6. Post-receipt failure recovery subcase (Blocked Status)

The post-receipt mid-save failure recovery subcase remains **blocked / source-covered** in the packaged app:
no human-reachable window exists between receipt writing and part commit, and no debug fault-injection seam
is implemented in release binaries. This assignment does not implement the proposed seam.

---

## 7. Submission Checklist for Reviewer

Upon completion of human execution, provide:
1. Full `$HFD_EVID` folder containing all snapshots and comparisons.
2. Terminal session logs with exit codes for every command.
3. Screenshots of Gatekeeper prompt, refusal dialog, and restored library.
4. Listings of `$HFD_PROFILES`.
