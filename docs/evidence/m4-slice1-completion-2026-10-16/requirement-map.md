# M4 Slice 1: prototype case → production test map

This maps the 104 cases of the accepted round-6 prototype (`docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/issue-to-test-map.json`), group by group, to the production tests that cover the same behaviour. Prototype tests are not counted as production tests.

**Key to file abbreviations**

| Short form | File |
| --- | --- |
| N | `src-tauri/src/navigation_tests.rs` |
| SC | Shared operation cases (`src-tauri/fixtures/navigation/operation-cases.json`), run by N and `src/data/navigationParity.test.ts` |
| VC | Shared validation cases (`validation-cases.json`), run by N and `src/data/navigationValidationParity.test.ts` |
| D | `src/logic/navigation.test.ts` |
| C | `src/state/navigation/controller.test.ts` |
| UI | `src/pages/StudyLibrary/navigation/DocumentPagesPanel.test.ts` |
| U | `src/data/navigationUpgrade.test.ts` |
| S | `src/data/navigationShapes.test.ts` |

## Mapped to production tests

| Group (cases) | Production coverage |
| --- | --- |
| Controls (2) | D "controls" (bounded reference, nested translation); C "a newer request … retires older work" (newer missing-path intent blocks the obsolete opener) |
| M4-R9 (8) | D "OD-4 physical pages…", "OD-5…", "OD-7 split parts" (totals, label map without identity, first-level nullable parent, root range metadata, reverse translation identity, deleted root and parent, index validation) |
| M4-R10 (9) | N `identity_comes_from_the_file_bytes_and_replacement_marks_saved_places_drifted`, `a_file_replaced_after_inspection…` (atomic invalidation, drift visible and unverified), `deleting_a_material_removes_all_four_kinds_of_navigation_rows`, `a_complete_backup_round_trips_all_four_navigation_tables`, `a_failed_schema15_upgrade_rolls_back…`; SC (bookmark page bounds, unknown origin unverified); U (reopen, cascade) |
| M4-R11 (5) | C "content changed between the check and the open", "a failed save after opening offers a save-only retry…", "abort while the save is pending", "refuses an out-of-range page … never opens"; UI retry and out-of-range tests |
| M4-R13 (7) | C held commit, "a refused save (the file changed…)", same-material supersede, A → B → A, abort/unmount, an obsolete opener failure; SC (superseded and cancelled refusals keep the winner's tuple) |
| M4-R14 (2) | SC "only the exact current token commits the whole tuple…", "once a later token exists…"; N replacement leaves the old place drifted, never active |
| M4-R15 (1) | D "an unknown or malformed destination count cannot produce a verified destination" |
| M4-R16 (2) | D "a label map built for different content is stale…", "a bound map still cannot resolve a mapped page outside the trusted count" |
| M4-R17 (3) | D "resolveDestination refuses any reference without a trusted identity", "a caller cannot inflate the count"; C "checks, reserves, opens, then saves the exact destination" |
| M4-R18 (1) | D "translated pages stay inside the bounded range…" |
| M4-R19 (1) | SC "a saved place with an unknown origin stays unverified…"; VC unknown-origin control |
| M4-R21 (2 of 5) | N `a_populated_schema14_library_upgrades_to_15_keeping_every_row`; U populated 14 → 15; `skill_evidence_tests.rs::an_older_app_refuses_a_newer_library` (older binary refuses newer) |
| M4-R23 (2) | C "a new controller on the same database continues the durable order"; N `reservations_are_distinct_increasing_and_durable_across_connections` |
| M4-R24 (1) | C "a save-only retry of the older operation is refused after a newer failed request"; N `a_save_only_retry_rechecks_the_file_and_the_token` |
| M4-R28 (3) | N durable reservations across connections; SC supersede; C same-material supersede and the cancel/commit orderings |
| M4-R29 (3) | C "abort while the save is pending", "cancel first…", "commit first…" (post-commit result kept but not published) |
| M4-R30 (4) | C "a newer failed reservation supersedes an older held commit…", "an obsolete opener failure leaves the winner's status intact", A → B → A with a delayed save |
| M4-R33 (6) | SC (ignored, blocked and skewed claim writes; overflow); N `a_reservation_that_cannot_be_written_issues_no_token`, `reservation_refuses_overflow…`, durable across connections and restart; C "after a failed request a later request still opens and saves normally" |
| M4-R34 (4) | SC "a token never reserved", "a commit with no claim", "once a later token exists"; N `a_claim_that_cannot_be_read_refuses_the_commit` |
| M4-R37 (5) | C "a newer request retires older work first" (all five scenarios, including the failed cross-material ownership read) |
| M4-R38 (4) | SC ignored INSERT, skewed claim; N `an_ignored_claim_write_issues_no_token` (INSERT and UPDATE), `a_claim_that_persists_the_wrong_token…` |

## Not mapped, by design

These stay as evidence-harness checks:

- M4-R20 sensitivity mutants (2);
- M4-R21 ledger-extraction/pointer checks (3);
- M4-R22 scratch engine (1);
- M4-R31 runner receipts (4);
- M4-R32 mutant traceability (6);
- M4-R35 install attestation (8);
- M4-R36 claim syntax (3);
- M4-R39 signal handling (2).

They test the prototype's evidence runner, not application behaviour.

## Slice 1 additions beyond the prototype

| Area | Tests |
| --- | --- |
| M4S1-R1 | N held confirmation and bookmark tests; SC; S diagnostic; UI held bookmark |
| M4S1-R2 | S single-field corruptions, transport, diagnostic |
| M4S1-R3 | N file check: replace, delete, relink, held open, held actions, retry, wire |
| M4S1-R4 | `skillEvidenceUpgrade.test.ts`, U, N pre-upgrade copy |
| UI | Source badges and the pages panel (UI) |
