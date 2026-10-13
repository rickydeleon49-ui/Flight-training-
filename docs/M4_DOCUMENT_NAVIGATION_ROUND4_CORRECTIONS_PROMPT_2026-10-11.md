# M4 navigation: complete durable ownership and truthful evidence — round 4

Implement the corrections in [the independent round-3 review](M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md), M4-R28–R32, together. The implementing model is owner-selected; this assignment is model-neutral.

## Work and starting identity

Work in the existing `Flight-training-m4-viewer-evaluation` checkout on `codex/m4-navigation-viewer-evaluation`, submitted HEAD `c28ab8482c8635b0b2bf74686b081e02bf448f65`. Use the existing evidence-only round-2 pack:

`docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/`

1. Fetch first. Read missing assignment/review documents from the published review branch or origin/main without pulling into or overwriting the dirty worktree.
2. Read the round-3 review fully, the prior R23–R27 assignment/review, the current prototype modules and the frozen diagnostics.
3. Before editing, verify the ten submitted hashes in `docs/evidence/m4-round3-senior-review-2026-10-11/submitted-source-hashes.json`. Verify the submitted 45-entry manifest. Report competing changes before editing affected files; do not overwrite them.
4. Preserve the submitted report/receipts/manifests as labelled historical specimens before changing mutable deliverables. Keep prior frozen packs unchanged.
5. Reproduce the five frozen diagnostics on the submitted state. They currently fail 0/5 on both Node lanes. Use disposable copies; no production fault seams or test bypasses.

The review evidence contains a self-contained frozen prototype and verified schema14 migration specimens. Run its assertions against your pack with `M4_REVIEW_TARGET_PACK`. If ownership API changes require new fixture bindings, document the smallest adapter and preserve every assertion and ordering scenario.

## R28: reserve durable ownership, rather than reading the last saved generation

The current restart fix works sequentially. It fails when two controllers read the same saved generation before either operation commits.

Implement one coherent operation-ownership protocol. A request must claim a unique, ordered durable token before asynchronous opener/persistence work. Reserve it under the database write lock, independently from the last successfully saved reading tuple. At commit, revalidate the currently authorized token under that same transaction boundary. A later request must supersede an earlier pending request regardless of callback order.

Do not solve this by relaxing `>=` to `>`, choosing timestamps without uniqueness guarantees, or rewriting the database after an obsolete save commits. Keep page/hash/printed-label/status as the winning operation's immutable tuple. State how token overflow, failed reservation and controller restart are handled.

Required tests use a file-backed database and two connections/controllers:
- Both requests begin before either commits; release the later operation first, then earlier.
- Same starting order; release the earlier operation first, then later.
- Earlier pending operation must not become a durable stale winner once the later claim exists.
- Restart after multiple saves still commits the next operation.
- Original R13 held-write and atomic content-replacement/rollback proofs remain meaningful.

Candidate DDL/protocol changes may stay inside the evidence pack. Do not register or ship migration 0015.

## R29: cancellation must reach the actual commit boundary

The current abort test pauses the opener. Add the missing phase: hold an operation inside persistence before its transaction, abort/unmount or navigate away, then release persistence.

Make normal saves and save-only retries carry cancellable operation ownership. Abort before the actual commit must prevent a write and preserve the previous saved tuple, with an honest rejected/aborted result. An old operation must not cancel or release a newer operation's claim. If a commit already completed before cancellation, retain that legitimate result in storage but suppress obsolete publication. Never invent a rollback or compensating rewrite.

Assert final database page, hash, label, status and owner where applicable; prove both pre-commit cancellation and post-commit delayed acknowledgement. Include route/content changes and delayed failure around those boundaries.

## R30: publish only for the still-current immutable operation

Check ownership after every await, including persistence success/failure and retry success/failure. Capture material, content, route and operation context instead of reading mutable newest context in an old closure.

Fix all three frozen scenarios:
- Old page10 commit acknowledgement released after page20 has committed.
- Old page42 retry acknowledgement released after page20 has committed.
- Old opener failure released after a newer successful open.

The winner's controller page, notice, state, route and commit verdict must remain intact. Obsolete callbacks return operation-local superseded results without clearing or changing the winner. Preserve save-only retry without replaying the opener, and distinguish opened-but-unsaved from successful durable save.

Add permanent cases for late success, late rejection, late throw, abort, A→B→A and changed content with the same material ID. Use gates at persistence/acknowledgement boundaries, not sleeps, and assert both final database and controller state.

## R31: record real command and verification outcomes

Remove the synthetic zero-exit npm-ci record. Either execute the pinned scratch install as a captured step or consume a verifiable recorded install with exact command/cwd/exit/artifact digests and explicitly label reuse. An existing package directory alone cannot attest an installation command succeeded.

Do not write PASS, per-file OK, zero-exit verification or `verified: true` until the corresponding check actually ran. On failure or interruption, record the actual failed/incomplete state before stopping; summary and receipt must agree with the exit.

Resolve checksum self-reference explicitly. For example, seal an immutable payload manifest, execute its check, write measured outcome receipts, then seal a separate complete delivery manifest. Record verification of the final seal outside its own covered set or as a clearly defined outer result. Document covered/excluded files and stages. Never precompute successful outcomes to obtain matching hashes.

Permanent negative probes must show:
- A delivered receipt altered after sealing makes the real runner fail and the saved outcome describe failure.
- A final-check command failure cannot leave a success summary/receipt.
- Interrupted/incomplete verification does not claim success.
- An installer failure or a reuse lane is recorded truthfully.
- Existing verify-only tamper rejection, prior published manifest verification and added-file refusal still work.

Use fault adapters only in disposable test copies.

## R32: derive active claims from execution records

Have the sensitivity run emit machine-readable IDs and named assertion outcomes for mutants that actually executed. The report validator must consume that record, not a literal M1–M13 whitelist. Recognize all active mutant ID numbers and fail on unknown/unexecuted claims; the frozen probe adds `M99_NEVER_EXECUTED` only to the report and currently passes.

Preserve explicitly labelled historical examples of earlier mistaken claims, while distinguishing them from current execution claims. Validate current report and README test names, mutant IDs, counts and lane outcomes against executed receipts. Generate the current tables/counts from those records. Define step counts consistently so console, summary and report describe the same thing. Correct the stale 18-step/44-entry report and the inaccurate `verifyOk` source claim honestly.

Add negative tests for unknown cited IDs, missing executed mutants, stale counts and cited tests that did not run. Preserve all thirteen original copy-mutants and add meaningful guard reversions for the new ownership, cancellation and publication guarantees. Each mutant must fail an unchanged named regression; do not weaken assertions to obtain green output.

## Verification, deliverables and stopping point

Run focused cases first, then the complete evidence runner on Node 22.23.3 and Node 26.10.0 sequentially in clean disposable copies. Record real commands, exits, exact suite counts, mutation IDs and each lane's receipts separately. Demonstrate the prior 52 cases remain covered, plus the new diagnostics/negative probes, parser artifact checks, frozen packs and complete final checksums.

Do not run application/Rust matrices for an evidence-only change. No production edits, dependency adoption, migration registration, backup-format changes, application builds/installs/launches, account/profile changes, provider calls, signing, release or new roadmap work. Do not modify protected checkouts or shared STATUS/handoff. OD-1–OD-10 remain proposed and installed gates remain deferred.

Deliver one corrected report, preserved earlier evidence, new complete receipts/manifests, issue-to-test/mutant mapping and precise reproduction steps. Explain each closure with actual execution evidence and disclose any remaining failures. Leave everything uncommitted and unpushed for independent review, then stop.
