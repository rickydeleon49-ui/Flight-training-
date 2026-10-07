# M2-3 card review scope — CRS-R1/R2 correction evidence (6 October 2026)

This is evidence for the corrected [card review scope](../../M2_CARD_REVIEW_SCOPE_2026-10-06.md) and the updated [conditional C1 prompt](../../M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md), answering the [independent review](../../M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md). It is planning and research only. No production source, schema, dependency, lockfile, configuration or workflow changed; `receipts/hygiene-and-production-unchanged.txt` confirms this against base `df7a130`.

## Starting state

- Branch `codex/m2-card-review-scope`, HEAD `df7a130`, with the uncommitted scope work.
- Before any edit, the four proposal and status hashes and all 16 original evidence checksums matched the reviewer's frozen `submitted-hashes.json` and `submitted/evidence/SHA256SUMS`.
- No competing work was found. Stashes and the primary clone were not touched, and no other agent was launched.

## What changed in the proof (`../m2-card-review-scope-2026-10-06/proof/`)

| File | Change |
| --- | --- |
| `cardQuery.mjs` (new) | The exported CRS-R1 due-queue contract. It covers: `nextLocalMidnightUtc`, found by bisection on the local date so daylight saving is exact; `DUE_STATES_SQL`, which joins the current derived version, uses `due_at <= now` for Again steps and `due_at < next local midnight` for day steps, and excludes suspended and flagged cards before `ORDER BY`/`LIMIT`; new-card eligibility; caps applied after eligibility; and session membership that a replay cannot advance twice. It includes a representative proof schema, not migration 12. |
| `contractModel.mjs` (corrected) | Adds a persistent per-material review generation. Item and reset actions are strictly typed. Same-ID replay is resolved first (conflict, then erased, then the stored result), then the generation barrier applies. Receipts keep routing metadata (material, generation, action, hash) separate from a nullable result. Tombstoning skips receipts that are already tombstoned. Reset prunes snapshots according to the current raw cards. Materialization happens on any first item mutation, with `createdAt` separate from `firstReviewedAt`. |
| `proof.test.mjs` (adapted) | The six original `[model]` cases use the typed shapes with `expectedGeneration`. Their meaning is preserved, with the erasure case now a typed reset. The other 21 cases (pure scheduler, local calendar, identity and `[fsrs]`) are unchanged; only the import line changed. |
| `corrections.test.mjs` (new) | 21 cases: 9 `[sqlite]` CRS-R1, 9 `[model]` CRS-R2 and 3 `[model]` handoff details. The reviewer's five diagnostics are **promoted** against the corrected query and model, tagged `[promoted 1–5]`, and keep their failure injection and expected outcomes. Pre-reset requests are built with their legitimately captured old generation. |
| `package.json` | The `proof` script runs both files. The lock is unchanged. |

The original pre-correction bytes of `contractModel.mjs`, `proof.test.mjs` and `package.json` are in `frozen-pre-correction/proof/`, together with the original manifest (`frozen-pre-correction/ORIGINAL_SHA256SUMS`). The original folder's `FROZEN_PRE_CORRECTION.md` marks its receipts, README, results and manifest as frozen snapshots. The reviewer's frozen evidence was not edited.

## Results (actual)

| Check | Command | Result |
| --- | --- | --- |
| Corrected proof (once, after edits settled) | `cd ../m2-card-review-scope-2026-10-06/proof && node --test --test-reporter=spec proof.test.mjs corrections.test.mjs` | **48 passed / 0 failed, exit 0**, Node 22.23.3 (`receipts/corrected-proof-run.txt`) |
| Sensitivity: reintroducing each reviewed defect | `python3 run_mutations.py` | Every mutation is caught by the promoted case it targets, and each file is restored byte-for-byte (`mutation-results.json`, `receipts/mutation-*.txt`). Q1 (end-of-day bound for every card) fails promoted 1–2. Q2 (material-only filter) fails promoted 2. G1 (no generation barrier) fails promoted 3–4. G2 (null dereference on an already tombstoned receipt) fails promoted 5. |
| Hygiene and production-unchanged | `receipts/hygiene-and-production-unchanged.txt` | **Attempt 1 failed:** one raw mutation log had trailing whitespace; preserved as `…attempt1-failed.txt`. **Attempt 2,** after a local `receipts/*.txt` allowance: 0 problems in the tracked diff and 36 untracked files. `git diff df7a130 -- src src-tauri package.json package-lock.json vite.config.ts tsconfig.json .github` is empty, and there are no new production files. |

The sensitivity run happened before the final scope and prompt text edits. Proof source files did not change after it, except the `package.json` script line.

## What this establishes and what it doesn't

- **Pure scheduler:** `simple-v1` arithmetic (unchanged).
- **SQLite query proof:** the exact proposed due SQL and eligibility on a disposable `node:sqlite` database with a representative schema. It is **not** migration 12, the native rusqlite path or the sql.js browser path.
- **In-memory operation model:** the intended generation, replay, conflict, revision, reset, isolation and tombstone semantics. **It is a simulation:** it establishes no atomic native or browser persistence and no installed behavior. Production C1 must prove reset racing a queued rating, reopen-and-replay and rollback with real transactions (scope section 10, C1 prompt).
- **Not run:** no full application test, build or Rust matrix (this is a preparation task), no dependency install, and no repeat of the FSRS survey.

## Manifests

- `source-hashes.json`: the proposal, prompt and STATUS/handoff paths, **rooted at the repository root**.
- `CURRENT_PROOF_SHA256SUMS`: the current proof directory, excluding `node_modules`, **rooted at `../m2-card-review-scope-2026-10-06/proof/`**.
- `SHA256SUMS`: this directory except itself, **rooted here**.
