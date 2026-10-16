# M4 round 4: lane results (16 October 2026)

Both lanes ran from fresh disposable checkouts of `claude/m4-round4-corrections` (HEAD `7e49558` plus the uncommitted round-4 files) and passed:

1. `prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00`: exit 0 on both lanes, with 14 migrations verified, ceiling 14, and review pack 29/29.
2. The runner.

| Lane | Engine install | Runner | Steps | Suites (tests / pass / fail) | Manifests |
|---|---|---|---|---|---|
| Node v22.23.3, npm 10.9.9 | **live** `npm ci --ignore-scripts`, exit 0 | exit 0, no failures | 24 | proof 59/59/0 · lifecycle 10/10/0 · sensitivity 3/3/0 | 114 payload / 117 delivery entries, both verified |
| Node v26.10.0, npm 12.2.0 | **verified reuse**: engine installed by npm 10.9.9 in a captured step ([`node26-reuse-engine-install.txt`](node26-reuse-engine-install.txt), exit 0), then verified against `scratch-artifacts.json` | exit 0, no failures | 23 (no install step) | proof 59/59/0 · lifecycle 10/10/0 · sensitivity 3/3/0 | 114 / 117, verified |

The delivered pack in the worktree is the Node 22 lane's sealed output. `--verify-manifest-only` exits 0 on it.

## The Node 26 live-install attempt failed and is kept

- **What happened:** npm 12.2.0 refuses the engine lockfile written by npm 10 (`EUSAGE`, missing optional `@napi-rs/canvas-*` entries).
- **How it was recorded:** the runner recorded `RESULT: FAILED - npm ci exited 1`, a `"status": "failed"` summary and `RESULT: NOT RUN` for verification ([`node26-live-install-attempt/`](node26-live-install-attempt/)). That run is also how the crash described below was found and fixed.
- **Not changed:** the lockfile, deliberately. Regenerating it would change the pinned engine.

## Early outputs that do not describe the code

`gemini-partial-*-node22.txt` were run before `scratch/` was prepared, so they fail for a missing `scratch/accepted-main`, not because of the code. They are kept only to explain the setup.

## Lane folders

`lane-node22/` and `lane-node26/` each hold:

- that lane's receipts;
- `PAYLOAD_SHA256SUMS` and `SHA256SUMS`;
- `runner-console.txt`.
