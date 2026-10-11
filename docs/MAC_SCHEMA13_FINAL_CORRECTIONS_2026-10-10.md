# Mac verification final corrections — 10 October 2026

**Disposition: MACV-R9–R11 implemented, pending independent senior review.** G1–G3 remain UNEXECUTED/UNVERIFIED. The post-receipt recovery subcase remains BLOCKED/source-covered. This report is the current implementation handoff; it does not claim acceptance or installed results.

## Starting point and scope

Primary `/Users/rickymac/code/Flight-training-`, branch main, application HEAD36a7b39. Fetched origin/main178a911 and read the [assignment](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/MAC_SCHEMA13_OPERATOR_FINAL_CORRECTIONS_PROMPT_2026-10-10.md) and review without pulling/resetting/stashing/cleaning. **30/30 frozen paths matched before the first edit**, with no competing changes. Earlier27 frozen evidence/report/attribute files remain byte-identical; all13 production anchors and four original/corrected installer artifacts match. Only preparation helper/tooling/docs changed. No application rebuild, dependency, migration, signing, GUI launch, real-account test, provider call, push or commit occurred.

## Issue-to-fix map

| Finding | Final implementation | Meaningful proof |
|---|---|---|
| R9 shipped identity/path bypasses | `hfd-operator.sh` has fixed approved UID/account/root/workspace and absolute inspectors. No test-variable or PATH substitution or owner-skipping branches. All mutations validate real account, stopped apps, canonical nonsymlink paths and owner/writability. `prepare` and `new-run` refuse existing outputs. | Actual unmodified production entry refuses uid501 despite old override variables; controlled copies test wrong UID/name/owner, account/process errors, traversal/symlinks and preserved copy/move content. |
| R9 stale recovery | Records format2 belong to exact run and active operation, contain original octal mode and directory dev/inode, and are regular/single-link/user-owned. Active pointer chooses an explicit operation, not newest-file guessing. Required/duplicate fields, replacement directory and unrelated record refuse before chmod. Recovery completion markers permit same-operation repeats and subsequent new blocks without losing original modes. | Frozen cross-run case now refuses and preserves0550. 0700/0750 roundtrips, repeated block/recovery, missing/duplicate/wrong fields and replacement inode are covered. |
| R10 incomplete receipt PASS | Current-v3 validation requires consistent names/count/definitions/object list and per-object/aggregate digests; complete table columns/keys/inventory; complete SQLx rows/columns/count/digest, typed cells and success. Earlier formats cannot certify a complete PASS. Preserved schema definitions compare exact SQL bytes. | Both empty-definition frozen cases now refuse. 44 regressions cover incomplete facts and consistent positive controls. |
| R10 invalid restore ledger | Upgrade and restore both require exact1–12→1–13 sequence, unchanged prior rows, success1 and migration13's real SQLx SHA-384 checksum. Restore requires exactly13, not >=13. Scratch fixtures now use SQLx's actual ledger columns, success field and48-byte checksums, with a fixed synthetic installed timestamp. | Actual14-in-place-of13, success0 and wrong48-byte checksum each refuse/fail. Checksum pin matches shipped SQL bytes. Frozen genuine upgrade/restore controls pass. |
| R11 installation identity/cleanup | New `hfd-install-candidate.mjs` verifies approved account, stopped apps and owned run/app directories, fixed DMG hash before mounting and mounted executable hash before copying. Existing destinations/receipts/aliases refuse. Copies are checked, receipts are fresh, and detach is attempted in finally on success/failure/SIGINT/SIGTERM. Signals terminate only the spawned tool process group. Partial destination or detach failure is explicitly reported/preserved. | 15 mocked installation cases cover both OLD/NEW successes, bad DMG/mounted/copied hashes, attach/copy failures, inspector errors, existing/dangling paths, receipt preservation, symlink parent and interruption cleanup. No actual app install occurs. |
| R11 walkthrough | One canonical RUNBOOK staged as README. Correct accepted hashes, fixtureC import, launch/quit transitions, fresh-root check, per-run profile destinations, detailed coordinates/siblings/copy pages, archive identity, failure→recovery→successful retry. No conflicting executable report summary. | Runbook uses env's HFD_OP/HFD_HELPER/HFD_NODE/HFD_EVID and supported --json. Transfer11 verifies; human execution remains pending. |

The SQLx checksum/ledger implementation was verified from local installed `sqlx-core0.8.6/src/migrate/migration.rs` and `sqlx-sqlite0.8.6/src/migrate.rs`; no dependency resolution or production migration change. The source pin is `f126deadc4c31c153cd7dc3ac081a4cebe58bc2dbc260bcd386abc210e0d1fc22707bc7c7d62a73b9d124fdb625df03d`. It is checked against the unchanged0013 file in the permanent regression suite.

## Verification

| Check | Result |
|---|---|
| Reviewer failing baselines | Operator2 pass/2 fail and helper2 pass/3 fail, exit1, preserved separately |
| Reviewer final diagnostics | Operator4/4 with disclosed scratch-only adapter; helper5/5 |
| Previous frozen diagnostics | Helper10/10 and7/7 unchanged; operator6/6 with constant/locator adapter |
| Existing helper self-check |86/86 |
| Expanded operator coverage |47/47; retains prior21/22 behaviors in one consolidated suite rather than claiming the historical harnesses ran unchanged |
| New helper regressions |44/44 |
| Installation regressions |15/15 |
| Revert sensitivity |6/6 deliberately reverted safety boundaries fail meaningful assertions |
| Syntax |Bash and Node checks exit0 |
| Integrity |13 production anchors,27 earlier frozen evidence/report/attribute files,4 original/corrected DMGs unchanged; staged11-file manifest verifies |

Final12 focused/syntax checks plus transfer check exit0. Baseline failures are expected exit1, not suppressed. Exact command/cwd/stdout/stderr/exit are in `receipts/checks.json`. Exploratory receipts are retained separately. No broad app matrix was rerun.

### Test adapters and limits

Production files contain no test injection switches. Operator tests rewrite exact fixed paths/inspector bindings only in disposable copies; stat mocks supply controlled ownership while real inode/mode fields remain authoritative. The production no-bypass assertion runs the actual distributed file unmodified. The frozen operator6 adapter retains all assertions and only changes source locator/constants and fixture/run setup. The final reviewer4 adapter similarly keeps the production-entry refusal unmodified, then uses a copied script for positive/run-binding branches. Helper harnesses add exports/remove CLI dispatch in scratch copies, preserving function bodies. Installer fixtures replace constants/tool paths/checksum pins on copies, exercising actual copy/cleanup branches with owned synthetic payloads. These prove logic, not physical UID502 execution or actual Gatekeeper behavior.

## Staged kit and human handoff

Inputs remain `/Users/Shared/hfd-schema13-kit-2026-10-08/`, uid501-owned/readable; no blanket permission changes. Updated helper/operator/installer/env/runbook and11-entry manifest agree. Both accepted DMGs, three PDFs and packet remain unchanged. Output workspace policy is `/Users/hfdtest/Downloads/hfd-schema13-workspace`, created by **hfdtest** through guarded prepare; no actual workspace was provisioned in that account by this assignment.

After independent acceptance, the person logs into hfdtest, opens the staged README and follows its single chronological procedure: verify transferred hashes; prepare fresh workspace and explicitly named run; install OLD/NEW through the checked operator; run baseline, upgrade/splits, older-version refusal and genuine schema12 restore; preserve receipts/screenshots. Existing profiles/installations/outputs stop rather than being overwritten. Interrupted permission recovery resumes the original recorded run and operation. Do not substitute an everyday profile.

[Canonical human walkthrough](evidence/mac-schema13-final-corrections-2026-10-10/RUNBOOK-G1-G3.md) · [Evidence instructions](evidence/mac-schema13-final-corrections-2026-10-10/README.md). Work is uncommitted/unpushed on main at36a7b39; review must precede physical gate execution.
