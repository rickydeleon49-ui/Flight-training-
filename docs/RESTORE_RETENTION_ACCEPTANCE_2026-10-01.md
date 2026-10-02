# A1 restore retention — final independent acceptance

Date: 1 October 2026. Reviewer/Git coordinator: Codex. Repository: `rickydeleon49-ui/Flight-training-`.

## Decision

**Accept the shared A1 source and regression-test repair.** No blocker remains in this slice after the final test-oracle correction. Merge requires passing required GitHub checks on the exact reviewed PR head. This is not release approval, installed-platform evidence or closure of A2–A6.

Branch: `fix/restore-retention-restart-safety`. Base: `053af1fcd1429888300060f780a10d68adc81c5b`, equal to refreshed `origin/main` during review.

Reviewed hashes:

- `src-tauri/src/backup.rs`: `EB4F827F17E7EFE097B85817A4EAE8B08FAC654F1BD5FD48BEE9953A6934C5E3`.
- `src/pages/FlightJournal/debriefLinks.test.ts`: `58A01DCA1A942312BC7A45B47EADE0B30422ECCEF8CFDF71FA46C5C6F6856975`.

The seven earlier independent review notes retain their recorded hashes and dated decisions. No shipped migration, dependency, lockfile, archive representation, product version, bundle identifier, tag or release asset changed.

## Accepted behavior

Failed/interrupted restores retain recoverable original DB/WAL and documents. The scoped journal records phases, ownership and artifact identities so restart resumes safe rollback or completed cleanup without replaying installation. Unresolved/unverifiable states halt startup before database opening/migrations. Cleanup and retention must not prune unresolved original data.

Storage/artifact checks refuse unexpected links/reparse points and types, verify actual bytes/completeness, reject unknown ownership/content and distinguish permission/I/O errors from absence. Pending payload cleanup succeeds before its plan is removed; enumeration and payload errors preserve ownership. Genuine original and selected WAL remain distinct. SHM is regenerable cache rather than mandatory durable user data.

The last executable delta is test-only: a private fallible detector now checks actual `restore-journal.json.tmp-` siblings. Its negative control seeds a real-prefix file, detects it and clears after removal. Four direct journal-failure subcases retain prior canonical bytes/hash and verify replacement once faults clear. Production journal behavior was unchanged by this correction.

The debrief fixture uses a scoped Date-only clock with real async UI timers and reliable restoration. Existing lesson-link assertions remain. This setup removes calendar dependence; no separately executed post-fix 6 October host simulation is claimed.

Two inherited one-line script shebang removals are preserved. Script bodies and documented `node scripts/...` entrypoints are unchanged; the tracked files are non-executable mode 100644, and existing CLI/import tests remain in the full suite.

## Evidence and provenance

Evidence directory: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

| Check | Result |
| --- | --- |
| Final independent `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::task4_ -- --nocapture` | Exit 0; **18 passed**, 0 failed/ignored; 0.32 s. Includes corrected canonical check, seeded-file detector, WAL/document return faults and real Windows journal-lock recovery. `restore-review-round8-2026-10-01-task4-tests.log`. |
| Previous independent backup module | **143 passed** on round-seven source. The final change adds only the corrected private detector and negative-control test. |
| Previous independent debrief suite | **12 passed** on unchanged 58A source. |
| Final complete frontend log inspected | `task-2811.log`: **594 passed**, 4 skipped; 59 passing test files/3 skipped; 38.88 s. |
| Final complete Rust log inspected | `task-2823.log`: **262 passed**, 0 failed, 6 ignored; 30.77 s, including **144 backup tests**. |
| Final strict lint log inspected | `task-2819.log`: successful completion, zero warnings/errors; 18.07 s. Earlier `task-2634.log` is a historical failed run. |
| Remaining local gate | Implementer reports clean install, frontend typecheck/build, Rust formatting, lock synchronization, version policy and diff hygiene exit 0. Codex also records lightweight final checks. |

Implementer logs are under `C:\Users\ricky\.gemini\antigravity-ide\brain\feb3e8bd-8c54-4d2e-8c0e-ac7280c323a7\.system_generated\tasks`. Complete matrices were inspected rather than unnecessarily duplicated. Independent focused checks use the reviewed final hashes. No overlapping local matrices or speculative CI pushes were used.

Use actual source names: the handoff's four separately named `round5_interrupted...`/`round5_sync...` tests are not functions in source. Four write/sync occurrence subcases are inside `round5_journal_write_or_sync_failures_can_recover_on_restart`; the final full log also includes the actual legacy, original WAL/SHM protection and cleanup-lock functions.

The selected-WAL `InstallDbRename(1)` test has genuine WAL but fails before its move; it is install-move coverage. The separate `round2_legacy_restore_wal_is_not_mixed_with_returned_original` covers already-installed selected WAL recovery. Original return-failure tests assert blocked first launch, `RolledBackRecovered` after clearance and `ProceedNormally` afterward, with exact artifact identities and committed WAL-row conservation.

## Fixture hygiene

The deliberate failing negative-control run left one synthetic scratch directory despite the handoff claiming zero leftovers. Codex verified it was an unlinked child of the temporary root with only the known synthetic journal and nine-byte `unremoved` seed, saved the journal as evidence, and removed only that directory. No profile or user file was involved; this is evidence hygiene, not a product defect.

Removed fixture: `hfd-task4-prior-canonical-bytes-16800-1790912547233453800-0`; operation `restore-16800-1790912547233864800`. Snapshot: `restore-review-round8-negative-control-leftover-journal.json` in the evidence directory. Passing fixtures use explicit teardown; listing-denial tests restore isolated ACLs. No review source mutation remains.

## Remaining gates

A2 ordinary material/tag/file ownership atomicity is next. A3 early macOS 12 compatibility, A4 offline study visibility and A5/A6 fixture/retry evidence remain open. Physical Apple Silicon/macOS 12, installed Windows, live Gemini and the exact future candidate remain **UNVERIFIED**. Unix directory sync is best-effort; Windows checks do not prove native Unix power-loss durability.

Windows distribution remains held; v0.5.2 remains retired. The frozen private v0.5.3 DMG cannot certify newer source and must not be retagged/replaced. Git outcome and the next bounded prompt are recorded separately after the exact-head CI gate; this acceptance does not authorize a new release.
