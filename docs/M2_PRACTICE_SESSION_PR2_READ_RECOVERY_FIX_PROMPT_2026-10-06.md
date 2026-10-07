# Finish PR2 MaterialDetail read recovery and the bounded test allowance

You are the owner-selected implementing model. Codex independently verified and closed R11–R13:160 affected tests pass, including the frozen controller diagnostic and34 permanent finishing cases. Preserve that work. Complete one remaining PR2 metadata-read defect, R14, plus a justified local subprocess-test timeout allowance. No new panel rewrite, planning proposal, product scope decision or user check-in is required. Codex remains final reviewer/Git coordinator.

## Start once from the exact current submission

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, HEAD/base `61031d4c7143fdf181bba2cc18616c5345521c3e`. Source is uncommitted/unpushed. Read this assignment and `docs/M2_PRACTICE_SESSION_PR2_READ_RECOVERY_REVIEW_2026-10-06.md` via origin/main/GitHub; the dirty tree may lack them. Verify the29 current source paths using `docs/evidence/m2-practice-session-pr2-read-recovery-review-2026-10-06/source-hashes.json` from main. Stop only before overwriting unexpected competing work on affected files; preserve/report it. Do not pull/reset/rebase or apply evidence snapshots. Do not touch the separate dirty primary clone or archived reviewer worktrees.

Leave both prior controller directories and all earlier receipts byte-unchanged. The incomplete inherited run is preserved evidence, not permission to resume a competing process. Existing M2/PR2 approval and accepted answer-click initiation remain effective.

## 1. R14: handle both newly added metadata reads in MaterialDetail

At `MaterialDetail.tsx:198–212`, getConversionStatus and getCompletedHistory are invoked with `.then` and no rejection handler. They are new in the PR2 diff, absent from accepted PR1. cancelled=true only suppresses success; rejection still becomes unhandled. The frozen read diagnostic triggers each SQL failure independently in a real component/disposable database and observes two unhandled rejections plus no recovery.

Implement one narrowly scoped metadata loader/controller for conversion status and history count. You may use Promise.all with a single phase or retain independent statuses if that keeps partial success useful. Requirements:

- Every promise rejection is consumed in application code, including after route change/unmount. Only the live route/request may publish loading/success/failure. Clear obsolete metadata/errors on a new material; a late prior request cannot set a new count/status or hide its recovery.
- Track loading/failed/loaded explicitly. An unknown history count is not0. Provide truthful History navigation when count is unavailable; only show a numeric count when a successful read established it.
- A visible sanitized failure and clearly named Retry practice status (or equivalent) must be available. Do not expose raw DB/provider/private-path strings. Retry sends only metadata reads, never practice mutations, provider calls, import or regeneration. Lock duplicate retries synchronously or via request ownership so stale reads cannot overwrite the later result.
- Keep saved guide/cards available. Existing valid frozen practice may remain usable via its own authoritative loader; do not force unrelated content offline merely because optional count metadata failed. Preserve known malformed legacy/quarantine behavior, and do not present failed conversion-status reads as successful clean status.
- Avoid global transaction/recovery changes, new dependencies or migrations. Fix the unhandled consumer, not the connection owner's safety refusal.

Promote `codex-pr2-material-read-review.test.ts` from the review evidence as permanent meaningful cases. Its button-name selector may be adapted to the legitimate visible recovery wording; keep injected conversion/history failure, actual UI, zero-unhandled-error and disposable persistence boundaries. Extend the cases to successful read-only retry (real count/quarantine response), held old-route success/rejection and unmount. Demonstrate that no saved response/attempt or provider request is created by metadata Retry. Use existing AppDataProvider/SQLite helpers; no real profile or network.

## 2. The timeout allowance is a separate, bounded test change

The accepted functional case `macReadinessPreflight.test.ts:536`, “documents its exit codes through the real script: usage2, help0, a FAIL1 with a parseable receipt”, launches three real Node subprocesses yet inherits Vitest's5s deadline. Submitted receipts show it crossing that bound while the source and semantic assertions are unchanged.

Add a case-local bounded timeout, initially30,000ms, and a short comment explaining that the functional contract launches real subprocesses under CI/host contention. Keep all exit/receipt/non-disclosure assertions and the existing subprocess hard bound. Do not raise the global timeout, skip the case, mock away the real script, change production preflight semantics or enlarge Study Library performance thresholds. No new test mirroring this allowance is needed; rerun the actual case.

## 3. Revisit test lifetimes only if errors remain after R14

Run the metadata failure/recovery cases, ImportStudyPacketDialog suite and affected offline/practice tests together. The submitted claim that database-disabled errors were entirely accepted PR1 behavior was not established: the new MaterialDetail reads are definite unhandled consumers. Correct that claim in the NEW report without editing old receipts.

If closed-database rejections remain, trace the unfinished async operation and give the relevant test an explicit completion barrier before db.close. Do not add arbitrary sleeps, suppress Vitest/process rejection reporting, swallow transaction failures as success, or change production connection recovery. A successful full run after unrelated failures does not erase those receipts; preserve and explain both results. Do not stress the owner's system or stop background apps to manufacture evidence. Record nonreproduction limits honestly rather than claiming all errors are solved by a faster host.

## Finish and handoff

Focus production edits on MaterialDetail metadata loading and its tests. The bounded CLI-test allowance and a proven test-lifetime fix, if needed, are authorized routine verification work. Preserve the verified panel/history/Dialog/controller source unless a concrete regression requires a narrowly explained adjustment. No new roadmap feature or PR1 audit matrix.

After focused checks pass, run one sequential final source gate: typecheck, npm test (zero failed AND zero unhandled, actual exit0), build, locked Rust all-target tests, locked Clippy -D warnings, fmt, test:cargo-lock, diff/new-file hygiene and unchanged migrations1–11/registry. Repeat only for new edits or unresolved failures; no overlapping matrices or speculative CI pushes.

Write a NEW dated report/evidence pack with actual commands/exits, counts, real case-name mapping, failure receipts and source/evidence manifests with distinct roots. Add any newly changed paths to the source manifest. Record R11–R13 already independently verified; mark R14 implemented pending review, not complete source acceptance/release readiness. Leave all application changes uncommitted/unpushed and stop. Codex will review the focused closure and coordinate source integration when gates are ready. No provider/profile/app-launch/installed testing, signing, packaging or release task.
