# Codex independent structured-import review evidence

These results belong to the [independent review](../../STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md), not contract acceptance. The reviewed prototype and contract are local, uncommitted on `codex/structured-study-import-contract`; no shipping code changed.

- [Submitted hash receipt, preserved](reviewed-submission-receipt.txt): all 86 listed hashes matched; receipt hash `b2b8caea744ac6710fe61f3291b3c97c0700de696a336040fdedba9ee0b057f6`.
- [Validator results](codex-validator-results.json): 95/95, exit 0.
- [Renderer results](codex-render-results.json): 23/23, zero fetch calls, exit 0.
- [Capability simulation](codex-legacy-webkit-sim.json): Node only, exit 0; absent Object.hasOwn causes the expected crash, shim permits rendering.
- [Additional assertions](codex-diagnostics.json): six failures reproducing R1/R2 and two passing controls, exit 1 as expected.
- [Diagnostic source](codex-diagnostics.mjs.txt): inert review artifact. Copy to the scratch root as `codex-diagnostics.mjs`, beside `src/validator.mjs`, then run `node codex-diagnostics.mjs <absolute-fixtures-directory>`. Results are written under scratch `results/`. Synthetic credential shapes are assembled at runtime; results record booleans only.
- [Type diagnostic](codex-type-diagnostic.ts.txt) and [result](type-diagnostic-result.txt): two TS2322 errors, exit 2 as expected. Change only the import's clone path when reproducing elsewhere.

Codex reconstructed the submitted `.txt` prototype sources in `/private/tmp/hfd-contract-review-demnre5w`, copied its package/lock files, and ran `npm ci --ignore-scripts --no-audit --no-fund`. All 89 packages came from the locked npm registry tree. Node 22.23.3 was used. Repository node_modules, manifests and locks were untouched; the repository's existing TypeScript binary was used read-only for the type diagnostic.

Commands from that scratch directory (replace `<evidence>` with the absolute submitted contract evidence directory):

```text
node run-fixtures.mjs <evidence>/fixtures <evidence>/expected-outcomes.json results/codex-validator-results.json      exit 0
node run-render.mjs <evidence>/fixtures results/codex-render-results.json                                          exit 0
node run-csp-probe.mjs jitless <evidence>/fixtures                                                                 exit 0
  {"mode":"jitless","jitless":true,"functionConstructorCalls":0,"accepted":7}
node run-legacy-webkit-sim.mjs <evidence>/fixtures results/codex-legacy-webkit-sim.json                               exit 0
node codex-diagnostics.mjs <evidence>/fixtures                                                                     exit 1, expected
node <checkout>/node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler codex-type-diagnostic.ts
                                                                                                                 exit 2, expected
npm view zod@4.6.5 version license dependencies dist.integrity --json                                               exit 0
npm view react-markdown@10.1.0 version license dependencies dist.integrity --json                                   exit 0
```

Metadata matched both exact versions, MIT labels and lock integrity. No runtime dependencies were listed for Zod; react-markdown listed 11 direct dependencies. These were primary npm registry reads, not production adoption.

The first extra-diagnostic script used the absolute fixture path, then was made portable and rerun with the same six failures/two controls. Two file reads initially ran from the scratch directory instead of the clone and failed with missing-file errors; the reads were corrected and no repository file was changed. No failure was hidden or treated as an application gate pass.

No installed Mac, WebKit, VoiceOver, Windows app, real database, signing or live provider test ran. Full unchanged application/Rust matrices, schema/mutation/fake-adapter reruns and default-JIT counting were deliberately omitted. Their prior results remain attributed to Claude. The [correction prompt](../../CLAUDE_STRUCTURED_STUDY_IMPORT_CORRECTIONS_PROMPT_2026-10-03.md) assigns necessary new regressions and evidence to Claude.
