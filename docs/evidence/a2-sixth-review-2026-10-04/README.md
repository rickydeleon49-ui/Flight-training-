# A2 sixth-review evidence — Windows, 4 October 2026

[Review](../../A2_SIXTH_REVIEW_2026-10-04.md): the submitted header correction passes; one whole-token scanner defect (R10) remains. [Windows correction prompt](../../GEMINI_A2_WHOLE_TOKEN_CORRECTION_PROMPT_2026-10-04.md).

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command, measured subset counts, identities and owner-preservation receipt |
| [submitted-source-hashes.json](submitted-source-hashes.json) | All 24 submitted hashes matched |
| [frontend-review.txt](frontend-review.txt) | One combined run: 573 pass/136 fail, eleven files, no skips, 5.70 s, exit 1 |
| [a2SixthReview.regression.test.ts](a2SixthReview.regression.test.ts) | 152 cases: 16 passing raw/public controls, 128 trigger refusal failures and eight ordinary-SELECT refusal failures |

All data is synthetic; local paths are replaced by `<REVIEW_ROOT>` / `<OWNER_CHECKOUT>`. No production source was changed. The isolated 307-file snapshot used a dependency junction; all owner files remain unchanged at review end. Native source/fixtures are unchanged and not rerun. The full matrix described in the implementer's handoff is reported evidence; no physical Mac or installed execution is claimed.

The combined run independently passes all **557 submitted focused cases**: six maintained files (278), prior diagnostics (12 + 14 + 72), and the shared prepared package (181, all 57 conditional seams reached). The failures are combinations of one lexical defect, not 136 independent issues or proof of executed trailing controls/native data loss.

Prior diagnostic/helpers were copied byte-for-byte from [third review](../a2-third-review-2026-10-03/README.md), [fourth review](../a2-fourth-review-2026-10-03/README.md), [fifth review](../a2-fifth-review-2026-10-04/README.md) and [Mac preparation](../mac-a2-preparation-2026-10-03/README.md). Keep all those assertions intact.

Reproduce in an isolated snapshot with matching local A2 source and these hashes. Copy only the new diagnostic into `src/data/`, then run:

```text
npx --no-install vitest run src/data/a2SixthReview.regression.test.ts --reporter=verbose
```

Main lacks accepted A2 source; missing APIs on main mean a prerequisite mismatch. Remove only exact task-owned temporary copies or promote them deliberately. These archived files are outside app/default test discovery. Source, Mac, Slice B and release gates remain held.
