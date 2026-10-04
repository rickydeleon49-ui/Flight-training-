# A2 ninth-review evidence — Windows, 4 October 2026

[Review](../../A2_NINTH_REVIEW_2026-10-04.md) / [current correction prompt](../../GEMINI_A2_LINE_COMMENT_CORRECTION_PROMPT_2026-10-04.md).

| File | Evidence |
| --- | --- |
| [review-receipt.json](review-receipt.json) | Exact command, runtime, counts, identities and source preservation |
| [matched-source-hashes.json](matched-source-hashes.json) | All 24 handoff SHA-256 values/sizes independently matched to actual owner source |
| [frontend-review.txt](frontend-review.txt) | Combined 1,235 pass/70 fail, 14 files, no skips, exit 1, 10.05 s |
| [a2NinthReview.regression.test.ts](a2NinthReview.regression.test.ts) | 78 real-engine cases: eight controls pass, 64 guard failures, four false rejections, two actual acknowledged-write losses |

All 1,227 accumulated focused checks pass independently: maintained 656, earlier diagnostics 390 and shared 181/all 57 seams. Earlier diagnostic/helper files were copied unchanged from the [eighth-review snapshot package](../a2-eighth-review-2026-10-04/README.md) and its linked historical archives. Owner 307 files remained unchanged. Synthetic data only; machine paths sanitized.

Reproduce on an isolated snapshot of matching local A2 source: copy the diagnostic to `src/data/`, then `npx --no-install vitest run src/data/a2NinthReview.regression.test.ts --reporter=verbose`. Main lacks accepted A2 implementation; running directly against main is a prerequisite mismatch. Archived diagnostics are outside default discovery. Remove only exact task-owned copies.

R13 demonstrates actual owner-guard bypass and acknowledged write loss on both development/browser drivers; desktop Tauri does not use this scanner. No native/installed Mac/Windows data loss or readiness claim. Raw current implementer full-gate logs not supplied; no full/native gate repeated after this blocker. The handoff's claimed frontend/Rust/full-gate results remain reported evidence.
