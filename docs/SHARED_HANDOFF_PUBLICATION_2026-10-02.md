# Shared handoff publication — 2 October 2026

Documentation-only preparation from main `5e388bf4169c7f968b1581292d6e1a24aa0493da`, branch `docs/cross-machine-open-source-handoff`. Runtime source, dependencies, migrations, permissions, versions and release policy are unchanged.

## Included material

- [Shared project index](PROJECT_HANDOFF.md) and [task handoff template](templates/TASK_HANDOFF_TEMPLATE.md).
- [Open-source research](OPEN_SOURCE_REUSE_RESEARCH_2026-10-01.md), [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md), [Mac continuation prompt](OPEN_SOURCE_MAC_HANDOFF.md) and [historical evidence snapshot](research/OPEN_SOURCE_SNAPSHOT_2026-10-01.json).
- [Saved-guide feature brief](STUDY_GUIDE_TO_TEST_FEATURE_BRIEF_2026-09-29.md), preserving its M2 scope/check-in gates.
- [A2 full review](A2_SECOND_REVIEW_DETAILS_2026-10-02.md), [correction prompt](A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md), [diagnostic source](A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md) and [sanitized focused logs/hash receipts](evidence/a2-second-review-2026-10-02/README.md).
- Linked [Mac report in draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44), retaining its draft/installed-test limitations.

## Local verification

1. Validated all 24 new/modified documentation/evidence files and their targets/heading anchors: **122 local links resolved**, no broken targets.
2. Parsed all JSON and checked the archival research: **8 queries, 170 unique non-archived repositories meeting the historical 1,000-star floor, 21 shortlist qualification receipts**, and 45 original upstream README/license hash receipts. Original metadata/peer/license snapshots are explicitly dated, not selected package versions.
3. Scanned the changed textual documents/evidence for common credential formats; no matching credential found. Focused logs use synthetic data; Windows-specific user/worktree paths were redacted.
4. Ran `npx vitest run src/logic/releaseSafety.test.ts --reporter=verbose`: exit **0**, **51 passed, 1 intentional skip** (missing-Bash negative-control availability case). The suite checks release policy, existing Mac documentation/backup inspection routines and deterministic PDF fixtures.
5. `git diff --check`: passed before staging. The staged check initially found extra blank EOF lines in four copied logs; those formatting-only endings were normalized, retaining assertions/counts/timings, before the complete staged diff passed.

The focused suite ran on the Windows documentation checkout with existing local dependencies. It does not establish any new Mac runtime result or library speedup. A full application matrix was not repeated for this documentation-only change. Required exact-head GitHub checks remain the final merge gate; the PR records the final head/merge identity.

No third-party source tree or new production package was copied. The shared JSON retains public metadata, source/license links and original evidence hashes; upstream READMEs are linked rather than vendored. Pending A2 source remains local until corrected and independently accepted. Release holds and frozen candidate identities remain unchanged.
