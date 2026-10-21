# HW-01b scratch mutation evidence

`prove_guards.py` copies source, migrations, fixtures and unchanged tests into a task-owned temporary directory. Dependencies, built frontend and legacy synthetic fixtures are reused read-only. It never edits worktree guards or test assertions. `scratch.patch` records the exact injected switches; `scratch.json` records original hashes. `restored.txt` confirms exact restoration and checks the worktree sources still equal their originals.

There are **25 targeted assertion-failure receipts**: 11 frontend (EXIT 1) and 14 native (EXIT 101). `results.json` also retains one native compilation setup failure from an omitted legacy synthetic fixture directory; it is **not** a successful mutation proof. The second scratch setup supplied that read-only directory and all 14 native checks then compiled and failed their targeted tests. The original key-order regression has its separate pre-fix receipt in `../red-key-order.log` (two assertion failures, one per TS engine).

Mutations and the behavior whose loss each test detects:

| Switch | Removed behavior |
| --- | --- |
| validator | Schema-20 validation (shared contract in all three engines; native tampered archive) |
| rollback | Operation transaction rollback on a mid-write refusal |
| retry | Original receipt replay before stale checks |
| conflict | Changed payload refusal for an existing operation ID |
| stale (native) | Assignment base-revision refusal with the STALE error |
| source (native) | Unchanged historical source exemption after FK nullification |
| reorder | Temporary position offset avoiding unique collisions |
| reopen | Appending the new cycle's history snapshot |
| empty | Nonempty requirement for aggregate completion |
| history | Append-only SQL triggers |
| upgrade | Migration 20 registration SQL |
| archive (native) | Schema-20 support at the backup validation ceiling |
| older (native) | Rejection above the older app's supported ceiling |
| skip-store (TS) | Startup persistence refusal while upgrading old bytes |
| persistence (TS) | Live-byte restoration after final persistence fails |

The archive mutation deliberately restores the older schema ceiling, so a schema-20 round-trip refuses. The older-app acceptance test uses the actual archive payload with the existing pre-install verifier's ceiling parameter; it does not build or run a historical app binary. These are source tests, not installed-app evidence. Normal final-tree suites rerun with no mutation environment.
