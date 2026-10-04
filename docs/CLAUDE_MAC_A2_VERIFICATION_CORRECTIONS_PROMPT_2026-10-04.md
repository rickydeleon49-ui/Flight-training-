# Claude: bounded Mac A2 verification corrections — 4 October 2026

Continue your existing uncommitted Mac verification branch in `/Users/rickymac/code/Flight-training-pr70-integration`. Codex requests MVER-R1–R3 corrections; accepted A2 production source remains accepted. Read `docs/MAC_A2_VERIFICATION_REVIEW_2026-10-04.md` and its evidence from current GitHub main or the containing review PR. Do not merge review-document changes over your dirty files blindly.

## Preserve and verify the handoff

Before editing, compare all 22 current artifact hashes with `docs/evidence/mac-a2-verification-review-2026-10-04/submitted-artifact-hashes.json`, including the 15 ignored logs. Confirm HEAD `1efc052391ed96bdf1af17294f9ddc71960fc906`, the existing branch/status, accepted A2 ancestor and 24 source blob identities. If anything differs, identify the competing change before dependent edits. Preserve the primary checkout and all existing raw logs/JSON/results. Record new evidence separately rather than overwriting historical receipts.

## MVER-R1: actually exercise the missing Mac case-alias operation

The only delete-and-trash case-alias test is `#[cfg(windows)]`; the Mac host run never executes it. Add a focused Mac-applicable native test using the existing disposable Profile and actual registered migrations. First establish that differently cased names resolve to one existing physical file on the host volume. Attach the original spelling, then request deletion and trash through alternate case spellings. Assert both operations refuse, original bytes/hash and all reference rows remain unchanged after reopen, and no trash/file debris is introduced. Keep the Windows regression intact. An unsupported/case-sensitive fixture must be reported as an explicit capability exclusion, never silently counted as executed protection.

Run the new case on the case-insensitive host and the relevant native save group. Preserve distinct-case APFS evidence; repeat its bounded test only if the new test or changed shared code warrants it. No production change is expected. If the operation really fails, stop with the actual reproduction and propose a minimal correction instead of silently expanding scope. Keep test-only helpers out of production.

## MVER-R2: reconcile the report with retained observations

- The text preflight is 10 PASS/2 UNVERIFIED; the separately generated JSON is 9 PASS/3 UNVERIFIED and records `R-SOURCE` dirty with one untracked file. Keep both snapshots and describe their separate invocations. Any new preflight should be captured once outside the checkout, with its real exit status and observed source state, then copied in. Do not clear real dirty files, add fake readiness flags or weaken the checker. The generic `P-A2-SOURCE` output needs annotation against separately verified PR #78 publication, not a fabricated tool pass.
- Accepted source identities are 24/24 Git blobs. Working-byte comparisons are nine direct matches, fourteen full-CRLF reconstructions and one unresolved raw-byte reconstruction (`src/perf/studyLibraryScenarios.test.ts`). Its working blob is correct; do not modify source or the accepted manifest to force the Windows working SHA. State the distinction accurately unless you obtain the actual original mixed-newline bytes and prove the reconstruction.
- Use retained log measurements, or explicitly label earlier unretained observations. Current host log says 5.45 s / 469.290916 ms transient; case-sensitive log says 5.82 s / 475.261958 ms transient / 5.225525417 s permanent. Avoid presenting rounded handwritten results.json durations as measured exact receipts.
- Most original gates used `command | tee; echo $?`, which reports tee status; logs lack captured exit markers and fmt/whitespace logs are empty. Keep the successful test/build outputs as evidence, but label historical exits as implementer-reported unless a real command-status receipt exists. Do not invent replacement historical statuses. Capture actual status for new focused checks and inexpensive fmt/whitespace checks using an explicit exit-preserving runner. Do not repeat the full frontend/Rust matrix solely to repair receipt metadata.
- Update report, README, JSON references, STATUS, PROJECT_HANDOFF and MAC_PARITY_CHECKLIST together. Mark Codex re-review pending; distinguish the host harness's 20 passed names from 19 exercised cases plus one case-sensitive early return. Enumerate cfg/early-return exclusions. Scope the verdict to observed cases; do not claim every native APFS boundary is verified while required coverage is absent.

## MVER-R3: make evidence publishable and identifiable

All 15 `.log` files are ignored by the repository-wide `*.log` rule. Prepare allowlisted byte-identical `.txt` copies, or an equally explicit tracked evidence inventory, and update all report/README/JSON references. Preserve originals and record old-to-new hashes. Do not remove the global ignore rule or force-add unrelated ignored output. Validate that each intended receipt exists, is not ignored, and will be included in the eventual reviewed commit. Inspect receipts for actual private data before publication; synthetic records may remain.

Provide SHA-256 hashes for every changed/new artifact, distinguishing accepted baseline source from the expected new test-only change. Report focused commands, real exit codes, test counts, skip identities and new evidence locations. Keep old failed/contradictory receipts.

Stop with corrections/evidence uncommitted and unpushed for Codex re-review. No full unchanged matrix, real app/profile, provider call, signing, install or release. The real-user check-in waiver remains in force; do not request it again. No Slice B/C implementation or new dependency is assigned.
