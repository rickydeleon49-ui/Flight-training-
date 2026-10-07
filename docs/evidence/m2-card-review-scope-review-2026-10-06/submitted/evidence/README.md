# M2-3 card review scope — evidence (6–7 October 2026)

This is research evidence for [the card review scope](../../M2_CARD_REVIEW_SCOPE_2026-10-06.md), not application code. Production `package.json`, the lockfiles, `src/`, `src-tauri/`, migrations, workflows and capabilities are untouched.

| Path | Contents |
| --- | --- |
| `PRIMARY_SOURCES.md` | URLs, retrieval date, exact version, license and attribution summary for `ts-fsrs` 5.4.2 |
| `proof/package.json`, `proof/package-lock.json` | An isolated scratch package that pins `ts-fsrs` 5.4.2 exactly. The lock records the registry integrity. **A research artifact, not a production dependency adoption.** `node_modules/` is git-ignored and not part of this evidence. |
| `proof/simpleScheduler.mjs` | The proposed deterministic `simple-v1` scheduler and its local-day queue rule |
| `proof/contractModel.mjs` | Content-addressed identity, plus a pure in-memory model of the replay, conflict, revision, suspend and erase contract |
| `proof/fixtures/synthetic-material.json` | The synthetic imported material with three cards |
| `proof/fixtures/identity-golden.json` | Identity vectors computed independently in Python; the JavaScript model must match them |
| `proof/proof.test.mjs` | 27 `node:test` cases, labelled `[pure]`, `[model]` and `[fsrs]` |
| `proof/bundle-entry.mjs` | The esbuild size-measurement entry |
| `receipts/proof-run.txt` | **The recorded proof run: 27 passed / 0 failed, exit 0, Node 22.23.3** |
| `receipts/library-evidence.txt` | Raw registry and GitHub extracts, tarball hash recomputation, file list, source scans and bundle sizes |
| `receipts/claim-checks.txt` | Checks of the `reschedule` API and the `maximum_interval: 0` fallback |
| `results.json` | Result summary and observed FSRS behavior |
| `source-hashes.json` | SHA-256 of the proposal, prompt and STATUS/handoff paths, rooted at the repository root |
| `SHA256SUMS` | Every file in this directory except itself and `node_modules`, rooted here |
| `.gitattributes` | A whitespace allowance for raw receipts only |

## How to rerun

```bash
cd docs/evidence/m2-card-review-scope-2026-10-06/proof
npm ci --ignore-scripts --no-audit --no-fund
npm run proof
```

This needs Node 22 or later. `npm ci` downloads exactly `ts-fsrs` 5.4.2 per the lock.

## What this proves and what it doesn't

- **`[pure]`:** `simple-v1` arithmetic, covering all four first ratings, bounds (180-day maximum, 10-minute minimum), repeat failure, overdue handling, clock rollback refusal, determinism and serialization, and unknown-version refusal. Also stored UTC instants against local calendar days: local midnight, a time-zone change with nothing rewritten, and Again-step cards due only at their exact instant.
- **`[model]`:** content-addressed identity, plus the intended replay, conflict, stale-revision, suspension and tombstone semantics. **This is a simulation only.** It is not SQLite, the native pinned connection or the browser transaction owner, and it establishes no atomic persistence or installed behavior.
- **`[fsrs]`:** observed behavior of the pinned package with injected time. Most notably, `maximum_interval` was exceeded (182 days with a 180 maximum), and a clock earlier than the last review throws.

The run was recorded once, after the files had settled. One earlier, unrecorded dry run of the same suite, before the golden-vector case was added, passed 26 of 26. No failed attempt occurred. No stress matrix, mutation quota, application regression rerun, packaging or app launch was performed.
