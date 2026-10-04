# A2 eighth-review evidence — Windows, 4 October 2026

[Review](../../A2_EIGHTH_REVIEW_2026-10-04.md) / [correction prompt](../../GEMINI_A2_TRIGGER_TOKEN_ROLE_CORRECTION_PROMPT_2026-10-04.md).

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command, counts, identities and owner preservation |
| [observed-source-hashes.json](observed-source-hashes.json) | Current observed 24-file hashes/sizes; no new implementer expected-hash manifest was supplied |
| [frontend-review.txt](frontend-review.txt) | Combined 1,043 pass/64 fail, 13 files, no skips, 15.50 s, exit 1 |
| [a2EighthReview.regression.test.ts](a2EighthReview.regression.test.ts) | 72 cases: eight raw/public firing controls; two trigger forms × eight transaction suffixes × two routes × two engines =64 refusal failures |

All previously reported 1,035 focused checks pass independently: maintained 536, previous diagnostics 318, shared 181/all 57 conditional seams. Historical diagnostic/helpers were copied byte-for-byte from the [seventh-review snapshot package](../a2-seventh-review-2026-10-04/README.md) and its linked earlier archives. Native/R9 unchanged. Owner's 307 files unchanged; four-file delta versus seventh review. Synthetic data only; machine paths sanitized.

Reproduce on an isolated snapshot of matching local A2 source: copy the diagnostic to `src/data/`, then run `npx --no-install vitest run src/data/a2EighthReview.regression.test.ts --reporter=verbose`. Main still lacks accepted A2 source; direct main execution is a prerequisite mismatch. Archived diagnostics are outside default test discovery. Remove only exact task-owned temporary copies.

No appended transaction execution, new row loss or native desktop issue demonstrated. Earlier direct-BOM acknowledged-write reproductions now pass. No current raw full-gate logs supplied, no full/native gate repeated after blockers, no installer/Mac/API readiness claimed.
