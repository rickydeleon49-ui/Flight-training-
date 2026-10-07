# Frozen pre-correction snapshot notice (added 6 October 2026, CRS-R1/R2 corrections)

The following files in this directory are **frozen pre-correction snapshots**, left byte-unchanged:

- `README.md`
- `results.json`
- `source-hashes.json`
- `SHA256SUMS`
- `receipts/proof-run.txt` (27/27, before corrections)
- `receipts/library-evidence.txt`
- `receipts/claim-checks.txt`

`SHA256SUMS` therefore no longer verifies three proof files that the corrections changed on purpose: `proof/contractModel.mjs`, `proof/proof.test.mjs` and `proof/package.json`. Their original bytes are preserved in two places:

- `../m2-card-review-scope-corrections-2026-10-06/frozen-pre-correction/proof/`
- the reviewer's frozen copy, `../m2-card-review-scope-review-2026-10-06/submitted/evidence/proof/`

The corrections added `proof/cardQuery.mjs` and `proof/corrections.test.mjs`.

**Current state:** see `../m2-card-review-scope-corrections-2026-10-06/README.md`, its `CURRENT_PROOF_SHA256SUMS` (rooted at `proof/`) and its corrected proof-run receipt. The `ts-fsrs` library research and its receipts are unchanged and still current.
