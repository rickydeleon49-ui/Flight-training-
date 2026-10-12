# PR #143 independent review evidence

Reviewed head: 9fefcb538913f11bd9fcb74aefb4c603824c6d7d, base e8720003a76be680812dfe3605d58e7eb6372d00. Source merged as b178066eaf3d645c4541837629499e8cbf1515d9 after required CI succeeded.

- `source-hashes.json`: five reviewed source/test files, reverified against merged main.
- `focused.txt`: 10 current date regressions passing on Node 22.
- `old-screen-regression.txt`: unchanged submitted screen tests on a disposable tree with only the screen reverted to base, three failures with the installed malformed-date symptom.
- `old-screen-startup-failure.txt`: the prior sandbox Vite-cache startup refusal. This did not run tests and is not a product failure or meaningful sensitivity result. The authorized scratch retry generated the result above.
- `helper-node22.txt` / `helper-node26.txt`: 98/99 checks, same known schema-ceiling alarm, exit 1.
- `helper-baseline.txt` / `baseline-helper.mjs`: base version gives 85/86 with that same alarm. Run the archived helper's self-check from the current repository root to reproduce the bounded baseline.
- `metadata-key-probe.mjs` / `.txt`: temporary copy of reviewed helper plus a real SQLite special-key assertion. It exposes omitted `__proto__` (rowCount 1 / own keys empty), then removes the scratch key and preserves the original checks. Run `node <this-pack>/metadata-key-probe.mjs self-check` from the repo root. The expected failures are the named special-key assertion plus the historical ceiling anchor.
- `pr142-replay.txt`: original installed evidence still FAIL, with the exact original diff array. Inputs were read from immutable PR142 head 3abb69580b9748ecf964809be4f447bf161e834f; no original JSON was edited.
- `checks.json`: command/cwd/exit summary for the focused and dual-engine helper runs; supplementary checks have exact headers/exits in their own receipts.

All proof writes used disposable temporary databases/copies. No app launch, installed profile, permission change or installer action. Existing schema-13 snapshots remain strict; this evidence does not claim current-schema-14 physical verification. The helper clones here are archived review specimens, not distributed operator replacements. Raw receipts are preserved; SHA256SUMS is generated last.
