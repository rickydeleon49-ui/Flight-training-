# Local v0.5.4 QA-01 / QA-02 follow-up evidence — 15 October 2026

Evidence for [the reviewer handoff](../../MAC_LOCAL_V054_QA_FOLLOWUP_HANDOFF_2026-10-15.md). `receipts.json` holds the exact argv, environment, exit codes, counts, mutation results, check-only commit SHAs and cleanup facts. `submission-manifest.json` lists the SHA-256 and size of every changed or new submitted file. `SHA256SUMS` covers this folder.

| File | What it is |
|---|---|
| `qa01-helper-before.txt` | Original failure on the real build tree: helper tests 22/23 |
| `qa01-new-tests-before-fix.txt` | The new QA-01 tests and walker scenarios failing on the unchanged recognizer |
| `qa02-recipe-before.stderr.txt` | The literal RUNBOOK recipe refusing `fee7869` at the raw lock assertion |
| `replay-check-commit.json` | RUNBOOK §7 replay of the new bytes (check-only commit `c2c33c8`): PASS, 12/12 |
| `replay-negative-integrity.stderr.txt`, `replay-negative-root-version.stderr.txt` | Tampered locks refused before any worktree |
| `replay-fee7869.stderr.txt` | Pre-QA-02 commit with a differing lock still refused |
| `replay-f2a7090.json` | Accepted helper commit still replays: PASS, 12/12 |
| `helper-tests-final.txt`, `vitest-focused.txt`, `npm-test.txt`, `typecheck.txt`, `cargo-lock.txt` | Final checks |

Source-only synthetic evidence. Nothing here certifies an installed app, signing or publication.
