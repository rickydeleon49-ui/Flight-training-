# Reviewer switch and open-PR review — 11 October 2026

## Role switch

The owner assigned Claude as reviewer and Git coordinator while Codex is unavailable, and asked Claude to continue the roadmap and prompt Gemini. Handoff rule 4 allows this switch and requires it to be recorded.

| Role | Who |
| --- | --- |
| Reviewer / Git coordinator (merger) | Claude, confirmed by the owner (temporary, until Codex returns or the owner reassigns) |
| Implementer, M4 round-2 corrections | Gemini: [assignment](GEMINI_M4_ROUND2_CORRECTIONS_PROMPT_2026-10-11.md) |
| Roadmap priority | Owner |

**Git coordinator confirmed.** While this review was in progress, another reviewer independently reviewed and merged #143 (`b178066`) and merged #145 (`bf5cf59`). Rule 2 allows one Git coordinator at a time, and the owner has since confirmed that Claude is the merger for now.

**Independence limit.** Claude implemented the source in #143 (with the owner) and #144, so Claude's review of those is not independent. #143's acceptance rests on the [independent review](PR143_PRACTICE_DATE_RESTORE_REVIEW_2026-10-11.md), not on this document. #142 was produced by Codex, and its review here is independent.

## PR verdicts

Checks run under Node 22.23.3.

### #142: current-account Mac installed results (docs/evidence only)

**ACCEPT.** 22 files: the report and 21 JSON snapshots, comparisons and audits. No binaries, no credential-like strings, `git diff --check` clean, required check passed on head `3abb695`. The report keeps the strict restore FAIL and the practice-history date FAIL. It doesn't present the administrator-account lane as the hfdtest isolation gate. #143's review confirms these snapshots still produce their original FAIL and diffs.

- Branch updated onto `main` `bf5cf59` at the owner's request. The required check passed on the updated head. Ready to merge.
- Nonblocking: evidence paths contain the everyday-account username, as earlier Mac evidence already does.

### #143: practice-history dates and restore receipt baseline

**MERGED** as `b178066` after an [independent review](PR143_PRACTICE_DATE_RESTORE_REVIEW_2026-10-11.md). Claude's earlier self-review (106/107 helper checks on the PR head, focused 10/10) agrees with it, but Claude's review **missed** the valid `__proto__` metadata-key omission in `metadataKeyDigests()`, which the independent review found. It is assigned to the schema-14 preparation task. It causes a refusal, not a false PASS.

### #144 → #146: Notes show the local day

**ACCEPT (self-review).** Draft, head `bf2c299`, base `codex/fix-practice-date-restore-baseline`, required check passed. #143 was squash-merged, so #144 must move onto `main`. Rebuilt locally as `cf26827` on `bf5cf59` (local branch `claude/notes-local-day-on-main`): same three files, 83 additions and 15 deletions. `npm test` passed 3038 tests (6 skipped), typecheck exit 0, `git diff --check` clean. At the owner's request it was published as replacement [#146](https://github.com/rickydeleon49-ui/Flight-training-/pull/146) (base `main`). #144 is closed with a pointer to it.

## Follow-up

The schema-13 helper's live drift anchor (helper ceiling 13 against shipped schema 14) fails on main. That is intended drift, and it is already covered by the [schema-14 preparation assignment](MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md). No separate task is needed.

## Next steps

1. Merge #142 (branch updated, check green).
2. Merge #146 when its check is green.
3. Publish this record and the Gemini assignment in one docs-only PR.

The primary checkout `/Users/rickymac/code/Flight-training-` still has another session's uncommitted 10 October entries. #145 also treats them as protected. They are left untouched.
