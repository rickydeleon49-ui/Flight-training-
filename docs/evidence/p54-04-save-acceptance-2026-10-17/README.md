# P54-04 save correction acceptance receipts (2026-10-17)

These receipts are for the reviewed head 27c3971. Paths are relative to this directory.

- `focused-frontend.log/.exit`: the four focused export test files, 36/36.
- `native-study-export.log/.exit`: `cargo test --locked --lib study_export`, 13/13.
- `typecheck.log/.exit` and `build.log/.exit`: `tsc --noEmit` and the Vite production build.
- `regressions-on-original-a490dac.log/.exit`: the correction's tests run against the original PR193 dialog, where 2 fail as intended. The reviewed file was restored afterwards and its hash re-checked.
- `review-dispatched-bytes.test.fragment.ts` and `review-test.log/.exit`: the review-only check, appended to a disposable copy of the dialog test file, which was then removed. 12/12 pass.
- `node-version.txt`: the Node runtime used.

`SHA256SUMS` covers every other file here. `git-blob-verification.json`, written after staging, records each member's hash read from its Git index blob.
