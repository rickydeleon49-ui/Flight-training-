# Mac is the primary development and user platform

Current follow-up: [R1–R3 baseline corrections accepted](MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md). This document preserves the earlier assignment/review snapshot; [the next Claude prompt is A3 compatibility](CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md), after the publication PR merges.

Owner decision, 2 October 2026: the main user will run Her Flight Deck on the Mac. Treat this physical Mac as the primary development, validation and everyday-use target. Keep the shared React/TypeScript/Tauri/SQLite application and preserve Windows compatibility; this decision does not require a separate Mac fork.

## Source and ownership

GitHub remains the shared source of truth. Reviewed application changes must reach current main and be fetched into this Mac before claiming they are available to its user. Claude implements; Codex independently reviews and handles reviewed Git/CI/merge; Gemini performs only assigned security work.

The existing Mac clone is `/Users/rickymac/code/Flight-training-`. Claude is actively implementing the synthetic Study Library baseline on `codex/mac-study-library-baseline`, starting from main `a4339fc`. Preserve that branch and its uncommitted work. Codex used a separate temporary documentation worktree to publish this decision without switching Claude's checkout or including unfinished benchmark source.

A2 R6/R7 remains uncommitted on Windows at `fix/atomic-study-material-saves`; it has not appeared on the GitHub branches inspected for this decision. Its review contract and evidence are shared, but its production source is not available to the Mac. Complete the existing owner's correction/review handoff, publish accepted source through a scoped reviewed PR, then fetch/reconcile it here and verify the real persistence and file-ownership boundaries on macOS. Do not reconstruct that source from summaries, claim it transferred, or push a known-failing patch merely to share it. If ownership is transferred, record that explicitly and preserve the original work.

## Order after the active baseline handoff

1. Review Claude's current bounded baseline and share its sanitized evidence. Use it to retain or reject conditional performance dependencies; producing a benchmark does not authorize production optimization.
2. Bring accepted A2 source to the Mac through GitHub and prove save/replacement/Cancel/retry conservation, tag replacement and attachment ownership. While the source is unavailable, independent Mac compatibility work may progress in a separately assigned scope without editing the owner's files.
3. Assign A3 minimum-WebKit compatibility, then A4 saved guide/cards/test visibility offline, and A6 truthful retry messaging as separate reviewed corrections. Preserve macOS 12 support unless the owner explicitly changes that policy. Reconcile old A5 test-kit items with already-merged fixes instead of redoing them.
4. Resolve the actual signing/notarization path and use a dedicated standard synthetic test account for installed-app verification. The current local evaluation DMG builds, but its command-line Gatekeeper assessment rejects its ad hoc/resource signature. This is not an installed first-launch result. Do not bypass Gatekeeper or launch against the owner's real profile.
5. Complete the installed smoke matrix below before treating the Mac app as dependable for the main user's data. Only then designate/test an approved distributable candidate through the separate release/version process.
6. Continue the roadmap and selected open-source components in the agreed order: measured search/rendering pilots where justified, M2 identity/history after the user check-in, bounded structured outside-assistant import, and later embedded reader work. No blanket package installation, iOS implementation or M2 migration follows from selecting the Mac as primary.

## Installed Mac acceptance

Record exact tested source and DMG hashes, account isolation, OS/toolchain, individual results and evidence. Rebuilds have new identities; a prior source-test pass does not certify changed bytes.

- Normal install/first launch and understood signing/Gatekeeper behavior; version, resizing, keyboard, focus and dialogs.
- PDF import, source relocation, app-owned survival, default-viewer Open, Finder Reveal and Settings folder agreement.
- Metadata/tag create/edit/replace/clear, failed-save retry and Cancel with old/new attachment conservation.
- Automatic and manual long/image-heavy splitting, valid/invalid ranges, every page once/in order, actual byte/page limits, original hashes, rollback/cleanup, UI responsiveness and memory.
- Concurrent save/split/complete backup to Downloads, bounded contention, finalized archive integrity and credential exclusion.
- Valid synthetic restore, damaged-archive refusal and recoverable original data, conserved record/document identities, restart recovery and populated-data upgrade between separately identified builds.
- Saved guide/flashcards/practice tests offline and without Gemini configuration; explicit optional live generation only when separately enabled for a selected synthetic source.
- Case-insensitive/symlink behavior on this Mac; case-sensitive volume and early macOS 12 coverage remain unavailable until actually observed.

The owner still needs to provide a dedicated standard test account. Signing credentials/certificates and a successful installed launch are not established. Keep these blockers visible; do not substitute Node/jsdom measurements or development mode for installed WKWebView evidence.

## What belongs on GitHub

Publish reviewed source, maintained tests, plans, prompts, decisions and sanitized verification receipts. Keep API keys/tokens, real profiles/databases, private uploads, generated large PDFs, dependency/build trees and installers out of source commits. For installers record exact location/size/hash and use the approved artifact/release channel when authorized.

[Mac report](MAC_SMOKE_RESULTS_2026-10-02.md), [shared sanitized receipt](evidence/mac-source-evaluation-2026-10-02/VERIFICATION_RECEIPT.md), [Claude baseline prompt](CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md), [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md), and [installed test checklist](MAC_PARITY_CHECKLIST.md) remain the detailed references.

Windows distribution remains held on v0.5.1, v0.5.2 remains retired, and the frozen private v0.5.3 Mac candidate remains unchanged. This primary-platform decision authorizes project coordination and Mac validation work; it does not certify or publish a release.
