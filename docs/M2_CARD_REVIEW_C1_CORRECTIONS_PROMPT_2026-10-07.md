# M2 card reviews C1 — authorized model-neutral UI correction assignment, 7 October 2026

**Implement the two confirmed C1-R1/R2 corrections, then leave all work uncommitted and unpushed for independent review.** The owner approved C-D1–C-D8; the real-user check-in waiver remains effective. Do not ask for that approval again. Any owner-selected model may execute this assignment. Preserve the complete existing C1 source; do not restart its implementation or add C2/mobile/release work.

## Authority and start

1. Use `/Users/rickymac/code/Flight-training-pr70-integration`, the existing dirty `codex/m2-card-review-c1` branch based at `73b1597`. The primary clone is separate and outside this task.
2. Fetch origin. Read this prompt, [the independent review](M2_CARD_REVIEW_C1_REVIEW_2026-10-07.md), [owner approval](M2_CARD_REVIEW_OWNER_APPROVAL_2026-10-06.md) and relevant scope clauses. If these docs are absent from the working tree, read them with `git show origin/main:<path>`; **do not merge/rebase/pull/reset dirty source to obtain documents**.
3. Before editing, compare the 37 source paths against `docs/evidence/m2-card-review-c1-2026-10-06/source-hashes.json`. Also verify its 45 evidence checksums. Report unexpected changes and preserve any competing work instead of overwriting it. Do not apply old stashes, create a second implementation checkout, or change the branch's base solely for docs.
4. The frozen reviewer diagnostic is `docs/evidence/m2-card-review-c1-review-2026-10-07/diagnostics/CardReviewCodexReview.test.ts.txt` on origin/main. Copy it verbatim to an absent temporary `src/pages/StudyLibrary/CardReviewCodexReview.test.ts`, run it and retain the raw exit/log. Expected reviewed baseline: **2 passed / 4 failed**, exit 1, no unhandled errors. Remove only this temporary copy after verification. Promote its four defects into permanent suites with unchanged behavior/test names; keep passing controls.

## C1-R1: own and synchronously exclude session starts

Targets: `useCardReview.ts`, lifecycle setup/cleanup and `startSession`; panel only if needed to reflect controller state.

- A `starting` React boolean cannot exclude two calls before rerender. Add a synchronous start lock owned by the request/scope, set before awaiting snapshot/queue reads.
- Each start must have an identity/generation. Publish its snapshot/queue/session, failure and final unlocked state only when it still owns the current context. Old callbacks must not clear a newer start lock.
- On `contentKey`, repository/material scope change or unmount, invalidate old starts and reset the public start/failure state appropriately. The new material/content must be reviewable without an old request's settlement.
- Prevent a late duplicate/obsolete start from replacing a session after it has begun advancing. Ending/replacing a session must invalidate relevant pending startup work.
- Preserve existing synchronous write exclusion, request ownership, retained exact unknown-write/reset payloads, confirmed-write refresh locks and deliberate new actions after stale refusals. Do not solve a read race by forgetting an unresolved write.

Permanent tests must cover both frozen R1 cases, held old success/rejection/finally while a newer start is pending, end/replacement behavior, and actual StrictMode mount/cleanup replay. At least one integration case should exercise CardReviewPanel's actual same-material contentKey lifecycle. MaterialDetail already keys/remounts on route changes; do not claim a production route defect from an unkeyed hook probe.

## C1-R2: own history pages and invalidate pre-reset work

Targets: `useCardReview.ts` refresh/reset/history read paths and RecentReviews in `CardReviewPanel.tsx`.

- Maintain a history-list epoch independent of material scope, plus a synchronous page lock with request ownership and captured cursor.
- Reset intent must invalidate pre-reset page publications before awaiting the reset. A fresh authoritative first-page refresh and scope/content replacement must also invalidate old pages.
- Only the current epoch/request/cursor may append rows, publish pagination errors/cursors, or release its lock. Late success or failure from an obsolete epoch must change nothing, including a newer request's loading state.
- Expose page loading; disable Show more reviews while its page is in flight. On a current request's failure, retain cursor and enable a deliberate same-cursor retry.
- Keep history reads read-only and preserve keyset ordering and 20-row page semantics. Row-ID deduplication alone cannot prevent an erased page with distinct IDs from resurfacing.
- Preserve reset's exact same-ID Try again and read-only Check again, operation-receipt acknowledgement requirement, pending modal lock, and acknowledged-reset refresh gate.

Permanent tests must cover both frozen R2 cases plus held-page success and rejection across reset/first-page refresh, late A callbacks during B's page, a failed page retry, repeated end-of-history calls, and one real-provider/disposable-SQLite UI reset while a page response is held. Assert erased event rows stay absent in the database **and** UI after late delivery, without provider/network calls.

## Scope and verification

Expected production edits: `useCardReview.ts`, `CardReviewPanel.tsx` and directly relevant tests. Add another file only for a demonstrated consequence and disclose it. Do not alter scheduler/identity, migration 12 or shipped migrations/checksums, native transaction/validator, dependencies/locks, global timeout policy, workflows, release version or signing configuration for these UI defects.

1. Demonstrate the permanent regressions fail on the reviewed source and pass with the fix. Run the frozen file unmodified again: all **six cases** must pass. Preserve failed receipts; remove temporary tests afterward.
2. Run affected hook/panel/provider/dialog suites. Verify original C1 UI behaviors remain intact: session caps/acknowledgement, suspend/flag before rating, exact retry payloads, refresh failures, reset acknowledgement and guide-only empty cards.
3. Once focused tests pass, run one sequential frontend gate: `npm run typecheck`, `npm test` (zero failures/unhandled errors), `npm run build`, tracked/new-file whitespace and migration/checksum immutability checks. Reuse existing native **415-pass**, Xcode desktop-build, Clippy and fmt evidence if native/build configuration stays byte-identical; do not rerun an unchanged whole native matrix. If a relevant native/config change becomes necessary, explain it and run the affected check.
4. Write a **new** dated evidence directory with issue-to-test map, exact commands/exits/counts, preserved failed attempts, repository-rooted source hashes and a separate evidence manifest. Keep all original C1 and reviewer evidence unchanged. Mark reuse explicitly, without claiming reused tests were newly run.
5. Update STATUS and PROJECT_HANDOFF to “C1-R1/R2 corrected, pending independent re-review.” Report exact HEAD/branch, competing work, changed paths and any open limits.

**Stop uncommitted/unpushed.** Codex handles independent acceptance, commits, PR, exact-head CI, merge and sync. No further owner scope decision is pending for these corrections. No app-profile/account access, app launch, provider call, mobile track, installer, signing, packaging, version change or release. Mac Xcode source verification already passes; installed/Gatekeeper/VoiceOver/macOS-12 observations remain separate.
