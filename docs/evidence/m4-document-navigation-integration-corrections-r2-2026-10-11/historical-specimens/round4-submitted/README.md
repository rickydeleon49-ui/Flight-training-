# M4 document navigation: evidence pack (round 4)

**Evidence-only prototype. It is not production code.** No migration is registered, no application file is changed, and OD-1–OD-10 stay proposed.

**Who did what:**

- Round 4 (M4-R28–R32) was started by Gemini and left unfinished and unreviewed.
- On 16 October 2026 the owner reassigned M4 and P54-01 to Claude, who completed it.

The full account, including what Gemini had already done and what Claude changed, is in [the round-4 report](../../M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_REPORT_2026-10-16.md). The previous README is kept as `historical-specimens/pre-round4-README.md`.

## Run it

From a clean checkout of this repository, with the pack in place:

```sh
node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00
node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs --install
```

- **`--install`** runs `npm ci --ignore-scripts` for the pinned PDF engine in `scratch/pdfjs-engine` and records the real exit status. Without it, the runner verifies an existing install against `scratch-artifacts.json` and records that as reuse.
- **Verify a delivered pack without re-running anything:**

  ```sh
  node …/scripts/run_integration_proof.mjs --verify-manifest-only
  ```

## What the runner proves

- **Suites:** three suites run: `proof.test.mjs`, `databaseLifecycle.test.mjs` and `sensitivityMutants.test.mjs`. The issue map names 72 mapped tests, and the runner fails if any of them did not run.
- **Mutation sensitivity:** 16 executed mutants each revert one guard and must fail an unchanged named regression. The executed record is `receipts/07b-executed-mutants.json`, and claims are checked against that record, never against a fixed list.
  - **Earlier guarantees:**
    - `M1_RELAX_SHARED_COUNT_VALIDATOR`
    - `M2_REJECT_NULLABLE_PARENT`
    - `M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION`
    - `M4_DISABLE_COMMIT_GENERATION_FENCE`
    - `M5_IGNORE_CONTENT_PROGRESS_SCOPE`
    - `M6_DROP_DESTINATION_COUNT_REQUIREMENT`
    - `M7_DROP_LABEL_CONTENT_BINDING`
    - `M8_TRUST_CALLER_DESTINATION_BOUNDS`
    - `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE`
    - `M10_HARDCODE_STALE_LEDGER_CEILING`
    - `M11_OMIT_TUPLE_PROPAGATION`
    - `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING`
    - `M13_RETRY_SENDS_NEWEST_GENERATION`
  - **Round-4 guarantees:**
    - `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION` (R28)
    - `M15_DISABLE_COMMIT_CANCELLATION_FENCE` (R29)
    - `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK` (R30)
- **Evidence honesty (R31, R32):**
  - The runner's checks live in `scripts/evidenceChecks.mjs`, and the permanent tests call that same code and the real runner.
  - Outcome receipts are marked incomplete before the first step, so an interrupted run cannot leave an earlier success behind.
  - Stage 1 seals the payload in `PAYLOAD_SHA256SUMS` and verifies it. Stage 2 seals the complete delivery in `SHA256SUMS`, and the runner verifies that seal outside its own covered set.

Each run's receipts are in `receipts/`. The two lanes recorded for this round are under `../m4-round4-claude-2026-10-16/`.
