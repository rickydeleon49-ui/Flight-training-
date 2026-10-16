# M4 document navigation: round-5 corrections (M4-R33–R36), 16 October 2026

**Evidence-only prototype. It is not production code.**

- No migration is registered, and `0015` stays a candidate file inside the pack.
- No application file changed, and OD-1–OD-10 stay proposed.
- P54-01 production work has not started.
- This work is uncommitted in the existing M4 checkout, waiting for Codex review.

**Author:** Claude. **Input:** the independent release review of round 4 and its correction handoff, both on `main` at `a76fa9b`.

## Identity and verification before editing

- **Checkout:** `/Users/rickymac/code/Flight-training-m4-round4`, the existing M4 worktree. Its base commit is `7e495580a48828c2c81cc4d8057e028acfc2a8eb`. Everything M4 is untracked there, and nothing was committed or pushed.
- **Accepted main for the proof lanes:** `e8720003a76be680812dfe3605d58e7eb6372d00`.
- **Gemini's original checkout:** `Flight-training-m4-viewer-evaluation` was not touched.
- **Review inputs:** all 119 entries in the review's `reviewed-input-hashes.json` matched before any edit. The review's own `SHA256SUMS` verified with no failures.
- **Pack checksums:** the three earlier manifests verified in full: 117, 114 and 64 entries.
- **Baselines, recorded before editing** (`docs/evidence/m4-round5-claude-2026-10-16/baselines/`):
  - The review's four new diagnostics fail on the reviewed specimens: 0 of 4 on Node 22.23.3 and 0 of 4 on Node 26.10.0.
  - The five frozen round-3 diagnostics pass on the pack as it stood: 5 of 5 on each Node version.
- **Preserved receipts:** the submitted round-4 receipts, manifests, map, README and report are copied unchanged into `historical-specimens/round4-submitted/`, sealed by `SHA256SUMS-of-specimen`. Earlier specimens, Gemini's partial receipts and the npm 12 failure record from round 4 are left as they were.

## The corrections

### M4-R33: a reservation that cannot be written fails closed

**Was:** `reserveOperationOwnership` created the claims table on demand and swallowed read and write errors. A blocked claim write still returned a token that was never stored, so two callers could hold the same token and the earlier request could win.

**Now** (`proof/persistenceProtocol.mjs`, `candidate/candidate_migration_0015.sql`):

- **Declared schema:** `material_operation_claims` is part of the candidate DDL, with integer and non-negative checks and a cascade from `study_materials`. The protocol never creates it. A missing table makes reservation fail.
- **Transaction:** reservation reads the claim and the saved owner, writes the next token, and commits, all inside one `BEGIN IMMEDIATE` transaction. Any error rolls back and is thrown. A token is returned only after its claim has committed.
- **Overflow:** a counter at the safe-integer limit is refused without changing the claim.
- **Controller:** a reservation failure is reported as `Failed to reserve operation ownership: …`. The controller neither opens the document nor saves a position, and makes no compensating write.

### M4-R34: a commit needs the exact current claim

**Was:** `commitNavigation` accepted any generation larger than the saved and reserved ones, so a token that was never reserved (owner 1, commit 101) wrote an active row. Claim-read errors were swallowed.

**Now:** inside the same write transaction, the commit reads the claim and accepts only when:

- the claim exists and was read successfully;
- its reserved generation equals the incoming generation exactly;
- that generation is not cancelled;
- it is newer than the saved owner.

Anything else commits nothing and leaves the saved tuple exactly as it was:

- **No claim:** rejected as `unreserved`.
- **Unreadable claim:** rejected as `ownership-unreadable`.
- **Older token:** rejected as `superseded`.
- **Unreserved future token:** rejected as `unreserved`.

There is no fail-open fallback.

**Fixtures:** test fixtures that seed a saved page now reserve the exact token first, through a small `reserveExactly` helper. This applies to 7 seeds in `proof.test.mjs`, 7 in `databaseLifecycle.test.mjs` and the affected sensitivity regressions. No behavioural assertion changed, and the original held-write and stale-token tests run as before. The lifecycle suite's table count rose by one because the claims table is now declared, and that table was added to its required list.

**Frozen round-3 diagnostics:** the five frozen diagnostics are not edited. One of them, the R29 diagnostic, seeds page 5 at generation 1 without reserving it.

- **Run directly against the corrected pack, it now fails.** The correct protocol refuses that unreserved seed. Recorded in `after-corrections/frozen-five-direct-without-adapter-node22.txt` and the Node 26 copy.
- **Fixture-binding adapter:** `docs/evidence/m4-round5-claude-2026-10-16/frozen-five-adapter/` changes only fixture seeding. When a seed names a generation and no claim exists yet, the adapter reserves that exact token through the real protocol, then calls the real, unchanged commit path. Everything else is the corrected class, and the controller is re-exported unchanged.
- **Result:** with the adapter, the frozen five pass 5 of 5 on both Node versions. The frozen file's SHA-256 is still `30755ceb54589c132e4f53f82f7a54455273b8119a5bc4dfb0804d1ccab4fee3`.

### M4-R35: reuse requires a real, successful install execution record

**Was:** verified reuse checked three digests and then wrote a zero-exit "consumed recorded install" receipt. A record describing a failed install (exit 42, wrong working directory) still passed.

**Now** (`scripts/run_integration_proof.mjs`, `scripts/evidenceChecks.mjs`):

- **Live install:** `--install` runs `npm --version` and the exact `npm ci --prefix <engine> --no-audit --no-fund --ignore-scripts`. It writes `scratch/pdfjs-engine/install-execution.json` with:
  - the schema `hfd-m4-engine-install-execution/1`;
  - the command and working directory;
  - Node and npm versions;
  - the real exit status and signal;
  - start and finish times;
  - captured stdout and stderr;
  - the SHA-256 of `package.json`, `package-lock.json`, the installed `pdfjs-dist/package.json` and the legacy `pdf.mjs` the proof executes.

  The receipt records the npm version and the record's own hash. A non-zero exit is recorded as it happened and stops the run with a failed summary. Nothing writes a zero exit that did not happen.
- **Reuse:** the runner checks two things separately and reports both.
  - **Integrity:** the bytes match `scratch-artifacts.json`.
  - **Attestation:** the execution record must be present, parse as JSON and carry the expected schema and every required field, with exit 0. Its command must equal the expected command and its working directory must be this checkout. Every binding must be present and must match the current file.

  Either check failing fails the run.
- **The recorder:** `scripts/record-scratch-artifacts.mjs` never runs npm. Its `installCommand` field is now labelled as a description only, with a pointer to the execution record.
- **`--engine-check-only`:** a new mode that performs only this install-or-reuse step. The Node 26 lane uses it to capture a genuine npm 10 install before its own reuse run.
- **Unchanged:** the lockfile is not changed. The npm 10 install record and the npm 12 failure from round 4 are preserved under `docs/evidence/m4-round4-claude-2026-10-16/`.

### M4-R36: mutant IDs are claims; history only inside explicit markers

**Was:** the checker discarded any mutant-like ID containing DOCUMENT, ROUND, CONDITIONAL, VIEWER or NAVIGATION, so a fabricated current claim with one of those words passed the real runner.

**Now** (`scripts/evidenceChecks.mjs`):

- **No exemptions by name:** every standalone `M<number>_<NAME>` token is an execution claim, whatever its name contains.
- **What is not a claim, decided by syntax alone:**
  - a token that is part of a path or file name, joined to `/`, `-`, a `.` followed by a letter, or more name characters;
  - environment syntax, such as `$NAME` or `NAME=`.

  Trailing sentence punctuation does not hide a claim.
- **Historical text:** text is excluded only inside explicit `<!-- historical:begin -->` … `<!-- historical:end -->` blocks. An unterminated begin marker excludes nothing.
- **Kept checks:** the existing checks are unchanged. Unexecuted cited tests, unexecuted cited mutants, executed mutants missing from the report or README, stale counts and an empty mutant record all still fail.
- **`--validate-claims-only`:** a new mode that runs exactly the full run's check on the current report and README, against the receipts of the last run.

## Tests and mutants

The issue map now names 93 mapped tests. That is the 72 behaviours mapped before this round, all still mapped and passing, plus the new round-5 tests. Every mapped test executed in both lanes.

The runner now runs the sensitivity suite first, so the traceability tests read this run's executed-mutant record rather than an earlier one.

| Finding | Permanent tests (`proof/proof.test.mjs`) | Sensitivity regression and mutant (regressions run inside the mutation harness, not as named suite tests) |
| --- | --- | --- |
| M4-R33 | `[M4-R33] a failed claim write throws, returns no token and leaves the saved tuple and claim unchanged`; `[M4-R33] a blocked claim write cannot hand out equal tokens or let the earlier request win`; `[M4-R33] a missing claims table fails reservation instead of being created on demand`; `[M4-R33] a controller whose reservation fails reports it and never opens or saves`; `[M4-R33] two connections to one file-backed database reserve distinct, increasing, durable tokens`; `[M4-R33] reservation survives restart and refuses overflow without changing the claim` | `M17_SUPPRESS_CLAIM_WRITE_FAILURE` fails the M4-R33 regression “a failed claim write must not return a token” |
| M4-R34 | `[M4-R34] commit rejects a generation that was never the reserved owner`; `[M4-R34] commit with no claim is rejected without writing`; `[M4-R34] an unreadable claim rejects the commit and keeps the exact saved tuple`; `[M4-R34] once a later token is reserved the earlier one is rejected and the winner's exact tuple stands` | `M18_ACCEPT_UNRESERVED_FUTURE_TOKEN` fails the M4-R34 regression “a never-reserved future token must not commit” |
| M4-R35 | The real runner, in a disposable mini-repository: `[M4-R35] the real runner's reuse route accepts a valid recorded successful install`; it rejects `missing`, `exit42`, `wrong-cwd`, `wrong-binding` and `malformed` evidence (five tests named "the real runner's reuse route rejects" followed by the case); `[M4-R35] a live install that fails writes its real non-zero execution record and a FAILED receipt`; `[M4-R35] digest integrity and successful-install attestation are checked separately` | `M19_ACCEPT_FAILED_INSTALL_RECORD` fails the M4-R35 regression “a recorded failed install must not attest reuse” |
| M4-R36 | `[M4-R36] active unexecuted mutant claims cannot escape via NAVIGATION in their ID`; `[M4-R36] document references and environment syntax are distinguished from claims by syntax, and history only by markers`; plus a third test that runs the real runner's `--validate-claims-only` on a report carrying the review's fabricated NAVIGATION claim and requires exit 1 | `M20_EXEMPT_NAMED_MUTANT_IDS` fails the M4-R36 regression “an unexecuted mutant claim must be rejected whatever its name contains” |

The third R36 test is not quoted by name here, because its name contains the fabricated ID and quoting it would itself be a current claim. It is the last M4-R36 entry in `issue-to-test-map.json`.

### Mutants

All 20 executed mutants are recorded in `receipts/07b-executed-mutants.json`, and each fails its unchanged named regression.

- **Kept from earlier rounds:**
  - `M1_RELAX_SHARED_COUNT_VALIDATOR`
  - `M2_REJECT_NULLABLE_PARENT`
  - `M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION`
  - `M5_IGNORE_CONTENT_PROGRESS_SCOPE`
  - `M6_DROP_DESTINATION_COUNT_REQUIREMENT`
  - `M7_DROP_LABEL_CONTENT_BINDING`
  - `M8_TRUST_CALLER_DESTINATION_BOUNDS`
  - `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE`
  - `M10_HARDCODE_STALE_LEDGER_CEILING`
  - `M11_OMIT_TUPLE_PROPAGATION`
  - `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION`
  - `M15_DISABLE_COMMIT_CANCELLATION_FENCE`
  - `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK`
- **Retargeted:** three earlier mutants became equivalent once R33 and R34 moved their guards. Each now reverts the guard where it lives and fails a new, unchanged regression. The original regressions still run in the clean baseline.
  - `M4_DISABLE_COMMIT_GENERATION_FENCE` now fails the M4-R13 regression “a replayed committed token must not overwrite the saved page”.
  - `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` now drops the durable maximum in reservation and fails the new cross-session reservation regression.
  - `M13_RETRY_SENDS_NEWEST_GENERATION` now fails the M4-R24 regression “a superseded retry must be refused before any persistence attempt”.
- **New:** `M17_SUPPRESS_CLAIM_WRITE_FAILURE`, `M18_ACCEPT_UNRESERVED_FUTURE_TOKEN`, `M19_ACCEPT_FAILED_INSTALL_RECORD` and `M20_EXEMPT_NAMED_MUTANT_IDS`.

### Review diagnostics after the corrections

Recorded in `docs/evidence/m4-round5-claude-2026-10-16/after-corrections/`.

- **The review's four diagnostics, run unchanged against the corrected pack:** 4 of 4 pass on Node 22.23.3 and on Node 26.10.0.
  - `reservation database failure must not return an unpersisted token`
  - `commit must reject a generation that was never the reserved owner`
  - `a blocked claim write cannot allocate equal tokens and make the earlier request win`
  - `active unexecuted mutant claims cannot escape via NAVIGATION in their ID`
- **The frozen five:** 5 of 5 through the fixture-binding adapter on both versions. 4 of 5 directly, as explained under M4-R34.

### Fault checks of the new tests

In a disposable copy only, each fault was applied, the new tests were run, and the files were restored byte-identical. Recorded in `fault-checks-of-new-tests.txt`.

| Fault | Caught by |
| --- | --- |
| Reuse ignores the execution record | all five rejecting runner tests |
| The checker exempts NAVIGATION names | the R36 checker test and the real-runner test |
| A live install records exit 0 whatever happened | the live-failure test |

## Lanes

Both lanes ran from clean, disposable clones prepared against accepted main `e8720003a76be680812dfe3605d58e7eb6372d00`. The results and receipts are in `docs/evidence/m4-round5-claude-2026-10-16/lane-results.md`, `lane-node22/` and `lane-node26/`.

- **Node 22.23.3, npm 10.9.9:** a full run with a live engine install (`--install`), which wrote a genuine execution record.
  - Install exit 0; runner exit 0 with no failures, 25 steps.
  - Suites: proof 80/80, lifecycle 10/10, sensitivity 3/3.
  - All mapped tests executed, and every recorded mutant failed its regression.
  - Manifests: 141 payload and 144 delivery entries, both verified.
- **Node 26.10.0, npm 12.2.0:**
  1. npm 12 cannot install from the engine lockfile (EUSAGE). That live attempt is recorded as a failure, and the runner stops on it.
  2. In the same clone, the Node 22 runner with `--engine-check-only --install` performs and records a genuine npm 10 install.
  3. A Node 26 full run then reuses that install. Its receipt shows both integrity and attestation passing.
     - Runner exit 0 with no failures, 23 steps.
     - Suite results are the same as Node 22's, and the manifests match the same counts.
- **End-to-end probes:**
  - A reuse run whose execution record says exit 42, with every digest valid, exits 1. The receipt names the recorded exit.
  - The current report with the review's fabricated NAVIGATION claim appended exits 1. Step 08b names the claim as unexecuted.

  Both probes run in disposable copies.

The Node 22 lane's sealed pack is the delivered pack. Its `SHA256SUMS` (SHA-256 `1d7edc27df04aaa90d5757f7828ac8a8ccd00bbb263270cf8d01509d92412e99`) is byte-identical to `lane-node22/SHA256SUMS`. In this checkout:

- `--verify-manifest-only` passes on Node 22 and Node 26.
- `--validate-claims-only` passes against this report and the pack README.

The final file hashes are in `docs/evidence/m4-round5-claude-2026-10-16/final-hashes.txt`.

## Limits

- This remains evidence for a candidate design. Production adoption needs M4 accepted, OD-1–OD-10 decided and `0015` registered through the normal migration process. None of that is done here.
- The Node 26 lane proves that reuse of an npm 10 install is validated. It does not show npm 12 installing this lockfile, which it cannot.
- The adapter is needed only because a frozen diagnostic seeds an unreserved generation, which the corrected protocol refuses by design.
