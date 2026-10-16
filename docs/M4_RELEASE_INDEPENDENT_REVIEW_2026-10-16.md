# M4 round 4 and release follow-ups — independent review, 16 October 2026

**M4: CORRECTIONS REQUIRED (R33–R36). PR178: evidence correction required (RELREC-01). PR176/177: retrospective source review completed with the limits below. PR179: accepted and merged after exact-head checks.** No M4 production adoption is approved by this review. The confirmed M4 defects are in the evidence-only prototype, not the released application.

## Identity and independent verification

M4 submission: `/Users/rickymac/code/Flight-training-m4-round4`, `claude/m4-round4-corrections`, HEAD `7e495580a48828c2c81cc4d8057e028acfc2a8eb`, uncommitted docs/evidence. Read the full round4 assignment, round3 independent review, current report and actual controller/protocol/runner/checks/tests. The submitted delivery117, payload114 and outer64 checksums all verify. A complete local documentation inventory was frozen before execution; the published focused input inventory seals the delivered pack and current report. The ten round3 hashes were superseded in Gemini's live work as disclosed; only the preserved earlier specimens support historical reproduction. No unseen older files were reconstructed or declared reviewed.

Runs used clean disposable clones, sequentially:

- Node22.23.3: captured live npm10 engine install; full runner **59 proof +10 lifecycle +3 sensitivity =72 mapped tests**,16 executed mutants,24 steps, exit0.
- Node26.10.0: reused the engine bytes installed by that independently captured Node22 command; full runner **72 mapped tests**,16 mutants,23 steps, exit0. This review does not claim a Node26/npm12 live install succeeded.
- Unchanged prior frozen diagnostics: **5/5 pass on each lane**.
- Four new focused diagnostics: **0/4 pass, exit1 by assertion on both lanes**. Two additional real-runner fault probes incorrectly exit0 and print success, described below.

The prior 72 cases, meaningful new tests and measured receipts are useful progress. They do not cover the remaining failing boundaries. All work in Claude's and Gemini's submitted checkouts was preserved; no app, profile, key, provider, signing or installer build was accessed or changed by the reviewer. Published DMGs and the installed v0.5.5 executable were read and hashed only.

## M4-R33 — P1: a failed claim write still returns ownership

`proof/persistenceProtocol.mjs:65–75,91–97,116–127` suppresses claims-table creation/read/write errors. A real SQLite `BEFORE UPDATE` trigger that raises ABORT on `material_operation_claims` does not make `reserveOperationOwnership` fail: it returns the next token although that token was never stored.

Independent reproduction: seed page5/owner1, block claim updates, reserve twice. Both calls return2. The earlier page10 commit succeeds; the newer page20 commit is rejected; page10 wins. No durable later claim exists because its write failed, but both callers were told ownership was acquired. The trigger is confined to disposable test databases.

Fix: fail closed on required DDL/read/write errors, roll back and surface the actual reservation failure. Return a token only after its durable claim commits. Make claims initialization part of the declared candidate protocol rather than best-effort hidden schema creation. Preserve prior reading state on failure and cover controller behavior when reservation fails. Do not recover with a second compensating position write.

Diagnostics: `reservation database failure must not return an unpersisted token`; `a blocked claim write cannot allocate equal tokens and make the earlier request win`.

## M4-R34 — P1: the commit boundary accepts an unreserved future token

`proof/persistenceProtocol.mjs`, inside `commitNavigation`, reads the claim but rejects only when the reserved generation is greater than both saved and incoming generations. It never requires incoming generation to equal the currently authorized claim. Claim-read errors are also suppressed.

Independent reproduction: reserve owner1, then call `commitNavigation(destination,101)`. It reports committed and creates an active reading-state row even though101 was never reserved. The contract requires authorization by the current durable token, not simply a sufficiently large caller number.

Fix: inside the same write transaction, require an existing, successfully read, matching, non-cancelled claim. Reject absent, stale, future/unreserved or unreadable ownership without changing the tuple. Handle any required legacy/bootstrap state explicitly; do not leave a fail-open fallback. Update legitimate test fixture setup to reserve tokens where the protocol now requires them, preserving behavioral assertions and the original held-write tests. Document any minimal fixture-binding adapter for frozen diagnostics.

Diagnostic: `commit must reject a generation that was never the reserved owner`.

## M4-R35 — P1: reuse attests installation without validating an execution record

`scripts/run_integration_proof.mjs` verified-reuse branch computes `reuseOk` from package.json, lockfile and one engine-file digest. The consumed `scratch-artifacts.json` has a claimed command/date/node but no captured successful command exit/cwd record. The runner assigns a zero-exit reuse result and calls it consumption of a recorded install.

Real-runner reproduction, confined to a disposable Node26 clone: keep all artifact digests valid, set `installCommand` to a failed-install description, add `installExit:42` and a nonexistent install cwd. Runner exits0; `01b-engine-install.txt` says `mode: verified-reuse (consumed recorded install with verified artifacts)` and PASS. Missing or failed installation evidence is not validated at all. The review is not claiming that Claude's actual separately logged npm10 install failed; it is demonstrating the acceptance guard remains incomplete.

Fix: capture/consume a real install-execution receipt containing command, cwd, runtime/npm versions, exit and artifact bindings. Validate its required fields and successful outcome before reuse. Reject missing, malformed, failed and mismatched receipts. Keep byte-integrity verification distinct from evidence that an installation command succeeded. A JSON description generated by `record-scratch-artifacts.mjs` must not manufacture successful installation history. Test the real runner's reuse route, not just the formatting helper.

Evidence: `full-runner-probes.json`, `reuse-failed-install-probe.txt`, `reuse-failed-install-audit.txt`.

## M4-R36 — P2: certain invented active mutant IDs escape validation

`scripts/evidenceChecks.mjs:23–30` discards every matching mutant ID containing DOCUMENT, ROUND, CONDITIONAL, VIEWER or NAVIGATION. Those substrings are not proof that a token denotes a document rather than an execution claim.

Independent direct-check diagnostic and full-runner probe: add only the active claim `Current executed mutant: M99_NAVIGATION_NEVER_EXECUTED` to the current report. The real runner still exits0 with72 mapped tests and no failures. The fabricated mutant was never executed. The generic M99 test passes but does not cover this filter.

Fix: distinguish actual document references from mutant execution claims without exempting arbitrary mutant names. Preserve labelled historical specimens through explicit historical structure/markers, not a free-form substring escape. Add permanent tests against the shared checker and an end-to-end current-report probe for unknown IDs with these words; retain the existing count/test/missing-mutant checks and all16 meaningful mutants.

Diagnostic: `active unexecuted mutant claims cannot escape via NAVIGATION in their ID`. Evidence: `filtered-mutant-full-runner-probe.txt`, `filtered-mutant-traceability.txt`.

## RELREC-01 — P2: PR178 omits its six native screenshots

Reviewed PR178 head `5e91ccddb3350e8e9e13572fb6ace94d9532712d`. Its description promises screenshots, but none is in its Git tree. All six exist locally in `Flight-training-v055-record/docs/evidence/mac-v055-release-2026-10-16/screenshots/`; `git check-ignore` confirms the image-ignore rule excludes them. Another agent cannot inspect the promised visual evidence from the PR.

Fix in PR178: inspect and explicitly stage the six synthetic native JPGs without changing the global image-ignore policy, link them from the report, and add a complete report/evidence inventory and checksum file. Keep ARTIFACT_SHA256SUMS as the separate binary-artifact inventory; do not commit installers/profiles/databases/credentials. Refresh current tracker hashes only. Reconcile the branch with current accepted main and require checks on the new exact head. No native rerun or rebuild is needed merely to publish the existing receipts. `git show --check` on the reviewed PR178 commit passes.

## Retrospective release/source disposition

**PR176:** reviewed merge `ca41f78` and final PR head `3e19b17fe4fb46d69d821ba322be24ea70370b71`, CI38866468877 success. Policy change selects0.5.4; retired0.5.2 and held Windows remain intact. The accompanying import test waits for the actual async Regenerate control rather than racing it; no expectation was removed. Waived gates are recorded as owner-waived, not passed. Independently downloaded published v0.5.4 DMG matches `1048e4636190d07afcbf2da76fc38822cd13189552b03a0ed69265870857676d`, tag/sourcefbff255. No blocking source/artifact mismatch found.

**PR177:** reviewed merge `7e49558` and final PR head `ad0c0e85537e5b796a66c20b906eecc24cc9c726`, CI38939386423 success. Read the native model preference/default/fallback paths and frontend settings/send/result labels. Independently reran13 relevant frontend tests and typecheck, all pass. Full474 Rust/3251 frontend results are retained exact-head CI/implementer evidence, not a new local Rust run. Current [Google model/migration documentation](https://ai.google.dev/gemini-api/docs/latest-model?hl=en) supports the pinned model's existence and billing requirement; no paid request or quality benchmark was made. Existing8192 output-token and300-second bounds are below Google's recommended Argon starting budgets/timeouts: record as a follow-up evaluation concern, not a demonstrated failure. The Settings fallback wording is broader than the actual403 path, which reports an access/billing error instead of silently falling back; clarify it in a separate small GEM-01 follow-up rather than broaden permissions or claim live behavior passed. No independently demonstrated release-blocking source defect found in this bounded retrospective review.

**Published v0.5.5:** source/tag7e49558, downloaded asset matches `620ed7553476ef023df2df97428d3220d2bc771c8f8f0f3546549893f5471512`; installed executable matches `ee79164dc3892d34fa19b10858a65119e2f94c93463d3cc01bf102f5e972b528`. Repository/releases are private to collaborators. No release asset was replaced or republished. PR178's report still needs the evidence publication correction above. Paid generation, standard account, VoiceOver and other disclosed installed limits remain unverified.

**PR179:** accepted and merged as `b88e80ae47e720d95ffb8c394c916a69ef9aac95` after exact head `d39015902370a6172af86b222972a333cc64b278`, CI38943729439 success, current base and CLEAN merge state. Its owner-scoped exception follows [Apple's documented user-confirmed flow](https://support.apple.com/en-us/102445), requires the published checksum, and excludes malware detections, quarantine removal and global protection disablement. This is a policy-doc review, not an executed OS-security override. It does not turn unsigned/not-notarized builds into signed passes.

## Next work and preservation

Use [one correction handoff](M4_RELEASE_REVIEW_CORRECTIONS_PROMPT_2026-10-16.md). Keep M4 in its existing evidence-only checkout and repair PR178 in its separate existing branch. Preserve Gemini's original work and all failed/partial receipts. Do not start P54-01 production adoption or register0015 until M4 is accepted and the still-proposed OD-1–OD-10 decisions are resolved. The owner-selected feature order remains unchanged.

[Diagnostics, frozen specimens, exact inputs and receipts](evidence/m4-round4-independent-review-2026-10-16/README.md).
