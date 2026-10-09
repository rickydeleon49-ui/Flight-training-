# Split lineage integration and workspace cleanup — 8 October 2026

**Outcome: integrate the accepted split-lineage source and preserve the 980-file local backlog without losing work.** The containing PR supplies the exact-head CI and merge identity. This is source integration, not Mac release acceptance.

## Acceptance verification

The independent source review was finalized in `split-lineage-source-review`. Codex checked all 35 submitted source hashes, 32 implementation checksums and 24 review-pack checksums against the actual files. The final scope hash is `6352f00992be94b4df2836240afe042395809a50811a32ec16d453c0819acd9b`; migration 0013 is byte-identical to its round-5 candidate (`4118a7896c501ae06a5dbe739c89ba084d72c5b928b4bc15c7c7f2c601c6b106`). Source/receipt/save/cancel and direct/nested read paths were inspected. The two disclosed decisions remain accepted: browser drivers read/refuse/validate restore but do not split, and refused saves reconcile before cancellation.

The PR publishes production code, the scope/review chain through round 5, scope acceptance, recorded owner approval/decisions, implementation evidence and independent source review/acceptance together. Earlier historical status entries are retained. The scope-acceptance erratum is recorded here: round 5 MUTANT-12 targets `lineageContract.mjs`, not `proof.test.mjs`; immutable historical receipts are unchanged. Main's earlier SL-R1–R3 history entry is retained.

## Bounded F-1 correction

The pre-existing `documents.rs::tests::split_test_root` used PID plus wall-clock nanoseconds, permitting concurrent tests to share a directory. Integration adds an atomic per-process sequence to the same test-only name. No shipping path or database semantics change. Original source manifests/evidence remain immutable; the integration pack records the resulting source hashes separately. This resolves F-1 rather than weakening parallel CI or globally serializing tests.

## Verification

See `docs/evidence/m2-split-lineage-integration-2026-10-08/receipts/` for independent integration commands and raw exit codes. The final results are recorded in the pack README. Native tests run at default parallelism, including the full suite and a bounded repeat of the affected documents tests. Formatting, Clippy, build/typecheck and lockfile checks are part of the integration check.

The independent prior source review's full frontend result (2,862 passed / 5 skipped) and source sensitivity results are reused for unchanged feature code. Codex does not claim to have rerun that entire local frontend matrix or all sensitivity mutations; the integration PR's GitHub check runs the current source matrix again.

## The 980 changes and recoverability

These were five separate worktree backlogs, not 980 unreviewed application edits:

| Original checkout | Changed paths | Preservation branch |
| --- | ---: | --- |
| `Flight-training-` | 7 | `codex/archive-2026-10-08-primary-setup` |
| `Flight-training-pr70-integration` | 510 | `codex/archive-2026-10-08-c2-planning` |
| `Flight-training-c2-implementation` | 121 | `codex/archive-2026-10-08-c2-source` |
| `Flight-training-split-lineage-scope` | 274 | `codex/archive-2026-10-08-lineage-scope` |
| `Flight-training-split-lineage-implementation` | 68 | `codex/archive-2026-10-08-lineage-source` |
| **Total** |**980**| **All preserved locally** |

Each backlog was committed to its own local preservation branch, with every changed file's SHA-256 verified after the commit. No reset, stash, discarded edits or deleted worktree was used. These preservation branches are backups, not accepted main changes; unreviewed primary agent-setup differences were not smuggled into production. Snapshot identities and hashes are retained in this integration evidence pack. Build/dependency caches remain ignored and untouched by source cleanup. Secondary checkouts are clean archival states; future active work should start from the primary clean main checkout after merge.

Raw reviewer directories remain as local references, and their relevant authority/evidence files are published. All files in the original source-review pack, including the final sentinel-free flake receipt, remain byte-identical.

## Next step and remaining limits

The next assignment is `docs/MAC_SCHEMA13_VERIFICATION_PROMPT_2026-10-08.md`. It covers the three outstanding installed Mac checks: Apple Silicon smoke, upgrade over a populated schema12 fixture library, and older-backup restore/newer-backup refusal. Run only in an approved isolated test account/device/profile, using synthetic data. No everyday application data is authorized for tests. A source acceptance or cleanup does not imply these checks passed, signing credentials exist, or public publication is approved.

Signing, notarization, release version and installer publication remain separate owner decisions. Do not reuse or replace the frozen historical v0.5.3 installer. Earlier planning/source assignments are completed or historical after this integration; do not rerun them or start another lineage implementation.

Standalone local backup: `/Users/rickymac/code/Flight-training-backups/2026-10-08-local-work.bundle`; verify it with `git bundle verify` before restoration. Local preservation refs are listed in the evidence manifest.

Reviewed evidence and the hash-frozen scope contain raw-output whitespace. `.gitattributes` exempts only the specific immutable paths that triggered whitespace checks; production code and new reports retain normal whitespace checks. No historical receipt is rewritten.
