# Finish the reviewed M4 and release-record corrections

Read the complete [independent review](M4_RELEASE_INDEPENDENT_REVIEW_2026-10-16.md), the earlier round4 assignment and your own round4 report. Correct M4-R33–R36 together, then repair PR178's RELREC-01 evidence omission. Do not merge either work item. The owner restored Codex review before any merge.

## Workspaces and identity

M4: `/Users/rickymac/code/Flight-training-m4-round4`, branch `claude/m4-round4-corrections`, submitted base `7e495580a48828c2c81cc4d8057e028acfc2a8eb`. Leave it uncommitted for review.

PR178: `/Users/rickymac/code/Flight-training-v055-record`, branch `claude/v055-release-record`, reviewed head `5e91ccddb3350e8e9e13572fb6ace94d9532712d`. Update this same PR after local corrections/checks; do not open a duplicate or merge it.

Fetch first. Read missing current documents through `git show origin/main:...` without pulling/resetting/stashing over dirty M4 work. Verify `reviewed-input-hashes.json` from the independent evidence before editing. Verify the submitted117 delivery,114 payload and64 outer checksums. Report competing changes precisely before touching affected files. Preserve all previous sealed receipts as historical evidence before generating corrected ones.

PR179 was independently accepted and merged. PR176/177 have received bounded retrospective source/artifact review. Do not redo those changes, modify release assets or infer that an actual paid Gemini call was tested. Separate optional GEM-01 wording/budget observations from this evidence-only assignment.

## R33 — durable reservation must fail closed

Remove best-effort error suppression around required claims initialization, reads and writes. An SQLite claim update failure must roll back and surface failure; it must never return a token. Make the claims schema/protocol explicit in the candidate evidence contract. Preserve saved page/hash/label/status and handle reservation errors honestly in the controller.

Promote the review's trigger-based reservation and stale-winner diagnostics into permanent meaningful tests. Cover creation/read/write failure as appropriate, successful reservations on two connections to one file-backed database, both completion orders, cancellation, restart and overflow. Keep all normal R28 cases and original R13 atomic/held-write proofs.

## R34 — authorize the exact claim at commit

Inside the same transaction as the tuple write, require the current durable, non-cancelled claim to match the supplied token. Reject no-claim, failed-read, stale and unreserved-future tokens without changing stored state. Do not turn the rule into another greater-than comparison or a compensating rewrite. If old fixtures need initialization, reserve genuine tokens in fixture setup while preserving their behavioral assertions. Document the smallest fixture-binding adapter if the frozen five diagnostics need one; do not edit their ordering or expectations.

Promote the reserve1/commit101 diagnostic. Add missing-claim/read-error tests and retain exact winning page/hash/printed-label/status assertions.

## R35 — verified reuse needs actual install execution evidence

Have the live install path write a real execution receipt: command, cwd, Node/npm versions, exit, stdout/stderr or their sealed references, and the digests of the resulting package/lock/required executing assets. Bind that receipt to what is reused.

The reuse route must reject a missing, malformed, failed or mismatched execution record; a matching engine file plus a hand-written command string is insufficient. Keep digest validation and successful-command attestation distinct. Preserve the current real npm10 installation receipt and the npm12 failure. Do not manufacture a zero-exit record or silently update the lockfile to make Node26/npm12 green.

Test the actual runner with missing evidence, exit42, mismatched cwd/artifact bindings, valid recorded reuse and live install failure. Each saved outcome must agree with its real exit. Keep the interrupted-run markers, tamper probes and two-stage manifest architecture.

## R36 — do not exempt active invented mutant IDs

Replace substring filtering of DOCUMENT/ROUND/CONDITIONAL/VIEWER/NAVIGATION with a precise distinction between actual document references and execution claims. Unknown active mutant IDs must fail regardless of their names. Historical examples must be explicitly delimited/labelled; merely containing the word historical is not an exemption for a current claim.

Promote `M99_NAVIGATION_NEVER_EXECUTED` to permanent checker and real-runner negative tests. Retain the executed-ID record, all16 guard-reversion mutants, missing-mutant/test/count checks and current report/README validation. Generate final claims from actual measured runs.

## Verification

Run the new independent diagnostics on the original reviewed specimens first; baseline is4 assertion failures on each Node lane. Run the unchanged earlier frozen five; baseline is5/5 pass on each. Then fix and rerun on your corrected pack using `M4_REVIEW_TARGET_PACK`.

Use focused tests first, then complete evidence runners sequentially in clean disposable copies:

1. Node22.23.3 with a captured live engine install.
2. Node26.10.0 with a genuinely validated recorded npm10 install/reuse lane, or a live install only if it actually succeeds. Preserve failures honestly.

Prepare accepted-main reference `e8720003a76be680812dfe3605d58e7eb6372d00` through the existing script. Preserve all72 prior mapped behaviors; legitimate fixture setup changes must not weaken them. Add meaningful regressions/mutants for the corrected guards. Record exact steps/counts/exits per lane, and complete payload/delivery/outer evidence inventories after final bytes. Never write a successful verification before it executes.

No application/Rust matrix, native build, app launch, profile access, provider call, dependency adoption or migration registration is needed. Dispose only of your own scratch clones and installed scratch packages after preserving receipts; do not recreate gigabytes of unrelated build output.

## RELREC-01 — repair PR178's evidence publication

The six native JPGs exist locally but are ignored and absent from the PR. Inspect them for synthetic-only content, explicitly stage those six paths, link them from the report, and add a complete report/evidence hash inventory. Keep the binary ARTIFACT_SHA256SUMS separate. Do not commit binaries, profiles, databases or keys, change global image-ignore rules, rebuild, repeat installed tests or replace published assets to repair this documentation omission.

Preserve raw receipts. Reconcile the PR178 branch with current accepted main, retain tracker history and the eight-item queue, refresh only current helper tracker hashes, verify checksums and staged whitespace, and push the bounded correction to the existing PR for fresh exact-head CI. Leave it open for Codex.

## Deliver and stop

Deliver one new M4 correction report, R33–R36-to-test/mutant mapping, exact final source/evidence hashes and two complete lane records. Keep the corrected M4 package uncommitted/unpushed for independent review. Summarize PR178's new exact head and its six tracked screenshot paths separately. Do not merge, start P54-01 production work, approve OD-1–OD-10 by implication, or register migration0015. Existing proposed decisions, app-installed limits and roadmap order remain intact.
