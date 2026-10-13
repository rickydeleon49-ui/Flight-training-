# M4 round-3 independent review — 11 October 2026

**Verdict: CORRECTIONS REQUIRED, M4-R28–R32.** This is a review of Gemini's evidence-only prototype, not a finding that these defects have shipped in the Mac app. No M4 production adoption or owner-decision approval is implied.

## Reviewed identity and verification

Submission: worktree `Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, HEAD `c28ab8482c8635b0b2bf74686b081e02bf448f65`. Accepted main is `8a260c0`. Assignment: [round 3](https://github.com/rickydeleon49-ui/Flight-training-/blob/3039d7807be3bc859812565ee7f606da2d9314c3/docs/GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md) in open PR #148; its [round-2 review](https://github.com/rickydeleon49-ui/Flight-training-/blob/3039d7807be3bc859812565ee7f606da2d9314c3/docs/M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md) defines R23–R27. These documents were read from that existing review checkout, without changing it.

The delivered 45-entry SHA256SUMS verifies. Before running anything, 267 submitted files were hashed locally, excluding installed packages and extracted accepted-main scratch inputs. The relevant ten source/report/manifest hashes are published in the evidence pack; the complete local inventory is not uploaded. The three frozen published review packs match accepted main byte-for-byte: 55/55, 41/41 and 30/30. Tracked production status in the submitted checkout is clean. After review, all 267 locally frozen files still match; no writes were issued to that checkout.

All runs used disposable copies. Independent full runners reproduce **39 proof + 10 lifecycle + 3 sensitivity tests, 52 mapped tests, exit 0**, sequentially on Node **22.23.3** and **26.10.0**. Both legacy parser demonstrations and artifact checks pass. The original R13 held-write case and simple R24 late-retry case pass. A new five-case diagnostic fails by assertion **0 passed / 5 failed, exit 1 on both lanes**. No native/application matrix was repeated.

## Retain

The sequential cross-session restart fix works. A retry invoked after a newer same-controller operation is rejected before persistence. Preserve the original 52 passing tests, the 13 copy-mutant checks, destination/count/content guards, content-drift invalidation, migration14/candidate15 coexistence and rollback/lifecycle proofs. Prior-pack verification, added-file refusal in the subject inventory, explicit pinned-reference source and the runner's verify-only tamper rejection are useful corrections. These do not establish the remaining lifecycle and evidence guarantees below.

## Confirmed findings

### M4-R28 — P1: overlapping controllers still collide on generation

`proof/openerController.mjs:62–78` reads the last **committed** generation and adds one locally. `proof/persistenceProtocol.mjs:157–171` rejects equal generations. Two controllers starting before either save commits both allocate 1. The submitted test covers only the later request completing first.

The converse is reproduced on one file-backed database with two connections: start page 10, start page 20, release page 10 first, then page 20. The earlier operation succeeds; the newer operation is rejected as superseded; the durable page stays **10**, not **20**.

Fix: atomically reserve/claim durable operation ownership before asynchronous opening or saving. Commits must validate the current claim under the write lock. Reading the last saved generation is insufficient. Preserve reading content while reserving ownership, define overflow/refusal and cancellation, and test both completion orders plus restart. Changing only `>=` back to `>` revives stale-write acceptance.

### M4-R29 — P1: abort cannot fence a save already awaiting persistence

`proof/openerController.mjs:229–233` invalidates only controller-local ownership. The store has no cancellation/current-claim check for the pending operation.

Reproduction: seed page 5, start page 42, pause inside the injected persistence function before its actual transaction, call `abort()`, then release it. Page **42** commits and the aborted controller returns successful `opened`. The new submitted abort test pauses only the opener, so it misses this boundary.

Fix: carry cancellable ownership through normal save and retry; check it at the actual commit boundary. Cancellation before commit must reject without changing saved page/hash/label/status. Cancellation after a legitimate completed commit must prevent stale publication, without inventing rollback. Do not use a compensating rewrite.

### M4-R30 — P1: obsolete callbacks overwrite the winner's controller state

`proof/openerController.mjs:162–185` and `:213–223` publish after persistence without checking ownership again. `:248–250` also clears current state/notice when an older operation is superseded.

Three reproduced failures:

1. Page 10 commits, but its acknowledgement is held; page 20 commits; release the old acknowledgement. Durable page is 20, while the controller's page and notice revert to **10**.
2. An unsaved page-42 result starts its save-only retry; that save commits but acknowledgement is held; page 20 commits; release retry. Durable page is 20, controller page becomes **42**.
3. An old page-10 opener fails after page 20 succeeds. Durable page remains 20, but the controller becomes **aborted** and clears the winning notice.

Fix: use immutable operation/route/content context and a publish gate after every await. Obsolete results may return an operation-local superseded result but must not modify the current state's page, verdict, notice or route. A stale result must never report itself as the current successful save.

### M4-R31 — P1: the final verification and installation receipts still assert execution

`scripts/run_integration_proof.mjs:521–555` writes `exit: 0`, PASS, every filename followed by OK and `manifest.verified: true` **before** sealing the manifest and performing the check at `:561–567`.

In a disposable-copy PATH adapter, a delivered toolchain receipt is modified immediately before the actual final checksum command. The runner correctly exits **1**, but the saved verification receipt still claims **exit 0 / PASS**, and the summary retains **verified true / failures []**. The real failure reaches only console output.

Separately, `:136–154` constructs a zero-exit npm-ci audit without running npm or loading an actual install execution receipt. A probe npm executable that records invocation and exits 42 is never called; the runner exits 0 and still writes a zero-exit npm-ci receipt.

Fix: derive command results from actual executions or explicitly verified prior install evidence. Label reuse honestly. Write the failure outcome before stopping. Separate immutable payload checksums from measured verification outcomes to avoid self-referential receipts; a complete outer delivery manifest may seal the final outcomes afterwards. Never prewrite successful outcome fields to make a manifest self-consistent.

### M4-R32 — P2: active mutant traceability and current report counts are unreliable

`scripts/run_integration_proof.mjs:324–346` recognizes only M1–M13 and calls a literal whitelist `executedMutants`. Add only `M99_NEVER_EXECUTED` as an executed-mutant claim to the report, without changing tests or the map: the runner still exits **0**, and 08b declares every cited mutant executed.

The report also says **18 steps / 44 checksums** on both lanes and claims source writes `manifest.verified: verifyOk`. Delivered reality is **45** checksums; summary reports **22** records, console **23**, and source hardcodes `true`. The chat claims 23/45, so report, machine summary, console and source disagree.

Fix: emit actual mutant IDs and assertion outcomes from the sensitivity run; consume those results instead of a whitelist. Validate active claims across all ID numbers, reject unknown/missing cited IDs, and distinguish explicitly historical erroneous examples. Generate current report names/counts from final executed records, with a defined step-count meaning. Add negative cases for fabricated mutant claims, missing executed mutants and report count drift.

## Handoff and boundaries

One [model-neutral correction assignment](M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md) covers all five groups. It preserves accepted work and requires meaningful regressions at the actual commit/publication boundaries.

Gemini's live work was not edited. Main, application source, dependencies, migration registry, profiles, installed kit, signing and release state are unchanged. M4 stays evidence-only, OD-1–OD-10 stay proposed, physical installed gates stay deferred. Publication is documentation/test-specimen only and remains for the current Git coordinator.

[Evidence, exact diagnostic assertions, frozen source and receipts](evidence/m4-round3-senior-review-2026-10-11/README.md).
