# Schema14 follow-up F1–F3 — implementation and verification

15 October 2026. **Path A selected:** independently accepted package integrated unchanged through [PR #165](https://github.com/rickydeleon49-ui/Flight-training-/pull/165), merge `845052623b731d4955f15d820e91d1e7a60683ef`. This is the separate, non-blocking follow-up. No app build, install, launch, profile/account use, signing or publication was performed locally. Required repository CI retains its existing frontend/native compile and safety checks.

## Findings checked before editing

- **F1 confirmed:** Checks ran Vitest over `src/**/*.test.ts` and had no helper-test step. The new full-path step runs the exact schema14 Node test file; no glob, relaxed expectation or platform skip was added. Two added cases expand the suite from 21 to **23**: full-self-check mutant reporting and the actual legacy schema13 self-check. The core schema14 self-check remains mandatory at **102/102**; the legacy self-check must have exactly its intentional ceiling alarm (105/106, exit 1), no other failure.
- **F2 confirmed:** the proof deliberately rejects HEAD other than `16f9cf3`; committing it does not disable the HEAD/index/worktree protections. The canonical RUNBOOK now contains an executable post-merge reproduction. It verifies the committed manifest, overlays only the 22 named package paths onto a detached baseline worktree, runs 12 stages and removes the worktree. No proof pin or allowlist was modified.
- **F3 reproduced:** a disposable helper with the own-key map reverted to `{}` exited 1 with zero stdout bytes and an uncaught comparison refusal. One wording correction: the named special-key check runs before the later comparison crash; it was its JSON **report** that never appeared. The stored baseline preserves the exact failure.

## Changes

The self-check’s local comparison wrapper catches only `REFUSED:` errors, records each as an explicitly failed `comparison: <name> accepts its snapshots for <purpose>` check and carries an explicit REFUSED outcome through dependent checks. Other programming errors still throw. A dependent receipt-exclusion check now rejects REFUSED explicitly, so the fallback cannot accidentally satisfy it. Production compare/capture/metadata logic is untouched.

The new mutant regression parses the entire JSON report, requires exit 1, the named special-key failure and comparison refusal, an explicitly failed receipt-policy check, and passing final migration-anchor/leak checks. It proves completion rather than merely a nonzero exit. The distributed helper still exposes no test route; the mutation and adapter exist only in temporary copies.

The existing overlay `source-manifest.json` / SHA256SUMS are refreshed for the 20 current package paths plus manifest; prior accepted bytes remain recoverable from merge #165. Historical command/proof receipts are retained unchanged and are not assertions about newly modified bytes. A separate complete follow-up submission inventory covers the CI/report/evidence changes outside that overlay.

## Verification and receipts

[Evidence index](evidence/mac-schema14-followup-2026-10-15/README.md). Exact argv, cwd, runtime, stdout/stderr, exits and reproduction identity are retained there. The canonical walkthrough is [RUNBOOK §7](evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md#7-post-merge-source-only-reproduction-f2).

- Accepted package exact-head CI: run **38803089531**, head `8297e7bf2a6a306fa1807a5ba528b43cf1818a53`, SUCCESS; 3,202 frontend passed / 6 skipped, 464 Rust passed / 6 ignored, plus normal compile/type/format/lint/lock checks. [Run](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38803089531).
- The pre-integration default local full run failed an unchanged CardReviewPanel C1-R2 assertion (3,201 passed / 1 failed / 6 skipped). Its isolated suite passed 29/29 and the full suite at two workers passed 3,202 / 6 skipped. No unrelated test or product source was changed. Both outcomes are retained; default Linux CI passed before integration.
- Current helper suite: **23/23**, zero skips; unreverted self-check **102/102**. The default full local suite passes 3,202 / 6 skipped; typecheck, Cargo-lock and hygiene exit 0. F2 reproduction uses the exact documented procedure on a check-only local commit; its full receipt is included. Final exact-head CI identity and Linux helper count are recorded in the follow-up PR closeout after the gate completes.

F2 was executed from the exact RUNBOOK code against check-only local commit `bf9c95dabb6179a456de061199901bd5d7490b92`: exit 0, 12/12 stages, detached worktree removed, source checkout status unchanged. This local commit exists only for the reproduction check and was not pushed. The merged follow-up will be replayed again before closeout.

A direct run at integrated HEAD is expected to refuse source identity; its receipt is retained. That is not relabelled PASS. The reproducible detached overlay must pass all 12 stages. Full npm/type/lock/hygiene checks and all inventories remain required. Do not run a build, change a timeout/expectation to pass, or relabel installed behavior.

## Preservation and next action

The immutable `8a260c0` schema contract, baseline16f9cf3 proof HEAD/digest, exact three restore-only exclusions, defensive own-key union check, shipped migrations, frozen helpers and PR #142 evidence are preserved. Primary `/Users/rickymac/code/Flight-training-` is untouched. Original failed receipts remain available.

After the follow-up passes exact-head CI and integrates, the next task remains the selected **local unsigned v0.5.4 source/version preparation**. Current version files stay 0.5.3 here. Installed hfdtest, real profiles, Gatekeeper, packaged-Mac behavior, signing and publication remain deferred/unverified. M4 and proposed M5 requirements remain outside this assignment.
