# M2 PR2 controller review — 6 October 2026

**Result: preserve the verified R5–R10 fixes; two remaining controller blockers need correction before source integration.** One supplementary component-boundary lock defect was also reproduced. This is a bounded continuation of approved PR2; no new product/check-in approval is needed.

## Identity and observed verification

Implementation checkout `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, HEAD/base `61031d4c7143fdf181bba2cc18616c5345521c3e`. All **29 source hashes and 35 evidence hashes match** the finishing submission. Application source stayed unchanged before/after independent tests. No staging/push/source integration occurred.

Independent frontend: **146 passed,3 failed,1 unhandled rejection**, exit1. All 18 earlier frozen behavioral cases, the 23 new finishing cases, browser erasure disabled-recovery, existing practice/offline/contract/startup and modal fallback cases pass. The three new failures are described below. The unhandled rejection is the deliberately induced replacement-content read error escaping application code; it is not the earlier nonreproducing import error. Independent native: **5 erasure tests pass**, including the new mid-write rollback proof, exit0.

Submitted full gate receipt and separate raw exit now support **2,545 frontend passes/4 skips/zero unhandled errors**, **391 Rust passes/6 ignores**, plus successful type/build/Clippy/fmt/lock/hygiene/migration checks. Those full results remain submitted evidence, not an independently rerun full matrix. A new full matrix would not resolve the reproduced controller blockers, so it was not repeated. R10's earlier invalid full-run claim is corrected honestly, and its failed receipt remains preserved.

The [evidence pack](evidence/m2-practice-session-pr2-controller-review-2026-10-06/README.md) includes exact commands/exits, executable diagnostic, frozen tracked/untracked source, source manifest, unchanged proof and byte-preserved finishing receipts. All storage is disposable synthetic data; no real profile, provider, app launch, installed/VoiceOver or release verification.

## Accepted engineering decisions and passing corrections

The reducer/controller, shared result-view recovery, complete initial reads, unknown-write lock, coherent unsaved drafts, null-attempt clearing, generation-based history callbacks, pending ConfirmDialog behavior, exact erase replay, native rollback and browser disabled-recovery proofs are useful and verified. Keep them; do not reopen PR1 or rewrite the controller again.

**Start/resume interpretation accepted:** the first answer click can be the deliberate initiating action. The start must be acknowledged before its held response is saved; the UI states that ordering and displays saved resume progress. A separate mandatory Start button is not required by this review. This judgment is based on user behavior and durability, not on treating existing test selectors as product requirements. Preserve the held-answer retry semantics and truthful resume copy.

**R10 accepted with its stated limit:** isolated and full submitted runs did not reproduce the old import-test lifetime error; no speculative teardown rewrite or suppression is required. This does not exempt newly induced read failures from error handling.

## M2UI-R11 — P2: Strict Mode leaves practice permanently loading in development

Location: submitted `PracticeTestPanel.tsx:437–447`, `isCurrent` near375; `src/main.tsx` wraps App in StrictMode.

The lifecycle effect is cleanup-only. Its cleanup sets mountedRef=false; the second effect setup during development Strict Mode never restores true. Initial reads resolve but `isCurrent` rejects every publication, leaving Loading forever. The app's existing development wrapper exercises this path. **This finding concerns Strict Mode's development effect replay; it does not claim production React repeats effects in the same way.**

Exact proof: `[R11] actual StrictMode wrapper can finish loading` renders the real panel/context inside StrictMode with a saved synthetic test, observes repository reads, and then finds **zero** radio choices instead of two. The original non-StrictMode loading diagnostics still pass.

Fix: restore mountedRef=true in lifecycle setup, invalidate the appropriate request generation on cleanup, and order setup/loading so replay can issue and accept a new request while rejecting the first stale request. Do not remove StrictMode, bypass the generation guard, or set mounted=true from render. Keep real-unmount late callback rejection. Promote this diagnostic and add StrictMode unmount/held-read coverage using the same small fixture.

## M2UI-R12 — P1: frozen-content read failure escapes the recovery controller

Location: `PracticeTestPanel.tsx:456–501`, especially getVersion/getItems at471–474 and adoption outside the catch at501. The acknowledged start/retake/answer continuation is also outside runIntent's save-only try/catch (`557–612`).

refreshCurrentAttempt catches getCurrentAttempt failure but not a rejection from adoptAttempt's replacement-version getVersion/getItems reads. These rejects propagate through runIntent/beginIntent, which handlers invoke with void. The UI remains refresh_in_flight, no Retry refresh is shown, and the promise becomes unhandled. The broad report claim that the whole continuation chain is caught is therefore inaccurate.

Exact proof: `[R12] a failed replacement-version read exposes read-only retry` starts/answers a real attempt, commits a changed answer, regenerates the saved test and starts a replacement attempt, then rejects getVersion while post-write reconciliation reads that replacement. There is **no Retry refresh button**, and Vitest records **one unhandled Synthetic replacement content read failure**. The persisted response mutation was already acknowledged; it must not be resent to repair a content read.

Fix: include both current-attempt and frozen-content adoption in the guarded read/reconciliation boundary. On any current-generation read failure, enter refresh_failed with a visible read-only retry and blocked editing. Ensure retry performs all required reads and adopts a complete validated replacement snapshot before unlocking; null/missing version/items cannot silently reuse the prior frozen content. Apply equivalent handling to acknowledged start and retake adoption. For an acknowledged start whose answer is still held, preserve its response identity/selection separately until a read-only retry safely resumes or asks for a new deliberate answer; never lose it or resend the acknowledged start as read recovery. Avoid a catch-all that misclassifies acknowledged-read failure as unknown write.

Promote the diagnostic, test getItems rejection as the sibling path, and verify successful recovery displays replacement content with no extra acknowledged-write call. Tests must report zero unhandled errors; do not filter the rejection.

## M2UI-R13 — P2 supplementary boundary: an old intent keeps the new material locked

Location: panel loadSnapshot/load effect near389–439 and non-current runIntent completion at541–543; busyRef/intentRef near371.

Generation invalidation updates reducer state on a direct material prop change but does not scope/reset intentRef. Hold A's response, rerender panel for B, let A settle, then select B: B looks ready but submitAnswer sees A's remaining intentRef and silently returns. The old callback also writes busyRef=false without checking which generation owns that lock.

Exact proof: `[boundary] old material mutation cannot keep a new material action locked` uses real persisted A and B, resolves A's held response after B loads, and verifies a B answer click starts no B operation (expected start_or_resume forB).

**Production MaterialDetail remains keyed by materialId.** This is a component-boundary controller defect, not evidence that ordinary production material navigation currently hangs the same instance. It is not the sole reason source integration is withheld. Correct it while fixing lifecycle ownership: scope synchronous intent/busy state to material/request owner, reset when adopting a different material/repository lifetime, and only release a lock if the settling operation owns it. A late A success/error must neither lock B nor unlock B's own pending write. Add the late-A/held-B converse test.

## Evidence/document tidy-up and next action

The submitted report's §6.3 says 2,544 passes while its final gate/§7 correctly says 2,545; use the actual final receipt in the next dated report. The report header saying review closed means implementation claimed completion, not independent acceptance. Preserve older evidence and mark only verified behavior accepted in status/handoff.

Execute the [specific model-neutral controller fix assignment](M2_PRACTICE_SESSION_PR2_CONTROLLER_FIX_PROMPT_2026-10-06.md). Limit application edits to these lifecycle/read boundaries and their focused tests. Finish local gates after the changes, leave source uncommitted/unpushed, and return for one independent review. No new roadmap feature, account, package or release action.
