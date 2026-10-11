# Independent operator corrections re-review evidence — 10 October 2026

Decision: changes requested, MACV-R9–R11. See the top-level re-review and final correction assignment.

`submitted-hashes.json` freezes30 primary submission paths before review. Their exact bytes are under `submitted/`. `source-hashes.json` contains13 unchanged production anchors. The primary was not edited. Prior packs remain historical.

`receipts/checks.json` records exact command/cwd/exit for ten independently executed checks; stdout/stderr pairs preserve every outcome. New operator2-pass/2-fail and helper2-pass/3-fail diagnostics exit1. Positive prior suites all pass. Manifest24 and kit10 verify. Submitted7-mutation receipts are preserved, not independently rerun.

Run from a source checkout containing shipped migrations and the submitted helper/operator:
```
python3 docs/evidence/mac-schema13-operator-rereview-2026-10-10/operator-additional.py
/opt/homebrew/opt/node@22/bin/node docs/evidence/mac-schema13-operator-rereview-2026-10-10/helper-additional.mjs
```
These diagnostics reference the submitted files in the primary-equivalent checkout. The helper extracts unchanged function bodies to a scratch module and adds exports, as in the previous reviewer harness. The operator additional diagnostic runs the actual distributed script without rewriting it: environment probes reproduce the production test-override defect. After that override is removed, retain this as a production-entry refusal check and use a disclosed scratch-only adapter for positive run-binding/restoration cases. Do not expect the positive adapter controls to remain directly reachable in production. The old frozen operator adapter changes only its source locator. No actual hfdtest login/profile, GUI or installer was used. Every database/permission/copy mutation is to disposable reviewer-owned scratch, removed by its harness.

The5 newly failing assertions are evidence of remaining behavior, not suppressible CI flakes. Helpers/operators remain pending acceptance, and no physical G1–G3 result is claimed. Verify `SHA256SUMS` from this directory.
