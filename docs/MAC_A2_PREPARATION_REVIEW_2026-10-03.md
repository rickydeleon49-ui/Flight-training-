# Independent review of the Mac A2 preparation — 3 October 2026

Follow-up: [the corrected preparation is accepted](MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md). PREP-R1–R3 below describe the historical reviewed snapshot and are now closed.

**Decision: corrections required in the prepared diagnostics before accepting the preparation package.** These findings concern test observations and assertions. They establish no new A2 application failure; matching A2 production source remains unavailable.

Claude's local branch is `codex/mac-a2-verification-preparation`, HEAD `54b82b3b59667b2ff9847c14fd6e44bcb3399e02`. Codex reviewed the two modified trackers and seven new report/evidence files. All nine hashes match Claude's handoff. The reviewed diagnostic SHA-256 is `1902070e7136310b74d6bdc6bd53999516c6b88fc85703d5070b13bc0b6d4b4f`.

The source-availability gate and separation of historical, engine, main-baseline, prepared and installed evidence are appropriate. Codex independently found no open GitHub PR or atomic-save branch at this review check. Claude's historical all-52-PR-head inspection was inspected, not repeated in full.

## Confirmed findings

All references below are to the unpublished local file `docs/evidence/mac-a2-preparation-2026-10-03/a2ReviewDiagnostics.mac.test.ts` at the reviewed hash. Publishing this review does not publish or accept that diagnostic file.

### PREP-R1 — P2: QT-02 treats several public reads as one snapshot

**Lines 408–416, using fullState at 171–181.** QT-02 asks several separate `select` calls to collectively show either a complete save or no save. The per-operation ownership guarantee does not make those calls one snapshot.

A real in-memory SQLite counterexample preserves the test's save-before-read invocation order, with harmless asynchronous save preparation before acquiring ownership. A FIFO queue executes the first read, one complete atomic save, then the remaining reads. The helper returns zero materials and one link, so the oracle rejects despite no read entering an unfinished transaction. Final state contains the complete save.

This is a counterexample to the aggregate oracle. It does not show that the absent A2 driver has that scheduling behavior. Use one coherent SQL observation for QT-02 and an explicit overlap seam, or mark the overlap case specified/conditional until matching source supplies that seam. Keep multi-query fullState for observations taken after work settles.

### PREP-R2 — P2: fullState does not retain the full stored state

**Lines 171–181.** Tags retain names but omit their stored IDs; links use an inner join instead of retaining every raw material/tag ID pair. A real SQLite counterexample changes a tag ID and its link ID, then adds a dangling link. The helper still equals its prior result while the raw link count changes from one to two.

Rejected-write recovery assertions can therefore miss identity changes or link debris. Capture every relevant tag column and every raw link, with stable ordering. Keep the name-resolved view separately for readable expectations. Verify counts and foreign-key consistency. Do not collapse arbitrary read errors into “no unrelated table.”

Apply the complete-state policy to recovery checks, including BD-11, whose current comparisons omit tags entirely. A refusal of an orphan insert alone is not proof of foreign-key enforcement: distinguish an engine constraint failure from a poisoned/closed driver refusing all work.

### PREP-R3 — P2: QT-11 accepts a partial update as a whole save

**Lines 373–385.** If the save reports success, QT-11 checks only the changed tag link. A synthetic SQLite state with changed links but the old title satisfies that exact saved-branch assertion. It does not satisfy the requested metadata/tag update.

Compare the full successful result, preserving untouched fields and checking changed title/tags; on rejection compare the full prior state. Include live/reopened sql.js state and an acknowledged unrelated row. The existing test also does not force the public ending call to arrive while ownership is held and covers only execute. Make overlap deterministic and cover applicable execute/select routes, or label the source-dependent overlap seam honestly.

## Independent verification and limits

- All nine handoff hashes match; production/application tests/tooling are unchanged.
- Codex reran the raw-engine probe with Node 22.23.3. Parsed JSON exactly matches Claude's receipt, including sql.js export resetting foreign_keys from 1 to 0 and the distinct multi-statement route.
- Three independent real-SQLite oracle counterexamples pass as reviewer checks, demonstrating the three preparation issues. Neither the prepared A2 suite nor an A2 API was invoked.
- Codex inspected Claude's raw logs: 53 existing frontend tests and 44 native documents tests passed. These runs were not repeated and prove current-main behavior only.
- No full application matrix, disk-image capability check, installer or installed app was rerun.

[Reviewer evidence and reproduction](evidence/mac-a2-preparation-review-2026-10-03/README.md). [Detailed Claude correction assignment](CLAUDE_MAC_A2_PREPARATION_CORRECTION_PROMPT_2026-10-03.md).

## Documentation clarifications

Describe the unavailable gh/API route as a limitation of Claude's environment, rather than saying this Mac has no gh CLI; Codex can use authenticated gh. PR head refs identify source, not PR state. The README's “no network request” statement must distinguish provider/data requests from the GitHub source-availability check. Reconcile the downstream full-matrix instruction with the original prompt: documentation-only preparation and focused verification of unchanged accepted source do not automatically require another full matrix.

Claude retains its local uncommitted package for correction. Only this independent review, evidence and correction prompt are published now. No message has been sent to the Windows owner. Dedicated-account/signing, installed-platform, release and open-source gates remain open.
