# Codex structured-import re-review evidence

Supports the [independent re-review](../../STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md). Original R1–R4 are resolved; R5 still requires correction. This evidence does not accept production adoption.

- [Correction receipt preserved](reviewed-correction-receipt.txt): all 128 hashes matched; receipt SHA-256 `ea0b0f79f8264c6fbcd22f73563f37b3a1913b3345886dae1c47e23ca867791d`.
- [Validator](codex-validator.json): 100/100, exit 0.
- [Permanent regressions](codex-regressions.json): 29/29, exit 0.
- [Original adapted diagnostic](codex-adapted.json): 8/8, exit 0.
- [Mutations](codex-mutations.json): 19/19 as expected; 16 caught, three neutralized, exit 0.
- [DTO positive log](dto-positive.txt): no errors, exit 0; [negative control](dto-negative.txt): two expected TS2322 errors, exit 2. The outer typecheck script exits 0 after confirming the positive and negative outcomes.
- [R5 assertions](codex-source-notes-diagnostics.json): two failures, four passing controls; exit 1 as expected.
- [R5 diagnostic source](codex-source-notes-diagnostics.mjs.txt): inert source, synthetic notes only.

Reproduction: reconstruct the submitted corrected `.txt` prototype into a disposable scratch folder, placing `validator.mjs` under `src/`, using unchanged helpers from `prototype/` and corrected runners from `prototype-corrected/`. Keep the exact locked dependency tree outside the repository. The submitted files remain local on `codex/structured-study-import-contract`, not included in this review-only publication.

Copy the R5 diagnostic to the scratch prototype root as `codex-source-notes-diagnostics.mjs`, create its `results/` folder, and run it with Node 22.23.3. It imports the reviewed validator at `./src/validator.mjs`, writes only synthetic result metadata under scratch results, and returns exit 1 while the two loss cases persist. The expected behavior allows rejection or actual preservation; silent loss fails. Four controls guard the existing valid combinations and standalone-empty behavior.

Actual Codex scratch: `/private/tmp/hfd-contract-rereview-i72v2tec`. The exact preceding review's package tree was reused through a read-only `node_modules` symlink. Repository dependencies were not installed or modified. The DTO script generated nine values from actual prototype results and imported the unchanged domain types through its path alias.

Commands from scratch `prototype/`, with `<evidence>` the absolute submitted contract evidence directory:

```text
node run-fixtures.mjs <evidence>/fixtures <evidence>/expected-outcomes.json results/codex-validator.json    exit 0
node run-regressions.mjs results/codex-regressions.json                                                   exit 0
node run-codex-diagnostics-adapted.mjs <evidence>/fixtures results/codex-adapted.json                        exit 0
node run-mutations.mjs <evidence>/fixtures <evidence>/expected-outcomes.json results/codex-mutations.json  exit 0
node codex-source-notes-diagnostics.mjs                                                                  exit 1, expected
```

From scratch `dto-check/`:

```text
HFD_CHECKOUT=<checkout> HFD_PROTO=<scratch-prototype> ./run-dto-check.sh
written 9 typed values
positive (DTOs + actual prototype output) exit=0
negative (reviewed Omit types, expected to fail) exit=2
outer script exit=0
```

The initial source-notes probe separately confirmed the accepted packet contains notes in preview, no study-set payload, and no discarded-notes disclosure. The six-case diagnostic then recorded the two failures/four controls above. A file read initially looked for `tsconfig.app.json`; this repository uses `tsconfig.json`, which was subsequently inspected. No file was changed by that failed read.

No unchanged renderer/CSP/schema/API/capability/fake-adapter rerun or full application/Rust matrix ran. No real SQLite/sql.js, installed app, macOS 12, WebKit, VoiceOver, Windows app, signing or provider check ran. Claude's aggregate-runner self-test remains Claude-reported; the exit-propagation code was inspected.
