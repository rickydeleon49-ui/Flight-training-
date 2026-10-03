# A2 Mac verification preparation — 3 October 2026

Publication annotation: [Codex accepts the corrected preparation](MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md). PREP-R1–R3 are closed; A2 application validation still requires matching accepted source. The author's working-state observations below are retained as history.

Prepared from the [expanded A2 preparation prompt](CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md) (published on main by PR #52, `0a5276b`; this branch predates that merge, so the prompt was read from `origin/main`).

**Outcome: preparation complete; A2 validation not started.** The corrected A2 source is **not available on GitHub**, so every A2-dependent case is **BLOCKED**. Nothing in this package is an A2 pass. This package covers:

- the acceptance matrix
- prepared diagnostics
- engine-level evidence
- copy-ready commands
- the Windows-owner handoff

No production, test or tooling source changed. This is the implementer's report and **not Codex acceptance**.

**Corrected 3 October 2026 after [Codex's preparation review](MAC_A2_PREPARATION_REVIEW_2026-10-03.md).** That review found three defects in the prepared observations and assertions (PREP-R1 to R3). They are fixed and validated by task-local oracle controls, which ran on real engines without any A2 API. The issue-to-fix map is in §13. The earlier receipts are preserved. The corrections change prepared tests only; A2 remains unvalidated.

## 1. Working identity

| Item | Value |
| --- | --- |
| Repository | `rickydeleon49-ui/Flight-training-`, clone `/Users/rickymac/code/Flight-training-` |
| Branch / upstream | `codex/mac-a2-verification-preparation` / none (unpushed) |
| HEAD | `54b82b3b59667b2ff9847c14fd6e44bcb3399e02` (PR #51 merge, A5 acceptance) |
| origin/main at check | `0a5276b4b2ce8cc1ff3993b2c0541c480c438df2` (PR #52; differs from HEAD only in the prompt file) |
| Dirty files at the start of this continuation | `M STATUS.md`, `M docs/PROJECT_HANDOFF.md`, untracked: this report and `docs/evidence/mac-a2-preparation-2026-10-03/` (README, probe, probe JSON, diagnostics, source receipt). All belong to this preparation task; there were no competing changes. |
| Roles | Preparer: Claude (Mac). Reviewer / Git coordinator: Codex. **A2 implementation owner: the Windows implementer (unchanged).** |
| Host | MacBook Air (Mac17,3), Apple M5, arm64, macOS **27.0.1 (26A434)**; every APFS volume case-insensitive |
| Toolchain (scoped `PATH`; paths verified to exist) | Node **v22.23.3** (`/opt/homebrew/opt/node@22/bin`), npm **10.9.9**, rustc **1.99.0** (b940084d7 2026-09-28), cargo **1.99.0** (5f94df478 2026-08-27) (`/opt/homebrew/opt/rustup/bin`), `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` (present; `xcrun --show-sdk-version` → 26.5). Engines: node:sqlite on SQLite **3.53.4**, sql.js **1.14.2**, Vitest **4.1.11**. |

## 2. Source availability (resolved: **unavailable**)

[Receipt](evidence/mac-a2-preparation-2026-10-03/source-availability.txt), checked **2026-10-03T16:36Z** (first check 16:28Z, same result).

- **Branches:** there is no `fix/atomic-study-material-saves` branch on origin, and no branch named atomic or material-save.
- **Pull requests:** all 52 PR head refs (#1–#52) were fetched into temporary local refs, which were deleted afterwards. No commit on any branch or PR head touches `connectionOwner.ts`, `materialTransaction.ts` or `documents_save_tests.rs`.
- **Mentions of `saveMaterialAtomically`:** three commits, all documentation (PR #52 and `7372da6`).
- **PR metadata:** Claude's environment had no authenticated GitHub API route. An unauthenticated REST request returned 404, because the repository is private, and Claude had no authenticated `gh`. This is a limit of Claude's session, not evidence that this Mac lacks `gh`; Codex used authenticated `gh` during its review.
  - PR head refs (`refs/pull/*/head`) identify reachable source commits. They do **not** say whether a PR is open, closed or merged.
  - The check used GitHub network access (fetch, `ls-remote`, one REST request). No application data, credentials or provider (Gemini) requests were involved.
- **Newest acceptance record:** [second review](A2_SECOND_REVIEW_DETAILS_2026-10-02.md), "corrections required" (R6, R7).
- **Last recorded identity:** uncommitted Windows work on `fix/atomic-study-material-saves`, base `533a8f50c2d0de74a75f5542022da3182f376ee9`, at the ten [reviewed hashes](evidence/a2-second-review-2026-10-02/after-review-hash-verification.json).
  - On main, six of those files are absent and four differ. Full hashes are in the receipt.
  - The observation means the source is not published. It does not prove that no unpublished source exists.
- **API on main:** `src/data/db.ts` has `saveMaterialsAtomically` (plural, the PDF-part batch contract) and `saveDebriefAtomically`. It has neither `saveMaterialAtomically` nor `MaterialSaveOperation`.
  - This is a **prerequisite mismatch**. The five reviewer diagnostics were therefore **not run**, and their missing symbols are not reported as defects.

Outcome category: **1 — source unavailable**. The package is finished and dependent execution is marked BLOCKED.

## 3. Evidence levels

Status labels used below. No single "passed" label is used.

| Label | Meaning |
| --- | --- |
| **MAC-RUN (main)** | Run on this Mac today against current main. It proves main's existing behavior, **not A2**. |
| **MAC-RUN (engine)** | Raw-engine probe run on this Mac today. It proves an engine premise only. |
| **HIST-WIN** | The test exists in the reviewed A2 snapshot and passed in Codex's 2 October Windows review. This is a historical receipt; it has **not** been run on this Mac. |
| **HIST-WIN-FAIL** | One of the five reviewer diagnostics that failed on the reviewed snapshot. It must pass on the corrected source. |
| **PREPARED** | A prepared case in [`a2ReviewDiagnostics.mac.test.ts`](evidence/mac-a2-preparation-2026-10-03/a2ReviewDiagnostics.mac.test.ts). It was statically validated and **never executed** (no matching source). |
| **PREPARED-ORACLE** | A task-local oracle control (`a2ObservationOracle.check.ts`), run on this Mac against real node:sqlite and sql.js with the project migrations and a stand-in owner harness. It validates the prepared observations and assertions only; it calls **no A2 API** and proves nothing about A2. |
| **PREPARED-COND** | A prepared case whose fault seam depends on how the corrected driver is written. The case fails loudly with "seam not reached" rather than passing vacuously. |
| **SPECIFIED** | A case written down for the source owner because it needs internals or native seams that only the source has. |
| **INSTALLED** | Installed-app evidence only. It needs the dedicated test account and an acceptable signing state. |

Execution status of **every** A2 row is **BLOCKED (source unavailable)** unless the row says MAC-RUN.

## 4. Acceptance matrix

Rows reference **verified** test names:

- **Main tests:** confirmed by `vitest list` on main and by the passing focused runs in §7.
- **Rust test names on main:** confirmed by the same `cargo test documents::tests::` run.
- **A2-source names:** taken from the shared Windows logs in `docs/evidence/a2-second-review-2026-10-02/`.
- **Prepared IDs:** appear in brackets in the prepared file's test names.

"Driver" values:

- **node** = node:sqlite test driver
- **sqljs** = browser development driver
- **native** = Rust with real files and migrations
- **UI** = jsdom page with the native file service mocked

### 4.1 Atomic records and tags (AR)

| ID | Requirement · setup/action | Expected | Driver | Existing maintained test | A2-source test (HIST-WIN) | Prepared / missing | Prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AR-01 | Create with fields and tags in one operation | One row and its links, live and reopened | node, sqljs, native | — (main has no single-material atomic save) | repository "normalizes and deduplicates duplicate and whitespace tags during create without partial save"; native `tag_normalization_omission_clearing_unicode_and_case_are_preserved`; `materialSaveContract.test.ts` › "replays the shared material-save fixtures…" | PREPARED `[AR-01]` both engines | Source |
| AR-02 | Update title and tags; `notes`, `topic`, `file_path`, `last_reviewed_at`, `created_at` were set beforehand by public `UPDATE` | Title and links replaced; every other column byte-identical apart from `updated_at` | node, sqljs | — | "partial update preserves unchanged fields and createdAt timestamp"; native `replacing_a_tag_persists_the_acknowledged_tag_after_reopen` | PREPARED `[AR-02]` | Source |
| AR-03 | Omitted tags versus explicit `[]` | Omitted keeps the links; `[]` clears them; the row remains | node, sqljs, native | — | "omitted tags preserves old links; explicit empty array clears them"; native normalization test above | PREPARED `[AR-03]` | Source |
| AR-04 | Create fails after the material row and tag row are written. Seam: a synthetic `BEFORE INSERT ON material_tags` trigger with `RAISE(ABORT)` for tag "Poison tag" (a legitimate public `CREATE TRIGGER`). The table `unrelated` holds the acknowledged row `acknowledged`. | Complete prior state unchanged: `study_materials`, `tags` (no stray "Poison tag" or "Synthetic tag" rows), links, unrelated | node, sqljs, native | — | "rolls back completely on injected tag-write failure during create, leaving no material debris"; native `tag_and_link_failures_roll_back_create_and_update` | PREPARED `[AR-04/AR-06]` | Source |
| AR-05 | Update fails mid-link (same seam); prior notes and `file_path` are set | Complete prior row, tags and links unchanged; no "New tag" row | node, sqljs, native | — | "…during update, preserving prior metadata, file reference, and tags"; native as above | PREPARED `[AR-05/AR-06]` | Source |
| AR-06 | Retry after the rejection: drop the seam trigger and resubmit the same operation | Exactly one row and the intended links; unrelated row intact; sqljs reopen equals live | node, sqljs | quickDebrief "preserves draft text on save failure and enables safe retry without duplicate records" (debrief analogue, MAC-RUN main) | MaterialFormDialog "retry after failed save preserves user inputs and succeeds on second attempt" | PREPARED (in AR-04 and AR-05) | Source |
| AR-07 | ID collision on create; update of a missing ID | Refused; existing record untouched | node | — | "refuses create when material ID collides…", "refuses update when material does not exist" | Covered by HIST-WIN; rerun | Source |
| AR-08 | Post-commit refresh failure: the save commits, then the page refresh throws | Reported as saved, not failed. The new attachment stays referenced and is **not** cleaned up. A replaced old file is cleaned only per the committed-save path. | UI | `editorSafety` "does not treat a successful write with failed refresh as a failed save" (MAC-RUN main; generic, not attachment-specific) | same test in the A2 snapshot | **SPECIFIED:** a material-dialog case with an attachment, where refresh throws after commit. Assert no cleanup of the newly referenced file, old-file cleanup only after commit, and no "save failed" message. A rejected storage operation is the opposite case (AF-03/AF-05). | Source owner adds the UI case |
| AR-09 | Unicode, case and whitespace tag normalization | Deduplicated canonical tags | node, native | — | "handles Unicode tags and whitespace normalization consistently"; native normalization test | Covered by HIST-WIN; rerun | Source |

### 4.2 Attachment and native-file conservation (AF)

Native tests use real files and migrations. The UI tests mock the file service. Nothing here was executed for A2 on the Mac.

File-conservation expectations (all synthetic). "Old" = the attachment referenced before the action; "staged" = the newly imported app-owned copy.

| ID | Case | Before | After (expected) | Cleanup |
| --- | --- | --- | --- | --- |
| AF-01 | New attachment, create succeeds | staged exists, refs 0 | staged exists, refs 1, hash unchanged | none |
| AF-02 | Replacement, save succeeds | old refs 1; staged refs 0 | staged refs 1; old refs 0 | old removed **after** commit, only if refs 0 |
| AF-03 | Replacement, save fails | old refs 1; staged refs 0 | old refs 1, bytes and hash unchanged; staged refs 0, kept for retry | none until Cancel or retry |
| AF-04 | Retry after AF-03 | as AF-03 after | as AF-02 after; exactly one row | as AF-02 |
| AF-05 | Cancel a new import, or Cancel after a failed save | staged refs 0 | staged removed; any saved old attachment untouched | only the never-committed staged file |
| AF-06 | Cancel after a failed replacement | old refs 1; staged refs 0 | old untouched; staged removed | staged only |

| ID | Requirement | Driver | Existing maintained test (main) | A2-source tests (HIST-WIN) | Status / prerequisite |
| --- | --- | --- | --- | --- | --- |
| AF-01 | New attachment must be a real app-owned file | native, UI | — | native `new_attachments_must_be_real_app_owned_files`, `ordinary_attachment_flows_still_work`; MaterialFormDialog "closes dialog on successful creation of a new material" | Source |
| AF-02 | Replacement success | native, UI | MaterialFormDialog "removes the previous attachment when a replacement file is saved successfully", "…when the file is removed and saved successfully" (MAC-RUN main) | same UI tests; native `repeated_replacement_reorder_removal_and_shared_tags_stay_truthful` | Source |
| AF-03 | Failed replacement conserves the old file | native, node, UI | MaterialFormDialog "preserves the previous attachment and displays an error if saving fails" (MAC-RUN main) | native `a_failed_replacement_keeps_the_old_row_tags_and_file`; repository "replacement followed by failed save preserves old file reference and leaves new file unreferenced" | Source |
| AF-04 | Retry after a failed save | UI + real SQLite | MaterialFormDialog "keeps an import available for retry and prevents duplicate saves" (MAC-RUN main) | `materialSaveIntegration.test.ts` "a failed save leaves no rows and keeps the import; the retry commits once and keeps the file" | Source |
| AF-05 | Cancel | UI | MaterialFormDialog "removes a newly imported file when the material form is cancelled", "never deletes a saved attachment when an edit is cancelled", "keeps the form visible if an abandoned import cannot be removed" (MAC-RUN main) | integration "cancelling after a failed save discards only that new, never-committed import" | Source |
| AF-06 | Cancel after a failed replacement | UI | — | MaterialFormDialog "cancel after failed save of replacement cleans only the new unreferenced file and preserves original" | Source |
| AF-07 | Save/cleanup race ownership | native | — | `save_first_then_cleanup_preserves_the_now_referenced_file`, `cleanup_first_then_a_save_cannot_attach_the_deleted_file`, `a_save_waiting_for_the_writer_lock_sees_the_cleanup_outcome`; reviewer `a2_review_cleanup_wins_then_a_save_cannot_attach_the_deleted_file` | Source |
| AF-08 | Unreferenced files are still cleaned | native, UI | MaterialFormDialog "cleans up intermediate abandoned files on repeated replacement before saving", "surfaces former attachment cleanup failure, keeps dialog open, and allows bounded retry" (MAC-RUN main) | native `unused_and_no_longer_referenced_files_are_still_cleaned_up` | Source |
| AF-09 | Equivalent slash spelling cannot delete a referenced file | native | — | `an_equivalent_slash_spelling_cannot_delete_a_referenced_file`; reviewer `a2_review_equivalent_slash_path_cannot_delete_a_referenced_file` | Source |
| AF-10 | Case alias cannot delete or trash a referenced file | native | — | `a_windows_case_alias_cannot_delete_or_trash_a_referenced_file`; reviewer `a2_review_windows_case_alias_cannot_delete_a_referenced_file` | Source. **Mac label: case-insensitive APFS (host default).** Inspect the source for `cfg(windows)` gating; a gated test is NOT EXERCISED here, not passed. |
| AF-11 | Directory link alias | native | — | `a_directory_link_alias_cannot_delete_a_referenced_file` (a junction on Windows) | Source. **Mac label: symlink.** Record whether the test builds a symlink on macOS or is gated. |
| AF-12 | Legacy and shared stored spellings protect the file | native | — | `legacy_and_shared_stored_spellings_protect_the_physical_file` | Source |
| AF-13 | Traversal and unsafe paths fail closed | native | `climbing_out_of_the_documents_folder_is_refused`, `windows_drive_and_alternate_stream_paths_are_refused_on_every_platform`, `traversal_staged_ids_are_rejected_for_rollback_and_commit`, `meta_with_traversal_original_path_is_not_restored_outside_documents` (MAC-RUN main) | `unsafe_paths_and_uninspectable_databases_fail_closed` | main MAC-RUN; A2 Source |
| AF-14 | Distinct-case files on a case-sensitive volume are not conflated | native | — | `distinct_case_files_on_a_case_sensitive_volume_are_not_conflated` (**returned early on NTFS**) | Source **and** a case-sensitive root. The host volumes are case-insensitive, so the test will return early unless redirected. A task-owned case-sensitive APFS image works on this Mac ([capability check](evidence/mac-a2-preparation-2026-10-03/case-sensitive-volume-capability.txt)). An early return is **not** a pass. |
| AF-15 | Replacement never overwrites the saved file | native | `replacing_an_attachment_never_overwrites_the_saved_file` (MAC-RUN main) | — | main MAC-RUN |
| AF-16 | Writer-lock bounds | native, node | `save_split_materials_waits_for_transient_exclusive_lock_and_succeeds`, `save_split_materials_times_out_boundedly_on_permanent_lock` (MAC-RUN main); repository "retries past a transient lock when using saveMaterialsAtomically and succeeds", "gives up boundedly…" (MAC-RUN main) | `an_ordinary_save_waits_out_a_transient_writer_lock` (Windows 459.77 ms), `an_ordinary_save_reports_a_permanent_writer_lock_after_one_busy_timeout` (Windows 5.515 s); repository "retries transient lock on material save and succeeds", "times out boundedly when material save encounters permanent lock" | Source. Record Mac timings; no timeout change. |
| AF-17 | Native/JS contract equivalence | native, node | — | `shared_contract_fixtures_return_and_persist_the_same_results_as_the_browser_transaction`; `materialSaveContract.test.ts` | Source (fixtures absent on main) |
| AF-18 | Orphan tags and ID collisions do not suppress links | native | — | `orphan_tags_and_unrelated_id_collisions_do_not_suppress_links` | Source |
| AF-19 | Tag replacement persists after reopen | native | — | `replacing_a_tag_persists_the_acknowledged_tag_after_reopen`; reviewer `a2_review_replacing_a_native_tag_persists_the_acknowledged_tag` | Source |

**Mapping of the historical native evidence:**

- **21 native save tests:**
  - AF-01 ×2
  - AF-02, AF-03, AF-07 ×3
  - AF-08, AF-09, AF-10, AF-11, AF-12, AF-13, AF-14
  - AF-16 ×2
  - AF-17, AF-18, AF-19
  - AR-01/AR-03 (normalization), AR-04/AR-05 (`tag_and_link_failures…`)
- **Four reviewer cases:** AF-07, AF-09, AF-10, AF-19.

These counts are **historical Windows** results (21 passed, 4 passed). They are not Mac results.

**Physical-evidence gap:** the shared logs show pass/fail only. They do not show per-case file hashes or reference counts. When the source is available, check that each native case asserts old/staged existence and bytes. If not, record the gap for the source owner; do not infer it.

### 4.3 Queue and transaction ownership (QT)

The engine facts below come from the [v2 probe](evidence/mac-a2-preparation-2026-10-03/engine-probe.json) (MAC-RUN engine). They define what a corrected guard must cover.

| Engine route | Opening forms accepted (left a transaction open) | Notes |
| --- | --- | --- |
| node:sqlite `prepare().run()` (execute) and `prepare().all()` (select) | 13/13 accepted each route; 12/13 opened (all except `SELECT 1; BEGIN`) | `prepare` compiles only the first statement. `BEGIN; SELECT 1` opens, while a trailing `; BEGIN` is silently ignored. |
| sql.js `run(sql, [])` (main's execute path) and select | same as node: 12/13 opened | first statement only |
| sql.js `run(sql)` with no params (→ `exec`) | **13/13 opened, including `SELECT 1; BEGIN`** | `exec` runs every statement. A guard that inspects only the first statement is unsafe on this route. |
| Ending forms while an owner holds `BEGIN` + `SAVEPOINT` | All accepted on every route | `COMMIT`, `END`, `END TRANSACTION` and `COMMIT TRANSACTION` commit the owner's partial work. `ROLLBACK` and `/* */ ROLLBACK` discard it. `RELEASE s1` folds the savepoint. `ROLLBACK TO s1` discards the savepoint's work. `SELECT 1; COMMIT` commits only on the `exec` route. |
| Legitimate controls | node 16/16, sql.js 22/22 accepted without leaving a transaction | Covers comments, line comments, parameters, quoted `'BEGIN; COMMIT; ROLLBACK'`, the identifier `"begin"`, `PRAGMA foreign_keys`, `PRAGMA table_info` and `CREATE TRIGGER … BEGIN … END`. |

| ID | Requirement · setup/action | Expected | Driver | Existing maintained test | A2-source test (HIST-WIN) | Prepared / missing | Prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QT-01 | Acknowledged unrelated write, then a later rejected material save | Unrelated row survives live (and reopened on sqljs) | node, sqljs | — | `singleConnectionDrivers.test.ts` "promoted R4: an unrelated write issued during a failing save survives its rollback" ×2 | DX-1, DX-2, DX-3 (HIST-WIN-FAIL); `[AR-04/AR-06]` | Source |
| QT-02a | A read issued around a save, observed with **one** SQL statement (`observeMaterial`: scalar subqueries) | Coherent: `none` or `complete`, never `partial`. This does not by itself prove overlap. | node, sqljs | — | "a read issued mid-transaction cannot see uncommitted rows" ×2 | PREPARED `[QT-02a]`. Observation validated by PREPARED-ORACLE R1-1 to R1-4 (`none`/`complete` schedules, Codex's schedule, five partial datasets). | Source |
| QT-02b | A read **requested while the save holds ownership**. Barrier: `installStatementBarrier` fires when the save's first `material_tags` insert reaches the engine inside its open transaction; node additionally reports `isTransaction` = true at that point. | `complete` (queued behind the save); `partial` means the read entered the transaction | node, sqljs | — | — | PREPARED-COND `[QT-02b]`. Barrier validated by PREPARED-ORACLE R1-5 (FIFO owner → complete) and R1-6 (no owner → partial). | Source; seam request in §6 item 7 |
| QT-03 | Concurrent saves, public writes, debriefs and PDF-part batches | Each keeps its own outcome | node, sqljs | quickDebrief suite (debrief atomicity, MAC-RUN main); repository "creating PDF parts atomically" ×8 (MAC-RUN main) | "concurrent saves, public writes, debriefs and PDF-part batches each keep their own outcome" ×2 | HIST-WIN | Source |
| QT-04 | FIFO order | Strict request order | owner | `editorSafety` "serializes read-modify-write mutations and continues after a failure" (MAC-RUN main; UI-level) | connection owner "runs operations strictly one at a time in request order" | HIST-WIN | Source |
| QT-05 | Release after a failure | The next operation runs | owner | — | "releases after a failed operation so the next one runs" | HIST-WIN | Source |
| QT-06 | Poisoned owner | Later work refused without hanging | owner | — | "refuses later work, without hanging, when the connection cannot be made safe" | HIST-WIN | Source |
| QT-07 | Persist requested mid-save | Cannot cut the save short or store it half-done | sqljs | — | "a persist requested mid-save cannot cut that save's transaction short or store it half-done" | HIST-WIN | Source |
| QT-08 | Public **execute** opening forms (13, including comments, whitespace, case and separators) | Refused, or bounded so that no transaction survives the call. A following acknowledged write survives a later save. | node, sqljs | — | plain form only: "refuses public transaction control and stays usable after failures" ×2 | DX-1 (HIST-WIN-FAIL) + PREPARED `[QT-08/QT-09/QT-10]` (11 forms × 2 routes × 2 engines) | Source |
| QT-09 | Public **select** opening forms | as QT-08 | node, sqljs | — | — | DX-2, DX-3 (HIST-WIN-FAIL) + PREPARED | Source |
| QT-10 | sql.js `exec` multi-statement route (`SELECT 1; BEGIN`) | as QT-08. The corrected driver must not rely on first-statement inspection if any path uses `exec`. | sqljs | — | — | PREPARED (included in the QT-08 set) | Source |
| QT-11a | Ending forms (13: `COMMIT [TRANSACTION]`, `END [TRANSACTION]`, `ROLLBACK`, commented forms, `RELEASE [SAVEPOINT]`, `ROLLBACK [TRANSACTION] TO [SAVEPOINT]`, `SELECT 1; COMMIT`, `SELECT 1; ROLLBACK`) via public execute **and** select, **outside** any save | Complete state unchanged (live and reopened). A read, a write and a complete save (`updateOutcomeProblems` = []) still work afterwards. | node, sqljs | — | — | PREPARED `[QT-11a]` (13 × 2 routes × 2 engines = 52) | Source |
| QT-11b | The same forms **requested while a save holds ownership** (barrier as QT-02b) | Saved: complete expected result (new title, intended raw links, untouched columns, other rows, prior tags and the unrelated row conserved; no stray tag or dangling link). Rejected: complete prior state. sql.js reopened equals live. The connection stays usable. | node, sqljs | — | — | PREPARED-COND `[QT-11b]` (52). Assertion policy validated by PREPARED-ORACLE R3-1 to R3-5. | Source; §6 item 7 |
| QT-12 | Legitimate SQL is not over-refused | All controls work, and a save fires a user trigger | node, sqljs | — | — | PREPARED `[QT-12]` | Source |
| QT-13 | Refusal leaves the connection usable | Normal writes and saves succeed after a refusal | node, sqljs | — | "refuses public transaction control and stays usable after failures" | PREPARED (asserted in every QT-08 and QT-11a case) | Source |

### 4.4 Browser durability and recovery (BD, sql.js only)

Engine premises (MAC-RUN engine):

- `export()` during an open transaction drops its uncommitted row (`rowsAfterExport: []`).
- A one-shot `SQL.Database.prototype.export` fault fails once, then exports, and restores cleanly.
- **`export()` resets `PRAGMA foreign_keys` from 1 to 0**, so a durable write must restore it inside its failure boundary. This is why the seam in BD-06 matters.

| ID | Requirement · fault seam and timing | Expected (complete rows, tags and links, live **and** reopened) | Existing maintained test | A2-source test (HIST-WIN) | Prepared | Prerequisite |
| --- | --- | --- | --- | --- | --- | --- |
| BD-01 | Create; one-shot export throw after the atomic commit, before storage | live = reopened = prior (no material) | — | — | DX-4 (HIST-WIN-FAIL: live showed the row); PREPARED `[BD-01/BD-02]` (complete state) | Source |
| BD-02 | Update; same seam | live = reopened = prior title and links | — | — | DX-5 (HIST-WIN-FAIL: live showed "Changed guide"); PREPARED | Source |
| BD-03 | Retry after BD-01 | Exactly one row and link; reopened equals live | — | "a retry after storage recovers saves once, with the retried fields, and survives reopening" (storage seam) | PREPARED `[BD-03]` | Source |
| BD-04 | Failed update, then retry | Prior state held until the successful retry | — | "a refused update keeps the previous row and tags live and after reopening" (storage seam) | PREPARED `[BD-04]` | Source |
| BD-05 | Encoding (bytes to stored string); one-shot `globalThis.btoa` stub | prior restored; save rejected | — | — | PREPARED-COND `[BD-05]`; asserts that the seam fired | Source; driver must encode via `btoa` |
| BD-06 | Connection-setting restoration; one-shot throw on the `PRAGMA foreign_keys = ON` statement via the `run`/`exec` prototype | Complete prior state restored, live and reopened. `proveForeignKeyEnforcement` = `enforced`: a usable scratch write, setting 1, and the orphan insert fails with SQLite's foreign-key error. | — | — | PREPARED-COND `[BD-06]`; asserts that the seam fired | Source |
| BD-07 | Storage quota refusal | prior restored | — (main swallows storage errors, see §8) | "promoted R5: a create that storage refuses is reported as failed and leaves nothing behind", "a refused update keeps…" | PREPARED `[BD-07]` | Source |
| BD-08 | Later unrelated write after a rejection | The rejected change never becomes durable; the later write does | — | — | PREPARED `[BD-08]` | Source |
| BD-09 | Explicit `persist()` after a rejection | The rejected change never becomes durable | — | — | PREPARED `[BD-09]` | Source |
| BD-10 | Foreign keys after an export-failure recovery | Complete prior state live. `proveForeignKeyEnforcement` = `enforced` (usable write, setting 1, FK error specifically). A refusal of all work is not counted as enforcement. | — | "foreign keys stay enforced after storage round-trips" (success path only) | PREPARED `[BD-10]` | Source |
| BD-11 | Recovery itself fails: export throw plus a persistent foreign-key restore throw | A later operation is either `fail-closed` (recorded as such) or `enforced` on a usable connection, in which case the complete live state equals prior. Never `not-enforced`. The complete reopened state (materials, raw tags and links, integrity) equals prior. | — | owner "refuses later work…" (owner level only) | PREPARED-COND `[BD-11]` | Source; recovery design may need a seam (see §6) |
| BD-12 | Mid-save persist | as QT-07 | — | as QT-07 | — | Source |
| BD-13 | Refused plain write and refused debrief are undone | prior restored | — | "a refused plain write and a refused debrief are undone too" | HIST-WIN | Source |
| BD-14 | Private mode: every `setItem` throws `SecurityError` after initialization | Save rejected; live and reopened = prior | — | — | PREPARED `[BD-14]` | Source |

### 4.5 Installed-app requirements (not covered by any driver test)

| ID | Requirement | Checklist | Status |
| --- | --- | --- | --- |
| IN-01 | Installed metadata and tag create/edit/replace/clear, failed-save retry, and Cancel with old/new attachment conservation on APFS | [Mac plan](MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) installed list; MAC-04 | **INSTALLED, UNVERIFIED** |
| IN-02 | Concurrent save, split and backup without loss | MAC-11 | **INSTALLED, UNVERIFIED** |
| IN-03 | Native panels, Cancel and overwrite behavior | MAC-17 | **INSTALLED, UNVERIFIED** |
| IN-04 | Early macOS 12 WKWebView, and case-sensitive or symlinked user folders | MAC-03 and the plan | **INSTALLED, UNVERIFIED** |

Driver tests (node:sqlite, sql.js, Rust with temporary roots, jsdom) establish none of these.

## 5. Diagnostic and fixture inventory

All files are in [`docs/evidence/mac-a2-preparation-2026-10-03/`](evidence/mac-a2-preparation-2026-10-03/README.md):

| File | What it is | Status |
| --- | --- | --- |
| `a2ReviewDiagnostics.mac.test.ts` | Part 1: the five reviewer diagnostics (DX-1 to DX-5), byte-identical to the reviewed version. Part 2: prepared AR, QT and BD cases (see §4), corrected for PREP-R1 to R3. | PREPARED, never executed against A2. It collects to **181 tests** after parameterization: 5 Part 1, 10 AR, 44 QT-08/09/10, 52 QT-11a, 52 QT-11b, 2 QT-12, 2 QT-02a, 2 QT-02b and 12 BD. Of these, 57 are CONDITIONAL SEAM. (The reviewed version collected 93; the handoff's "about 40" was wrong.) Outside discovery: the default `vitest list` finds 0 task files. |
| `a2DiagnosticObservations.ts` | Shared observation helpers: `fullState`, `sameState`, `stateDifferences`, `integrityProblems`, `observeMaterial`, `classifyCreate`, `updateOutcomeProblems`, `proveForeignKeyEnforcement`, `installStatementBarrier`, `restoreAllBarriers` and `LINK_INSERT`. Copy it beside the diagnostics. | PREPARED; validated by the oracle controls |
| `a2ObservationOracle.check.ts` | Task-local oracle controls (36): real engines, project migrations, a FIFO/no-owner stand-in harness, and positive and negative controls for PREP-R1 to R3 | **PREPARED-ORACLE, run: 36 passed** |
| `oracle-vitest.config.mjs.txt` | Import-free task-local Vitest config: runs the controls and lists the diagnostics without copying anything into `src/` | tool |
| `oracle-controls-2026-10-03.txt`, `correction-receipt-2026-10-03.txt` | Correction receipts: control results, mutation sensitivity, counts, hashes | evidence |
| `a2-engine-probe.mjs.txt` | Raw-engine SQL-form probe, v2. It supersedes this task's earlier v1, whose cases it keeps. | MAC-RUN engine, exit 0 |
| `engine-probe.json` | Probe output (Node 22.23.3, SQLite 3.53.4, sql.js 1.14.2) | evidence |
| `source-availability.txt` | Availability receipt and hash comparison | evidence |
| `case-sensitive-volume-capability.txt` | Case-sensitive APFS image capability | evidence |

**Datasets** are synthetic and deterministic:

- **IDs:** `guide`, `after`, `after-public-call`, `existing`, `still-usable`, `triggered`, `rejected`.
- **Titles:** "Synthetic guide" and "Changed guide" / "Title only".
- **Tags:** "Synthetic tag", "Changed tag", "New tag", and "Poison tag" (fault trigger).
- **Timestamps:** `2026-10-02T10:00:00.000Z`.
- **Out-of-contract values:** notes "Synthetic note", topic `synthetic-topic`, `file_path` `documents/synthetic-old.pdf`, `last_reviewed_at` `2026-10-01T09:00:00.000Z`.
- **Unrelated rows:** table `unrelated(id)` with `acknowledged` or `later`; table `audit_log(id)` for the trigger control.

**Real migrations:** both drivers apply `applyMigrations`. node:sqlite uses a fresh `:memory:` database per case, closed in `finally`. sql.js uses a per-case Map-backed `localStorage` stub, and reopening is a new `createSqlJsDatabase()` over the same stub. Nothing is written to disk.

**Observation policy (corrected).**

- **`fullState`** keeps:
  - every `study_materials` column
  - every `tags` column, including its `id`
  - every raw `material_tags` row
  - a separate LEFT JOIN `resolvedLinks` view, where a dangling link shows as `tag: null`
  - counts and dangling-reference totals
  - `unrelated` as `{status: "absent"}` or its rows; any other read error propagates

  It uses several reads, so it is used **only after pending operations settle**. It is not a transaction snapshot.
- **`observeMaterial`** is the single-statement read for anything that may race a save.
- **`sameState`** compares complete states; **`updateOutcomeProblems`** defines a complete successful update.

**Fault-case contract.** Every fault case logs a JSON `evidence` line with the before and after state.

| Case | Seam and timing | Expected error and state | Retry | Cleanup |
| --- | --- | --- | --- | --- |
| AR-04/05 | Public `CREATE TRIGGER … RAISE(ABORT)` on the link insert; fires mid-transaction after the row and tag writes | rejects; complete prior state | `DROP TRIGGER`, resubmit the same operation → exactly once | handle closed in `finally`; in-memory |
| DX-4/5, BD-01–04, 08–10 | `vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(throw)` armed just before the save; fires after the atomic commit, before storage | rejects with "synthetic export failure"; live = reopened = prior | resubmit (BD-03/04) | `vi.restoreAllMocks()` in `afterEach` |
| BD-05 | `vi.stubGlobal("btoa", one-shot throw)` | rejects; prior | — | `vi.unstubAllGlobals()` |
| BD-06 | `run`/`exec` prototype spies throw once on `PRAGMA foreign_keys = ON` | rejects; prior; foreign keys enforced afterwards | — | `restoreAllMocks` |
| BD-11 | export throw plus the foreign-key restore throwing until disarmed | rejects; later work refused or provably safe | disarm, reopen | `restoreAllMocks` |
| BD-07 / BD-14 | the `localStorage` stub throws `QuotaExceededError` once, or `SecurityError` always | rejects; prior | — | stub replaced per case; `unstubAllGlobals` |
| QT-08–11a | transaction-control strings via public `execute` and `select` | refused or bounded; acknowledged row intact; complete state unchanged | — | per-case database |
| QT-02b / QT-11b | `installStatementBarrier` wraps `DatabaseSync.prototype.prepare`/`exec` or sql.js `Database.prototype.prepare`/`run`/`exec`. It fires once, before the save's first `material_tags` insert executes, inside the transaction opened through those methods. The read or ending call is requested inside the event. | `complete`, or the complete expected or prior state; "seam not reached" if the event never fires | — | `restoreAllBarriers()` in `afterEach` |

Spies and stubs are restored in `afterEach`, which runs even when an assertion fails. No production hook, raw-handle export or mutable browser global is used.

## 6. Seam gaps for the source owner

These are proposals only. No production change was made.

1. **Encoding (BD-05):** if the corrected driver does not encode through `globalThis.btoa`, expose no backdoor. Instead name the injectable boundary (for example the existing storage adapter) that a test can fault without a production flag.
2. **Foreign-key restoration (BD-06):** the prepared case faults `PRAGMA foreign_keys = ON` through the `run`/`exec` prototypes. If restoration uses another route, document it so the case can target it.
3. **Recovery failure (BD-11):** recovery presumably reloads the last stored bytes. If its failure cannot be produced by the export and foreign-key seams, document the internal step and its test seam.
4. **Native physical evidence (§4.2):** make each native conservation test assert old and staged existence and bytes, if it does not already.
5. **Case-sensitive root (AF-14):** let the test's temporary root follow `TMPDIR`, or an existing test root parameter, so it can run on a case-sensitive APFS image.
6. **Post-commit refresh with an attachment (AR-08):** add the specified UI case.
7. **Ownership-acquired event (QT-02b, QT-11b):** the barrier needs the save's statements to reach the engine through `prepare`, `run` or `exec` after its `BEGIN`.
   - If the corrected driver prepares statements before `BEGIN`, or sends one script, please name an existing test event that marks "ownership acquired, transaction open" (for example an owner-queue callback already used by the maintained FIFO tests).
   - Do not add a production flag for this.
   - Until then, these 54 cases stay CONDITIONAL; unforced overlap is never reported as verified.

## 7. Results actually obtained on this Mac (3 October 2026)

Logs are kept in the task-owned scratchpad, outside Git: `/private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/logs/`.

| # | Command (from the checkout root, scoped toolchain) | Result | Duration | What it proves |
| --- | --- | --- | --- | --- |
| R1 | `node --no-warnings <scratch>/a2-engine-probe.mjs > <scratch>/engine-probe.json` | exit 0. Opening forms: node 26/26 accepted, 24 left a transaction open; sql.js 39/39 accepted, 37 open. Legitimate forms: 16/16 and 22/22. Export drops the open row. The seam restores. Foreign keys go 1 → 0 across export. | under 1 s | engine premises only (MAC-RUN engine) |
| R2 | `npx --no-install esbuild docs/evidence/mac-a2-preparation-2026-10-03/a2ReviewDiagnostics.mac.test.ts --log-level=warning` | exit 0 | not timed | syntax parses (static) |
| R3 | `npx --no-install tsc -p <scratch>/typecheck/tsconfig.json`: the diagnostic copied beside `.d.ts`-style shims of the **reviewed API shape** (`MaterialSaveOperation`, optional `saveMaterialAtomically`) re-exporting main's real `SqlDatabase`, with the repo's strict compiler options | exit 0 | not timed | type-correct against the reviewed shape (static). This is **not** a behavioral pass, and the real accepted API may differ. |
| R4 | `npx --no-install vitest list` | 0 matches for the diagnostic | not timed | outside discovery |
| R5 | `npx --no-install vitest run src/data/repositories/documentRepository.test.ts src/pages/StudyLibrary/MaterialFormDialog.test.ts src/state/editorSafety.test.ts src/pages/FlightJournal/quickDebrief.test.ts --reporter=verbose` | **53 passed, 0 failed, 0 skipped**, 4 files, exit 0 · log `main-frontend-focused.log` | 2.71 s | main's existing references (MAC-RUN main), **not A2** |
| R6 | `SDKROOT=…MacOSX26.5.sdk cargo test --locked --offline --manifest-path src-tauri/Cargo.toml documents::tests::` | **44 passed, 0 failed, 0 ignored**, 212 filtered, exit 0 · log `main-native-documents.log` | 5.38 s of tests (4.02 s incremental build) | main's native path and traversal references (MAC-RUN main), **not A2** |
| R7 | `hdiutil create -fs "Case-sensitive APFS"` 64 MB in the scratchpad, `attach -nobrowse`, test, `detach`, delete | Case-sensitive APFS; `Case.txt` and `case.txt` distinct; symlink created; detached and removed | not timed | capability only |
| R8 | Source-availability check (§2) | unavailable | — | prerequisite |
| R9 | `git diff --check`; relative-link check over the changed documents; whitespace scan of untracked files | see §14 | — | documentation hygiene |
| R10 (correction) | `npx --no-install vitest run --config "$TMPDIR/a2-oracle.config.mjs" a2ObservationOracle --reporter=verbose` | **36 passed, 0 failed, 0 skipped**, exit 0 · `oracle-controls-final.log`, receipt `oracle-controls-2026-10-03.txt` | 0.40 s | the corrected observations behave as specified on real engines (PREPARED-ORACLE); **not A2** |
| R11 (correction) | the same controls against five helper mutants (alias to scratch copies) | 14, 0 (equivalent), 4, 2 and 2 failures | not timed | the controls are not vacuous |
| R12 (correction) | `npx --no-install vitest list --config "$TMPDIR/a2-oracle.config.mjs" a2ReviewDiagnostics` (collection only); the same for the reviewed copy | 181 tests (57 CONDITIONAL); reviewed version 93 | not timed | actual parameterized count; no test body ran |
| R13 (correction) | esbuild parse of three `.ts` files; `tsc` with reviewed-API shims; default `vitest list` | exit 0; exit 0; 0 task files discovered | not timed | static only; the shim is not the real API |

**Not run:** any A2 suite, the five diagnostics, the prepared cases, the full application matrix (documentation-only change), installers, CI, or live Gemini.

**Historical receipts, inspected and not re-run:** Codex's Windows run of 2 October recorded these results:

- 67 frontend tests passed
- 21 native save tests passed (the case-sensitive test returned early on NTFS)
- 4 reviewer native tests passed
- 5 diagnostics failed
- implementer matrix: 629 frontend passed / 4 skipped, 283 Rust passed / 6 ignored

## 8. Current main's known behavior (context, not an A2 result)

Main's `sqlJsDb.ts` `save()` catches export and storage errors and logs a warning, so writes report success when storage fails. Main's drivers have no connection owner or transaction-control guard. This is the pre-A2 state that A2 replaces. It is recorded so that nobody runs the diagnostics against main and reads the failures as new findings.

## 9. Copy-ready commands (run only once matching accepted source exists)

Run these in a **separate worktree**, so this preparation branch and any other work stay untouched. `<a2-ref>` and `<full-sha>` are **templates** until the source owner publishes them.

```bash
cd /Users/rickymac/code/Flight-training-
git fetch --prune origin
git worktree add ../Flight-training-a2-verify <full-sha>
cd ../Flight-training-a2-verify
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
node --version; npm --version; rustc --version; cargo --version; sw_vers
git rev-parse HEAD; git merge-base HEAD origin/main; git log --oneline origin/main..HEAD
npm ci
```

```bash
# 1. Identity: compare with the publisher's receipt (corrected hashes, not the 533a8f5 review snapshot).
shasum -a 256 src-tauri/src/documents.rs src-tauri/src/documents_save_tests.rs src/data/materialTransaction.ts src/data/connectionOwner.ts src/data/sqlJsDb.ts src/data/testing/nodeSqliteDb.ts src/data/repositories/documentRepository.ts src-tauri/fixtures/material-save-contract/expected.json src-tauri/fixtures/material-save-contract/steps.json
grep -n "saveMaterialAtomically\|MaterialSaveOperation" src/data/db.ts
```

```bash
# 2. Discover the maintained test names from the matching source (do not assume the historical names).
npx --no-install vitest list src/data src/pages/StudyLibrary src/state | grep -i -E "material|owner|transaction|persist|export|storage"
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --list 2>/dev/null | grep -E "documents::(save_tests|a2_review)"
```

```bash
# 3. Frontend focused suite (67 at the Windows review; record the actual count).
(set -o pipefail; npx --no-install vitest run src/data/singleConnectionDrivers.test.ts src/data/materialSaveContract.test.ts src/data/repositories/documentRepository.test.ts src/pages/StudyLibrary/materialSaveIntegration.test.ts src/pages/StudyLibrary/MaterialFormDialog.test.ts src/state/editorSafety.test.ts --reporter=verbose 2>&1 | tee "$TMPDIR/a2-frontend.log"); echo "exit=$?"
```

```bash
# 4. Native save suites (21 + 4 at the Windows review), on the default case-insensitive volume.
(set -o pipefail; cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests:: -- --nocapture 2>&1 | tee "$TMPDIR/a2-native-save.log"); echo "exit=$?"
(set -o pipefail; cargo test --locked --manifest-path src-tauri/Cargo.toml documents::a2_review_regressions:: -- --nocapture 2>&1 | tee "$TMPDIR/a2-native-review.log"); echo "exit=$?"
```

```bash
# 5. Case-sensitive exercise of AF-14 (only if the test's temporary root follows TMPDIR; check the source first).
hdiutil create -size 256m -fs "Case-sensitive APFS" -volname HFDA2CS "$TMPDIR/hfd-a2-cs.dmg"
mkdir -p "$TMPDIR/hfd-a2-cs" && hdiutil attach -nobrowse -mountpoint "$TMPDIR/hfd-a2-cs" "$TMPDIR/hfd-a2-cs.dmg"
TMPDIR="$TMPDIR/hfd-a2-cs/" cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests::distinct_case_files_on_a_case_sensitive_volume_are_not_conflated -- --nocapture
hdiutil detach "$TMPDIR/hfd-a2-cs" && rm "$TMPDIR/hfd-a2-cs.dmg" && rmdir "$TMPDIR/hfd-a2-cs"
```

The output of step 5 must **not** contain `SKIPPED case-sensitive identity`. If it does, AF-14 is NOT EXERCISED.

```bash
# 6. Prepared diagnostics: temporary copy only, then remove it and prove the tree is clean.
cp /Users/rickymac/code/Flight-training-/docs/evidence/mac-a2-preparation-2026-10-03/a2ReviewDiagnostics.mac.test.ts /Users/rickymac/code/Flight-training-/docs/evidence/mac-a2-preparation-2026-10-03/a2DiagnosticObservations.ts src/data/
(set -o pipefail; npx --no-install vitest run src/data/a2ReviewDiagnostics.mac.test.ts --reporter=verbose 2>&1 | tee "$TMPDIR/a2-diagnostics.log"); echo "exit=$?"
rm src/data/a2ReviewDiagnostics.mac.test.ts src/data/a2DiagnosticObservations.ts
git status --porcelain
```

**Interpreting step 6:**

- **Part 1 (DX-1 to DX-5)** must pass on the corrected source.
- **A Part 2 failure** becomes a focused finding for the source owner, with its `evidence` JSON line.
- **A PREPARED-COND case** that fails with "seam not reached" is a seam gap (§6), not a defect.
- **If the branch already promoted these cases** into maintained tests, step 6 is a cross-check.
- **If APIs were renamed,** adapt only the imports and call sites, and record the change.

**Sequential matrix:** focused diagnostics run against **unchanged, independently accepted** source do not by themselves require another full application matrix; the source owner's accepted matrix receipts cover that snapshot. Source corrections keep their full-matrix gate. If a correction is made, by its owner or under separately authorized ownership, or if Codex requests a reconciliation run, run the matrix once, sequentially, after the focused results pass:

```bash
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
node scripts/check-release-version.mjs 0.5.3
git diff --check
```

For every command, record the exit code, the passed/failed/skipped counts, the duration and the log path. Do not overlap runs.

**Clean up:** `git worktree remove ../Flight-training-a2-verify` after the evidence is saved.

## 10. Copy-ready handoff for the Windows A2 owner (not sent)

Sending this message requires the project owner's explicit authorization. Codex or the owner may forward it.

> **A2 (atomic Study Library material saves): request for matching corrected source**
>
> The Mac verification package is ready (`docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md` on branch `codex/mac-a2-verification-preparation`, corrected for Codex's PREP-R1 to R3 review and pending re-review). It can consume the corrected source as soon as that source is independently accepted and published. Please keep the existing workflow: you implement, Codex reviews and publishes. Do not push a failing snapshot just to transfer it.
>
> **Publish only after:**
> - R6 and R7 are complete per `docs/A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md`.
> - The five diagnostics pass as maintained tests.
> - The focused suites and one sequential matrix pass.
>
> **Please provide:**
> 1. **Source identity:** branch or ref, base full SHA, final full SHA, and the exact dirty-file list at test time (it should be empty once committed).
> 2. **R6/R7 issue-to-fix map:**
>    - why public SQL can no longer hold or end ownership on every route, including select, leading comments, `exec` multi-statement strings, and `SAVEPOINT`/`RELEASE`/`ROLLBACK TO`
>    - why every rejected durable write (work, export, foreign-key restoration, encoding, storage) restores state or fails closed
>    - the names of the maintained regressions for each
> 3. **Focused real-engine receipts:** commands, exit codes, passed/failed/skipped counts and durations.
> 4. **Final sequential matrix receipts:** `npm ci`, `npm test`, `npm run build`, `cargo fmt --check`, strict `cargo clippy --locked`, `cargo test --locked`, `npm run test:cargo-lock`, `node scripts/check-release-version.mjs 0.5.3` and `git diff --check`. Give each one's exit code and counts, including skips and their reasons.
> 5. **SHA-256 hashes** of every changed production, test, fixture and documentation file, matching the tested snapshot.
> 6. **Independent Codex acceptance** record, and the reviewed GitHub publication identity (PR number, head SHA, merge SHA).
> 7. **Integration and limits:**
>    - expected integration conflicts with current main (`6637d17` or later), in particular `STATUS.md`, `docs/PROJECT_HANDOFF.md` and `src/data/db.ts`
>    - remaining native or platform limits
>    - whether seams exist for encoding failure, foreign-key restoration failure, recovery failure, the case-sensitive temporary root, the post-commit refresh UI case, and an "ownership acquired, transaction open" test event (Mac report §6, items 1–7). The Mac's while-held cases need that event if the save's statements do not reach the engine through `prepare`/`run`/`exec` after `BEGIN`; please do not add a production flag for it.
>
> Release holds and the frozen v0.5.3 candidate are unchanged.

## 11. Remaining limits and release holds

- **A2 is not accepted, not on main and not validated on the Mac.** This package is preparation only.
- **Installed:** IN-01 to IN-04 need the dedicated standard test account and an acceptable signing state. The signing path is unresolved.
- **Platform labels:** the host is case-insensitive APFS. A case-sensitive image is possible, but has not been exercised for A2. Symlink behavior has not been exercised for A2. Early macOS 12 has not been exercised.
- **Unchanged:**
  - macOS 12 and Windows support
  - migrations and schema snapshots
  - backup and restore guarantees
  - bounded retries (about 5.5 s per native attempt)
  - bundle identity
  - the Windows hold on v0.5.1; v0.5.2 retired; the frozen v0.5.3 Mac candidate held

## 12. Next eligible roadmap step and its gate

1. **Mac A2 execution (§9).** Gate: the corrected A2 source is independently accepted by Codex and published on GitHub with the §10 receipt.
2. **Installed Mac verification** ([Mac plan](MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) step 4–5). Gate: the owner provides the dedicated standard test account and a signing decision. Independent of A2 source.

The open-source plan stays gated:

- MiniSearch was rejected by the accepted baseline.
- Virtualization needs justified installed expanded-display evidence.
- M2 needs the real-user check-in.
- Zod and react-markdown need an approved bounded import contract.
- The embedded PDF reader follows its license, worker and WebKit gates.

No package was installed and no feature was started.

## 13. Corrections after Codex review: PREP-R1 to PREP-R3 (3 October 2026)

[Correction receipt](evidence/mac-a2-preparation-2026-10-03/correction-receipt-2026-10-03.txt) · [oracle control results](evidence/mac-a2-preparation-2026-10-03/oracle-controls-2026-10-03.txt) · reviewer's historical counterexample (preserved): [review evidence](evidence/mac-a2-preparation-review-2026-10-03/README.md).

**Pre-edit identity:** all nine handed-off files matched (the diagnostic was `1902070e…`), and there were no competing changes.

| Finding | Was | Fix (helper and case names) | Proof now (PREPARED-ORACLE, no A2 API) | Still source-dependent |
| --- | --- | --- | --- | --- |
| PREP-R1 | QT-02 combined several public reads (`fullState`) as one snapshot | `observeMaterial` (one SELECT with scalar subqueries) plus `classifyCreate` (`none` / `complete` / `partial`). `[QT-02a]` is the coherent observation. `[QT-02b]` uses the `installStatementBarrier` event at the save's first `material_tags` insert, inside its transaction. `fullState` is documented as settled-only. | R1-1 read before ownership → none; R1-2 after → complete; R1-3 Codex's schedule → none (the old multi-read aggregate gives 0 materials / 2 links); R1-4 five partial datasets → partial; R1-5 barrier with a FIFO owner → complete; R1-6 barrier with no owner → partial. Both engines. | `[QT-02b]` is CONDITIONAL on the statement route (§6 item 7) |
| PREP-R2 | Tag names only; inner-joined links; read errors became "no unrelated table"; BD-11 omitted tags; any rejected orphan insert counted as "enforced" | `fullState` keeps all material and tag columns, raw `materialTags`, a LEFT JOIN `resolvedLinks`, `integrity` counts and dangling refs, and an explicit `unrelated` status. `sameState`, `stateDifferences` and `integrityProblems` compare it. `expectSame` and `settledState` apply it throughout AR, QT and BD (BD-11 included). `proveForeignKeyEnforcement` returns `enforced` / `fail-closed` / `not-enforced`. | R2-1 changed tag id under the same name → detected while `resolvedLinks` stays equal; R2-2 changed raw link → detected; R2-3 dangling link → detected and counted; R2-4 stray tag → detected; R2-5 unchanged state, also after a real rejected save → accepted; R2-6 absent table explicit, other errors propagate; R2-7 FK proof separates enforcement, fail-closed refusal and other errors | BD-06/BD-11 seams unchanged (CONDITIONAL) |
| PREP-R3 | QT-11's saved branch checked only the new link | `updateOutcomeProblems` gives the complete expected result; rejection must be `sameState(prior)`. Split into `[QT-11a]` (ordinary refusal outside a save, then usable work and a complete save) and `[QT-11b]` (call requested at the barrier event while ownership is held). Both use execute and select × 13 ending forms; sql.js reopened equals live. | R3-1 complete success accepted, live and reopened; R3-2 links changed with the old title → rejected; R3-3 title changed with the old links → rejected; R3-4 partial after rejection → rejected, unchanged → accepted; R3-5 stray tag, changed untouched column or lost unrelated row → rejected | `[QT-11b]` CONDITIONAL (§6 item 7) |

**Statement routes (from the engine probe):**

- **One statement:** node:sqlite `prepare()` and sql.js `prepare()` / `run(sql, params)` compile one statement and silently ignore a trailing one.
- **Every statement:** sql.js `run(sql)` without params (which calls `exec`) and node:sqlite `exec()` run every statement.

So `SELECT 1; COMMIT` and `SELECT 1; ROLLBACK` only matter where a driver uses the second kind of route; both kinds are covered.

**Control results:** 36 passed / 0 failed / 0 skipped, exit 0 (Node 22.23.3).

**Mutation sensitivity** (the same controls against helper mutants, scratch only):

| Mutant | Result |
| --- | --- |
| Historical `fullState` policy | 14 fail |
| Classifier without link checks | 4 fail |
| Update check without the title | 2 fail |
| Classifier without the title | 2 fail |
| Classifier without `linkRows` | 0 fail (equivalent: `linkedNames` and `danglingLinks` already cover it) |

**Static checks:**

- esbuild parse exit 0 for all three `.ts` files.
- `tsc` exit 0 against **API shims of the reviewed A2 shape**. This is not the real accepted API.
- The default `vitest list` finds 0 task files.
- The task-local listing collects 181 diagnostic tests; no test body runs.

**Documentation clarifications made in this correction:**

- The `gh`/API limit belongs to Claude's environment (§2).
- PR head refs show source, not PR state (§2).
- The source check used GitHub network access, with no application data, credentials or provider requests (§2 and the evidence README).
- Focused verification of unchanged accepted source does not automatically require a full matrix; source corrections keep that gate (§9).
- The diagnostic count was recorded from the actual parameterization (§5).
- A separate PREPARED-ORACLE evidence level was added (§3).

**Not run, by design:** the prepared A2 suite (absent API), the main 53/44 suites, the full matrix, the case-sensitive image probe and the A5 measurements. No new relevant failure justified rerunning any of them.

## 14. Changed files, hashes and checks

Hashes and check results are recorded in the completion handoff. They are not repeated here, so that this document does not have to hash itself. The checks were `git diff --check`, the relative-link check and the untracked-file whitespace scan.

Leave uncommitted for Codex review.
