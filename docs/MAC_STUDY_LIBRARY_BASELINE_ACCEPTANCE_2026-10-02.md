# Independent acceptance — Mac Study Library baseline R1–R3

**Codex accepts the corrected source and evidence for the bounded benchmark task. No remaining blocker was found in R1–R3.** Required GitHub checks on the final PR head remain the publication/merge gate. This accepts a measurement harness, not a production optimization, installer or macOS 12 runtime claim.

Claude implemented in the primary Mac clone on `codex/mac-study-library-baseline`, from main `a4339fc720d8eac0f038402687e30233de141436`, leaving everything uncommitted for review. Codex reviewed the actual source, committed it as `f20807e`, and incorporated the documentation branch from PR #44 without changing the four tested source files. The historical first review and first benchmark remain available alongside the corrections.

## R1–R3 acceptance

| Finding | Independently reviewed result |
| --- | --- |
| R1: intermediate result validation | The intended view and limit are planned before execution. All controls, total and exact displayed IDs/order are checked after each measured step, including warm-ups, before keeping its sample. Reset/setup checks and final analytic counts remain outside timing. Both transient ID and count faults at `airspace c` are rejected at the affected step; the maintained final-state negative control also passes. |
| R2: displayed-card scope | The real page and harness agree that each Show more adds 100. A maintained test reaches 1,000 cards through nine verified events, then verifies that a query returns the display to 100. Corrected evidence records each displayed count separately. The report now identifies expanded rendering as an unresolved measured cost and does not infer a package requirement from Node timings. |
| R3: equivalent compute workload | Every event records its step index, query/filter/sort view and limit. Its wall, React and compute results each have five samples for that view. Compute uses the loaded records, labelled filter replica and production sort, checked against the fixture oracle. This is a separately warmed compute measurement, not a candidate comparison or a causal allocation of wall time. |

No production component, SQL driver, migration, dependency, lockfile or build configuration was changed. The three new modules are imported by tests only. Fixtures use disposable in-memory SQLite and mocked file status; no app profile or installed app was used.

## Verification and source identity

Codex independently ran:

- `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/perf/studyLibraryScenarios.test.ts`: exit 0, **8 passed**, 14.53 seconds, including the three negative controls and expanded-display regression.
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build`: exit 0; TypeScript check and production build passed (Vite build 608 ms).
- Receipt inspection: corrected shared JSON equals the retained original JSON; source and evidence hashes match Claude's report. Every recorded step has five samples per metric, five render counts and zero database calls. All 16 typed prefixes have distinct step identities. Expanded displayed counts are 200 through 1,000. At the 100-material tier, all three Show more/expanded scenarios are correctly skipped.
- Whitespace/newline checks cover the new files, and `git diff --check` passes. The shared evidence contains synthetic data and no local user paths or credentials.

Codex inspected Claude's exact corrected-run logs: **602 frontend passed / 4 skipped**, build passed, **246 Rust passed / 6 ignored**, formatting, strict Clippy, Cargo-lock synchronization and diff checks passed. Claude's opt-in benchmark passed in 275.28 seconds. Codex did not repeat that unchanged benchmark or the complete native/frontend matrix; these remain explicitly implementer-run results. [Sanitized implementer receipts](evidence/mac-study-baseline-2026-10-02/README.md).

```text
aa1b6d6d827df7d2e7e21d5c4b1b73ddfcda30984d7c79ef884cd443d7c2950e  src/perf/appResponsiveness.bench.test.ts
91cffef1140c34fa64d185f0af7e9250fcd3a91211756b0f0413fb61c41cc788  src/perf/studyLibraryFixture.ts
2af0e3afb8da4d0da001b3dbfaf62e2d7b2412276085f5471e6b61f5a3626598  src/perf/studyLibraryHarness.ts
86f6100a1e60ab637dc627038fb255200c7c14c35e6e42d20596970e5010fabe  src/perf/studyLibraryScenarios.test.ts
d41c541e9eba1bdbbddb319c6f6367d70a5931523525228f80ffe422d6994791  docs/evidence/mac-study-baseline-2026-10-02/results-r1r3.min.json
9789b43937997236bf89eb7bb66b8d82d367ba62203e2e8c0816017028909ea6  docs/evidence/mac-study-baseline-2026-10-02/local-gate-summary-r1r3.txt
```

Local reviewer logs are ignored under `.smoke/mac-study-baseline/codex-r1r3-focused.log` and `codex-r1r3-build.log`; the sanitized observations above are the shared reviewer receipt.

## Decision and next task

MiniSearch remains unjustified for the measured workload. No TanStack Virtual adoption is assigned. Expanded rendering reaches about 97 ms per click at 1,000 cards in jsdom and remains a question for installed evidence and a fair comparison with a dependency-free option. The marginal 200-card React and final-keystroke target misses are retained, not relabelled as passes. Displays above 1,000, scrolling, focus and expanded edits remain unmeasured.

[Claude's next Mac prompt](CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md) assigns the independent A3 source-compatibility correction after this PR merges. A2 remains with its Windows owner and is still unavailable on main; do not reconstruct it. Installed measurement remains pending the dedicated standard account and acceptable signing state. macOS 12, Windows runtime, offline corrections A4/A6, the M1 check-in and release holds remain open.

The publication PR incorporates PR #44's Mac evidence, review history and prompts together with this accepted baseline. Check current main and the PR's merge status before starting the next branch; this dated acceptance does not claim merge completion in advance.
