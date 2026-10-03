# Implementer prompt — complete the two remaining A2 review corrections

You are the implementer for Her Flight Deck. Work precisely on the existing local A2 changes; leave the result uncommitted for Codex's independent review. This is a bounded correction task, not another feature or broad audit.

## Repository and evidence

- Exact repository: `rickydeleon49-ui/Flight-training-`; locate the clone on the current machine
- GitHub: `https://github.com/rickydeleon49-ui/Flight-training-`
- Existing branch: `fix/atomic-study-material-saves`
- Expected HEAD/base: `533a8f50c2d0de74a75f5542022da3182f376ee9`
- Existing changes are intentional and uncommitted. Do not reset, discard, stash, switch branches, commit, push, open a PR or run CI.

After this review, documentation-only PR #43 merged into main at `5e388bf4169c7f968b1581292d6e1a24aa0493da`. It adds the GitHub Mac handoff and review summary; it does not include A2 source. The existing dirty A2 branch still has the base above. Preserve the new Mac handoff/status section when reconciling documentation; Codex will bring the branch current with main before its final PR.

Read before editing:

1. `STATUS.md` and the implementation note if the reviewed A2 source has actually been made available.
2. [Second-review details](A2_SECOND_REVIEW_DETAILS_2026-10-02.md).
3. [Diagnostic test source](A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md).
4. [Sanitized focused evidence](evidence/a2-second-review-2026-10-02/README.md).

**Source-availability gate:** A2 is still uncommitted on the Windows machine. This prompt shares the required correction contract, not that source. Do not run these cases against main and interpret its absent A2 API as a new failure. Coordinate with the existing implementer; no speculative push is authorized merely to share failing code.

First report branch, HEAD and dirty files, and verify that another agent has not changed the source since handoff. Do not overwrite competing changes if any are present. The reviewed `documents.rs` SHA-256 was `68e157a96ef679b8c28c2d46f7fe3a78eda31ce191e3e69a1fb2e57af0afa7d7`; the other reviewed hashes are in [the reviewed source hashes](evidence/a2-second-review-2026-10-02/after-review-hash-verification.json).

Codex independently confirmed the original four native failures now pass, the new 21 native save tests pass, and 67 focused frontend tests pass. **Do not redo R1–R3 or modify native file ownership to address the following browser/test-driver problems.** The original queue and quota fixes are valuable but two boundaries remain incomplete.

## Task 1 — R6: close the public transaction ownership bypass

Root cause:

- `src/data/connectionOwner.ts:28` only checks a transaction keyword at the beginning after whitespace. A leading SQL comment bypasses it.
- `src/data/testing/nodeSqliteDb.ts:63` and `src/data/sqlJsDb.ts:140` execute public select SQL without this guard. Their SQLite engines execute `BEGIN IMMEDIATE` through select.
- The queue prevents simultaneous operations but does not prevent a transaction from surviving one public operation into another.

Confirmed real-engine failures:

1. node:sqlite `execute("/* synthetic leading comment */ BEGIN IMMEDIATE")`; execute an unrelated insert and receive success; start an atomic material save. The save rejects and its cleanup removes the previously acknowledged unrelated row.
2. node:sqlite `select("BEGIN IMMEDIATE")` creates the same failure.
3. sql.js `select("BEGIN IMMEDIATE")`; execute an unrelated insert and receive success. Its export rolls the transaction back, so the acknowledged row is absent both live and after reopen.

Required behavior:

- A public operation must not leave transaction ownership open across calls. Refuse such requests before they affect the engine, or implement an equally safe, bounded operation-boundary guarantee with a clear rationale.
- Apply the guarantee to all public entry points that can execute transaction control, including select. Review leading line/block comments, whitespace, statement separators and savepoint/control variants supported by the engines.
- Preserve ordinary queries, parameters, required read PRAGMAs, and valid CREATE TRIGGER statements with BEGIN/END bodies. Do not use a blanket regex that rejects BEGIN anywhere in a SQL string.
- Avoid adding a SQL parser dependency, changing the desktop Tauri pooled driver, or introducing another database/ownership system unless the existing boundary cannot be corrected safely. Prefer a small, explicit solution.
- Do not expose raw handles, mutable browser globals, hidden controls or production test hooks.

Tests required for Task 1:

- Promote/adapt all three failing reviewer ownership cases into the real-driver tests. A refused unsafe call followed by a normal write and a successful material save must leave the acknowledged row intact.
- Cover commented transaction control and select entry-point control in both engines, plus the legitimate commented query and CREATE TRIGGER controls needed to prove the fix is not overbroad.
- Keep the existing deterministic unrelated-write, mid-transaction read, concurrent material/debrief/batch/public operation, FIFO and poisoned-owner tests.
- Run the focused real-driver suite after this task, inspect the actual results and fix failures before starting Task 2. Record command and counts.

## Task 2 — R7: include export failure in the browser durability boundary

Root cause:

`src/data/sqlJsDb.ts:103` calls `exportBytes()` outside the restoration catch. An atomic create or update has already committed in memory. If export throws, the promise rejects, but the rejected change stays in memory while storage still holds the old snapshot. The owner's ROLLBACK cannot undo that completed commit.

Codex reproduced this with actual sql.js and a one-time spy on its Database export after initialization:

- Create rejects, live database contains the new guide, reopened database is empty.
- Update rejects, live database contains the changed title, reopened database contains the prior title.

Required behavior:

- Rejected durable writes must restore the last stored state before another operation can run, whether failure arises from the write, serialization/export, re-enabling foreign keys, encoding, or storage.
- Preserve the existing localStorage quota behavior, foreign-key restoration and acknowledged-write persistence guarantees.
- Advance the stored snapshot only after persistence succeeds. Do not swallow an error or report success for an unstored change.
- If recovery itself cannot return to a known safe state, fail closed with a clear recovery message for later operations. Do not silently continue on a partially restored, closed or unknown handle.
- Keep the documented development-only startup limitation separate; do not redesign browser storage or introduce migrations/dependencies for this task.
- Review persist() against the same guarantees. A read or explicit persist must not covertly preserve a prior rejected write.

Tests required for Task 2:

- Promote the two reviewer export-failure cases with the real engine. Assert complete prior rows, tags and links in memory and after reopening, not only a rejected promise.
- Prove create retry saves exactly once; prove failed update retains the old row and tag links until a successful retry.
- Exercise the connection-setting restoration failure path if it shares the persistence boundary, and a restoration failure to demonstrate bounded fail-closed behavior. Use deterministic one-shot faults and restore every spy.
- Check that a later acknowledged unrelated write/persist cannot save the failed change.
- Retain quota/private-mode rejection, plain writes, debriefs, batches, mid-save persist ownership and post-export foreign-key enforcement.
- Run the focused real-driver suite after this task. Record the command, results and recovery behavior.

The reviewer test file is diagnostic evidence, not production instrumentation. Integrate its behavior into maintained tests and remove any temporary diagnostic copy or output from the final repository tree.

## Documentation and validation

After both tasks pass their focused tests:

- Update `STATUS.md` and `docs/ATOMIC_STUDY_MATERIAL_SAVES_2026-10-02.md` with R6/R7 root causes, exact guarantees, named regressions, results and remaining limits. Keep A2 pending independent Codex acceptance. Preserve A1 history.
- Keep `docs/MAC_PARITY_CHECKLIST.md` truthful. These browser/test-driver fixes do not prove installed macOS behavior or APFS identity; retain the existing Mac tests and holds. Adjust the audit annotation if it otherwise claims R4/R5 were fully closed before this review.
- Do not change native save/cleanup code, shipped migrations, backup formats or integrity/rollback, API-key storage, permissions, bundle identifier, versions, dependencies, lockfiles or workflows unless a focused test identifies a necessary correction. Explain any exceptional change first in the handoff.
- No A3–A6 development, outside-AI feature, open-source adoption, performance rewrite or release work in this correction task.

Run the complete required local matrix once after implementation and all focused corrections are finished. Keep it sequential; confirm older background processes have exited first:

```text
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
node scripts/check-release-version.mjs 0.5.3
git diff --check
```

Also independently rerun the corrected five reviewer cases if you have not integrated their exact behavior into the maintained suite. If a focused failure remains, diagnose it locally; do not spend CI minutes or run repeated full matrices to probe it. This SQLite task requires no PostgreSQL/container/keeper setup.

No speedup claim is needed. Preserve the measured native writer timeout policy (~5.5 s per attempt, roughly 23 s with current retries). Do not shorten it or modify its tests as incidental polish.

## Completion handoff

Stop when these bounded corrections and their validation are complete. Supply:

1. Branch, HEAD, exact dirty-file list, and confirmation that nothing was committed, pushed, tagged or published.
2. Issue-to-fix map for R6 and R7, including why public SQL cannot escape ownership and why every rejected durable write restores state or fails closed.
3. Named regression tests, per-task commands and results, full final matrix commands/exit codes/counts, and exact log paths.
4. Final SHA-256 hashes for changed production files, maintained regression files and documentation, so Codex can match the tested source.
5. Any conditionally skipped platform case and any limitation, explicitly separating browser development/test drivers from native desktop behavior.

Codex remains the independent reviewer and Git coordinator. Windows distribution remains held on v0.5.1; v0.5.2 is retired; the frozen v0.5.3 Mac candidate remains held. Do not claim Mac readiness, modify tags or publish a release.
