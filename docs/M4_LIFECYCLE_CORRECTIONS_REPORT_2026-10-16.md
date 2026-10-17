# M4 R11–R12 lifecycle corrections — implementation handoff

**Implemented by Codex; pending independent review. Do not self-merge.**

The owner assigned Codex implementation duties. Work is isolated in `/Users/rickymac/code/Flight-training-post-v054-roadmap`, branch `codex/m4-lifecycle-corrections`, stacked on PR189 `c234005185250f14b2f67bf5d977a5b67b853126`. Main `333db29b73af3e67f4c98132e8aa4cdbe50bf038` was merged at `2826f87`; both tracker histories and feature-specific schema15 helper test bindings were preserved. Claude's original branch/worktree and the dirty primary `.claude/settings.json` were untouched. Submit this correction to the PR189 branch before its final current-main integration.

## Changes and regression map

| Finding | Implementation | Permanent verification |
| --- | --- | --- |
| R11: a retired action's finally starts an old-context read | Each committed material/repository/lifetime owns a unique lease. All four actions capture it before awaiting work; follow-up reload refuses it before incrementing the read generation or dispatching a read. Retained old-context callbacks refuse before starting mutations. Existing latest-read publication checks remain. | `useDocumentNavigationLifecycle.test.ts`:24 cases; 4 actions × material/repository switch × success/rejection, current held-read loading/ownership, same-context refresh for each action, retained callbacks, unmount and actual root StrictMode replay. |
| R12: an older completion erases a newer cleanup marker | Each click owns a unique controller+epoch object; finally clears only its own marker. Cleanup aborts only that controller's still-working matching epoch. Page/material changes retire old intent. Notices additionally bind controller and reference, preventing colliding-controller epochs from showing an unrelated notice. | `SourcePageBadgeLifecycle.test.ts`:9 cases; overlapping null/error/success completions, controller replacement, other-badge ownership, changed citation, live guidance and single-request unmount controls, colliding notice epochs. |

An operation already sent to storage or the OS is not claimed undone. These changes refuse subsequent obsolete dispatch/publication. No schema, native command, dependency, version or persistence-contract change.

## Verification

- Frozen R11/R12 diagnostic files run byte-for-byte:4/4 pass; temporary copies removed.
- Focused new+related navigation suites:94 pass. New suites contribute33 permanent cases.
- Full frontend:3,488 pass /6 skipped; zero unhandled errors reported.
- Web production build (includes final typecheck), schema14 helper26/26, Rust fmt, lock sync and diff hygiene pass.
- Rust source is unchanged from PR189 c234005. Its exact-head CI38988724371 passed517 Rust tests/6 ignored. No new local native compilation or Clippy run is represented here; final correction CI must run native checks on the new head.
- First focused run:32 pass/1 fail due to a test using nested StrictMode rather than testing-library's root StrictMode. Preserved receipt; corrected harness now proves real replay. No expectation or production guard weakened.

[Evidence](evidence/m4-lifecycle-corrections-2026-10-16/README.md) includes raw exits, receipts and four-path source hashes. Installed reader behavior, WKWebView, VoiceOver and Mac release verification remain unverified by this source-only round.

## Next independent reviewer

Read `docs/M4_LIFECYCLE_REVIEWER_PROMPT_2026-10-16.md`. Review the four-path correction relative to c234005, not the entire accepted prototype again. R11/R12 are implemented, not accepted. Keep PR189 and this correction unmerged until independent source review and exact-head CI pass. P54-03/#191 and P54-04/#193 remain separate work; queue order is unchanged.
