# A2 second-review focused evidence

Published 2 October 2026. Source was the uncommitted A2 snapshot based on `533a8f5`. Windows-specific paths in logs are redacted; test names, assertions, counts and timings are preserved. No real application data or credentials were used.

- [New diagnostic failures](reviewer-edge-regressions.txt): 5 failed, exit 1.
- [Frontend focused suite](frontend-focused.txt): 67 passed, exit 0.
- [Original native failures now passing](native-original-review-regressions.txt): 4 passed, exit 0.
- [Native save suite](native-save-tests.txt): 21 passed, exit 0; case-sensitive volume test returned early on NTFS.
- [Before-review hashes](handoff-hash-verification.json) and [after-review hashes](after-review-hash-verification.json): 10/10 matched.

See [review details](../../A2_SECOND_REVIEW_DETAILS_2026-10-02.md). The independent review inspected the implementer's successful full-matrix logs; their aggregate counts are in the review. Those raw complete logs were not copied here. The focused failures do not establish a corresponding native desktop failure.
