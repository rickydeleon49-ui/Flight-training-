# Mac schema-13 operator and full-comparison corrections — 10 October 2026

Closes **MACV-R7** (operator permissions, recovery, fail-closed path/account checks, and human walkthrough) and **MACV-R8** (complete database and schema comparisons, participating schema-13 tables, indexes, and row-level contracts) together in one bounded round.
Handed back for independent senior review.

**Accepted work and authorizations preserved:**
- Both local ad hoc installer DMGs (`NEW-schema13-36a7b39-adhoc.dmg`, `OLD-schema12-2a6a415-adhoc.dmg`) remain accepted and unchanged (`b3ead813…` and `ddb0594e…`); nothing was rebuilt, rebundled, re-signed, or retagged.
- Authorizations for test account `hfdtest` (UID 502, standard non-admin), synthetic disposable test data, and local ad hoc candidates remain respected.
- Installed gates G1–G3 remain **UNEXECUTED / UNVERIFIED** — they require physical execution by a human operator logged into the `hfdtest` macOS desktop session.
- The post-receipt recovery subcase remains blocked/source-covered; its proposed fault-injection seam was not implemented.
- Previous evidence packs remain preserved byte-for-byte.

---

## 1. Starting State Verification

- Evaluated upstream review documents from `origin/main` at commit `79fd8c5` (`docs/MAC_SCHEMA13_OPERATOR_REVIEW_2026-10-09.md`, `docs/MAC_SCHEMA13_OPERATOR_FINISH_PROMPT_2026-10-09.md`, and reviewer evidence pack).
- The dirty local checkout at `/Users/rickymac/code/Flight-training-` (HEAD `36a7b39`) was preserved without pulling, resetting, stashing, or overwriting.
- **Manifest of 30 submitted paths from the 2026-10-09 review:**
  - 29/30 paths match the frozen submitted hashes byte-for-byte (`receipts/anchor-verification.txt`).
  - The single modified file is `scripts/mac-schema13-profile-snapshot.mjs`, which incorporates the MACV-R8 full-comparison enhancements.
- **13 Production Source Anchors:**
  - 13/13 production source anchors match `source-hashes.json` byte-for-byte. No application source code, migrations, configs, or package lockfiles were altered.
- **Accepted Candidate Installers:**
  - `NEW-schema13-36a7b39-adhoc.dmg`: `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334`
  - `OLD-schema12-2a6a415-adhoc.dmg`: `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62`

---

## 2. Issue-to-Fix Map: MACV-R7 & MACV-R8

| ID | Issue Description | Root Cause in Review Baseline | Implementation Fix | Test Name(s) |
|---|---|---|---|---|
| **R7-1** | Output directories in `/Users/Shared/...` kit owned by UID 501, not writable by UID 502 | Kit had single root for inputs and outputs | Defined separate `HFD_WORKSPACE` (`/Users/hfdtest/Downloads/hfd-schema13-workspace`) owned by UID 502. Updated `env.sh`, `hfd-operator.sh`, and `RUNBOOK-G1-G3.md`. Verified read-only kit inputs remain untouched. | `operator-diagnostics.py` / `hfd-operator-selftest.sh` (`refuses-paths-outside-policy`) |
| **R7-2** | Backup-permission restoration broken by whitespace in "Application Support" | Shell IFS whitespace splitting on record path (`read -r path mode`) | Implemented versioned key-value record `hfd-backup-mode-record/1` (`CANONICAL_PATH=...`, `ORIGINAL_MODE=...`, `RUN_ID=...`, `OP_ID=...`, `DEV_INO=...`), parsed with `IFS='=' read -r key val`. Preserves full path with spaces and exact mode. | `operator-diagnostics.py`: `unblock round-trips a path with Application Support spaces`, `unblock-backups-mode-0750` |
| **R7-3** | Repeated backup blocking or recovery breaks or clobbers records | Stale record detection missing, mode overwrites | Enforces refusal if already write-blocked (`mode 500`), generates unique timestamped+sequenced records (`_${seq}`), provides idempotent repeated recovery, validates directory `dev:inode` to reject replacement directories. | `operator-diagnostics.py`: `repeated block refuses`, `repeated unblock is safe idempotent`, `replacement directory is rejected` |
| **R7-4** | `dseditgroup` exit 2 treated as standard non-admin account | `dseditgroup` error codes were not checked strictly | `dseditgroup` returncode 1 is strictly required for non-admin confirmation. Exit 0 (admin member) and exit 2 or non-zero (inspection error) fail closed with exit 2. All mutating commands (`move`, `copy`, `block-backups`, `unblock-backups`) enforce this. | `operator-diagnostics.py`: `account-inspection failure must refuse before copying`, `admin-member must refuse before copying` |
| **R7-5** | Path traversal, symlinks, and clobbering not fail-closed across all mutations | Incomplete containment checks | Full containment validation within canonical policy roots (`APPROVED_ROOT` or `PROFILES_DIR`). Rejects `..` traversal, symlink sources, symlink destination parents, dangling symlinks, existing destinations, and self-nesting. | `operator-diagnostics.py`: `dot-dot operands cannot escape`, `symlink source cannot escape`, `symlink destination parent cannot escape`, `refuses existing destination` |
| **R7-6** | Walkthrough lacked explicit relaunch, unmount guarantees, and abort recovery test | Ambiguous human steps in runbook | Overhauled `RUNBOOK-G1-G3.md`: explicit OLD relaunch after initial quit, stopped app checks before snapshots/switches, explicit task mountpoints (`hdiutil attach -mountpoint`) with DMG identity checks and guaranteed detach trap, clear pre-receipt abort test followed by successful retry. | `RUNBOOK-G1-G3.md` (and kit `README-START-HERE.md`) |
| **R8-1** | Helper ignored schema-13 table contents in full comparison verdicts | `compare()` omitted schema-13 tables from unchanged checks | Added schema-13 tables (`material_split_lineage`, `split_operation_log`) to `unchanged` comparison. Compares row counts, framed cell digest, column order, and primary keys. Added operation or lineage rows trigger FAIL. | `helper-diagnostics.mjs`: `an added pending operation cannot pass unchanged`, `an added lineage row cannot pass unchanged` |
| **R8-2** | Helper ignored altered, added, or missing indexes and schema objects | Schema comparison only checked table names or loose counts | Expanded snapshot schema to `hfd-mac-profile-snapshot/3` with per-object type and definition anchors. Normalizes and validates exact SQL definitions. Verifies all 6 migration 0013 objects (2 tables + 4 indexes) against shipped SQL. Altered/missing indexes trigger FAIL. | `helper-diagnostics.mjs`: `changed schema objects cannot pass unchanged`, `upgrade requires all indexes actually created by 0013`, `restore requires all indexes actually created by 0013` |
| **R8-3** | Upgrade contract accepted non-empty 0013 tables or missing migration 0013 set | Loose upgrade contract | `upgrade` requires genuine 12→13 ledger transition, empty initial schema-13 tables, and the complete 0013 addition set with definitions matching shipped migration. | `helper-diagnostics.mjs`: `real populated schema12 to real schema13 upgrade passes`, `upgrade requires all indexes actually created by 0013` |
| **R8-4** | Restore contract did not verify absence of residual lineage/operation rows | Restore contract checked only retained tables | `restore` requires migrated schema-13 structure, matching schema definitions, and explicit zero rows (`rowCount === 0`) in `material_split_lineage` and `split_operation_log`. | `helper-diagnostics.mjs`: `restore requires all indexes actually created by 0013` |

---

## 3. Test Suites, Baseline Reproduction, and Final Results

### Baseline Reproduction vs Final Results

| Suite / Diagnostic | Review Baseline (2026-10-09) | Final Corrections (2026-10-10) | Status |
|---|---|---|---|
| Reviewer Operator Diagnostics (`operator-diagnostics.py`) | **4 FAILURES**, 2 passed (exit 1) | **21 PASSED**, 0 failed (exit 0) | **RESOLVED** |
| Reviewer Helper Diagnostics (`helper-diagnostics.mjs`) | **5 FAILURES**, 2 passed (exit 1) | **7 PASSED**, 0 failed (exit 0) | **RESOLVED** |
| Helper Self-Check (`mac-schema13-profile-snapshot.mjs self-check`) | 74 passed, 0 failed (`v2`) | **86 PASSED**, 0 failed (`v3`, exit 0) | **RESOLVED** |
| Prior Frozen Diagnostics (`diagnostics.mjs`) | 10 passed, 0 failed | **10 PASSED**, 0 failed (exit 0) | **PRESERVED** |
| Operator Script Selftest (`hfd-operator-selftest.sh`) | 15 passed, 0 failed (`v1`) | **22 PASSED**, 0 failed (`v2`, exit 0) | **EXPANDED & PASSED** |
| Revert Sensitivity (`revert-sensitivity.py` / `.sh`) | N/A | **7 MUTATIONS FLIPPED TO FAIL (`allFlippedToFail: true`)** | **VERIFIED** |
| Production Anchors & Manifest (`verify-anchors.sh`) | 13 anchors matched | **13/13 anchors match, 29/30 submitted match** | **VERIFIED** |
| Staged Kit Transfer (`shasum -a 256 -c TRANSFERSHA256SUMS.txt`) | 10/10 matched | **10/10 matched (all OK, exit 0)** | **VERIFIED** |

---

## 4. Revert Sensitivity Verification

To prove test harness sensitivity, `revert-sensitivity.py` mutates 7 individual production safety checks and asserts that the targeted diagnostic assertion flips from PASS to FAIL.

| Mutation ID | Domain | Reverted Implementation | Targeted Diagnostic Assertion | Flipped to Fail? |
|---|---|---|---|---|
| **R7-M1** | MACV-R7 | `dseditgroup` exit 2 treated as non-admin | `[MACV-R7] account-inspection failure must refuse before copying` | **YES** |
| **R7-M2** | MACV-R7 | Traversal components (`..`) allowed in source path | `[MACV-R7] dot-dot operands cannot escape the profiles directory` | **YES** |
| **R7-M3** | MACV-R7 | Symlink destination parent allowed to escape policy root | `[MACV-R7] a symlink destination parent cannot escape the policy root` | **YES** |
| **R7-M4** | MACV-R7 | Whitespace splitting used for backup mode record parsing | `[MACV-R7] unblock round-trips a path with Application Support spaces` | **YES** |
| **R8-M1** | MACV-R8 | Schema-13 table content digests omitted from unchanged contract | `[MACV-R8] an added pending operation cannot pass unchanged` | **YES** |
| **R8-M2** | MACV-R8 | Migration 0013 index set omitted from upgrade contract | `[MACV-R8] upgrade requires all indexes actually created by 0013` | **YES** |
| **R8-M3** | MACV-R8 | Migration 0013 index set omitted from restore contract | `[MACV-R8] restore requires all indexes actually created by 0013` | **YES** |

Result: `{"totalReverts": 7, "allFlippedToFail": true}` (`receipts/revert-sensitivity.json`).

---

## 5. Staged Kit Manifest and Transfer Verification

Staged Kit Location: `/Users/Shared/hfd-schema13-kit-2026-10-08/`
The input kit directories and files remain owned by UID 501 and readable by UID 502 (`mode 0755` / `0644`).
Task outputs are routed to `HFD_WORKSPACE` (`/Users/hfdtest/Downloads/hfd-schema13-workspace`).

### Staged Kit Hashes (`TRANSFERSHA256SUMS.txt`)
```text
3fa608a0d0cb7d2f9ee805d7cb6a382d56a2bb0f68ebfe940c30a4421b5ca9b5  ./bin/hfd-operator.sh
6ce92a8385dae4ba3974bebe2533ba7fb5ca8ff39fa4109db8935cbb6dc61d69  ./bin/mac-schema13-profile-snapshot.mjs
df5dd0c9955fa2eec4cce63fbb51a5c6ee16ea577cce140c885fa21d15db5e13  ./README-START-HERE.md
b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d  ./fixtures/synthetic-illustrated-charts.pdf
0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1  ./fixtures/synthetic-long-manual.pdf
f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134  ./fixtures/synthetic-small-checklist.pdf
ec8df7902d1d055452fcf17b9fe7926e8557ea6ca818cc65aeaeaa3f596b46ef  ./env.sh
d5101e8c58c70c21943295bb22ec5c88394c8db81aeec402bd8f7836612e1f99  ./packet/02-flashcards-and-test.json
b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334  ./installers/NEW-schema13-36a7b39-adhoc.dmg
ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62  ./installers/OLD-schema12-2a6a415-adhoc.dmg
```
All 10 transferred files verified with `shasum -a 256 -c`: 10/10 OK (`receipts/kit-transfer-verify.txt`).

---

## 6. Human Execution Guide for Gates G1–G3 inside `hfdtest`

A human operator must log into the `hfdtest` desktop session (UID 502) to perform physical verification of gates G1–G3.
The complete executable walkthrough is staged at `/Users/Shared/hfd-schema13-kit-2026-10-08/README-START-HERE.md` and repository copy `docs/evidence/mac-schema13-operator-corrections-2026-10-10/RUNBOOK-G1-G3.md`.

### Summary of Human Steps:
1. **Login & Session Preparation:**
   - Log into macOS as standard user `hfdtest` (UID 502).
   - Open Terminal and source the environment:
     ```bash
     source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh
     ```
   - Verify environment and task workspace:
     ```bash
     mkdir -p "$HFD_PROFILES" "$HFD_EVIDENCE"
     "$HFD_OPERATOR" stopped
     ```
2. **Mounting DMGs (No Finder Clutter):**
   - Mount NEW and OLD candidates to task-owned mountpoints with DMG identity checks and trap detach:
     ```bash
     mkdir -p "$HFD_WORKSPACE/mnt/new" "$HFD_WORKSPACE/mnt/old"
     hdiutil attach "$HFD_KIT/installers/NEW-schema13-36a7b39-adhoc.dmg" -mountpoint "$HFD_WORKSPACE/mnt/new" -nobrowse -readonly
     hdiutil attach "$HFD_KIT/installers/OLD-schema12-2a6a415-adhoc.dmg" -mountpoint "$HFD_WORKSPACE/mnt/old" -nobrowse -readonly
     ```
3. **Gate G1 — Clean Install & Baseline Population (OLD Schema 12):**
   - Install OLD app into `$HFD_WORKSPACE/apps/OLD.app`.
   - Launch OLD app, create schema-12 baseline data, import synthetic fixtures (`synthetic-illustrated-charts.pdf`, `synthetic-long-manual.pdf`, `synthetic-small-checklist.pdf`, `02-flashcards-and-test.json`).
   - Quit OLD app (`Cmd-Q`), confirm stopped with `"$HFD_OPERATOR" stopped`.
   - Take snapshot `01-old-populated.json`:
     ```bash
     node "$HFD_SNAPSHOT_HELPER" snapshot --out "$HFD_EVIDENCE/01-old-populated.json"
     ```
   - Relaunch OLD, perform study activity, quit OLD, verify unchanged baseline comparison:
     ```bash
     node "$HFD_SNAPSHOT_HELPER" compare --purpose unchanged --before "$HFD_EVIDENCE/01-old-populated.json" --after "$HFD_EVIDENCE/02-old-poststudy.json" --json "$HFD_EVIDENCE/g1-unchanged-compare.json"
     ```
4. **Gate G2 — Upgrade to Schema 13 (NEW App):**
   - Install NEW app into `$HFD_WORKSPACE/apps/NEW.app`.
   - Launch NEW app on the schema-12 profile to trigger migration 0013.
   - Quit NEW app (`Cmd-Q`), confirm stopped with `"$HFD_OPERATOR" stopped`.
   - Take snapshot `03-new-upgraded.json`:
     ```bash
     node "$HFD_SNAPSHOT_HELPER" snapshot --out "$HFD_EVIDENCE/03-new-upgraded.json"
     ```
   - Verify upgrade contract:
     ```bash
     node "$HFD_SNAPSHOT_HELPER" compare --purpose upgrade --before "$HFD_EVIDENCE/01-old-populated.json" --after "$HFD_EVIDENCE/03-new-upgraded.json" --json "$HFD_EVIDENCE/g2-upgrade-compare.json"
     ```
5. **Gate G3 — Backup, Restore, and Abort Recovery:**
   - Test pre-receipt intentional backup failure:
     ```bash
     "$HFD_OPERATOR" block-backups
     ```
   - Attempt backup in UI, verify clean failure.
   - Restore permissions and prove data intact:
     ```bash
     "$HFD_OPERATOR" unblock-backups
     node "$HFD_SNAPSHOT_HELPER" snapshot --out "$HFD_EVIDENCE/04-post-unblock.json"
     node "$HFD_SNAPSHOT_HELPER" compare --purpose unchanged --before "$HFD_EVIDENCE/03-new-upgraded.json" --after "$HFD_EVIDENCE/04-post-unblock.json" --json "$HFD_EVIDENCE/g3-unblock-compare.json"
     ```
   - Complete backup successfully, perform restore, and verify restore contract:
     ```bash
     node "$HFD_SNAPSHOT_HELPER" compare --purpose restore --before "$HFD_EVIDENCE/01-old-populated.json" --after "$HFD_EVIDENCE/05-restored.json" --json "$HFD_EVIDENCE/g3-restore-compare.json"
     ```
6. **Cleanup:**
   - Detach DMGs and clean up temporary mounts.

---

## 7. Disposition and Scope Boundary

- **Work Completed**: MACV-R7 and MACV-R8 preparation fixes are implemented and verified in preparation suites.
- **Current State**: Implemented, pending independent review.
- **Installed Gates Status**: G1–G3 remain unexecuted and unverified.
- **Post-Receipt Recovery**: Remains blocked / source-covered.
- **Repository Integrity**: Changes remain uncommitted and unpushed in `/Users/rickymac/code/Flight-training-` for senior review.
