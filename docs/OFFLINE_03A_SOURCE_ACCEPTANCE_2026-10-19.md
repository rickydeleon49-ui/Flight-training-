# OFFLINE-03a source acceptance and integration handoff — 19 October 2026

**VERDICT: GREEN for local source review after the round-7 follow-up.** Required CI must pass on the exact submitted PR head before merge; GitHub records the final head and integration state. Installed acceptance remains a release-lane gate.

## Owner workflow and scope

The owner assigned Qwen as implementer and Codex as reviewer/integration owner, with correction/test loops and merging after the work and exact-head checks pass. This current instruction supersedes earlier role and integration defaults. Existing approved priority remains offline study → homework → exports, with 03b next and 03c deferred.

This completes the independent correction review that Claude's stop point requested. Claude's OFFLINE-03a implementation and earlier accepted corrections are preserved. Codex reviewed Qwen's actual diff, the native acknowledgement return contract, save/retry/discard/recovery callers and new tests. Codex did not author the production correction.

## Source and behavior

- Worktree: `/Users/rickymac/code/Flight-training-offline-03a-fixes`.
- Branch: `claude/offline-03a-core-fixes`; implementation base `750c90c`.
- Claude's reviewed stop point: `7562324`.
- First Qwen correction code commit: `9d3a90c7832525cb831dacb1a41b2dbd3628b5ed`. The final PR may add documentation/evidence only; [source hashes](evidence/offline-03a-2026-10-19/r7-source.json) identify all five tested correction files.
- Latest Qwen acknowledgement/absence correction: `d6ce015370dae0acfa81ba4b18a80c46925640cf`. [Current tested source hashes](evidence/offline-03a-2026-10-19/r8-source.json); final PR adds documentation/evidence only.
- The existing untracked shared `node_modules` symlink is excluded from commits. Main and other worktrees are preserved.

A reviewed save is remembered by the job provider before submission; a successful study-set write alone never deletes it. Cleanup requires acknowledgement returning true, or a resolved false followed by a successful journal read confirming this job id is absent. A rejected acknowledgement returns failure immediately; an entry still present or an unreadable journal also retains the operation for retry. Reopening after restart recognizes the exact committed operation, without duplicate history or new item IDs. Explicit discard follows the same verified-absence rule. The shared checkpoint module avoids a provider importing a dialog.

The independent round-6 RED report is preserved in [the evidence folder](evidence/offline-03a-2026-10-19/codex-review-r6-result.md). The first Qwen pass still ignored a false acknowledgement result; Codex reproduced that and returned it for correction before acceptance. No earlier failure was rewritten as a pass.

## Round-7 follow-up before merge

After the first reviewed head was published, an independent case showed that a journal entry removed by another window left the UI stuck in discard-failed. Native acknowledgement returns false both when an entry remains and when it is already gone. Codex returned this confirmed P2 to Qwen, kept PR #237 draft, and cancelled superseded CI run 39353697326; no merge occurred. The original RED report is preserved as `codex-review-r7-result.md`.

Qwen added a read-back only after a resolved false acknowledgement. Its intermediate patch also fell through after rejected calls; five existing cases failed, and those results are preserved. The final correction restores immediate failure on rejection and keeps all retention assertions. Present-record fixtures now return the ready journal record after regeneration, rather than incorrectly reporting absence. New tests cover already-absent cleanup and unreadable-journal retention/retry. Both fail on the prior published production source. No timeouts or safeguards were weakened.

The native restore quarantine deliberately hides old jobs after a committed restore; the read-back uses that existing logical journal view. No native restore/admission behavior changes, and no real profile operation was performed.

## Fresh verification

Node **v22.23.3**, sequential heavyweight checks, disposable synthetic data and mocked Gemini only:

| Check | Result |
| --- | --- |
| Six affected suites | **166 passed**, exit 0 |
| Independent already-absent acknowledgement diagnostic | **1 passed**, exit 0; failed on the previous published head |
| Four maintained round-6 regressions over original `7562324` | **4 failed as expected**, exit 1; 14 unrelated cases skipped |
| Two maintained round-7 regressions over published `72f2be2` | **2 failed as expected**, exit 1; 18 unrelated cases skipped |
| Full frontend | **3,927 passed, 6 skipped**, exit 0; no unhandled errors reported |
| Typecheck | exit 0 |
| Frontend build | exit 0 |
| Cargo lock synchronization | exit 0 |
| Whitespace | exit 0 |
| Schema-14 helper with host process visibility | **26/26**, exit 0 |

The source hashes were unchanged during all fresh gate checks and still matched before committing. Commands and raw logs are retained in [the evidence README](evidence/offline-03a-2026-10-19/README.md). The negative baseline used an owned temporary source copy, overlaid only with Qwen's maintained regression tests; no active checkout was reset or overwritten. Its discard case times out waiting for cleanup the old source never performs, while the other three fail checkpoint assertions.

Native code is unchanged since `f02e850`, so the original **844 passed / 11 ignored**, strict Clippy and fmt receipts remain applicable. The old handoff's `b50b7b5` reference was imprecise: Rust also changed in `f02e850`, before those receipts were produced. Historical installed evidence is not extended by these source tests.

The schema-14 source manifest is rebound only for updated tracker/handoff bytes; historical executions and its schema-14 scope remain unchanged. The first helper run passed 25/26: sandbox process-list diagnostics preceded the expected refusal line. With host process visibility, the same synthetic suite passed **26/26**. Both raw outcomes are preserved. [Original commands and exits](evidence/offline-03a-2026-10-19/r7-commands.json); [current frontend commands](evidence/offline-03a-2026-10-19/r8-commands.json). After the final tracker/manifest update, the same host-visible synthetic helper suite passed **26/26**, exit0 (`r8-schema14-helper-host.log`).

## Integration and next assignment

Publish this reviewed branch as the replacement OFFLINE-03a PR. Close draft #236 as superseded once the replacement exists. Wait for required CI on its exact current head, then merge with a head-match guard and verify default-branch inclusion. A new head or conflict resolution needs its own checks. No release, installer, key or real-profile operation is authorized by this work.

After verified merge, create/reuse a safe isolated Qwen branch from accepted main for **OFFLINE-03b**: manual practice questions, provider/origin through both validators and transactions, origin-bearing immutable versions and truthful historical/export readers, then the editor and regeneration-preservation interface. Preserve attempts, hidden-answer rules, packet v1 and instructor corrections excluded by default. Review/test before another authorized merge. Do not start 03c; keep extraction/search dormant and existing performance, flake and installed gates open.
