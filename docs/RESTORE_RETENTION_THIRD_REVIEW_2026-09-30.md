# Third independent review: restore dataset conservation

Date: 30 September 2026. Reviewer: Codex. **Decision: changes requested; A1 remains OPEN. No commit, push, merge or release approval.**

## Reviewed state and evidence boundary

- Repository: `H:\Ai Repo clones\Flight-training-`; GitHub: `rickydeleon49-ui/Flight-training-`.
- Branch: `fix/restore-retention-restart-safety`; HEAD/base: `053af1fcd1429888300060f780a10d68adc81c5b`.
- Reviewed `src-tauri/src/backup.rs` SHA-256: `4e2dfd62194c2f1bf316073fe94eb6916e45bf9a089fc2dc682216c9efa7284e`.
- Eight existing tracked modifications and both prior review notes were preserved. This review adds documentation only. Temporary review tests were inserted into the existing native test module and removed afterwards; application source was restored byte-for-byte to the above hash.
- Native Windows filesystem/SQLite tests used synthetic scratch profiles and archives only. Each new fixture was cleaned before its assertion. No owner application-data profile was opened or modified. There was no Mac hardware, installed-app test, live Gemini request, CI run, installer build, version change, release change or publication.

The first and second review files are historical evidence and remain unchanged. Findings below use line numbers from the restored application source, not from its temporary appended tests.

## Improvements independently verified

The six `backup::tests::round2_*` tests pass independently: 6 passed, 0 failed, exit 0, test time 0.38s. The complete existing backup suite also passes: **72 passed, 0 failed**, exit 0, test time 30.74s. This includes the seven first-review regressions, the six round-two tests, and the three new `matrix_*` tests.

Original/staged DB identity recording, the particular legacy WAL rollback case, fallible terminal-journal removal before new staging, canonical dangling-journal inspection, and rejection of the tested recovery-directory junctions are concrete improvements. These passing cases do not prove conservation of the entire document dataset or authorize cleanup of state whose ownership cannot be read.

Five additional independent behavior assertions fail: **0 passed, 5 failed**, exit 1, runtime 0.39s after compilation in 28.61s. All five reach production recovery code and fail behavior assertions; none is a compile or fixture-setup failure.

## Confirmed findings

### T1 — P1: original document identity and completeness are not verified

Locations: `src-tauri/src/backup.rs:2569`, `2586`, `2600`, `2625`, `2662`; original inventory recording at `2878`.

`original_document_artifacts` is recorded but is never used to verify recovered documents. The final checks hash original DB artifacts and check only whether the documents directory exists. An absent recovery document directory also clears `protected_documents`, losing the requirement to recover its files. Recovery can then delete its journal and report `RolledBackRecovered` with missing or changed attachments.

Two reconstructed interrupted-recovery cases:

1. Record a genuine original DB and document inventory in a `Protected` journal; change the protected PDF bytes while keeping its filename. Actual startup recovery moves the altered file into active storage, returns `RolledBackRecovered`, and removes the journal. Observed active bytes: `altered document bytes!`; `journal_retained=false`.
2. Record a genuine original DB and document inventory in a `RollingBack` journal; remove the recovery documents directory and leave an empty active documents directory. Actual startup recovery returns `RolledBackRecovered`, despite `original.pdf` being absent, and removes the journal. Observed `missing=true`; `journal_retained=false`.

These cases reconstruct damaged/ambiguous disk state to verify the promised fail-closed recovery contract. They do not claim ordinary successful restores spontaneously alter PDFs. The implementation still must not certify recovery when its recorded original content is absent or changed.

Required correction: use the original document inventory as a recovery requirement, compare complete relative-name/size/hash sets with fallible reads and no-follow types, and verify originals before moving them where practical. Missing originals must preserve available recovery evidence and block initialization rather than be inferred away by clearing a boolean. Cover interrupted document return and repeat startup as well as DB/WAL return.

Tests: `round3_changed_original_document_cannot_be_reported_recovered`, `round3_missing_original_document_cannot_be_reported_recovered`.

### T2 — P1: original document absence leaves selected documents beside the returned old DB

Locations: `backup.rs:2455–2497`, especially `2459`; original presence inference at `2534`.

The document uninstall path only runs when `rollback/documents` exists. When the original profile had no document directory, known selected documents are not uninstalled at all. Unlike the revised WAL logic, document absence still substitutes for ownership classification.

Reconstruction: a `RollingBack` journal contains the exact already-returned original DB identity, an empty rollback directory, `installed_documents=true`, and a genuine staged document inventory for the active selected PDF. Actual startup returns `RolledBackRecovered`; the row is `original row without documents`, but `selected.pdf` remains active (`selected_left=true`). This is a returned-old-DB/selected-document mixture, not a proof of lost original document bytes in this fixture.

Required correction: distinguish absent, empty and populated original document storage from unreadable/unknown state. Remove only positively identified selected content when returning to original absence, even without a same-named original directory. Block and preserve unknown content. Do not remove already-returned original documents that happen to share names or hashes with selected documents.

Test: `round3_original_document_absence_must_not_leave_selected_documents`.

### T3 — P1: an active document junction is accepted as recovered app-owned storage

Locations: `backup.rs:1144–1187`, `2493`, `2569–2587`, `2625`; validation at `1240` checks recovery locations but does not classify the active documents root.

The inventory helper inspects child entries but not its directory argument itself. More importantly, a returned documents directory with no counterpart left in rollback bypasses inventory entirely. `is_dir()` follows a junction and satisfies the final recovery check.

Native Windows reproduction: create a real junction at `root/documents` pointing to a separate synthetic external documents directory, plus an already-returned original DB and a recorded original document inventory in a `RollingBack` journal. Actual startup returns `RolledBackRecovered`, keeps the linked active path (`linked_active=true`) and accepts `external sentinel` as its contents. The external sentinel remained unchanged; no external deletion is alleged.

Required correction: no-follow inspection must cover the root argument, ancestors and active/returned originals, not only recovery children. Reject links before hashing, moving, deleting or accepting storage. Repeat the case with native Windows junctions and portable Unix symlinks where available. Test nested links and invalid types as well.

Test: `round3_active_document_junction_cannot_be_accepted_as_returned_original` (Windows).

### T4 — P2: unreadable or corrupted ownership authorizes terminal cleanup

Locations: `backup.rs:2135–2143`, `2703–2712`, `2724–2733`, `2753–2762`.

`read_restore_plan` converts absent, unreadable and malformed plans into an empty operation ID. Terminal cleanup treats an empty plan ID or journal ID as matching every operation. Therefore the new operation-ownership check is not strict when evidence cannot be read.

Reconstruction: a `Committed` journal has a known nonempty operation ID; a pending directory contains a distinct valid synthetic DB and corrupted ownership metadata. Actual startup returns `RestoreCompleted` and deletes the pending DB (`pending_preserved=false`). The current active DB is preserved in this test. It proves deletion of ambiguous staging, not a fresh-stage API accepting a second operation while an old journal remains.

Required correction: separate plan compatibility/default-kind handling from deletion ownership. Malformed/unreadable ownership cannot grant permission to remove pending files. Preserve ambiguous state with an actionable refusal; define and test a narrow genuine legacy-plan path without weakening portable v1/v2/v3 restore support.

Test: `round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup`.

## Additional source-review gaps, not additional native failure claims

- Pre-protection identity reads use `if let Ok` at `2869`, `2880`, `2885` and `2894`; inspection failure silently becomes a missing inventory. Final original DB verification also ignores read errors at `2607`. Unknown is not absence. Make the operations that authorize moves/deletion/recovery acceptance fallible.
- Evidence discovery at `1440` and rollback leftover inspection at `2640` still use `if let Ok` and/or `flatten`, discarding directory enumeration errors. These are exactly the boundaries for which prior prompts requested deterministic fault coverage.
- `RestoreJournal::validate` checks the old filename lists but does not validate the new artifact inventory names, duplicate entries, byte sizes, hash syntax, or contradictory inventories. `root.join(&orig.name)` at `2601` uses a deserialized name. Validate those fields before any path use; do not claim journal schema/path hardening is complete.
- The three `matrix_*` cases reconstruct successful/altered/corrupted states. The test named `matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively` only writes invalid JSON; it does not inject an unreadable journal. There is still no deterministic filesystem-failure matrix for journal create/write/sync/replace/delete or fallible metadata/read-directory inspection. An internal test-only failure seam is appropriate; no production global/environment backdoor is needed.
- Unix journal code attempts directory sync before rename and ignores its result. Record the actual directory-entry durability boundary, and test the appropriate post-replacement ordering. No power-loss or Mac-specific behavior was demonstrated in this Windows review.

These are observed source/testing gaps. Do not represent them as extra reproduced data-loss cases without adding corresponding controlled tests.

## Evidence accuracy and verification records

Evidence directory: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

- `restore-review-round3-2026-09-30-existing-tests.log`: complete existing backup suite, **72 passed**, exit 0.
- `restore-review-round3-2026-09-30-regressions.rs`: the five independent cases listed above.
- `reproduce-restore-review-round3-2026-09-30.ps1`: guarded temporary test insertion, synthetic execution, and exact-byte source restoration.
- `restore-review-round3-2026-09-30-reproductions.log`: **0 passed, 5 failed**, exit 1, 0.39s test time.
- `restore-review-round3-2026-09-30-original-backup.rs`: preserved application source before temporary test insertion; SHA-256 matches the reviewed hash above.
- `restore-review-round3-2026-09-30-handoff-command-check.log`: the handoff's Task 1 command supplies three separate test filters. Cargo rejects the second filter with `unexpected argument`, exit 1, before running tests. Tasks 2 and 3 use the same invalid command shape. The earlier activity trace shows valid single-filter runs, so this is inaccurate command/result reporting, not evidence those tests never ran. Record actual runnable commands and their individual outputs.

The implementer reports `npm ci`, 594 frontend tests passed with 4 skipped, production build, Rust formatting/strict lint, **190 Rust tests passed with 6 ignored**, and lock/version checks. Those remain attributed handoff results. Codex independently ran the 72-test backup suite and the new failing assertions; it did not rerun the expensive full matrix after blockers were confirmed. `git diff --check` passes. No background Cargo/Rust process remained after the review runs.

## Next correction boundary

Finish A1 as a complete checked dataset protocol: original and staged document identities/presence, fallible no-follow active/recovery inspection, strict cleanup ownership, and meaningful transition fault coverage. Port all five new cases without weakening the existing 72-test suite. Correct current documentation so proposed guarantees are not stated as verified behavior. Run focused tests after each correction and one sequential full local gate once corrections are complete; leave changes uncommitted/unpushed for independent review.

Preserve archive v1/v2/v3 compatibility, integrity/completeness rules, database-only document retention, current migrations, Windows behavior, app-owned storage, bundle identifier `com.herflightdeck.app`, and all release holds. A2–A6, M2, new study features, signing, versions/tags and candidate replacement remain outside this repair. The frozen private candidate cannot verify these source changes. Installed Windows, Apple Silicon Mac, early macOS 12 and live Gemini outcomes remain UNVERIFIED.
