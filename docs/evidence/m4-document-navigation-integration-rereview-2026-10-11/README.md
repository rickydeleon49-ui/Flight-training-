# M4 preparation integration review evidence

Corrections required: R9–R12. Thirty-two latest submitted paths frozen, not accepted production source. Base c28ab8482c8635b0b2bf74686b081e02bf448f65; publication baseline75f9f9300d3f219b3870ef98699641f3d36b7138.

- `submitted/` and `submitted-hashes.json`:32 latest paths. node_modules/temporary databases excluded.
- `freeze-verification.json`: current28, previous40, first29, old evaluation21 checksums; archived originals6/6 exact.
- `submitted-node26.txt`:22 pass, exit0; `submitted-tests.txt`: Node22.23.3,21 pass/1 fail, exit1 with PDF.js worker Promise.try unhandled rejection. Disclosed scratch runtime limitation; no application failure inferred.
- `historical-current.test.mjs` / `.txt`: latest-contract import-location adapter,10 pass/exit0.
- `prior-original.test.mjs`, `prior-current.test.mjs`, `prior-import-adapter.diff`, `prior-current.txt`: previous frozen test assertions with module/fixture-location-only changes,14 pass/1 old scanner assertion fail. The old scanner comes from the immutable previous review archive. Current PDF.js proof legitimately supersedes it; do not reopen that scanner.
- `diagnostics.test.mjs` / `.txt`: latest actual helpers and SQLite writes,14 assertion failures/2 controls, exit1. Six coordinate, four persistence and four opener integration cases. Migration loading uses the recorded shipped1–13 base; run from repository root.
- `scratch-engine-identities.json`: reviewer-observed installed engine/worker/package hashes. This is not the implementer's requested complete artifact/license audit. Existing scratch installation remains unmodified.
- `checks.json`: actual runtime, commands, exits/counts. `final-invariants.json`:32/32 recheck, tracked production/shared tracking diff empty, no subject writes.

Replay from repository root with Node22 `--test --test-reporter=tap docs/evidence/m4-document-navigation-integration-rereview-2026-10-11/diagnostics.test.mjs`. The frozen archive omits unchanged production migrations; read-only tests load shipped1–13 from the repository. To replay submitted parser suite, use a disposable base checkout with archived submitted docs copied in and exact scratch dependencies installed under the archived scratch package location; declare Node26.10.0 and retain Node22 limitations. Do not run receipt-writing runners in the subject dirty checkout.

SHA256SUMS covers every pack file except itself, including nested submitted manifests. Immutable raw receipts and PDF xref whitespace are preserved.
