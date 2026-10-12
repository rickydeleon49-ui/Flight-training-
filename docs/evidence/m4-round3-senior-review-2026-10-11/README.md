# M4 round-3 independent review evidence

The frozen submitted prototype fails five diagnostic assertions; this is a review reproduction, not a production implementation. Node 22 and Node 26 each reproduce all five assertion failures. Both submitted full runners pass their 52 mapped tests (39 + 10 + 3). Delivered SHA256SUMS verifies 45/45.

`submitted/` contains exact reviewed controller/protocol/contract/candidate bytes and the verified 14-migration reference used by the diagnostics. These migrations are test specimens, not registered production migrations.

Run the baseline diagnostic from the repository root:

```sh
node --test docs/evidence/m4-round3-senior-review-2026-10-11/diagnostics.test.mjs
```

Run its unchanged behavioral assertions against a corrected evidence pack:

```sh
M4_REVIEW_TARGET_PACK=/absolute/path/to/corrected/pack node --test docs/evidence/m4-round3-senior-review-2026-10-11/diagnostics.test.mjs
```

If explicit ownership APIs change, a narrowly documented fixture-binding adapter may be needed; no assertions or ordering scenarios may be weakened.

`manifest-fault-verdict.json` records actual exit 1 after a delivered receipt was changed immediately before the final manifest check. Summary/receipt still claim verification success. `traceability-fault-verdict.json` records exit 0 after the report alone claims an unexecuted M99 mutant. `install-probe-verdict.json` records that no npm invocation occurred while the runner fabricated a zero-exit npm-ci audit.

The two fault probes use PATH adapters only in disposable review copies. No operator or production path is adapted. Submitted live files were not edited. Detailed local worktree inventories and private account data are excluded.

Published command output normalizes disposable checkout paths and strips trailing whitespace. Raw output is retained in the local review scratch archive; counts, exits and assertion results are unchanged.
