# Her Flight Deck — A2 Atomic Study Library Saves and File Ownership Implementation Note

_Date: 2 October 2026 (review corrections 2–4 October 2026) · Target: confirmed A2 audit finding · Status: implemented locally, uncommitted; **pending independent Codex review and acceptance**_

---

## 1. Summary and scope

This note records the local repair of data-safety finding **A2** from the [29 September 2026 full audit](FULL_REPOSITORY_AUDIT_2026-09-29.md), and the corrections made after Codex's [first A2 review](#7-review-corrections-r1r5) found five remaining defects (R1–R5).

Before A2, ordinary create and update of a `StudyMaterial` ran metadata and tag writes as separate statements. Tag names were trimmed but not de-duplicated, so `["FAA", " FAA "]` hit `UNIQUE constraint failed: material_tags.material_id, material_tags.tag_id` after the material row had already been written (create) or after the old tags had been cleared and new metadata written (update). The form's Cancel then called `delete_document`, which removed files without checking whether the database referenced them.

After A2 and its corrections:

1. **Desktop:** one native command, `save_material_operation`, saves the row and its tags in one immediate transaction on one connection, resolves tags by name, verifies the stored links before committing, and validates a newly attached file under that same writer lock.
2. **Browser (sql.js) and tests (node:sqlite):** the same operation runs in `executeMaterialSave`, under a connection owner so no other caller can run inside it; the browser driver only reports success once the change is in localStorage.
3. **Tags:** trimmed, blanks dropped, de-duplicated keeping first-occurrence order and case, on both sides. A shared fixture proves both sides return and persist the same results.
4. **File cleanup:** `delete_document_in` (and `trash_unlinked_file_in`) refuse ambiguous spellings and compare *file identity*, not path strings, against every stored reference while holding the writer lock.
5. **Form ownership:** the dialog only discards files it imported in this session and that never committed; committed files are never sent to cleanup.

---

## 2. Reproduced failures and root causes

### Original A2 failures (prior code)

1. **Duplicate / whitespace tags** — `tags: ["FAA", " FAA "]` threw the `material_tags` unique-constraint error and left the material row committed with no tags.
2. **Injected tag-write failure** — on create the material row stayed; on update the old tags were already deleted and the new title/file path stayed.
3. **Cancel after failed save** — Cancel deleted the replacement file the partially committed update now referenced.

### Defects in the first A2 implementation (review R1–R5)

| Finding | Root cause | Reviewer evidence (baseline) |
| --- | --- | --- |
| **R1** native tag replace acknowledged unsaved tags | Tag ids were derived as `<material>-tag-<index>`. Old tag rows survive link replacement, so a different tag at the same index collided on id; `INSERT OR IGNORE` hid it and `INSERT … SELECT` linked nothing, yet the command committed and returned the tag. | `a2_review_replacing_a_native_tag_persists_the_acknowledged_tag`: persisted `[]`, returned `["New tag"]` |
| **R2** alias spellings bypassed the reference check | `delete_document_in` compared path strings after only backslash replacement. | `nested//attached.pdf` and Windows `CASEGUIDE.PDF` each removed a referenced file |
| **R3** cleanup-first ordering committed a missing attachment | Save never checked that a newly attached file still existed under its own transaction. | Cleanup then create committed a row referencing the purged file |
| **R4** unrelated acknowledged write rolled back | The JS helper awaits between statements on a single connection; another caller's `execute` ran inside its transaction and was undone by its rollback. | real node:sqlite: expected `[{id: 'acknowledged'}]`, received `[]` |
| **R5** browser save reported success storage refused | `save(db)` caught and logged storage errors after an in-memory commit. | real sql.js with quota failure: `{ outcome: 'acknowledged', durable: [] }` |

Reviewer logs: `outputs/a2-review-2026-10-01/native-regressions.log` (4 native failures) and `frontend-focused.log` (2 JS failures), in the Codex workspace.

---

## 3. Operation and ownership boundaries

### The save contract (`MaterialSaveOperation`, `src/data/db.ts`)

`mode` (`create` | `update`), `id`, partial `fields`, optional `tags` (omitted keeps the existing links; `[]` clears them), optional `createdAt`/`updatedAt`. The Rust struct rejects unknown fields. An update never changes `created_at`.

### Desktop (native, `src-tauri/src/documents.rs`)

- `save_material_operation` opens its own connection with **`Connection::open`** (not `open_with_flags`, as the first version of this note said), sets `busy_timeout(5 s)` and `foreign_keys = ON`, and starts a `TransactionBehavior::Immediate` transaction.
- **Tags (R1, new):** `link_material_tags` resolves each normalized name with `SELECT id FROM tags WHERE name = ?`. Only a new name gets a row, under a random id from SQLite's `randomblob(16)` and a plain `INSERT` (a collision fails the save). Each link is a plain `INSERT … VALUES` whose row count must be 1, and the stored link names are read back and compared with the requested set before the command can succeed. Orphan and shared tag rows are never deleted.
- **New attachments (R3, new):** `verify_new_attachment` runs inside the immediate transaction for a create with a file and for an update whose `filePath` differs from the stored one. The file must exist as a real regular file inside app document storage (not hidden, not in `.trash`, not a link, no backslash or empty/`.` component). No size or page limit applies — the 50 MiB / 1,000-page caps remain split-only. Re-sending the recorded path of a material whose file is missing, removing an attachment, and notes without a file are unaffected.
- **Lock bound (measured):** one native attempt facing a lock that never clears gives up after about **5.5 s** on Windows. The repository retries a lock error three more times after 100/300/700 ms, so the user-visible worst case is roughly **4 × 5.5 s + 1.1 s ≈ 23 s** — not "about a second" as first stated, and the delays are `[100, 300, 700]`, not `[50, 150, 300]`. This is unchanged policy, now documented in `documentRepository.ts`; a transient lock is waited out inside the first attempt.

### Browser (sql.js) and tests (node:sqlite)

- **Connection owner (R4, new, `src/data/connectionOwner.ts`):** every public method of both single-connection drivers (`select`, `execute`, `persist`, `saveDebriefAtomically`, `saveMaterialAtomically`, `saveMaterialsAtomically`) runs only after every earlier operation on the connection has finished. Inside an operation the driver uses its raw handle, never its own public methods, so nothing waits on itself. Public `execute` refuses `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/`END`. A failed operation is followed by a `ROLLBACK` of anything it left open; if even that fails, the connection refuses all later work with a clear message instead of hanging or running inside an abandoned transaction.
- **PDF parts:** `createMany` no longer has a public `BEGIN … COMMIT` fallback. Every driver must provide an owned batch (`saveMaterialsAtomically`); sql.js and node:sqlite now do, through `executeMaterialsBatch`, which mirrors the native split batch (trimmed, blank tags skipped, not de-duplicated).
- **Browser durability (R5, new, browser only):** a write reports success only after the whole database, including that write, is in localStorage. If storage refuses it, localStorage keeps its previous bytes, the live database is restored to the last stored state, and the save reports failure, so the screen, a retry and a reload agree; the retry then saves exactly once. Remaining gap, stated in `sqlJsDb.ts`: if storage already failed while the app was starting, the live database is ahead of a reload until the next successful write. sql.js `export()` closes and reopens the connection (silently rolling back an open transaction and switching foreign keys off); exports now happen only between owned operations and foreign keys are switched back on each time.
- No migration, second database, dependency or Tauri permission change.

### Reference-safe cleanup (`delete_document_in`, `trash_unlinked_file_in`)

Both still hold an immediate transaction while they check references and move the file, and keep the containment, hidden/trash, link and recovery-trash rules from A1. **New (R2):**

- Incoming paths with an empty component (`a//b.pdf`, a trailing slash), a `.` component, or a Windows trailing dot/space are refused as ambiguous rather than normalized.
- `document_is_referenced` first does the exact (backslash-normalized) match, then canonicalizes the target and **every stored path the app itself could open** and compares the results. The filesystem decides case sensitivity, so `CASEGUIDE.PDF` protects `CaseGuide.pdf` on a case-insensitive volume while `Guide.pdf` and `GUIDE.PDF` stay distinct files on a case-sensitive one; legacy backslash and redundant stored spellings, directory links/junctions and 8.3 names resolve to the same file. A stored path the app would refuse to open protects nothing; a stored file that is simply missing is skipped; any other failure to resolve a reference refuses the cleanup.
- Not changed: the duplicate checks in `reattach_unlinked_file_in` / `import_unlinked_file_in` still compare normalized strings (they decide whether to *add* a reference, not whether to remove a file).

---

## 4. Verification

Existing behavior that is now tested, and new behavior, are listed separately. All native ordinary-save and cleanup cases below use a database built from the app's ten registered migrations (`crate::migrations()`), not the simplified split-test schema.

### Native — `src-tauri/src/documents_save_tests.rs` (21 tests, new file)

| Area | Tests | New / existing behavior |
| --- | --- | --- |
| R1 tags | `replacing_a_tag_persists_the_acknowledged_tag_after_reopen` (promoted reviewer case); `repeated_replacement_reorder_removal_and_shared_tags_stay_truthful`; `orphan_tags_and_unrelated_id_collisions_do_not_suppress_links`; `tag_and_link_failures_roll_back_create_and_update` (FAIL and silently-ignored inserts on `tags` and `material_tags`, create and update, full prior rows and tag rows compared); `tag_normalization_omission_clearing_unicode_and_case_are_preserved` | New fix; normalization/omission/clearing/collision refusal are existing behavior, retested on the real schema |
| JS ↔ native parity | `shared_contract_fixtures_return_and_persist_the_same_results_as_the_browser_transaction`, replaying `src-tauri/fixtures/material-save-contract/` against `expected.json` (also replayed by `src/data/materialSaveContract.test.ts`) | New: every returned material and the reopened rows match across implementations |
| R2 identity | `an_equivalent_slash_spelling_cannot_delete_a_referenced_file` and `a_windows_case_alias_cannot_delete_or_trash_a_referenced_file` (promoted reviewer cases, SHA-256 of the bytes checked); `legacy_and_shared_stored_spellings_protect_the_physical_file`; `a_directory_link_alias_cannot_delete_a_referenced_file` (symlink, or a junction on Windows without symlink privilege); `distinct_case_files_on_a_case_sensitive_volume_are_not_conflated` (**skips on case-insensitive volumes, including this Windows run; runs on Linux CI; proves nothing about APFS**); `unsafe_paths_and_uninspectable_databases_fail_closed` (corrupt, missing, schema-less database); `unused_and_no_longer_referenced_files_are_still_cleaned_up` | New identity rule; unsafe-path refusal and unused-file cleanup are existing behavior |
| R3 attachments | `cleanup_first_then_a_save_cannot_attach_the_deleted_file` (promoted); `save_first_then_cleanup_preserves_the_now_referenced_file`; `a_save_waiting_for_the_writer_lock_sees_the_cleanup_outcome`; `a_failed_replacement_keeps_the_old_row_tags_and_file`; `ordinary_attachment_flows_still_work` (note without file, original larger than the 50 MiB split cap, replacement, explicit removal, metadata edit of a missing-file and a legacy-spelled material); `new_attachments_must_be_real_app_owned_files` | New validation; the listed ordinary flows are existing behavior |
| Locks | `an_ordinary_save_waits_out_a_transient_writer_lock` (waited ≈ 0.43 s, then committed); `an_ordinary_save_reports_a_permanent_writer_lock_after_one_busy_timeout` (gave up after ≈ 5.5 s, nothing written) | New tests of existing policy |

Orderings are deterministic: cleanup and save each hold the writer lock for their whole check-and-change, so running them one after the other *is* each ordering; the waiting-save case holds the lock in the test itself. No stress loops; the only sleep sets how long the transient lock is held.

The nine first-version native A2 tests in `documents::tests` used the simplified schema and left fixture directories behind; they are replaced by the file above. Five existing `check_library_*` tests also left a directory each because they removed it with a connection still open; they now close it first and no longer ignore the removal result. A full `documents::` run on this machine left no new `hfd-*` directory.

### Frontend

| File | What it proves |
| --- | --- |
| `src/data/singleConnectionDrivers.test.ts` (17, new) | R4 on **real node:sqlite and real sql.js**: the promoted acknowledged-write case, mid-transaction reads, concurrent material/public/debrief/batch operations, refused transaction control, and owner release/poisoning/order. R5 on real sql.js: the promoted quota case, failed update, retry-once, refused plain write/debrief/persist, a persist requested mid-save, and foreign keys after a storage round-trip. Interleavings are issued synchronously from inside the open transaction (driver seam or a spy on sql.js `Database.prototype.run`), not timed. |
| `src/data/materialSaveContract.test.ts` (1, new) | The shared contract fixture through the JS transaction. |
| `src/pages/StudyLibrary/materialSaveIntegration.test.ts` (2, new) | The real Study Library page, `AppDataProvider.mutate`, repository and node:sqlite database: a failed save leaves no rows and keeps the import; the retry commits once with the right tags and the file is never sent to cleanup; Cancel after a failed save discards only the never-committed import. The native file service is mocked here — physical files are covered by the Rust tests. |
| `src/data/repositories/documentRepository.test.ts` | Existing A2 cases, plus `createMany` cases rewritten for the owned batch (real trigger failure, rollback-failure reporting, refusal of drivers without an owned batch, no retry of non-lock errors). |
| `src/state/editorSafety.test.ts` — "does not treat a successful write with failed refresh as a failed save" | Existing `AppDataProvider.mutate` behavior, unchanged, now exercised through the atomic save. |
| `src/pages/StudyLibrary/MaterialFormDialog.test.ts` | Dialog behavior only (mocked `onSave`/cleanup). |

Test-only changes: the node:sqlite driver gained a `beforeStatement` fault seam (test driver only, never used by the app), and the debrief failure-injection tests in `quickDebrief.test.ts` / `debriefLinks.test.ts` moved to it from replacing `testDb.execute`, which the ownership boundary no longer routes internal statements through. The gated `appResponsiveness.bench.test.ts` no longer wraps seeding in a public `BEGIN` (which A2's own nested `BEGIN IMMEDIATE` had already broken).

Negative controls (temporary mutations, files restored and hash-checked afterwards): removing the ownership queue fails 8 of the 17 driver tests; swallowing storage errors again fails 4. Logs are listed in the completion report.

### Final local matrix

One sequential run on Windows, 3–4 October 2026: `npm ci` 0; `npm test` 0 — 62 files passed, 3 skipped (65 files); 646 tests passed, 4 skipped (650 tests) in 29.28s; `npm run build` 0 (vite built in 2.60s); `cargo fmt --check` 0; `cargo clippy --all-targets -D warnings` 0; `cargo test --locked` 0 — 283 passed, 0 failed, 6 ignored (21 in `documents::save_tests`); `npm run test:cargo-lock` 0; `node scripts/check-release-version.mjs 0.5.3` 0; `git diff --check` 0. No new `hfd-*` temporary directory was left.

---

## 5. File ownership and lifecycle

| Event | Form's owned (discardable) set | Database | File on disk | Cancel / cleanup |
| :--- | :--- | :--- | :--- | :--- |
| New material: file imported | path added | no row | present | Cancel discards it (unreferenced). |
| New material: save fails | path kept | rolled back, no row | present | Retry available; Cancel discards it. |
| New material: cleanup removed the file first | path kept | save refused under the writer lock (R3) | gone | No dangling row; Cancel's discard of a missing file succeeds. |
| New material: save succeeds | path cleared | row references it | present | Never discarded; native cleanup refuses it under any spelling (R2). |
| Save succeeds, refresh fails | path cleared | committed | present | `mutate` reports the save as done and shows the refresh error. |
| Replacement imported | new path added | old row unchanged | both present | Cancel discards only the new file. |
| Replacement save fails | new path kept | old row and tags unchanged | both present | Retry available; Cancel discards only the new file. |
| Replacement save succeeds | new path cleared | row references the new file | both present | The old file is then discarded only if nothing references it; a locked old file stays. |

---

## 6. Limitations and holds

- **Uncommitted and unpushed** for independent Codex review; not self-accepted.
- **Mac:** physical Apple Silicon and macOS 12 are UNVERIFIED. Identity comparison relies on the filesystem's canonical path; on Windows this was exercised with case aliases and a junction. The case-sensitive test ran nowhere case-sensitive here, and nothing here proves APFS behavior.
- **Browser fallback** remains development-only; its durability contract and start-up gap are stated above.
- **Installed Windows, live Gemini and release readiness:** UNVERIFIED / held. Windows distribution stays on v0.5.1; the v0.5.3 Mac candidate stays held.

---

## 7. Review corrections (R1–R5)

| Finding | Fix | Proving tests |
| --- | --- | --- |
| R1 (P1) | Resolve tags by name, random ids for new names, plain inserts, row-count checks and read-back verification (`link_material_tags`; same algorithm in `materialTransaction.ts`) | R1 rows in §4; shared contract fixture |
| R2 (P1) | Refuse ambiguous spellings; compare canonical file identity with every openable stored reference (`document_is_referenced`) in both cleanup commands | R2 rows in §4 |
| R3 (P1) | Validate new/replacement attachments under the save's writer transaction (`verify_new_attachment`) | R3 rows in §4; Study Library integration test |
| R4 (P2) | Connection owner for both single-connection drivers; owned batches; public transaction control refused | `singleConnectionDrivers.test.ts` R4 cases |
| R5 (P2) | Browser writes succeed only once stored; otherwise restored to the last stored state | `singleConnectionDrivers.test.ts` R5 cases |

---

## 8. Second review corrections (R6–R7) — 3 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R6** public SQL escaped transaction ownership | The regex guard in `connectionOwner.ts` only inspected the initial keyword after whitespace. Leading line comments (`-- ...`), block comments (`/* ... */`), statement separators (`;`), and public `select` routes bypassed the check. On `node:sqlite`, an admitted commented `BEGIN IMMEDIATE` or `select("BEGIN IMMEDIATE")` allowed an unrelated insert to report success inside an open transaction, which a subsequent failing save rolled back. On `sql.js`, `select("BEGIN IMMEDIATE")` left a transaction open that a subsequent write's export rolled back, losing the write live and after reload. | Real `node:sqlite`: commented execute or select with `BEGIN IMMEDIATE` rolled back acknowledged insert (`[]`). Real `sql.js`: `select("BEGIN IMMEDIATE")` followed by acknowledged insert left live and reopened rows `[]`. |
| **R7** export/serialization failure broke browser durability | In `src/data/sqlJsDb.ts:103`, `exportBytes()` ran outside the error recovery catches in `durableWrite`. An atomic save could commit in memory, export would throw, and the returned promise rejected while the change remained live in memory. Storage still held the old snapshot. A subsequent write or explicit `persist()` then exported and persisted the rejected change. | Real `sql.js`: create export failure left new guide row live but missing on reopen; update export failure left edited title live but prior title on reopen. Subsequent write persisted the rejected record. |

### Implemented corrections and guarantees

1. **R6 — Bounded transaction ownership guard (`src/data/connectionOwner.ts`, `nodeSqliteDb.ts`, `sqlJsDb.ts`):**
   - Replaced naive regex with a tokenizer/scanner (`hasTransactionControl`) that strips leading and inter-token whitespace, block comments, line comments, and statement separators (`;`), treating quoted literals (`'...'`) and identifiers (`"..."`, `` `...` ``, `[...]`) as opaque tokens.
   - Detects all supported opening forms (`BEGIN`, `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, `BEGIN EXCLUSIVE`, `BEGIN TRANSACTION`, `SAVEPOINT`) and ending forms (`COMMIT`, `END`, `ROLLBACK`, `ROLLBACK TO`, `RELEASE`), as well as multi-statement combinations (`SELECT 1; COMMIT`, etc.).
   - Recognizes `CREATE [TEMP|TEMPORARY] TRIGGER` blocks to preserve trigger definition bodies (`BEGIN ... END`) and avoids false rejections on `CASE ... END` expressions, comments mentioning keywords, quoted text, PRAGMAs, and parameterized queries.
   - Applied to both `execute` and `select` on both single-connection drivers (`node:sqlite` and `sql.js`).
2. **R7 — Complete durable-write and fail-closed recovery boundary (`src/data/sqlJsDb.ts`):**
   - Unified work, serialization (`db.export()`), setting restoration (`PRAGMA foreign_keys = ON`), byte encoding (`encodeBytes`), and storage (`localStorage.setItem`) into one consistent failure boundary inside `durableWrite`.
   - Any failure during work, export, setting restoration, encoding, or storage triggers `restoreLastStored()`, reloading the database from the last acknowledged durable bytes so in-memory state never diverges from storage.
   - If recovery itself fails to establish a safe, usable connection, the connection marks itself broken and fails closed; all subsequent operations reject with: `"The local database connection could not be returned to a safe state. Reload the app before making more changes."`
   - Explicit `persist()` participates in the same durability boundary and restores `lastStored` on failure.
   - Added post-commit refresh regression in `materialSaveIntegration.test.ts` verifying that a committed material save followed by a refresh failure remains a successful save and keeps its newly referenced attachment.

### Maintained test verification

- `src/data/singleConnectionDrivers.test.ts`: **41 passed** (17 original + 6 R6 + 6 R7 + 4 R8 + 4 R9 + 4 expanded variants).
- `src/pages/StudyLibrary/materialSaveIntegration.test.ts`: **3 passed** (including committed save with refresh failure).
- Complete 6-file focused frontend suite: **92 passed, 0 failed** (`singleConnectionDrivers`, `materialSaveContract`, `documentRepository`, `materialSaveIntegration`, `MaterialFormDialog`, `editorSafety`).
- Native save suite: **21 passed, 0 failed** (`documents_save_tests.rs`).

---

## 9. Third review corrections (R8–R9) — 3–4 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R8** CASE expression prematurely ended trigger scanning | `hasTransactionControl` in `src/data/connectionOwner.ts` set `inTrigger` for `CREATE TRIGGER`, then cleared it at the first unquoted `END`. An `END` belonging to a `CASE` expression in the trigger's `WHEN` clause or body therefore closed the trigger context early. Semicolons inside the trigger body set `atStatementStart = true`, mistaking the trigger's final `END;` for public transaction control (`END` is equivalent to `COMMIT` in SQLite). | 4 raw-engine controls pass (`DatabaseSync` / `sql.js` accept and fire triggers with CASE in body and WHEN). The same SQL through public drivers failed on both engines (`atomic-operations` refusal). |
| **R9** Partial updates persisted display normalization into omitted columns | `handleUpdate` in `src/data/materialTransaction.ts` called `mapRow(existingRow, [])` before constructing its UPDATE statement. `toEnum` converted unknown stored enum strings (`topic = 'synthetic-topic'`) to UI defaults (`'general'`), and `toNullableText` converted empty strings (`original_file_name = ''`, `last_reviewed_at = ''`) to `null`. The full-row UPDATE wrote those normalized values back into unmentioned columns. | AR-02 in preparation package failed on both engines (topic changed from 'synthetic-topic' to 'general'). 4 reviewer cases comparing raw unmentioned columns failed across unfamiliar enums and API-created empty strings. |

### Implemented corrections and guarantees

1. **R8 — Trigger header/body boundary and END identifier tracking (`src/data/connectionOwner.ts`):**
   - Enhanced `hasTransactionControl` to track trigger state machine (`triggerState: "none" | "header" | "body"`), `sawOn`, `expectingTableName`, `wasPrecededByDot`, and `caseDepth`.
   - Distinguishes header identifiers (trigger named `end`, attached to table `end`, or `begin` before `ON`) from the body `BEGIN`.
   - In the trigger body, only an outer `END` at statement start with `caseDepth === 0` terminates the trigger definition; unquoted identifiers named `end` inside statements (e.g. `INSERT INTO end VALUES ('kept');` or `SELECT end FROM ...`) do not prematurely close trigger context.
   - Semicolon `;` resets `atStatementStart = true` both inside the trigger body and at top-level.
   - Negative controls verify that genuine transaction statements (`BEGIN`, `SAVEPOINT`, `COMMIT`, `END`, `ROLLBACK`, `RELEASE`) following a completed trigger definition remain strictly refused on both `execute` and `select` routes.
2. **R9 — Omitted title byte-for-byte preservation and raw merge (`src/data/materialTransaction.ts`):**
   - Follows native Rust `handle_update_material` contract: only explicitly supplied new titles (`fields.title !== undefined`) are trimmed and validated (`"Title is required."`).
   - When `fields.title` is omitted/undefined, the raw stored `existingRow.title` is preserved byte-for-byte without trimming or newly submitted title validation, ensuring notes-only, review-status-only, and tag-only updates retain legacy or schema-permitted padded/whitespace-only titles intact.
   - Explicit empty `""` or whitespace-only `"   "` titles still reject and roll back with original rows and tags intact.
   - Preserves unfamiliar stored enums, empty optional text, explicit nulls, and omitted tags across partial saves.

### Maintained test verification (fourth review state)

- `src/data/singleConnectionDrivers.test.ts`: **89 passed** (including R8 header/body/target `end` triggers, CASE triggers, R8 negative controls on execute/select after trigger, multiple triggers, R9 omitted padded title preservation, review-status-only / tag-only updates, explicit title trimming, explicit blank rejection/rollback, raw enum/text preservation).
- Reviewer 14-case fourth-review diagnostic package (`a2FourthReview.regression.test.ts`): **14 passed, 0 failed** (6 raw engine controls, 6 public driver trigger identifier preservation cases, 2 omitted title preservation cases).
- Reviewer 12-case third-review diagnostic package (`a2ThirdReview.regression.test.ts`): **12 passed, 0 failed** (4 raw controls, 4 driver trigger cases, 4 R9 raw preservation cases).
- Shared Mac preparation package (`a2ReviewDiagnostics.mac.test.ts`): **181 passed, 0 failed** on real Windows engines (all 57 conditional seams reached).
- 7-file focused frontend suite: **163 passed, 0 failed** (`singleConnectionDrivers`, `materialSaveContract`, `materialSaveIntegration`, `documentRepository`, `MaterialFormDialog`, `quickDebrief`, `debriefLinks`).
- Native save suite: **21 passed, 0 failed** (`documents_save_tests.rs`); full `cargo test`: **283 passed, 0 failed, 6 ignored**.

### Corrected Mac Acceptance ID Mapping

- **PREP-R1:** Single-statement coherent observations (`observeMaterial`) and deterministic ownership barrier (`installStatementBarrier`).
- **PREP-R2:** Complete-state / raw-link integrity observation (`fullState`) and precise foreign-key enforcement versus fail-closed refusal (`proveForeignKeyEnforcement`).
- **PREP-R3:** Full expected/prior update outcomes verification (`updateOutcomeProblems`).
- **QT-08 / QT-09 / QT-10:** Public execute, select, and multi-statement opening transaction controls.
- **QT-11a / QT-11b:** Ending calls outside ownership and queued ending calls mid-save.
- **QT-12:** Legitimate SQL containing keywords in literals, identifiers, comments, PRAGMAs, and trigger bodies.
- **BD-01 / BD-02:** Create and update export failures restoring clean prior state.
- **BD-11:** Unrecoverable recovery failure failing closed with descriptive safe-state error.

---

## 10. Fifth review trigger-header table name corrections (R8) — 4 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R8** Header table token not consumed, so trailing controls escaped refusal | In `src/data/connectionOwner.ts`, after `ON`, `expectingTableName` was set to true. In the header keyword check, the unquoted `END` branch was evaluated before the expected-table-name branch, skipping `end` without clearing `expectingTableName`. In addition, the single-quoted token branch (`'...'`) did not consume `expectingTableName` for SQLite's engine-proven single-quoted table names (e.g. `ON 'end'`). Consequently, the subsequent `BEGIN` was swallowed as the expected table name; `triggerState` remained in `header` through the actual outer `END;` and any appended statement, completely bypassing the transaction control guard. | 8 raw-engine / public controls passed (`node:sqlite` and `sql.js` accept and fire triggers on `end` and `'end'`). All 64 trailing-control combinations (2 table spellings × 8 prohibited suffixes × 2 routes × 2 engines) failed: public execute and select resolved instead of refusing. |

### Implemented corrections and guarantees

1. **Header table name token consumption (`src/data/connectionOwner.ts`):**
   - Single-quoted string literal handler (`ch === "'"`): added `if (triggerState === "header" && expectingTableName) expectingTableName = false;` to consume single-quoted table identifiers in the header (e.g. `ON 'end'`) while keeping ordinary literals opaque elsewhere.
   - Word token handler (`/[a-zA-Z0-9_]/`): placed `if (expectingTableName) { expectingTableName = false; atStatementStart = false; continue; }` at the top of the `triggerState === "header"` block, before keyword checks like `CASE`, `END`, etc.
   - Table name tokens are consumed according to their grammatical role before interpreting their spelling as keywords. Following `ON end` or `ON 'end'`, `expectingTableName` is cleared, allowing `BEGIN` to transition `triggerState` to `"body"`, outer `END;` to reset `triggerState` to `"none"`, and trailing transaction statements to be inspected at top level and strictly refused.
   - Schema-qualified table names (`main.end`), backtick/bracket/quoted identifiers, comments, and CASE expressions remain fully supported.
2. **Maintained test expansion (`src/data/singleConnectionDrivers.test.ts`):**
   - Expanded driver test suite from 89 to **227 tests**.
   - Added full cartesian product matrix: 8 accepted trigger forms (trigger named end, unquoted table end, single-quoted table 'end', schema-qualified main.end, commented boundary, body table end, CASE in body, CASE in WHEN) combined with 8 prohibited transaction suffixes (`BEGIN;`, `BEGIN TRANSACTION;`, `COMMIT;`, `SAVEPOINT sp1;`, `ROLLBACK;`, `ROLLBACK TO sp1;`, `RELEASE sp1;`, `END;`) across both `execute` and `select` routes on both engines (`node:sqlite` and `sql.js`).
   - Added explicit side-effect proof: verified refusal throws before side effects occur, synthetic trigger is absent from `sqlite_master`, acknowledged prior rows/tags remain intact, and subsequent atomic saves succeed live and after reopening on sql.js.
   - Verified scanner accepts ordinary trailing SQL (e.g. `INSERT INTO source VALUES ('probe');`) without false positives under the driver execution contract.
3. **Fifth-review diagnostic verification:**
   - 72-case fifth-review diagnostic (`a2FifthReview.regression.test.ts`): **72 passed, 0 failed** (8 positive controls + 64 negative refusal cases).
   - 14-case fourth-review diagnostic (`a2FourthReview.regression.test.ts`): **14 passed, 0 failed**.
   - 12-case third-review diagnostic (`a2ThirdReview.regression.test.ts`): **12 passed, 0 failed**.
   - 181-case preparation package (`a2ReviewDiagnostics.mac.test.ts`): **181 passed, 0 failed** (all 57 conditional seams reached).
   - Combined test suite (10 test files): **557 passed, 0 failed**.
   - Full required local gate: `npm ci` (0 vulnerabilities), `npm test` (840 passed, 4 skipped), `npm run build` (clean), `cargo fmt` (clean), `cargo clippy` (clean), `cargo test` (283 passed, 6 ignored), `npm run test:cargo-lock` (clean), `node scripts/check-release-version.mjs 0.5.3` (valid), `git diff --check` (clean).

---

## 11. Sixth review complete SQLite token scanner corrections (R10) — 4 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R10** Whole SQLite identifiers containing dollar signs or non-ASCII characters fragmented into `CASE`, mutating `caseDepth` | In `src/data/connectionOwner.ts`, word boundaries were scanned with `/[a-zA-Z0-9_]/`. In SQLite (per draft tokenizer requirements and engine semantics), identifiers allow `$` anywhere after the first character and any non-ASCII character (code > 0x7f). As a result, valid unquoted SQLite identifiers such as `case$bucket`, `écase`, `caseé`, and `✈case` were split into an isolated `"case"` word token. This token matched `CASE` and incremented `caseDepth`. Inside a trigger body, the actual outer `END;` was consumed as closing the phantom CASE expression (`caseDepth--`) rather than terminating the trigger. Outside a trigger, in ordinary queries (e.g. `SELECT value FROM case$bucket; BEGIN;`), the phantom `caseDepth` survived to the subsequent statement, suppressing transaction keyword recognition (`TRANSACTION_KEYWORDS.has("BEGIN") && caseDepth === 0` evaluated to false). | 16 raw-engine / public positive controls passed (`node:sqlite` and `sql.js` accept and fire triggers on `case$bucket`, `écase`, `caseé`, and `✈case`, and accept ordinary SELECTs). 128 trailing transaction-control combinations (4 identifiers × 8 prohibited suffixes × 2 routes × 2 engines) failed with public resolution instead of refusal. 8 ordinary-SELECT refusal combinations also failed. |

### Implemented corrections and guarantees

1. **Complete SQLite token recognition (`src/data/connectionOwner.ts`):**
   - **Whitespace:** Restricted token delimiter whitespace strictly to SQLite's 5 ASCII whitespace characters: space (`0x20`), horizontal tab (`0x09`), line feed (`0x0a`), carriage return (`0x0d`), and form feed (`0x0c`). Non-ASCII space characters (such as `\u00A0`, code 160) are preserved as identifier characters.
   - **Identifier character classification:**
     - `isIdStart(code)`: ASCII letters (`a-z`, `A-Z`), underscore `_`, or any non-ASCII character (`code >= 0x80`).
     - `isIdPart(code)`: ASCII letters, ASCII digits (`0-9`), underscore `_`, dollar sign `$` (`0x24`), or any non-ASCII character (`code >= 0x80`).
   - **Whole-identifier scanning:** When an identifier begins, `isIdPart` consumes all contiguous identifier characters into a single token slice before any keyword inspection.
   - **Pure ASCII keyword extraction (`getAsciiKeyword`):** Keyword candidates are evaluated strictly on tokens with length between 2 and 9 where every character is an ASCII letter (`a-z`, `A-Z`). Case normalization is performed via ASCII-only uppercase conversion (`code - 32`), ensuring non-ASCII characters that map to ASCII letters under Unicode casing (e.g. German `ß`, long-s `ſ`, Turkish `ı`) never match ASCII keywords. Any token containing digits, underscores, dollar signs, or non-ASCII characters returns `null` and is treated as an identifier.
   - **Bound parameter tokens:** Parameter tokens (`:name`, `@name`, `$name`, `?`, `?123`) are scanned as complete tokens. Parameter names containing keyword text (e.g. `:case`, `@case`, `$case`) are consumed without fragmenting into keywords or mutating `caseDepth`.
   - **Consistent lookahead boundary:** The `CREATE TRIGGER` lookahead uses the identical `isIdStart`, `isIdPart`, and `getAsciiKeyword` boundaries and SQLite whitespace rules.
2. **Maintained test expansion (`src/data/singleConnectionDrivers.test.ts`):**
   - Expanded driver test suite from 227 to **391 tests**.
   - Added comprehensive coverage for the 4 reviewer names (`case$bucket`, `écase`, `caseé`, `✈case`), non-ASCII whitespace (`case\u00A0bucket`), keyword prefix/suffix forms (`case$end`, `ébegin`), and case-folding controls (`ſavepoint`).
   - Covered valid roles: table name, trigger name, body target table, column name, and ordinary statements (`SELECT`, `INSERT`, `UPDATE`).
   - Tested all 8 prohibited transaction suffixes (`BEGIN;`, `BEGIN TRANSACTION;`, `COMMIT;`, `SAVEPOINT sp1;`, `ROLLBACK;`, `ROLLBACK TO sp1;`, `RELEASE sp1;`, `END;`) on both `execute` and `select` routes across both engines (`node:sqlite` and `sql.js`).
   - Verified side-effect guarantees: refusal occurs prior to any side effect; prior rows, tags, and synthetic tables are preserved; sql.js reopened state remains intact; subsequent atomic saves succeed.
   - Verified bound-parameter token queries with keyword-containing parameter names (`:case`, `@case`, `$case`) under both drivers' existing binding contracts.
3. **Sixth-review diagnostic verification:**
   - 152-case sixth-review diagnostic (`a2SixthReview.regression.test.ts`): **152 passed, 0 failed** (16 positive controls + 136 negative refusal cases).
   - 72-case fifth-review diagnostic (`a2FifthReview.regression.test.ts`): **72 passed, 0 failed**.
   - 14-case fourth-review diagnostic (`a2FourthReview.regression.test.ts`): **14 passed, 0 failed**.
   - 12-case third-review diagnostic (`a2ThirdReview.regression.test.ts`): **12 passed, 0 failed**.
   - 181-case preparation package (`a2ReviewDiagnostics.mac.test.ts`): **181 passed, 0 failed** (all 57 conditional seams reached).
   - Combined focused and diagnostic suites (11 test files): **873 passed, 0 failed**.

---

## 12. Seventh review leading BOM & complete variable token corrections (R10 & R11) — 4 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R11** Leading BOM (`\uFEFF`) bypassed transaction command refusal | Real SQLite engines (`node:sqlite` and `sql.js`) treat a leading `\uFEFF` before a statement as ignorable whitespace (`TK_SPACE`), permitting `\uFEFFBEGIN;` or `\uFEFFSAVEPOINT;` to execute real transactions. In `src/data/connectionOwner.ts`, whitespace checking only checked the 5 SQLite ASCII whitespace bytes. Leading `\uFEFF` was treated as an unquoted identifier start rather than statement-opening whitespace. Consequently, `\uFEFFBEGIN;` and `\uFEFFSAVEPOINT;` bypassed public `hasTransactionControl` guards and executed raw transactions outside the connection owner. When subsequent queries failed, the connection owner's `rollbackIfOpen` rolled back the open transaction, causing earlier acknowledged public writes to vanish. | 8 refusal tests failed in reproduction (`execute` and `select` routes on both engines). 2 deterministic sequences demonstrated acknowledged writes vanishing in browser/test drivers. |
| **R10** Parameter namespace separators (`::`) and parenthesized suffixes (`(case)`) fragmented into `CASE` | Per SQLite token specifications (`tokenize.c` lines 509–538), `$value(case)` and `$value::ns(case)` are complete SQLite parameter tokens. In `src/data/connectionOwner.ts`, parameter scanning stopped at non-identifier characters (`:` or `(`), leaving `(case)` to be scanned as an opening parenthesis followed by the keyword `CASE`. This incremented `caseDepth`. The phantom depth persisted into subsequent statements, disabling transaction keyword recognition (`TRANSACTION_KEYWORDS.has(kw) && caseDepth === 0`). | 8 raw/public legality controls passed. 40 combinations (5 prohibited suffixes × 2 variable names × 2 routes × 2 engines) failed with public resolution instead of refusal. 8 `END;` suffix cases passed. |

### Implemented corrections and guarantees

1. **Leading BOM handling (`src/data/connectionOwner.ts`):**
   - At statement start (`atStatementStart`), leading BOM (`ch === "\uFEFF"`) is skipped as ignorable statement-prefix whitespace without resetting `atStatementStart`.
   - In `CREATE TRIGGER` lookahead delimiter scanning, `\uFEFF` is treated as a delimiter (`sql[j] === "\uFEFF"`).
   - BOM within identifiers (e.g. `[col\uFEFFname]` or unquoted non-ASCII identifiers) and inside string literals (e.g. `'prefix:\uFEFF'`) is strictly preserved, matching SQLite tokenizer semantics where non-ASCII bytes are identifier characters once a token is in flight.
   - Direct transaction commands with leading BOM (`\uFEFFBEGIN;`, `\uFEFFBEGIN TRANSACTION;`, `\uFEFFSAVEPOINT sp1;`) are recognized and strictly refused on both `execute` and `select` routes across both engines.
   - Refusal precedes side effects; acknowledged prior writes survive subsequent query failures.
   - Unsupported positions (e.g. `BEGIN\uFEFF;`) are verified to fail syntax parsing in the underlying engine.
2. **Complete SQLite variable token scanning (`src/data/connectionOwner.ts`):**
   - Enhanced variable scanner for `$`, `@`, `:`, and `#` prefixes to match SQLite `tokenize.c` parameter parsing:
     - Handles `::` namespace separators between identifier segments.
     - Handles parenthesized suffix `(inner)` without whitespace until `)`.
     - Parameter tokens containing keyword text (such as `$value(case)` or `$value::ns(case)`) are consumed as opaque parameter tokens without altering `caseDepth` or trigger state.
   - Semicolons and quotes outside the parameter remain top-level statement delimiters.
   - Trailing transaction commands following parameter tokens are strictly refused.
3. **Corrected test coverage (`src/data/singleConnectionDrivers.test.ts`):**
   - Removed `.replace(/[^a-zA-Z0-9]/g, '_')` sanitization: original raw names (`case$bucket`, `écase`, `caseé`, `✈case`, `case\u00A0bucket`, `caſe`) are used directly in trigger names, target table names, and column roles.
   - Added `caſe` (with long-s `\u017F`) as an identifier test and case-folding control.
   - Added genuine bound parameter execution controls with dollar forms.
   - Expanded driver test suite from 391 to **485 tests**.
   - Verified engine-specific Emscripten decoding behavior: sql.js Emscripten wasm layer strips index-0 BOM on JS string decoding while preserving interior BOM and exact UTF-8 bytes (`EFBBBF`).
4. **Seventh-review diagnostic verification:**
   - 68-case seventh-review diagnostic (`a2SeventhReview.regression.test.ts`): **68 passed, 0 failed** (18 positive controls + 50 negative refusal cases).
   - 152-case sixth-review diagnostic (`a2SixthReview.regression.test.ts`): **152 passed, 0 failed**.
   - 72-case fifth-review diagnostic (`a2FifthReview.regression.test.ts`): **72 passed, 0 failed**.
   - 14-case fourth-review diagnostic (`a2FourthReview.regression.test.ts`): **14 passed, 0 failed**.
   - 12-case third-review diagnostic (`a2ThirdReview.regression.test.ts`): **12 passed, 0 failed**.
   - 181-case preparation package (`a2ReviewDiagnostics.mac.test.ts`): **181 passed, 0 failed** (all 57 conditional seams reached).
   - Combined focused and diagnostic suites (12 test files): **1,035 passed, 0 failed** (536 maintained + 318 diagnostics + 181 shared).

---

## 13. Eighth review trigger token boundaries & grammatical roles (R11 & R12) — 4 October 2026

### Reproduced failures and root causes

| Finding | Root cause | Reviewer evidence (reproduction) |
| --- | --- | --- |
| **R12** Trigger `WHEN .5 BEGIN ... END;` dot branch globally sets expectingTableName | Trigger `WHEN .5 BEGIN ... END;` is legal SQLite syntax. In `src/data/connectionOwner.ts`, any dot seen in a trigger header set `expectingTableName = true`, even after the `ON` target table was already consumed. The numeric literal `.5` did not consume that expectation; actual body `BEGIN` was swallowed as a table token instead of transitioning to `"body"`. Appended transaction suffixes then bypassed refusal. | 32 appended-control refusal cases failed (4 forms × 8 suffixes × 2 routes / engines). 8 raw/public trigger firing controls passed. |
| **R11** U+FEFF before trigger body BEGIN is legal token-boundary whitespace in both engines | SQLite `tokenize.c` treats `0xEF 0xBB 0xBF` (`\uFEFF`) as ignorable whitespace at any token boundary, making `ON source \uFEFFBEGIN` legal. The scanner only skipped `\uFEFF` when `atStatementStart === true`, so `\uFEFF` before `BEGIN` treated `\uFEFFBEGIN` as a non-keyword identifier, leaving the header open. | 32 appended-control refusal cases failed. 8 raw/public trigger firing controls passed. |

### Implemented corrections and guarantees

1. **Trigger table-target grammatical role tracking (`src/data/connectionOwner.ts`):**
   - Replaced ad-hoc `expectingTableName` and `sawOn` with grammatical state machine:
     `onTargetState: "before_on" | "expect_first" | "expect_dot_or_done" | "expect_second" | "done"`.
   - When `triggerState === "header" && onTargetState === "expect_dot_or_done"`, any non-dot token (or a dot followed by a digit scanning a numeric literal) transitions `onTargetState` to `"done"`.
   - Schema qualification dot (`schema.table`) transitions to `"expect_second"`. Once `"done"`, subsequent dots in `WHEN` expressions (member access `NEW.id`, leading decimals `.5`, scientific `.5e1`, signed `+.5`, `-.5`, parenthesized `(.5)`, and nested `CASE WHEN ... THEN .5 ELSE 0 END > 0`) never re-enable table name expectations.
2. **Numeric literal scanning in `.` branch (`src/data/connectionOwner.ts`):**
   - When `ch === '.'` and `sql[i + 1]` is a digit (`0`-`9`), scans the number literal directly and clears `lastCharWasDot`.
3. **Lexical recognition of `\uFEFF` at token boundaries (`src/data/connectionOwner.ts`):**
   - Skipped at token boundary in the whitespace check regardless of `atStatementStart`.
   - Inside identifiers, `isIdPart` retains `\uFEFF` (e.g. `BEGIN\uFEFF;` fails `getAsciiKeyword` and remains a syntax error).
   - Preserves complete identifiers, non-ASCII letters/spaces, and Emscripten string-decoding boundaries.
4. **Maintained driver test additions (`src/data/singleConnectionDrivers.test.ts`):**
   - Added 120 maintained tests:
     - 13 differential forms across raw engines and public drivers (26 raw + 26 public).
     - 64 appended-suffix controls (4 forms × 8 suffixes × 2 engines).
     - 2 data preservation and sql.js reopened state check tests.
     - 2 unsupported BOM positions tests.
   - Driver suite expanded from 485 to **605 tests**.
5. **Eighth-review diagnostic and cumulative verification:**
   - 72-case eighth-review diagnostic (`a2EighthReview.regression.test.ts`): **72 passed, 0 failed** (all 64 previous failures resolved).
   - Cumulative focused diagnostics (3rd through 8th reviews + shared mac prep + maintained suites): **1,250 passed, 0 failed** (all 57 conditional seams reached).
   - Full frontend suite: **62 passed, 3 skipped, 1218 passed, 4 skipped**.

_Count correction (4 October 2026, ninth review): the "1,250 = 656 + 413 + 181" cumulative figure above was misreported. Codex's independent count is 1,227 = 656 maintained + 390 diagnostics + 181 shared, and it gave per-file maintained counts as driver 605 / contract 1 / repository 25 / form 12 / integration 3 / editor safety 10. The text above is kept unchanged as historical handoff evidence._

---

## 14. Ninth review line-comment boundary correction (R13) — 4 October 2026

### Reproduced failure and root cause

| Finding | Root cause | Reproduction (pre-fix, retained log) |
| --- | --- | --- |
| **R13** A CR inside a `--` line comment escaped comment state | In `src/data/connectionOwner.ts`, both the normal token loop and the CREATE/TRIGGER lookahead ended a line comment at CR **or** LF. SQLite 3.53.0 (node:sqlite) and sql.js 1.14.2 end it only at LF or input end; `tokenize.c`'s `TK_COMMENT` loop stops on `\n` alone. So in `--\rignored\nBEGIN;`, the scanner read `ignored` as the statement's first token and missed the real `BEGIN`. `--\rCASE\n` gave a phantom CASE depth, and `CREATE --\rignored\nTRIGGER` left lookahead too early. | Unchanged ninth diagnostic (`2b622e1f…`) on a 307-file matching-source snapshot: **78 cases, 8 passed / 70 failed, exit 1**. The 70 are 64 guard failures, 4 valid-SQL false rejections and 2 acknowledged-write losses (node:sqlite rollback recovery; sql.js export/reopen). Log: `docs/evidence/a2-r13-line-comment-2026-10-04/01-prefix-ninth-diagnostic.log`. |

### Implemented correction (Task A)

- A module-private `lineCommentEnd(sql, start)` returns the index of the LF that ends the comment, or the input length. Both the token loop and the CREATE/TRIGGER lookahead call it, so they cannot drift apart again. The LF itself is then consumed as ordinary SQLite whitespace.
- No SQL is stripped or normalized, and no parser, dependency, binding API, raw handle or native code changed. CR outside comments is still SQLite whitespace. Block comments, quoted strings and identifiers stay opaque. All R6–R12 behaviour is untouched: BOM token boundaries, ASCII keyword boundaries, complete variables, ON-target state, decimal/member-access roles, nested CASE, the real outer END, serialization and fail-closed recovery.
- Result: the unchanged ninth diagnostic passes **78/78** (all 70 failures resolved; all 8 controls still pass). The maintained driver file still passes its previous 605 cases.

### Maintained regression coverage (Task B, `src/data/singleConnectionDrivers.test.ts`)

`R13 line-comment boundary — node:sqlite | sql.js`: **780 new cases (390 per engine)**. Raw engines are the oracle, and their legality controls run before the guard assertions:

| Group | Per engine | What it proves |
| --- | --- | --- |
| Comment ends only at LF | 14 raw + 14 public + 224 refusal | 14 comment forms: LF, CRLF, one or more embedded CRs, CR then CRLF, and CR followed by `CASE`, `END`, `BEGIN;`, `; COMMIT`, `'`, `"`, `[`, `` ` `` or `/*`. Raw: the following BEGIN is a real transaction. Public: valid SELECT/INSERT after each comment is accepted. All 8 suffixes are refused on both routes. |
| Comment runs to input end | 1 raw + 1 public + 16 refusal + 1 record | A trailing `--\r…` comment holding a transaction keyword is accepted. A transaction command written before such a comment is still refused. Comment-only input is recorded separately: node `prepare` has no statement for it, so it is not a positive public control. |
| Trailing after statement / completed trigger | 3 raw + 48 refusal | Covers a SELECT and two completed triggers, each followed by a CR comment. All 8 suffixes are refused on both routes, and no trigger is created. |
| Trigger lookahead / header / body | 8 raw + 8 (node) or 6 (sql.js) public + 16 refusal + 1 create-table pair (2 raw/public) + 2 (sql.js) records | Covers CR comments between CREATE/TEMP/TEMPORARY and TRIGGER, before the name, after the ON target, inside WHEN, at body start and before the outer END: each trigger creates and fires. An appended BEGIN is refused. `CREATE --\rTRIGGER\nTABLE` stays a table. sql.js TEMP forms are a **driver-limitation record**: export/reopen drops TEMP triggers with or without comments, so they are not counted as firing controls. |
| Opaque tokens / CR whitespace | 5+5 accepted, 5 raw + 10 refused | Block comments, strings and quoted identifiers that contain CR, LF, `--` or BEGIN stay opaque. A BEGIN after them, or after a bare CR, is refused. |
| Refusal precedes side effects | 8 + 1 | A refusal followed by an acknowledged write and an unrelated failure keeps the row, including after sql.js reopen. Prior material fields/tags, unrelated rows, triggers and sql.js reloaded storage are preserved, and the next atomic save succeeds. |

Negative control: the same test file run against the **unfixed** scanner (`09dd97f1…`) fails **426 of 780** R13 cases. The 354 that pass there are raw oracles and forms the old scanner already handled. Log: `04-taskB-sensitivity-new-tests-on-prefix-scanner.log`.

### Cumulative focused verification

Ran the reviewer's 14-file command on an isolated snapshot (current source plus the unchanged diagnostic copies, hashes in `diagnostic-copies.sha256`): **2,085 passed, 0 failed, 0 skipped, exit 0**. Counts derived from the log are: driver 1,385, contract 1, repository 25, form 12, integration 3, editor safety 10, ninth 78, eighth 72, seventh 68, sixth 152, fifth 72, fourth 14, third 12, shared 181. All 57 conditional seams were reached; each asserts that its barrier fired. Full-gate logs are listed in the evidence README.

---

## 15. Remaining limitations and platform holds

- **A2 is not accepted on main:** implemented locally, uncommitted for independent Codex review. The ninth review inspected main `f4c4b53f3e71907ee9f46cb2640de46eec90db5d`; current fetched main is `37ec9a1f99af61dc0ce89b672bb0a4b63d69ac51`; branch base is `533a8f50c2d0de74a75f5542022da3182f376ee9`.
- **R13 scope:** demonstrated loss was in the development/browser drivers (node:sqlite tests, sql.js). Desktop Tauri does not use this scanner; no native or installed loss was demonstrated or claimed fixed here.
- **Mac installed readiness and APFS identity:** UNVERIFIED. Windows tests ran on NTFS; case-sensitive volumes, physical Apple Silicon, macOS 12 WKWebView, and live Gemini remain unverified.
- **Release holds:** Windows distribution remains held on v0.5.1; v0.5.2 retired; frozen v0.5.3 Mac candidate held.
