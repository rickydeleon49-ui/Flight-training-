# Navigation and study-export integration acceptance

**ACCEPT the combined reviewed source for main integration.** PR193 contains PR189's complete reviewed head69768bf, current main3e59d71, the independently reviewed export correction27c3971 and Claude's acceptance PR203 (merged into the export branch atc99fcb2). The containing final PR193 head must pass normal exact-head CI before merge. This lands both reviewed features together and removes P54-05 PartA's save-API prerequisite.

## Review and source identity

- Navigation's R11/R12 correction has Claude's independent acceptance; NAV-UI-01 has Codex's independent acceptance. Their actual source remains unchanged. Earlier R1–R10 reviews and receipts remain intact.
- Claude's new export-save acceptance is limited to Codex's three-path correction, with the original feature authorship disclosed. The three frozen hashes match, all15 acceptance receipts verify from Git, and PR203's exact headf848729 passed CI39009240463 before merging into the export branch.
- Codex reviewed the resulting export integration, packet/handout privacy and save contracts, native command registration and the combined material-detail UI. No blocker remains in this integrated source.
- Only `MaterialDetail.tsx` and `lib.rs` combine the two features' source contributions. Both the export dialog and navigation UI are retained, and both sets of native commands are registered. Other feature-specific application files are byte-identical to their reviewed feature heads. `source-reconciliation.json` records the comparisons.
- Current main and both tracker histories are retained. The schema14 helper remains pinned to its historical contract; the accepted schema15-aware regression updates come from navigation. Current tracker bindings and their manifest checksums are refreshed without changing historical evidence.

## Independent combined verification

One sequential gate on Node22 / scoped SDK26.5, without overlapping local matrices:

- Full frontend: **3,563 pass /6 skip**, no unhandled errors.
- Typecheck and production web build: pass.
- Full Mac Rust library suite: **531 pass /6 ignored, exit0**.
- Strict all-target Clippy, fmt, cargo-lock sync, helper26/26 and diff hygiene: pass.

The raw stage logs and exits are preserved in [integration evidence](evidence/nav-export-integration-2026-10-17/README.md). No full application matrix was repeated solely to edit the final report; a post-report helper/hygiene check verifies refreshed bindings. The final containing PR supplies the current-base CI receipt and exact merge identity.

## Integration route and next task

PR193 is retargeted to current main and includes PR189 as an ancestor. Merge PR193 normally only after its exact head is green. Because that merge contains all PR189 commits, GitHub can mark PR189 merged through the same integration; verify both states and ancestry afterwards. Do not squash away the navigation ancestry or bypass required checks. PR203 is already merged into the export feature branch.

The previous `P54_05_NEXT_IMPLEMENTER_PROMPT` Phase1 is complete. The next task is approved **P54-05 PartA, the lesson brief**. [Direct implementation assignment](P54_05_LESSON_BRIEF_IMPLEMENTATION_PROMPT_2026-10-17.md). The calendar writer remains a later separately reviewed part. Existing owner scope/default approvals persist; no repeat questionnaire is needed.

## Evidence boundaries

This is source integration, not an installed or release acceptance. No app launch, profile/key, provider call, installer build, signing, version bump or release publication occurred. Native tests and web build used disposable test data. The primary settings change and active implementer checkouts were preserved; integration used the existing reviewer worktree. Installed reader jumping, native save-dialog interaction, WebKit printing, VoiceOver and Windows observations remain distinct from these local/CI checks.
