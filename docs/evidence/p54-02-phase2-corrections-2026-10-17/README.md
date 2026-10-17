# P54-02 phase 2 corrections (P54P2-R1–R4): evidence

All paths are relative to this directory. `SHA256SUMS` covers every other file here. `inventory.json` lists the same members with byte counts, SHA-256 and role, plus the publication status of the original phase 2 directory. `git-blob-verification.json` is written after staging and is outside `SHA256SUMS`, because it attests to it. It records each `SHA256SUMS` member's hash as read **from the Git index blob** (`git cat-file`), not from the working tree.

## Sources (corrected; the originals under `../p54-02-worker-proof-2026-10-16/` are unchanged)

- `p54_worker_proof.rs`: the corrected proof.
  - **R2:** one bounded settlement loop; success needs a complete result **and** exit 0.
  - **R3:** inner worker exit and completion are recorded in the extraction measurements.
  - **R4:** a caller size check before any spawn, plus bounded incremental hashing at request and publication time.
  - **Test helpers:** worker fault modes `eof-stall`, `done-nonzero` and `done-stall`, and a `fault-case` entry point.
- `run-phase2.py`: the fail-closed runner (R3). Exit 2 means an invalid measurement, 3 a suite failure, 4 a preservation failure, and 5 an unsafe location or build failure.
- `test_run_phase2.py`: 13 permanent runner regressions, using standard-library mocks only.
- `worker-fault-driver.py`: runs fault cases in a fresh process group, with a 3-second external **safety** kill. Needing that kill counts as a failure.

## `baseline/`: reproductions on the reviewed head 9b202c0, before any fix

- `worker-fault-baseline.json`: the review's adapter on the reviewed source.
  - `review-eof-stall` needed the external safety kill at 3.006 s.
  - `review-done-nonzero` reported `checked`, exit 3, `indexed: 1`.
- `worker-fault-baseline-extra.json` with `baseline-extra-adapters.rs`, the same approach for cases the review did not cover.
  - `baseline-done-stall` needed the external kill at 3.004 s.
  - `baseline-r4-prespawn` spawned a worker (`workersSpawned: 1`) for an over-limit input.
- `runner-gate-baseline.json`: the review's runner diagnostic on the submitted runner. It printed PASS and exited 0 for extraction exit 17 / index exit 23, and for changed files.
- `runner-regressions-on-submitted.log/.exit`: the 13 new runner regressions against the submitted runner. 11 fail and 2 error; the failures are listed in the report.
- `*-build.log/.exit`: builds of the disposable adapter examples, exit 0. Each example was removed afterwards.

## `final/`: corrected proof

- `worker-fault-final.json`: the same driver on the corrected binary. All four modes settle by themselves, with no external kill. Three failures index nothing; the normal control indexes once.
- `runner-regressions.log/.exit`: 13/13 pass, exit 0.
- `runner/`: the complete corrected run (build, suite 71/71, measurements, summary). These are the **replacement** raw logs (see below).
- `runner-console.log`: the runner's console output.

## The 12 missing original logs (R1)

The original `../p54-02-worker-proof-2026-10-16/final/*.log` members were matched by the repository's root `*.log` ignore rule. They were never committed, and the local copies were deleted with the implementer's scratch checkout after the PR was opened. **They cannot be recovered.** The original directory and its `SHA256SUMS` are left exactly as published, so they still list the 12 absent members. `final/runner/` is a separately labeled replacement run of the **corrected** proof against the same pre-registered datasets, seeds, repeats and targets. It is not a reconstruction of the original bytes.
