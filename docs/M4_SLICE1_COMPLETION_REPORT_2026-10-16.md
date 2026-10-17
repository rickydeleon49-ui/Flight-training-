# M4 Slice 1 completion report — 16 October 2026

**Status: submitted for Codex review; not accepted, not merged.** This is one source PR containing the approved document-navigation feature and the corrections for the four partial-review findings (M4S1-R1–R4).

The scope is the owner's approval of all ten defaults, including OD-6 "refuse and explain" ([approval](M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md)). The work follows [the continuation assignment](M4_SLICE1_CONTINUATION_PROMPT_2026-10-16.md), [the partial review](M4_SLICE1_PARTIAL_REVIEW_2026-10-16.md) and [the current handoff](M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md).

No app launch, profile, provider call, installer build, signing, version change, new dependency or release took place. Installed desktop behaviour is **unverified**: every test is a source-level test.

## Identity

- **Branch:** `claude/m4-slice1`.
- **Base:** the merge of origin/main c13889b (#188) at 589addd. Before that merge:
  - the reviewed checkpoint 07fdcfa was verified (20 of 20 frozen hashes matched);
  - the trim patch matched `preserved-uncommitted.patch` and was committed alone as e5ee1b9.
- **Merge:** no conflicts. PR #187's `backup.rs` folder-opening correction and the schema-15 verification are both present, and migration 15 was still unused on main.
- **Head:** the PR head. Exact hashes of every changed source file are in [the evidence folder](evidence/m4-slice1-completion-2026-10-16/source-hashes.txt).

## The four findings

| Finding | Correction | Tests |
| --- | --- | --- |
| **R1: a held confirmation could confirm replacement content** | `set_read` now carries `expectedContentSha256` and `expectedOwnerGeneration`. `add_bookmark` carries `expectedContentSha256`. Both native and TypeScript compare these inside the write transaction against the recorded identity and the stored tuple. A stale request returns STALE_STATE and writes nothing; the UPDATE also re-states the tuple. | Native: `a_held_confirmation_for_replaced_content_at_the_same_page_changes_nothing`, `…older_generation_of_the_same_page…`, `held_confirmation_and_bookmark_across_a_replacement…`. Shared cases (native, node:sqlite, sql.js): A→B at the same page, an older generation, stale clear, normal confirm and clear, a held bookmark. TS: the frozen diagnostic, now permanent. UI: a bookmark held across a replacement. |
| **R2: success replies were not bound to the request** | `isCommittedStateFor`, `isSetReadStateFor` and `isAddedBookmarkFor` check every request-bound field: material, page, hash, label, generation, `active` and the read flag. Refusal verdicts may still carry newer state. A mismatched success becomes STORAGE_FAILURE. | `navigationShapes.test.ts`: 12 commit, 6 confirmation and 8 bookmark single-field corruptions; refusals carrying newer state; the transport mapping; the frozen diagnostic, now permanent. |
| **R3: native commits trusted a cached identity** | Production `navigation_operation` runs `run_operation_checked`. Inside the same immediate transaction it rereads the managed file at the material's **current** path for commit, confirmation and bookmark. A missing file fails with FILE_MISSING and writes nothing. A replacement is recorded and reconciled atomically, and the stale request is refused (commit: `identity_changed`; others: FILE_CHANGED). The new `open_navigation_document` hands the file to the default reader only after its current bytes match the expected and recorded identity. | `a_file_replaced_after_inspection…`, `a_file_deleted_after_inspection…`, `relinking_after_inspection…`, `opening_hands_over_only_the_verified_content`, `a_file_changed_while_the_open_is_held…`, `a_save_only_retry_rechecks_the_file_and_the_token`, `the_wire_commands_use_the_checked_path`. |
| **R4: the genuine schema-14 tamper case had disappeared** | The schema-14 specimen is restored, beside a separate current-schema case. The affected boundary is the **node test driver** only: it migrated the file in place before validation refused it. The production browser driver already migrated in memory and stored nothing on refusal. The bounded fix: a refused open in the test driver restores the file's original bytes. The before-fix failure is preserved. | `skillEvidenceUpgrade.test.ts` (schema-14 and current cases); `navigationUpgrade.test.ts` (browser driver: populated 14→15 keeps every row, a tampered schema-14 library is refused with storage unchanged, altered schema-15 is refused, reopen and cascade); native `the_pre_upgrade_copy_keeps_a_schema14_library_exactly_valid_or_not` and the existing tampered schema-14 archive restore refusal (`skill_evidence_tests.rs`). |

### What the native boundary guarantees (R3)

A successful open means that the file at the material's managed path had exactly the expected content when it was handed to the reader. A successful save means that, inside the save's own transaction, the file at the material's current path still had the recorded content and the request was the exact current, non-cancelled token.

The app cannot control what an external reader reads afterwards. It also cannot make the reader jump to a page, so the page is always shown as guidance.

A file replaced and then restored between two reads is seen as a change. The first save after a restore is therefore refused and the identity recorded again, and the next save succeeds.

Browser mode has no managed files. Its operations use the recorded identity only, so they prove the database half, not a real file check.

## Remaining feature: what was built

- **Shared contract.** 33 operation cases in `src-tauri/fixtures/navigation/operation-cases.json` and 20 validation cases in `validation-cases.json`. Each runs natively and on node:sqlite and sql.js, with identical outcomes. They cover:
  - strict shapes; safe integers; label, title and notes limits counted in code points; ECMAScript trimming (NBSP and BOM trimmed, a zero-width space kept);
  - null origins staying unverified; trusted bounds; reservation postconditions, including ignored, blocked and skewed claim writes; rollback;
  - every refusal reason; read confirmation; bookmarks and their limit;
  - schema, FK, CHECK, index and ownership refusals.
- **Domain.** `src/logic/navigation.test.ts` covers the prototype's control, M4-R9 and R15–R18 behaviours:
  - OD-4 bounds and OD-6 refusal without clamping;
  - unknown provenance staying unresolved;
  - OD-5 content-bound label maps;
  - OD-7 root, parent and child translation, first-level nullable lineage, deleted ancestors and overflow.
- **Controller** (`src/state/navigation/controller.ts`):
  - A local epoch retires older work before any new ownership read can fail.
  - The durable generation comes from `begin`. A same-material supersede happens inside the reservation; another material is cancelled separately.
  - Save-only retry resends the same generation without reopening. Abort and unmount are handled.
  - Native cancel/commit ordering: both are immediate transactions on one claim row. If the cancel lands first, the commit is refused; if the commit lands first, it stays saved and is not published. Both orders are tested against the real transactions.
  - 20 tests use deterministic gates, never sleeps: a held opener, a held commit, a failed cross-material ownership read, a failed reservation, retry, abort, unmount, A→B→A, and a second controller instance.
- **UI:**
  - Source badges in MaterialDetail flashcards, PracticeTestPanel, CardReviewPanel and PracticeHistory open the checked document with guidance and save nothing, because study-aid page numbers have unknown provenance (OD-6). Outside the desktop app they stay plain labels.
  - MaterialDetail gains a "Find your place" panel:
    - check pages; open at a PDF page (refused and explained when out of range or not a number);
    - the last page asked for, with a separate "I've read this page" mark and drift/unverified notes;
    - "Try saving again";
    - bookmark add (dialog), list, open and remove (confirm dialog);
    - "Find and restore file" when the file is missing.
  - It uses the existing Dialog/ConfirmDialog (modal fallback), Field labels and live regions. 9 UI tests.
- **Persistence and compatibility:**
  - all four tables in native and browser validation;
  - backup/restore round trip (native);
  - cascades (native and browser);
  - populated 14→15 upgrade (native and browser);
  - failed-upgrade rollback (native);
  - reopen (browser and node);
  - malformed-schema refusal (shared cases);
  - pre-upgrade safety copy (native);
  - older-binary refusal: the existing `an_older_app_refuses_a_newer_library` runs at ceiling 15, and a shipped schema-14 build applies the same rule.
  - Migrations 1–14 and their checksum records are unchanged.
- **Frozen schema-14 helper:**
  - The helper is unchanged and still pinned to 14.
  - `currentSchemaVerification.test.ts` compares its pins with the registered 1–14 prefix, byte for byte, and checks the live ceiling separately. It adds a schema-15 library refusal ("newer than this helper's pinned ceiling 14").
  - The helper's own 26-case suite now expects exactly its four schema-15 live-source anchor alarms, each checked to name only schema 15, in the manner of the schema-13 helper's ceiling alarm.
  - Only the current manifest bindings of the edited files are refreshed; historical receipts are untouched.

The handoff's 104-case mapping is in [requirement-map.md](evidence/m4-slice1-completion-2026-10-16/requirement-map.md). Runner and install-attestation cases (M4-R20, R22, R31, R32, R35, R36, R39, and the R21 ledger extraction) stay in the evidence harness.

## Gate

Final sequential gate on Node 22.23.3 / npm 10, at the head recorded in `final/environment.txt`. Receipts are in [final/](evidence/m4-slice1-completion-2026-10-16/final/):

| Step | Command | Result | Exit |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | clean | 0 |
| 2 | `npm test` | 153 files passed, 4 skipped; 3,423 tests passed, 6 skipped | 0 |
| 3 | `npm run build` | built | 0 |
| 4 | `cargo test --locked` | 512 passed, 6 ignored | 0 |
| 5 | `cargo clippy --locked --all-targets -- -D warnings` | clean | 0 |
| 6 | `cargo fmt --check` | clean | 0 |
| 7 | `npm run test:cargo-lock` | in sync | 0 |
| 8 | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | 26 of 26 | 0 |
| 9–10 | fmt and clippy again, after a comment-only fix to two doc references in `navigation.rs` | clean | 0 |
| 11 | `git diff --check origin/main...HEAD` | clean (run on the final commit) | 0 |

The gate ran at ebe2c8f. The only later source change is the doc-comment edit in `navigation.rs`, so 9–10 were rerun for it. Everything after that is documentation. Exact-head CI decides the final commit.

Earlier failures are kept separately in [failed/](evidence/m4-slice1-completion-2026-10-16/failed/):

- the R4 driver defect before the fix;
- the schema-14 helper suite before its expectation update.

Local Node 26 fails some existing writable-schema tests (`table sqlite_master may not be modified`). That failure is unrelated to this work; CI uses Node 22.

## Limitations

- Installed desktop behaviour is not verified: no app launch, so no real reader, Tauri IPC or Finder behaviour was observed.
- Whether the default reader jumps to a page is not claimed.
- Hashing reads the whole file inside the write transaction, so very large PDFs hold the write lock for that time.
- Gemini/study-aid page numbers never save a position.
- On the desktop, live open of a tampered older library is unchanged from before. The pre-upgrade copy is taken and native verification refuses at backup/restore. Live open does not run whole-library validation, which is a pre-existing behaviour.
