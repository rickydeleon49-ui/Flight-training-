# Mac Study Library baseline review — 2 October 2026

Current follow-up: [R1–R3 baseline corrections accepted](MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md). This document preserves the earlier assignment/review snapshot; [the next Claude prompt is A3 compatibility](CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md), after the publication PR merges.

**Decision: corrections required; baseline implementation is not accepted for commit/PR/merge yet.** This is a benchmark/evidence review. No production application failure or new dependency requirement was established.

Reviewer: Codex. Implementer: Claude, Mac clone. Reviewed branch `codex/mac-study-library-baseline`, base `a4339fc720d8eac0f038402687e30233de141436`, uncommitted. The reviewed source is local to this Mac, not present on main or a GitHub implementation branch. Publishing this review does not publish or accept that source.

## Confirmed findings

### R1 — P2: intermediate measured search results can be wrong without rejecting the run

`src/perf/studyLibraryHarness.ts:303–321` records every measured keystroke, but calls `verify` only after the complete sequence. The narrowing scenario produces 80 wall samples over five repeats; the final result is checked five times. A transient wrong count or ID/order that resolves by the last query passes, contrary to the report's claim that every timed result is verified.

Independent negative control injected a wrong first-card ID at query `airspace c`, observed that wrong rendered ID, restored it before the next keystroke, and asserted the run must reject. The harness instead resolved successfully. The reviewer fault was deterministic and did not change production code.

Required correction: verify each post-step view/count/IDs/order outside its timed region before retaining its sample. Keep final analytic counts appropriately scoped. Check all intended controls and progressive shown limits. Maintain a negative control that proves an intermediate-only mismatch is refused, even when final results are correct.

### R2 — P2: the virtualization conclusion extrapolates beyond the measured rendered counts

`docs/MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md:113` describes at most 100 rendered cards; line 198 treats rendering as bounded by the progressive page and a cost that does not scale. The actual page increments the displayed limit by 100 on every click (`StudyLibrary.tsx:234–237`) and can eventually render the whole matching library. The official evidence only measures initial views and a single expansion to 200.

Independent page check with 1,000 records and four Show more clicks passed with exactly 500 cards rendered. Thus a fixed 100-card cap cannot support the broad conclusion. This does not prove virtualization is necessary.

Required correction: state the exact measured displayed-card counts and narrow the no-adoption recommendation to those workloads. Add a bounded expanded-list sample (e.g. 500 or 1,000 displayed cards) with exact result verification, or explicitly leave those states unmeasured. Carry the limitations consistently into STATUS, the tracker and handoff. Do not install a virtualization package to resolve this evidence defect.

### R3 — P2: final-query compute cannot substantiate a per-keystroke savings claim

`src/perf/studyLibraryHarness.ts:324–335` computes only the final view after the typing sequence. The official narrowing result has 80 wall/React samples for 16 prefixes times five repeats, but five compute samples for only `airspace class b`. Early broad prefixes have different result counts and sort workloads. Report line 197's under-1-ms-per-keystroke statement is not established for the entire typing sequence by these unmatched samples.

Required correction: measure compute for the same prefix/state as each recorded interaction and retain enough state/sample identity to compare equivalent workloads. Alternatively label the final-query compute separately and remove the whole-sequence percentage/savings claim. Distinguish observed existing compute from an untested candidate's hypothetical benefit. Preserve accurate no-go reasoning without claiming a dependency comparison was run.

## Independent verification

- Reviewed the actual tracked diff, all three new source modules, the report, original and corrected benchmark evidence, and current production filtering/sort/progressive-display code.
- Four source hashes and all three shared evidence hashes match Claude's handoff.
- Maintained focused suite: `npx --no-install vitest run src/perf/studyLibraryScenarios.test.ts`, Node 22 PATH, exit 0, **5 passed**, 4.06 s.
- Independent diagnostics: exit 1, **1 failed / 1 passed**, 2.43 s on the initial run; the repeat explicitly confirmed the transient fault was injected and observed before the requirement failed. [Diagnostic source and sanitized receipt](MAC_STUDY_LIBRARY_BASELINE_REVIEW_REGRESSIONS_2026-10-02.md).
- Claude's full gate logs report **599 frontend passed / 4 skipped**, **246 Rust passed / 6 ignored**, plus build/lint/format/lock/diff passes. Those are inspected implementer results, not an independently repeated full matrix.
- No unchanged full benchmark, frontend/native matrix, DMG build or installed launch was repeated by Codex during this review. No source fix, commit or push of Claude's implementation occurred. Temporary diagnostic test was removed.

## Source identity and follow-up

```text
aa1b6d6d827df7d2e7e21d5c4b1b73ddfcda30984d7c79ef884cd443d7c2950e  src/perf/appResponsiveness.bench.test.ts
91cffef1140c34fa64d185f0af7e9250fcd3a91211756b0f0413fb61c41cc788  src/perf/studyLibraryFixture.ts
e349c7c63dca936522d0aadd098a38118aaf3859da64280e4adc702e412cc0ae  src/perf/studyLibraryHarness.ts
9631fb9ecfe840571ceb9e4bac3fe95f4911da84aebf7c622e3aad6fe2b5fe73  src/perf/studyLibraryScenarios.test.ts
```

[Copy-ready Claude correction prompt](CLAUDE_MAC_BASELINE_CORRECTION_PROMPT_2026-10-02.md) assigns only R1–R3. Keep foundation and release holds intact. The installed-measurement prompt in Claude's report is not the next assigned task; account/signing prerequisites remain unmet. Correct this slice and return it for independent review first.
