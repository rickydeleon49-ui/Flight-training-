# P54-06 phase B, part 1: preregistration

This folder freezes the FSRS-6 comparison contract **before** any candidate code exists. The candidate, the measurements and the transition simulations come in a later, separately reviewed change, and must not edit anything bound by `PREREGISTRATION.sha256`.

- `PREREGISTRATION.md`: the pinned algorithm, oracle, parameters, candidate contract, deviations C1 and C2, and the tolerances.
- `oracle/fsrs4anki_scheduler.js` and `oracle/LICENSE`: the unmodified FSRS4Anki v6.1.3 scheduler (blob `724a2f4`) and its MIT license. This is evaluation evidence only; it is never imported by the application or installed as a dependency.
- `proof/oracle.mjs`: runs the oracle in an isolated `vm` context after checking its Git blob ID and SHA-256.
- `scenarios.json`: the preregistered inputs (29 scenarios, 65 steps).
- `reference-vectors.json`: the oracle's outputs for those inputs. `proof/generate-reference.mjs --check` regenerates them and refuses any difference.
- `contract-vectors.json`: 26 hand-specified vectors for refusals, clocks, ranges, the caps and app policy.
- `proof/preregistration.test.mjs`: 7 tests covering:
  - the digests;
  - refusal of a tampered oracle or changed scenarios;
  - reproducibility;
  - the recorded oracle limitations;
  - fuzz;
  - the contract-vector shape.
- `receipts/`: the raw test and check output, and the runtime (Node 22.23.3, arm64, Apple M5).
- `SHA256SUMS`: every file here except itself. Verify it from the repository root with `shasum -a 256 -c docs/evidence/p54-06-phase-b-2026-10-19/SHA256SUMS`.

Run from the repository root with Node 22:

    node --test docs/evidence/p54-06-phase-b-2026-10-19/proof/preregistration.test.mjs
    node docs/evidence/p54-06-phase-b-2026-10-19/proof/generate-reference.mjs --check

No application source, dependency, migration, workflow or version changes. CI takes the docs-only path and does not run these checks; the reviewer runs them.
