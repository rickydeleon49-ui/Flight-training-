# Lesson brief review corrections BRIEF-R1/R2: receipts, 2026-10-17

Paths are relative to this directory. The reviewed head is b30af19; the corrections touch only `src/pages/Schedule/LessonBriefDialog.tsx` and its test file.

- `baseline/review-tests-on-b30af19.log/.exit`: the review's own `LessonBriefDialog.review.test.ts` on the unchanged head. 2 fail: the R1 carry-over and the R2 old-save notice.
- `baseline/new-regressions-on-b30af19.log/.exit`: the corrected permanent test file against the b30af19 dialog. The 5 new BRIEF-R1/R2 cases fail and the earlier 9 pass.
- `review-tests-on-fix.log/.exit`: the review's file on the fix, 11/11.
- `focused.log/.exit`: the Schedule, brief and P54-04 export suites, 53/53.
- `typecheck.log/.exit`: `tsc --noEmit`, exit 0.
- `node-version.txt`: the Node runtime used.

The review's test file was copied in for each run and removed afterwards; it is not committed. Earlier receipts in `../p54-05-lesson-brief-2026-10-17/` are unchanged.

`SHA256SUMS` covers every other file here. `git-blob-verification.json`, written after staging, records each member's hash read from its Git index blob.
