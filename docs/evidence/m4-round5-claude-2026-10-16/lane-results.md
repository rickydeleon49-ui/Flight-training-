# M4 round 5: lane results (16 October 2026)

Both lanes ran from fresh, disposable worktrees at `7e49558`, the existing M4 branch head, with the uncommitted round-5 files copied in. Each began with `prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00`, which exited 0 with 14 migrations verified, ceiling 14, and review pack 29/29.

| Lane | Engine | Runner | Steps | Suites (pass / fail) | Mapped tests | Executed mutants | Manifests |
|---|---|---|---|---|---|---|---|
| Node v22.23.3, npm 10.9.9 | **live** install, exit 0, execution record written | exit 0, no failures | 25 | proof 80/0 · lifecycle 10/0 · sensitivity 3/0 | 93, all executed | 20 | 141 payload / 144 delivery, both verified |
| Node v26.10.0, npm 12.2.0 | **validated reuse** of a captured npm 10.9.9 install in the same clone: integrity PASS, attestation PASS | exit 0, no failures | 23 (no install step) | proof 80/0 · lifecycle 10/0 · sensitivity 3/0 | 93, all executed | 20 | 141 / 144, verified |

## How the Node 26 lane was run

1. **npm 12 live install** (`1-node26-live-install-attempt/`). Node 26 and npm 12.2.0 ran with `--install`. npm refused the lockfile (`EUSAGE`, missing optional `@napi-rs/canvas-*` entries) and exited 1. The runner recorded:
   - an execution record with exit 1;
   - `RESULT: FAILED - npm ci exited 1`;
   - a failed summary, with verification not run.

   The lockfile was not changed.
2. **Captured npm 10 install** (`2-npm10-engine-install/`). The Node 22 runner ran with `--engine-check-only --install` and exit 0. It wrote a genuine execution record:
   - npm 10.9.9;
   - this clone as the working directory;
   - all four bindings.
3. **Node 26 full run without `--install`** (`receipts/`, `runner-console.txt`). The reuse receipt shows byte integrity PASS and attestation PASS, against `reused-install-execution.json`, which is the record from step 2.

## End-to-end probes (`end-to-end-probes/`)

Both probes ran in the disposable Node 26 clone after its receipts were saved. The clone was restored byte-identical after each (`cmp`).

| Probe | Change | Result |
|---|---|---|
| A: failed install metadata | the valid execution record's `exit` set to 42, every digest left valid | runner exit 1: `verified-reuse has no valid install execution record (recorded install exit is 42, not 0)` |
| B: fabricated NAVIGATION claim | the review's one-line current claim appended to the round-5 report | runner exit 1: 08b reports the fabricated ID as an unexecuted cited mutant |

## Delivered pack

The pack in the worktree is the Node 22 lane's sealed output: its receipts, both manifests and the engine execution record. Its `SHA256SUMS` is byte-identical to `lane-node22/SHA256SUMS`. In the worktree:

- `--verify-manifest-only` exits 0 on Node 22 and on Node 26.
- `--validate-claims-only` exits 0 against the final report and README.

## Lane folders

- **`lane-node22/`:**
  - `prepare.txt`;
  - `runner-console.txt`;
  - `receipts/`;
  - both manifests;
  - `install-execution.json`.
- **`lane-node26/`:**
  - `prepare.txt`;
  - the two install sub-steps;
  - `runner-console.txt`;
  - `receipts/`;
  - both manifests;
  - `reused-install-execution.json`.
