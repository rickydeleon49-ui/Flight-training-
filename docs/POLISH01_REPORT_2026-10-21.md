# POLISH-01 implementer report — 21 October 2026
Antigravity implemented 9 defect/polish fixes; Claude reviews, tests, merges. Work uncommitted.
1. Bound action controls: FlightDeck, reminders popup, action lists show "Open homework" to `/study/homework/:id`; suppresses reschedule/complete/delete; plain message "This comes from your homework. Open the homework to change it." Tests: `homework_action_shows_open_homework_not_generic_controls`, `reminders_dialog_opens_homework_for_bound_action`, `bound_action_refusal_message_is_plain`.
2. Readable history dates: Replaced undefined `created_at` with `recorded_at` and `formatDateTime(h.recorded_at ?? h.created_at)`. Test: `history_shows_readable_dates`.
3. Friendly due dates: "Due Oct 20" via `formatShortDate`, recommendation summary "Homework overdue since Oct 20". Test: `homework_dates_are_friendly`.
4. Activity buttons: Visible labels `Edit`, `Remove`, `Move up`, `Move down`, `Reopen`, keeping title in `aria-label`. Test: `activity_buttons_short_visible_labels_full_aria`.
5. Inline reflection/questions: Inline textarea, `Save` button, `Mark complete`, and hint "Write your answer first" when empty. Test: `reflection_and_questions_complete_inline`.
6. Editor styling: Added `select` class to native selects, "Activities" heading + spacing above add buttons, secondary kind select.
7. Filter chips: Added `aria-pressed`, selected button styling; default "Upcoming" includes overdue in-progress/reopened work. Test: `homework_filter_selected_state_visible`.
8. FLAKE-GEN-01: **reverted by Claude's review.** The proposed change accepted `allowedMillis` up to 600_000, the fallback the test exists to forbid, which weakens it. The test is unchanged and FLAKE-GEN-01 stays open.
9. Clock skew: Structural attempt/cycle check in both engines. Test: `backwards_clock_between_create_and_start_still_completes`.

## New User-Facing Strings
"Open homework", "This comes from your homework. Open the homework to change it.", "Homework overdue", "Homework due", "Homework overdue since <friendly date>", "Due <friendly date>", "Write your answer first", "Activities".

## Gate Receipts (docs/evidence/polish-01-2026-10-21/)
- cargo-fmt: EXIT 0 | cargo-clippy: EXIT 0 | cargo-metadata: EXIT 0 | git-diff-check: EXIT 0
- cargo-test-1 & 2: EXIT 0 (1016 passed: 988 unit, 13 service, 15 worker; 0 failed; 11 ignored each)
- npm-test-1 & 2: EXIT 0 (217 passed files; 4559 passed, 6 skipped tests; 0 failed each)
- npm-typecheck: EXIT 0 | npm-build: EXIT 0 | snapshot: EXIT 0 (26/26 passed)

## SHA256 of Changed Files
94a225dcce3cbca8d9f699396ef9a648a03804afa8326ed30a7e375c682f847c  src-tauri/src/homework.rs
89cd1d2851a44d6c6acb3b99eac577ac6a077690a3054138a6bf7dfd8141ddd9  src-tauri/src/homework_backup_tests.rs
0d62733d9c798537ad52e5318060791ccb4747386e3bea6c8b81176b05b565aa  src-tauri/src/homework_cards.rs
1b5e9144c9095856f47511e83cc64b2dc904764ece7c5952fc542d9f373d93a3  src/components/actions/ActionFormDialog.tsx
6ca5c27ece86acaf035846ae7943e844f46c3e4e2c7834c44b70e26d4f9f139e  src/components/actions/ActionRow.tsx
2c78d7680b5c10da1073c449e78fafbb1ff6bab32f4e49931128e5410d5aa690  src/components/actions/RescheduleDialog.tsx
4e796ce623ec5e1c77c57856c5be35a34e9d0da699a39501a05d168b950868b6  src/components/dailyPlan/DailyPlanStart.test.ts
0d65d6483eec091048092630b6a61e3e9ea3cf3e512a4df52f32559d65a80e3b  src/components/reminders/ReminderPopup.tsx
4b112eddbfa966c9977e8e24d5e29dcfb6308b9fd6a96fb7556fd16563abfb9c  src/data/homeworkTests.test.ts
79ffc9515cbbf7823836b23715db23793594634a60c2657e6869776b45c48b94  src/data/practiceSessionTransaction.ts
080ffa7edd40e05223c6e969ba058ca31365bffbe3eadd986fac0adc71513230  src/data/repositories/actionRepository.test.ts
492c155e79bdb8e2834f3ee577713de409774614df259423c91672940bc38db8  src/data/repositories/actionRepository.ts
42bfbbcbb62917fb1eb0ba5357036ae406f9aee4306077b196b5a96386d4b4e8  src/domain/homework.ts
6f23bb07ec5846a5562f4a11944de426dd7bbc55a1ff92efbef1573137fb4341  src/lib/dates.ts
7203ad381dba4e8b46da9fd1e454ab9dc03f24b418133043565ab3a650574310  src/logic/recommendations.test.ts
1a08548c8931d3a2ad7c24a6d85087fb6e1074787ee016fd2543e46b8ab8a586  src/logic/recommendations.ts
e41350c5090fc7e5d097da38caddafbfc5f742b01d9965c42154da0b2e784a31  src/logic/toolkit.ts
51da5eee13596e77c57046e72d106ef112dddb5349d5f047b0ad45f2c3630fb0  src/pages/FlightDeck/FlightDeck.test.ts
a4d0c1b8bc74303f13db562fa0df5adc4d18d8cbe39729c7f0ac9085fd25e91a  src/pages/FlightDeck/FlightDeck.tsx
fd85efc070bc5e729ba2fefee218215fb0dafaab50405efad6eff6120bc099f1  src/pages/PilotToolkit/PilotToolkit.tsx
3101f1b9871761515dc226d0da9f1adb3b595276dfc13c1e274e51360ff1d4b0  src/pages/StudyLibrary/Homework.test.ts
de6b6096344ad30073c6a81cbeeb2c56c400f7d4afaf8d6c860a54b43e9ef5b9  src/pages/StudyLibrary/HomeworkEditor.tsx
0c80f4d1b7a640017f6b23784e15f370dc8b09ef3ad6d73accf454ef1177ad93  src/pages/StudyLibrary/HomeworkView.tsx
111edeca20f9ead8627300b33237fdfb7c649be2f572b1a7158fae072e32c859  src/pages/StudyLibrary/homework.css
68ff9d6822373e8a3c9e30b859b290f7cc966771248856a135c5e58e1032fad9  src/pages/StudyLibrary/homeworkUi.ts
