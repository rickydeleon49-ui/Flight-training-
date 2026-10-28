# P54-06 phase B, part 2: candidate and measurements

Disposable evaluation evidence for the frozen preregistration in `../p54-06-phase-b-2026-10-19/`. Nothing here is imported by the application, and nothing in it changes `src/`, a migration, a dependency or the version.

- `candidate/fsrs6Candidate.ts`: `fsrs6-candidate-1`, written to the preregistered contract (validation order, elapsed days, paths, rounding, deviations C1–C3, intervals, caps, no fuzz, pure).
- `proof/runner.mjs`: verifies the frozen files, regenerates the oracle vectors through the frozen harness, then measures items 1–3; `--controls` runs item 4.
- `proof/transition.mjs`: the proposed transition contracts (item 3), pure functions.
- `proof/runner.test.mjs`: `node --test` entry point for all of the above.
- `RESULTS.md`: the measurements and what they do and do not show.
- `receipts/`: raw outputs, exit codes, timings and `commands.txt`.
- `SHA256SUMS`: every file here except itself. Verify from the repository root with `shasum -a 256 -c docs/evidence/p54-06-phase-b2-2026-10-28/SHA256SUMS`.

Run from the repository root with Node 22:

    node --test docs/evidence/p54-06-phase-b2-2026-10-28/proof/runner.test.mjs
    node docs/evidence/p54-06-phase-b2-2026-10-28/proof/runner.mjs
    node docs/evidence/p54-06-phase-b2-2026-10-28/proof/runner.mjs --controls
