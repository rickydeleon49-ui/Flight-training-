# M4 document navigation: evidence pack (round 5)

**Evidence-only prototype. It is not production code.** No migration is registered, no application file is changed, and OD-1–OD-10 stay proposed.

**Who did what:** Gemini started round 4 and left it unfinished. On 16 October 2026 the owner reassigned M4 to Claude, who completed round 4. Claude then made the round-5 corrections (M4-R33–R36) from the independent release review of that work. The full account is in [the round-5 report](../../M4_DOCUMENT_NAVIGATION_ROUND5_CORRECTIONS_REPORT_2026-10-16.md).

Earlier READMEs and the submitted round-4 receipts are kept unchanged under `historical-specimens/`. The round-4 copies are in `historical-specimens/round4-submitted/`, which `SHA256SUMS-of-specimen` seals.

## Run it

From a clean checkout of this repository, with the pack in place:

```sh
node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00
node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs --install
```

- **`--install`** runs the pinned PDF engine install (`npm ci --ignore-scripts`) in `scratch/pdfjs-engine`. It writes `scratch/pdfjs-engine/install-execution.json` with:
  - the exact command and working directory;
  - Node and npm versions and the real exit status;
  - captured stdout and stderr;
  - the SHA-256 of the installed manifests and of the engine bytes the proof executes.

  A failed install is recorded as failed and stops the run.
- **Without `--install`**, the runner reuses an existing engine only when two separate checks pass:
  - the bytes match `scratch-artifacts.json`;
  - the install execution record proves that this exact command succeeded in this checkout and installed those exact files.

  A missing, malformed or failed record, or one with a different command, working directory or binding, is refused.
- **`--engine-check-only`** performs only that install or reuse decision and records it.
- **Check the report and README against the recorded receipts without re-running anything:**

  ```sh
  node …/scripts/run_integration_proof.mjs --validate-claims-only
  ```
- **Verify a delivered pack without re-running anything:**

  ```sh
  node …/scripts/run_integration_proof.mjs --verify-manifest-only
  ```

## What the runner proves

- **Suites:** three suites run, `sensitivityMutants.test.mjs`, `proof.test.mjs` and `databaseLifecycle.test.mjs`. The issue map names 93 mapped tests, and the runner fails if any of them did not run.
- **Mutation sensitivity:** 20 executed mutants each revert one guard and must fail an unchanged named regression. The executed record is `receipts/07b-executed-mutants.json`. Claims are checked against that record, never against a fixed list.
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
  - **Round-5 guarantees:**
    - `M17_SUPPRESS_CLAIM_WRITE_FAILURE` (R33)
    - `M18_ACCEPT_UNRESERVED_FUTURE_TOKEN` (R34)
    - `M19_ACCEPT_FAILED_INSTALL_RECORD` (R35)
    - `M20_EXEMPT_NAMED_MUTANT_IDS` (R36)
- **Ownership (R33, R34):**
  - The claims table is declared in `candidate/candidate_migration_0015.sql` and is never created on demand.
  - A reservation that cannot be written throws and hands out no token. The controller reports the failure and neither opens nor saves.
  - A commit succeeds only for the exact, current, non-cancelled reserved claim, read in the same transaction as the write.
- **Evidence honesty (R31, R32, R35, R36):**
  - The runner's checks live in `scripts/evidenceChecks.mjs`, and the permanent tests call that same code and the real runner.
  - Outcome receipts are marked incomplete before the first step.
  - **Mutant IDs:** a token such as `M<number>_<NAME>` in the report or README is an execution claim, whatever words its name contains. Only file paths, file names and environment syntax such as `NAME=` are not claims.
  - **Historical text** is excluded only inside explicit `<!-- historical:begin -->` … `<!-- historical:end -->` blocks.
  - **Manifests:** stage 1 seals the payload in `PAYLOAD_SHA256SUMS` and verifies it. Stage 2 seals the complete delivery in `SHA256SUMS`, and the runner verifies that seal outside its own covered set.

Each run's receipts are in `receipts/`. The two lanes recorded for this round are under `../m4-round5-claude-2026-10-16/`.
