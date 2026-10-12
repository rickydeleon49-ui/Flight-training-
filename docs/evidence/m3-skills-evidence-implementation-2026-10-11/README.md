# M3 production implementation evidence

- `takeover-start-hashes.json`: submitted source identity before the takeover; original base 196b63f.
- `takeover-changes.json`: 14 source/test paths changed by the completing reviewer.
- `invariants.json`: immutable migration/dependency checks and accepted fixture matches.
- `completion/`: initial checks, truthful pre-fix failures and benchmark measurements. Its full frontend receipt fails on the confirmed pre-fix route regression; it is not the acceptance gate.
- `sensitivity/`: unchanged original 27/29 caught result.
- `sensitivity-final/`: strengthened cursor cases and 29 caught variants before the final UI additions.
- `sensitivity-current/`: authoritative final-source run; full raw logs, 14 controls passing and all 29 variants caught/restored.
- `final-gate/`: authoritative sequential full-source gate, command/cwd/output/exit receipts and raw summary. Its copies of baseline failures are evidence, not final failures.
- `source-hashes.json`: complete changed implementation/test/fixture path manifest (60 paths).
- `SHA256SUMS`: all files in this evidence package except the manifest itself, generated last.
- `scripts/`: reproducible sensitivity runner, original receipt helper and final-gate runner. The original shell receipt helper is historical and is not used to determine gate success; the final runner fails closed on subprocess nonzero exits.

All data is synthetic and disposable. Measurements are Node/native source tests, not installed WKWebView, VoiceOver or signed-release results. Do not execute test adapters against real app data. `sensitivity-current` and `final-gate` supersede their initial runs without deleting them.
