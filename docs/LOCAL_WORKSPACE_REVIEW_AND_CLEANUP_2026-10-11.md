# Local workspace review and cleanup — 11 October 2026

## Current project state

Audited accepted main at `8a260c0b32bc213850ed85bf9488d6ef571354a9`.

- M3 is integrated through PR #140; accepted source ships schema 14.
- [PR #142](https://github.com/rickydeleon49-ui/Flight-training-/pull/142) installed evidence, [PR #143](https://github.com/rickydeleon49-ui/Flight-training-/pull/143) practice-date/restore-baseline fixes and [PR #146](https://github.com/rickydeleon49-ui/Flight-training-/pull/146) Notes local-day fix are merged.
- PR #142 documents synthetic schema12→13 tests in the owner-authorized administrator account. Its original strict restore comparison and malformed-date failures remain historical evidence. It does not verify a current schema-14 installer, standard-account isolation, mid-save failure, signing or public-release readiness.
- Gemini is actively working in the M4 evaluation checkout. [PR #148](https://github.com/rickydeleon49-ui/Flight-training-/pull/148), head `3039d7807be3bc859812565ee7f606da2d9314c3`, is an open documentation handoff with passing CI. Its reviewer requests M4-R23–R27: durable ownership across restarts/controllers, original retry ownership, truthful test/mutant traceability, missing lifecycle regressions and measured runner receipts. Those findings are attributed to that review; this cleanup did not independently rerun its reproductions or accept the in-flight source.
- The source-only [schema-14 verification preparation assignment](MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md) remains available. No competing assignment or implementation was started.

## Cleanup completed

The primary checkout was stranded at `42c2df5` by four unpublished preflight entries. All 15 affected files were hash-checked and copied to a recovery archive. Their exact working state was committed on `codex/archive-local-preflight-2026-10-11` at `a3f2ce80147b3df445b80290e2ba83833b602f7e`, with a separately verified Git bundle. Main was then fast-forwarded to `8a260c0`; tracked/untracked status is clean.

Four retired checkouts were removed only after confirming clean status, exact archived branch heads, no process working directories inside them, and a verified independent Git bundle:

| Removed checkout | Retained recovery branch |
| --- | --- |
| Flight-training-c2-implementation | codex/archive-2026-10-08-c2-source |
| Flight-training-pr70-integration | codex/archive-2026-10-08-c2-planning |
| Flight-training-split-lineage-implementation | codex/archive-2026-10-08-lineage-source |
| Flight-training-split-lineage-scope | codex/archive-2026-10-08-lineage-scope |

These had about 20 GB of checkout footprint, mostly disposable dependency/build caches. Available filesystem space increased by 16,555,880,448 bytes during cleanup; APFS and concurrent activity mean this is an observed difference, not an exact attribution.

Before removing the old integration checkout, 36 useful ignored files were copied and hash-verified, including its existing v0.5.3 DMG, executable, packaging assets and historical receipts. This preserves those local bytes; it does not attest that this installer is a release-approved candidate. No release artifact was rebuilt, overwritten or retargeted.

Recovery folder: the local `Flight-training-backups/local-cleanup-2026-10-11/` archive. Restore a retired source checkout with `git worktree add <new-path> <retained-branch>`; reinstall generated dependencies as needed. Restore retained ignored artifacts from `ignored-preserved/<checkout-name>/` only when needed.

## Historical evidence and boundaries

The unpublished October 10 preflight report and raw receipts remain byte-identical in the local recovery archive and recovery commit. That session did not execute installed gates; its resume wording does not override later owner decisions. The later [October 11 installed report](MAC_INSTALLED_RESULTS_2026-10-11.md) records what actually ran. Detailed filesystem inventories, machine/account receipts and installers stay local; this PR publishes only the cleanup summary.

Gemini's M4 checkout, dirty M3 scope/implementation and reviewer handoff checkouts, and the open PR #148 branch were preserved. No reset, stash, clean, app-data deletion, account access, shared-kit changes, installer execution or security-setting change was performed. No overlapping test matrix was launched. Review/checks for this documentation-only change are checksums, recovery refs/bundles and whitespace hygiene.

The cleanup report is published for the current Git coordinator; this task does not merge or replace the active M4 handoff.

Validation: 15 primary backup copies and 36 retained ignored files verified by SHA-256; original 11-entry historical receipt manifest verified; both recovery bundles verified; retained archive refs matched; primary is clean and equals origin/main. No application suite was rerun for this documentation-only task.
