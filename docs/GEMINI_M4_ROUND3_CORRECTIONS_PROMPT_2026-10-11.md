# Gemini: M4 round-3 corrections R23–R27

ACTIVE, 11 October 2026. Implementer: Gemini. Reviewer: Claude. This supersedes the round-2 wrapper for remaining work. Read [the round-2 review](M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md) in full first. It contains the exact reproductions.

## Start

- Work in the same worktree, `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, on your existing round-2 pack.
- Before editing, hash your current deliverables. Report any file that changed since the review.
- Do not pull, reset, stash, clean, commit or push.
- **Keep:** everything listed under "Verified and retained" in the review. Run its suites unchanged.
- **Boundaries, unchanged from round 2:**
  - Evidence-only.
  - No production, dependency, migration-registry, backup-format or shared-tracking edits.
  - The protected checkouts and frozen packs stay untouched.
  - Run the Node 22 and Node 26 lanes sequentially.

## Fix

**R23 (restart).** Make the operation generation durable-ordered across controller instances and sessions.

Required regressions on a file-backed database:
- Session 1 saves several pages, then a new controller on the same database saves a new page: it must commit.
- Two controllers on one database: the later request wins and the earlier one is rejected.
- The R13 held-write regression still passes unchanged.

**R24 (late retry).** `retrySave` must send the retried operation's own generation, and must be rejected once that operation is superseded.

Required regression: operation 1's save fails, operation 2 commits page 3, then operation 1's retry runs. The retry must not succeed, and the durable row must stay at page 3. Keep the existing retry-without-reopening behaviour.

**R25 (report).** Rebuild every test and mutant name in the report and README from the executed receipts or `issue-to-test-map.json`. Add a runner step that fails if the report or README names a test or mutant that didn't execute.

**R26 (missing tests).** Add the following:
- the R13 criterion-4 lifecycle tests, each asserting the final database state: same-content repeat, changed content with the same ID, A→B→A, abort/unmount, delayed failure and late callbacks
- an R14(b) test: a superseded or drifted row stays visibly `unverified`
- copy-mutants for R23 and R24 that fail unchanged regressions by name

**R27 (runner).**
- No `PASS` or `verified` text before the check it describes has run.
- Record the final manifest verification in a receipt.
- Added files in step 03 must fail the run.
- Verify the R9–R12 review pack's and the prior rounds' published `SHA256SUMS`.
- Make the `npm ci` install a recorded step: command, cwd, exit code and resulting digests. Document it in the README.
- Prove the runner itself fails when a delivered receipt is changed after the manifest is written.
- Record whether `M4_PINNED_REF` came from the default or an override.

## Deliver, then stop

- An updated report covering R23–R27. Correct the round-2 claims identified in the review; don't silently rewrite them.
- An updated pack whose `SHA256SUMS` verifies against its own bytes.
- Exact commands, exit codes and counts for both lanes.

Reply in chat with:

1. a table mapping each of R23–R27 to its status, the exact executed test names and the exact mutant IDs, copied from the receipts
2. both lanes' results
3. what changed in the delivered files, and why

Leave everything uncommitted. Don't start M4 production or ask for OD approval. Claude reviews next.
