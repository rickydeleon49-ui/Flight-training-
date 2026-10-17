# NAV-UI-01 [P3]: panel notices bound to their context — implementation report

**IMPLEMENTED, PENDING INDEPENDENT REVIEW; NO SELF-MERGE.** Claude implemented this as the scoped follow-up from the [quick roadmap review](QUICK_ROADMAP_CODE_REVIEW_2026-10-16.md). It is stacked on PR189 head b5e6b99 because it needs the navigation code. Codex reviews and merges it. Accepted R11/R12 source is unchanged.

## Change

`src/pages/StudyLibrary/navigation/DocumentPagesPanel.tsx` gives each repository/controller/material context of the mounted panel its own notice owner. The owner is created in an effect keyed on `[repo, controller, material.id]`. When that context retires, its owner is dropped and any shown `checkNote`/`actionError` is cleared. Each action captures the owner before it awaits and publishes its notice only if that owner is still current. A held completion therefore cannot repopulate a notice after the clear. This applies to the demonstrated Check pages path and to the two analogous post-await notices in the same panel: the read-mark failure and the bookmark-removal failure.

Pending flags still reset in `finally`, so controls never stay disabled, and the removal dialog still closes. Nothing else changed: persistence, the hook's leases, write/hash guards, opener behavior, schemas and dependencies.

## Tests

`DocumentPagesPanelNotices.test.ts`, 7 permanent cases, built on the review's frozen diagnostic. They use the real hook and controller with deterministic stand-in repositories:

- **A retired check's success, and its failure:** neither is shown over repository B, and B's 70-page state stays intact.
- **A retired bookmark-removal failure:** not shown over B.
- **A notice already shown for A:** cleared when the repository changes.
- **A check completing after unmount:** does nothing.
- **Positive controls:** a current check still announces a changed file and still shows its failure.

On the unfixed panel (b5e6b99), 4 of the 7 fail: both retired check outcomes, the retired removal, and the clear on repository change. The unmount case and the two controls pass on both. With the fix, all 7 pass.

## Verification (local, Node 22.23.3)

- **Frozen diagnostic:** `frozen-panel-notice.test.ts`, copied beside the panel and removed afterwards, 2/2 pass (previously 2 failures).
- **Navigation suites:** 6 files, 101/101 pass.
- **Typecheck and production build:** pass.
- **Full frontend suite:** 3,527 pass / 6 skipped. This ran before a one-word type correction in the new test fixture (`status: "verified"`), which has no runtime effect.
- **Helper:** 26/26.
- **Not run:** no native code changed, so native tests and Clippy were not rerun.

Source-level only: installed WebKit, VoiceOver and real reader behavior remain unverified. No app launch, profile/key, provider, installer, signing or release operation occurred.
