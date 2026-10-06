# Finish the M2 PR2 controller boundaries — model-neutral assignment

You are the owner-selected implementing model. Fix the two reproduced controller blockers M2UI-R11/R12 and the supplementary R13 ownership boundary in the existing Mac submission. Preserve the passing R5–R10 work. Do the implementation and verification; no new planning proposal or owner check-in is needed. Codex reviews and coordinates Git after readiness.

## Exact starting state

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`. Application changes are uncommitted/unpushed. Read this prompt and `docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_REVIEW_2026-10-06.md` from origin/main using git show or GitHub; the dirty checked-out docs may be older. Do not pull/reset/rebase, apply the frozen snapshot over the checkout, touch the separate dirty primary clone or use an archived reviewer checkout.

Verify all29 current source paths against `docs/evidence/m2-practice-session-pr2-controller-review-2026-10-06/source-hashes.json` fetched from main. Report unexpected competing changes before overwriting affected files. Evidence provides `codex-pr2-finalreview.test.ts`, exact commands/exits and the submitted snapshot. Its independent frontend run is146pass/3fail/1unhandled; native erasure5pass. The original18 frozen diagnostics and all23 permanent finishing cases pass. Preserve these positives; no PR1 re-audit, dependency, migration rewrite or feature redesign.

## 1. R11: restore lifecycle setup under the real StrictMode wrapper

`PracticeTestPanel.tsx:437–447` has a cleanup-only effect. StrictMode development replay sets mountedRef=false and never restores it. `src/main.tsx` already uses StrictMode, so the real development app remains on Loading while repository reads finish.

Put mounted=true in the effect's setup, with cleanup invalidating the matching generation and mounted state. Place lifecycle setup before load setup, or otherwise guarantee replayed load runs with live ownership. First-generation reads must remain obsolete. Do not set mounted=true on every render, remove StrictMode, or weaken isCurrent to accept dead views. Preserve non-StrictMode behavior and real unmount guards.

Promote `[R11] actual StrictMode wrapper can finish loading`. Add a held first read/second replay read or unmount control proving only the live generation publishes. Use real synthetic storage and React.StrictMode, not a manual mounted-ref test.

## 2. R12: catch the complete read/adoption pipeline, not only its first query

In `refreshCurrentAttempt`, move adoptAttempt into the guarded read boundary. Its getVersion/getItems Promise.all can reject after getCurrentAttempt succeeded. Handle rejection for the current generation by showing refresh_failed/Retry refresh and keeping editing blocked; obsolete failures must not touch current state. The response write is acknowledged, so recovery must perform reads only and must not resubmit that write.

Validate the adopted snapshot before ready: missing replacement version/items must produce a settled error/unavailable/retry state, not fallback to old version/items with a new attempt. On Retry refresh, retry all required frozen-content reads, and unlock only after the complete state is adopted. Preserve valid null reconciliation.

Audit the same specific awaited adoption boundary in acknowledged start and retake branches of runIntent. The save-only try/catch currently cannot catch those read failures. Model acknowledged-write/read-failed separately from unknown-write. For start with a held answer, preserve its preallocated response ID, item/version association and draft through read recovery; after a successful read either safely continue against the appropriate acknowledged/current state or explicitly ask for a new deliberate answer if identity changed. Do not silently lose the draft, resend an acknowledged start, or reinterpret old option indices against different questions. For retake, preserve the old result and expose read recovery without allocating another retake.

Promote `[R12] a failed replacement-version read exposes read-only retry`. The frozen fixture performs a real acknowledged response, regeneration and new attempt, then rejects getVersion. Add getItems failure and successful read-retry proof: replacement question/attempt displayed, no extra acknowledged mutation and zero unhandled rejections. Cover one acknowledged start/retake adoption-read failure with exact operation identity. Capture asynchronous failures into the correct phase; do not suppress Vitest error handling or manufacture generic unknown-write retries.

## 3. R13: tie synchronous locks to their owning material/generation

Direct A→B panel prop change invalidates reducer generation but leaves A's intentRef. After A settles, B looks ready yet cannot answer. Late A callbacks also set busyRef=false without ownership checks, which can interfere with B's lock if you merely reset it on material change.

Give intent/busy refs explicit lifetime/owner identity. On a different material/repository lifetime, detach the old view's pending intent from the new view and initialize B's lock consistently with its loading phase. Only a callback whose captured owner still matches the active lock may clear/release it. Keep unknown-write identity unchanged within its original live lifetime; do not globally reset on ordinary retry/load/generation changes and accidentally permit conflicting writes. Real committed A database work still completes; no UI cancellation claim.

Promote `[boundary] old material mutation cannot keep a new material action locked`, then test the converse: switch A→B, hold B's own mutation, settle A and try a second B click; it must not bypass B's existing lock or allocate a duplicate. Keep production MaterialDetail key protection. Describe this as supplementary direct-component coverage, not a claim about current ordinary production navigation.

## Accepted choices and preservation

The reviewer accepts answer-click initiation with acknowledged start ordering and truthful saved resume copy. A separate blocking Start button is unnecessary. Preserve held-answer replay, reducer phases, shared result recovery, null clearing, history generation checks, same-ID erase replay, pending Dialog defaults/fallback, five native erasure proofs and browser disabled-recovery proof. The earlier import-test rejection did not reproduce in the submitted clean runs; no speculative teardown fix is assigned. The NEW replacement-content rejection is reproducible and must be handled.

Keep production changes narrowly scoped to the panel lifecycle/reads/lock ownership. Reuse existing repository/database types and modal code. Adapt diagnostic helper waits only if needed for legitimate phases while keeping saved-outcome, callback ownership and zero-unhandled invariants.

## Gate and final handoff

Run the new boundary diagnostics plus affected permanent suites; all previous positives must stay green. Once focused checks pass, run one sequential final source gate: typecheck, npm test, build, locked Rust all-target tests, locked Clippy -D warnings, fmt, test:cargo-lock, diff/new-source hygiene and unchanged migrations1–11/registry. Capture actual exits in separate receipts and require zero unhandled frontend errors. Repeat only when a change/failure justifies it; no overlapping matrices or speculative pushes.

Write a NEW dated correction report/evidence directory; keep previous receipts unchanged. Include exact real test names/results, source hashes rooted at repo, separate evidence hashes, and actual final pass/skip/ignore counts. Correct the earlier §6.3 count mismatch by citing the final2545-pass receipt, and distinguish implementation completion from independent acceptance. Update STATUS/handoff as corrected pending review. Explain the narrow code changes and any remaining blocker. Leave all application source uncommitted/unpushed and stop before Git integration, another roadmap increment, provider/profile/app-launch/installed tests, signing, packaging or release.
