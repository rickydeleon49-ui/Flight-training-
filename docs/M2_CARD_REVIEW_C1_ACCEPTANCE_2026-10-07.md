# M2 card reviews C1 — source acceptance, 7 October 2026

**Independent source review: C1-R1/R2 are closed; C1 is acceptable for integration.** Final source acceptance requires the containing PR's exact-head CI and merge. The approved defaults C-D1–C-D8 remain unchanged. [Owner approval](M2_CARD_REVIEW_OWNER_APPROVAL_2026-10-06.md); [prior review and Xcode evidence](M2_CARD_REVIEW_C1_REVIEW_2026-10-07.md); [independent acceptance receipts](evidence/m2-card-review-c1-acceptance-2026-10-07/README.md).

## Identity and closed findings

The corrected submission is uncommitted on `codex/m2-card-review-c1` in `/Users/rickymac/code/Flight-training-pr70-integration`, base `73b15976343d2d2a1525e0426dbe6450e6afb850`. All **37 corrected source hashes**, **14 correction-evidence checksums** and **45 original evidence checksums** match. Exactly **five of the 37 paths** differ from the original submission: STATUS, handoff and three source/test paths (`useCardReview.ts`, `CardReviewPanel.tsx`, `CardReviewPanel.test.ts`). Thus 32/37 are unchanged; the implementer's README's 34/37 claim is a counting error, not an extra source change.

| Finding | Accepted corrected behavior |
| --- | --- |
| C1-R1 | Synchronous session-start exclusion; request/generation checks for success, error and finally; content changes release the old start state; old continuations cannot clear a newer lock; ending a session invalidates pending startup. Ordinary and StrictMode startup and actual panel contentKey replacement pass. |
| C1-R2 | Synchronous paging exclusion and disabled loading control; a history epoch rejects pre-reset and superseded page results/errors; current failed paging retains its cursor for deliberate retry. Frozen erased-history and duplicate-page regressions pass, including disposable-SQLite/provider UI erasure proof. |

The four frozen defect cases and two controls were independently rerun **verbatim**, alongside the permanent panel and dialog fallback suites: **65 passed / 0 failed**, three files, exit 0, zero unhandled errors. The temporary frozen test was removed afterwards. Current-main integration typecheck and production frontend build also pass independently. Integration starts at `8f13833bf2f71ce4d00f0250d902415c185d2fb1`; current-main status/history is preserved instead of overwritten by old-base copies. Submitted status/handoff snapshots are saved in acceptance evidence.

## Preserved implementation and proportional verification

C1 delivers material-level card reviews: flip/reveal, Again/Hard/Good/Easy scheduling, exact current-version due work, suspend/flag before rating, recent review pagination and explicit generation-protected reset. It retains the browse carousel, study guide and independent practice history. It is offline and introduces no production dependency. Migration **0012** is additive and registered in both engines/checksum registry; shipped 0001–0011 and existing checksum entries remain unchanged. Native commands and browser durable transactions preserve replay-first ordering, request hashes, reset barriers, rollback and deletion tombstones. Shared validation fixtures and schema ceiling are included.

The original independent C1 review verified **105 frontend passes**, **415 native passes / six ignored**, Xcode 27 native compilation, debug no-bundle desktop build, Clippy and fmt. Native source, validator, schema, fixture and build configuration are byte-identical in the correction, so those results are reused, not re-executed. The implementer's corrected focused **121 passes** and full frontend **2,695 passes / four skips**, zero unhandled errors, are checked submitted receipts. Independent typecheck/build and the containing source PR's full required CI confirm integration; an unchanged whole local native matrix is not repeated.

The existing FSRS evaluation remains research only. C1 uses the approved deterministic `simple-v1`; Zod's prior study-packet adoption is retained. No workflow/capability/lockfile/version/signing changes are part of this feature.

## Scope and next assignment

The [next model-neutral C2 assignment](M2_CARD_REVIEW_C2_SCOPE_PROMPT_2026-10-07.md) prepares cross-material Review due/History scope and disposable query/performance evidence. It does not approve new product defaults, production backfill, migration or dependency. C1 correction prompts become historical after source merge.

This is source acceptance, not installed-app or release acceptance. The earlier Xcode binary declares arm64/macOS 12 deployment support, but it predates the final frontend corrections; this report does not claim it is a current release candidate. Actual desktop IPC/SQL-plugin runtime, installed/macOS 12/VoiceOver, Developer ID/notarization and release gates remain unverified or unresolved. No user account/profile/app launch or provider request occurred during review. The containing PR records exact-head CI/merge; the Mac clone is synchronized only after its original uncommitted submission is preserved recoverably.

Coordinator publication cleanup removes one extra EOF blank line from `CardReviewPanel.test.ts`; no executable statement changes. The final published manifest records that formatting-only difference from the reviewed submission.

## CI fixture granularity correction

The first source CI run at `11811eeb936a170b8c5d17ad903ad5cc2eb8b0d7` failed with 2,694 passes/four skips and one timeout in `cardValidationParity.test.ts`: its Node SQLite case applied migrations and reopened file-backed databases for all 36 fixtures inside one five-second test. No assertion failure or unhandled error was reported. [Failed run](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/37591593088); raw failed-step output is preserved in acceptance receipts.

The coordinator replaced only that bulk loop with `it.each`, retaining all 36 fixture outcomes, migrations, reopen behavior and the default five-second timeout per case, with `finally` cleanup on assertion/build failures. It introduces no production or fixture change, no skipped cases and no timeout increase. The corrected file independently passes **38 tests** (two existing tests plus 36 named Node cases), and typecheck passes. The complete frontend count consequently rises by 35, from 2,695 to 2,730 tests; the final containing PR must pass full CI on this corrected head before merge.
