# A2 tenth-review evidence — Windows, 4 October 2026

[Review](../../A2_TENTH_REVIEW_2026-10-04.md) / [current implementation prompt](../../GEMINI_A2_LATEST_MAIN_INTEGRATION_PROMPT_2026-10-04.md).

| File | Meaning |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact source identities, runtime, counts and unverified boundaries |
| [matched-source-hashes.json](matched-source-hashes.json) | All 24 supplied owner hashes/sizes independently matched |
| [frontend-review.txt](frontend-review.txt) | Independent 14-file/2,085-pass owner-source focused run, exit 0, 20.99 s |
| [latest-main-integration.txt](latest-main-integration.txt) | Current main+A2 fixture/scenario probe: three pass/five fail, exit 1, 1.79 s |
| [latest-main-startup-environment.txt](latest-main-startup-environment.txt) | Prior environment failure before test collection; junction then corrected |

The [implementer package](../a2-r13-line-comment-2026-10-04/README.md) supplies actual baseline/postfix/sensitivity/cumulative and all nine full-gate logs. Those 15 log files were explicitly included despite generic .log ignores, with synthetic data and sanitized paths; no app source patch was published. The owner has 311 git-listed files, all unchanged after review; its 24-file manifest matched. Full raw logs were inspected but the native/full matrix was not independently rerun after the current-main focused failure.

Historical diagnostics/helpers were copied unchanged from the [ninth-review package](../a2-ninth-review-2026-10-04/README.md) and its earlier linked archives. The 780 new R13 cases are maintained in the owner driver tests. All 57 conditional seam assertions passed. The local 900-file main integration snapshot includes only two mechanical conflict resolutions and still has the incompatible fixture helper; no integration correction implemented/committed/pushed. Coordinator temporary application changes restored only after exact byte preservation; owner unchanged.

R13 actual write-loss tests now pass. R14 is a current-main fixture compatibility defect, not native/installed app loss. TEMP schema loss remains an existing sql.js development-only limitation. Mac A2, Slice B and release holds persist. No installed Mac/Windows/APFS/WKWebView/live API evidence claimed.
