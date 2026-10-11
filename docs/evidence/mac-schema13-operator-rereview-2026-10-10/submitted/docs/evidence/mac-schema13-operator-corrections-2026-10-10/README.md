# Mac schema-13 operator and full-comparison corrections — evidence pack (2026-10-10)

Closes **MACV-R7** (operator permissions, recovery, fail-closed path/account checks, human walkthrough) and **MACV-R8** (complete database and schema comparisons, schema-13 table/index/ledger contracts).
MACV-R3 remains accepted and untouched: both local ad hoc installers are the same bytes verified previously, and nothing was rebuilt, rebundled, or re-signed.
Report: `docs/MAC_SCHEMA13_OPERATOR_CORRECTIONS_2026-10-10.md`.
**G1–G3 remain UNEXECUTED / UNVERIFIED** — they require a human operator in the `hfdtest` (UID 502) desktop session.

## What this pack is

| Path | Purpose |
| --- | --- |
| `RUNBOOK-G1-G3.md` | The corrected standalone human walkthrough. Staged verbatim as `/Users/Shared/hfd-schema13-kit-2026-10-08/README-START-HERE.md`. Includes separate UID 502 task workspace under `HFD_WORKSPACE`, explicit relaunch of OLD after initial quit, stopped app checks before snapshots/switches, explicit task mountpoints with identity checks and guaranteed detach, pre-receipt abort recovery test followed by successful retry. |
| `env.sh` | Kit environment defining `HFD_WORKSPACE` (`/Users/hfdtest/Downloads/hfd-schema13-workspace` by default) with separate `profiles` and `evidence` subdirectories, separating readable kit inputs from UID 502 outputs. Staged as `<kit>/env.sh`. |
| `hfd-operator.sh` | Validated profile switches + permission restoration (`stopped`, `status`, `move`, `copy`, `block-backups`, `unblock-backups`). Enforces trusted absolute inspector paths, fail-closed account inspection (dseditgroup exit 2 refused), traversal/symlink escape rejection, clobber protection, self-nesting protection, and whitespace-safe versioned key-value backup mode record (`hfd-backup-mode-record/1`). Staged as `<kit>/bin/hfd-operator.sh`, mode 0755. |
| `hfd-operator-selftest.sh` | Permanent self-test for `hfd-operator.sh`, run against disposable scratch environments. Verifies 22 distinct cases. |
| `operator-diagnostics.py` | Promoted operator test suite covering all 6 original reviewer diagnostics + 15 extended edge cases (21/21 pass). |
| `helper-diagnostics.mjs` | Promoted helper comparison diagnostics covering real schema 12 to 13 upgrade, unchanged schema 13, added operation, added lineage, changed schema objects, and missing 0013 index sets (7/7 pass). |
| `revert-sensitivity.py` / `.sh` | Automated mutation runner flipping 7 key production checks to verify test harness sensitivity (7/7 flipped to fail). |
| `verify-anchors.sh` | Verifies the 13 production source anchors, the 30 submitted paths from the 2026-10-09 review, accepted installer hashes, and byte-for-byte preservation of prior evidence. |

`scripts/mac-schema13-profile-snapshot.mjs` in the repository is the corrected helper itself (schema `hfd-mac-profile-snapshot/3` with per-object type and definition anchors, 86/86 self-checks passing); the staged kit carries a byte-identical copy (`receipts/kit-transfer-manifest.txt`).

## Receipts

| File | Contents |
| --- | --- |
| `anchor-verification.txt` | 13/13 production source anchors match; 29/30 submitted paths match (only `scripts/mac-schema13-profile-snapshot.mjs` updated); accepted installer hashes verified; prior evidence SHA256SUMS intact. |
| `frozen-10-diagnostics.json` + `.stderr` | The frozen 10 reviewer helper diagnostics: **10/10 pass, exit 0**. |
| `helper-diagnostics.json` + `.stderr` | Promoted reviewer helper diagnostics: **7/7 pass, exit 0**. |
| `kit-transfer-manifest.txt` + `kit-transfer-verify.txt` | Staged kit's 10 transferred files with SHA256 hashes, verified with `shasum -a 256 -c`: all 10 `OK`, exit 0. |
| `operator-diagnostics.json` + `.stderr` | Promoted operator test suite: **21/21 pass, exit 0**. |
| `operator-selftest.json` + `.progress.txt` | Operator script self-test against staged kit: **22/22 cases pass, exit 0**. |
| `revert-sensitivity.json` | 7 mutations across R7 and R8: **all 7 flipped to fail (`allFlippedToFail: true`)**. |
| `selfcheck-final.json` + `.stderr` | Corrected helper self-check (`hfd-mac-profile-snapshot-selfcheck/3`): **86 checks, 86 pass, exit 0**. |

## Boundary and Reproduction

* No application source, migration, config, lockfile, release setting or candidate artifact was changed.
* Only `scripts/mac-schema13-profile-snapshot.mjs`, `docs/evidence/mac-schema13-operator-corrections-2026-10-10/`, staged kit files (`bin/hfd-operator.sh`, `bin/mac-schema13-profile-snapshot.mjs`, `env.sh`, `README-START-HERE.md`), and tracking documentation changed.
* Nothing was launched in production. No GUI flow ran; no everyday profile was read or modified.
* Run focused checks using Node 22.23.3:
  - `node scripts/mac-schema13-profile-snapshot.mjs self-check`
  - `node docs/evidence/mac-schema13-operator-corrections-2026-10-10/helper-diagnostics.mjs`
  - `node /Users/rickymac/code/.qwen/tmp/macv2/diagnostics.mjs scripts/mac-schema13-profile-snapshot.mjs`
  - `python3 docs/evidence/mac-schema13-operator-corrections-2026-10-10/operator-diagnostics.py`
  - `bash docs/evidence/mac-schema13-operator-corrections-2026-10-10/hfd-operator-selftest.sh /Users/Shared/hfd-schema13-kit-2026-10-08`
  - `bash docs/evidence/mac-schema13-operator-corrections-2026-10-10/revert-sensitivity.sh`
  - `bash docs/evidence/mac-schema13-operator-corrections-2026-10-10/verify-anchors.sh`
