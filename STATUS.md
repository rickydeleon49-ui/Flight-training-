# Her Flight Deck — current project status

_Updated 2 October 2026 · Latest release: `v0.5.1` · Version `0.5.2` permanently retired · **Windows distribution on hold on v0.5.1; Mac candidate draft prepared at v0.5.3, release approval held after independent audit**_

## Shared Windows/Mac handoff — 2 October 2026

**A3 re-review hold:** Original A3-R1–R3 fixes are resolved; all 45 maintained tests pass independently. [One nested parent-first lifecycle defect remains (A3-R4)](docs/MAC_A3_COMPATIBILITY_REREVIEW_2026-10-02.md). Claude owns the focused correction and full verification; implementation remains local/uncommitted and is not yet accepted.

**Mac baseline accepted:** [Independent R1–R3 acceptance](docs/MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md) confirms eight maintained tests and the production build pass independently. The corrected source and sanitized evidence are committed for required GitHub checks. [Next Claude Mac task: A3 compatibility](docs/CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md) starts from updated main after this publication PR merges. Installed Mac verification and release holds remain open.

**Mac is primary:** the main user will run the app on this Mac. [Owner decision and readiness order](docs/MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) prioritizes source consolidation, A2/compatibility/offline corrections, signing and installed synthetic-profile verification before everyday use. The corrected baseline and prior review history are shared with this publication. [Sanitized source receipts](docs/evidence/mac-source-evaluation-2026-10-02/VERIFICATION_RECEIPT.md) now accompany the Mac report; Windows-local A2 source remains unavailable on GitHub.

**Completed baseline assignment (R1–R3 accepted):** [The copy-ready continuation prompt](docs/CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md) assigns a bounded Study Library baseline and open-source go/no-go recommendation. [Mac report review](docs/MAC_REPORT_REVIEW_2026-10-02.md) reconciles the observed evidence and identifies benchmark coverage limits. A2 remains with its Windows implementer; no new library, production optimization or M2 migration is assigned by this measurement task.

[PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md) is the common starting point for both machines. Research, plans, correction prompts and sanitized review evidence are tracked in GitHub; future handoffs must be linked there rather than depend on a local drive or chat attachment. The [open-source continuation handoff](docs/OPEN_SOURCE_MAC_HANDOFF.md) includes the historical research, 170-repository evidence snapshot, adoption sequence, test gates and Mac prompt. No new production library was installed or copied.

The [Mac report](docs/MAC_SMOKE_RESULTS_2026-10-02.md), originally shared in [draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44), is incorporated with this baseline publication. It records source checks and an Apple Silicon evaluation DMG, with signing assessment and installed-test limitations. PR #44 becomes redundant once this publication merges; installed smoke tests remain unverified. A2 remains local and pending the [R6/R7 correction prompt](docs/A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md). All release holds remain unchanged.

## Mac GitHub handoff — 2 October 2026

**Physical Mac source checks (2 October):** [Local evidence](docs/MAC_SMOKE_RESULTS_2026-10-02.md) records a MacBook Air / Apple M5 / 32 GB / macOS 26.6, testing clean main `5e388bf4169c7f968b1581292d6e1a24aa0493da`. Node 22 frontend checks pass (594 tests, 4 skipped); native formatting, strict Clippy, tests (246 passed, 6 ignored), and lock synchronization pass using the installed macOS 26.5 SDK. The default macOS 27 SDK fails with the installed linker; the report retains that finding. Local Apple Silicon evaluation DMG build passed; its packaged app has an ad hoc signature, fails command-line Gatekeeper assessment, and has no stapled ticket. Installed-app testing is blocked pending a dedicated standard test account. This is source evaluation, not frozen-candidate verification or release approval.

The physical Mac hardware, OS, source checks and local evaluation artifact are now recorded above; installed-app results remain pending. The [self-contained Mac handoff](docs/MAC_GITHUB_HANDOFF_2026-10-02.md), [Mac session prompt](docs/MAC_SESSION_PROMPT.md) and [results template](docs/templates/MAC_SMOKE_RESULTS_TEMPLATE.md) are tracked in Git so the Mac requires no Windows-local attachments, logs or generated files. Use current `main` for source evaluation and record its exact commit. This documentation update does not close any physical-test or release gate.

**A2 remains local and unaccepted:** the [second-review summary](docs/A2_SECOND_REVIEW_2026-10-02.md) records the verified native corrections and two remaining browser/test-driver defects. Do not assume that cloning `main` includes those uncommitted fixes. A3–A6 and all release holds remain open. Preserve the frozen v0.5.3 artifact identity; distinguish a local source evaluation build from that private candidate.

## Current A1 status — shared source and regression repair accepted (1 October 2026)

**A1 is accepted in independent shared-source and regression review; merge requires passing required CI on the exact PR head.** [Final acceptance and evidence](docs/RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md) confirms functional corrections, original WAL/document return cases, prior canonical bytes and the corrected real-prefix temporary-sibling detector. Codex independently reran all 18 task-four cases, including the seeded-file negative control. Inspected final logs show 594 frontend and 262 Rust tests passing (144 backup tests); the unchanged debrief suite passed 12 tests independently. This does not close A2–A6, installed-platform testing or release holds:

1. **H1: Safe deletion ordering and enumeration propagation (`remove_pending_directory_safely`):** `remove_pending_directory_safely` uses fallible no-follow inspection (`symlink_metadata` and `is_symlink_or_reparse`) on the pending root and each entry. Directory enumeration (`read_dir`) and individual entry inspection errors are propagated immediately before `RESTORE_PLAN` is touched. The ownership plan is unlinked only after every non-plan payload deletion has succeeded. Callers in `backup.rs` use fallible `inspect_storage_root`. Verified by:
   - `round6_cleanup_enumeration_error_must_preserve_ownership_plan`: native Windows listing denial (`PermissionDenied` via .NET directory ACL), asserting plan and payload preservation.
   - `round6_cleanup_entry_read_fault_preserves_plan_and_recovers_on_restart`: private entry-read fault seam (`InjectedFault::PendingEntryRead`) proves plan survival and successful cleanup upon fault clearance.
   - `round6_cleanup_obstruction_during_startup_preserves_plan_and_clears_on_restart`: full startup recovery asserting `BlockedUnresolved` while obstructed, `RestoreCompleted` on cleared retry, and `ProceedNormally` on third launch with zero restore replay and conserved original data.
2. **H2: Calendar-independent debrief test fixture (`debriefLinks.test.ts`):** `beforeEach` configures scoped Date-only fake timers frozen at `2026-10-01T12:00:00Z`, with real-timer restoration in `afterEach`. UI promises and event dispatch remain real. All 12 tests pass independently; the scoped clock removes host-calendar dependence. No separate post-fix 6 October host simulation is claimed.
3. **H3: Critical transition evidence & durable contracts:**
   - **C1 (WAL return failure):** `task4_wal_original_return_failure_preserves_committed_wal_and_recovers` creates genuine SQLite WAL with committed rows absent from the main database, injects `ReturnDbRename(1)`, verifies `fired_count() >= 1`, asserts `BlockedUnresolved` on first startup, `RolledBackRecovered` on second startup, and `ProceedNormally` on third startup with the committed WAL row intact.
   - **C1 (Document return failure):** `task4_documents_original_return_failure_preserves_documents_and_recovers` tests two distinct original documents under `ReturnDocsRename`, verifying `fired_count() >= 1`, `BlockedUnresolved` on first launch, `RolledBackRecovered` on second launch, and `ProceedNormally` on third launch with exact SHA-256 and size preservation.
   - **C2 (Accurate WAL classification):** `task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original` updated with genuine SQLite WAL header and transaction bytes, covering install-move failure where `InstallDbRename(1)` fires before selected WAL movement. (The distinct boundary where an already-installed selected WAL is uninstalled and prevented from mixing with returned original data is covered separately by `round2_legacy_restore_wal_is_not_mixed_with_returned_original`.)
   - **C3 (Prior canonical bytes at write boundary & correct temporary-sibling detection):** `task4_prior_canonical_journal_preserved_on_write_sync_rename_failures` independently passes byte-identical prior canonical bytes/hash and successful replacement across `JournalTempCreate`, `JournalWrite`, `JournalSync` and `JournalRename`. The no-temporary-siblings check uses the actual `format!("{RESTORE_JOURNAL_FILE}.tmp-")` prefix, and dedicated negative-control test `task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control` verifies that seeded actual-prefix leftovers are caught and cleared upon removal.
   - **C4 (Exact file identities & real outcomes):** `task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers` uses exact SQLite file identities and asserts actual `RolledBackRecovered` and `ProceedNormally` startup decisions.
   - **C5 (Documented Unix directory-sync semantics):** `write_journal` documents best-effort parent directory sync: atomic rename already committed canonical replacement on disk; directory fsync is performed where supported, but does not invalidate committed state if directory file descriptors cannot be synced on the host OS/sandbox.
4. **Passing local suite:** 144 tests in `backup::tests::` pass; all 12 `debriefLinks.test.ts` pass; `cargo clippy --locked --all-targets -- -D warnings` and `cargo fmt --check` exit 0.

**Platform limits and release status:** A1 shared source/regression acceptance is complete; A2–A6 remain open. Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, early macOS 12, installed Windows and live Gemini remain UNVERIFIED. The frozen v0.5.3 DMG cannot certify newly changed source.

[Exact-head CI follow-up](docs/RESTORE_RETENTION_CI_FOLLOWUP_2026-10-01.md): Linux checks exposed an unused captured row in a Unix-only test, then a cleanup-retention expectation whose blocking handle existed only on Windows. Focused test-only corrections add the intended row assertion and verify successful cleanup on every platform while preserving the Windows locked-file recovery case. Production behavior is unchanged. Passing corrected exact-head CI remains the merge gate.

## Mac Study Library baseline — 2 October 2026 (R1–R3 accepted; exact-head CI merge gate)

[Baseline report](docs/MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md) with [sanitized evidence](docs/evidence/mac-study-baseline-2026-10-02/README.md).

- **Code state:** Codex accepted and committed the corrected source on `codex/mac-study-library-baseline`, original base main `a4339fc`, incorporating PR #44's Mac documentation. [Independent acceptance](docs/MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md) distinguishes Codex-run checks from inspected implementer results. Required exact-head GitHub checks gate merge.
- **Benchmark:** Deterministic synthetic fixture over 100/1,000/5,000 materials plus a 10,000 stress tier. Every measured step is verified against an independent answer key before its sample is kept (R1). Results are per step, with compute for the same view (R3). Expanded displays up to 1,000 cards are measured (R2). The always-on scenario test includes final-state and intermediate-step negative controls.
- **Results (Node/jsdom on Apple M5, not WKWebView paint):**
  - Search compute is 0.14–1.54 ms per measured state at 5,000.
  - Interactions at 100 shown cost about 9–20 ms, independent of library size.
  - Show more grows with displayed cards: 16 ms at 200, about 97 ms per click at 1,000. A query from a 1,000-card display costs about 35 ms.
  - Edit plus full refresh: 20 ms at 5,000 and 35 ms at 10,000.
- **Decision:**
  - MiniSearch: no-go.
  - TanStack Virtual: no adoption justified for the initial 100- and 200-card displays.
  - Expanded displays exceed the proposed Node targets and remain an open, measured question for installed WKWebView evidence and a fair comparison, including a dependency-free alternative. They do not justify adoption on their own.
- **Local gate on the corrected diff:** 602 frontend tests passed (4 skipped), build passed, 246 Rust tests passed (6 ignored), fmt/clippy/lock/diff checks passed.
- **Unchanged:** No production code, package, migration or release state changed. Installed testing has not started.

## Independent full audit — 29 September 2026

[The current audit and implementation update](docs/FULL_REPOSITORY_AUDIT_2026-09-29.md) reviews current `main` at `c241c4a` and preserves the four pending release/test-kit files. **Release approval is held:** new independent reproductions found failed-restore rollback deleting its protected database, ordinary material/tag saves partially committing on duplicate tags, and a fresh-start compatibility failure when early macOS 12 lacks `structuredClone`. Native dialogs also assume APIs newer than the declared minimum. Saved local guides and practice tests become hidden when Gemini is disconnected. These findings apply to the existing candidate source, which has unchanged product files.

The existing suites passed: **575 frontend tests** (3 skipped), **158 Rust tests** (5 ignored), production build, Rust formatting/strict lint, and lock/version checks. npm reported zero advisories; current RustSec scanning reported zero unsuppressed vulnerabilities with the existing RSA exception and upstream informational warnings. Additional audit preservation/visibility assertions failed and are documented as new regression requirements. Temporary audit test edits were restored byte-for-byte; no product fixes, migration/version changes, commits, pushes, installer builds, or publication occurred.

Implementation priority: restore retention and restart safety → atomic material/tag/file ownership → macOS minimum compatibility → offline saved-study visibility → fixture/status accuracy. Run focused tests for each correction and one final local matrix before Codex's commit/PR/merge review. Keep the draft private and unchanged; source fixes do not update already-built assets. Physical Mac, installed Windows, live Gemini, and exact future-candidate smoke tests remain unverified. M2 schema/UI and new saved-guide-to-test work follow their existing scope/check-in gates.

### Mac test-kit review corrections (29 September 2026)

Following Codex's independent reviews of the test-kit slice (`MAC_TEST_KIT_REVIEW_2026-09-29.md` and `MAC_TEST_KIT_SECOND_REVIEW_2026-09-29.md`), test-kit and verification gaps were resolved locally:
1. **Archive inspection parser hardening (R1):** `scripts/inspect-backup-credentials.mjs` strictly verifies complete central-directory byte consumption (`pos === cdOffset + cdSize`), local file header name and signature consistency, EOCD bounds and comment length, and rejects underreported entry counts, zero counts, multi-disk archives, and ZIP64 with status 2 (`INSPECTION ERROR`), preventing false PASS results.
2. **Documented shell check fail-closed contract & observable cleanup (R2 / V2):** `docs/MAC_PARITY_CHECKLIST.md` step 4 checks `$GREP_STATUS` distinguishing match (0 -> FAIL 1), no-match (1 -> PASS 0), and search error/missing command (anything else -> INSPECTION ERROR 2), with trap cleanup of `$TMP_LIST` on all exit paths. In `src/logic/releaseSafety.test.ts`, an availability seam (`findBashExecutable`) replaces silent returns with an explicit test skip (`ctx.skip()`) when Bash is absent, and tests observe cleanup across normal success, credential failure, unzip failure, and grep failure.
3. **Decoded page ID coverage, actual-source metrics, and generator deduplication (R3 / V1):** Added helpers in `src-tauri/src/pdf.rs` decoding each page's content stream via `lopdf` to assert full ordered `P0001`-style ID sequences (`1..=1000` + `1001..=1050` for long manual; `1..=58` + `59..=60` for byte-heavy charts; exact 101–300 and 10–20 for manual ranges), distinguishing verified content coverage from bare page counts. Added a negative regression proving the oracle rejects wrong, duplicate, and reordered page IDs. Removed the inline duplicate generator from `docs/MAC_PARITY_CHECKLIST.md` in favor of `node scripts/generate-pdf-fixtures.mjs`, and updated checklist split tables with actual-source Rust extraction measurements. Visual pixel rendering remains pending physical Mac checks; all physical Mac runtime items remain UNVERIFIED. Candidate v0.5.3 DMG remains a frozen historical evaluation artifact; release approval remains held pending separate product repairs.

Codex's [final independent test-kit review](docs/MAC_TEST_KIT_FINAL_REVIEW_2026-09-29.md) approves this tools/tests/documentation slice for PR review. Fresh final local verification passed: **594 frontend tests** (4 skipped), **161 Rust tests** (6 ignored), the explicit byte-heavy page-content test, dependency installation, production build/typecheck, strict Rust lint/formatting, and lock/version checks. The separate product and physical-Mac release gates remain open; no candidate/version change is authorized by these results.

### Second restore-retention review — 30 September 2026

**A1 remains OPEN; commit and merge are blocked.** [The second independent review](docs/RESTORE_RETENTION_SECOND_REVIEW_2026-09-30.md) independently passes all seven regressions from the first review but reproduces five additional failures: a valid legacy backup's WAL is attached to the returned original DB after document-install failure; unidentified active database bytes are deleted without ownership proof; recovery moves a Windows document junction into active storage; failed old-journal deletion allows a newly accepted restore to be silently discarded; and a dangling journal junction is treated as no journal. Native test evidence and exact source references are recorded in the note. Application source was restored byte-for-byte after temporary tests. No commit, push, CI or release action was made; Mac and installed-app checks remain UNVERIFIED.

### Proposed restore-retention corrections — implementer handoff, 30 September 2026

The implementer reports the following corrections to [the first review](docs/RESTORE_RETENTION_REVIEW_2026-09-30.md). The seven original regressions now pass independently, but **the broader safety claims below were not accepted**; the second review identified remaining identity, sidecar, cleanup and path-inspection defects.

1. **Unrecorded WAL/SHM protection (R1):** Pre-records protection intent before moving files. `execute_rollback` inspects the rollback folder for all `DB_FILES` (not just recorded files) and returns them to root. Rollback strictly verifies that no unaccounted or leftover files remain before completing.
2. **Stale rollback journal deleting returned original (R2):** `execute_rollback` uninstalls active files only if the original file still exists in rollback. If absent from rollback, it is the returned original and is never deleted.
3. **Atomic journal replacement & fail-closed startup (R3):** Journal replacement flushes to a temporary file (`restore-journal.json.tmp`) and renames over `restore-journal.json` without unlinking first, preserving the prior valid journal on write/sync failure. `handle_startup_restore_in` fails closed on directories, non-regular files, or corrupted journals. If the canonical journal is missing but recovery evidence (`.recovery-pending`, `.tmp` journals, or `before-restore` safety copies without an active DB) exists, startup halts with `BlockedUnresolved`.
4. **Persistent terminal decisions across cleanup failure (R4):** Added `RestorePhase::RolledBack`. Both `Committed` and `RolledBack` are durably recorded before attempting staging cleanup. Cleanup failure leaves the terminal journal intact; subsequent launches retry cleanup without replaying or re-rolling back.
5. **Strict path constraint & identity (R5):** Path validation enforces `backups/<child>` only, rejecting traversal, drive letters, reparse points, symlinks, and the `backups` directory itself. Operation ID matching between staging plan and journal prevents cross-request interference.
6. **Repaired test oracles & permanent reviewer regressions (R6):**
   - Ported all 7 independent reproduction test scenarios into permanent repository tests:
     - `reviewer_unrecorded_wal_move_preserves_committed_rows` (verifies committed rows only in WAL survive move/exit)
     - `reviewer_stale_rollback_journal_cannot_delete_returned_original` (verifies returned original DB is not deleted on restart)
     - `reviewer_missing_journal_with_recovery_marker_blocks_startup` (verifies fail-closed on missing journal with marker)
     - `reviewer_non_regular_journal_is_not_equivalent_to_absent` (verifies non-regular journal blocks launch)
     - `reviewer_committed_cleanup_failure_must_not_replay` (verifies cleanup failure preserves committed state across launches)
     - `reviewer_backups_parent_is_not_a_valid_recovery_folder` (verifies `backups` folder cannot be wiped as a recovery folder)
     - `reviewer_recovered_restore_cleanup_failure_must_not_replay` (verifies rollback survives cleanup failure without replay)
   - Fixed ineffective test oracle: `audit_failed_rollback_must_retain_original_database` verifies exact byte hashes of retained database and documents before cleanup (no bogus fallback).
   - Real uncheckpointed WAL snapshots: `audit_document_return_obstruction_retains_document_and_db_wal` uses an active WAL snapshot with `wal_autocheckpoint = 0` and verifies exact original WAL hashes.
   - Removed obstruction recovery: `audit_recovery_completes_after_obstruction_removed` verifies that once an obstruction is removed, relaunching automatically completes rollback to `RolledBack` without resurrecting terminal restores.

**Prior handoff count note:** The previous handoff reported 180 passed, 0 failed, 6 ignored (186 total tests).

### Second review follow-up: S1–S5 protocol implementation (30 September 2026)

Following Codex's second independent review (`docs/RESTORE_RETENTION_SECOND_REVIEW_2026-09-30.md`), the five remaining defect classes (S1–S5) and missing transition matrix coverage have been implemented and verified locally:

1. **S1 — Verified dataset identity & WAL/SHM separation:** `RestoreJournal` records `original_db_artifacts` and `staged_db_artifacts` (with exact SHA-256 digests and byte sizes) before moving files. When rollback executes, an active WAL is only preserved if its hash matches an original WAL recorded before restore; a staged WAL absent from the original is deleted/uninstalled. Stale SHM files in active storage are unlinked prior to returning DB/WAL so SQLite safely regenerates shared memory on first open without data mixing. Covered by `round2_legacy_restore_wal_is_not_mixed_with_returned_original`.
2. **S2 — Unidentified regular destination preservation:** Active DB and document destinations are only uninstalled if their cryptographic identity matches known staged artifacts. If an active file matches neither staged nor original data, it is preserved, rollback halts with an actionable error, records `UnresolvedRecovery`, and startup blocks with `BlockedUnresolved`. Covered by `round2_unidentified_regular_destination_is_not_deleted` and `unidentified_document_and_sidecar_are_not_deleted`.
3. **S3 — Linked original artifact rejection:** `RestoreJournal::validate` and `inventory_directory_artifacts` recursively inspect rollback and active directories using `is_symlink_or_reparse` (checking `FILE_ATTRIBUTE_REPARSE_POINT` on Windows alongside `is_symlink()`). Any linked recovery files, junctions, or unexpected file types are rejected fail-closed before any files or directories enter active storage. Covered by `round2_linked_recovery_documents_do_not_enter_active_storage` and `round2_linked_recovery_database_directory_does_not_enter_active_storage`.
4. **S4 — Terminal journal removal & operation ownership:** `fresh_staging` fallibly validates and removes existing terminal journals before clearing staging/pending. If removing an old journal fails (e.g. held lock), staging is refused with `Err`. On startup, `handle_startup_restore_in` enforces operation ownership: `pending` is cleaned only if its `operation_id` matches the terminal journal, preventing an old record from silently discarding a newly accepted restore. Covered by `round2_failed_terminal_journal_removal_cannot_discard_new_restore`.
5. **S5 — Dangling metadata fail-closed inspection:** `handle_startup_restore_in` and `read_journal` inspect metadata via `std::fs::symlink_metadata` rather than `exists()`. Only genuine `NotFound` is treated as absent; dangling junctions, broken symlinks, non-regular files, and unreadable state halt startup with `BlockedUnresolved`. Covered by `round2_dangling_journal_is_not_treated_as_absent`.
6. **Failure transition matrix:** Verified conservation and idempotency across interrupted rollback return (`matrix_interrupted_original_return_preserves_already_returned_files`), altered/mismatched rollback files (`matrix_missing_original_artifact_blocks_recovery_even_if_same_named_file_exists`), and corrupted/unrecognized journal phases (`matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively`).

**Verification status:**
- Full Rust test suite: **190 passed, 0 failed, 6 ignored** (72 in `backup::tests::`, including all 7 round 1 reviewer tests and all 6 round 2 reviewer tests).
- All changes remain uncommitted and unpushed for independent review.
- **A1 is marked pending independent acceptance; it is NOT declared release-ready.** Findings A2–A6 remain open.
- The Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, installed Windows, and live Gemini testing remain UNVERIFIED.


### Third review follow-up: T1–T5 protocol implementation (30 September 2026)

The implementer reports the following corrections after the third review. Codex independently passes the five round-three cases and all 107 existing backup tests, but the fourth review finds F1–F4 and incomplete failure coverage. This proposal is not independent acceptance:

1. **T1 — Original document identity and completeness:** `RestoreJournal` records `original_document_artifacts` and `staged_document_artifacts` before file moves. Recovery rollback strictly verifies complete relative path names, byte sizes, and SHA-256 digests against recorded manifests using fallible no-follow reads. Mismatched hashes, altered bytes, missing files, or unexpected files halt recovery and mark `UnresolvedRecovery`, preserving original files without loss. Covered by `round3_changed_original_document_cannot_be_reported_recovered`, `round3_missing_original_document_cannot_be_reported_recovered`, `task1_missing_single_document_in_populated_dir_blocks`, `task1_changed_same_size_document_bytes_blocks`, `task1_missing_entire_document_directory_blocks`, `task1_nested_document_paths_verified`, `task1_interrupted_return_after_directory_rename_resumes_cleanly`, and `task1_repeated_startup_after_clearing_obstruction_succeeds`.
2. **T2 — Original document absence without dataset mixing:** Distinctly represents original document absence, empty directory, and populated directory states. When rolling back an operation where the original profile had no documents, only positively identified selected staged documents are uninstalled, preserving unrelated user files and returning to original absence without leaving selected documents behind. Covered by `round3_original_document_absence_must_not_leave_selected_documents`, `task2_original_document_absence_uninstalls_selected_documents`, `task2_original_empty_document_dir_restored`, `task2_original_populated_document_dir_restored`, `task2_unrelated_active_document_preserved_and_blocks`, and `task2_overlapping_document_content_survives`.
3. **T3 — Fallible no-follow inspection across active/recovery roots:** `inventory_directory_artifacts` and directory helpers inspect the root directory itself before enumeration using `std::fs::symlink_metadata` and `is_symlink_or_reparse`. Junctions, reparse points, symlinks, and non-regular files in active, staged, or recovery roots/children are rejected fail-closed. Validates all inventory artifact paths against path traversal, absolute/drive/UNC paths, Windows streams, and duplicate entries. Safe active `.db-shm` unlinking occurs before returning DB/WAL. Covered by `round3_active_document_junction_cannot_be_accepted_as_returned_original`, `task3_linked_inventory_root_rejected`, `task3_linked_nested_child_rejected`, `task3_active_db_link_rejected`, and `task3_journal_invalid_inventory_names_rejected`.
4. **T4 — Strict pending deletion ownership:** Separated application kind reading (`read_restore_plan`) from deletion authorization (`read_restore_plan_for_ownership`). Unreadable, corrupted, symlinked, or mismatched plans strictly do not authorize removal of pending data; ambiguous staging is preserved and startup halts with `BlockedUnresolved`. For modern state, proven matching nonempty operation IDs are required before removing pending directories. Genuinely legacy state (empty operation IDs without plan) and unversioned leftovers from committed/rolled-back operations are cleaned up cleanly. Covered by `round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup`, `task4_terminal_cleanup_matching_id_committed`, `task4_terminal_cleanup_matching_id_rolled_back`, `task4_terminal_cleanup_mismatched_id_refuses_deletion`, `task4_terminal_cleanup_corrupted_plan_refuses_deletion`, `task4_terminal_cleanup_empty_id_refuses_deletion`, and `task4_terminal_cleanup_genuine_legacy_state`.
5. **T5 — Deterministic filesystem failure matrix:** Added a private, scoped thread-local fault-injection boundary (`InjectedFault`, `ScopedFault`, `check_injected_fault`) active under test configurations. Verified fault occurrence and dataset conservation across journal temporary file creation, writing, syncing (`sync_all` plus Unix directory entry sync), atomic rename, and journal deletion faults, as well as protect move, install move, return move, and unreadable journal faults. Covered by `task5_matrix_journal_temp_create_fault`, `task5_matrix_journal_write_fault`, `task5_matrix_journal_sync_fault`, `task5_matrix_journal_rename_fault`, `task5_matrix_journal_delete_fault`, `task5_matrix_unreadable_journal_file_blocks_startup`, `task5_matrix_protect_move_fault_conserves_original_data`, `task5_matrix_install_move_fault_triggers_clean_rollback`, and `task5_matrix_return_move_fault_conserves_all_files`.

**Verification status:**
- Full `backup::tests::` suite: **107 passed, 0 failed, 0 ignored** (including all 5 round 3 reviewer regressions, 7 round 1 reviewer tests, and 6 round 2 reviewer tests).
- All changes remain uncommitted and unpushed for independent review.
- **A1 is marked pending independent acceptance; it is NOT declared release-ready.** Findings A2–A6 remain open.
- The Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, installed Windows, and live Gemini testing remain UNVERIFIED.

## Existing candidate record

The five candidate version records are synchronized to `0.5.3`. A private, unpublished Mac-only GitHub Release draft exists from workflow run `36515016063` (target commit `41464607ff85d0a4cf0b837c19b400d8392dfec4`).

**Release candidate draft & tag status:**
- **Tag status:** The private draft carries the tag name `v0.5.3` and targets fixed commit `4146460`, but `refs/tags/v0.5.3` does not currently exist in the Git repository. Under GitHub's release model, the Git tag ref is created only upon draft publication. No Git tag was pushed or created prematurely.
- **Initial checksum mismatch:** The draft contains the compiled Apple Silicon DMG (`Her.Flight.Deck_0.5.3_aarch64.dmg`, 4,511,142 bytes, SHA-256 `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`). Tauri initially produced a filename with spaces; GitHub normalized those spaces to dots on upload, leaving the original manifest and notes with the wrong filename. That manifest and note line have since been corrected.
- **Workflow fix:** Added `scripts/normalize-installer-filenames.mjs` and updated `.github/workflows/release.yml` to normalize installer filenames on disk to stable downloadable names prior to checksum generation and upload, and embedded `installers/SHA256SUMS.txt` directly into release notes.
- **Draft correction verified:** After PR #39 passed CI and merged, Codex replaced only the private draft's `SHA256SUMS.txt` and corrected the release-note checksum line to reference `Her.Flight.Deck_0.5.3_aarch64.dmg`. The original DMG asset ID, size, SHA-256, and target commit remain unchanged; the draft remains unpublished.
- **Physical Mac gate:** The draft remains strictly **unpublished**. A CI build is packaging evidence only; publication is blocked until physical Apple Silicon smoke testing is complete per `docs/MAC_PARITY_CHECKLIST.md`.
- **No-retag rule:** Under no circumstances will tag `v0.5.3` be repointed or reused. If physical device testing fails on this draft, the draft will be discarded, version `0.5.3` permanently retired in `scripts/release-policy.json`, and the source bumped to `0.5.4`.

## M2 Study Library design (planning only)

[M2_STUDY_LIBRARY_DESIGN_2026-09-27.md](docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md) maps current generated-content storage to staged content versions, resumable practice attempts, card reviews and bounded history. No M2 schema or app change has started. The roadmap's check-in with the real user after M1 remains the gate before migration 11; her use of the Daily Flight Plan and quick debrief should set M2 scope. The Windows release hold and Mac installed-app checks are unchanged.

## Performance and usability polish (27 September 2026)

Measured on the same branch as D6/D7 before the final Codex review, with synthetic data in three realistic tiers:
- **Questions** now opens quickly with a long history. It mounts 100 rows at a time with "Show more", and filters still cover every question.
  - Large tier (800 questions): 531 → 63 ms in the jsdom benchmark.
  - Chromium browser-mode check: 595 → 62 ms, with the DOM reduced from about 15,000 to about 2,000 nodes.
- **Complete-backup restore:** staging now hashes each file while writing it, instead of reopening it afterwards. The same size and SHA-256 checks and `sync_all` apply. Restoring 5,000 records and 300 files went from 6,856 ms to 1,142 ms (release build, this Windows machine).
- **Compact windows (≤ 900 px):** no longer scroll sideways. A screen-reader-only nav label had widened the page from 470 to 824 px.
- **Review corrections to the Questions paging and answer-save race:**
  - Unsaved answers are kept by question id, so a new question, a filter change or paging no longer loses what she typed. Nothing is autosaved.
  - Every real filter change resets to 100 rows; switching Everything → Answered → Everything had returned 200.
  - Answer-save race resolved with per-question save ownership: drafts carry a monotonic revision counter so completing an in-flight save clears only the revision it submitted; newer edits or newly opened editing sessions survive.
  - Synchronous in-flight guard (`savingQuestionIdsRef`) blocks duplicate submissions from rapid clicks within a single React render batch; conflicting controls disable during save (Save shows "Saving…", Cancel, TextArea, status Select, and Delete).
  - Pending ownership is tracked at page level (`savingQuestionIds`), surviving filter changes and pagination unmount/remount cycles.
  - Cancel is disabled during an in-flight save, honestly reflecting that an in-flight database write cannot be aborted mid-flight. Failed saves preserve the draft for retry and release the guard.
  - All 14 tests in `Questions.drafts.test.ts` pass, including controlled-promise batch regression tests. Full suite: 59 files passed, 3 skipped; 550 passed, 3 skipped. Build entry is unchanged at 381.14 kB (118.56 kB gzip).
  - Rendering stays bounded (1,930 nodes). The large-tier benchmark reads 77 ms against 63 ms before; that is one ~15 ms polling step of the method, and still about 7× faster than the original 531 ms.
- **Mac tracker:** [the Mac parity tracker](docs/MAC_PARITY_CHECKLIST.md) now lists these changes against MAC-08, MAC-17, MAC-20, MAC-21, MAC-22 (Questions delayed-save smoke test) and PERF-MAC-01…05. All Mac behaviour and Mac speedups remain UNVERIFIED.

Measured and left alone (no verified bottleneck): PDF splitting, Gemini local preparation, Study Library search and sort, Flight Deck.

The D7 source check (`listed_modules_do_not_reference_reqwest_directly_outside_gemini`) now normalizes CRLF correctly, with LF/CRLF fixture tests. That is a separate correction, not performance work.

Not measured: PDF import timing, first navigation with lazy route loading, packaged-app startup, WebView paint, native memory and Gemini network/model latency. Windows installed-app and Apple Silicon checks are unverified. No migration, version or release change. See [the performance note](docs/PERFORMANCE_POLISH_2026-09-27.md).

## M1 D7 — Acceptance of the Daily Flight Plan and debrief workflow (27 September 2026)

D6, D7 acceptance, and the performance polish merged through PR #35 (`1d86d57`). The automated checks passed on exact PR head `a2b8a92`. This is not installed-app or release evidence.

D7 adds acceptance evidence and changes no product code or migration:
- **Whole workflow (UI integration, synthetic data):**
  - plan budget, Why this, Skip and Start;
  - quick debrief with an action linked to a material and an edited question carried to a lesson;
  - the action on the material page and the question in lesson preparation;
  - the flight log intact in the full editor;
  - action completed and question answered through the UI;
  - the original operation retried with nothing undone;
  - restart by reopening the database file;
  - linked sources deleted, with honest "unavailable" labels;
  - cancel and failed-save behaviour.
- **Upgrade:** a realistic v9 dataset upgraded to migration 10, with nothing lost, nothing invented, migrations run once, and fresh install still working. Tested in TypeScript and against the registered Rust migration list.
- **Complete backup:** the real native pipeline, including a managed PDF, the daily plan, progress, provenance and the ledger; retrying after restore changes nothing.
- **Offline evidence (frontend only):** the tested workflow made zero `fetch` or `XMLHttpRequest` calls.
- **Native offline behaviour: UNVERIFIED.** It has not been exercised with networking disabled or blocked. The structural test `listed_modules_do_not_reference_reqwest_directly_outside_gemini` only confirms that the production code of the listed Rust modules doesn't reference `reqwest` directly (and `gemini.rs` does). It can't show that those paths never use the network another way.

No product defects were found.

**Independent review (Codex), separate from the implementation results:**
- `npx vitest run src/acceptance/`: 2 files, 4 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml debrief`: 15 passed.
- `git diff --check`: clean.
- Local NSIS artifact SHA-256 matches the documented checksum. This is not malware clearance or installation evidence, and that retired-`0.5.2` artifact must not be distributed.

No product-code blocker was found. See [the D7 acceptance note](docs/M1_D7_ACCEPTANCE_2026-09-27.md).

**Not verified:**
- **Windows desktop smoke:** the app was not launched, because this machine holds a real Her Flight Deck profile and no isolated profile could be verified.
- **Apple Silicon installed app:** no Mac available.
- **Live offline run of the desktop app:** not performed.

The Windows release hold and the retired `0.5.2` policy are unchanged.

## M1 D6 — Connect improvement → action → study material → instructor question (26–27 September 2026)

The debrief form can turn "What was difficult?" or "Instructor feedback" into an action she edits and accepts. It can link that action to a Study Library material. It can also save the debrief question with a material and carry it to an upcoming lesson, where it appears in lesson preparation. Nothing is accepted without her ticking the box.

After the first independent review:
- **One save contract.** The form, TypeScript, the Tauri adapter, Rust (which rejects unknown fields) and the browser transaction all use the same shape. Fixtures captured from the real form are replayed by both implementations, and both must produce the same rows.
- **Retries are safe.** A retry of an operation that already committed changes nothing, so it can't undo a completed action or an answered question. A deliberate edit writes only the action title and material, and the question text and links.
- **Deletion is honest.** Deleting a material, lesson or debrief keeps the action and question, and remembers the deleted source (migration 0010, unshipped), so the UI can say "Source … unavailable" instead of acting as if it was never linked.
- **Evidence.** The real complete-backup round trip is tested in Rust. A driver without atomic support can no longer report a successful save.

Implementation checks (Windows x64, not independent review):
- `npm test`: 528 passed, 2 skipped;
- `npm run build`: clean;
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: clean;
- `cargo test`: 153 passed, 2 ignored.

Status: Merged through PR #35 (`1d86d57`) alongside D7 acceptance and performance polish. No installed-app verification has been performed on Windows or a Mac. See [the D6 note](docs/M1_D6_DEBRIEF_LINKS_2026-09-26.md).

## M1 D5 — Quick debrief mode in existing journal flow (26 September 2026)

Added a clearly labeled **Quick debrief** mode to the existing Flight Journal flow:
- **Fast reflection entry:** Quick mode exposes only the essential post-flight reflection fields: date, scheduled lesson link, title, "What went well?", "What was difficult?", instructor feedback, confidence rating (1–5), and "Questions for next time". Flight-time categories, aircraft details, routes, and landings remain hidden so she can record impressions immediately after landing while fresh.
- **Entry points:** Available from the Flight Journal header ("Quick debrief"), the "Lessons without a debrief" awaiting list ("Quick debrief"), the Schedule event detail view ("Quick debrief"), and the Journal Entry detail view ("Quick debrief").
- **Seamless round trip:** A toggle chip ("Quick debrief" vs. "Full flight log & debrief") at the top of the form switches modes in place without losing any typed reflections or inputs. Entries saved in quick mode can be reopened in the full log editor at any time to add flight times and aircraft details.
- **Strict preservation of hidden fields & intentional mode switch edits:** When saving edits in quick debrief mode on an existing entry, fields unexposed by quick mode are preserved from the existing record. If the pilot switches to full mode during the editing session to intentionally update, change, or clear any numeric, text, or relationship fields (e.g. updating `totalTime` to 2.5, changing `aircraftId`, clearing `mission`, or clearing `goalId`), and then switches back to quick mode, those intentional edits survive and are saved to SQLite. Untouched hidden fields remain strictly preserved from existing records.
- **Explicit acceptance & ownership of derived records:** Both `addToPlan` and `saveQuestion` start unchecked (`false`). Reflection text alone never creates a separate instructor question or action. When opted in, the review card displays the exact editable text that will be saved; clearing the review field creates nothing (no invisible fallback to reflection text). Recovered drafts from interrupted sessions never silently accept derived records.
- **Explicit ownership over broad linked-record reconciliation:** The form strictly updates or deletes only records demonstrably created by this specific draft attempt (`draft.createdActionId` and `draft.createdQuestionId`). A shared journal ID or absence from a mount-time snapshot is not proof of ownership. Independently created actions and questions linked to the same journal are never overwritten or deleted by ordinary reflection edits. When approval is explicitly withdrawn by unchecking or clearing, only the owned record is removed; if ownership cannot be established, the record is preserved rather than guessed.
- **Complete user-authored next-step text recovery:** User-entered next-action titles, separately edited question review text, and question edit status (`questionEdited`) are saved and recovered alongside the journal draft. Intentional blank edits are preserved across unmount/reopen cycles without snapping back to reflection text. Legacy drafts without next-step fields remain fully compatible, and "Start fresh" consistently clears all recovery state.
- **Durable pre-write save identity & idempotency:** Pre-assigns stable IDs (`targetId`, `targetActionId`, `targetQuestionId`) and persists them to draft storage (`writeDraft`) *before* executing database mutations. Interruption at any commit boundary (after journal, after action, or after question write) recovers identical IDs, turning retries into idempotent updates without duplicate records. If draft storage write fails, saving halts immediately before touching the database.
- **Save-time control disabling & edit preservation:** Accessible disabled controls (`disabled={isSaving}` and `<fieldset disabled={isSaving} aria-busy={isSaving}>`) prevent mid-save editing. Error catch blocks no longer overwrite active user state with stale closure snapshots. If deferred writes succeed while newer edits are pending, unsaved edits are preserved without discarding or prematurely navigating away.
- **Duplicate submission prevention & safe retry:** Buttons and controls disable during save, showing "Saving…" and ignoring rapid clicks. Save errors preserve entered draft text and display an error alert.
- **Persistence & cancellation:** Cancellation leaves SQLite completely unmodified (0 writes). Data persists across database close and restart with complete foreign key and relational integrity. No database migrations required (uses existing schema).

Status: Merged through PR #34 (`0ad0a578eca73e43dc48438bd4ed3278053433bc`). All 52 test files passed (508 tests passed, 2 benchmarks skipped), including 21 focused integration and regression tests in `src/pages/FlightJournal/quickDebrief.test.ts`. `npm run build` completed with 0 errors. Physical installed-app verification on Mac hardware has not been performed. See [the D5 implementation note](docs/M1_D5_QUICK_DEBRIEF_2026-09-26.md).

## M1 D3–D4 — Daily Flight Plan and saved daily decisions (26 September 2026)

Flight Deck now opens with a **Daily Flight Plan** card. She can:
- choose a 10-, 20- or 30-minute (or untimed) plan;
- read why each suggestion is there;
- press **Start**, **Skip today** or **Move to tomorrow** on each item.

Unfinished work stays under "Remaining unfinished work".

How it behaves:
- **Stable sessions.** The day's session keeps its saved order. New or higher-priority work waits until **Refresh**, a budget change or the next local day. A completed, deleted, skipped or deferred item's slot is the only one refilled.
- **Skip and defer are planner-only** and never change a due date. Both expire at local midnight, which the card notices while open and after sleep or backgrounding.
- **Saving.** Decisions are stored in the existing `app_metadata` table (no migration). Each change is computed from the stored plan inside the serialized write queue, so quick clicks can't overwrite each other, and a failed save leaves the previous plan untouched.
- **Start safety.** Start never lands on a deleted record, and it focuses a Flight Deck action's own control.

Status: Merged through PR #33 (`4e2651c`). All 62 focused tests independently rerun and verified. D1–D2 merged through PR #32 at `e938f84`. Installed-app behaviour has not been verified on Windows or a Mac. See [the D3–D4 behaviour and evidence note](docs/M1_D3_D4_DAILY_PLAN_2026-09-26.md).

## M1 D1–D2 — Daily Flight Plan recommendations and debrief characterization (25 September 2026)

Debrief persistence across normal user edits, SQLite disk reloads, and parent deletion has been characterized against real SQLite persistence in `src/logic/debriefCharacterization.test.ts` (D1). When a debrief journal entry is deleted, SQLite's foreign key `ON DELETE SET NULL` clears `question.journal_id`, whereas `next_actions.related_id` survives as a dangling reference without foreign key cascade. Debrief-created questions omit `eventId` (`null`), so `lessonPreparation` excludes them from upcoming lesson prep lines until explicitly linked (identified for future D6 work). Debrief actions lack direct associations with Study Library materials (future D6).

The pure recommendation selector has been implemented in `src/logic/recommendations.ts` with tests in `src/logic/recommendations.test.ts` (D2). It enforces strict deterministic priority tiers: 1. User-pinned work -> 2. Due actions (overdue oldest first, then due today) -> 3. Next-lesson prep -> 4. Study -> 5. Open actions. Tie-breaking is deterministic down to title and unique ID. When a time budget (10, 20, 30 min) is requested, tasks with unknown durations are kept visibly unknown without fabricated durations or zero-minute representation and remain reachable in priority order without falsely claiming the entire session fits the budget. When any suggested item has an unknown duration, timed items disclose known allocations explicitly as estimates without claiming guaranteed session fits or remaining time. Deleted/archived debrief parents fall back safely to unlinked action/question explanations to prevent dangling links. The selector is 100% pure (zero database writes, zero silent action acceptance, zero skill proficiency mutations, zero clock dependency).

Status: Merged through PR #32 at `e938f84`. D3–D4 are described above. See [the D1–D2 implementation and validation note](docs/M1_D1_D2_RECOMMENDATIONS_2026-09-25.md).

## M1 D0 — Study Library file check (25 September 2026)

Merged through PR #31 at `193d3e1`. Settings now has a **Check library** action that compares Study Library file references with files in app-owned storage. It lists missing files for re-attachment and unlinked files for import as new materials or an explicit move to private trash. Re-attachment retains the existing material and its notes, guide, flashcards, and practice history. Native repair commands recheck the file and database state inside bounded SQLite transactions and refuse to move referenced files to trash. The scan fails visibly on unreadable database or trash metadata rather than presenting an incomplete report as healthy. The scan and repair commands run off the UI thread, and the Settings list renders 50 results at a time.

The private-trash Undo action lasts until app restart. Startup cleanup purges unreferenced staged files by existing design; this is a reversible short undo, not a permanent recycle bin. The UI says so. A complete backup excludes unlinked files, so any needed file should be imported or re-attached before relying on a new backup. See [the implementation and validation note](docs/M1_D0_LIBRARY_CHECK_2026-09-25.md). Installed-app behavior on Apple Silicon remains unverified, and the release hold is unchanged.

## Release status

Version `0.5.2` was prepared on 14 September 2026 and withdrawn the same day following an unresolved Windows Defender detection (`Trojan:Win32/Wacatac.B!ml`). Per repository release policy (`scripts/release-policy.json`) and automated validation checks, version `0.5.2` is **permanently retired and must never be reused, re-tagged, or published**. The latest distributable Windows release remains `v0.5.1` (held pending separate Microsoft Defender review). Under the revised release policy, the unresolved Windows Defender review blocks **Windows distribution only**; an independent **Mac-only release pathway** is active for candidate `v0.5.3`. A Mac candidate may be released once its independent Apple Silicon hardware smoke test and draft verification pass per [the release review process](docs/RELEASE_REVIEW_PROCESS.md), without waiting for Microsoft Defender resolution. Windows distribution remains held on `v0.5.1` until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved. Paid code signing is the long-term path, but is not mandatory if Microsoft clears the exact binary.

## Release-safety hardening update (24 September 2026)

Following release-safety corrections for data protection, deletion recovery, and workflow efficiency:

- **Complete backup consistency across SQLite and managed documents:**
  - Format-v3 backup export handles pre-existing database and document inconsistencies cleanly: referenced documents missing from disk are allowed and recorded in `manifest.missing_at_export` (reported in `missing_documents`); unreferenced orphan files on disk are excluded from the archive (preventing backup drift) and reported in `unreferenced_documents`. In the UI, Settings displays a plain-language summary naming any omitted missing files (by material title or file name) and advising she can re-attach them in the Study Library, notes any unreferenced files excluded, and both Settings and DataRecovery restore preview dialogs call out any files that were already missing when the backup was made.
  - If recording the backup reminder in app settings fails after an archive is finalized and verified, Settings retains and displays the full missing-document and unreferenced-file warnings alongside the reminder update notice.
  - Preserves restore compatibility with existing format-v2 archives: older v2 exports that included unreferenced documents or omitted files already missing from storage continue to inspect and restore with those differences disclosed. SHA-256 integrity for archived files, path safety, and size limits remain enforced; strict two-way document completeness applies to format v3.
  - Differentiates pre-existing missing files from mid-export deletions by scanning documents before and after taking the database snapshot: a referenced file is treated as pre-existing missing only if absent from both scans; a referenced file present before the snapshot and gone after, or currently staged in `documents/.trash`, triggers a transient retry. Mid-export document mutations or unexpected file appearances are likewise refused with bounded retry (`COMPLETE_BACKUP_RETRIES = 3`, 200 ms interval) executing safely off the UI thread via `spawn_blocking`.
  - Atomic `.part` file finalization protects existing valid backups, ensuring the original is restored untouched if an export fails.
  - Deterministic Rust regression tests verify in-flight disappearing documents (pre-collection and mid-collection), staged deletions in progress, corrupt staged metadata, in-flight appearing files, in-flight mutation, bounded retry exhaustion, format-v3 completeness enforcement, old-style v2 restore, missing-document export/restore, and orphan exclusion.
- **Recoverable Study Library deletion:**
  - Two-phase staged deletion: managed files are moved to private trash (`documents/.trash`) before SQLite database records are deleted.
  - Traversal defense: `validate_staged_id` rejects path separators, `..`, colons, and NUL bytes on commit/rollback; metadata `original_relative_path` is validated against directory traversal before restoration.
  - Safe against destination path collisions: explicit rollback (`rollback_delete_document_in`) and startup recovery (`cleanup_staged_deletions_in`) use an atomic no-replace operation (`renamex_np` with `RENAME_EXCL` on macOS; `renameat2` with `RENAME_NOREPLACE` on Linux; `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows) to eliminate TOCTOU overwrite windows. If the destination path already exists, neither replaces the existing file, both the destination and staged copy in `.trash` (including `.meta`) are preserved intact and recoverable, and the conflict is reported.
  - Schema safety on startup: `cleanup_staged_deletions` refuses to purge staged files if the database is readable but the expected `study_materials` table or `file_path` column is missing or invalid, keeping staged copies safe until a valid schema is present.
  - Frontend lifecycle extracted to `removeMaterialWithFile`: staging failure leaves the database record untouched with an actionable retry message; database deletion failure rolls back the staged file; successful database deletion commits/purges trash; materials without files or with already-missing files proceed safely. Undo cancels the pending delete, and only the commit path calls `removeMaterialWithFile`.
  - Deleting a material whose file is locked (e.g. open in a PDF viewer on Windows) fails safely by design: staging fails, the record and file are kept, and she is prompted to close the file and try again.
  - Startup recovery hook `cleanup_staged_deletions` reconciles `.trash` with the active database, restoring documents if the database record still exists (crash before DB update) or purging staged files if the record is gone (crash after DB update). If restore rename fails or the database is missing, unreadable, or corrupted, it logs and safely leaves staged files untouched.
  - Preserves 7-second undo behavior without premature file deletion.
  - Added unit tests in `documents.rs` and frontend lifecycle tests in `documents.test.ts` verifying all failure and recovery branches.
- **GitHub Actions release gate & concurrency:**
  - Release workflow (`.github/workflows/release.yml`) configures `cancel-in-progress: false` grouped by workflow and version/ref so in-progress release builds and packaging jobs are never cancelled by subsequent runs.
  - Added a full Rust validation gate on Linux CI before packaging: installs required Linux desktop development libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `libxdo-dev`) and runs `cargo test` as an authoritative pre-packaging gate.
  - Streamlined `checks.yml` with a lightweight verification path for documentation-only pull requests while strictly preserving the single required check status (`Tests, types, and the data-safety guards`). The docs filter is strictly scoped to actual documentation paths (`LICENSE(\.txt)?$`, `docs/`, etc.) so arbitrary text changes (config or test fixtures) cannot skip required CI checks.
  - Eliminated redundant frontend and Rust test suite executions on macOS and Windows packaging runners in `build-desktop.yml` and `release.yml`, refocusing runner minutes on platform packaging and metadata verification (including Windows NSIS installer verification).
- **Dependency findings confirmation:**
  - Confirmed `glib 0.18.5` is absent on Windows/macOS and present solely in the Linux GTK development/CI graph.
  - Confirmed `rsa 0.9.10` (RUSTSEC-2023-0071) is absent from the resolved dependency graph for all release targets (`cargo tree --target all -i rsa` produces no paths). `.cargo/audit.toml` ignores this finding so `cargo audit` runs cleanly.
  - Confirmed `ttf-parser 0.25.1` is transitive exclusively through `lopdf`.
  - Confirmed `keyring` is restricted solely to legacy secret migration in `gemini.rs`. No speculative replacements.
- **Validation evidence:** On Windows x64: `npm test` passed 405 tests across 45 test files (2 benchmarks skipped); `npm run build` completed with 0 errors; `cargo test` passed 128 tests (2 benchmarks ignored); `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed cleanly with 0 warnings.
- **Mac-only uncertainty:** The desktop app is **not declared ready for Mac** without an installed Apple Silicon smoke test. In particular, native file dialogs, Finder reveal, local backup creation and restore, and PDF/Study Library viewer interactions require hands-on physical verification on Apple Silicon hardware.

## Pre-release audit update (24 September 2026)

A full pre-release readiness audit was completed following the Study Library file-lifecycle fixes (PR #27) and Gemini workflow hardening (PR #28). See [the comprehensive audit report](docs/PRE_RELEASE_AUDIT_2026-09-24.md) for full architectural reviews, security boundaries, and validation evidence.

- **Dependency audit status:**
  - `rustls 0.23.43` was upgraded to `0.23.45` via `cargo update -p rustls`. `cargo audit` confirms RUSTSEC-2026-0285 (TLS 1.3 handshake acceptance across encryption level boundaries) no longer appears in the advisory scan. The full test and build matrix provides evidence that no regressions were introduced.
  - Current `cargo audit` is not fully clean: it exits with one vulnerability finding for `rsa 0.9.10` (RUSTSEC-2023-0071, Marvin timing sidechannel), for which no patched stable release exists upstream.
  - Shipped-build exposure to `rsa` is absent: both `cargo tree -i rsa` and `cargo tree --target all -i rsa` print no path. The package remains in `Cargo.lock` through optional SQLx/MySQL dependency metadata, but is not present in the resolved dependency graph for the project's current SQLite-only feature set (`tauri-plugin-sql = { features = ["sqlite"] }`).
  - Informational maintenance warnings in `cargo audit` (not exploitable security vulnerabilities): `ttf-parser 0.25.1` is unmaintained and present through `lopdf` (tracked for future `lopdf` updates); `glib 0.18.5` has an unsoundness advisory in the Linux GTK dependency graph (tracked for Linux development/CI, though Linux is not a release artifact); and `proc-macro-error 1.0.4` and the `unic-* 0.9.0` crates are unmaintained transitive/build dependencies (tracked through upstream Tauri updates).
- **Workflow & Lifecycle verification:** Confirmed app-owned storage (`DOCUMENTS_DIR`), capability-scoped Open/Reveal (`opener:allow-open-path`), automatic/manual splitting limits and SQLite single-connection transactions (`save_split_materials`), v2 backup SHA-256 integrity inventory, and full component-wide Gemini lock mutual exclusion with stale result rejection.
- **Accessibility & UX:** Verified practice-test WAI-ARIA roving tabIndex radio group keyboard navigation, focus management, scoring, and retake behavior.
- **Validation evidence:** On Windows x64: `npm ci` passed (0 vulnerabilities); `npm test` passed 388 tests across 45 test files (2 benchmarks skipped); `npm run build` completed in 2.09s with 0 errors; `cargo fmt --check` passed cleanly; `cargo clippy --all-targets -- -D warnings` passed with 0 warnings; `cargo test` passed 100 tests (2 benchmarks ignored); Windows NSIS installer packaged successfully (`src-tauri/target/release/bundle/nsis/Her Flight Deck_0.5.2_x64-setup.exe`).
- **Release posture:** The Windows hold remains in effect due to the unresolved detection until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved; Mac builds require physical Apple Silicon hardware smoke testing before distribution. No release or tag was created.

## Release safety & accessibility update (23 September 2026)

Following a comprehensive release safety audit:
- **Retired version rejection:** Version `0.5.2` is registered as permanently retired in `scripts/release-policy.json`. A dependency-free validator `scripts/check-release-version.mjs` enforces this policy across `.github/workflows/release.yml` and `scripts/release.sh`. Seven automated regression tests in `src/logic/releaseSafety.test.ts` verify that `0.5.2` is rejected, malformed versions are rejected, valid non-retired versions (such as `0.5.3`) are accepted, and both entry points call the validator.
- **Security bypass instructions removed:** `README.md` and `STATUS.md` no longer instruct users to bypass macOS quarantine via `xattr -dr`, click past SmartScreen, or lower browser Safe Browsing settings. The policy mandates that flagged installers remain private drafts for vendor submission and analysis.
- **Documentation corrections:** `docs/RELEASE_PREP_0.5.2.md` and `docs/releases/v0.5.2.md` are marked as withdrawn historical records with actionable release/tag commands disabled. `docs/PROJECT_AUDIT_2026-09-14.md` accurately documents the Gemini credential lifecycle (webview input and React state, transmission via Tauri IPC, storage in restricted OS app data, and never returned to the webview).
- **Pilot Toolkit accessibility repair:** Implemented the full WAI-ARIA tabs specification in `src/pages/PilotToolkit/PilotToolkit.tsx`: stable tab/panel IDs, `role="tabpanel"`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, ArrowLeft/ArrowRight navigation with wrap-around, Home/End keys, and focus synchronization. Six unit tests in `src/pages/PilotToolkit/PilotToolkit.test.ts` verify all ARIA relationships and keyboard behaviors.
- **Validation evidence:** On Windows x64, `npm ci` passed with 0 vulnerabilities; `npm test` passed 350 tests across 42 test files (2 manual benchmarks skipped); `npm run build` passed with 0 errors; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` passed 88 Rust tests (2 intentionally ignored benchmarks).

## Windows release on hold: Defender flags the installer as Wacatac.B!ml

`v0.5.2`'s Windows installer (`Her Flight Deck_0.5.2_x64-setup.exe`,
`sha256:12f6cd530b0301e67bce952bd20fff27b1fa4fb8760cfe4579721e940e7f8a8b`) was
flagged by Windows Defender as `Trojan:Win32/Wacatac.B!ml` on download,
including a direct download from the GitHub Release — reported by hand,
without the file being run. The release and its tag were withdrawn the same
day; nothing currently published carries this build.

The installer was flagged with detection `Trojan:Win32/Wacatac.B!ml`. Under the
repository release policy, an unresolved security detection is treated as a release
blocker rather than assumed clean. The Windows installer remains unpublished until one of these closes it:

- Microsoft's file-submission review authoritatively clears the specific binary
  (https://www.microsoft.com/wdsi/filesubmission, "Software developer"
  dispute) — the usual path, typically resolved in a few days, or
- the Windows installer is code-signed, which removes the dominant trigger
  for this class of detection outright.

Paid code signing is the long-term path, but is not mandatory if Microsoft
clears the exact binary. Physical installed-application validation on both
Windows and Apple Silicon hardware remains mandatory before distribution.

Per the engineering rules, `v0.5.2`'s tag cannot be reused once it existed —
a Windows-fit release after this is cleared ships as `0.5.3` or later, built
fresh, checksummed again, and re-verified before publishing. The macOS
`.dmg` was not flagged and is not affected by this hold.

## Performance polish update

The 13 September pass bounds Study Library rendering to 100 cards at a time while still searching, filtering, and sorting the whole library. A synthetic 5,000-material server-render benchmark on Windows fell from 437 ms to 8 ms median; this does not measure a painted desktop window. The PDF splitter now batches page-reference removal; a synthetic 3,000-page window plus five candidates fell from 26.74 s to 0.085 s, with byte-equivalent output tests for simple, nested, and image-bearing PDFs. Import and backup disk work now run outside Tauri's UI thread. See [the detailed measurement and validation note](docs/PERFORMANCE_POLISH_2026-09-13.md). The installed Mac app still requires hands-on testing, and no release was published.

## App polish update

The current polish pass reduces the first-screen JavaScript bundle by loading other sections when opened, keeps Settings and Search visible in compact windows, prevents long-running PDF work from being dismissed mid-operation, and cleans up file imports abandoned before a material is saved. The manual page-range form now rejects fractional input, and a backup that was finalized successfully no longer reports itself as failed solely because the separate reminder write failed. See [the polish note](docs/APP_POLISH_2026-09-12.md) for checks and remaining device verification. No release tag was changed.

## macOS audit update

See [the 12 September audit](docs/MAC_AUDIT_2026-09-12.md) for test evidence and the required Mac installation checklist. The audit found that schema 9 (practice tests) made complete backups reject the app's own database, and that automatic split records used a transaction across pooled SQL connections. Both are fixed. Manual split records now use the same atomic write, and manual safety copies use SQLite's online snapshot. An Apple Silicon runner built and inspected the DMG, and Windows produced an installer. The Mac app is **not yet declared ready**: hands-on installation/open/Finder/backup/restore checks remain necessary.

## Current position

Her Flight Deck is a private Tauri 2 desktop application with Windows and Apple Silicon installers. Release `v0.5.1` is published. It organizes flight training plans, lessons, study material, notes, questions, flight records, finances, reminders, and career preparation in one local application. The Apple Silicon package builds, but its installed behavior has not been verified on a Mac.

Uploaded files and generated PDF parts are copied into app-owned storage. Large PDFs can be split automatically into labeled parts within Gemini's 50 MiB and 1,000-page limits, with an independent study guide for every part. Automatic splitting now windows each part before its size candidates are tried, instead of re-cloning and re-writing the whole remaining book per candidate — a synthetic 3,000-page benchmark measured roughly 4.4x less wall time for the same output (`cargo test ... -- --ignored --nocapture` on `windowing_is_substantially_faster_than_reprocessing_the_whole_book_per_candidate`), and the app now shows which part/page range is being read or written while it runs. The Study Library **Open** capability is scoped to app-owned documents, but opening a PDF from the packaged app in Preview still needs a real Mac smoke test.

Gemini can also generate an optional multiple-choice practice test from the selected study document, saved locally beside its study guide and flashcards, with malformed or out-of-range answers filtered out before they ever reach the quiz screen.

Complete `.hfdbackup` exports contain the SQLite library and managed documents. Format version 3 adds two-way reference completeness and declared missing documents on top of format version 2's SHA-256 inventory, online SQLite snapshot, staged database integrity/schema checks, and strict hostile-archive limits. Versions 1 and 2 remain supported for restore.

## Desktop release

- Latest release: `v0.5.1`
- Release commit: `2dbf6df3f66b18e087b5842fc554f8e733255a0e`
- Windows installer: published
- Apple silicon macOS DMG: published
- Installers: unsigned
- Automatic updater: not implemented

### Release safety hold

The attempted `v0.5.2` Windows installer was withdrawn after Microsoft
Defender detected it as `Trojan:Win32/Wacatac.B!ml`. It was not executed.
Microsoft Security Intelligence submission `9656710a-e9d3-4c15-83dc-9b9f3451be8b`
is pending analysis. In accordance with `scripts/release-policy.json`, version
`0.5.2` is permanently retired and will never be published or reused. A Mac-only
candidate may advance at `0.5.3` after the exact draft DMG passes physical Apple
Silicon validation. Windows distribution remains held on `v0.5.1` until the
exact future Windows installer receives authoritative Microsoft clearance or
trusted code signing and passes installed-app testing. Paid Windows signing is
the long-term path, but is not mandatory if Microsoft clears the exact binary.
By default, browser workflow runs produce private CI artifacts. Selecting
`create_draft: true` creates a private release draft targeting that commit with
checksums; review and test those exact assets using
[the release review process](docs/RELEASE_REVIEW_PROCESS.md) before publishing.

Installing a newer version over an existing installation preserves app data and creates an automatic database safety copy before migrations run. A complete backup should still be saved separately before an update or computer transfer.

## iOS project

The iOS effort is active and documented in `docs/ios/`, `docs/backup-format.md`, and `docs/BACKUP_MERGE_DESIGN.md`. Milestones 1 and 2 cover architecture, compatibility, platform boundaries, and desktop backup hardening. An iOS-readiness preparation pass established isolated `CredentialStore` trait and desktop adapter scaffolding in `platform.rs`, while active credential operations remain on desktop `secrets` and Keychain implementation is deferred until real Mac/Xcode/device validation. There is no runnable iOS app yet.

Milestone 3 requires a Mac with Xcode to initialize and validate Tauri's Apple project, implement Files/AirDrop import, Keychain, Quick Look, sharing, and the iOS restore lifecycle. Milestone 4 covers iPhone/iPad layout, device memory testing, CI, signing, TestFlight, and App Store preparation.

## Engineering rules

- Do not change `com.herflightdeck.app` without a deliberate data migration.
- Never edit a shipped migration; add the next numbered migration, register it in Rust and TypeScript, and record its checksum.
- Increase all application-version sources before publishing a new release.
- Never move an existing release tag or rebuild a published version number.
- Never embed, log, back up, or return the Gemini key to the webview.
- Keep monetary values as integer cents.
- Keep Gemini submission explicit and limited to the selected study file.
- Keep aviation safety guidance visible around generated material.
- Do not expose backup Merge until its conflict and rollback behavior is fully implemented and tested.
- Do not claim iOS, TestFlight, or App Store readiness without real Apple build and device evidence.

## Remaining hands-on checks

- Install the current desktop build over populated prior-version data.
- Import, reopen, split, back up, and restore non-sensitive test documents using native Windows and macOS dialogs.
- Verify the Study Library **Open** button and **Show in Finder or File Explorer** on a real macOS build — the capability-scope fix is covered by a test that reads `capabilities/default.json` itself, but has not run inside an actual signed or unsigned `.app`.
- Connect a real Gemini key and generate one study aid and one practice test from a public test PDF.
- Confirm unsigned first-launch instructions on both desktop platforms.
- Complete the Apple-only checklist before distributing an iOS build.
- Time automatic splitting against a real large or image-heavy handbook, not only the synthetic benchmark used during development — the windowing fix is measured, but only against a page-count-only synthetic PDF (see "Known limitation" below).

## SQLite lock reliability

Earlier work addressed SQLite contention and opener scopes. The 12 September
audit found two further data-safety gaps; see the audit note for reproduction.

- The live database was left in SQLite's default rollback-journal mode, so
  any write held a lock that blocked *every* reader too, not only other
  writers. It now runs in WAL mode (set once at startup, a property of the
  database file itself, so it applies pool-wide and to every future launch).
- The Rust side's own `rusqlite` connections — used to verify a database and
  to take a backup's online snapshot — opened with no busy timeout at all,
  unlike the app's main connection pool, which already gets one from its own
  driver by default. A lock briefly held by an ordinary write failed these
  instantly instead of just waiting the moment out. They now get an explicit
  five-second timeout, and `create_complete_backup`'s snapshot step retries
  up to three more times, with a short backoff, if it is still a lock
  (never for any other kind of failure, and never unboundedly — a
  regression test holds a lock that never clears and confirms the export
  still gives up, with a plain message, within forty seconds).

Saving a split's parts now uses a single native SQLite transaction instead of
pooled SQL statements, with bounded retries if another write holds a lock.
Manual splits use that same transaction and take an online safety snapshot.
A backup export now also reads its own
finished `.hfdbackup` back and runs it through the same validation a restore
would — readable archive, manifest, integrity inventory — before renaming it
into place or reporting success; a failure there leaves any backup already
at that destination untouched.

Settings' **Open folder** button was refused by the same capability-scope
gap the Study Library **Open** button was fixed for earlier in this pass, for
the whole data directory rather than a file inside it — `opener:allow-open-path`
is now scoped to `$APPCONFIG` as well as `$APPCONFIG/documents/**`, and the
button now shows a real error if the OS still refuses the request instead of
failing silently.

## Manual chapter extraction

Alongside automatic splitting, **Take out a chapter** takes one exact page
range by hand — first page, last page, an optional title. The existing
`split_pdf` command already refused a range past 1,000 pages; it now also
measures the actual result and refuses one over 50 MiB (illustrated pages
can land over the byte limit well before the page limit does), naming the
size and suggesting a smaller range, and removes the oversized file rather
than leaving it stored. A safety copy of the database is taken before
anything else changes — no file is written and no record is touched until
one exists — and if saving the new material's record fails after the file
is written, the file is removed the same way automatic splitting's own
rollback already works. The extracted chapter is an ordinary Study Library
item: its own study guide, its own practice test, its page range recorded
in its notes, the source handbook untouched.

## Known limitation: browser reputation and unsigned binaries

Neither installer is currently code-signed, so fresh unsigned binaries lack
reputation history and can trigger browser Safe Browsing or Windows
SmartScreen warnings. Under the release review policy, flagged or blocked
installers must never be bypassed by instructing users to force-keep files or
lower security protection settings. Draft installers remain private during
review. The Windows hold may be resolved by authoritative Microsoft clearance of
the exact installer or by trusted code signing (the long-term path, though not
mandatory if Microsoft clears the exact binary). Physical installed-app validation
on Windows and Apple Silicon hardware remains mandatory before distribution.
Published SHA-256 checksums confirm transfer integrity, but do not substitute for
platform clearance.

## Still requiring a Mac

The installed-app checklist and the transient Gemini-key webview issue are
recorded in `docs/MAC_AUDIT_2026-09-12.md`. No Mac readiness claim is made.

## Known limitation: automatic splitting's remaining bottleneck

Automatic splitting in `pdf.rs` uses `delete_pages_batch`, which batches page-tree count decrements and removes unwanted page references in a single traversal, eliminating `lopdf::delete_pages`'s quadratic per-page object-graph sweep. Windowing further bounds the working document to ≤1,000 pages per part with in-memory candidate evaluation rather than writing size trials to disk. The remaining cost for very large books is `lopdf`'s clone-and-prune approach (cloning the document tree and deleting excluded objects) rather than constructing each part by copying forward only the objects reachable from its kept pages — a larger, separately risky architecture not attempted in this pass.

## Living macOS parity tracker

Track Mac implementation follow-ups, feature parity, installed-app checks, and performance evidence in [MAC_PARITY_CHECKLIST.md](docs/MAC_PARITY_CHECKLIST.md). Update it when shared or Windows work affects Mac behavior. Unverified Mac checks remain open; shared tests and package builds do not establish installed-app readiness.
