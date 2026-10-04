# A2 third-review evidence — Windows, 3 October 2026

**Outcome: request R8/R9 corrections.** [Review](../../A2_THIRD_REVIEW_2026-10-03.md), [next implementer prompt](../../GEMINI_A2_R8_R9_CORRECTION_PROMPT_2026-10-03.md). Source stays local/uncommitted on `fix/atomic-study-material-saves`, base `533a8f50c2d0de74a75f5542022da3182f376ee9`. These files share evidence, not the absent A2 implementation or source acceptance.

## Contents and receipts

| File | Meaning |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Source/tool identity, exact test arguments and counts, limitations |
| [submitted-source-hashes.json](submitted-source-hashes.json) | All 24 implementer receipts matched actual owner files |
| [frontend-focused-and-regressions.txt](frontend-focused-and-regressions.txt) | 84 maintained tests + five unchanged reviewer diagnostics + four raw trigger controls pass; four public-trigger cases fail; 93 pass/four fail, 3.19 s |
| [prepared-diagnostics-windows.txt](prepared-diagnostics-windows.txt) | Complete 181-case shared package on real Windows engines: 179 pass/two AR-02 failures, no skips, 5.09 s |
| [omitted-column-regressions.txt](omitted-column-regressions.txt) | Four R9 cases fail; eight R8 cases deliberately excluded by the focused filter; 482 ms |
| [reported-filter-check.txt](reported-filter-check.txt) | Literal reported filter runs zero tests/33 skipped despite exit 0; 458 ms |
| [startup-sandbox-permission.txt](startup-sandbox-permission.txt) | First startup blocked by Vite-cache sandbox permission; no test body ran; retried with approved access |
| [a2ThirdReview.regression.test.ts](a2ThirdReview.regression.test.ts) | Final 12-case diagnostic: eight R8 cases (four controls/four failing driver tests) plus four failing R9 cases; outside maintained discovery |
| [documentation-release-safety.txt](documentation-release-safety.txt), [publication-validation.txt](publication-validation.txt) | Documentation-only publication gate: 51 existing release-safety tests pass, one deliberate availability skip; local links/JSON/credential scan and whitespace checked |

An isolated 307-file snapshot reused the owner's installed dependencies through a junction. No npm install, native build, full matrix, backend call, owner-data operation or implementation mutation was performed by this review. All 307 snapshotted owner files matched again afterwards. Logs contain only synthetic records and sanitized local paths (`<REVIEW_ROOT>`, `<OWNER_CHECKOUT>`). Log durations are test execution receipts, not performance/speedup claims.

The initial combined run used the eight-case R8 version of the new diagnostic. R9's four cases were added afterwards and tested with an exact filter; do not infer that its final 12-case file was all rerun together. The five original diagnostics were copied unchanged from [the second review](../../A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md). The 181-case package/helper came from main `30a67faab3db89d15f2a92b1e5a5ff534fa9e09c`, [shared preparation files](../mac-a2-preparation-2026-10-03/README.md); assertions/imports were unchanged, only checkout line endings were converted. All 57 conditional seams were reached and passed in this Windows execution.

## Reproduce only with matching local A2 source

This diagnostic is intentionally under docs. Main has no `saveMaterialAtomically`/connection-owner implementation yet, so running on main reports missing prerequisites rather than the reviewed failures. Use the existing owner's exact reviewed source in an isolated checkout/snapshot, install dependencies if absent, and copy only the diagnostic/helper files required. Restore/remove only those exact task copies afterwards.

The reviewer invoked `<OWNER_CHECKOUT>/node_modules/.bin/vitest.cmd` from `<REVIEW_ROOT>/snapshot`. Portable equivalents after copying the appropriate files into `src/data/`:

```text
npx --no-install vitest run src/data/a2ThirdReview.regression.test.ts --reporter=verbose
npx --no-install vitest run src/data/a2ReviewDiagnostics.mac.test.ts --reporter=verbose
```

The second command also requires the existing `a2DiagnosticObservations.ts` copied alongside the existing 181-case diagnostic. The first command on the reviewed bytes is expected to yield four passing controls/eight failures; that aggregate is a derived expectation, not an additional recorded run. Corrected source must pass with assertions preserved.

Mac preparation was already accepted as preparation. This Windows execution adds source evidence only: actual A2 execution on Mac, APFS/native files, installed application, signing, macOS 12 and release readiness remain unverified. Nothing here clears Slice B or release prerequisites.
