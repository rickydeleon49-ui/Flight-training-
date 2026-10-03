# Claude correction assignment — make the Mac A2 preparation reliable

Continue your existing work in `/Users/rickymac/code/Flight-training-` on `codex/mac-a2-verification-preparation`. Do not restart the package. Correct the prepared diagnostics and report, prove the corrected observations locally without pretending the absent A2 source is available, and deliver the complete package for Codex re-review.

Claude owns these corrections and their focused validation. Codex owns independent review and the reviewed Git/CI/merge sequence. Leave changes uncommitted and unpushed. The Windows owner retains the A2 production implementation.

## Read and preserve the reviewed snapshot

Read `docs/MAC_A2_PREPARATION_REVIEW_2026-10-03.md` and `docs/evidence/mac-a2-preparation-review-2026-10-03/README.md` from current GitHub main after the review publication merges. If your active branch predates that publication, read the files through a read-only reference and continue your dirty branch; Codex can reconcile it later.

Record current branch, HEAD and dirty files before editing. Compare all nine files with the handoff you supplied. The reviewed diagnostic hash was:

`1902070e7136310b74d6bdc6bd53999516c6b88fc85703d5070b13bc0b6d4b4f`

The other eight hashes are in the reviewer receipt. If competing work changed any file, identify it and preserve it before editing. Do not reset, stash, switch a dirty branch, or overwrite another agent's work.

Retain your useful acceptance matrix, source-availability receipt, five original reviewer cases, engine probe and platform evidence. The three findings below concern prepared test oracles. They are not a request to implement A2, redo A5, or audit the whole application.

## Correction 1 — PREP-R1: make QT-02 a coherent observation

The present QT-02 calls fullState while a save is in flight. That helper performs several independent public selects. A complete save may occur between them, so combining their results does not prove a mid-transaction read.

Codex's counterexample invokes save before read, adds harmless asynchronous preparation before the save acquires ownership, and then uses a FIFO queue. The first read sees no material; the save commits completely; later reads see its link. Every queued operation is safe, yet the current assertion fails.

Use one public SQL read to observe all relevant values from the same SQLite statement. A joined query or explicit scalar subqueries can be appropriate; choose a result that distinguishes no save, a complete save, and partial metadata/tag state. Do not achieve consistency by issuing public BEGIN/COMMIT calls or using raw production handles.

Exercise both schedules in a task-local oracle check:

1. Read before the save acquires ownership.
2. Read after the complete save.

Both must produce legitimate coherent states. Include an intentionally partial dataset/control that the corrected observation rejects.

For the stronger claim that a read requested while ownership is held cannot enter the transaction, specify an explicit barrier and the observable event it waits for. Do not rely on calling two async functions together, sleeps, or Promise.all as proof of overlap.

If matching A2 source is needed to attach that barrier, label the case SPECIFIED or CONDITIONAL with an exact seam request. Finish the coherent observation and its independent controls now. Do not add production backdoors or treat missing source as a behavioral failure.

Keep fullState available for before/after comparisons taken after pending operations settle; do not claim that its separate reads form a transaction snapshot.

## Correction 2 — PREP-R2: retain raw identity and link state

Replace the incomplete snapshot policy with one that retains:

- Every relevant study-material column.
- Every relevant tag column, including its stored ID.
- Every raw material_tags row, including material_id and tag_id.
- A separately named resolved name/link view for readable expected results.
- Explicit status and rows for the unrelated table where applicable.

Use stable ordering. Check raw counts and foreign-key consistency. An inner join may provide a readable view, but it must not be the only record of links.

Do not convert every unrelated-table read failure into “no unrelated table.” Identify absence explicitly, or create the unrelated table in every case that requires it. Propagate other failures.

Add task-local controls demonstrating that the corrected state comparison distinguishes:

1. The same tag name under a changed tag ID.
2. Changed raw link IDs.
3. An extra dangling link.
4. A stray tag after a rejected operation.
5. Unchanged full state.

Use synthetic real SQLite/sql.js datasets and the diagnostic's actual helpers where feasible. Clearly label these as validation of prepared observations, not execution of the missing A2 implementation.

Apply the policy throughout AR/BD assertions. Review BD-11 specifically: its live/reopened comparisons currently omit tag state. Compare the complete relevant prior state.

Strengthen the foreign-key recovery check. A poisoned driver rejecting all work is different from a working engine enforcing a foreign-key constraint. If safe work is admitted, show the connection remains usable, query the actual setting where supported, and establish that the orphan insert fails for the expected integrity reason. If the driver fails closed, record that outcome explicitly rather than calling any rejected insert “enforced.”

Preserve existing fail-closed alternatives and the conditional seam labels. Never manufacture a successful result when the fault injection was not reached.

## Correction 3 — PREP-R3: prove QT-11's complete outcome

The successful QT-11 branch currently checks only the changed tag link. It accepts a partial update in which the requested title remains unchanged.

Construct an explicit expected success state: changed metadata and intended links, preserved untouched fields, correct raw identities, and conserved unrelated data. On rejection compare the complete prior state.

For sql.js, compare the relevant live and reopened state after work settles. After a refused public control call, prove ordinary legitimate work remains usable.

Cover applicable execute and select routes for transaction-ending forms. Include supported COMMIT/END/ROLLBACK/RELEASE/ROLLBACK TO forms and relevant comments/statement strings. Explain which routes compile one statement and which can execute several.

Separate ordinary public-control refusal from the concurrency case. For the latter, prove the call is requested while ownership is held using a deterministic barrier supported by the source. If that seam cannot be established until the source arrives, leave a precise SPECIFIED/CONDITIONAL case; do not label an unforced overlap as verified.

Add task-local negative controls:

- Changed links with the old title must be rejected.
- Changed title with the old links must be rejected.
- Partial state after a rejected save must be rejected.
- The complete expected success and unchanged rejected state must be accepted by the observation policy.

These controls check your prepared assertions. They do not establish application correctness.

## Documentation corrections

Update the report, evidence README, matrix rows and current trackers with an issue-to-fix map for PREP-R1–R3.

Clarify these points:

- Claude's environment lacked an authenticated gh/API route; that does not establish that this Mac has no gh CLI. Codex used authenticated gh during review.
- PR head refs identify reachable source. They do not report whether a PR is open, closed or merged.
- The source check used GitHub network access. Replace the blanket “no network request” claim with the precise data/provider boundary that was preserved.
- Do not automatically demand another full application matrix merely to execute focused diagnostics against unchanged independently accepted source. Source corrections retain their full-matrix gate.
- Record the actual expanded diagnostic count from parameterization rather than relying on the handoff's approximate count.
- Keep engine-level, main-baseline, prepared-oracle, A2-dependent and installed evidence separately labeled.

Do not overwrite earlier receipts. Save new correction receipts alongside them with clear dates and provenance.

## Focused verification and evidence

Use the existing scoped Node 22 toolchain. Keep synthetic datasets and temporary scripts task-owned. Restore spies and storage globals, close handles, and clean up even on a failing assertion.

Read the published reviewer reproduction. It extracts the old fullState helper and mirrors the old QT-11 assertion; it is historical counterexample evidence. After changing the helper, that script's old expectations are not your success criterion. Preserve the original receipt and add corrected positive/negative oracle controls.

Run the corrected local controls, syntax/static validation appropriate to the prepared file, discovery exclusion, reference/path checks and git diff --check. If static typing uses an API shim, describe that limitation again.

Do not execute the prepared A2 suite against current main's missing APIs. Do not rerun the 53-test main frontend suite, the 44-test native suite, the complete matrix, the case-sensitive image capability probe, or heavy A5 measurements unless a new relevant failure justifies it.

Keep diagnostics outside normal discovery until their matching implementation is available. Do not modify application source, packages, lockfiles, migrations or workflows for these preparation corrections.

## Completion handoff

Deliver the corrected package and stop for Codex re-review. Include:

1. Branch, HEAD, exact dirty-file list and confirmation that nothing was committed, pushed, tagged, installed or released.
2. PREP-R1–R3 issue-to-fix map, exact case/helper names and any source-dependent seam still specified.
3. Commands, exit codes, positive/negative control results, counts and evidence paths.
4. Final SHA-256 hashes for every changed file; distinguish unchanged inherited artifacts.
5. Updated source-availability and installed-platform limits without implying A2 acceptance.
6. Confirmation that no owner message was sent and the Windows implementation's ownership is preserved.

Finish every correction that can be proved without A2 source. The missing source still blocks application verification, but it does not block validating these prepared observations.

Keep the dedicated-account/signing prerequisite visible. Use no owner profile, private data, installer, live Gemini request or signing bypass. Release holds and the open-source/M2 gates remain unchanged.
