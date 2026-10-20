# OFFLINE-03a source acceptance and integration handoff — 19 October 2026

**VERDICT: GREEN for local source review.** Required CI must pass on the exact submitted PR head before merge; GitHub records the final head and integration state. Installed acceptance remains a release-lane gate.

## Owner workflow and scope

The owner assigned Qwen as implementer and Codex as reviewer/integration owner, with correction/test loops and merging after the work and exact-head checks pass. This current instruction supersedes earlier role and integration defaults. Existing approved priority remains offline study → homework → exports, with 03b next and 03c deferred.

This completes the independent correction review that Claude's stop point requested. Claude's OFFLINE-03a implementation and earlier accepted corrections are preserved. Codex reviewed Qwen's actual diff, the native acknowledgement return contract, save/retry/discard/recovery callers and new tests. Codex did not author the production correction.

## Source and behavior

- Worktree: `/Users/rickymac/code/Flight-training-offline-03a-fixes`.
- Branch: `claude/offline-03a-core-fixes`; implementation base `750c90c`.
- Claude's reviewed stop point: `7562324`.
- Qwen correction code commit: `9d3a90c7832525cb831dacb1a41b2dbd3628b5ed`. The final PR may add documentation/evidence only; [source hashes](evidence/offline-03a-2026-10-19/r7-source.json) identify all five tested correction files.
- The existing untracked shared `node_modules` symlink is excluded from commits. Main and other worktrees are preserved.

A reviewed save is now remembered by the job provider before submission and retained until its native journal acknowledgement returns true. A successful study-set write alone never deletes it. Rejected acknowledgements and false results retain the operation for retry. Reopening after restart recognizes the exact committed operation; neither the history nor generated item IDs are duplicated. Explicit discard clears the operation only after successful acknowledgement. The shared checkpoint module avoids a provider importing a dialog.

The independent round-6 RED report is preserved in [the evidence folder](evidence/offline-03a-2026-10-19/codex-review-r6-result.md). The first Qwen pass still ignored a false acknowledgement result; Codex reproduced that and returned it for correction before acceptance. No earlier failure was rewritten as a pass.

## Fresh verification

Node **v22.23.3**, sequential heavyweight checks, disposable synthetic data and mocked Gemini only:

| Check | Result |
| --- | --- |
| Six affected suites | **164 passed**, exit 0 |
| Independent rejected/false acknowledgement restart diagnostics | **2 passed**, exit 0 |
| Four maintained integration regressions over original `7562324` production source | **4 failed as expected**, exit 1; 14 unrelated cases skipped |
| Full frontend | **3,925 passed, 6 skipped**, exit 0; no unhandled errors reported |
| Typecheck | exit 0 |
| Frontend build | exit 0 |
| Cargo lock synchronization | exit 0 |
| Whitespace | exit 0 |
| Schema-14 helper with host process visibility | **26/26**, exit 0 |

The source hashes were unchanged during all fresh gate checks and still matched before committing. Commands and raw logs are retained in [the evidence README](evidence/offline-03a-2026-10-19/README.md). The negative baseline used an owned temporary source copy, overlaid only with Qwen's maintained regression tests; no active checkout was reset or overwritten. Its discard case times out waiting for cleanup the old source never performs, while the other three fail checkpoint assertions.

Native code is unchanged since `f02e850`, so the original **844 passed / 11 ignored**, strict Clippy and fmt receipts remain applicable. The old handoff's `b50b7b5` reference was imprecise: Rust also changed in `f02e850`, before those receipts were produced. Historical installed evidence is not extended by these source tests.

The schema-14 source manifest is rebound only for updated tracker/handoff bytes; historical executions and its schema-14 scope remain unchanged. The first helper run passed 25/26: sandbox process-list diagnostics preceded the expected refusal line. With host process visibility, the same synthetic suite passed **26/26**. Both raw outcomes are preserved. [Exact commands and exits](evidence/offline-03a-2026-10-19/r7-commands.json).

## Integration and next assignment

Publish this reviewed branch as the replacement OFFLINE-03a PR. Close draft #236 as superseded once the replacement exists. Wait for required CI on its exact current head, then merge with a head-match guard and verify default-branch inclusion. A new head or conflict resolution needs its own checks. No release, installer, key or real-profile operation is authorized by this work.

After verified merge, create/reuse a safe isolated Qwen branch from accepted main for **OFFLINE-03b**: manual practice questions, provider/origin through both validators and transactions, origin-bearing immutable versions and truthful historical/export readers, then the editor and regeneration-preservation interface. Preserve attempts, hidden-answer rules, packet v1 and instructor corrections excluded by default. Review/test before another authorized merge. Do not start 03c; keep extraction/search dormant and existing performance, flake and installed gates open.
