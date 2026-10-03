# A3 compatibility re-review — 2 October 2026

**Completed review history:** [Final A3-R1–R4 source acceptance](MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md) supersedes the pending findings/instructions below. The [next Claude assignment is A4](CLAUDE_MAC_A4_OFFLINE_STUDY_PROMPT_2026-10-02.md), after required CI/merge.

**A3-R1–R3 are resolved; one nested-dialog blocker remains before accepting A3.** Claude's implementation is still local/uncommitted on `codex/mac-webkit-compatibility-a3`, base `8b61d8766a4aaf6a12443b9c48445ffe8cc43db7`.

Codex reviewed the two corrected files and their maintained regressions. Current-top exclusion fixes the previous sibling exposure; max-live-layer allocation fixes z-index reuse; restoration-target inheritance and validation fix lower-first focus return. All 15 source hashes match the updated implementation report; the other 13 match the earlier review.

## A3-R4 — P1: closing a parent hides its still-open nested fallback modal

Locations: `src/components/ui/useModalDialog.ts:226`, `src/components/ui/Dialog.tsx` (dialog children remain in their parent), and `src/components/ui/ui.css:321` (`dialog:not([open]) { display: none; }`).

Trigger: mount outer open / inner closed, open the inner, then set outer `open=false` while inner stays `open=true`. Cleanup removes the outer's open attribute, but the inner and its backdrop are still descendants of that closed dialog. The CSS hides that entire subtree. The hook nevertheless keeps the inner as its top entry and excludes the page, so the user can be left with an invisible active modal and its keyboard/background restrictions. If the inner refuses dismissal during cleanup, an Escape request cannot resolve that state.

Independent diagnostic confirmed the inner remained open with a `dialog:not([open])` ancestor. This is an observed DOM topology plus a direct consequence of the existing display-none rule, not an installed old-WebKit paint measurement. The existing nested regression closes the inner first and does not cover this parent-first lifecycle.

Required correction: make fallback presentation independent of a parent dialog's display/lifecycle while the child's owner keeps it open, preserving React/context ownership and controlled dismissal. A body-level React portal for fallback presentation is one possible approach. Do not silently force the parent open or dismiss the inner against its owner's state. Preserve top-modal exclusion, strict layers, focus restoration and cleanup. Include viewport backdrop/top-owner behavior for the nested presentation.

[Exact maintained-regression starting point](MAC_A3_NESTED_DIALOG_REVIEW_REGRESSION_2026-10-02.md). [Focused Claude correction prompt](CLAUDE_MAC_A3_NESTED_DIALOG_CORRECTION_PROMPT_2026-10-02.md).

## Verification and limits

- Codex focused command: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/components/ui/Dialog.fallback.test.ts src/components/quickfind/QuickFind.test.ts src/lib/id.test.ts src/logic/toolkitDefaults.test.ts src/state/legacyWebKitStartup.test.ts`: exit 0, **45 passed**, 748 ms.
- Independent parent-first nested diagnostic: same PATH, `npx --no-install vitest run src/components/ui/codexA3Nested.diagnostic.test.ts`: exit 1, **1 failed**, 396 ms. Temporary source removed after the run.
- An exploratory simultaneous parent/child-open test observed focus on the parent. This was not retained as a finding: the desired simultaneous-opening order was not established independently of the native path. The standalone parent-first diagnostic above is the confirmed blocker.
- Claude's corrected receipts report **647 frontend passed / 4 skipped**, build passed, **246 Rust passed / 6 ignored**, and green fmt/clippy/lock/diff checks. The new eight maintained stack regressions failed seven cases on the previous hook; Claude's verbatim first-review diagnostic now passes three cases. These are inspected implementer results, not a full Codex rerun.
- Codex did not rerun the full matrix, benchmark, DMG or installed app. Original source files/hashes were preserved. Old/current installed WKWebView, VoiceOver, Windows runtime and release holds remain open.

Corrected reviewed identities:

```text
7f7d43c4f967e1f50c59283acb4d4fdd5a0a246285bf46926fcdbff091aece8a  src/components/ui/useModalDialog.ts
637a43c2328efd4e122a8eae90cb2059d20cda706c17ddf14854abd7e8674e52  src/components/ui/Dialog.fallback.test.ts
```

Claude owns the one remaining fix, maintained regressions, sequential gate and report. No source commit/push or next roadmap feature is accepted by this review.
