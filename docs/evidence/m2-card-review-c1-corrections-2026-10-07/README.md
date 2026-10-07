# M2 Card Reviews C1 Corrections Evidence — 7 October 2026

## Overview and Authority

- **Repository Checkout:** `/Users/rickymac/code/Flight-training-pr70-integration`
- **Branch:** `codex/m2-card-review-c1` based at `73b15976343d2d2a1525e0426dbe6450e6afb850`
- **Assignment Prompt:** `docs/M2_CARD_REVIEW_C1_CORRECTIONS_PROMPT_2026-10-07.md` (read via `git show origin/main`)
- **Review Report:** `docs/M2_CARD_REVIEW_C1_REVIEW_2026-10-07.md`
- **Owner Approval:** C-D1–C-D8 approved on 6 October 2026 (`docs/M2_CARD_REVIEW_OWNER_APPROVAL_2026-10-06.md`); real-user check-in waiver remains in force.
- **Preflight Verification:**
  - 37 source paths compared against `docs/evidence/m2-card-review-c1-2026-10-06/source-hashes.json`: 100% matched before edits.
  - 45 evidence checksums in `docs/evidence/m2-card-review-c1-2026-10-06/SHA256SUMS`: 100% verified.
  - Frozen reviewer diagnostic copied from `docs/evidence/m2-card-review-c1-review-2026-10-07/diagnostics/CardReviewCodexReview.test.ts.txt` to temporary `src/pages/StudyLibrary/CardReviewCodexReview.test.ts`: reproduced exactly **2 passed / 4 failed**, exit 1, no unhandled errors.

---

## Issue-to-Test Mapping

### C1-R1: Own and Synchronously Exclude Session Starts
**Production Edits:** `src/pages/StudyLibrary/useCardReview.ts`
- Added synchronous `startingLock` ref set immediately before awaiting any asynchronous work.
- Added generation / request ownership (`currentStart` ref and `owner = scope.current`).
- Guarded publication of session queue, snapshot, errors, and unlock in `startSession` so obsolete requests cannot overwrite newer ones.
- Added lifecycle invalidation on `contentKey`, `materialId`, and unmount to reset `startingLock` and bump `scope.current` / `currentStart.current`.
- Guarded session replacement when a session has already started advancing (`sessionRef.current.position > 0 || sessionRef.current.completed.size > 0`).
- Added session cleanup invalidation in `endSession`.

**Permanent Test Coverage in `src/pages/StudyLibrary/CardReviewPanel.test.ts`:**
1. `[C1-R1] replacing cards while a session queue read is held releases the current material start lock` (frozen reviewer diagnostic promoted)
2. `[C1-R1] two synchronous starts allocate only one session queue read` (frozen reviewer diagnostic promoted)
3. `[C1-R1] held old success/rejection/finally while a newer start is pending does not clear newer lock or publish obsolete state`
4. `[C1-R1] held old rejection while a newer start is pending does not mark session unavailable or clear lock`
5. `[C1-R1] ending or advancing a session prevents an obsolete start from resurrecting or replacing it`
6. `[C1-R1] actual StrictMode mount/cleanup replay settles and unlocks cleanly`
7. `C1-R1 CardReviewPanel same-material contentKey lifecycle resets start state and remains reviewable` (full panel integration test)

### C1-R2: Own History Pages and Invalidate Pre-Reset Work
**Production Edits:** `src/pages/StudyLibrary/useCardReview.ts`, `src/pages/StudyLibrary/CardReviewPanel.tsx`
- Added `historyEpoch` ref bumped on reset intent (`confirmReset`, `sendReset`, `tryResetAgain`), first-page refresh, and scope/content changes.
- Added synchronous page lock `pagingLock` ref and request tracking `currentHistoryRequest`.
- Exposed page loading via `recent.loading` state; disabled "Show more reviews" button in `CardReviewPanel.tsx` while a page is in flight.
- Retained cursor on error (`recent.failed = true`, `recent.loading = false`) to enable deliberate retry without cursor loss.
- Guarded page publication so only the request matching the current `historyEpoch`, `scope`, and `currentHistoryRequest` can publish.
- Protected reset semantics: Try again and Check again retain exact operation ID and check against authoritative status without replaying duplicate writes.

**Permanent Test Coverage in `src/pages/StudyLibrary/CardReviewPanel.test.ts`:**
1. `[C1-R2] a history page held before reset cannot resurrect erased history after the acknowledged refresh` (frozen reviewer diagnostic promoted)
2. `[C1-R2] two synchronous history requests publish one copy of the next page` (frozen reviewer diagnostic promoted)
3. `[C1-R2] held-page success and rejection across reset/first-page refresh change nothing`
4. `[C1-R2] late A callbacks during B's page change nothing in B's state or loading`
5. `[C1-R2] a failed page retry retains cursor and succeeds with the same cursor`
6. `[C1-R2] repeated end-of-history calls are safe no-ops`
7. `C1-R2 real-provider/disposable-SQLite UI reset while page response is held keeps erased rows absent in DB and UI` (disposable node:sqlite integration test verifying erased rows absent in DB and UI)

---

## Command Receipts and Results

Environment: Node v22.23.3 via `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.

| Receipt File | Command | Result | Exit Code |
| --- | --- | --- | --- |
| `receipts/diagnostic-frozen.log` + `.exit` | `npx vitest run src/pages/StudyLibrary/CardReviewCodexReview.test.ts` (unfixed baseline) | 2 passed, 4 failed | 1 |
| `receipts/diagnostic-fixed.log` + `.exit` | `npx vitest run src/pages/StudyLibrary/CardReviewCodexReview.test.ts` (fixed source) | 6 passed, 0 failed | 0 |
| `receipts/focused-frontend.log` + `.exit` | `npx vitest run src/logic/cardScheduler.test.ts src/logic/cardIdentity.test.ts src/logic/localDay.test.ts src/data/cardReviewContract.test.ts src/data/cardReviewTauri.test.ts src/data/cardValidationParity.test.ts src/pages/StudyLibrary/CardReviewPanel.test.ts` | 7 test files, 121 passed, 0 failed | 0 |
| `receipts/full-gate-typecheck.log` + `.exit` | `npm run typecheck` (`tsc --noEmit`) | Clean typecheck, 0 errors | 0 |
| `receipts/full-gate-test.log` + `.exit` | `npm test` (`vitest run`) | 95 test files passed (3 skipped), 2,695 tests passed (4 skipped), zero unhandled errors | 0 |
| `receipts/full-gate-build.log` + `.exit` | `npm run build` (`tsc --noEmit && vite build`) | Built production bundle cleanly in 850ms | 0 |

---

## Native Evidence Reuse Notice

As authorized by the assignment prompt:
> "Reuse unchanged Xcode/native evidence (415-pass, Clippy, desktop build) because no Rust/native files or configs were altered for these UI fixes."

No Rust files, SQLite migrations (0001–0012), Cargo.toml, Cargo.lock, or native configuration files were modified for these UI corrections. 34 of the 37 C1 source paths remain byte-for-byte identical to the accepted C1 baseline. Consequently, the native evidence from `docs/evidence/m2-card-review-c1-review-2026-10-07/` is explicitly reused:
- `xcode27-native.log` + `.exit`: 415 tests passed, 6 ignored, exit 0
- `xcode27-desktop-build.log` + `.exit`: desktop build, exit 0
- `xcode27-clippy.log` + `.exit`: cargo clippy -D warnings, exit 0
- `fmt.log` + `.exit`: cargo fmt --check, exit 0
- `toolchain-binary.txt`: Mach-O metadata and toolchain information

These native tests were verified during the C1 review and are not claimed as newly re-executed.

---

## Git and Delivery State

- Working tree left **uncommitted and unpushed** on `codex/m2-card-review-c1` for independent review.
- No application launch, network calls, Gemini API calls, mobile track, signing, packaging, or release work.
