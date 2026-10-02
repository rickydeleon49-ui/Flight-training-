# Independent review: restore retention and restart safety

Date: 30 September 2026. Reviewer: Codex. **Decision: changes requested; A1 remains OPEN. Do not commit, push, merge or approve release from this handoff.**

## Reviewed source and environment

- Repository: `H:\Ai Repo clones\Flight-training-`, remote `rickydeleon49-ui/Flight-training-`.
- Branch: `fix/restore-retention-restart-safety`.
- HEAD and locally recorded `origin/main`: `053af1fcd1429888300060f780a10d68adc81c5b` (PR #41 merge). No new fetch/push/CI was needed for this blocked local review.
- Input: eight uncommitted modified files, including the restore rewrite, startup wiring, four documentation files and two shebang removals. No migrations, versions, lockfiles or published artifacts changed.
- Host: Windows; Node `v24.16.0`, Rust `1.98.1`. No physical Mac or installed-app smoke test was performed.
- `backup.rs` SHA-256 before/after temporary review tests: `62bc8afd767b7d11d4afae140ca9d75c46be6ece3441721a05414ae35c97c877`.

The original obstruction path is improved and all twelve supplied `audit_*` tests pass independently. That does not establish crash safety: additional tests reproduce data loss, unsafe startup and restore replay. Application source was restored byte-for-byte after the temporary tests. This review adds documentation only; it does not implement the corrections.

## Confirmed findings

### R1 — P1: a crash between WAL protection and journal update loses committed rows

Relevant reviewed lines: `src-tauri/src/backup.rs:2455–2461`, `2217–2252`, `2310–2312`.

Protection renames each original file first and records the move afterward. Rollback returns only files named in `protected_db_files`, then recursively deletes the recovery folder without accounting for its other contents.

Reproduction: create a real SQLite database with a distinct committed update present only in its WAL; copy DB/WAL/SHM while the connection is open to reconstruct a crash snapshot. Move and record the DB; move the WAL but leave the previously persisted journal unchanged, exactly as a process exit between lines 2458 and 2461 would. Call the real startup recovery helper.

Observed: `RolledBackRecovered`, the original WAL is absent from both active and recovery locations, and the active SQLite row reads `checkpointed original row` instead of `committed row only in WAL`. Recovery deletes the unrecorded WAL and incorrectly reports success. This is loss of a committed transaction, not just a missing disposable SHM file.

Required correction: durably record intent before destructive moves and reconcile both sides using artifact identity. Stop cleanup unless every original artifact is accounted for. Cover interruption before/after every DB, WAL, SHM and document move, rather than only fully journaled phase boundaries.

### R2 — P1: stale rollback metadata can delete the returned original database

Relevant reviewed lines: `backup.rs:2104–2105`, `2113–2131`, `2174`, `2239–2280`.

Rollback ignores journal write failures, removes active files solely because their names appear in `installed_db_files`, and continues returning original files even when the durable installed-files list was not cleared. If that write fails and the process exits after returning the original DB, the next launch still sees the stale installed-files list.

Reproduction reconstructs this reachable stale disk state: a `RollingBack` journal still lists the DB as both protected and installed; the original DB has already returned to the active location; original documents remain in recovery. Calling the actual startup helper deletes the active original DB, then discovers there is no protected DB left to return.

Observed: `BlockedUnresolved`, **original database retained=false**. The message nevertheless says original data is safely preserved at the recovery path. Blocking after deletion does not recover the lost DB.

This case reconstructs the state following ignored I/O failure; it does not claim to inject a real journal-write failure through the entire activation path. The next implementation must add a deterministic filesystem failure seam to prove that end-to-end case too.

Required correction: failure to persist required state must stop mutation. Classify files by recorded dataset identity, not filename alone. A returned original or unrelated file must never be removed as a partial installation. Verify recovery completeness before claiming it.

### R3 — P1: Windows journal replacement has a missing-state window; startup treats unsafe absence as normal

Relevant reviewed lines: `backup.rs:1222–1228`, `1232–1235`, `2392`, `2604–2609`.

On Windows `write_journal` removes the old journal before renaming the temporary file. This is not atomic replacement: interruption between those operations loses the canonical journal. Startup checks only `is_file()` and does not investigate known `.recovery-pending` markers or temporary journal evidence.

Two independently executed disk-state reproductions:

1. Original DB is stranded in a marked recovery folder; a valid temporary replacement journal remains; the canonical journal was removed. Startup returns `ProceedNormally`, with no active DB and an intact stranded original. Normal database initialization would therefore be permitted to create a fresh DB.
2. `restore-journal.json` is an unexpected directory, with the same stranded original and marker. Startup again returns `ProceedNormally`, because a non-regular journal is treated as absent.

These are conservative-startup contract failures. No owner profile was opened and no real frontend migration was run in the reproduction.

Required correction: preserve the last durable recovery decision during platform-specific replacement. Distinguish absent from unreadable/non-regular state with fallible inspection. Block unresolved marker/orphan evidence without selecting the newest-looking backup or permanently blocking ordinary completed historical backups.

### R4 — P1: failed cleanup forgets the terminal decision and allows a stale restore to replay

Relevant reviewed lines: `backup.rs:2343–2359`, `2479–2484`, `2536–2541`.

The committed resume path ignores failure to delete `.restore-pending`, then unconditionally removes the journal. Successful rollback paths also remove the journal before checking pending cleanup. On a later launch, a remaining valid pending DB is treated as a new restore.

Independently reproduced committed-state case: active DB contains `committed current dataset`; the reconstructed committed journal accompanies a valid obsolete pending DB. Open that pending DB with a real Windows handle allowing reads but denying deletion. First startup reports `RestoreCompleted`, leaves the pending DB, and removes the journal. Release the lock; second startup reports completion again and replaces active data with `obsolete pending dataset`.

The existing test named `audit_committed_activation_with_cleanup_failure_does_not_replay` never actually makes cleanup fail; it only verifies successful cleanup. See the evidence log for the failed assertions. A separate end-to-end rollback-cleanup reproduction is recorded alongside the initial six cases.

The additional full-flow case uses a real synthetic archive and `apply_pending_restore_in_with` (not a reconstructed journal). An injected activation error is combined with a real Windows handle denying deletion of the staged DB. Rollback recovers `current original dataset` and `current original document`, but the journal is removed while cleanup leaves the valid staged DB. After releasing the handle, the next startup installs `selected backup dataset`; the document is now missing because the failed cleanup already removed the staged documents. The expected preservation assertion fails. This proves replay from a genuinely failed restore followed by successful rollback, and shows that partially removed staging can also become an incomplete successful restore.

Required correction: persist a terminal commit/cancel decision tied to the specific staged operation until cleanup is verified. Cleanup failure must not resurrect a rolled-back restore, replay a committed one, or delete a newer explicitly staged request.

### R5 — P1: a malformed recovery path can delete every historical backup

Relevant reviewed lines: `backup.rs:1148–1188`, `2310–2312`.

Journal validation accepts `rollback_rel_path = "backups"`: it checks the first path component but does not require a specific child recovery directory or operation identity. With empty protected/installed lists, rollback considers itself complete and recursively removes that entire directory.

Reproduction: create an active DB and a distinct valid historical safety copy, write that malformed journal, then call startup recovery. Observed `RolledBackRecovered` and **historical backup retained=false**. This requires malformed persisted state; the ordinary writer currently emits a child path, but the explicitly promised malformed-journal safety contract is broken.

Required correction: constrain the journal to an identified immediate child under the intended backup root, validate expected structure and every ancestor/artifact type, and refuse destructive cleanup for malformed or ambiguous state. Inspection currently checks only the final rollback directory for symlinks; ancestor/reparse handling needs targeted Windows/Mac tests before claiming it is strict. External-path deletion through an ancestor link was not independently executed in this review.

### R6 — P2: regression and documentation evidence overstate coverage

Relevant reviewed lines: `backup.rs:4403–4413`, `4432`, `4589`, `4985–5015`; proposed resolution section in `docs/FULL_REPOSITORY_AUDIT_2026-09-29.md`.

- The original obstruction test removes the archive's containing directory before asserting `original_doc_retained || !archive.exists()`. The second operand is then always true, so that assertion cannot prove document retention. The active-DB alternative also checks existence rather than original identity.
- The new WAL obstruction/separation tests drop the last SQLite connection before activation and do not assert that an uncheckpointed WAL/SHM still exists. That sequence normally checkpoints/removes WAL, so it does not prove the claimed interrupted WAL conservation.
- The committed cleanup regression never injects cleanup failure and only exercises one launch with successful deletion.
- The proposed audit resolution names multiple tests that do not exist under those names, and claims atomic Windows replacement and strict ancestor validation that the actual code does not provide. The documented `rollback_<timestamp>` directory also differs from `backups/<timestamp>-before-restore`.

Required correction: use exact hashes and identifiable rows for every artifact, retain assertions independent of cleanup, exercise genuine failures and second startup, and reference actual test names. Leave A1 open until corrected evidence is independently accepted.

## Evidence and verification

Local evidence directory:

`C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`

- `restore-review-2026-09-30-existing-tests.log`: independent `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::audit_`, exit 0, **12 passed**, runtime 0.52 seconds.
- `restore-review-2026-09-30-regressions.rs`: temporary review test source; uses existing helpers and disposable temp folders only.
- `reproduce-restore-review-2026-09-30.ps1`: saves exact original bytes, inserts review tests inside the test module, runs a selected focused filter, restores bytes in `finally`, and refuses to overwrite concurrent changes.
- `restore-review-2026-09-30-reproductions.log`: initial independent six-case run, **0 passed / 6 failed**, Cargo exit 101 (wrapper process exit 1), test runtime 0.13 seconds. Compilation took 2m23s; this was not six minutes of retries or a full matrix.
- `restore-review-2026-09-30-recovered-replay.log`: separate full-flow rollback-cleanup reproduction, **0 passed / 1 failed**, Cargo exit 101 (wrapper process exit 1), test runtime 0.12 seconds; incremental compilation 40.19 seconds. Total independently failing cases: **7**, grouped into five blocking correctness findings above. No duplicate matrices ran.

The implementer reports a complete matrix with 594 frontend tests, 173 Rust tests, formatting, strict Clippy, production build, version/lock checks and dependency installation passing. Those are attributed handoff results. Codex did not repeat an expensive complete matrix after discovering confirmed safety blockers. `git diff --check` passed locally. No GitHub Actions run, commit, push, merge, version change, tag or release was made.

## Platform and next-step limits

Physical Apple Silicon, macOS 12/WKWebView, packaged startup error presentation and installed Windows smoke tests remain UNVERIFIED. Passing native tests on this host does not establish Mac readiness. After repair, exercise original committed WAL rows, every interrupted move, journal-write failure, real staging cleanup failure, malformed state, repeat launches and clearing obstructions in isolated installed profiles. A frozen older candidate cannot prove fixes made after that candidate's source commit.

Keep backup v1/v2/v3 contracts, integrity/completeness checks, database-only restore semantics, app-owned document storage, Windows behavior, existing migrations, bundle identifier and release holds unchanged. Implement only A1 corrections next; A2/A3/A4/A6 require their separate work. The accepted PR #41 test-kit slice remains accepted.
