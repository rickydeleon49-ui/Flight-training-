# GEN-REL-02 evidence

Base main 36c5d48. Node 22.23.3, with `SDKROOT` set to the MacOSX26.5 SDK for cargo. Synthetic data only: no app launch, provider call, key or profile.

## Gate (`gate/`)

| Step | Result | Exit |
| --- | --- | --- |
| 01 typecheck | clean | 0 |
| 02 `npm test` | 3,659 passed, 6 skipped | 0 |
| 02a first `npm test` run (kept) | 1 failed: `DocumentPagesPanel.test.ts`, "opening a saved A bookmark must not silently target replacement B" (`findByText("This PDF has 50 pages.")` past its 1,000 ms wait) | 1 |
| 03 build | built | 0 |
| 04 `cargo test --locked` | 600 passed, 6 ignored | 0 |
| 05 strict Clippy, 06 fmt, 07 cargo-lock | clean | 0 |
| 08 schema-14 helper | 26/26 | 0 |
| 09 `git diff --check`; 10 migrations, checksums, manifests, locks and tauri.conf vs 36c5d48 | clean; unchanged | 0 |

## Classification of 02a

The same wait in the same file failed once in GEN-REL-01's first CI run, in a different test. This is a timing failure in an existing test, not caused by GEN-REL-02:

- In a detached worktree of main before GEN-REL-01 (45b4e2a), the full suite ran three times on each tree: 3/3 green on both.
- The two affected tests' durations over five runs were the same on both trees: 156–161 ms and 134–141 ms on this branch, and 155–161 ms and 135–140 ms on 45b4e2a.
- GEN-REL-02 does not touch the navigation panel or its "Check pages" flow.

It is left for a separate, narrowly evidenced fix rather than a timeout change inside this item.
