# M2 PR2 controller fix — completion report (M2UI-R11–R13)

**Date:** 6 October 2026
**Clone:** `/Users/rickymac/code/Flight-training-pr70-integration`
**Branch:** `codex/m2-practice-session-ui` — **base/HEAD unchanged:** `61031d4c7143fdf181bba2cc18616c5345521c3e`
**Assignment:** `docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_FIX_PROMPT_2026-10-06.md`
**Review closed:** `docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_REVIEW_2026-10-06.md`
**Status:** implementation and local verification complete; **not independently accepted**. All application source stays uncommitted and unpushed.

---

## 1. Unexpected competing changes (reported before touching affected files)

At start I verified all **29** paths in `docs/evidence/m2-practice-session-pr2-controller-review-2026-10-06/source-hashes.json` (read with `git show origin/main:…`) against this clone. **27 matched; 2 differed**, and an untracked directory I did not create was present:

- `src/pages/StudyLibrary/PracticeTestPanel.tsx` — modified (lock-ownership refs, lifecycle effect ordering, adoption validation, guarded read pipeline).
- `src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts` — modified (10 added R11/R12/R13 permanent cases).
- `docs/evidence/m2-practice-session-pr2-controller-fix-2026-10-06/` — a **partial** evidence set: `gate/01-typecheck` (exit 0), `gate/02-npm-test` (**exit 1**, 2 failed tests, 96.79 s wall), `gate/06-fmt` (**exit 127**, i.e. `cargo fmt` not found because the Rust toolchain path was not exported), two diagnostic logs, and **no report, README, source manifest or evidence manifest**. `STATUS.md` / `docs/PROJECT_HANDOFF.md` had been touched but their bytes were identical to my finishing submission.

I did not overwrite or revert that work. Its implementation passed the reviewer's frozen diagnostic (21/21, including `[R11]`, `[R12]` and `[R13]`) on arrival, and the frozen positive set (18 earlier diagnostics) still passed, so I treated it as in-progress work to **verify, correct and complete**, keeping its partial directory byte-unchanged for the reviewer. What was missing was its own verification (its only full-suite attempt failed, and two gate steps never ran) and one real defect described in §3.

**No other unexpected change was found.** The separate dirty primary clone (`/Users/rickymac/code/Flight-training-`, branch `claude/cool-carson-9wjrub`) was not opened for writing; nothing was pulled, reset, rebased or patched over.

---

## 2. R11–R13 as implemented and verified

### M2UI-R11 — lifecycle setup restored under the real StrictMode wrapper
`PracticeTestPanel.tsx` now declares the lifecycle effect **before** the load effect, and its setup restores `mountedRef.current = true` while its cleanup sets it false and advances `generationRef`:

- StrictMode's development replay therefore re-establishes live ownership before the replayed load runs, and the first-generation reads stay obsolete (bumped generation fails `isCurrent`), which is exactly the required "only the live generation publishes".
- `mountedRef` is not assigned during render, StrictMode was not removed, `isCurrent` was not weakened, and a real unmount still rejects late callbacks (covered by the unmount case).

Permanent cases (`src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts`, all using `React.StrictMode` over the real context and a disposable Node SQLite database):
- `[R11] actual StrictMode wrapper can finish loading` (promoted)
- `[R11] held first read under StrictMode replay cannot overwrite live generation`
- `[R11] unmount control under StrictMode preserves dead view guards`

### M2UI-R12 — the whole read/adoption pipeline is inside the guarded boundary
`refreshCurrentAttempt` now performs `getCurrentAttempt` **and** `adoptAttempt` (including its replacement `getVersion`/`getItems` pair) inside one try/catch; `adoptAttempt` additionally refuses an incomplete replacement (`!version || !items.length`) instead of silently keeping the previous frozen content. The acknowledged start and retake branches in `runIntent` wrap their awaited adoption in the same handling. Failures for the current generation publish `refresh_failed` with the read-only **Retry refresh** affordance and keep editing blocked; obsolete generations publish nothing. An acknowledged write is never resent by read recovery, and read failure is not misclassified as an unknown write.

For a start whose answer is still held, the preallocated response identity, item/version association and draft survive in `heldStartRef`; a successful read either continues the held answer against the acknowledged/current state, or — when identity changed — asks for a new deliberate answer.

Permanent cases:
- `[R12] a failed replacement-version read exposes read-only retry` (promoted; real response, regeneration and replacement attempt, then a rejected `getVersion`)
- `[R12] a failed replacement-items read exposes read-only retry`
- `[R12] successful read-retry recovers replacement content without resending the acknowledged response`
- `[R12] acknowledged start with replacement version adoption failure preserves draft and identity`
- `[R12] acknowledged retake preserves result view and exposes read-only retry without allocating duplicate`
- `[R12] a held answer whose content identity changed settles instead of spinning` (new; see §3)

### M2UI-R13 — synchronous locks are owned, not global
`busyRef`/`intentRef` are paired with `busyOwnerRef`/`intentOwnerRef` carrying `{ materialId, operationId }`. `acquireBusy`/`releaseBusy`/`setIntent`/`clearIntent` only take or drop a lock whose owner matches, so a late callback for material A can neither clear nor overwrite material B's lock. When the panel is handed a different material lifetime, the old view's pending intent is detached and the new view's lock is initialised consistently with its loading phase. Unknown-write identity is unchanged within its own live lifetime; nothing is reset globally on ordinary retry/load. Committed A database work still completes — the UI claims no cancellation. Production `MaterialDetail` stays keyed by material ID, and these remain **direct-component boundary** cases, not a claim about ordinary production navigation.

Permanent cases:
- `[boundary] old material mutation cannot keep a new material action locked` (promoted)
- `[boundary] converse: settling old material cannot clear new material lock or permit duplicate write`

---

## 3. Defect I found in that in-progress work and corrected

The competing implementation left the reducer's `preserveDraft` adoption branch **without a phase transition**. That is not cosmetic: a start acknowledged while its frozen-content read failed, followed by a read-retry that reports different content, dispatched only the "choose your answer again" notice and stayed in `refresh_in_flight`. The panel then showed "Confirming your saved state…" with no recovery control, all choices disabled, and no way to give the new deliberate answer the notice had just asked for.

Fix: the held-adoption branch now publishes `phase: "ready"` (position, draft and version/items preserved). Where the same tick continues into the response write, the following `intent_started` transition is batched over it, so no intermediate unlocked frame is rendered.

Evidence that the regression is meaningful, not decorative:

- With the fix: `[R12] a held answer whose content identity changed settles instead of spinning` passes, asserting no spinner text, no resent `start_or_resume`, no persisted response before the new click, all choices enabled, the replacement question displayed, and a genuinely new deliberate answer then persisting with feedback.
- With that one line temporarily removed, the same case **fails** (`34 passed → 1 failed | 33 skipped`), and the panel file was then restored to the fixed bytes and hash-verified identical.

Scope of my own application edit: one reducer branch in `PracticeTestPanel.tsx`. `PracticeHistory.tsx`, `Dialog.tsx`, all data-layer and Rust files are byte-identical to the reviewed finishing submission except the two files the competing run had already touched.

---

## 4. Verification

| Check | Result |
| --- | --- |
| Reviewer frozen `codex-pr2-finalreview.test.ts`, run verbatim with the affected permanent suites (10 files) | **160 passed, 0 failed, 0 unhandled**, exit 0 (`diagnostics/frozen-controller-review-verbatim.txt`) |
| Its three new diagnostics `[R11]`, `[R12]`, `[R13] boundary` | pass verbatim, unmodified |
| Earlier positives | 18 prior frozen diagnostics, 10 promoted corrections, 11 PR2 flows, 8 panel interactions, offline/contract/startup/modal-fallback all green |
| Final full frontend suite (`npm test`) | **2,556 passed, 4 skipped** (87 passed / 3 skipped of 90 files), **zero unhandled errors**, exit 0, 42.37 s |
| Native (`cargo test --locked --all-targets`) | **391 passed, 0 failed, 6 ignored**, exit 0 — includes all five erasure proofs (`req_erase_history_atomic_pruning_and_tombstones`, `req_erase_history_validation_checks`, `req_erase_history_unrelated_isolation_and_safe_new_practice`, `req_erase_history_restart_refusal_and_backup_validation`, `req_erase_history_mid_write_failure_rolls_back_every_change`) |
| Browser disabled-recovery proof | `src/data/practiceEraseDurability.test.ts › an erasure whose recovery fails disables the adapter and keeps every saved row` — green |

Sequential gate, final run, toolchain `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH` with `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` (Node v22.23.3, npm 10.9.9, rustc/cargo 1.99.0, Vitest 4.1.11, macOS 27.0.1 arm64):

| # | Step | Exit |
| --- | --- | :---: |
| 1 | `npm run typecheck` | 0 |
| 2 | `npm test` | 0 (see §5 for the preserved failed attempt) |
| 3 | `npm run build` | 0 |
| 4 | `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets` | 0 |
| 5 | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | 0 |
| 6 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 |
| 7 | `npm run test:cargo-lock` | 0 |
| 8 | `git diff --check` + per-new-file whitespace/final-newline hygiene | 0 |
| 9 | migrations 1–11, `src/data/migrations.ts` and `migrationSafety.test.ts` unchanged vs base | 0 |

### Correction to my earlier report
The controller review noted that the finishing report's **§6 item 3 stated 2,544 passes while §7 stated 2,545**. That was a transcription error in the older report, which stays byte-unchanged in `docs/evidence/m2-practice-session-pr2-finish-corrections-2026-10-05/`. The authoritative receipts are the attached logs: the finishing run's own `gate/02-npm-test.txt` records **2,545 passed / 4 skipped / zero unhandled / exit 0**, and this submission's final run records **2,556 passed / 4 skipped / zero unhandled / exit 0**.

---

## 5. Load-dependent instability observed, and why I did not "fix" it

`npm test` failed twice today on this machine and passed twice, on identical source:

- `gate/02-npm-test.attempt1-failed.txt` (preserved): exit 1 — 2 failed tests plus **4 unhandled `DatabaseDisabledError` rejections**, wall 81.87 s, while load average was 8–9 on 10 CPUs (`appstoreagent` occupying a core, Google Drive syncing).
- `load-investigation/full-run-attempt2-timeout.txt`: exit 1 — 1 failed (`macReadinessPreflight … documents its exit codes through the real script`, "Test timed out in 5000ms"), no unhandled errors.
- Passing runs: `load-investigation/full-run-idle-retry-pass.txt` and the recorded gate step 2 — exit 0, 2,556 passed, zero unhandled, 42–47 s.

Diagnosis, stated without overstating it:

1. The timed-out test spawns real `node` subprocesses and runs in ~0.3 s alone (verified in isolation: `34 passed`, 733 ms). Under contention it crosses the shared 5 s default. It is an accepted Mac-readiness contract test, unrelated to the panel, and outside this assignment's stated scope ("limit application edits to these lifecycle/read boundaries and their focused tests"), so I did not alter it or its timeout.
2. The recurring unhandled rejection is the **same** connection-lifetime race that R10 recorded: `connectionOwner.rollbackIfOpen` hits `database is not open` when `ImportStudyPacketDialog.test.ts` closes its disposable database while an import transaction is still queued. My earlier conclusion that it "did not reproduce" was therefore **condition-dependent, not a refutation** — it reproduces under CPU pressure and is absent on an unloaded run. It arises entirely in accepted PR1/import code that this submission does not touch (`connectionOwner.ts` is not even in the 29-path manifest), and the review explicitly assigned no speculative teardown rewrite. I did not suppress it, filter it, add arbitrary delays, or change production recovery semantics; I recorded both outcomes.
3. Consequence for review: the reviewer's machine appears to run these heavy suites without this contention (their independent runs were 26–29 s). **A green full run here may require a retry on a loaded host.** This is the one thing I would like confirmed independently; it is not a blocker for R11–R13, whose own diagnostics and permanent cases pass deterministically.

---

## 6. Files and hashes

Exactly **four** of the 29 manifest paths differ from the controller-review snapshot (`git status` + hash comparison against the reviewer's own manifest):

| Path | Why it differs |
| --- | --- |
| `src/pages/StudyLibrary/PracticeTestPanel.tsx` | the in-flight R11/R12/R13 work (verified and kept) **plus** my one-line held-adoption phase fix |
| `src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts` | the in-flight R11/R12/R13 cases (verified and kept) **plus** my `[R12] … settles instead of spinning` case |
| `STATUS.md` | this submission's corrected pending-review entry |
| `docs/PROJECT_HANDOFF.md` | the same corrected entry |

The other 25 paths — `PracticeHistory.tsx`, `Dialog.tsx`, every `src/data/**` file, every `src-tauri/**` file, `MaterialDetail.tsx`, the older practice suites and the fixtures — are byte-identical to the reviewed state. Nothing outside the panel and its focused tests was edited.

`source-hashes.json` holds SHA-256 for all **29** submission paths keyed relative to the repository root; `SHA256SUMS` holds SHA-256 for the files in this directory keyed relative to this directory. Two roots, deliberately separate.

---

## 7. Preserved from the reviewed submission (unchanged behavior, still green)

Reducer phases and shared result-view recovery; complete initial reads; generation gating of loads and adoptions; unknown-write identity lock with exact-payload retry; coherent unsaved-draft rendering; null/closed/replaced reconciliation; history route generations and same-ID erase replay; pending `ConfirmDialog` defaults and native/fallback behavior; answer-click initiation with acknowledged start ordering and the truthful resume copy the review accepted; five native erasure proofs; the browser erasure disabled-recovery proof; the 43-case shared validator contract; migrations 1–11 and their checksum registry.

**Not done, by instruction:** no PR1 re-audit, no new dependency, migration or feature work, no teardown rewrite, no Git staging/commit/push/PR, no app launch against user data, provider call, installed/VoiceOver verification, signing, packaging or release.

**Open for the reviewer:** the §5 load-dependence, and independent confirmation of R11–R13 from this source state.
