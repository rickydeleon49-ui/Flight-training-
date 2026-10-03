# Mac report review and Claude continuation — 2 October 2026

Reviewed documentation: draft PR #44 at `43a6b27959e9171b3d25f39a86dfcc2fc7e2f52f`, reconciled with main `a4339fc` (merged PR #45). Reported source tests refer to clean source `5e388bf4169c7f968b1581292d6e1a24aa0493da`; updating these documents does not change that historical test identity.

No blocker found in the Mac report's documentation. Test totals, SDK failure/recovery, DMG identity and signing errors match the local evidence inspected by Codex. Required PR #44 check passed at its original head. Current-head checks must pass again after this documentation update.

This is an evidence reconciliation by the report author, not a claim that a separate reviewer accepted the implementation or installer. No A2 implementation was available in this Mac checkout to review. Raw Mac logs remain local and are explicitly identified as not uploaded. No installed launch, minimum-macOS, live-provider or release approval is inferred.

## Current roadmap and source-reuse decision

The owner confirmed Claude should work in this Mac clone. PR #45 makes the research, adoption plan, A2 correction contract and cross-machine ownership available through GitHub. A2 R6/R7 remains owned by the Windows implementer; Claude on the Mac should not reconstruct unavailable source or mix library adoption into it.

The next assigned Mac task is the bounded Study Library measurement/decision task from the agreed adoption plan. [Copy-ready Claude prompt](CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md) defines it and preserves subsequent foundation, performance, M2, import and M4 gates. It does not authorize package installation or an M2 migration.

## Benchmark gaps to address in that task

Inspection of `src/perf/appResponsiveness.bench.test.ts` found:

- Its `airspa` search has no matching seeded title/note and exercises a no-result query; this does not characterize matching/narrowing searches.
- Materials have no tags or file-status cases; add those synthetic scenarios before drawing search conclusions.
- Existing tiers are 100/1,000/5,000, not 10,000; report a new stress tier separately.
- Node/jsdom timings and final process heap are not WKWebView paint or peak packaged memory.
- Public BEGIN/COMMIT seeding must be reconciled with A2's supported ownership boundary if that driver repair lands.

These are limits of the opt-in measurement harness, not newly reproduced production failures. The continuation prompt assigns focused harness corrections and result correctness checks without production optimization.

Existing shortlist remains conditional: MiniSearch/search, TanStack Virtual/rendering, Zod/react-markdown/structured import, FSRS/Obsidian/later scheduling references, EmbedPDF/later SDK viewer. Exact versions/licenses and platform behavior must be verified before adoption. No new dependency was installed in this review.

## Validation and limitations

Reviewed the actual PR #44 diff, merged handoff/adoption documents, current benchmark source and local Mac test/security receipts. `git diff --check` passes. This review changes documentation only; unchanged frontend/Rust matrices and DMG builds were not repeated. The existing lightweight documentation CI path applies. Draft PR #44 remains available for independent review rather than treating this report-author review as installer acceptance.
