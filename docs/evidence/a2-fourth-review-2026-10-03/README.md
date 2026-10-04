# A2 fourth-review evidence — Windows, 3 October 2026

**Decision: request two narrow corrections to R8/R9.** [Review](../../A2_FOURTH_REVIEW_2026-10-03.md), [next Windows prompt](../../GEMINI_A2_FINAL_EDGE_CORRECTIONS_PROMPT_2026-10-03.md).

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command arguments, source/toolchain identities and subset counts |
| [submitted-source-hashes.json](submitted-source-hashes.json) | All 24 submitted hashes matched; the owner's 307-file snapshot was unchanged at review end |
| [frontend-review.txt](frontend-review.txt) | One combined run: 291 passed/eight failed, nine files, no skips, 5.69 s, exit 1 |
| [a2FourthReview.regression.test.ts](a2FourthReview.regression.test.ts) | 14 cases: six passing raw-engine trigger controls, six failing public-trigger identifier cases and two failing notes-only/omitted-title cases |

The combined run also independently passed the six maintained focused files (**92 tests**), all previous third-review cases (**12 tests**) and the shared prepared suite (**181 tests**, all **57 conditional seams** reached). No source assertion was weakened. The prior diagnostic/helper files were copied from main's [third-review evidence](../a2-third-review-2026-10-03/README.md) and [Mac preparation package](../mac-a2-preparation-2026-10-03/README.md) into the isolated snapshot. The new file is deliberately under docs, outside `src/**/*.test.ts` and the application build.

All data was synthetic. Local paths are replaced by `<REVIEW_ROOT>` and `<OWNER_CHECKOUT>`; no real profile, database, PDF, credential or provider call was used. The snapshot reused the installed dependency tree via a junction. No implementation was changed, no full matrix was repeated after the focused failures, and no native/Mac/installed run is claimed. Durations are test receipts, not speedup measurements.

To reproduce, use the matching Windows-local A2 source (base `533a8f50c2d0de74a75f5542022da3182f376ee9` plus the hashes in this folder) in an isolated task snapshot, copy only the new diagnostic to `src/data/`, and run:

```text
npx --no-install vitest run src/data/a2FourthReview.regression.test.ts --reporter=verbose
```

Main still lacks the A2 implementation, so missing APIs on main are a prerequisite mismatch. Remove only the exact temporary file you copied, or promote its cases into maintained tests intentionally. The combined command, including the existing preparation helper prerequisite, is recorded in `review-receipt.json`.

The next corrected source must pass with the assertions intact and then complete the required local gate. This evidence publication does not accept A2 or clear Mac, Slice B, installed or release gates.
