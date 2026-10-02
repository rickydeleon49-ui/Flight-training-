# Fourth independent review: remaining restore boundaries

Date: 30 September 2026. Reviewer: Codex. **Decision: changes requested; A1 remains OPEN. Do not commit, push or merge this repair yet.**

## Reviewed state and evidence boundary

Repository `H:\Ai Repo clones\Flight-training-`, GitHub `rickydeleon49-ui/Flight-training-`, branch `fix/restore-retention-restart-safety`, HEAD/base `053af1fcd1429888300060f780a10d68adc81c5b`.

Reviewed `src-tauri/src/backup.rs` SHA-256: `3994eb948e4b35d5c2fad36951b2c994b1fd66e09871db99cd9d51b0c7d37157`, matching the handoff. Temporary review assertions were inserted into its native test module, executed, and removed with guarded exact-byte restoration. No application implementation was changed by Codex. Existing uncommitted implementation and the three historical review notes remain preserved; this review adds documentation only.

All new checks use disposable synthetic profiles. The external-folder case means a separate synthetic directory, not any real user directory. Fixtures were cleaned before final assertions, including explicitly unlinking the test junction if it remained. No owner application-data profile, live Gemini request, installed Windows application or Mac hardware was used. No CI, commit, push, PR, merge, version/tag/release change or candidate replacement occurred. Date follows the client date, 30 September; the Windows clock gives later UTC dates in some generated fixture paths.

## Independently verified progress

- All five previous `backup::tests::round3_*` cases pass: **5 passed, 0 failed**, exit 0, 0.39s test time.
- The complete existing backup suite passes: **107 passed, 0 failed, 0 ignored**, exit 0, 30.76s test time. This includes earlier reviewer regressions and new task tests.
- Recovered nonempty document manifests now compare recorded names, sizes and hashes; the previously tested changed/missing PDFs and active document junction are blocked.
- Corrupted ownership JSON no longer defaults to blanket deletion permission. The tested mismatched/empty-ID cases are blocked.
- Scoped fault hooks compile only under `cfg(test)`. No production webview/global/environment test backdoor was introduced. Unix directory syncing was moved after canonical journal replacement, though its errors remain ignored and Windows cannot test that code.

These are useful corrections. Four additional independent checks fail: **0 passed, 4 failed**, exit 1, runtime 0.42s after compilation in 2m54s. All reach production behavior assertions; none fails because of compilation or fixture setup.

## Confirmed findings

### F1 — P1: a linked pending root lets startup move external files into the app

Locations: `src-tauri/src/backup.rs:3277–3295`, `3341–3352`, `3438`, `3459–3470`, `3518–3523`. Checked cleanup ownership at `2408` is not used to authorize the initial install path.

`apply_pending_restore_in_internal` starts with `pending.is_dir()` and follows paths beneath it before checking whether the pending directory itself is a junction/symlink. The document inventory checks its own directory argument, but that does not inspect the linked parent `.restore-pending`. SQLite verification, DB reads and install moves therefore operate on the external target. The successful install path also removes pending without its no-follow/ownership helper.

Native full-flow reproduction:

1. Create an active synthetic original DB and document.
2. Create a separate synthetic directory with a valid application DB, document and complete restore plan.
3. Put a real Windows junction at `root/.restore-pending`, pointing to that separate directory.
4. Invoke actual startup recovery without an injected journal or mocked install result.

Observed: `RestoreCompleted`; external DB and documents are no longer at their original paths (`external_db_preserved=false`, `external_docs_preserved=false`); active DB is replaced (`active_db_preserved=false`); its row is `external sentinel row`. The files were moved into active storage, not proven destroyed. The original active dataset remains in its normal safety copy. This is a corrupted/linked staging-root reproduction; no claim is made that the ordinary archive extractor creates a junction or that a remote attacker can write one without access to the profile.

Required correction: authorize the staging/pending root and every relevant path ancestor with fallible no-follow classification **before** opening SQLite, reading/hash-inventorying files, moving originals/selected files or deleting staging. Apply one consistent checked boundary to startup, local/complete staging, activation and successful/failure/terminal cleanup. A known plan ID does not make a linked parent safe. Reject invalid roots without moving external data or changing the active dataset.

Test: `round4_linked_pending_root_must_not_move_external_data` (Windows).

### F2 — P2: document protection failure leaves startup permanently blocked after the fault clears

Locations: `backup.rs:2789–2790`, `2937–2939`, `3024–3025`, `3195–3196`; document protection at `3371–3377`.

If the original DB move succeeds but the original documents directory move fails, originals remain split between recovery and active storage. Rollback successfully returns the DB. It verifies that the original PDFs still in active storage have the correct identities, but never clears `protected_documents`: the installed-document classifier does not run because installation has not begun, and the absent-source branch clears the flag only for an empty manifest. The stale flag is then treated as unrecovered data forever.

Reproduction uses the newly provided scoped `ProtectDocsRename` hook in the actual activation flow. The first result contains `Injected test fault: ProtectDocsRename`, proving the intended boundary was reached. The guard is then dropped. Two subsequent actual startup invocations, with no injected fault, both return `BlockedUnresolved` with `Protected documents were not fully verified and recovered`. Exact original DB and PDF hashes remain active (`preserved=true`).

This is an availability/reconciliation defect, not lost original bytes. Conservative refusal is appropriate while state is ambiguous, but this state has the complete verified original dataset and no remaining obstruction. Repeated launch cannot resolve it.

Required correction: reconcile originals in active and recovery locations independently of the mutable installed flags. Clear outstanding protection intent only after complete identity/type verification proves the originals are safely active. Keep unknown/missing/changed files blocked; do not simply clear the flag whenever the source is absent.

Test: `round4_document_protection_failure_recovers_on_next_launch`.

### F3 — P2: a known-empty original manifest bypasses complete-set verification

Locations: `backup.rs:3094–3140`, especially `3107`; journal presence fields `1314–1329` and mutable presence inference at `2937`.

Original document checking is conditional on `!original_document_artifacts.is_empty()`. This cannot distinguish a genuine recorded empty directory from unavailable/legacy identity information. Both expected-file checks and unexpected-file checks are skipped when the manifest is empty.

Reconstruction: record an original DB and a genuinely empty documents directory in a `Protected` journal with `protected_documents=true`. Add an unidentified PDF to its recovery directory after recording the empty manifest. Actual startup moves it into active storage, returns `RolledBackRecovered`, and deletes the journal. Observed active bytes: `unidentified document sentinel`; `journal_retained=false`.

The fixture adds content after the recorded inventory; it does not claim recovery spontaneously creates unknown PDFs or deletes original documents. It proves the stated exact-set recovery contract is disabled for a valid empty set.

Required correction: persist immutable original presence/identity completeness separately from mutable movement flags. A complete known-empty manifest requires an empty result. Unknown legacy state must be explicit and conservative; it must not share the ordinary empty-vector branch. Keep portable legacy archive compatibility separate from local journal identity compatibility.

Test: `round4_empty_original_manifest_rejects_unidentified_document`.

### F4 — P2: a missing plan still grants deletion permission to a modern terminal journal

Locations: `backup.rs:2385`, `2433–2436`; terminal callers `3641–3647` and `3682–3688`.

Corrupted plans are now refused, but `None` from the checked plan reader always returns `Ok(true)`, even when the journal has a nonempty modern operation ID. The new comment classifies any absent plan as legacy/unversioned leftovers without proving ownership. This is the same unknown-ownership requirement from the third review, now through the missing-plan branch.

Reconstruction tests both `Committed` and `RolledBack`: the terminal journal has `known-modern-terminal-owner`; pending contains a distinct valid DB and no ownership plan. Actual startup deletes it in both cases. Observed `Committed -> RestoreCompleted, pending_preserved=false`; `RolledBack -> RolledBackRecovered, pending_preserved=false`.

This is ambiguous on-disk state, not a claim that `fresh_staging` ordinarily accepts a second request while the old journal remains. An absent record cannot establish that the pending bytes belong to the terminal operation. Neither active DB is deleted in these fixtures.

Required correction: refuse deletion for a modern journal when plan ownership is missing/unreadable/malformed. Preserve ambiguous pending bytes and evidence. If genuine legacy leftovers need cleanup, define and test a narrow explicit legacy rule; absence alone is not sufficient. Handle cleanup that partially removes its own plan using a durable ownership marker or safe manifest reconciliation, rather than wildcard authorization.

Test: `round4_modern_terminal_missing_plan_preserves_unknown_pending` (covers both terminal phases).

## Failure-matrix and documentation accuracy

The new hooks improve testability, but the supplied nine task-5 tests are not the requested complete matrix:

- Only primary DB index 0 is tested for protect/install/return; the document move hooks are untested. F2 is found by exercising one of those existing untested hooks.
- `RootReadDir` and `BackupsReadDir` hooks exist but have no tests using them. Metadata/read/inventory/entry-read failures have no corresponding fault seam or controlled denied-read cases.
- Journal create/write/sync/rename tests run on fresh empty roots. They do not verify preservation of a prior canonical journal or restart after a later-phase write fails.
- The fault selector has no occurrence/phase control or hit counter, so it cannot select a particular later journal update or prove every intended transition boundary without additional evidence.
- `task5_matrix_unreadable_journal_file_blocks_startup` writes `not valid json`. It proves parse failure, not a denied/unreadable file. The handoff also claims Unix directory-sync fault coverage, but no directory-sync fault exists and this host is Windows.
- Complete original presence is still inferred from mutable flags/vector contents, rather than explicitly represented as reported. The implementation checks only nonempty document manifests.
- `STATUS.md`, backup-format and the Mac tracker disagree: current top sections still describe old failures, while new sections say all requested guarantees/matrix work are implemented. Supersede historical summaries with the current fourth-review outcome; keep standalone historical notes unchanged.

These are source/test/evidence gaps, not extra reproduced data-loss claims. Complete the named acceptance boundary instead of adding unrelated work or weakening old fixtures until the current code passes.

## Verification records

Evidence folder: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

- `restore-review-round4-2026-09-30-round3-tests.log`: 5 previous regressions passed, exit 0.
- `restore-review-round4-2026-09-30-existing-tests.log`: 107 existing backup tests passed, exit 0, 30.76s.
- `restore-review-round4-2026-09-30-regressions.rs`: four additional cases above.
- `reproduce-restore-review-round4-2026-09-30.ps1`: guarded temporary insertion/execution/exact-byte restoration.
- `restore-review-round4-2026-09-30-reproductions.log`: 0 passed, 4 failed, exit 1, 0.42s runtime, 2m54s compilation.
- `restore-review-round4-2026-09-30-original-backup.rs`: preserved reviewed source snapshot, matching the SHA-256 above.

The implementer reports sequential dependency installation, 594 frontend tests passed with four skipped, build/typecheck, Rust formatting/strict lint, **225 Rust tests passed with six ignored**, and lock/version checks. Those remain attributed results; Codex did not repeat the full matrix once the new blockers were confirmed. `git diff --check` remains clean. No Cargo/Rust test process remains after the review runs.

## Required next handoff

Correct F1–F4, port all four assertions, and finish the named filesystem/transition failure coverage using precise phase/occurrence faults and observed hits. Keep the existing 107 tests and previous behavior assertions meaningful. Run focused tests per correction, then one sequential final local gate only after corrections finish. Update current documentation with actual guarantees and remaining platform limitations; preserve this and all earlier review notes. Leave implementation uncommitted/unpushed for Codex review.

Preserve portable archive v1/v2/v3 support, integrity/completeness, database-only restore semantics, credential exclusion, migrations, narrow permissions, Windows behavior, app-owned storage and bundle identifier `com.herflightdeck.app`. No new features, version/tag/release actions or candidate replacement. Physical Apple Silicon, early macOS 12, installed Windows and live Gemini remain UNVERIFIED. Source repairs cannot certify the frozen old v0.5.3 draft DMG.
