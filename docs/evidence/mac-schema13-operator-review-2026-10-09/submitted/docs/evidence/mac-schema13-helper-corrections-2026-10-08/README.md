# Mac schema-13 helper + operator-kit corrections — evidence pack (2026-10-08)

Closes **MACV-R4, MACV-R5 and MACV-R6**. MACV-R3 is accepted and untouched: both local ad hoc
installers are the same bytes the re-review verified, and nothing was rebuilt, rebundled or re-signed.
Report: `docs/MAC_SCHEMA13_HELPER_CORRECTIONS_2026-10-08.md`.
**G1–G3 remain UNEXECUTED / UNVERIFIED** — they need a person in the `hfdtest` desktop session.

## What this pack is

| Path | Purpose |
| --- | --- |
| `RUNBOOK-G1-G3.md` | The standalone human walkthrough. Staged verbatim as `/Users/Shared/hfd-schema13-kit-2026-10-08/README-START-HERE.md`. Quit-before-every-snapshot, one purpose per gate, corrected nested C2 coordinates, no placeholders in executable commands. |
| `env.sh` | Kit environment (absolute task variables only; never assigns `HOME`/`CODEX_HOME`). Staged as `<kit>/env.sh`. |
| `hfd-operator.sh` | Validated profile switches + permission restore (`stopped`, `status`, `move`, `copy`, `block-backups`, `unblock-backups`). Staged as `<kit>/bin/hfd-operator.sh`, mode 0755. |
| `hfd-operator-selftest.sh` | Permanent self-test for that script, run against a throwaway kit copy. |
| `revert-sensitivity.sh` | Reverts one production behaviour at a time and asserts the named self-check **and** frozen-review assertion flip to failure. |
| `verify-anchors.sh` | Re-verifies the 28 frozen submitted hashes, the 13 production anchors, the accepted candidates and the exact working-tree state. |

`scripts/mac-schema13-profile-snapshot.mjs` in the repository is the corrected helper itself; the kit
carries a byte-identical copy (`receipts/kit-transfer-manifest.txt`).

## Receipts

| File | Contents |
| --- | --- |
| `rereview-frozen-diagnostics-original-failing.json` | The reviewer's own frozen harness **before** this round: 3 controls pass, **7 failures**, exit 1. Copied from `origin/main` unmodified; the original failing receipt. |
| `rereview-selfcheck-original.json` | The submitted helper's self-check as the reviewer ran it: 8/8 pass **despite** `pgrep: Cannot get process list` — the missing fail-closed coverage. |
| `diagnostics-final.json` + `.stderr` | The same frozen harness against the corrected helper: **10/10 pass, exit 0**. |
| `frozen-diagnostics-hash.txt` | `14c40581…` — matches the reviewer pack's published `SHA256SUMS` entry, proving the harness ran unmodified. |
| `selfcheck-final.json` + `.stderr` | Corrected helper's self-check: **74 checks, 74 pass, allPassed true, exit 0**. |
| `determinism.txt` | Three consecutive runs of each harness. Self-check stdout is now byte-identical across runs (its scratch root is redacted to `<scratch>`; every verdict is real); the frozen harness is byte-identical too. |
| `revert-sensitivity.json` + `.progress.txt` + `revert-sensitivity-notes.md` | Eleven reverted behaviours: which named assertion broke in which harness, plus honest reading of the two cases where the harnesses do not bite. |
| `operator-selftest.json` + `.progress.txt` | 15 kit-script cases: every refusal, both happy paths, and proof that refused operations left both profiles intact and nothing nested. |
| `kit-transfer-manifest.txt` + `kit-transfer-verify.txt` | The staged kit's 10 transferred files with full hashes, and `shasum -c` output: all `OK`, exit 0. Installer hashes equal the accepted MACV-R3 values; fixture and packet hashes equal the recorded ones. |
| `anchor-verification.txt` | 28 frozen hashes → **25 match**, the three differences being this round's own edits (`scripts/mac-schema13-profile-snapshot.mjs`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`); 13 production anchors → **13/13 match**; rejected originals still `6aecab86…` / `455eb12d…`; `staged=0`; toolchain versions. |
| `final-source-hashes.txt` | Final sha256 of every path this round produced or changed, plus the staged kit copies, so the reviewer can bind exact bytes. |

## Boundary and reproduction

* No application source, migration, config, lockfile, release setting or candidate artifact was changed.
  Only `scripts/mac-schema13-profile-snapshot.mjs` plus this documentation changed.
* Nothing was launched. No GUI flow ran anywhere; no everyday profile was read or redirected. Every
  `hfdtest` action in the walkthrough is still a human step, so no gate is marked passed here.
* Reproduce with node 22.23.3 from the repository root:
  `node scripts/mac-schema13-profile-snapshot.mjs self-check`
  `node <frozen-diagnostics.mjs> scripts/mac-schema13-profile-snapshot.mjs`
  `bash docs/evidence/mac-schema13-helper-corrections-2026-10-08/hfd-operator-selftest.sh /Users/Shared/hfd-schema13-kit-2026-10-08`
  `bash docs/evidence/mac-schema13-helper-corrections-2026-10-08/revert-sensitivity.sh "$PWD" <frozen-diagnostics.mjs>`
  `bash docs/evidence/mac-schema13-helper-corrections-2026-10-08/verify-anchors.sh "$PWD"`
* In this pack every file is listed in `SHA256SUMS` (20 entries) and none is caught by `.gitignore`, so
  a plain `git add` of the directory loses nothing. No new `-whitespace` exemption was needed: the scan
  in the correction report shows zero trailing-whitespace lines and zero CR bytes across the pack.
