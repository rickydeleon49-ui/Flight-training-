# SWEEP follow-ups — independent review, 15 October 2026

**CHANGES REQUESTED. Do not commit or merge the implementation yet.**

Reviewed uncommitted branch `claude/sweep-followups-2026-10-15` in `/Users/rickymac/code/Flight-training-sweep-followups`, base/main `f2a7090190c74fdc3779785ae3684049d16b2a0e`. All 13 submitted paths were SHA256-frozen before checks and verified unchanged afterward. No application source was edited by the reviewer.

## Finding

**SWEEP-R1 / P2 — opposing medical authority choices swap the persisted dates instead of reconciling them.** `src/pages/PilotToolkit/PilotToolkit.tsx:400-425` queues two independent mutations using dates captured from the same conflict. Neither button is disabled and no synchronous pending guard prevents the opposite choice. With Settings `2031-11-30` and medical record `2031-10-31`, either rapid opposite-click order leaves Settings `2031-10-31` and the record `2031-11-30`. The selected authority fails to reconcile the pair. Two additional real-SQLite diagnostics reproduce this after awaiting the actual mutation queue. The existing five medical tests exercise only settled single actions and miss it.

Flight-time listing/detail warnings preserve source records and totals and provide correction links as requested. No blocker found in SWEEP-1014-TIMES. Medical single-action tests pass; the latest-expiring-record heuristic and multiple-record limitation are disclosed in Claude's report and are not certified as identifying a legally current certificate by this source review.

## Independently executed verification

Node22.23.3; source checkout above; synthetic disposable SQLite/jsdom only.

| Command | Exit | Result |
| --- | --- | --- |
| `npm test` | 0 | 3,212 passed / 6 skipped, 141 files passed / 4 skipped |
| `npm run typecheck` | 0 | passed |
| `npm run build` | 0 | typecheck + Vite bundle passed |
| `git diff --check` on submitted changes | 0 | passed |
| Frozen reviewer diagnostic, focused on the two added cases | 1 | 2 failed; 5 original cases filtered/skipped |

Raw original outputs and exact argv/exits are in [evidence](evidence/sweep-followups-review-2026-10-15/). The temporary diagnostic copy under src was removed in a finally block. The frozen copy remains in evidence as `.test.ts.txt`, outside Vitest discovery. Source identity refers to the dirty submission, not a nonexistent implementation commit. No desktop launch/build/install, hfdtest, actual profile access, provider call, signing or release. Full requested frontend verification is green but does not outweigh the two confirmed diagnostic failures. Nothing was suppressed, and the package remains uncommitted for correction.

## One consolidated correction prompt

```text
Fix the one confirmed independent-review blocker in Claude's existing SWEEP follow-up package. Do not implement unrelated roadmap work.

Working directory: /Users/rickymac/code/Flight-training-sweep-followups
Branch: claude/sweep-followups-2026-10-15
Base: f2a7090190c74fdc3779785ae3684049d16b2a0e
Read docs/SWEEP_FOLLOWUPS_REPORT_2026-10-15.md, docs/SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md, and the SWEEP-1014-TIMES / SWEEP-1014-MEDICAL rows in ROADMAP.md.

Before editing, fetch without pulling/resetting/stashing and verify all 13 entries in docs/evidence/sweep-followups-review-2026-10-15/submitted-hashes.json. These identify the uncommitted implementation reviewed, not HEAD alone. Preserve unrelated/competing changes; report any mismatch. The reviewer added only its own report/evidence. The original 13 submitted paths were verified unchanged after review.

SWEEP-R1 (P2, merge blocking): MedicalDateConflictCard, src/pages/PilotToolkit/PilotToolkit.tsx:393-425, accepts both authority choices while its async save is pending. AppDataProvider queues both callbacks, but each uses the old displayed dates. Starting with Settings=2031-11-30 and the latest medical=2031-10-31, clicking the record choice then the Settings choice before completion leaves Settings=2031-10-31 and the record=2031-11-30. The reverse click order produces the same swapped conflict. The accepted first authority choice is undone on the other side, and the card remains in conflict. No settled user decision reconciles the pair. This is confirmed by two real-SQLite failing tests, not a speculative timing concern.

Reproduce before fixing:
- Use Node22: export PATH=/opt/homebrew/opt/node@22/bin:$PATH
- Copy docs/evidence/sweep-followups-review-2026-10-15/medical-review-diagnostic.test.ts.txt to src/pages/PilotToolkit/SweepReviewerDiagnostic.test.ts (first verify the destination does not exist).
- Run npx vitest run src/pages/PilotToolkit/SweepReviewerDiagnostic.test.ts -t 'independent reviewer diagnostics'. Current result is exit1, two failures; the five copied original tests are filtered out. The harness queues a no-op through the actual AppDataProvider mutation queue to await write completion; it uses no sleeps or fake timers.
- Preserve the frozen diagnostic unchanged in evidence. Remove only the exact temporary source copy after running it, including on failure.

Required behavior and bounded implementation:
1. The first accepted authority action owns the pending reconciliation. Acquire a synchronous guard before invoking/awaiting a write so two events before a React render cannot submit opposite actions. Disable both authority buttons and expose an accessible pending indication until the outcome is known. Keep hooks unconditional even when no conflict exists.
2. Validate the displayed reconciliation target and both dates against fresh repository state inside the existing serialized mutation boundary before writing. A stale callback must not overwrite newer dates, a removed/replaced record, or the outcome of a prior choice after tab unmount/remount. Refuse stale authority and refresh/re-present the current conflict instead. Keep this narrow; no schema, global queue rewrite or generic workflow framework is needed.
3. A successful choice changes only its counterpart: record-authoritative updates only profile.medicalExpiry; Settings-authoritative updates only the displayed medical record's expiresOn. Preserve all other profile/Toolkit fields and earlier records. Keep both source dates visible until a choice is accepted. No automatic reconciliation on load.
4. Release the pending guard after a failed write, retain both persisted values, let the existing error surface report the failure and permit a deliberate retry. Do not announce reconciliation success on a failed mutation. Preserve the existing distinction between acknowledged writes and refresh failures; never resubmit an acknowledged write automatically.

Regression acceptance:
- Promote both frozen opposite-click-order cases into permanent tests; both must pass after correction without weakening their reconciliation assertions.
- Add a held-write case proving both buttons disabled and one accepted operation before completion, including same-render events. After release, both values must equal the first selected date and the history record must remain byte-for-byte unchanged.
- Add failed-write then explicit-retry coverage, proving failure makes no counterpart change, unlocks controls and the retry reconciles the intended pair.
- Add one stale-target/source case (changed/deleted medical record or changed Settings while work is queued) and tab-remount coverage as applicable to the guard ownership. Assert no stale overwrite, not merely rendered text.
- Preserve the existing five medical UI tests, flight-time logic/UI tests, both authority directions, history preservation and no-write-before-choice assertions.

Verification and delivery:
Run focused regressions first, then npm test, npm run typecheck, npm run build, and git diff --check. No full native rebuild or unchanged Rust matrix is required for this bounded frontend correction; normal exact-head CI will run its required full gate after independent acceptance. Do not skip/weaken tests, change dependencies, migrations, backup rules, app version, bundle ID or provider behavior. No app launch, installation, hfdtest or real profiles/data.

Keep the original review receipts and diagnostic immutable. Write a new correction receipt/report with exact argv, runtime, exits and counts, update Claude's report/ROADMAP submission status honestly, and provide a fresh changed-source manifest. Leave changes uncommitted/unpushed for senior re-review. Do not open/merge a product PR. Stop after handoff.
```
