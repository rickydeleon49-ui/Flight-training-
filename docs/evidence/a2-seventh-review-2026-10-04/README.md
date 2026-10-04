# A2 seventh-review evidence — Windows, 4 October 2026

[Review](../../A2_SEVENTH_REVIEW_2026-10-04.md) and [next prompt](../../GEMINI_A2_BOM_PARAMETER_CORRECTION_PROMPT_2026-10-04.md).

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command, identities, counts and preservation receipt |
| [submitted-source-hashes.json](submitted-source-hashes.json) | 24/24 hashes and sizes match |
| [frontend-review.txt](frontend-review.txt) | Combined 891 pass / 50 fail, 12 files, no skips, 7.28 s, exit 1 |
| [a2SeventhReview.regression.test.ts](a2SeventhReview.regression.test.ts) | 68 deterministic engine/public cases: ten legality controls, eight direct BOM refusal failures, two acknowledged-write preservation failures, forty variable-suffix refusal failures and eight passing END suffix cases |

All 873 submitted focused checks pass, including 152 sixth-review, 98 older reviewer and 181 shared prepared cases (all 57 conditional seams reached). Prior copies/helpers were taken byte-for-byte from the [sixth-review isolated evidence](../a2-sixth-review-2026-10-04/README.md) and its linked historical packages. Owner's 307 files remain unchanged. Four-file delta is relative to sixth review.

To reproduce, use an isolated matching-source snapshot, copy this diagnostic into `src/data/`, and run `npx --no-install vitest run src/data/a2SeventhReview.regression.test.ts --reporter=verbose`. Remove only task-owned copies afterward. Main does not yet contain accepted A2 source; running against main directly is a prerequisite mismatch. Archived diagnostics are outside default application test discovery.

Synthetic data only, paths sanitized to <REVIEW_ROOT>/<OWNER_CHECKOUT>. BOM tests reproduce lost acknowledged rows specifically in development/test storage. Variable tests establish guard refusal gaps only. No native/installed/Mac loss demonstrated. Native unchanged, full matrix not repeated; implementer full-gate receipts were prose only.
