# M4 round 5 (Claude): supporting evidence

The supporting evidence for [the round-5 report](../../M4_DOCUMENT_NAVIGATION_ROUND5_CORRECTIONS_REPORT_2026-10-16.md). `SHA256SUMS` in this folder seals every file here.

| Path | What it is |
|---|---|
| `baselines/` | Recorded before any edit:<br>- the review's four new diagnostics on the reviewed specimens, 0 of 4 on each Node version;<br>- the frozen five on the pack as it stood, 5 of 5. |
| `after-corrections/` | The same diagnostics against the corrected pack:<br>- the review's four: 4 of 4;<br>- the frozen five through the fixture-binding adapter: 5 of 5;<br>- the frozen five directly: 4 of 5, because the corrected protocol refuses an unreserved seed. |
| `frozen-five-adapter/` | The documented fixture-binding adapter. It changes seeding only and leaves the frozen diagnostics unedited. |
| `fault-checks-of-new-tests.txt` | Each new runner test, shown to catch a deliberately broken runner or checker. |
| `lane-node22/`, `lane-node26/`, `lane-results.md` | The two clean lanes. |
| `end-to-end-probes/` | The failed-install-metadata and fabricated NAVIGATION-claim probes, both exiting 1. |
