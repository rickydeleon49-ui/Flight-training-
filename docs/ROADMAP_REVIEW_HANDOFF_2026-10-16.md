# Roadmap review handoff — 16 October 2026

The owner assigned Codex implementation duties for this round. **Another independent reviewer must review Codex's correction source.** Earlier documents naming Codex as reviewer are historical; they do not convert this implementer's own green tests into independent acceptance.

## Current delivery state

- **P54-03 formatted guides is accepted and merged**: PR191, merge3266f193. Read P54_03_ACCEPTANCE_2026-10-16.md for source scope and verified CI/local evidence. Installed/VoiceOver/provider claims remain separate.
- **M4/P54-01 is not yet accepted**: original PR189 atc234005 plus draft correction[PR194](https://github.com/rickydeleon49-ui/Flight-training-/pull/194), head138b9253856ba289bcd15592d26ab86f0ce81cfd. The correction adds33 regressions for stale action follow-ups and source-badge ownership. Full frontend3,488/6 skipped, focused94, frozen4/4, build/types/helper pass. Its own CI38992516422 is green on138b925. Unchanged native inputs reused prior evidence locally; the correction has its own complete green CI. Independent source review remains required.
- **P54-04 export is not yet accepted**: original PR193 ata490dac plus draft correction[PR195](https://github.com/rickydeleon49-ui/Flight-training-/pull/195), headf0a298294edc5ae6a2e443d72f7f3036e9b5ffff. Two UI defects are reproduced and corrected, with four UI and four native failure cases added. Full sequential8-check local gate is green (3,320 frontend/490 Mac native). Its own exact-head CI and independent review are required. The provisional Windows cleanup-leak concern was retracted, not left as a blocking issue.
- **P54-02 phase1 is exploratory evidence**, not production adoption: native FTS5 present/browser FTS5 absent, simple physical-page extraction proof, compressed-text allocation gap and a reproducible engine comparison. No search engine/dependency selected. See P54_02_SEARCH_EVALUATION_2026-10-16.md.

## Reviewer task1: M4 lifecycle source, then PR189 integration

Read the exact-commit [implementation report](https://github.com/rickydeleon49-ui/Flight-training-/blob/138b9253856ba289bcd15592d26ab86f0ce81cfd/docs/M4_LIFECYCLE_CORRECTIONS_REPORT_2026-10-16.md) and [complete reviewer assignment](https://github.com/rickydeleon49-ui/Flight-training-/blob/138b9253856ba289bcd15592d26ab86f0ce81cfd/docs/M4_LIFECYCLE_REVIEWER_PROMPT_2026-10-16.md). Verify source/evidence manifests, inspect the actual four-path correction and challenge action/context/lifetime and click/controller ownership. Retain original R1–R10 fixes and old failing receipts.

If accepted and exact-head CI is green, mark the correction ready and merge it into PR189 normally with the current head guard. Then reconcile PR189 with current main, preserving the accepted formatted guides and all tracker history. Keep the schema15 feature's helper regression bindings; do not replace its manifest with an old main copy that drops those bindings. Refresh only affected current entries. Require new green exact-head CI on the current-base combined source before accepting and merging PR189. If defects remain, give one precise correction prompt and preserve all work.

## Reviewer task2: export corrections, then PR193 integration

Read the exact-commit [report](https://github.com/rickydeleon49-ui/Flight-training-/blob/f0a298294edc5ae6a2e443d72f7f3036e9b5ffff/docs/P54_04_SAVE_RECOVERY_REPORT_2026-10-16.md) and [complete reviewer assignment](https://github.com/rickydeleon49-ui/Flight-training-/blob/f0a298294edc5ae6a2e443d72f7f3036e9b5ffff/docs/P54_04_SAVE_REVIEWER_PROMPT_2026-10-16.md). Review the synchronous Save lock, pending controls and failure-injection seam; confirm no native/public path or validation bypass and no invented Windows/runtime claim.

If accepted with green current-head CI, merge correction195 into PR193's source branch through the normal workflow. PR193 is still based on the already-merged formatted-guide branch: retarget/reconcile it with current main after PR191 and any accepted M4 merge. Preserve both MaterialDetail integrations and native command registration. Do not blindly overwrite either helper binding set or root tracker history. Require final current-base exact-head CI before merging PR193. Do not treat the correction PR's tests as installed save-dialog/WebKit printing verification.

## Next substantial implementation task

After source review/integration work, continue `docs/P54_02_EXTRACTION_WORKER_PROOF_PROMPT_2026-10-16.md`. It assigns the bounded standalone worker/IPC/cancellation proof, explicit query/cache semantics and a pre-registered measurement plan. No production index, dependency adoption or shared-schema FTS5 table is authorized by the exploratory report. Keep missing native interaction and realistic PDF evidence explicit.

## Worktree and preservation details

Codex reused `/Users/rickymac/code/Flight-training-post-v054-roadmap`; the latest documentation/evaluation branch is `codex/local-search-evaluation`. Switch to the correct branch in a safe checkout before inspecting correction source. Both corrections are committed/pushed; no source was discarded. Task recovery/checkpoints live under `/Users/rickymac/.codex/task-recovery/` in `m4-lifecycle-implementation-20261016`, `p54-04-save-recovery-20261016`, and `p54-02-search-evaluation-20261016`.

Primary `/Users/rickymac/code/Flight-training-` retains its prior `.claude/settings.json` edit. Claude's original M4/format/export worktrees and the dirty historical schema14 worktree were untouched. No app/profile/key/provider/installer/signing/release operation occurred. Preserve them; do not reset, stash, clean, delete or repurpose their files. Use current source/CI identity, not these historical head strings, if a newer authorized agent has moved a branch.
