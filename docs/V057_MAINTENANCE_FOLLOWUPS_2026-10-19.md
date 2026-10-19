# v0.5.7 follow-ups: dialog, database sidecars and release verification time

Added at the owner's request on 19 October 2026 Pacific. **Tracked work, not implemented fixes.** These observations were already mentioned in the v0.5.7 release narrative; this document supplies actionable scope and acceptance criteria. Source/run metadata was inspected; no app/profile was opened, no backup/restore was executed and no release workflow was triggered by this planning task.

Keep the approved offline study → homework → exports priority and any assignment already underway. The two app items are bounded patch-maintenance work; REL-CI-01 must be addressed before relying on the next automated release run. A confirmed data-integrity defect discovered during V057-DB-01 becomes urgent and precedes feature work. Ordinary active SQLite sidecars alone are not a reason to halt the roadmap or claim the released database is corrupt.

## V057-UI-01 — Keep Cancel visible in the Gemini Send dialog

**Classification:** reported installed usability/layout defect, not yet independently reproduced in this task. The v0.5.7 report says the practice-test confirmation clips Cancel. Confirm the triggering window size, font scaling, text and optional third action before fixing it.

**Start points:** `src/pages/StudyLibrary/MaterialDetail.tsx` (study-aid and practice-test `ConfirmDialog` calls), `src/components/ui/Dialog.tsx` and `src/components/ui/ui.css`. The shared footer is a right-aligned flex row without wrapping in the inspected source. That is a plausible cause to reproduce, not a proven diagnosis. Keep the correction local unless the shared footer is the actual cause.

**Acceptance:**

- Cancel, Send and any chapter-selection action remain fully visible, reachable and distinguishable in both study-aid and practice-test confirmations. Cover initial generation, regeneration's longer warning, long filenames/messages, two/three actions, constrained window sizes and enlarged text. The body may scroll; actions must not be clipped outside the usable dialog.
- Preserve keyboard focus/order, Escape/Cancel behavior, focus return and existing native/fallback modal contracts. Cancel must cause no upload, provider request or generation job dispatch. Fixing layout must not auto-confirm the dialog or shorten the transmission disclosure to hide it.
- Use a meaningful geometry/screenshot reproduction at the failing dimensions, plus relevant shared-dialog/confirmation tests. A jsdom text-presence assertion alone does not establish visibility. Verify the corrected installed WKWebView with synthetic content and no real send required; record dimensions and screenshots. Reuse unchanged-source evidence elsewhere.

## V057-DB-01 — Classify and safely handle reported backup/restore sidecars

**Classification:** investigation; the release narrative's cosmetic/minor description is not established. Identify exact filenames, directories, sizes and ownership/lifecycle before prescribing cleanup. Do not access the owner's real profile to reproduce it.

[SQLite's WAL documentation](https://sqlite.org/wal.html#the_wal_file) explains that committed database changes can reside in the write-ahead log, while shared-memory files serve the WAL index. Sidecars may be legitimate while connections are open, and read-only access can also interact with them. Never blindly delete every `-wal`/`-shm` file, remove a live database's log, or change journaling/durability settings to make a directory look tidy.

**Start points:** `src-tauri/src/backup.rs`: `database_snapshot_with_retry`/snapshot creation, `verify_application_database`, `create_consistent_local_backup`, complete-backup export/staging and startup restore. The inspected snapshot/validation path opens SQLite connections, and some cleanup branches address only the main temporary snapshot filename. This warrants lifecycle tracing; it does not prove which files the installed observation referred to. Reuse the [SQLite online backup API](https://sqlite.org/backup.html), existing snapshots and recovery ownership guards.

**Required first result:** a synthetic reproduction table separating active database sidecars, operation-owned temporary snapshot/validation sidecars, staged restore content, and safety-copy/recovery files. Record when each connection closes, whether files remain after a clean stop, whether WAL contains committed rows absent from the main database, and whether an archive intentionally requires WAL. Preserve the earlier observed state before making changes.

**Acceptance and disposition:**

- If these are normal active-database files, document that result and correct misleading UI/report wording only if needed. Closing the investigation with evidence is valid; absence of all sidecars is not a success criterion.
- If an operation leaves disposable orphaned files, clean up only its uniquely owned temporary paths after its connections close and lifecycle permits removal. Preserve other operations' files, active DB sidecars, retained safety copies and pending crash recovery. Keep unsafe path/symlink/reparse/ownership refusals; no filename-glob cleanup.
- Prove backup and restored content include a committed synthetic row that exists only in WAL before the operation. Compare actual rows, migration ledger, integrity and referenced document hashes. Test open readers/writers, busy/checkpoint refusal, concurrent operations, success, cancel/failure and restart/crash recovery. Do not weaken validation or discard required WAL from older supported backup formats.
- A failed cleanup must not turn an unsuccessful backup into reported success or destroy a valid previous backup/profile. Preserve native regression suites, rollback/retention semantics and complete-backup exclusion of keys. Installed confirmation uses only an authorized synthetic lane after source review; label unmet coverage honestly.

## REL-CI-01 — Give the release Check job a measured cold-run budget

**Confirmed automation limit:** `.github/workflows/release.yml` sets `jobs.check.timeout-minutes: 20`. The normal checks workflow allows 45 minutes. Release already has a pinned Rust-cache action with a bounded 10-minute step and nonfatal cache failures; the task is not simply to add an action that is already there.

**Observed run:** [v0.5.7 release run 39208626239](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/39208626239), head `e8f68080186331803f8f2578086e3f8258c8eff1`, Check job `117916839258`. GitHub's annotation explicitly says the job exceeded 20 minutes. Metadata shows Check at 06:13:00–06:33:16 UTC on 19 October; Rust tests **succeeded** at 06:24:15–06:31:10. Cancellation occurred during the Cargo lockfile synchronization check, and post-job Rust-cache saving was skipped. The cache restore log said “No cache found.” Build and draft jobs were skipped. Preserve these distinctions; this was not a failing Rust assertion or a packaging failure. The published local installer is not a successful run of this workflow.

**Implementation scope:**

1. Retain the failed run/annotation/step timings, then measure cold and warm verification stages (install, frontend suite, Linux libraries/toolchain, Rust tests, lockfile check and cache handling). Identify avoidable duplicate work and why an interrupted cold run leaves the next run without a saved cache. Do not assume a successful restore action means a cache hit.
2. Adopt a finite, realistic Check-job limit with margin. **45 minutes is the initial proposal**, aligned with the existing checks workflow; validate it against measured cold completion rather than presenting it as already proven. Keep per-step/cache limits and bounded retries. Retain exact lockfile, version, current-main/tag identity, platform hold, testing and no-reuse/publication guards.
3. Reuse existing checks or caches where valid for the exact source/toolchain/lock inputs. Reject success inferred from stale or mismatched cached outputs. Keep action SHAs pinned and permissions narrow. Do not skip data-safety tests, loosen assertions, extend GitHub-token permissions or remove the overall timeout to get green.
4. Validate the changed workflow structure and negative release-safety cases using existing `src/logic/releaseSafety.test.ts` coverage where applicable. Demonstrate a cold-cache and warm-cache verification pass in a **nonpublishing** lane. Never rerun a published v0.5.7 tag or bypass existing-version checks merely to test CI. If final release-path execution needs a new candidate, use the next separately authorized version/source under normal gates.

**Done:** cold and warm Check runs finish with every required check green, cache outcome and stage durations recorded, total duration below the chosen finite budget, and downstream build/draft work cannot proceed after verification failure. YAML validation or a warm-only rerun is not proof of cold-run completion. No tag retargeting, asset replacement or publication is authorized by this item.

[Retained GitHub metadata and annotations](research/V057_RELEASE_CHECK_TIMEOUT_OBSERVATION_2026-10-19.json) bind these observations to the exact run; no workflow was rerun.

## Handoff

Use one bounded implementation assignment/report per independently reviewable fix, or combine the two dialog/source tests if they share the same cause. Keep sidecar classification separate from indiscriminate storage cleanup, and keep CI-only work separate from app behavior. Preserve failed evidence, update these IDs in ROADMAP/STATUS/handoff, run proportional local checks and require independent review plus green exact-head CI. These items do not change v0.5.7 assets, adopt a package or displace the owner's approved feature order by themselves.
