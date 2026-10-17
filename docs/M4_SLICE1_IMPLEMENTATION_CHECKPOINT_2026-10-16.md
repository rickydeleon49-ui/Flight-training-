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

## Remaining

1. UI:
   - `SourcePageBadge` in `MaterialDetail`, `PracticeTestPanel`, `CardReviewPanel` and `PracticeHistory`;
   - a `DocumentPagesPanel` in `MaterialDetail`: check pages, open at a physical page, last requested page, mark read / clear, retry, bookmark add/list/open/delete, missing-file restore/locate;
   - a `useDocumentNavigation` hook;
   - UI tests.
2. Final report and tracker entries (STATUS, ROADMAP, PROJECT_HANDOFF); manifest refresh only if a bound helper file changed.
3. The full sequential gate on Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`). Local Node 26 fails some existing writable-schema tests (`table sqlite_master may not be modified`), which is unrelated to this work.
4. Push, open the PR, wait for CI, then stop for Codex.

## Tests run so far (Node 22 unless noted)

| Test | Result |
| --- | --- |
| Native navigation tests (`cargo test navigation`) | 34 passed after the latest additions |
| Clippy `-D warnings`, fmt | clean |
| `src/data`, `src/acceptance`, `currentSchemaVerification` | 1905 passed, 2 skipped (before the parity, shapes and controller files were added) |
| Parity | 68 passed |
| Shapes | 36 passed |
| Domain | 21 passed |
| Controller | 20 passed |
| Schema-14 helper suite | 26/26 (Node 26) |

The full gate has not been run yet.

## Temporary files

The scratchpad holds snapshot and patch copies only. There are no background jobs.
