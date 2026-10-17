# M4 Slice 1 implementation checkpoint — 16 October 2026

Recovery note for whoever continues this work. It is **not** a completion report and does not claim the feature is finished or gated.

## Identity

- Worktree `/Users/rickymac/code/Flight-training-m4-slice1`, branch `claude/m4-slice1`, local only (not pushed).
- Base: the reviewed checkpoint 07fdcfa, with all 20 frozen hashes verified and the trim patch matching `preserved-uncommitted.patch` before any edit. Then:
  - e5ee1b9: the trim patch, committed on its own;
  - 589addd: merge of origin/main c13889b (#188), with no conflicts; PR #187's `backup.rs` folder-opening fix and the schema-15 verification are both present; migration 15 is still free.
- HEAD at the time of writing: see `git log -1`; the commits after the merge are listed below.

## Work since the merge

| Commit | Content |
| --- | --- |
| 0c9ee3c | Native M4S1-R1 (content/generation-bound `set_read`, content-bound `add_bookmark`) and M4S1-R3: the managed file is reread inside every commit/confirm/bookmark transaction; a replacement is recorded and reconciled there; new verified `open_navigation_document` with an opener seam; `OPEN_FAILED`. |
| 500b6af | TS R1 types/decoder/twin; R2 exact acknowledgements; desktop open in drivers; schema-14 helper bindings (prefix pins, separate ceiling, newer-schema refusal, the helper suite expecting exactly its four schema-15 anchor alarms); R4: the genuine tampered schema-14 case restored, the node test driver now restores a refused file's bytes, browser-driver upgrade/refusal tests, native pre-upgrade copy test. |
| 7ce54b2 | 33 shared operation cases (`src-tauri/fixtures/navigation/operation-cases.json`), run natively and on node:sqlite and sql.js; domain tests; adapter tests including the promoted diagnostics. |
| 012bb89 | `navigationRepository` and `NavigationController`, with 20 tests. |

## Finding dispositions (source level; Codex has not re-reviewed them)

- **R1:** fixed natively and in TS. Tests: `navigation_tests.rs` held-confirmation tests, shared cases, `navigationShapes.test.ts` diagnostics.
- **R2:** fixed (`isCommittedStateFor`, `isSetReadStateFor`, `isAddedBookmarkFor`). Tests: per-field corruption in `navigationShapes.test.ts`.
- **R3:** fixed natively (`run_operation_checked`, `open_verified_on`). Tests: replacement, deletion and relinking after inspection; held open; held actions; save-only retry; wire path.
- **R4:** the genuine case is restored. The defect was in the test driver only (it migrated the file in place before refusing); the browser driver already stored nothing. Before-fix receipt: `docs/evidence/m4-slice1-completion-2026-10-16/failed/r4-schema14-tamper-before-driver-fix.log`.

## Final state (superseding the "remaining" list this note held earlier)

All of the following are done. See [the completion report](M4_SLICE1_COMPLETION_REPORT_2026-10-16.md).

- Shared validation cases: ebe2c8f.
- UI: 20f31b2.
- The full Node 22 gate: every step exited 0. Receipts are in `docs/evidence/m4-slice1-completion-2026-10-16/final/`.
- Report and trackers.

**Next:** push, open the PR, wait for exact-head CI, then stop for Codex review.

No temporary files or background jobs are left. The scratchpad holds copies only.
