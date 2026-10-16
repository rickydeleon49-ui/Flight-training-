# M4 round 6: lane results (16 October 2026)

Both lanes ran sequentially from fresh disposable worktrees at `7e49558`, with the uncommitted M4 documents and pack copied in. The exact commands and exits are in `commands-and-exits.md`.

| Lane | Engine | Runner | Steps | Suites (pass / fail) | Mapped tests | Executed mutants | Manifests |
|---|---|---|---|---|---|---|---|
| Node v22.23.3, npm 10.9.9 | **live** install, exit 0, signal none | exit 0, no failures | 25 | proof 91/0 · lifecycle 10/0 · sensitivity 3/0 | 104, all executed | 24 | 169 payload / 172 delivery, both verified |
| Node v26.10.0, npm 12.2.0 | **validated reuse** of an npm 10.9.9 install captured in the same clone by the Node 22 runner: integrity PASS, attestation PASS | exit 0, no failures | 23 | proof 91/0 · lifecycle 10/0 · sensitivity 3/0 | 104, all executed | 24 | 169 / 172, verified |

- **npm 12:** this round did not repeat the npm 12 live install. Its EUSAGE failure from round 5 remains preserved and classified as a failure in `../m4-round5-claude-2026-10-16/lane-node26/1-node26-live-install-attempt/`.
- **Delivered pack:** the worktree pack is the Node 22 lane's sealed output: receipts, both manifests and the engine execution record. Its `SHA256SUMS` is byte-identical to `lane-node22/SHA256SUMS`.

## Folders

- **`lane-node22/`:**
  - `prepare.txt`;
  - `runner-console.txt`;
  - `receipts/`;
  - both manifests;
  - `install-execution.json`.
- **`lane-node26/`:**
  - `prepare.txt`;
  - `1-npm10-engine-install/`, the captured npm 10 install;
  - `runner-console.txt`;
  - `receipts/`;
  - both manifests;
  - `reused-install-execution.json`.
- **`end-to-end-probes/`:** the exit-42 record probe, the fabricated-mutant probe and the R39 signal tests on both Node versions.
