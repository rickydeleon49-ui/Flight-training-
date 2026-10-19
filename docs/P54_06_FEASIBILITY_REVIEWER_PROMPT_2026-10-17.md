# Review P54-06 feasibility phase A

Review the containing PR at its exact head. Codex authored this package; a different reviewer supplies acceptance. No merge or production scheduling work is authorized.

1. Read the report and corrected P54-06 evaluation. Confirm phase A is baseline characterization only and that the existing P54/Study Hub order remains unchanged. Fetch first and preserve dirty/active worktrees; use a clean review checkout. Do not launch the application or access profiles/providers.
2. Verify the nine `baseline-source-pins.json` entries against both current source and Git commit `2e3f7fee6f84dd094c23ac0dfd7cd1053d2ccc4d`. Application inputs, locks, migrations and workflows must remain unchanged. Verify `SHA256SUMS` and the current schema14 helper's20 bindings/21 evidence members; historical receipts must retain their bytes.
3. Inspect every literal fixture against the accepted simple-v1 contract; verify UTC/local-day expectations independently. The future candidate must not be judged against simple-v1 outputs as though they were FSRS goldens. Check repeated Again/Hard, the cap, lateness, equal timestamps, lapses, new/missing history and DST/travel boundaries. Null after reset is not an erasure proof.
4. Review the runner: exact shape/coverage/caps, source-and-Git-blob checks, import of the verified bytes rather than a later reread, pure actual-module execution, exact error classification, immutability and no partial PASS. Ensure optional fixture input cannot disable verification or silently drop required vectors. Tests may mutate only disposable files.
5. Run on existing Node22 dependencies, without installing anything:

```sh
node docs/evidence/p54-06-feasibility-baseline-2026-10-17/proof/baseline.mjs
node --test docs/evidence/p54-06-feasibility-baseline-2026-10-17/proof/baseline.test.mjs
npx vitest run src/logic/cardScheduler.test.ts src/logic/localDay.test.ts
npx vitest run src/data/cardReviewContract.test.ts -t 'reset|erased|generation|same-ID replay|clock rollback'
node --test scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check origin/main HEAD
```

The author receipts are20 new tests,16 existing pure tests,26 selected persisted-history tests with34 unselected, and26 helper tests. Reuse valid source-bound evidence elsewhere. No full application/native/build matrix is needed for unchanged production inputs. Confirm required CI on the actual reviewed PR head, without claiming its docs-only path executes this standalone proof.

6. Deliberately change an expected due instant in a disposable fixture and run the real CLI: require exit1, empty stdout and FAIL on stderr. Verify the checked-in source-plus-pin corruption case also fails against the original Git blob. Check the runner's caps and missing-vector gates meaningfully.
7. Return acceptance or one consolidated precise correction report with reproduction, expected behavior and acceptance criteria. Separate new proof verification from existing repository tests and unexecuted native/installed behavior. Do not report P54-06 complete. Keep the PR unmerged; the owner controls integration. Leave one model-neutral next prompt pointing to phase B only after review/corrections.
