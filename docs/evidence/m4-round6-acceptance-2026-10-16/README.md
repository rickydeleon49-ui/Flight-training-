# M4 round6 independent acceptance receipts

Read the current `docs/M4_ROUND6_ACCEPTANCE_2026-10-16.md`. This integrates an evidence-only prototype and preserves author inputs; no application feature or dependency is adopted.

- `submitted-source-hashes.json`:709 original input hashes. `preservation.json` proves they remain unchanged in the dirty source worktree.
- `imported-paths.json`:704 M4 document/evidence paths imported byte-identically. All prior failures, partial runs, npm12 failure and generated synthetic fixtures remain.
- `submitted-root/` and `submitted-path-aliases.json`: five old root tracker/helper files archived without replacing current main. `submitted-final-hashes-rebased.txt` verifies the author's23 final references through those aliases; the original final-hashes receipt is unchanged.
- `replay.json`, `node22/`, `node26/`: independent full runner commands/exits, raw receipts and manifests from fresh accepted-main996b8ac clones. Node22 installs with npm10; Node26 reuses a real npm10 installation captured in that same clone. No npm12 success is claimed.
- `node*-assigned-five.log`, `node*-previous-four.log`, `node*-frozen-five.log`: unchanged review diagnostics pass on both lanes. `node*-reviewed-baseline.log`: assigned tests fail on prior specimens as expected. Direct unadapted frozen-five logs remain4/5 with exit1 and are not counted as passing.
- `full-runner-*`: actual failed-record, invented-mutant and recorded-signal probes all reject with exit1.
- `behavior-retention.json`:93 prior mapped names retained,11 additions; total104. All24 mutants execute and fail their regressions.

Current publication inventories bind actual current tracker/helper files separately from archived submission identities. Exact-path attributes preserve historical/raw output bytes and mark synthetic PDF fixtures binary; no source-code or global whitespace guard is weakened. No packages/node_modules, installers, databases, profiles or keys are included. Reviewer scratch clones and their install/cache data are removed after receipts are saved.
