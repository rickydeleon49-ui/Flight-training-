# P54-06 feasibility phase A: reproducible simple-v1 baseline

**Implemented by Codex; independent review pending. P54-06 remains partial.** This completes the reusable baseline/fixture foundation for the next non-production comparison. It does not implement FSRS or change the application.

## Starting point and scope

Base: `2e3f7fee6f84dd094c23ac0dfd7cd1053d2ccc4d`, after owner integration of calendar PR208. Its exact submitted head `02498e0` passed required CI run39094795674 before merging. PR207's layout, PR206's Study Hub plan and PR209's corrected evaluation are also on this base. Earlier pending-review tracker entries remain historical; their current integration status is recorded above them rather than deleting history. PR164's external-controller work stays separate.

The corrected [evaluation](P54_06_ADAPTIVE_FLASHCARD_EVALUATION_2026-10-17.md) calls for a bounded feasibility experiment before any production selection or migration. The owner's instruction to continue the roadmap is applied here as phase A: capture the existing scheduler faithfully and make the future comparison reproducible. All work is in an isolated existing Codex worktree; the primary's settings change and other agents' work remain untouched.

## What was built

[Proof and evidence](evidence/p54-06-feasibility-baseline-2026-10-17/README.md) contain:

- A literal JSON corpus: **19 histories, 78 review/refusal observations, six local-day vectors**. Coverage includes initial ratings, repeated Again/Hard, ladder cap, lapses/relearning, lateness, equal/same-day times, old cards, missing history, a fresh state after reset, backwards clocks and foreign versions. Local-day vectors distinguish fixed elapsed 24-hour scheduling from 23/25-hour Los Angeles days, travel and leap days.
- A standalone runner that verifies nine source pins against both current bytes and the named baseline Git blobs, then transpiles the **verified bytes** of the actual production scheduler/local-day modules with the existing locked compiler. It does not copy their algorithms. Runtime/compiler lane: Node22, TypeScript5.9.3.
- Full-state comparisons against literal expected outcomes, exact refusal classification and a prior-state immutability check. Output is deterministic JSON on stdout, with explicit scope and source/fixture identities. Any error exits1 and emits FAIL on stderr without partial PASS output. No app or database is opened by this runner.
- Fail-closed fixture shape/coverage checks and finite resource caps:512KiB input,128 histories,256 reviews/history,4,096 total reviews and64 local-day vectors. No environment flag or CLI switch bypasses source verification. CLI file input is for synthetic experiment fixtures only.
- **20 runner regression tests**, including changed expectations, missing cases, wrong refusals, malformed data, duplicate IDs, byte/count limits, source corruption and source-plus-pin edits in disposable copies. The latter still fails against the original Git blob. Tests also prove repeatable output and absence of source/fixture writes.

The literal expected schedules were specified from the accepted ladder/clock contract using separate standard-library UTC arithmetic; timezone expectations use Python zoneinfo, independently of the production Intl/bisection implementation. They characterize simple-v1, not an independently validated FSRS oracle. The new reusable JSON artifact and failure gates supplement existing tests rather than replacing them.

## Validation

Commands and raw exits/counts are in `receipts/gate.json` and neighboring receipts:

| Check | Result |
| --- | --- |
| Baseline runner | PASS:19 histories /78 observations /6 local-day vectors |
| New standalone runner tests |20 passed |
| Existing scheduler and local-day suites |16 passed |
| Existing history contract, selected reset/erasure/generation/replay/clock cases |26 passed;34 intentionally unselected by `-t` |
| Baseline CLI under UTC, Los Angeles and Kiritimati |Three byte-identical outputs |
| Deliberately wrong expected due instant through real CLI |Expected exit1, empty stdout, FAIL on stderr; receipt retained |
| Historical schema14 helper after final tracker binding refresh |26 passed |
| Source pins / evidence inventory / diff hygiene |Verified in the final packaging receipt |

The selected history tests execute the existing real node:sqlite and sql.js contracts on disposable synthetic storage. A `new-after-reset` pure fixture merely starts from null; **it does not simulate or prove erasure**. The separate repository tests establish the selected persisted browser/test-driver behaviors. Source pinning native code is not a fresh execution of its Rust twin. No fresh native parity, installed UI, backup/restore or performance result is claimed.

No production source, dependency/lockfile, migration/checksum, workflow, capability, version or release changes. Accordingly no full application matrix, frontend build or native rebuild was repeated for this docs-contained experiment. Existing application receipts remain historical and are not presented as FSRS validation.

## P54BASE-R1 correction — Claude, 19 October 2026

The author review of head `475069b` found that `--fixtures` checked only that the required IDs were present, not their inputs. Two real-CLI mutants passed as a result:
- One kept every history ID but cut each to its first review, giving PASS with 19 observations instead of 78.
- One replaced the Los Angeles, Kiritimati and travel zones with UTC and recomputed the expectations, giving PASS with 19/78/6.

**The correction:**
- `required-inputs.json` freezes the semantic inputs of the reviewed corpus:
  - each of the 19 histories: ID, history class, prior state, and the ordered rating and time pairs;
  - each of the 6 local-day vectors: ID, time and zone.
- The runner loads that file from its own folder and refuses it unless its SHA-256 equals `REQUIRED_INPUTS_SHA256` in `baseline.mjs`. The contract is never taken from the caller.
- Every required vector supplied through `--fixtures` must match its contract inputs exactly, or the run fails with `required inputs changed`. The comparison is semantic, so a reformatted or reordered file still passes.
- Extra experimental vectors are allowed only under new IDs.
- Expected states, due times and refusals are still checked against the actual production modules. The contract adds to those assertions; it does not replace them.
- `fixtures.json` is byte-identical to the reviewed head.

**Repin.** On current main (`e8f6808`), the old pins failed because `package-lock.json` changed. The only change since `2e3f7fe` is the app version string (0.5.5 → 0.5.7); the eight scheduler, local-day, review and migration sources are byte-identical. `baseline-source-pins.json` now binds `e8f6808`. The original pins are kept in `receipts/original-baseline-source-pins-2e3f7fe.json`.

**Evidence (raw receipts `receipts/r1-*`):**

| Check | Result |
| --- | --- |
| Frozen author diagnostic (`coverage-regression.test.mjs`), original runner with the same repin | 1 pass / 2 fail, exit 1 (`r1-before-fix.txt`) |
| Same diagnostic, corrected runner | 3 pass, exit 0 (`r1-after-fix.txt`) |
| Baseline runner | PASS: 19 / 78 / 6 (`r1-baseline.json`) |
| Standalone runner tests | 29 passed: the original 20 plus 9 R1 regressions (`r1-proof-tests.txt`) |
| Existing scheduler and local-day suites | 16 passed |
| Selected existing history-contract cases | 26 passed; 34 unselected, as before |
| CLI under UTC, Los Angeles and Kiritimati | Three byte-identical outputs |

The new regressions cover:
- deleted transitions under retained IDs;
- the same-count UTC replacement;
- changed rating, review time, prior state, history class and local-day time, each with expectations left untouched;
- an equivalent reserialization plus a distinct extra vector, which passes;
- a forged contract file, which is refused by its digest.

No production source, dependency, migration, workflow or version changed. Phase B is not started.

## Remaining P54-06 work

Phase B must pin an algorithm/reference/parameter contract and independently specified candidate vectors before comparing engines. Run synthetic comparisons and transition simulations without changing production storage or scheduling. Missing history cannot recreate erased events; retained operation results must not be recomputed under another engine. Existing due dates, reset barriers and historical schema14 invariants remain protected.

No algorithm, port, retention slider, library-rule exception or migration number is selected by phase A. The below-threshold ports remain unadopted. Do not interpret baseline PASS as evidence that FSRS is correct, beneficial or ready for production. [Detailed next assignment](P54_06_FEASIBILITY_NEXT_IMPLEMENTER_PROMPT_2026-10-17.md); [independent reviewer instructions](P54_06_FEASIBILITY_REVIEWER_PROMPT_2026-10-17.md).
