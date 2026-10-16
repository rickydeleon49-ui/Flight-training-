# Sweep follow-ups — independent acceptance, 15 October 2026

**ACCEPT for integration through the normal exact-head CI gate.** SWEEP-R1 is closed in the reviewed source. No further blocking defect found. This accepts SWEEP-1014-TIMES and SWEEP-1014-MEDICAL; it does not certify an installed app or authorize unrelated roadmap implementation.

Reviewed `/Users/rickymac/code/Flight-training-sweep-followups`, branch `claude/sweep-followups-2026-10-15`, base `f2a7090190c74fdc3779785ae3684049d16b2a0e`. The correction's 14 source/report hashes and all original/correction evidence checksums verified before review. Seven unchanged original implementation paths retain their first-review identities. Reviewer tracker updates and this acceptance are additional delivery metadata; frozen manifests remain snapshots of their original submissions, not perpetual tracker hashes.

## Source findings

- `PilotToolkit` owns the synchronous medical-choice ref/state guard, acquired before queueing. The card's hooks are unconditional, both buttons lock with an accessible pending message, and tab remount retains ownership.
- The single queued mutation reads current profile and Toolkit state and uses `reconcileMedicalDates` to validate both dates and record identity before a counterpart-only write. Stale choices write nothing; history and unrelated fields are preserved.
- A null/failed mutation unlocks in finally, exposes the existing error and allows an explicit retry. Acknowledged writes retain the provider's existing refresh-failure distinction and are not automatically repeated.
- Meaningful permanent tests exercise both original opposite-event orders, held pending state/write counts, save failure/retry, changed/deleted record and Settings, and tab switches. Assertions were not weakened. Claimed mutation checks without archived receipts are treated as implementation-reported only; independent acceptance rests on source inspection and rerun tests.
- The first review found no TIMES blocker. Its unchanged warnings and links remain read-only; persisted historical hours and totals remain intact, with reference caveats.

The latest-expiring-record heuristic remains explicitly limited; this review does not certify a legally current medical certificate. No new schema, backup/Rust, dependency, version or provider change is in this package.

## Independently rerun gate

Node22.23.3, synthetic disposable jsdom/SQLite. Exact outputs: [evidence](evidence/sweep-followups-rereview-2026-10-15/).

| Check | Actual result |
| --- | --- |
| Original frozen diagnostic copied byte-for-byte (SHA256 `529646ad0662771ecf360335b3e033b005d1cc89b35e13b6f8c0f9dc4fb78636`) | 7 passed, exit0; temporary source copy removed |
| `npm test` | 3,221 passed / 6 skipped; 141 files passed / 4 skipped; exit0 |
| `npm run typecheck` | exit0 |
| `npm run build` | exit0 |
| Submitted tracked source `git diff --check` | exit0 |

Two historical raw Vite receipts (`build.txt:23` in original review and correction evidence) retain the compiler's trailing space. The all-files check flags these receipt-only bytes; source/document hygiene is clean. Preserve raw receipts instead of relabelling or normalizing them. Original two-failure receipts remain intact. CI will run required Rust, formatting, Clippy, lockfile and helper checks on the exact submitted PR head; no unchanged local native rebuild is required for this frontend-only correction. The containing PR must record its exact final head, CI run and merge commit before integration is claimed.

## Roadmap handoff

The two SWEEP items are accepted, pending the containing PR's exact-head CI/merge. Next is the bounded QA-01/QA-02 follow-up in PR #167, then review the final v0.5.4 source/version identity. The existing local installer predates this sweep, so it does not include these fixes. Do not overwrite or silently relabel that candidate. M4 remains a separate prototype; M5 refunds/credits and requirements decisions remain open. The release need not await the entire future feature roadmap. Existing desktop-launch/hfdtest deferral persists; no app/profile launch, provider call, signing, installer build or publication occurred in this review.

For the next assigned implementer, read the full [model-neutral QA follow-up](https://github.com/rickydeleon49-ui/Flight-training-/blob/codex/local-v054-build-check/docs/MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Verify current main and branch ownership first; preserve this sweep and the old build evidence. Scope is the two verification-tool findings, not another application feature or rebuild. Leave implementation uncommitted/unpushed for independent review.
