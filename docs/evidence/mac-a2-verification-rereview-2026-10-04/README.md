# Mac A2 correction re-review evidence — 4 October 2026

These are independent review receipts, not installed-app evidence. The implementer checkout and all 29 submitted artifacts remain unchanged. `submitted-artifact-hashes.json` verifies all 29 handoff hashes and separately freezes 15 ignored original logs. `observations.json` records source identities, the independently executed host native suite, and new-file whitespace diagnostics.

The six `submitted-*` test/preflight receipts are byte-identical copies of the implementer files. `submitted-test-diff.json` losslessly stores the reviewed 83-line test-only addition as a JSON string; no production change was made. The host suite independently passed 21 harness cases, including the new case-alias regression, with one explicit distinct-case early return (20 exercised). Formatting and tracked whitespace passed. No full matrix, mounted image, installed app, real profile, provider call, signing or release was executed by Codex.

The implementer's case-sensitive receipts are inspected evidence: 21 harness passes include one explicit Mac case-alias capability early return, while distinct-case coverage executes. They are not independent reviewer image executions. Six other publishable historical `.txt` copies have extra blank lines at EOF; original ignored `.log` files must remain untouched during publication cleanup.
