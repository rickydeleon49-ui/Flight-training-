# Independent final-corrections C2 review evidence

[Review](../../M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md) and [focused next assignment](../../M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md).

All 34 delivery paths in submitted-source-hashes.json match the untouched dirty implementation clone at review start and publication preparation. The four earlier evidence packs remain immutable. The latest submitted final-corrections pack is published byte-for-byte; source tracking snapshots are under submitted/. Live tracking entries preserve main's review history and identify unaccepted C2 scope.

Independent receipts:

- prior-frozen: 9 pass, exit 0.
- rereview-frozen: 12 pass, exit 0.
- completion-frozen: 16 pass, exit 0.
- submitted-proof: 24 pass, exit 0.
- final-diagnostic: two controls pass / nine assertion failures, exit 1. Production-valid fixtures use required sourcePage and shipped migrations. Resource fixtures use six short 500-card sets and two max-ASCII 500-card sets (~3 MB raw), not large artificial datasets. The diagnostic explicitly requests the proposed budgets, allowing justified default revisions while preserving requested limits.
- mutant-verifier and mutant-survival-control: exits 0, confirming repaired child-process enforcement and survival detection.
- owner-mutant-baseline-control: exit 1 after removing only the injected lock-clearing assignment from an isolated specimen; its unchanged owner assertion still fails. This is a failing baseline proof, not a successful mutation kill.

Run the diagnostic from repository root:

```
C2_REVIEW_MODEL=/absolute/path/to/proof/contractModel.mjs /opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs
```

run-mutant-verifier.mjs invokes the submitted verifier export; worker subprocesses execute the frozen submitted source, and receipts are captured here. owner-mutant-baseline-control.mjs redirects imports and removes the one injected mutation, then is invoked with --worker mutant_owner_lock. Neither changes submitted receipts.

query-audit.mjs adapts only submitted audit import/output paths and instruments actual executed SQL. First and continuation due pages use three calls; history uses two. Estimated SQL-result UTF-8 JSON bytes are not measured desktop IPC. query-audit-run.exit is the actual captured process exit. Existing timing receipts were inspected, not rerun; no unchanged app/native/Xcode/installed tests or user data were touched.

published-source-hashes.json freezes reviewer-authored report/prompt/tracking and executable diagnostic/audit/control sources. SHA256SUMS covers all review artifacts except itself. Submitted manifests preserve the original source root/HEAD/branch and snapshot hashes.
