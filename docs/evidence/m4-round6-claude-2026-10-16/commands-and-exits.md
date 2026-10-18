# M4 round 6: raw commands and exits (16 October 2026)

`NODE22=/opt/homebrew/opt/node@22/bin/node` (v22.23.3, npm 10.9.9), `NODE26=/opt/homebrew/opt/node@26/bin/node` (v26.10.0, npm 12.2.0). `PACK=docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11`. `REVIEW` is the review evidence folder `docs/evidence/m4-round5-independent-review-2026-10-16/`, extracted unchanged from `origin/main` `671c9f4` into scratch (its `SHA256SUMS` verified). `REVIEW4` is the round-4 review evidence, extracted the same way.

## Before editing

| Command | Exit / result |
|---|---|
| `git fetch origin` | 0 |
| Hash every path in `REVIEW/submitted-all-hashes.json` against the worktree | 594 / 594 match |
| `shasum -a 256 -c SHA256SUMS` and `-c PAYLOAD_SHA256SUMS` in `PACK`; `-c SHA256SUMS` in `m4-round5-claude-2026-10-16` | 144, 141 and 81 entries, 0 failures |
| `NODE22 --test REVIEW/additional-diagnostics.test.mjs REVIEW/signal-diagnostic.test.mjs` (reviewer specimens) | exit 1, 0 pass / 5 fail |
| `M4_REVIEW_TARGET_PACK=$PWD/$PACK NODE22 --test` (same two files, starting pack) | exit 1, 0 / 5 |
| The same two runs with `NODE26` | exit 1, 0 / 5 each |

## After the corrections (worktree pack)

| Command | Exit / result |
|---|---|
| `M4_REVIEW_TARGET_PACK=$PWD/$PACK NODE22 --test REVIEW/additional-diagnostics.test.mjs REVIEW/signal-diagnostic.test.mjs` | exit 0, 5 / 5 |
| Same with `NODE26` | exit 0, 5 / 5 |
| `M4_REVIEW_TARGET_PACK=$PWD/$PACK NODE22/26 --test REVIEW4/remaining-diagnostics.test.mjs` | exit 0, 4 / 4 each |
| `M4_REVIEW_TARGET_PACK=docs/evidence/m4-round5-claude-2026-10-16/frozen-five-adapter NODE22/26 --test docs/evidence/m4-round3-senior-review-2026-10-11/diagnostics.test.mjs` | exit 0, 5 / 5 each |
| The same frozen five run directly on `PACK`, without the adapter | exit 1, 4 / 5 each (the R29 unreserved seed; disclosed, not a pass) |

## Lane 1: Node 22 (fresh worktree `r6lane22`)

| Command | Exit |
|---|---|
| `NODE22 $PACK/scripts/prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00` | 0 |
| `NODE22 $PACK/scripts/run_integration_proof.mjs --install` (PATH selects npm 10.9.9) | 0; 25 steps, 0 failures |

## Lane 2: Node 26 (fresh worktree `r6lane26`)

| Command | Exit |
|---|---|
| `NODE26 $PACK/scripts/prepare-accepted-main.mjs e8720003a76be680812dfe3605d58e7eb6372d00` | 0 |
| `NODE22 $PACK/scripts/run_integration_proof.mjs --engine-check-only --install` (npm 10.9.9) | 0 |
| `NODE26 $PACK/scripts/run_integration_proof.mjs` (no `--install`) | 0; 23 steps, 0 failures |

## Probes (lane 2 clone, after its receipts were saved; restored with `cmp` after each)

| Probe | Exit |
|---|---|
| Execution record `exit` set to 42, then `NODE26 run_integration_proof.mjs` | 1 |
| Fabricated NAVIGATION claim appended to the round-6 report, then `NODE26 run_integration_proof.mjs` | 1 |
| `NODE22` and `NODE26 --test --test-name-pattern="M4-R39" proof/proof.test.mjs` | 0, 2 / 2 each |

## Delivered pack (worktree)

| Command | Exit |
|---|---|
| `NODE22` and `NODE26 $PACK/scripts/run_integration_proof.mjs --verify-manifest-only` | 0 each |
| `NODE22` and `NODE26 $PACK/scripts/run_integration_proof.mjs --validate-claims-only` | 0 each |
