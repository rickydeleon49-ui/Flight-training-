# M2-3 C1 requirement-to-test map (6 October 2026)

Every row names the production test that proves it. Drivers: **native** = rusqlite command path (`src-tauri/src/card_reviews_tests.rs`); **node** = node:sqlite test driver; **sql.js** = browser driver over its WASM build (both in `src/data/cardReviewContract.test.ts`, which runs every case on both); **UI** = jsdom with the real `MaterialDetail`, `AppDataProvider` and disposable node:sqlite (`src/pages/StudyLibrary/CardReviewPanel.test.ts`).

## Scope section 10 (CRS-R1 / CRS-R2)

| Requirement | Production test | Drivers |
| --- | --- | --- |
| R1: Again not due at minute 9, due at minute 10 | `[promoted 1] an Again card is not returned at minute nine and is returned first at minute ten`; native `the_due_query_applies_exact_boundaries_and_current_version_ownership_on_native_rows`; UI `the Again card returns at minute ten…` | node, sql.js, native, UI |
| R1: exclusive next local midnight | `a day-ladder card due exactly at next local midnight is excluded; one millisecond earlier is included` (America/Chicago); native due-query test (boundary = due instant excluded, +1 ms included) | node, sql.js, native |
| R1: daylight saving | `daylight saving: the 25-hour local day in Chicago (1 November 2026)…`; `localDay.test.ts` 25- and 23-hour days | node, sql.js, pure |
| R1: old A versus current materialized B | `[promoted 2] with old A and current materialized B both due, only B is current due work` (real regeneration via `ai_study_sets`); native due-query test | node, sql.js, native |
| R1: B before first materialization | `before B's first materialization, B's cards are new and A's retained due rows are not current work` | node, sql.js |
| R1: A→B→A reuse | `A -> B -> A: when the raw cards return to A, A's retained schedule is current again` | node, sql.js |
| R1: suspended/flagged new cards excluded | `never-rated suspended and flagged cards are excluded from new work before the caps`; native due-query test; UI `a never-rated card can be paused and flagged from the browse card…` and `all cards paused or flagged…` | node, sql.js, native, UI |
| R1: order and limits after eligibility | `order and limits apply after eligibility, even behind 200 ineligible older rows`; `a 500-card set queues correctly and 10,000 events page in 20s…` | node, sql.js |
| R1: session cap and replay | UI `a lost acknowledgement offers Try again with the same request, counted once`; `session membership counts unique presented cards…` | UI, pure |
| R2: uncommitted pre-reset rev-0 refused | `[promoted 3] reset racing a queued rating…`; native `reset_racing_a_queued_rating_refuses_the_pre_reset_revision_0_request`; UI `a rating prepared before a reset made elsewhere is refused as stale…` | node, sql.js, native, UI |
| R2: pre-reset rev-1 refused after new rev 1 | `[promoted 4]…`; native `a_pre_reset_revision_1_request_stays_refused_after_a_new_rating_reaches_revision_1` | node, sql.js, native |
| R2: repeated reset; safe tombstones | `[promoted 5] repeated resets succeed; tombstones are skipped and keep routing metadata`; native `repeated_resets_skip_tombstones_and_keep_routing_metadata` | node, sql.js, native |
| R2: committed reset replay after reopen and new work | `a committed reset replayed after reopen and after new work…` (file reopen / stored bytes reopen); native `committed_reset_replay_after_reopen_and_new_work…` | node, sql.js, native |
| R2: changed payload; stale reset | `reusing a reset operation ID with a changed payload conflicts; a stale-generation reset is refused`; native `reset_conflicts_stale_resets_and_isolation…` | node, sql.js, native |
| R2: fresh work and new reset | `fresh work after refresh is accepted, and a new intentional reset applies again` | node, sql.js |
| R2: unrelated material and practice isolation | `reset touches only its material: another material's cards and all practice data remain`; native isolation test (practice versions/items unchanged) | node, sql.js, native |
| R2: typed reset branch / strict decode | `reset is strictly typed…`; native `strict_decode_refuses_every_shape_outside_the_typed_union` (15 shapes incl. 64 KiB, upper-case UUID, extra key) | node, sql.js, native |
| R2: reset keeps current snapshot, prunes old | `reset keeps the snapshot of the current raw cards and prunes retained older versions`; `reset of a material whose saved cards are damaged prunes every snapshot`; native `reset_keeps_the_current_snapshot_and_prunes_older_versions` | node, sql.js, native |
| First suspend before any rating | `first suspend before any rating creates the snapshot with no review time and no event`; native `first_suspend_before_any_rating…` | node, sql.js, native, UI |
| Flag refuses rating | `a flagged card refuses ratings until unflagged…`; native `flags_and_suspensions_refuse_ratings…` | node, sql.js, native |
| Stale content | `a stale revision and stale content are refused without writing`; native `stale_revision_stale_content_and_malformed_cards…` | node, sql.js, native |

## C1 prompt "Also" list

| Requirement | Production test |
| --- | --- |
| Golden identity | `cardIdentity.test.ts` `matches the golden vectors computed independently in Python`; native `golden_identity_vectors_are_reproduced` (`include_str!` of `proof/fixtures/identity-golden.json`) |
| Same-ID replay after reopen | `same-ID replay after reopen returns the stored result once; a changed payload conflicts`; native `same_id_replay_after_reopen…` |
| Stale content and malformed sets | `malformed saved cards read as malformed and refuse item actions; empty cards read as none`; `cardIdentity.test.ts` validation bounds; native `saved_card_validation_matches_the_typescript_rules` |
| Clock rollback | `clock rollback: a rating earlier than the last review is refused with nothing written`; native `clock_rollback_refuses_the_rating_with_nothing_written`; `cardScheduler.test.ts` |
| Material-delete cascade and tombstone replay refusal | `deleting the material cascades its card history; tombstones refuse a late replay`; native `deleting_the_material_cascades…` |
| Native rollback (event, receipt, generation) | native `a_failing_event_receipt_state_or_generation_write_commits_nothing` (real `RAISE(ABORT)` triggers on event, receipt, state, generation and reset-receipt inserts; no partial snapshot; same ID then applies) |
| Browser storage refusal restores bytes; failed recovery disables adapter | `storage refusal restores the durable bytes; the same ID then saves afresh`; `a reset whose recovery fails disables the adapter and keeps every saved row` |
| Validator parity on `card-validation/cases.json` | native `shared_card_validation_contract_native_outcomes`; `cardValidationParity.test.ts` (sql.js and node:sqlite); 36 cases, 12 categories |
| Schema-11 restore and schema-13 refusal | `a schema-11 database upgrades to 12 with empty card tables…`; `a database from a newer format (schema 13) is refused`; native `a_schema_11_database_validates_and_a_schema_13_database_is_refused` |
| Natively written state passes startup/archive validation | native `natively_written_card_history_passes_whole_application_validation`; node reopen in the replay tests runs `validateApplicationDatabase` |
| Allowlisted native errors | `cardReviewTauri.test.ts` (3 cases); native `every_native_message_is_the_typescript_allowlisted_message` |
| `UNSUPPORTED_DRIVER`, reads never write | `a repository over a driver without the atomic method refuses…`; `reads never write` |

## jsdom UI

| Requirement | Test in `CardReviewPanel.test.ts` |
| --- | --- |
| Full session and done-for-now; keyboard (Space/Enter reveal, 1–4 rate); no Gemini or network | `full session with keyboard, then done-for-now; no Gemini, network or practice write` |
| Due-tomorrow return with injected clock and zone | `the Again card returns at minute ten, and day cards return the next local day, due cards first` |
| Duplicate-click lock | `a second click while a rating is in flight sends nothing more` |
| Lost-acknowledgement retry | `a lost acknowledgement offers Try again with the same request, counted once` |
| Acknowledged-then-refresh-failure lock | `acknowledged, then refresh fails: the confirmation shows and conflicting actions stay locked until a read succeeds` |
| Reset confirmation, Cancel focus, pending lock, unknown Try again and Check again | `Reset: confirmation with Cancel focused, locked while pending, unknown outcome resolved by Try again`; `Reset: a committed reset whose acknowledgement was lost is confirmed by Check again, never sent twice` |
| States table (paused, damaged, none, read failure, stale) | `all cards paused or flagged, damaged cards, no cards, and a read failure each show their own state`; `a rating prepared before a reset made elsewhere…` |
| Delete confirmation copy | `the delete-material confirmation names the card review history` |

## Not covered here

- Installed macOS behavior, VoiceOver, signing and packaging (excluded by the assignment).
- The Tauri SQL plugin's own read path is not executed in tests; the repository SQL it runs is the same text the native test executes on rusqlite (`due_states_sql()` reads it from `cardReviewRepository.ts`).
- The "two active versions" fixture case is refused by the unique-index comparison first, because two active rows cannot be stored while the registered index exists; the row-count check is defence in depth.
