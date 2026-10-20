# OFFLINE-03a handoff: plan, state and where to resume — 19 October 2026

This is for whoever picks OFFLINE-03a up next, Codex or Claude. Read it first. Then read [the report](OFFLINE_03A_REPORT_2026-10-19.md) and [the reviewer prompt](OFFLINE_03A_REVIEWER_PROMPT_2026-10-19.md).

## CURRENT STOP POINT — round-7 follow-up GREEN; fresh CI before merge

- Owner: **Qwen implements → Codex reviews/tests and loops corrections → Codex merges after exact-head green CI**. No repeated workflow sign-off. Earlier role/stop-point text is historical.
- Latest code `d6ce015370dae0acfa81ba4b18a80c46925640cf`; [current source acceptance](OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md): **166 focused; 3,927 full frontend passed / 6 skipped**; typecheck/build/lock/whitespace pass. The two new cases fail against prior published `72f2be2`.
- Confirmed absence after false acknowledgement completes cleanup; a rejection, present entry or failed journal read retains the operation. All earlier lost-response/restart protections remain.
- PR #237 is the replacement; #236 is closed without branch deletion. Superseded CI 39353697326 was cancelled after the new P2 was reproduced, before merge. Publish this correction and wait for fresh exact-head CI, then guarded merge and main inclusion verification.
- After verified merge, create/reuse `/Users/rickymac/code/Flight-training-offline-03b`, branch `qwen/offline-03b`, from accepted main. A model-neutral planning prompt is at `/Users/rickymac/code/.gen-rel-loop/offline/OFFLINE_03B_PLAN_PROMPT.template.md` (fill identity placeholders). Codex reviews that storage/API plan before Qwen implements the coupled backend/UI. Preserve owner decisions, defer03c and do not touch real profiles, keys or releases.

## Historical local acceptance before the round-7 follow-up

The owner now directs **Qwen implementation → Codex review/test → correction loop → Codex merge after green exact-head CI**. Earlier ownership and stop-point instructions below are historical and superseded by this entry.

- Code correction commit: `9d3a90c7832525cb831dacb1a41b2dbd3628b5ed`; same worktree and branch as below, initially local only.
- [Current acceptance/integration report](OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md): 164 focused and 3,925 full frontend tests passed, 6 skipped; typecheck/build/lock/whitespace passed. Four new maintained cases fail on original `7562324`.
- The pending reviewed operation survives both rejected and false native journal acknowledgements, and successful discard/acknowledgement owns cleanup.
- Next: reviewed replacement PR, close #236 as superseded, green exact-head CI, guarded merge, verify default-branch inclusion. Then an isolated Qwen OFFLINE-03b branch from accepted main; Codex continues review/testing.
- No new provider tests, real profiles, keys, installers, releases, dependency adoption or 03c. Native receipts correspond to `f02e850` and remain applicable; the old `b50b7b5` wording below is imprecise.

## Who owns what now

**OFFLINE-03a moved to Claude on the owner's instruction:** "you can review codex work and take it over for now".
- Claude implements.
- Codex reviews locally, with `codex exec -s read-only`.
- Claude pushes once for exact-head CI, opens the PR and merges only after a GREEN review and green exact-head CI. It never self-accepts without that review.

**Owner decisions in force:**
- **The five OFFLINE-03 defaults** (proposal §4): migration 0016; Keep my items; ship 03a/03b enabled after acceptance; 03c later; packet v1 with disclosure.
- **Revision 5:** ordinary rewrites also enter the retirement list.
- **"Keep things local unless we really need GitHub Actions":** push only for the gating exact-head CI run.
- **This PR:** "create the new PR when done".

## Where the work is

| | |
| --- | --- |
| Worktree | `/Users/rickymac/code/Flight-training-offline-03a-fixes` (has a `node_modules` symlink; never commit it) |
| Branch | `claude/offline-03a-core-fixes`, **local only, not pushed** |
| Base | `750c90c` = PR #236 head (Codex's authoring core, on main `fc3ef34`) |
| Commits | `b728454` Claude's fixes to #236's core · `b50b7b5` migration 0016, fingerprints, atomic saves · `f02e850` editing UI, regeneration review, exports, docs and evidence · then the Codex round-1 fixes (next commit) |
| Codex's own worktree | `/Users/rickymac/code/Flight-training-offline-03a` (branch `codex/offline-03a-authoring-core`, untouched) |
| Review files | `/Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r*.md` (prompt), `…-result.md` (verdict) |

**PR #236 (draft, Codex) is superseded by this branch.** It contains the same core, plus Claude's round-1 corrections. Once this branch's PR is open, close #236 with a comment pointing at the new PR. Don't merge both.

## Review history

**Claude's review of #236 (round 1): RED.**
- One P1: an ordinary edit could relabel an instructor correction as hers, making it exportable by default.
- Three minor findings: unchanged saves relabelled Gemini text; ordinary rewrites were retired beyond the contract (now revision 5); the length measure differed from card review.
- All four are fixed in `b728454`.

**Codex review of this branch, round 1: RED.** Two findings, both fixed:
1. **P1:** the regeneration review dialog unmounted while saving and closed even after a failure. A retry after an uncertain save could therefore apply twice. **Fix:**
   - `saveReviewed` now returns whether it saved;
   - the dialog stays mounted through `saving` and closes only on success;
   - a failed reviewed save is kept on the job (`GeminiJob.reviewed`), and saving the same choices again resends exactly that operation. The native and TypeScript saves recognise it by id as `already_saved`.
2. **P2:** restore read the current set only at confirm time, so a change made while the confirmation was open was overwritten unseen, although it was kept in history. **Fix:** the current set is read when the confirmation opens; a change since then is refused as `STALE_CONTENT`.

**Proof of the fixes:**
- Three regressions were added to `StudySetEditing.test.ts`: a failed reviewed save; commit followed by a transport failure; a stale restore.
- All three fail on the pre-fix source (`docs/evidence/offline-03a-2026-10-19/codex-r1-regressions-before-fix.log`: 3 failed, 7 passed) and pass after the fix.

**Codex review of this branch, round 2: RED.** Restore was confirmed fixed. Two P2s were found and fixed:
1. A reopened review could save a committed regeneration again. It now detects a committed save on open and resends the exact operation.
2. An out-of-range Gemini page blocked the review. `generatedPage` is now shared by plain saves and the review.

The two regressions fail on the pre-fix source (`codex-r2-regressions-before-fix.log`). See the report's "Codex review, round 2" section.

**Codex review of this branch, round 3: RED.** Both round-2 fixes were confirmed, and one P2 was found and fixed. The "already saved?" check compared the raw Gemini page, while the save had stored an out-of-range page as no page. It now applies `generatedPage` to both sides. Its regressions fail on the pre-fix source (`codex-r3-regressions-before-fix.log`).

**Codex review of this branch, round 4: RED.** The round-3 fix was confirmed. One P2 was found and fixed: the review didn't show full content or the earlier wording an item resembles; it now shows both, the earlier wording coming from Previous versions. The regression fails on the pre-fix source (`codex-r4-regression-before-fix.log`).

**Codex review of this branch, round 5: RED (fixed; round 6 not yet run).** The round-4 fix was confirmed. One P2 was found and fixed: a reviewed save that committed before a restart could apply again. The pending operation is now kept in local storage under its job id, and recognised when the review reopens. The regression fails on the pre-fix source (`codex-r5-regression-before-fix.log`).

## HISTORICAL STOP POINT (Claude's usage ran out here) — 19 October 2026

- **Last commit:** see `git log -1` on `claude/offline-03a-core-fixes` (the round-5 fix plus notes). **Local only; nothing pushed; no PR yet.**
- **Codex review rounds 1–5:** all RED, and every finding is fixed with a failing-first regression. The results are in `docs/evidence/offline-03a-2026-10-19/codex-review-r*-result.md`.
- **Gate after the round-5 fix:** full frontend 3,915 passed, 0 failed (`r6b-vitest-full.log`); typecheck, build and diff-check exit 0.
- **Native:** Rust has been unchanged since `b50b7b5`, so the native receipts (844 passed, clippy, fmt) still apply.
- **The very next step is Codex round 6.** The prompt is not written yet. Copy `/Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r5.md` to `…-r6.md`, change its last section to "Round 6: verify the round-5 fix (`git diff 9c6c544..HEAD`)", then run:
  `codex exec -s read-only -C /Users/rickymac/code/Flight-training-offline-03a-fixes -o /Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r6-result.md "$(cat …-r6.md)" < /dev/null`
- **On GREEN:** push the branch once, open a PR against `main` (title "OFFLINE-03a: study material she makes and edits herself"; body from the report, ending with the Claude Code attribution), and close draft #236 as superseded. Merge only after green exact-head CI, with `gh pr merge --merge --match-head-commit <sha>`.
- **On RED:** fix it locally, add a regression that fails first, rerun the gate, and record receipts in the evidence README and `SHA256SUMS`.
- **If you edit STATUS, ROADMAP or PROJECT_HANDOFF,** rebind the schema-14 manifest (see the rules below).

## Exactly where it stopped, and what comes next

1. **Done:** both Codex round-1 fixes and their regressions, plus this handoff.
2. **Done:** the gate after the fixes (`r2*` receipts). Its final run (`r2c-vitest-full.log`) passed 3,909 with 6 skipped. Two earlier runs failed on test timing in the new regressions, which was then fixed; see the evidence README. The steps the gate covers, kept for any later rerun, are below.

   Rerun the full local gate in sequence and record receipts in `docs/evidence/offline-03a-2026-10-19/`:
   - typecheck;
   - the full vitest run (expect zero failures);
   - build;
   - `cargo test`, clippy with `-D warnings` and `cargo fmt --check` (only if Rust changed; the round-1 fixes are TypeScript only);
   - `npm run test:cargo-lock`;
   - `git diff --check`;
   - `node --test scripts/mac-schema14-profile-snapshot.test.mjs` (26/26).

   Then update `SHA256SUMS` and commit.
3. **Codex rounds 2–5 were RED and are fixed. Next is round 6:** run the gate, commit, then review with `/Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r6.md`. The round-2 prompt was the prompt is `/Users/rickymac/code/.gen-rel-loop/offline/codex-review-03a-r2.md`, and the result lands in `…-r2-result.md`.
   - Prompt: `docs/OFFLINE_03A_REVIEWER_PROMPT_2026-10-19.md`, plus a note naming the round-1 findings and their fix commit.
   - Run: `codex exec -s read-only -C <worktree> -o <result.md> "$(cat <prompt>)" < /dev/null`.
   - On RED: fix locally, add a failing-first regression and repeat.
4. **On GREEN:**
   - Push the branch once, open a PR against `main` ending with the Claude Code attribution, and close #236 as superseded.
   - Wait for the exact-head CI run.
   - Merge only with `gh pr merge --merge --match-head-commit <sha>` after it's green.
   - If CI fails on a known flake (FLAKE-CR-01, the card-review tests), record it and rerun only that job. Don't loop.
5. **After the merge:** 03b, manual practice questions. See the next section.

## Plan for 03b (not started)

The proposal (§2.5) and `docs/OFFLINE_03_IMPLEMENTATION_PROMPT_2026-10-19.md` are the contract. Start from merged main; don't stack on an unmerged branch.

**What changes together:**
- the IPC `PracticeTestSaveOperation`, which carries `provider` (`gemini` | `import` | `manual`) and a per-question `origin`;
- both validators (`practiceSessionTransaction.ts`, `practice_sessions.rs`);
- both transactions (no more hard-coded `'gemini'`);
- `practice_item_origins` rows, written in the same transaction (the table already exists from 0016);
- the practice content hash: origin only when present, so legacy hashes are unchanged; use independent vectors;
- the document mapper, and the history, attempt and export readers.

**The interface:** create and edit questions without Gemini. Each edit makes a new immutable version, and old attempts keep their questions. Regeneration keeps her questions under the same review rules. Export applies the same instructor-correction default.

**Reuse:** `study_set_history` with `kind = 'practice'` is reserved for practice history.

## Known limits and open items carried forward

- **Review-list labels:** library-wide "Review due" and "Recent reviews" lists don't show author labels. The material page and its review snapshot do.
- **Preview speed:** a regeneration preview against a full 2,000-entry retirement list took about 1.3 s on this Mac, on the interface thread. Measure it on minimum-spec hardware before release.
- **Behaviour changes for review** (see the report):
  - Gemini study sets are now strictly validated on save;
  - out-of-range Gemini pages are stored as no page;
  - `'restore'` was added to the history reason CHECK.
- **Unchanged and still open:** FLAKE-CR-01; the 02c cached p50 miss (28.2 ms vs 20 ms); extraction and search release gates (still dormant); installed and minimum-spec acceptance of the editing screens, in the synthetic release lane.

## Rules that still apply

- **Data safety:**
  - migrations only ever add;
  - never change the bundle identifier;
  - no new dependency without the owner's agreement;
  - synthetic data only;
  - no provider calls, real profile or key, installer or release work.
- **Shared state:** don't pull, reset or stash over another agent's dirty work.
- **Tooling:**
  - Node 22: `/opt/homebrew/opt/node@22/bin`;
  - `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.
- **Editing STATUS, ROADMAP or PROJECT_HANDOFF:**
  - rebind `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json` and its `SHA256SUMS`;
  - rerun the schema-14 helper test;
  - delete `src-tauri/target/flycheck0` first if it exists.
