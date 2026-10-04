# Independent review of Mac A2 verification — 4 October 2026

**Decision: request bounded verification/evidence corrections (MVER-R1–R3).** A2's accepted production source and PR #78 remain accepted. This review finds no production failure; it does not yet accept the submitted broad Mac-verification verdict. [Claude correction assignment](CLAUDE_MAC_A2_VERIFICATION_CORRECTIONS_PROMPT_2026-10-04.md).

## Reviewed identity and evidence

Submitted uncommitted branch `claude/mac-a2-verification-2026-10-04`, HEAD `1efc052391ed96bdf1af17294f9ddc71960fc906`, tree `1b5bcd9d289f06ebb34c7cfd9992a2c8849ec9c0`; accepted A2 merge `5587251` is an ancestor. The original primary checkout remains on its earlier dirty branch. No implementer file was edited, switched or reset by this review.

Codex independently checked all **24 accepted source Git blobs**, current working-byte comparisons, the three tracker diffs, current report/README/results, and all 15 retained logs. [Frozen inventory](evidence/mac-a2-verification-review-2026-10-04/submitted-artifact-hashes.json) identifies all 22 submitted artifacts, including ignored logs. There was no supplied changed-artifact hash manifest; these are independently captured current-byte identities.

The logs support 181 diagnostic passes and 57 conditional passed-case names (52 QT-11b, two QT-02b, one each BD-05/06/11); the prepared source requires each seam to fire. Focused log supports eight files/1,470 passes. Complete log supports 2,348 frontend passes/four skips, 286 Rust passes/six ignores, and 29 Unix helper passes. Host native log reports 20 harness passes with one distinct-case early return; the case-sensitive log reports 20 passes without that return. These are implementer executions independently inspected, not freshly rerun suites or disjoint counts to sum.

Codex ran scoped `cargo fmt --check` and tracked whitespace checks: exit 0. An initial reviewer attempt omitted the toolchain PATH and returned 101 (cargo-fmt unavailable); the corrected scoped run passed without install or source changes. Codex also ran a tiny synthetic Rust canonicalization control: case aliases exist, canonical paths compare equal, and device/inode match. It validates that filesystem premise only; it does not execute native delete/trash and cannot close R1. No full matrix, app, real profile, provider, installed or APFS-image procedure was rerun by Codex.

## MVER-R1 — P2: required Mac case-alias operation coverage is absent

`src-tauri/src/documents_save_tests.rs:503–525` gates the only deletion-and-trash case-alias regression with `#[cfg(windows)]`. The additional uppercase legacy aliases at line 555 are also Windows-gated. The Mac host log has neither operation assertion. Passing the directory-symlink/slash cases or distinct-case cleanup on another volume does not verify case-insensitive alias protection on the Mac host.

The accepted Mac prompt explicitly requires host case-insensitive protection. Add a Mac-applicable, capability-checked native regression for both delete and trash, preserving original bytes/reference rows and empty trash after refusal. Do not weaken the existing Windows case. Report missing coverage and cfg/early-return exclusions until exercised. The report's opening/all-boundaries verdict (`docs/MAC_A2_VERIFICATION_2026-10-04.md:3,152`) is premature. This is a confirmed coverage gap, not a demonstrated source defect.

## MVER-R2 — P2: current report claims do not match retained receipts

1. Report line 141, README line 119 and tracker header advertise **10 PASS/2 UNVERIFIED**. Text receipt does show that at 20:35:10 UTC. The separately generated JSON at 20:35:13 UTC instead shows **9 PASS/3 UNVERIFIED**, with `R-SOURCE` dirty/untracked=1 (JSON lines 81–89,193–204). Preserve and label both invocations; don't present them as one identical snapshot. Redirecting output into the checkout may itself explain the extra untracked artifact, but this review does not assert an unrecorded command-state history. `P-A2-SOURCE` remains a generic manual check even though publication is separately verified; installed readiness remains false.
2. Report line 32/README line 36 claim all 15 byte differences reproduce exactly as CRLF. Independently: **nine direct**, **14 full-CRLF reconstructed**, **one raw reconstruction unresolved**, while all 24 Git blobs match. For `src/perf/studyLibraryScenarios.test.ts`, working/blob bytes are 13,773 / SHA-256 `7d77d92c…`; full CRLF is 14,073 / `b365b4f6…`; manifest working bytes are 14,028 / `663c385c…`. The Git blob is the accepted `7140950205dec1b2c55a6de0a1aaeaea05c6b5ea`. This is not evidence of source drift; it disproves the stated full-CRLF reconstruction. Mixed original endings are a possible explanation, not an independently reproduced fact.
3. Current report host values 5.48 s/456.95 ms and case-sensitive 5.78 s/478.23 ms/5.21 s do not describe the retained logs. Retained values are host **5.45 s /469.290916 ms**, sensitive **5.82 s /475.261958 ms /5.225525417 s**. Relabel older observations or cite the retained run. `results.json` also rounds host/sensitive durations to 5.0/6.0; don't call these exact measured receipts.
4. Handoff commands mostly pipe to tee then print `$?`, the tee status, rather than preserve the program status. None of the 15 saved logs contains an exit marker; fmt and whitespace logs are empty. Completed positive test/build summaries are useful evidence, but handwritten `exitCode:0` cannot be called an independently captured command-exit receipt. Preserve historical outputs, label reported versus captured statuses, and capture true exits for new focused checks plus inexpensive fmt/whitespace. Repeating unchanged full matrices just for metadata is unnecessary.

Align the report, README, results references and all three trackers; scope conclusions to observed cases and keep Codex acceptance pending.

## MVER-R3 — P2: 15 linked logs are ignored and the handoff lacks artifact hashes

`.gitignore:120` ignores `*.log`. All 15 report-linked receipts are absent from ordinary `git status`/add, although present locally. A normal reviewed commit would publish report links without their actual logs. Prepare narrowly allowlisted tracked `.txt` copies (or explicit equivalent inventory), verify byte identities, update links/JSON paths, and preserve originals. Do not weaken global ignore protection. Supply final changed-artifact SHA-256 values; distinguish expected test-only additions from inherited source identities.

## Scope and next action

[Selected receipts and reviewer observations](evidence/mac-a2-verification-review-2026-10-04/README.md) provide the reproduction evidence. The subject report remains uncommitted in its existing checkout; this publication contains independent review documents only, not acceptance or publication of that report.

Claude owns the focused correction. Retain successful source evidence, add the missing operation case, reconcile metadata, then return uncommitted for re-review. Real-user check-in remains waived. Installed Mac/WKWebView/VoiceOver, signing, release and separate Slice B decisions remain separate; no new feature or owner approval is requested here.
