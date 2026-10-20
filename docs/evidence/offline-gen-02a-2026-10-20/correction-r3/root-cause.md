# Correction r3: test-only cancellation-order race

All source locations refer to this uncommitted tree, except the explicitly marked original test. Production code is unchanged.

## What the failing assertion actually means

`Cancellable<F>::Output` is `Result<F::Output, Cancelled>` (`src-tauri/src/gemini_cancel.rs:65`). Here `F::Output` is itself `Result<GeneratedStudyAid, String>` (`src-tauri/src/gemini_batches.rs:164`). Outer `Ok` therefore does not establish successful generation.

The original test at HEAD `b258f5103ce43301a2f2fcdab386e0199da43659`, `src-tauri/src/gemini_batches.rs:864`, releases the journal lock after `j.cancel(&id)`, then separately signals the token at line 865. This permits the following schedule:

1. `Journal::cancel` commits the cancelled record (`src-tauri/src/gemini_jobs.rs:668`, commit at 690); `with` releases the shared journal lock (`src-tauri/src/gemini_jobs.rs:879`).
2. Before the cancelling thread signals the token, the worker's periodic budget poll obtains that lock. `Budget::can_continue` returns false from the journal admission check (`src-tauri/src/gemini_budget.rs:243`, original test used the admission fallback); `Budget::run` / `guard_stage` abort the held HTTP future (`src-tauri/src/gemini_budget.rs:726`, `:387`).
3. `generate_once` translates that abort into the cancellation error (`src-tauri/src/gemini.rs:1795`); `generate` propagates it (`src-tauri/src/gemini_batches.rs:243`).
4. The inner future is ready with `Err(CANCELLED)`. With the token still unsignalled, `Cancellable::poll` returns `Ok(Err(CANCELLED))` (`src-tauri/src/gemini_cancel.rs:81`). The worker finishes before `token.cancel()`, although the old assertion runs after that call.

Thus the premise that generation succeeded *after* token cancellation is unsupported. The code checks the token before polling and again after inner readiness (`src-tauri/src/gemini_cancel.rs:68`, `:84`). A later call cannot retroactively change an already completed wrapper result.

## Which request is gated

The guide is unit 0. Its checkpoint advances `next` to 1 (`src-tauri/src/gemini_batches.rs:268`), writes it at line 279, then synchronously calls `say` with `0 / 20` at line 280. The test installs the gate inside that synchronous call (`src-tauri/src/gemini_batches.rs:855`). Only after `say` returns can the loop at line 229 reserve/send unit 1, the first ten-card request. The fake snapshots its gate when it logs each request, before responding (`src-tauri/src/fake_gemini.rs:352`). The guide already passed that check; the next card request cannot pass it before this callback installs the gate. New assertions at `src-tauri/src/gemini_batches.rs:881` require exactly two requests and `draft.next == 1` when cancelling. This is not a late-gate installation race.

## GEN-02a's relevance and production safety

GEN-02a added file sync and directory sync to journal writes (`src-tauri/src/gemini_jobs.rs:788`, sync at 810 and 820), extending shared-lock occupancy under default-parallel tests. It did not change legacy `cancel`, `admits`, `admit_bounded`, or `checkpoint_draft` ordering. New section activation is not called by this legacy batch test. The test also lacked the separate read-only probe installed by the real command (`src-tauri/src/gemini.rs:1156`), so each polling fallback used a durable, counted admission; the corrected helper matches production by attaching a probe (`src-tauri/src/gemini_batches.rs:849`).

Cancelled jobs cannot checkpoint (`src-tauri/src/gemini_jobs.rs:587` checks `admits` under the shared lock); settling only changes a still-running record (`src-tauri/src/gemini_jobs.rs:631`). The production command flattens either cancellation result and explicitly refuses a cancelled final journal record (`src-tauri/src/gemini.rs:1235`, `:1255`). No successful generation, final checkpoint, or publishable result was demonstrated after cancellation.

## Deterministic proof and fix

The untouched baseline ran 200 iterations with zero failures (`repro.log`); both overlapping full stress suites passed. This does not reproduce the Linux scheduling incident locally. `ordering-proof.log` instead forces the exact journal-first ordering by withholding token signalling until the worker has joined. With the old outer-Err assertion, it fails once with EXIT 101, printing `Ok(Err(CANCELLED))`, not `Ok(Ok(answer))`. To repeat that proof, replace only the journal-first branch's `matches!(&result, Ok(Err(message)) if message == gemini_cancel::CANCELLED)` assertion with `result.is_err()` and run the command recorded in that receipt; restore afterward.

The existing test now signals the token while still holding the journal lock (`src-tauri/src/gemini_batches.rs:884`), so no budget probe can observe the cancelled journal before signalling. Its assertion specifically requires outer `Err(Cancelled)` at line 895. The new `journal_cancel_before_token_wake_preserves_draft_without_post_cancel_write` test forces the opposite ordering and specifically requires inner `Err(CANCELLED)` before signalling. Neither permits successful generation. Both compare the cancelled journal byte-for-byte after worker exit and after releasing the abandoned response, require no extra dispatch and no publishable result, and retain the restart/resume ledger and uniqueness assertions. Neither uses a longer wait to select an ordering.

The provided SDKROOT, CARGO_TARGET_DIR, and CARGO_NET_OFFLINE=true were used for cargo receipts; HTTP fixtures use loopback only. Sandbox process inspection was unavailable: the exploratory `ps -axo pid,etime,command` returned EXIT 127 (`operation not permitted`), and the receipt-backed `pgrep -fl cargo` returned EXIT 3 (`Cannot get process list`). No escalation was attempted.
