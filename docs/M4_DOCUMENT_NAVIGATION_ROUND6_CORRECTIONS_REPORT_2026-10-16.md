# M4 document navigation: round-6 corrections (M4-R37–R39), 16 October 2026

**Evidence-only prototype. It is not production code.**

- No migration is registered, and `0015` stays a candidate file inside the pack.
- No application file changed, and OD-1–OD-10 stay proposed.
- P54-01 production work has not started.
- This work is uncommitted and unpushed in the existing M4 checkout, waiting for Codex review.

**Author:** Claude. **Input:** [the round-5 independent review](M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md) and [its correction assignment](M4_ROUND5_CORRECTIONS_PROMPT_2026-10-16.md), both read from `origin/main` at `671c9f4`. PR #178 was already merged at `2f4cca2` and was not touched.

## Identity and verification before editing

- **Checkout:** `/Users/rickymac/code/Flight-training-m4-round4`, branch `claude/m4-round4-corrections`, HEAD `7e495580a48828c2c81cc4d8057e028acfc2a8eb`. It was fetched only: no pull, reset, stash or clean.
- **Frozen inputs:** all 594 paths in the review's `submitted-all-hashes.json` matched this worktree byte for byte before any edit.
- **Checksums:** the submitted manifests verified with no failures:
  - 144 delivery entries;
  - 141 payload entries;
  - 81 round-5 supporting entries.
- **Review evidence:** the review's own `SHA256SUMS` verified in full, once its five tracker and helper references were taken from the same `origin/main`.
- **Round 5 preserved:** before any regeneration, the submitted round-5 receipts, both manifests, the README, the issue map, the report and the engine execution record were copied unchanged into `historical-specimens/round5-submitted/`, sealed by its own `SHA256SUMS-of-specimen` (27 entries).
  - The round-5 supporting folder `docs/evidence/m4-round5-claude-2026-10-16/` is unchanged, including its npm 12 failure record.
  - Gemini's original checkout is unchanged. Its files are also archived, with checksums, under `Flight-training-backups/gemini-m4-checkout-2026-10-16/`.
- **Baselines** (`docs/evidence/m4-round6-claude-2026-10-16/baselines/`): the review's five new assertions (four ownership, one signal) fail 0 of 5 on Node 22.23.3 and on Node 26.10.0. That holds against the reviewer's specimens and against this starting pack.

## The corrections

### M4-R37: a newer request retires older work before reservation can fail

**Was:** `requestOpen` returned from its ownership-read and reservation failures before it changed the current intent or the active operation. An older operation held in its opener or save still passed every ownership check, so it succeeded later and saved page 10 over the newer failure.

**Now** (`proof/openerController.mjs`):

- **First thing at entry:** `requestOpen` advances a local `requestEpoch` and marks the controller's current operation cancelled. This happens synchronously, before any generation source, identity provider, ownership read or reservation can throw or return.
- **Not a durable token:** the epoch is never sent to storage, and no token is made up when reservation fails.
- **Effect on older work:** the older operation is refused at its next ownership check, after its opener or save. Its live cancellation flag is also what the commit transaction reads through `destination.isCancelled()`, so a save already handed to storage is refused inside the transaction and writes nothing.
- **Ownership checks:** they now go through one helper, `#owns()`. It requires all of:
  - not cancelled;
  - the same epoch;
  - still the active operation;
  - the same intent;
  - the same material.
- **Save-only retry:** the retry checks the epoch and cancellation of the operation it retries before any write. It checks them again after its await.
- **Thrown preliminary read:** a failing ownership read is reported as `Failed to read operation ownership: …` instead of rejecting the promise. Older work is still retired, because retirement happens first.
- **Unchanged:** the in-transaction cancellation fence, the immutable page/hash/label tuple, `abort()` (which also advances the epoch) and the durable ordering across controllers.

### M4-R38: a claim must persist before its token is issued

**Was:** reservation ignored the UPSERT's result. A `RAISE(IGNORE)` trigger skips the write without any error, so two reservations returned `[2, 2]` while the claim was missing (INSERT) or still held generation 1 (UPDATE).

**Now** (`proof/persistenceProtocol.mjs`), inside the same `BEGIN IMMEDIATE` transaction:

- **One row:** the claim write must report exactly one changed row.
- **Read-back:** a read inside the transaction must find the claim holding exactly the token about to be returned.
- **Otherwise:** a zero-row write, a missing or wrong row, or a failed read-back throws. The transaction rolls back, so the prior claim and the saved tuple stay as they were.

The claims table is still declared, never created on demand. R34's exact-claim check at commit is unchanged.

### M4-R39: the install record keeps the real signal

**Was:** the runner's `exec` wrapper dropped `spawnSync().signal`, and the install record hard-coded `signal: null`. A signal-terminated install was recorded with both exit and signal null.

**Now** (`scripts/run_integration_proof.mjs`, `scripts/evidenceChecks.mjs`):

- **`exec`:** the wrapper records the child's real signal.
- **Execution record:** the live install record keeps the real `exit` (null for a signalled child), the real `signal` and any `spawnError`.
- **Audit:** the receipt prints the signal and reads `RESULT: FAILED - npm ci was terminated by SIGTERM` for a signalled install. No numeric exit is invented.
- **Run outcome:** the run fails with the existing failed summary, and verification is not claimed.
- **Reuse:** a recorded install with any signal cannot attest reuse.

The fake npm used to prove this lives only inside the disposable test repository. The distributed runner and protocol have no test-only path.

## Tests and mutants

The issue map now names 104 mapped tests. That is the 93 mapped before this round, all still mapped and passing, plus the 11 below. The sensitivity suite now executes 24 executed mutants, each failing its unchanged named regression. Counts come from the recorded runs.

| Finding | Permanent tests (`proof/proof.test.mjs`) | Sensitivity regression and mutant (regressions run inside the mutation harness) |
| --- | --- | --- |
| M4-R37 | `[M4-R37] a newer failed reservation supersedes an older held opener and keeps the exact saved tuple`; `[M4-R37] a newer failed reservation supersedes an older held persistence and keeps the exact saved tuple`; `[M4-R37] a save-only retry of a partially saved operation is refused after a newer failed reservation`; `[M4-R37] a thrown preliminary ownership read is a reported failure that still retires older work`; `[M4-R37] after a failed request, a later successful request still opens and saves normally` | `M21_SKIP_ENTRY_SUPERSESSION` fails the R37 regression “a newer failed reservation must retire an older held opener”; `M22_RETIRE_WITHOUT_LIVE_CANCELLATION` fails the R37 regression “a newer failed reservation must stop an older held save from landing” |
| M4-R38 | `[M4-R38] an ignored claim INSERT throws, issues no token and changes nothing`; `[M4-R38] an ignored claim UPDATE throws, issues no token and changes nothing`; `[M4-R38] a claim that persists the wrong generation, or cannot be read back, fails closed`; `[M4-R38] a normal reservation persists exactly the token it returns` | `M23_TRUST_CLAIM_WRITE_WITHOUT_POSTCONDITION` fails the R38 regression “an ignored claim write must not issue a token” |
| M4-R39 | `[M4-R39] a signal-terminated live install keeps exit null and its real signal, and fails the run` (the real runner, with a disposable npm stand-in and a SIGTERM control); `[M4-R39] a recorded signal-terminated install cannot attest reuse` | `M24_DROP_INSTALL_SIGNAL` fails the R39 regression “a signalled install must keep its real signal” |

**What the R37 tests check:**
- the newer failure stays published, with no late success notice;
- the saved tuple (page, hash, label, status, owner) is exactly unchanged;
- the opener ran once, with no second invocation;
- there is no persistence attempt beyond the held one, and no compensating write.

**Retargeted mutants:** two existing mutants became equivalent because a new guard now also covers their case. Each was retargeted to revert the whole guard it pins; the original regressions still run in the clean baseline.
- **`M13_RETRY_SENDS_NEWEST_GENERATION`:** R37's epoch and cancellation checks also refuse a superseded retry. The mutant now removes the retry's whole pre-write supersession guard, and still fails the R24 regression “a superseded retry must be refused before any persistence attempt”.
- **`M17_SUPPRESS_CLAIM_WRITE_FAILURE`:** R38's read-back also refuses a swallowed write error. The mutant now suppresses every failure of the claim write and its check, and still fails the R33 regression “a failed claim write must not return a token”.

**Updated pattern:** `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK` targets the same post-await check, which now reads through `#owns()`. It still fails its R30 regression.

**Unchanged mutants:**
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
- `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION`
- `M15_DISABLE_COMMIT_CANCELLATION_FENCE`
- `M18_ACCEPT_UNRESERVED_FUTURE_TOKEN`
- `M19_ACCEPT_FAILED_INSTALL_RECORD`
- `M20_EXEMPT_NAMED_MUTANT_IDS`

**Fault checks** (disposable dev copy only, restored byte-identical afterwards):
- A runner that hard-codes `signal: null` fails the R39 real-runner test.
- A retry without its epoch and cancellation pre-checks fails the R37 retry test.

## Review diagnostics after the corrections

Recorded in `docs/evidence/m4-round6-claude-2026-10-16/after-corrections/`, with the frozen files run unchanged from the review evidence and pointed at this pack with `M4_REVIEW_TARGET_PACK=`.

- **The five new assertions:** 5 of 5 pass on Node 22.23.3 and on Node 26.10.0.
  - `a newer failed reservation supersedes an older held opener`
  - `a newer failed reservation supersedes an older held persistence`
  - `an ignored INSERT cannot issue an unpersisted reservation token`
  - `an ignored UPDATE cannot issue an unpersisted reservation token`
  - `a signal-terminated install preserves its real signal in the execution record`
- **The previous four diagnostics:** 4 of 4 on both versions.
- **The earlier frozen five:** 5 of 5 through the disclosed round-5 fixture-seeding adapter, unchanged. Run directly, the R29 diagnostic still fails, as disclosed in round 5. That 4 of 5 is recorded and is not counted as a pass.

## Lanes

Both lanes ran sequentially from fresh disposable worktrees at `7e49558`, with the uncommitted M4 documents and pack copied in. Each began with `prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00`, which exited 0 with 14 migrations verified and review pack 29/29. Raw commands, exits and receipts are in `docs/evidence/m4-round6-claude-2026-10-16/` (`lane-results.md`, `lane-node22/`, `lane-node26/`, `end-to-end-probes/`).

| Lane | Engine | Runner | Steps | Suites (pass / fail) | Mapped tests | Mutants | Manifests |
|---|---|---|---|---|---|---|---|
| Node 22.23.3, npm 10.9.9 | **live** `--install`, exit 0, signal none, execution record written | exit 0, no failures | 25 | proof 91/0 · lifecycle 10/0 · sensitivity 3/0 | all executed | all executed and failing their regressions | 169 payload / 172 delivery, both verified |
| Node 26.10.0, npm 12.2.0 | **validated reuse** of an npm 10.9.9 install captured in the same clone by the Node 22 runner (`--engine-check-only --install`, exit 0): integrity PASS, attestation PASS | exit 0, no failures | 23 | proof 91/0 · lifecycle 10/0 · sensitivity 3/0 | all executed | all executed | 169 / 172, verified |

**End-to-end probes,** in the disposable Node 26 clone after its receipts were saved. The clone was restored byte-identical after each.

| Probe | Result |
|---|---|
| A valid execution record changed to `exit: 42`, with every digest still valid | Runner exit 1: `verified-reuse has no valid install execution record (recorded install exit is 42, not 0)` |
| The review's fabricated NAVIGATION mutant claim appended to this report | Runner exit 1: 08b names it as an unexecuted cited mutant |
| The R39 tests, re-run on Node 22 and Node 26 | 2 of 2 pass on each |

**Delivered pack:** the Node 22 lane's sealed output, copied into this checkout. Its `SHA256SUMS` (SHA-256 `48dd18eced53cfda0dc68cf921921d086ec8bdd8422a2bae097f8831fa06bf97`) is byte-identical to the lane's. In this checkout, on both Node versions:

- `--verify-manifest-only` passes;
- `--validate-claims-only` passes.

The final source and evidence hashes are in `docs/evidence/m4-round6-claude-2026-10-16/final-hashes.txt`.

## Limits

- This remains evidence for a candidate design. Production adoption needs M4 accepted, OD-1–OD-10 decided and `0015` registered through the normal migration process. None of that is done here.
- The request epoch protects operations within one controller. Ordering across controllers and sessions still rests on the durable reservation (R28, R34, R38).
- npm 12 still cannot install the engine lockfile. The Node 26 lane validates reuse of a genuine npm 10 install, and the npm 12 failure remains a recorded failure.
- The trackers in this checkout (`STATUS.md`, `ROADMAP.md`, `docs/PROJECT_HANDOFF.md`) date from `7e49558`. A short entry was added at the top of each, but they will need reconciling with current `main` when Codex commits this work.
