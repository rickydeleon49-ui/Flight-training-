# M1 D7 — Acceptance: Daily Flight Plan and debrief workflow

_Prepared 27 September 2026 · Branch `feature/m1-d6-debrief-links` · Tested on top of `d6e2ec3` (reviewed D6, intentionally unmerged) plus the uncommitted D7 changes listed below._

D7 is added to the D6 branch at the user's explicit direction. Merging stays on hold until the user authorizes it. These results are implementation checks, not an independent review.

## 1. Environment

| Item | Value |
| --- | --- |
| Machine | Windows 11 Pro x64 (the single development desktop) |
| Node / npm | Node 24, npm scripts from `package.json` |
| Frontend tests | Vitest 4 with jsdom; SQLite through Node's built-in `node:sqlite`, using the app's own migrations |
| Native tests | `cargo test` in `src-tauri` (rusqlite; the app's registered migration list) |
| Desktop app | **Not launched.** See §6. |
| Data | Synthetic only. No test touched `%APPDATA%\com.herflightdeck.app`. |

## 2. Test kinds used

- **UI integration:** real pages under the real `AppDataProvider` against a real SQLite file in jsdom. This isn't the Tauri shell.
- **Repository integration:** repositories, migrations and the browser/test debrief transaction against real SQLite files.
- **Native command:** Rust tests of `save_debrief_operation_at`, the complete-backup pipeline, documents, PDFs and migrations.

## 3. Requirement-to-evidence

| # | Requirement | Result | Evidence (kind) |
| --- | --- | --- | --- |
| 1 | Daily Flight Plan: pick a budget, read "Why this", skip, Start | PASS | `m1Workflow.acceptance.test.ts` › whole workflow, step 1 (UI) |
| 2 | Quick debrief: improvement → edited action with material; edited question carried to an upcoming lesson | PASS | same test, step 2 (UI) |
| 3 | Action appears with the material; question appears in lesson preparation | PASS | same test, step 3: Study Library material page, lesson page "Ask: …" (UI) |
| 4 | Full editor keeps the flight log after a quick edit | PASS | same test, step 4: total time, dual, aircraft and landings unchanged (UI and repository) |
| 5 | Complete the action and answer the question | PASS | same test, step 5: checkbox on the debrief page, "Add answer" on Questions (UI) |
| 6 | Retrying the original acceptance keeps progress and answers | PASS | same test, step 6 (repository, browser transaction); `retry_after_a_committed_operation_changes_nothing` and the contract parity test (native) |
| 7 | Restart keeps saved decisions, links and history | PASS | same test, step 7: database file closed and reopened; budget and skip, links, journal history (UI) |
| 8 | Deleting linked sources keeps history and labels honestly | PASS | same test, step 8: material and lesson deleted; "Source lesson unavailable" on Questions, "Material: Source material unavailable" on the debrief; never-linked items show no label (UI); `normal_deletions_keep_the_records_and_remember_the_deleted_source` (native) |
| 9 | Cancel and failed saves keep input, with no false success | PASS | `m1Workflow.acceptance.test.ts` › cancel/failed save (UI); `debriefLinks.test.ts` 11–12, unsupported driver (UI and repository) |
| 10 | Upgrade v9 → v10: records, flight times, answers, completion, links and daily-plan metadata survive | PASS | `m1Upgrade.acceptance.test.ts` (repository); `upgrading_a_v9_dataset_keeps_everything_and_enables_d6` (native) |
| 11 | Provenance and ledger work after upgrade | PASS | same two tests |
| 12 | Reopening doesn't rerun or corrupt migrations | PASS | `m1Upgrade.acceptance.test.ts`: one row per version after two reopens, data unchanged (repository). In the desktop app, migrations run through tauri-plugin-sql's migrator, which isn't exercised here. |
| 13 | Nothing invented on upgrade | PASS | same tests: no new links, empty provenance and ledger |
| 14 | Fresh install still works | PASS | `m1Upgrade.acceptance.test.ts` › still installs fresh (repository) |
| 15 | Complete backup through the real pipeline: managed PDF, daily plan, debrief, action/question, links, completed work, provenance, ledger, safe retry after restore | PASS | `complete_backup_keeps_the_pdf_plan_progress_provenance_and_ledger_and_retries_safely_after_restore` (native): export → `inspect_archive` → stage → apply; PDF bytes identical; rows identical; retry after restore changes nothing |
| 16 | Existing backup formats and integrity protections | PASS (existing) | Native tests in `backup.rs`, e.g. `a_format_version_one_backup_still_restores`, `format_v2_with_unreferenced_document_inspects_and_restores_cleanly`, `old_style_format_v2_with_missing_referenced_document_inspects_and_restores_with_warning`, `format_v3_inspection_proves_database_and_document_completeness`, `a_same_size_content_change_fails_the_integrity_check`, `extreme_compression_ratios_are_refused`, `an_archive_carrying_anything_unexpected_is_refused`, `archive_names_reject_windows_streams_and_excessive_lengths` |
| 17 | Offline: plan, journal and debrief acceptance in the frontend | PASS (frontend only) | Both workflow tests replace `fetch` and `XMLHttpRequest` with recorders, and the tested workflow made zero calls to either (UI integration). The frontend has no network code of its own; Gemini is reached only through its Tauri commands. This is not evidence about native networking. |
| 18 | Offline: local PDF operations, backup/restore and the native debrief command | UNVERIFIED | Not exercised with networking disabled or independently blocked. The only related check is `listed_modules_do_not_reference_reqwest_directly_outside_gemini`, a limited structural regression check. It confirms that the production code (everything before each file's `#[cfg(test)] mod tests` block) of the explicitly listed Rust modules (`backup.rs`, `debrief.rs`, `documents.rs`, `pdf.rs`, `storage.rs`, `platform.rs`, `secrets.rs`, `lib.rs`, `main.rs`) does not refer to `reqwest` directly, and that `gemini.rs` still does. Temporarily adding a `reqwest` reference to `platform.rs` production code made it fail as intended. It does not show that those paths never reach the network through another library, a transitive call or the operating system. The native PDF, document, backup and debrief tests passed, but they were not run with networking disabled. |
| 19 | Gemini stays an explicitly started online feature | PASS (existing) | Unchanged D6 code. Nothing in this workflow configures or calls Gemini; existing Gemini tests cover the explicit key and command flow. |
| 20 | PDF import, open and reveal | PASS (native document handling and path validation) / UNVERIFIED (desktop) | Existing `documents.rs` tests cover storing, naming, resolving and path validation, and the Open/Reveal scope: `every_imported_name_can_be_resolved_again`, `opening_or_revealing_a_document_is_scoped_to_the_documents_folder`, `replacing_an_attachment_never_overwrites_the_saved_file`, `capabilities_do_not_grant_broad_filesystem_access`. No test exercises an OS file picker, opening a PDF viewer, or Explorer/Finder behaviour. |
| 21 | Automatic and manual PDF splitting | PASS (native tests) / UNVERIFIED (desktop) | Existing `pdf.rs` and `documents.rs` split tests, e.g. `a_chapter_comes_out_with_only_its_own_pages`, `split_parts_and_tags_commit_together_on_one_connection` |
| 22 | Windows desktop smoke (launch, import/open/reveal, plan, debriefs, split, backup/restore, upgrade over a synthetic dataset) | UNVERIFIED | Not run. See §6. |
| 23 | Windows packaging (build only) | PASS (build) / UNVERIFIED (install) | NSIS installer built; not installed or run; retired 0.5.2 number means it must not be distributed (§6) |
| 24 | Apple Silicon installed app | UNVERIFIED | No Mac available. Checklist in §7. |
| 25 | 90-second demonstration | SCRIPT ONLY | §8 is a script, not an executed recording |

## 4. Defects found

The acceptance run found **no product defects**. Each first-run failure was traced to a wrong assumption in the new test and corrected there, not in the product:
- The lesson page labels carried questions "Ask: …".
- The form has two Cancel buttons.
- The edit button reads "Save changes".
- A checkbox's accessible name includes its metadata.
- A quick edit of an older flight is also a debrief operation, so the ledger held two ids, not one.
- The question was never linked to a material, so correctly showed no material label.

No product code changed in D7, so there are no product regressions to add.

## 5. Commands and results (27 September 2026, one matrix at a time)

| Command | Result |
| --- | --- |
| `npx vitest run src/acceptance/` | 2 files, 4 passed |
| `cargo test debrief` (from `src-tauri`) | 15 passed |
| `npm test` | 56 files passed, 2 skipped; 532 passed, 2 skipped |
| `npm run build` | `tsc --noEmit` and `vite build` succeeded |
| `cargo fmt --check` (from `src-tauri`) | Clean |
| `cargo clippy --all-targets -- -D warnings` (from `src-tauri`; sources touched to force a re-lint) | Clean |
| `cargo test` (from `src-tauri`) | 156 passed, 2 ignored (benchmarks) |
| `npm run tauri build -- --bundles nsis` | Succeeded (release build and NSIS bundle); installer not run (§6) |
| `git diff --check`, plus a whitespace and conflict-marker scan of new files | Clean |

## 5a. Independent review by Codex (separate from the implementation results above)

Codex reviewed D7 independently and found no product-code blocker. Codex's own results:

| Command | Result |
| --- | --- |
| `npx vitest run src/acceptance/` | 2 files, 4 tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml debrief` | 15 passed |
| `git diff --check` | Clean |
| SHA-256 of the local NSIS artifact | Matches `f6147e8ae400facd4fe83961cc684bbf6044c214e1adc3c165ab57416bc321bc` |

The matching checksum only confirms the local file is the one built for this note. It is **not** malware clearance and **not** installation evidence. The artifact carries the retired `0.5.2` number and must not be distributed.

Codex's evidence corrections, applied afterwards:
- The structural `reqwest` test was renamed and its claim narrowed (row 18).
- Native offline behaviour is now UNVERIFIED.
- The limits of the native document tests are stated (row 20).

## 6. Windows desktop

**Why the app wasn't launched.** This machine holds a real Her Flight Deck profile (`%APPDATA%\com.herflightdeck.app`, with a database, documents and backups). Tauri resolves that folder through Windows known-folder APIs from the fixed bundle identifier. No verified way was available to point a development or packaged run at an isolated synthetic profile without changing the identifier (which would test a different app) or redirecting the user's profile. Restore, migration and deletion must never run against her real data, so no development app, packaged executable or installed application was launched. Every desktop smoke step is **UNVERIFIED**.

**Packaging (built, not run).** `npm run tauri build -- --bundles nsis` succeeded: the release binary compiled in 3m 25s and makensis produced `src-tauri/target/release/bundle/nsis/Her Flight Deck_0.5.2_x64-setup.exe` (3,721,458 bytes, SHA-256 `f6147e8ae400facd4fe83961cc684bbf6044c214e1adc3c165ab57416bc321bc`, git-ignored). This only proves the D6/D7 code builds and bundles.
- The installer was **not installed or run**, and it isn't installed-app evidence.
- It carries the **permanently retired version number `0.5.2`**, because `package.json` hasn't been bumped. It is a local build artifact and must never be distributed or published. Any release must be `0.5.3` or later.
- Defender clearance or code signing is still required before any Windows distribution (existing hold).
- The build rewrote `src-tauri/Cargo.toml` in place. Its bytes and blob hash are identical to `HEAD`, so there is nothing to commit.

**To do on an isolated Windows profile** (a separate Windows user account or a spare machine, with synthetic data):
1. Install and launch. Confirm the version and that Flight Deck opens.
2. Import a synthetic PDF, open it, then reveal its storage folder.
3. Daily Flight Plan: budget, Why this, Skip, Move to tomorrow, Start.
4. Quick debrief with an action, material and a question carried to a lesson; then full debrief. Check the material page, lesson preparation and Questions.
5. Split a multi-page PDF automatically and manually.
6. Make a complete backup, restore it, and confirm the plan, links and PDF.
7. Install over a synthetic v9 dataset (built with the previous installer) and confirm the checks in requirements 10–13.

## 7. Apple Silicon checklist (UNVERIFIED — no Mac available)

Use a synthetic profile only. Don't bypass Gatekeeper beyond the documented, signed-release process.

| Step | Expected |
| --- | --- |
| Install the DMG and open the app | Opens on Flight Deck, with no crash and the correct version |
| Import a PDF from Finder, open it (Preview), and Reveal in Finder | The copy is stored in the app's documents folder; Preview opens it; Finder selects it |
| Daily Flight Plan: 10/20/30 budget with the arrow keys, Why this, Skip, Move to tomorrow | Focus and selection move together; decisions survive quitting and reopening |
| Quick debrief → action with material, question carried to a lesson | The action is listed on the material page; the lesson preparation shows "Ask: …" |
| Complete the action, answer the question, reopen and save the debrief | The completion and answer remain |
| Delete the material and the lesson | The action and question remain, with "unavailable" labels |
| Split a long PDF automatically and manually | Parts are created within the limits; failures leave no partial parts |
| Complete backup → restore | The same plan, links, PDF and labels |
| Wi-Fi off, repeat the plan, debrief, PDF and backup steps | All work; only Gemini actions report that they need a connection |
| Install over a synthetic v9 dataset | Records, flight times, answers and daily plan survive |

## 8. 90-second demonstration — script, not an executed recording

No recording was made: a safe native run wasn't possible here (§6), and nothing below was captured from a run. Use synthetic data on an isolated profile.

| Time | Action | Expected on screen |
| --- | --- | --- |
| 0:00–0:10 | Open Flight Deck | "Daily Flight Plan" card with up to three suggestions and "Available minutes" |
| 0:10–0:20 | Press 30 min; open "Why this" on the study item | The summary updates; the reason panel explains the suggestion |
| 0:20–0:25 | Skip one item for today | It leaves the list; "Reset today's skips" appears |
| 0:25–0:45 | Journal → Quick debrief; type what was difficult; "Turn … into action"; edit it; tick "Add … to your Flight Plan"; choose a material | The action title is prefilled, then edited; the material is selected |
| 0:45–0:55 | Tick "Save an instructor question", edit it, carry it to the upcoming lesson; Save | The debrief page opens with the action (Material: …) and the question (Lesson: …) |
| 0:55–1:05 | Open the material, then the lesson | The action is listed on the material; the lesson preparation shows "Ask: …" |
| 1:05–1:15 | Tick the action done; on Questions, "Add answer" and save | The action shows complete; the question shows Answered |
| 1:15–1:30 | Settings → Create complete backup | The backup is saved, with no warnings for this dataset |

## 9. Changed files

- `src/acceptance/m1Workflow.acceptance.test.ts` (new): UI integration, whole workflow, plus the cancel and failed-save test
- `src/acceptance/m1Upgrade.acceptance.test.ts` (new): repository integration, v9 → v10 upgrade and fresh install
- `src-tauri/src/debrief.rs`: three native tests added (upgrade, D7 complete backup, and the limited structural `reqwest` check); no production code changed
- `docs/M1_D7_ACCEPTANCE_2026-09-27.md` (new), `STATUS.md`, `ROADMAP.md`

No migration was added or changed.

## 10. Remaining release blockers (unchanged by D7)

- **Windows:** release hold. The v0.5.2 installer was flagged by Defender, and v0.5.2 is permanently retired. The next release needs Microsoft clearance of the exact binary or trusted code signing, plus installed-app testing.
- **Apple Silicon:** installed-app testing hasn't been done.
- **Desktop smoke (this D7):** the native Windows smoke and a real offline desktop run haven't been done.
- **Linux:** the glib 0.18.5 dependency follow-up is tracked separately; Linux is not a release target.
- **Merge:** D6 and D7 stay unmerged until the user authorizes merging.
