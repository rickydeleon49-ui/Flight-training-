# Codex Slice A completion-review evidence

Supports the [review](../../STRUCTURED_STUDY_IMPORT_SLICE_A_REVIEW_2026-10-03.md). SA1 is closed; SA2 documentation corrections are pending. Source is not published or accepted by this evidence.

- [Reviewed Gemini receipt](reviewed-gemini-final-hashes.txt): 92/92 hashes matched, excludes itself.
- [Independent all-93 snapshot](reviewed-all-93-hashes.txt): includes that receipt.
- [Original Gemini report](reviewed-gemini-implementation.md.txt) and [verification receipt](reviewed-gemini-verification-receipt.txt): verbatim reviewed diagnostic history; include the discrepancies identified in SA2.
- [Normal mutation results](codex-mutations.json) and [console](codex-mutations.log.txt): Codex-run control 231/exit 0, 22 expected outcomes, 19 caught/three neutralized, no infrastructure errors, CLI exit 0.
- [Actual CLI mismatch results](codex-cli-mismatch.json), [console](codex-cli-mismatch.log.txt) and [inert copied runner](codex-runner-mismatch.mjs.txt): one expectation changed (M10 neutralized → caught), control 231/exit 0, 21 expected/one unexpected, no infrastructure errors; actual CLI exit 1. Source untouched.

Scoped Node22 commands from the primary checkout:

```text
node scripts/run-slice-a-mutations.mjs --self-test . /private/tmp/hfd-slice-a-final-review-2026-10-03/codex-mutations.json
node /private/tmp/hfd-slice-a-final-review-2026-10-03/runner-mismatch.mjs /Users/rickymac/code/Flight-training- /private/tmp/hfd-slice-a-final-review-2026-10-03/codex-cli-mismatch.json
```

Each command's stdout/stderr was redirected to its owned scratch log without a pipeline; exits 0 and 1 were observed directly. Only M10's expectation differs in the copied runner. Generated scratch folders are removed by the runner.

Source/dist notice comparison matches `c497d9ea8d0a8fe60845a208370f698c457b94a0996fe131554955849cd7ba34`. `sw_vers -productVersion` reports host 27.0.1; SDK26.5 remains a separate selection. Tracked git diff --check passes. Existing 241-focused/16-native Codex results are prior interruption evidence; full 941-frontend/266-Rust results are Gemini-reported, not rerun here. No database/profile/installed/platform/provider test occurred.

Published console snapshots remove only terminal trailing whitespace; original raw logs remain in the owned scratch folder. Result JSON and reviewed Gemini report/receipts are copied verbatim.
