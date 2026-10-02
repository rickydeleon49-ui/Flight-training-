# Restore retention — fifth independent review

Date: 30 September 2026. Reviewer: Codex. This is a Windows source/native-test review, not an installed-app or Mac smoke test.

## Decision

**Hold A1 acceptance, commit, push and merge.** The four round-four regressions are corrected and all 126 existing backup tests pass independently. Four additional behavior tests produce **1 pass and 3 failures**. These failures preserve the tested original data but leave otherwise recoverable profiles blocked on repeated startup after the triggering failure clears.

The uncommitted implementation remains preserved. This review does not change application code, migrations, dependencies, versions, tags, releases or candidate assets. A2–A6 and the existing distribution/release holds remain open.

## Reviewed state

- Repository: `H:\Ai Repo clones\Flight-training-` (`rickydeleon49-ui/Flight-training-`).
- Branch: `fix/restore-retention-restart-safety`.
- HEAD/base: `053af1fcd1429888300060f780a10d68adc81c5b`.
- Reviewed/restored `src-tauri/src/backup.rs` SHA-256: `DEBC5C83D7062F0CD4DD5AE12D5CB64BC49EEE02C4512AC05BA263CFD25C2CD1`.
- The eight pre-existing tracked modifications and four historical review notes were preserved. Review-only documentation updates and this note are additional changes.
- Historical first/second/third/fourth review documents remain byte-for-byte unchanged; their hashes are recorded in the local evidence directory.
- No owner app-data path was used. Test profiles contained synthetic SQLite databases and document sentinels in temporary directories.

## Confirmed findings

### G1 — P2: journal write/sync failures leave temporary files that permanently block subsequent startup

Locations: `src-tauri/src/backup.rs:1657–1672` (`write_journal`); `1750–1758` and `1813–1820` (temporary-journal evidence discovery).

After creating the temporary sibling file, write and file-sync errors return through `?` without removing that file. Cleanup is present for rename failure, but not for these earlier failures. When no canonical journal remains, evidence discovery treats the abandoned file as an interrupted restore and blocks startup indefinitely.

**Reproduction:** real complete pending restore with original DB/document and selected DB/document; inject `JournalWrite` or `JournalSync` on occurrence 1 and separately occurrence 2. Remove the fault and invoke actual startup twice. All four scenarios preserve exact original DB/document identities, yet both later invocations return:

```text
BlockedUnresolved: An interrupted restore journal update was detected
```

On occurrence 2, the first invocation has already completed rollback and reports `RefusedUnchanged`; later startup still blocks because the failed update left a temporary journal. This is an observed ordinary error-return path, not a claim about power-loss recovery.

**Required correction:** use scoped cleanup for the temporary file owned by the current write attempt on every pre-replacement error path. Preserve an existing canonical journal. Do not blanket-delete unknown temporary journals or weaken evidence discovery. Retain conservative behavior for genuinely interrupted/ambiguous state. Test first and subsequent failures, prior canonical bytes, original hashes, and at least two cleared-fault startup invocations.

Independent failing test: `round5_journal_write_or_sync_failures_can_recover_on_restart`.

### G2 — P2: actual legacy activation invents a modern owner that its pending storage cannot prove

Locations: `src-tauri/src/backup.rs:1438` (`RestoreJournal::new`); `2478–2487` (`read_restore_plan`); `3488–3491` (journal owner assignment); `2524–2550` (cleanup ownership).

Legacy pending storage can have no plan or a valid older plan with no `operationId`. The application reader accepts those states. Activation nevertheless keeps the newly generated nonempty journal ID, because it copies the plan's ID only when nonempty. The stricter cleanup check then refuses its own pending directory: the journal is modern but the plan is missing or unversioned.

**Reproduction:** use a valid selected SQLite DB/document with (a) no plan and (b) valid lowercase `kind: "complete"` plan without `operationId`. Actual first startup installs the selected data and returns `RestoreCompleted`. The second and third startups both return `BlockedUnresolved` due to unverified/mismatched ownership. Both variants reproduce this after fixture correction.

**Required correction:** explicitly normalize or record the genuine legacy origin before protecting active data, maintaining a consistent durable ownership contract throughout activation and cleanup. Do not fix this by accepting all missing plans for modern terminal journals. Preserve the round-four unknown-owner refusal. Keep corrupted, linked, unreadable and mismatched modern state distinct from supported legacy input.

This concerns **previously staged legacy state**. It does not establish that a newly imported v1 archive fails: current archive staging writes a modern plan. v1/v2/v3 archive round-trip tests remain necessary.

Independent failing test: `round5_legacy_pending_activation_does_not_leave_unverifiable_owner`.

### G3 — P2: deleting an unmoved original SHM cache leaves durable protection requirements that can never be satisfied

Locations: `src-tauri/src/backup.rs:3494–3507` (captures all `DB_FILES`, including SHM); `2885–2905` (unlinks active SHM); `3053–3093` (return/remaining protection); `3209` (remaining-protection gate).

The journal captures SHM as a required original artifact and protected file. If DB or WAL protection fails before SHM moves, rollback unlinks the still-active SHM cache. It can then neither return that SHM from recovery nor remove it from the protected-file list. Even with the failure cleared, repeated startup blocks despite the original DB and committed WAL remaining intact. The surfaced recovery error is also empty after the colon in this path.

**Reproduction:** create a real SQLite WAL transaction with `wal_autocheckpoint=0`; copy DB/WAL/SHM while the source connection is still open into a separate disposable profile, then close the source connection. This preserves a crashed-profile equivalent with a genuine committed WAL-only row, without a live connection to the tested profile. Inject `ProtectDbRename(0)` and separately `(1)` once, clear the fault, and invoke startup twice more. Both remain blocked. Exact DB/WAL hashes survive; reading only after all startup invocations proves the original committed WAL-only row survives.

**Required correction:** treat SHM as regenerable SQLite cache rather than mandatory durable user data. Reconcile old journals that already record it, while preserving strict DB/WAL identity and no-follow/error checks. Do not exempt WAL, drop committed WAL changes, remove unknown files by name, or broadly ignore leftover protection requirements. Provide an actionable diagnostic for any remaining unresolved item.

Independent failing test: `round5_protection_failure_with_real_original_wal_and_shm_recovers`.

### G4 — P2: claimed matrix evidence does not match the actual tests

Only **1 of the 17 Task-5 test names** in the pasted handoff exists in this source. Some missing names have differently named partial equivalents; missing names alone do not prove missing behavior. Actual source inspection nevertheless confirms that the claimed comprehensive matrix is absent:

- The sole occurrence-targeted test injects a second journal write and checks `hits() >= 1`, then only one cleared-fault startup. `hits()` counts matching calls, not fired injections. It does not directly prove the old canonical bytes survive the failure or that a later third launch works.
- Old journal write/sync/rename tests exercise helpers with no prior canonical journal and do not test restart.
- The existing move-fault tests cover DB index 0 and stop before successful repeat startup; the claimed dedicated WAL/document movement cases are not present.
- The real denied-read test writes malformed text, blocks under a lock, then deletes the fixture. It does not prove recovery from a valid journal after lock release.
- `scratch` returns a `PathBuf` and relies on manual cleanup. It is not `TempDir` RAII, contrary to the handoff.
- Unix directory `File::open`/`sync_all` errors are still ignored at lines 1687–1690. The handoff's wording must not imply checked error propagation or Mac durability evidence. A private test seam can exercise intended error handling without privileged VFS injection; actual OS durability remains platform-specific.

Correct the evidence and implement the finite missing critical tests. Do not manufacture test names, infer phase coverage from helper calls, or declare the matrix complete while these boundaries are untested.

## Passing cleanup check and its limit

`round5_pending_cleanup_with_windows_lock_recovers_when_plan_survives` passes: a real deny-delete lock blocks cleanup, the ownership plan remains present, lock release permits `RestoreCompleted`, and another startup returns `ProceedNormally`. Active DB/document hashes are unchanged.

**This is not proof of ownership surviving removal of the plan during partial cleanup.** On this Windows run, `plan_after_first=true`. Partial deletion after the plan disappears remains unverified. Add a deterministic boundary test and supported durable ownership strategy without granting deletion permission to an unidentified missing-plan directory.

## Independent commands and evidence

Evidence directory: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

| Command | Independent result | Evidence |
| --- | --- | --- |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::round4_` | Exit 0; 4 passed, 0 failed, 0.40 s | `restore-review-round5-2026-09-30-round4-tests.log` |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::` | Exit 0; 126 passed, 0 failed, 30.71 s | `restore-review-round5-2026-09-30-existing-tests.log` |
| Temporary review tests: `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::round5_ -- --nocapture` | Exit 101 from Cargo; wrapper exit 1; 1 passed, 3 failed, 0.36 s; compilation 26.00 s | `restore-review-round5-2026-09-30-corrected-reproductions.log` |
| `git diff --check` | Exit 0 before review-doc updates; repeated after updates | Final review hygiene check |

The first exploratory run used uppercase `Complete` in one legacy-plan fixture. That variant was invalid and is not legacy compatibility evidence. The authoritative corrected run uses lowercase `complete`; it still fails both the absent-plan and valid older-plan variants. The corrected run also expands the journal test to first/subsequent write and sync failures. Its cleanup test is named to describe its actual evidence limit.

Artifacts: `restore-review-round5-2026-09-30-regressions.rs`, `reproduce-restore-review-round5-2026-09-30.ps1`, exact original source snapshot, historical-note hashes and `restore-review-round5-2026-09-30-handoff-test-name-check.json`. The guarded runner restores application source byte-for-byte in `finally` and refuses to overwrite a concurrently changed source. All review fixture trees are removed before final behavior assertions.

The implementer reports the full frontend/build/fmt/clippy/Rust/lock/version matrix green (594 frontend passed, 4 skipped; 244 Rust passed, 6 ignored). Those are **reported**, not independently rerun in this review. No full matrix or CI was repeated after confirmed local blockers; there were no overlapping verification matrices.

## Acceptance and next step

Port the corrected review assertions permanently, fix G1–G3, correct G4's evidence and close the finite missing critical transition tests. Run focused tests per task, then one complete sequential local matrix. Preserve all previous unknown-owner, junction, hash, dataset-conservation and rollback assertions. Return the exact source hashes, commands, logs, phases and actual injected-fault evidence; leave work uncommitted/unpushed for independent review.

Physical Apple Silicon/macOS 12, installed Windows, live Gemini and exact future-candidate smoke tests remain **UNVERIFIED**. The frozen v0.5.3 DMG does not include this repair.
