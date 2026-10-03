# Mac A2 verification preparation evidence — 3 October 2026

**Status: preparation only. The corrected A2 source is not on GitHub, so no A2 test ran here.** This folder holds no A2 pass. See the [preparation report](../../MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md) for the acceptance matrix, case IDs and commands.

## Provenance

- **Who and where:** prepared by Claude on the Mac (MacBook Air Mac17,3, Apple M5, macOS 27.0.1 26A434), in `/Users/rickymac/code/Flight-training-` on branch `codex/mac-a2-verification-preparation`, HEAD `54b82b3`. Local and uncommitted, pending Codex review.
- **Toolchain:** Node v22.23.3, npm 10.9.9, node:sqlite with SQLite 3.53.4, sql.js 1.14.2, Vitest 4.1.11, rustc and cargo 1.99.0, `SDKROOT` MacOSX26.5.sdk.
- **Sources adapted:**
  - Codex's five diagnostics: [A2_SECOND_REVIEW_REGRESSIONS](../../A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md)
  - the R6/R7 contract: [correction prompt](../../A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md)
  - the historical Windows receipts: [second-review evidence](../a2-second-review-2026-10-02/README.md)
- **Data:** synthetic only. No owner profile, real database, document, credential or provider (Gemini) request was used. The only network access was to GitHub, for the source-availability check (fetch, `ls-remote`, one unauthenticated REST request). That check sent no application data.
- **Corrections (3 October 2026, after [Codex's review](../../MAC_A2_PREPARATION_REVIEW_2026-10-03.md), PREP-R1 to R3):** the diagnostics now observe state through `a2DiagnosticObservations.ts`, validated by `a2ObservationOracle.check.ts`. See the [correction receipt](correction-receipt-2026-10-03.txt). The reviewer's historical counterexample stays in [its own folder](../mac-a2-preparation-review-2026-10-03/README.md); it targets the reviewed file (`1902070e…`) and is not the success criterion for the corrected helpers.

## Files

| File | Content | Execution status |
| --- | --- | --- |
| [`a2ReviewDiagnostics.mac.test.ts`](a2ReviewDiagnostics.mac.test.ts) | Part 1: the five reviewer diagnostics, byte-identical to the reviewed file. Part 2: prepared cases `[AR-*]`, `[QT-*]` and `[BD-*]`, corrected for PREP-R1 to R3. | **Never executed against A2.** It collects to 181 tests, 57 of them CONDITIONAL SEAM; the reviewed version collected 93. esbuild parse exit 0. Type-check exit 0, against shims of the reviewed API shape only. This is static validation, **not** a behavioral pass. The default Vitest config discovers it 0 times. |
| [`a2DiagnosticObservations.ts`](a2DiagnosticObservations.ts) | Shared helpers: complete `fullState` (settled-only), single-statement `observeMaterial` / `classifyCreate`, `updateOutcomeProblems`, `proveForeignKeyEnforcement`, `installStatementBarrier` | Validated by the oracle controls |
| [`a2ObservationOracle.check.ts`](a2ObservationOracle.check.ts) | 36 task-local positive and negative controls on real node:sqlite and sql.js, built with the project migrations and a stand-in FIFO / no-owner harness. No A2 API. | **Run 2026-10-03: 36 passed, exit 0** ([results](oracle-controls-2026-10-03.txt)) |
| [`oracle-vitest.config.mjs.txt`](oracle-vitest.config.mjs.txt) | Import-free task-local Vitest config (exact-match aliases to `src/data`) | tool |
| [`oracle-controls-2026-10-03.txt`](oracle-controls-2026-10-03.txt), [`correction-receipt-2026-10-03.txt`](correction-receipt-2026-10-03.txt) | Correction receipts: control results, mutation sensitivity, counts, hashes | Evidence |
| [`a2-engine-probe.mjs.txt`](a2-engine-probe.mjs.txt) | Raw-engine SQL-form probe, v2. It supersedes this task's earlier v1 and keeps its cases. | Run on this Mac, exit 0 |
| [`engine-probe.json`](engine-probe.json) | Probe output: opening, ending and legitimate forms per engine route; export behavior; fault seam; foreign keys across export | Evidence |
| [`source-availability.txt`](source-availability.txt) | GitHub availability check (2026-10-03T16:36Z) and comparison against the reviewed hashes | Evidence: **unavailable** |
| [`case-sensitive-volume-capability.txt`](case-sensitive-volume-capability.txt) | A task-owned case-sensitive APFS image works on this Mac | Capability only |

The `.mjs.txt`, `.ts`, `.check.ts` and `.test.ts` files sit outside `src/`, so neither the app build, `tsc` (`include: src`) nor Vitest (`include: src/**/*.test.ts`) picks them up.

## Prerequisites

1. **Matching source.** The corrected A2 source must be independently accepted and published on GitHub, with the receipt requested in report §10. It must provide `saveMaterialAtomically`, `MaterialSaveOperation`, the connection owner and the durable sql.js write. Main's plural `saveMaterialsAtomically` is a different contract.
2. **Worktree.** Use a separate worktree of that exact SHA, then run `npm ci`. Run from its root, because the diagnostics resolve `node_modules/sql.js/dist/sql-wasm.wasm` from the working directory and fail fast if it is missing.
3. **Toolchain.** Scope it to the process:

   ```bash
   export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
   export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
   ```

   If the 26.5 SDK is missing, report that as an environment prerequisite. Do not change the system developer settings.

## Intended invocation (in the matching-source worktree)

```bash
E=/Users/rickymac/code/Flight-training-/docs/evidence/mac-a2-preparation-2026-10-03
cp "$E/a2ReviewDiagnostics.mac.test.ts" "$E/a2DiagnosticObservations.ts" src/data/
(set -o pipefail; npx --no-install vitest run src/data/a2ReviewDiagnostics.mac.test.ts --reporter=verbose 2>&1 | tee "$TMPDIR/a2-diagnostics.log"); echo "exit=$?"
rm src/data/a2ReviewDiagnostics.mac.test.ts src/data/a2DiagnosticObservations.ts
git status --porcelain
```

Interpreting the results:

- **Part 1** must pass.
- **A Part 2 failure** is a focused finding for the source owner. Its `evidence` JSON lines record the before and after state.
- **A `CONDITIONAL SEAM` case** that fails with "seam not reached" is a seam gap (report §6), not a driver defect.
- **If the API was renamed,** adapt only the imports and call sites, never the assertions, and record the change.

To run the oracle controls and list the diagnostics. This works on any checkout, current main included; it needs no A2 source and copies nothing into `src/`:

```bash
cp docs/evidence/mac-a2-preparation-2026-10-03/oracle-vitest.config.mjs.txt "$TMPDIR/a2-oracle.config.mjs"
npx --no-install vitest run --config "$TMPDIR/a2-oracle.config.mjs" a2ObservationOracle --reporter=verbose
npx --no-install vitest list --config "$TMPDIR/a2-oracle.config.mjs" a2ReviewDiagnostics
```

To re-run the engine probe from any checkout root:

```bash
cp docs/evidence/mac-a2-preparation-2026-10-03/a2-engine-probe.mjs.txt "$TMPDIR/a2-engine-probe.mjs"
node --no-warnings "$TMPDIR/a2-engine-probe.mjs" > "$TMPDIR/engine-probe.json"
```

## Cleanup guarantees in the diagnostics

- Every spy, statement barrier and global stub (`export`, `run`, `exec`, `prepare`, `btoa`, `localStorage`) is restored in `afterEach` by `restoreAllBarriers()`, `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`. This happens even when an assertion fails. The oracle harness closes every handle in `afterEach`.
- node:sqlite handles are `:memory:` and are closed in `finally`. sql.js state lives only in a per-case Map.
- No file is written outside the temporary test copy, which the commands above delete.
