# Codex independent structured-import acceptance evidence

Supports the [acceptance](../../STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md), which closes R1–R5 for the preparation package. Production adoption, real database and installed-app evidence remain gated.

- [Validator](codex-validator.json): 106/106 pass.
- [Permanent regressions](codex-regressions.json): 41/41 pass.
- [Original diagnostics](codex-adapted.json): 8/8 pass.
- [Source-notes diagnostics](codex-source-notes.json): 6/6 pass.
- [Mutations](codex-mutations.json): 22/22 as expected, 19 caught/three neutralized, exit 0.
- [DTO positive log](dto-positive.txt): nine generated typed values compile, exit 0. [Negative log](dto-negative.txt): two expected TS2322 errors, exit 2. Outer script exit 0.

Codex reconstructed the submitted inert sources in `/private/tmp/hfd-contract-acceptance-ld97nqpl` by overlaying `prototype/`, `prototype-corrected/`, then `prototype-r5/`. The exact locked dependency tree from the preceding review was reused read-only through a node_modules symlink. Node 22.23.3 and the repository's existing TypeScript binary were used. No production dependencies were installed or changed.

Commands from scratch `prototype/`, with `<evidence>` the absolute submitted contract evidence folder:

```text
node run-fixtures.mjs <evidence>/fixtures <evidence>/expected-outcomes.json results/codex-validator.json
node run-regressions.mjs results/codex-regressions.json
node run-codex-diagnostics-adapted.mjs <evidence>/fixtures results/codex-adapted.json
node run-codex-source-notes-adapted.mjs results/codex-source-notes.json
node run-mutations.mjs <evidence>/fixtures <evidence>/expected-outcomes.json results/codex-mutations.json
```

All result summaries report zero failures; the mutation runner exits 0 with 22 expected outcomes. The fixture command wrote its console output to a scratch log; the saved result verifies all 106 assertions passed. From scratch `dto-check/`, `HFD_CHECKOUT=<checkout> HFD_PROTO=<scratch-prototype> ./run-dto-check.sh` exits 0 after verifying the positive and expected negative outcomes.

All 160 submitted R5 hashes matched before acceptance annotations. The original [R5 receipt](../structured-study-import-contract-2026-10-03/r5-receipt-2026-10-03.txt) remains byte-identical, SHA-256 `6e29c21e27155c7dc4263937390c90e4b3be4a6dcd332dcf7c9f7afa3cec083b`. Codex changes current acceptance/status wording and records final publication hashes separately; the prototype/test/fixture and historical result bytes are preserved.

Renderer/depth/API/capability checks and full application/Rust matrices were unchanged and deliberately not repeated. Claude's schema, fake-adapter, CSP and aggregate-runner self-test remain Claude-reported. No SQLite/sql.js, installed WebKit, macOS 12, Windows app, VoiceOver, signing or provider check ran.
