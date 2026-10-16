# M4 round 6 (Claude): supporting evidence

The supporting evidence for [the round-6 report](../../M4_DOCUMENT_NAVIGATION_ROUND6_CORRECTIONS_REPORT_2026-10-16.md). `SHA256SUMS` in this folder seals every file here.

| Path | What it is |
|---|---|
| `baselines/` | The review's five new assertions before any edit: 0 of 5 on each Node version, against the reviewer's specimens and against the starting pack. |
| `after-corrections/` | The same five against the corrected pack, 5 of 5. Also:<br>- the previous four, 4 of 4;<br>- the frozen five through the round-5 fixture adapter, 5 of 5;<br>- the frozen five directly, 4 of 5, disclosed and not a pass. |
| `fault-checks-of-new-tests.txt` | New tests shown to catch a deliberately broken runner and controller. |
| `commands-and-exits.md` | Every command and its exit code. |
| `lane-node22/`, `lane-node26/`, `lane-results.md` | The two clean lanes. |
| `end-to-end-probes/` | The failed-record, fabricated-mutant and signal probes. |
| `final-hashes.txt` | The final source and evidence hashes. |
