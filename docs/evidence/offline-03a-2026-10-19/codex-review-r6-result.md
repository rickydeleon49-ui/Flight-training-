# OFFLINE-03a independent review, round 6 — 19 October 2026

**P2 — The reviewed-operation checkpoint is deleted before the journal acknowledges the save.**

Location: `/Users/rickymac/code/Flight-training-offline-03a-fixes/src/pages/StudyLibrary/RegenerationReviewDialog.tsx:218` (also line 153).
Related lifecycle: `src/state/GeminiJobs.tsx:327` removes the job from the UI and starts journal acknowledgement asynchronously; `acknowledgeNow` at line 302 can fail.

The round-5 fix handles a committed save with a lost response, and its existing regression passes. However, both dialog success branches delete the durable pending operation when `onSave` returns true. That only establishes that the study set was saved; journal acknowledgement can still fail. After restart the ready journal entry returns, the merged reviewed set does not match the raw Gemini answer, and the operation needed to recognize the prior save has already been removed. Saving the recovered review allocates new item IDs and writes another regeneration history entry.

**Reproduction:** mock journal acknowledgement to reject; successfully save a reviewed regeneration with Keep my items; restart the provider/app against the same synthetic database and ready journal record; reopen the review and save it. The in-memory SQLite UI diagnostic produces `edit, regenerate, regenerate` instead of `edit, regenerate`.

**Expected/fix:** preserve the exact durable reviewed operation until the associated journal entry is durably acknowledged (or an explicit discard completes). Let acknowledgement/recovery own cleanup; do not clear the checkpoint merely because the study-set write succeeded. Apply this to both the normal save and the already-committed retry path. Keep cleanup separate from component lifetime and retain safe same-operation retry behavior. Add the failing-first regression described above, plus cleanup-on-success coverage.

## Source identity and boundaries

- Worktree: `/Users/rickymac/code/Flight-training-offline-03a-fixes`
- Branch: `claude/offline-03a-core-fixes`; no upstream configured.
- Reviewed HEAD: `75623243d1ec7232bbcc548fd34563c1e6a49ff7`.
- Implementation base: `750c90c`; this round concentrates on `9c6c544..7562324` and the save/acknowledgement/recovery interactions.
- Tracked working tree unchanged before and after review; the existing untracked `node_modules` symlink was preserved.
- No implementation changes, commits, pushes, PR changes, merges, provider calls, real profiles, installers or releases performed. Remote state was not refreshed for this local reproduction.

## Verification

Fresh checks, Node v22.23.3:

- Five focused suites: **154 passed**, exit 0 (`StudySetEditing`, `MaterialDetailJobs`, `studySetTransaction`, `studySetEditing`, `studyAuthoring`).
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`, exit 0.
- Review diagnostic: **one failed assertion**, exit 1, reproducing the duplicate history entry; 14 unrelated copied cases skipped by the diagnostic filter.
- All **45 receipt checksums** match; all **20 source-manifest entries** match.
- `git diff --check 9c6c544..HEAD` and `git diff --exit-code`: exit 0.
- Claude's preserved full-suite receipt: **3,915 passed, 6 skipped**, exit 0. This is reused evidence, not a new full-suite run.
- Native source is unchanged since `f02e850`, the original implementation/evidence commit; existing native receipts were reused (844 passed, 11 ignored). The handoff's claim that native source has been unchanged since `b50b7b5` is imprecise: `f02e850` also changed Rust. This does not invalidate the receipts taken with that completed implementation.
- Exact-head CI and installed-app behavior remain **UNVERIFIED**.

Diagnostics and logs: `/private/tmp/hfd-03a-r6-review-jzgbv6yq/` (`ReviewRestart.test.ts`, `vite.config.mts`, `diagnostic.log`, `focused.log`, `typecheck.log`, `source.json`). Synthetic data only; Gemini functions mocked.

Correction assignment: `/Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r6-correction-prompt.md`.

VERDICT: RED
