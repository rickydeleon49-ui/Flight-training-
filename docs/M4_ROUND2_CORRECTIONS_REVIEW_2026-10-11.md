# M4 round-2 corrections review (Gemini submission)

11 October 2026. Reviewer: Claude (temporary reviewer while Codex is unavailable). Implementer: Gemini. **CORRECTIONS REQUIRED: M4-R23–R27 (3 P1, 2 P2).** M4 stays evidence-only. OD-1–OD-10 remain proposed. G1–G3 remain deferred.

## What was reviewed

- **Worktree:** `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`
- **Branch:** `codex/m4-navigation-viewer-evaluation`, HEAD `c28ab84`
- **Report:** `docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_REPORT_2026-10-11.md`
- **Pack:** `docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/` (89 files outside `node_modules`)
- **Synced documents:** the evaluation document and the conditional implementation prompt
- **Delivered bytes:** before reviewing, I hashed 109 delivered files. All 109 were unchanged afterwards, because every run happened in a disposable copy.

## Method

1. **Boundaries.** I checked tracked state, the protected checkouts and the frozen packs.
2. **Clean copy.** I copied the untracked deliverables into a throwaway worktree at `c28ab84`, without `node_modules`.
3. **Runner without the engine.** I ran the runner before installing anything.
4. **Pinned install.** I installed the engine exactly as `scratch-artifacts.json` records it: `npm ci --prefix <pack>/scratch/pdfjs-engine --no-audit --no-fund`, plus `--ignore-scripts`. Exit 0, 3 packages, `pdfjs-dist@6.3.289`.
5. **Both lanes.** I ran the runner on Node 22.23.3, then on Node 26.10.0.
6. **My own reproductions.** I wrote reproductions against the pack's own modules, using the real shipped migrations and a file-backed SQLite database.

## Verified and retained

- **Boundaries hold.**
  - 0 tracked modifications and no production, dependency, migration or shared-tracking edits.
  - The frozen packs are byte-identical to `origin/main`: integration rereview 55/55 files, scope rereview 41/41, scope review 30/30.
  - The primary checkout and the M3 worktrees show no changes from this session; their newest changes predate it.
- **Both lanes reproduce from a clean copy.**
  - Runner exit 0, 16 steps, 0 failures.
  - Suites: `proof.test.mjs` 30/30, `databaseLifecycle.test.mjs` 10/10, `sensitivityMutants.test.mjs` 3/3.
  - All 43 tests in `issue-to-test-map.json` actually ran.
  - `SHA256SUMS` verifies 39/39.
  - The modern-build Node 22 failure stays a labelled limitation.
  - The legacy parser passes all five fixtures, and its artifact digest matches the bytes that executed.
- **Missing engine fails loudly.** Without the engine installed, the runner exits 1 with an exact `npm ci` instruction (R22). It does not borrow another directory.
- **R13: the compensating rewrite is gone.** The `owner_generation` check runs under `BEGIN IMMEDIATE` inside `commitNavigation`. The held-write test asserts that 42 never becomes durable.
- **R15, R16, R17 and R19 are implemented** with executed regressions (see the test list in the runner's `05`/`06` receipts).
- **R18:** removing the dead guard and pinning the range invariant is acceptable; it is one of the options the prompt allowed.
- **R21:**
  - Migrations come from a verified accepted-main ledger, and a ledger tamper fails.
  - 0014 and the candidate 0015 coexist.
  - The older-binary ceiling is derived from the ledger, not a literal.

## Findings

### M4-R23 (P1): after a restart, the reading position can never be saved again

`OpenerController` starts `intentCounter` at 0 for every instance, and `openerController.mjs:117` passes that counter as the durable generation. `persistenceProtocol.mjs:146` rejects any save whose generation is lower than the stored `owner_generation`, and that value persists across sessions.

Reproduced on both lanes with a file-backed database:

1. Session 1 saves pages 5, 6 and 7. The durable row holds `{page: 7, gen: 3}`.
2. The app restarts: a new controller opens the same database and requests page 9.
3. The result is `success: false, state: "aborted", superseded: true`, and the durable row stays at 7.

Every save keeps being rejected until the new session has made more requests than the old one. Any second controller on the same database, such as another window, has the same problem.

Required fix: an operation's generation must be ordered against the durable owner across controller instances and sessions. For example, claim a generation from the store inside the write lock, or seed it from the persisted maximum. A guard that only works within one process doesn't satisfy this.

### M4-R24 (P1): a late `retrySave` overwrites newer progress with the obsolete page

`retrySave` (`openerController.mjs:183`) sends `this.currentIntentId`, which belongs to whichever operation is newest, not to the operation being retried. Its comment says it re-sends the same operation's ownership; it doesn't.

Reproduced on both lanes:

1. Operation 1 (page 42) opens, but its save throws, leaving it `opened_unsaved`.
2. Operation 2 (page 3) commits. The durable row is `{page: 3, gen: 2}`.
3. Operation 1's `retrySave()` runs late. It returns `success: true`, and the durable row becomes `{page: 42, gen: 2}`.

This is the stale-winner defect R13 exists to remove, now reached through the recovery path. `[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership` passes only because it never makes a newer request in between.

Required fix: the retry closure must carry and send the original operation's own generation, and it must be rejected once that operation has been superseded.

### M4-R25 (P1, evidence integrity): the report's traceability doesn't describe what ran

- **Test names:** the report's R13–R22 table and the chat summary cite 20 test names. None of the 20 matches any of the 43 tests that executed. For example, the report cites `[M4-R13] held obsolete write released after newer commit never reaches storage and leaves newer position intact`, but the test that ran is `[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage`.
- **Mutant names:** the cited names (`M01_CONTROLLER_DROPS_GENERATION_CHECK`, `M02_PERSISTENCE_ACCEPTS_STALE_GENERATION`, `M05_OLDER_BINARY_ALLOWS_CANDIDATE`, `M09_ALLOW_UNSAFE_INTEGER_RANGE`, `M10_ACTIVE_DESPITE_UNKNOWN_HASH`) don't exist. The code defines `M1_RELAX_SHARED_COUNT_VALIDATOR` … `M11_OMIT_TUPLE_PROPAGATION`.
- **R18 mutant:** the report credits R18 with a mutant that doesn't exist.
- **R13 mutants:** the report claims two; there is one, `M4_DISABLE_COMMIT_GENERATION_FENCE`.

The pack's own `issue-to-test-map.json` does match what ran, because the runner enforces it. The report and summary were written separately from that map. This is the same defect class as the "32 of 32" claim R20 corrected.

Required fix: generate every test and mutant name in the report from the executed receipts or the map. Add a check that fails when the report names a test or mutant that didn't execute.

### M4-R26 (P2): required regressions are missing

- **R13 criterion 4:** no test covers same-content repeat, changed content with the same ID, route A→B→A, abort/unmount, delayed failure or late callbacks with a final-database assertion. The test the report cites for it doesn't exist.
- **R14(b):** no executed test shows that a superseded or drifted generation's row stays visibly `unverified`.
- **M4-R23 and M4-R24:** each needs a permanent regression, plus a copy-mutant that fails an unchanged regression by name.

### M4-R27 (P2): runner claims that are still asserted rather than measured

- **Manifest receipt:** `13-manifest.txt` writes `RESULT: PASS` before any verification has happened.
- **Run summary:** `15-run-summary.json` writes `manifest.verified: true` before verification, and `stepsExecuted: steps.length + 1` adds a hardcoded step.
- **Final manifest check:** if the in-run manifest check fails, that failure only reaches the console. No receipt records it.
- **Step 03:** it prints FAILED for added files but doesn't fail the run.
- **R20(b):** the runner checks the subject pack against the implementer's own pre-edit inventory. It doesn't verify the R9–R12 review pack's or the prior rounds' published `SHA256SUMS`.
- **R22 install step:** the install isn't a recorded runner step with its own receipt. The README's prerequisites don't mention it, and `scratch-artifacts.json` sits outside the manifest.
- **Tamper self-test:** it proves that `shasum` detects a tampered file in a temp folder. It doesn't prove the runner fails when a delivered receipt is changed after the manifest is written.

### Nonblocking observations

- `M4_PINNED_REF` lets an environment variable override the accepted-main reference. That's acceptable for an evidence runner, but the receipt must record whether the default or an override was used. Accepted main is now `bf5cf59`; its shipped migrations are unchanged from `e872000`.
- The report links the assignment wrapper by an absolute local path. Use a repository-relative path once that wrapper is merged (PR #147).
