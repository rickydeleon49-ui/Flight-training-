# Second independent review: restore retention and restart safety

Date: 30 September 2026. Reviewer: Codex. **Decision: changes requested; A1 remains OPEN. No commit, push, PR, merge or release approval.**

## Source and evidence boundary

Repository `H:\Ai Repo clones\Flight-training-`, GitHub `rickydeleon49-ui/Flight-training-`, branch `fix/restore-retention-restart-safety`, HEAD/base `053af1fcd1429888300060f780a10d68adc81c5b` (PR #41). The proposal remains uncommitted: eight tracked modifications plus the preserved first-review note. This second review adds documentation, without implementing application corrections.

Reviewed `backup.rs` SHA-256: `0fa54b98ed343a553215f9c60962111abad6e72c2c7c6807602f25495112c908`. Temporary review tests were removed and this exact byte hash restored after both exploratory runs. Only synthetic databases/archives and private scratch directories were used. Four directories left by initial harness setup failures were explicitly identified and removed after validating their absolute paths under the test temp directory. No owner app-data profile was opened or changed.

Windows native host; no physical Mac, packaged Windows installation or live Gemini run. This is source review and native filesystem/SQLite evidence, not Mac readiness evidence.

## Improvements independently verified

All seven permanent `backup::tests::reviewer_*` regressions from the first review now pass independently (0.16 seconds, exit 0). They prove the particular original WAL-protection interruption, returned-original stale-list case, missing-marker/directory-journal cases, backup-parent rejection, committed cleanup failure and failed-restore replay case were corrected. The ineffective document-retention assertion has also been replaced, and the obstruction test now captures a real uncheckpointed WAL snapshot.

Journal replacement no longer deliberately removes the canonical file first. Terminal `RolledBack`/`Committed` records survive ordinary pending-cleanup failure. These are useful corrections, but file existence is still used in place of artifact identity, and not all transition/failure boundaries are covered.

Five additional native cases fail in the authoritative corrected reproduction run. These continue the first review's dataset identity, terminal cleanup and link-validation requirements; they do not expand the task into new features.

## Confirmed findings

### S1 — P1: rollback attaches the selected backup's WAL to the original DB

Reviewed source: `src-tauri/src/backup.rs:2252–2259`, `2366–2394`, `2421–2446`; installation at `2721–2744`.

The new guard says that when no original file with the same name exists in recovery, the active file must be a returned original and cannot be removed. That inference is false when the original DB was checkpointed and had no WAL, but a selected legacy backup does contain one.

Full-flow reproduction:

1. Build a valid v1 archive with real SQLite DB/WAL and a distinct committed `selected WAL-only row`, plus a document.
2. Create an active checkpointed DB with `current original row`, WAL mode retained but no WAL file, and `current original document`.
3. Stage the archive through the actual validator/extractor. Hold its staged document directory with a Windows handle denying deletion/rename, then invoke activation. The selected DB and WAL install before the document rename fails with error 32.
4. Rollback removes the selected DB but keeps its WAL because there was no original WAL in recovery. It returns the original DB and original documents and reports that previous data was recovered.
5. Release the directory lock, invoke startup again, and read SQLite.

Observed: `RolledBackRecovered`; staged WAL still exists beside the returned original DB; row is **`selected WAL-only row`**, while document is **`current original document`**. This silently mixes datasets and can apply another DB's committed pages to the original. The same rule affects any staged sidecar absent from the original, and install moves are still recorded after the rename rather than before it.

Required correction: record original presence/absence separately from selected artifact identity. Known staged data may need removal even when there is no original counterpart. Classify DB/WAL/SHM/documents as a dataset and verify complete conservation before allowing SQLite to open. Cover interrupted selected installation as well as protection. Do not weaken v1 WAL compatibility.

### S2 — P1: a regular unidentified destination is still deleted without identity proof

Reviewed source: `backup.rs:2247–2277`; journal fields `1125–1136`.

There are no original/staged content identities in the journal. If its installed-file list names the DB and a same-named file exists in recovery, rollback deletes any regular file at the active DB path. A recovered, externally replaced or otherwise ambiguous DB is not distinguished from the selected staged DB.

Reproduction reconstructs an interrupted activation with a protected original DB and a distinct unidentified active replacement DB. Calling actual startup recovery deletes the replacement and reports successful rollback. Its recorded byte hash is absent from both active/recovery locations afterwards: **unrelated database preserved=false**.

This is a reconstructed ambiguous disk state, not a claim that ordinary healthy activation always writes unrelated data or that the test injects the entire replacement race. It verifies the explicitly required no-deletion-of-unknown-destinations behavior is still missing. The fix for the prior stale-list reproduction covers only one presence pattern.

Required correction: persist enough verified original/selected identity before destructive operations to distinguish known staged bytes, returned originals, original absence and unknown destinations. Preserve or block on ambiguous files. Existence plus filename is not identity. Apply this to both DB sidecars and documents.

### S3 — P1: recovery follows a document junction into external storage

Reviewed source: `backup.rs:1196–1218`, `2342–2348`, `2399–2417`, `2439–2446`.

Validation checks the backup parent and recovery directory but not the actual original artifacts inside it. A junction at `recovery/documents` is moved into active storage and accepted as recovered because `is_dir()` follows its target.

Windows reproduction creates a valid protected DB and a real junction from its recovery documents path to a separate synthetic external document directory. Startup reports `RolledBackRecovered`, moves the junction to `root/documents`, and reading the app-owned path returns **`external document sentinel`**. The external sentinel remained unchanged in this test; no external deletion is alleged. The violation is accepting and exposing external storage through an app-owned path after claiming strict rejection of reparse points.

Required correction: inspect every protected/staged/active artifact and relevant ancestor with no-follow, fallible metadata before moving or deleting it. Reject unexpected types and reparse/symlink paths without following them. Test Windows junctions plus macOS/Unix symlinks where available. A parent-directory check alone is insufficient.

### S4 — P2: failed old-journal deletion silently discards an accepted new restore

Reviewed source: `backup.rs:1305–1307`, `1933–1960`, `2509–2541`; operation ID use `2652–2653`.

`fresh_staging` removes a prior terminal journal without checking the result, then accepts a new restore. Resume blindly deletes the pending directory for the old terminal state. `operation_id` is assigned but never compared with the pending plan, despite the documentation claiming matching prevents interference.

Full-flow Windows reproduction first produces a retained `RolledBack` journal through a real staging-cleanup lock. Release that lock; hold the canonical journal with a handle denying deletion. Stage a second valid archive. It returns success, with a new operation ID different from the old journal. Release the journal lock and relaunch.

Observed: **accepted=true**, different old/new IDs, `RolledBackRecovered` for the first operation, **pending_left=false**, and `current original row` remains active instead of `second explicitly requested row`. The newly accepted request was silently removed. Both external archives remain valid during the test; this case does not claim they were deleted.

Required correction: make journal deletion fallible; refuse new staging until old terminal cleanup is safely completed, or implement an explicit durable supersession protocol. Match operation identity before deleting pending data. Do not let removal failure or malformed state be swallowed as a harmless old record.

### S5 — P2: dangling journal paths still bypass the fail-closed gate

Reviewed source: `backup.rs:1281–1287`, `2592`, `2832–2836`.

Both the startup branch and `read_journal` test `Path::exists()` before no-follow inspection. A dangling junction/symlink returns false there even though a filesystem entry exists, so its invalid type is never checked. Metadata errors can similarly be collapsed into absence.

Windows reproduction creates a journal-path junction to a disposable directory, removes that target, confirms `symlink_metadata` still sees the entry while `exists()` is false, and invokes startup. Observed **`ProceedNormally`**. The fixture is an otherwise fresh profile; no user DB was opened or lost. This proves the promised dangling-link rejection is absent, not that every broken link strands an original DB.

Required correction: inspect canonical state with fallible `symlink_metadata` first and distinguish only genuine `NotFound` from invalid type or other error. Apply the same discipline to evidence discovery and cleanup. Do not silently drop read-directory errors with `if let Ok`/`flatten` when that result authorizes destructive cleanup.

## Verification and evidence accuracy

Local evidence folder:

`C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`

- `restore-review-round2-2026-09-30-existing-tests.log`: independent `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::reviewer_`; **7 passed, 0 failed**, exit 0, runtime 0.16s.
- `restore-review-round2-2026-09-30-regressions.rs`: five additional review scenarios, removed from repository source after execution.
- `reproduce-restore-review-round2-2026-09-30.ps1`: exact-byte preservation and guarded temporary insertion/removal.
- `restore-review-round2-2026-09-30-corrected-reproductions.log`: authoritative run; **0 passed, 5 failed**, runtime 0.38s, compilation 39.78s. No failed case is a mere compile/setup error in this run.
- `restore-review-round2-2026-09-30-reproductions.log`: earlier exploratory run. Two cases had harness issues (backup destination inside its source fixture, and a presumed document obstruction that did not actually prevent Windows rename); these were corrected before drawing conclusions. The other three already failed their behavior assertions. Do not count those two preliminary setup failures as product evidence.

The handoff reports 62 backup tests, 594 frontend tests with four skips, and **180 Rust tests passed with six ignored** in its final matrix, plus dependency installation, build, formatting, strict lint and version/lock checks. These remain attributed implementer results. The proposed audit text says 186 passed, conflating total cases with 180 passed plus six ignored, and claims operation-ID matching that the source does not implement. Correct those records after the next final gate.

No expensive full matrix was repeated after confirmed blockers. No CI, commit, push, merge, tag, version bump, installer replacement or release occurred. The first review file remains unchanged. Application source was restored byte-for-byte after temporary tests; this round adds review documentation and status annotations only.

## Required next handoff

Complete A1's identity, absence, selected-install interruption, operation-owned terminal cleanup and no-follow inspection protocol; port the five new cases into permanent tests, alongside the seven passing regressions. Add deterministic journal-write/sync/replace/delete and directory-read failure coverage rather than only idealized completed journal states. Run focused tests per task, then one sequential complete local matrix after all corrections are finished. Update documentation with actual guarantees and test counts and leave everything uncommitted for independent review.

Preserve archive v1/v2/v3 validation, integrity/completeness, database-only document retention, migrations, app-owned storage, Windows behavior, `com.herflightdeck.app` and all release holds. A2–A6 and new roadmap features remain outside this repair. Physical Mac and installed-app validation remain UNVERIFIED; a frozen older candidate cannot verify newly changed source.
