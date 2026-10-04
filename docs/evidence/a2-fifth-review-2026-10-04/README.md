# A2 fifth-review evidence — Windows, 4 October 2026

[Review](../../A2_FIFTH_REVIEW_2026-10-04.md) requests one R8 header-consumption correction. [Windows implementer prompt](../../GEMINI_A2_TRIGGER_HEADER_CORRECTION_PROMPT_2026-10-04.md). R9's submitted title-preservation fix passes.

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command arguments, measured counts, toolchain, scope and owner-preservation receipt |
| [submitted-source-hashes.json](submitted-source-hashes.json) | 24/24 submitted hashes independently matched |
| [frontend-review.txt](frontend-review.txt) | Combined run: 355 passed, 64 failed, ten files, no skips, 5.40 s, exit 1 |
| [a2FifthReview.regression.test.ts](a2FifthReview.regression.test.ts) | 72 cases: eight passing raw/public legality controls and 64 failing trailing-refusal combinations |

All data is synthetic. Paths are replaced by `<REVIEW_ROOT>` / `<OWNER_CHECKOUT>`. The isolated snapshot reused the installed dependency tree via a junction. The 64 failures represent one defect, not separate bugs. They prove the guard fails to refuse full SQL; they do not prove the appended transaction statement executes or native data is lost.

Prior diagnostic/helper files were copied unchanged from [third review](../a2-third-review-2026-10-03/README.md), [fourth review](../a2-fourth-review-2026-10-03/README.md) and the [accepted Mac preparation package](../mac-a2-preparation-2026-10-03/README.md). Their 12 + 14 + 181 cases pass on Windows, including all 57 conditional seams. Maintained focused files contribute 140 passing tests. No implementation was edited; the 307 owner files remain unchanged at review end. No expensive full/native matrix was repeated after reproducing the blocker.

Reproduce using the matching Windows-local A2 source and these hashes in an isolated snapshot. Copy the new diagnostic to `src/data/`, then run:

```text
npx --no-install vitest run src/data/a2FifthReview.regression.test.ts --reporter=verbose
```

Main still lacks accepted A2 production code; running the diagnostic against main's missing APIs is a prerequisite mismatch. Remove only the exact temporary file you copied, or deliberately promote its cases. These archived files sit outside `src/` and default test/build discovery. No actual Mac, installed app, private data or provider call was used. This publication does not accept source or clear platform/release gates.
