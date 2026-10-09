# M2 split lineage: requirement-to-test map

Test files:
- **Native**: `src-tauri/src/lineage_tests.rs`, plus the split tests in `src-tauri/src/pdf.rs`
- **Logic**: `src/logic/splitLineage.test.ts`
- **Shapes**: `src/data/splitLineageShapes.test.ts`
- **Storage**: `src/data/splitLineageStorage.test.ts`
- **Validation parity**: `src/data/splitLineageValidationParity.test.ts` with the native `shared_lineage_validation_contract_native_outcomes`
- **UI**: `src/pages/StudyLibrary/SplitLineage.test.ts`

Shared fixtures:
- `src-tauri/fixtures/split-lineage/compose.json` (page arithmetic)
- `receipt.json` (the serialized receipt)
- `validation-cases.json` (the schema-13 validator contract; 15 cases)

Sensitivity variants S1–S5 are in `receipts/sensitivity/`.

| Requirement (scope §2–§8, SL-D1–D8, SL-R1–R13) | Tests |
| --- | --- |
| Migration 0013 equals the accepted candidate DDL; registered in Rust and TS; schema 13; 0001–0012 unchanged | `check_preserved.sh` (gate step 11); TS ceiling tests in `cardReviewContract.test.ts` and `m1Upgrade.acceptance.test.ts` (moved to "latest"); native `a_schema_11_database_validates_and_a_newer_database_is_refused` |
| SL-D1: SHA-256 of the exact bytes split, in the native worker, with the engine page count | native `a_manual_split_records_the_exact_bytes_and_engine_page_count`, `an_automatic_split_records_every_part_against_the_same_source` |
| The receipt is bound to the material that owns the file | native `a_receipt_is_refused_for_a_file_the_material_does_not_own`, `a_manual_split_of_a_pdf_the_material_does_not_own_leaves_no_file` |
| The receipt is the only authority; edited or unrecorded receipts refused (SL-R7, SL-R10) | native `an_edited_or_unrecorded_receipt_saves_nothing` (S1); Shapes `refuses extra provenance…` (S5); the serde `deny_unknown_fields` check in `the_serialized_receipt_matches_the_shared_fixture` |
| A changed, missing or moved source, or a wrong-sized part, saves nothing | native `a_changed_or_missing_source_and_a_wrong_sized_part_save_nothing`, `a_source_moved_to_another_file_or_removed_before_saving_is_refused` |
| In-transaction nested snapshot re-check (SL-R10.4) | native `a_parent_whose_lineage_changed_after_the_split_is_refused` (S2) |
| SL-D3: two-tier coordinates, canonical A20–40/R101–300 ⇒ R120–140; parent tier from A, not the root (SL-R12) | native `a_part_of_a_part_records_both_tiers_with_the_canonical_pages`, `shared_compose_cases_match_the_typescript_arithmetic`; Logic `page arithmetic` (same fixture) |
| Re-issuing never changes a committed or cancelled record (SL-R12) | native `a_saved_split_replays_and_reissuing_never_changes_a_settled_record`, `a_cancelled_split_stays_cancelled_and_cannot_be_saved` (S3) |
| Idempotent replay; output-id collision refused before writing; mid-save failure rolls back everything | native `a_saved_split_replays…`, `an_existing_output_id_or_a_mid_save_failure_saves_nothing` |
| Cancel removes only the split's own files and never a saved split; reconcile by operation id | native `cancelling_removes_only_its_own_files_and_never_touches_a_saved_split`, `reconcile_reads_a_split_back_by_its_operation_id`; UI `a save that did not land is cancelled…`, `an unanswered save that did land is read back and kept`, `says to restart…` |
| Parts inherit type, topic, priority, goal, event and tags; the title and notes come from the interface | native `a_direct_split_records_the_original_and_inherits_the_source_settings`; UI manual and automatic saving tests (exact presentation) |
| SL-D5: removing the original keeps parts and history; the root id becomes NULL and is never the parent; committed records survive with a NULL source | native `removing_the_original_keeps_every_part_and_its_history_truthfully`; UI `says plainly when the original changed or was removed…` |
| SL-D4: legacy materials have no lineage; nothing is inferred | Storage `attaches a split part's lineage and leaves other materials with none`, upgrade test; UI `…shows nothing for a material that was not split` |
| Structural tiers; an unknown parent is never vouched for; each tier is judged against its own file (SL-R8) | Logic `classifies tiers by structure…`, `a matching original never vouches…` (S4), `judges each tier against its own file`; UI `a part of a part judges its parent on its own…` |
| Verdicts: matching / changed / missing / deleted / unknown; browser mode stays unknown | Logic `covers matching, changed, missing, removed, unknown and not-yet-checked`; UI changed, removed and browser-preview cases |
| Related parts: same known edition and source only; never through an unknown parent | Logic `related parts` (two cases); UI first-level case (list and navigation) |
| SL-D7: page view with links, pages, copy-page fallback | UI `a first-level part links to its original, lists the same copy's parts and copies the page` |
| Fingerprints off the render path; bounded; safe paths | native `fingerprints_report_current_contents_and_missing_files`; Shapes `fingerprints must answer for exactly the files asked about` |
| Desktop adapter shape checks | Shapes `sends the receipt back unchanged and checks every result`, `the split services hand back only a well-shaped receipt` |
| Drivers that cannot split refuse clearly | Storage `refuse to save, cancel or read back a split, and cannot fingerprint` |
| Upgrade from a populated schema 12 with practice and card history intact | Storage `adds the lineage tables and changes no practice or card record` |
| Restore safety: a schema-13 database is validated; older binaries refuse it | Validation parity, 15 cases × 3 engines; native `the_schema_13_validator_…` (2); the existing older-binary ceiling guard (`newest_migration > CURRENT_SCHEMA_VERSION`), now tested at `CURRENT_SCHEMA_VERSION + 1` |
| A library without split tracking refuses | native `a_library_without_split_tracking_refuses_receipts_and_saves` |
