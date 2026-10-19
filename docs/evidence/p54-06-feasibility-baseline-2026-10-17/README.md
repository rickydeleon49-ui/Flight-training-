# P54-06 phase-A evidence

Synthetic simple-v1 characterization only; no FSRS or production transition.

- `fixtures.json`: literal baseline expectations;19 histories,78 review/refusal observations,6 local-day vectors. UTC/zone expectations were specified separately from production code. Fresh/null state is not an erasure simulation.
- `baseline-source-pins.json`: nine unchanged application/contract/lock inputs, bound to `e8f68080186331803f8f2578086e3f8258c8eff1` after the P54BASE-R1 repin (only the app version string in package-lock.json changed; the original 2e3f7fe pins are in `receipts/original-baseline-source-pins-2e3f7fe.json`). Source bytes and baseline Git blobs must both match. The runner imports those verified bytes, with existing TypeScript5.9.3 and Node22; no install is performed.
- `proof/baseline.mjs`: read-only CLI, deterministic JSON. Run from a repository checkout with the pinned baseline Git object available. Optional `--fixtures path` accepts only bounded synthetic fixtures retaining all required vectors. Errors print FAIL on stderr, exit1 and produce no partial stdout.
- `required-inputs.json` (P54BASE-R1): the frozen semantic inputs of every required history and local-day vector. The runner refuses it unless its SHA-256 equals `REQUIRED_INPUTS_SHA256` in `baseline.mjs`, and refuses any `--fixtures` file whose required vectors differ from it.
- `proof/baseline.test.mjs`: 29 regression tests (the original 20 plus 9 for P54BASE-R1). Temporary fixture/source copies are created under the system temp directory and removed; production inputs are never edited.
- `receipts/baseline.json`: actual production TS module outputs, not a port or mocked scheduler.
- `receipts/gate.json` and raw receipts: exact commands/exits.26 selected existing history tests exercise disposable node:sqlite/sql.js data;34 other cases are unselected. No fresh Rust execution or native parity is claimed.
- `receipts/timezones.json`: three CLI outputs match the saved baseline bytes under UTC, Los Angeles and Kiritimati. `receipts/expected-failure.json` retains the deliberately wrong due-time input delta and actual exit1/empty-stdout/FAIL result; it is an expected negative control, not a failed final gate.
- `receipts/r1-*`: P54BASE-R1 correction receipts: the frozen author diagnostic before (1 pass / 2 fail) and after (3 pass) the fix, and the rerun gate. Earlier receipts are unchanged.
- `SHA256SUMS`: all evidence members except this inventory itself, including proof sources and receipts. Paths are repository-relative; verify from repository root with `shasum -a 256 -c docs/evidence/p54-06-feasibility-baseline-2026-10-17/SHA256SUMS`.

The containing PR's CI takes the documentation-only path. Reviewers must execute the explicit standalone proof checks in the [reviewer prompt](../../P54_06_FEASIBILITY_REVIEWER_PROMPT_2026-10-17.md); green docs CI alone is not proof execution. Existing schema14 helper code and historical receipts are unchanged; only current tracker bindings/inventory are refreshed outside this pack.
