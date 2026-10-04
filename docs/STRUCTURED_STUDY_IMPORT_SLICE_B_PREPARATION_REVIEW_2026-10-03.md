# Structured study-import Slice B preparation review, 3 October 2026

**Corrections required before preparation acceptance.** The submission is documentation-only and respects the source implementation gate, but its copy-ready implementation instructions have material gaps in durability, compatibility claims and native/test contracts. This review publishes findings and a correction assignment; it does not accept the preparation package or authorize B source work.

## Reviewed identity and verification

Primary Mac checkout: `/Users/rickymac/code/Flight-training-`, branch `codex/structured-study-import-slice-b-preparation`, base and fetched main `3efe95316b200848178033a68d057f66815cf427`. Codex verified **7/7 receipt hashes** across **eight submitted files including the receipt**. Receipt SHA-256: `42fae59b644182400db2aada711084e32884e374104a7c5197ef2b7614aedb1d`. Only three tracked documents and five new documentation/evidence files differ; production, tests, manifests, lockfiles and workflows are unchanged.

Codex inspected the actual plan/prompt and referenced source, checked 190 relative links with zero broken targets, and checked whitespace. Source/tag/remote inspections are static evidence, not executed save, restore or installed tests. No full matrix was repeated. [Original submission snapshots and verification](evidence/structured-study-import-slice-b-review-2026-10-03/README.md) preserve the reviewed bytes.

## BPREP-R1 (P2): the proposed durability catch cannot observe current save failures

**Targets:** submitted [implementation prompt](evidence/structured-study-import-slice-b-review-2026-10-03/submitted/docs/GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-03.md.txt) lines 78–83; [preparation report](evidence/structured-study-import-slice-b-review-2026-10-03/submitted/docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md.txt) lines 281–289 and TB-DUR-01.

Trigger: the browser operation commits in memory, then `db.export()` or `localStorage.setItem()` fails. The prompt says to call existing `save(db)` and catch the failure. Actual `src/data/sqlJsDb.ts:31-41` catches those errors internally and returns normally, so the prescribed caller cannot detect failure or perform recovery. `COMMIT` has already ended the SQL transaction; a subsequent SQL `ROLLBACK` cannot restore its old state. The live database is a captured `const db` at line 47, and no shared replacement/snapshot/serialization design is specified.

If followed literally, these instructions can report a save that disappears after restart. Recovery without serialized access could also erase unrelated work performed after the snapshot. Correct the documents to specify an observable throwing persistence path, precise snapshot/handle ownership, serialized transaction-through-flush/recovery behavior, preserved storage bytes and bounded retry. Explain how all adapter users observe the recovered handle and how an ordinary write cannot race recovery. This is a requested design correction, not permission to rewrite the production adapter.

Add separate planned export-failure and storage-failure cases, live-handle and fresh-reload assertions, unrelated-data preservation, recovery-failure behavior and retry-after-failure. Retain A2-R6/R7 dependencies and clearly label any isolated prototype as a prototype.

## BPREP-R2 (P2): D3 asks for approval using unsupported older-binary guarantees

**Targets:** submitted preparation lines 51, 68–105; implementation prompt D3 at line 18.

The report states that restoring schema 10 into v0.5.1 succeeds, that all questions/tests remain functional with only a label change, and that migration 11 would cause older binaries to cleanly reject a restore. These are broader guarantees than the evidence supports. The actual `v0.5.1` tag (`2dbf6df3f66b18e087b5842fc554f8e733255a0e`) registers migrations **1–8**, has no practice-test domain/panel, and its backup source has no current `CURRENT_SCHEMA_VERSION` check. Current main's newer-schema rejection at `backup.rs:424` does not establish that an older tag implements that rejection. The older study-set mapper's Gemini label is a real source observation; successful safe downgrade/restore and complete functionality were not measured.

Correct D3 in both documents to separate observed source behavior, schema assumptions and unverified installed/downgrade outcomes. Do not promise all content remains usable or older binaries safely reject migration 11. Do not run held binaries or touch owner data to prove it. Keep the owner choice pending and remove unsupported usage-frequency/safety assurances from the recommendation. Waiting for M2 is an alternative requiring its own eventual migration/restore verification, not an already certified safety route.

Also repair evidence attribution: “re-checked all 52 PR heads” is stale and not established by the supplied command history. Codex read current branch names and metadata for **62 PRs, zero open**, with no A2-named match; this is not a source inspection of every historical PR or the Windows-local checkout. Report the exact check scope and inherited Windows status separately. Distinguish the clean starting tree from the current eight-file dirty submission, and use the actual M2 check-in definition or a recorded owner decision narrowing it.

## BPREP-R3 (P2): the copy-ready native contract and acceptance matrix omit required boundaries

**Targets:** submitted implementation prompt lines 44–67 and 108–137; preparation lines 231–258 and matrix lines 301–323.

The TypeScript operation example includes `operationId`, but the proposed Rust DTO does not. The plan alternates string errors and `{code,message}` objects. The native validation checklist bounds only some arrays/strings; it does not require nonempty substantive content, empty import model, complete heading/body/front/back/question/choice/explanation/source-note limits, or a defined unknown-field policy. A direct native call can bypass the accepted JavaScript validator. A literal port could therefore save packets the validator refuses, including a material with no study set/test or unbounded item text.

The diagram says same `contentHash` means `already_saved`, while the prose says inspect stored JSON. Define one authoritative operation and error contract; distinguish proposed APIs from existing methods. Idempotency must compare actual substantive material/study-set/test values, including title, nullable presence and source notes. A client-provided hash alone cannot establish equality. Include forged/unchanged hash with changed payload, title-only conflict, notes-only conflict, presence changes and collisions with pre-existing materials in the test plan.

The 22-row matrix also omits several assigned cases: failure at **each** insert for **both** real engines, export failure separately from storage failure, simultaneous/queued writes, guide/cards-only and questions-only saves, source-note retention, double-click prevention, native picker cancellation/preview zero writes, nested modal lifetime and explicit future installed checks. TB-REFRESH-01 must reflect `AppDataContext.tsx:277-310`: `mutate` catches refresh failure, records `lastError`, and returns the successful write result. The dialog cannot depend on a propagated refresh exception. Preserve existing IDs and add rows/mapping to cover these requirements; all remain planned, not run.

Use the scoped Mac toolchain/SDK, `--locked`, all-target Clippy, formatting and Cargo lock synchronization in the future verification instructions. The abbreviated command at prompt line 154 omits these established checks and SDK selection. No full verification run is required to correct the plan.

## Disposition and next work

[Gemini's focused correction prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_CORRECTIONS_PROMPT_2026-10-03.md) assigns BPREP-R1–R3. Keep the same dirty preparation branch, preserve reviewed snapshots, correct documents only, reconcile the three indexes, regenerate hashes and hand back for review. Codex publishes this review from an isolated documentation worktree so the eight submitted files remain untouched.

Slice A remains merged/accepted. No published accepted A2 or recorded M2/D1–D9 approval was found in the inspected shared evidence. B/C implementation, installed testing, signing and release holds are unchanged. This review's containing PR verifies only the review publication, not the unaccepted preparation or a save implementation.
