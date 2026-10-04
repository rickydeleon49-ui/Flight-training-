# Structured study-import Slice B preparation: independent re-review

Reviewed on 3 October 2026, America/Los_Angeles. **Outcome: preparation corrections still required; no Slice B source implementation is authorized.** Gemini addressed the earlier swallowed-persistence design and compatibility claims. One newly measured sql.js lifecycle issue and a remaining native-contract issue need correction before the plan can be accepted.

This publication contains Codex's review, a bounded next prompt, synthetic dependency diagnostics and inert snapshots. It does not accept or activate the submitted implementation prompt. The primary dirty preparation branch is preserved.

## Reviewed identity and evidence

| Item | Independently observed |
| --- | --- |
| Repository / primary checkout | `rickydeleon49-ui/Flight-training-`, `/Users/rickymac/code/Flight-training-` |
| Implementer / reviewer | Gemini / Codex |
| Primary branch / HEAD | `codex/structured-study-import-slice-b-preparation`, `3efe95316b200848178033a68d057f66815cf427` |
| Refreshed publication base | `origin/main` at `c5b70329fb94eef58df2d6a16e0edf8c44c4a11e`, PR #63 |
| Submission | Three modified tracked documents and five untracked documents/evidence files; eight files total |
| Receipt | All seven entries verified; self-excluding `final-hashes.txt` SHA-256 `988346289cc0d9c68e8c8251a4635b0f664b9d32a3fc765a8f542947fbb8467b` |
| Unchanged source/configuration | All 351 tracked files outside `docs/` and `STATUS.md` byte-identical to primary HEAD; no unexpected dirty files |
| Document verification | 188 relative file links resolve; whitespace/conflict-marker scan clean across all eight submitted files; `git diff --check` passed |
| Planned matrix | 46 distinct rows: 42 source/development tests and four future installed tests; all 22 original IDs preserved; no row executed |
| Fresh GitHub inspection | 63 PR metadata entries, zero open PRs before this publication; three A2-named documentation/preparation PRs and matching remote refs; no `fix/atomic-study-material-saves` branch match. Metadata/ref inspection does not audit every PR tree or the Windows filesystem. |

[Evidence index](evidence/structured-study-import-slice-b-rereview-2026-10-03/README.md), [all eight reviewed hashes](evidence/structured-study-import-slice-b-rereview-2026-10-03/reviewed-all-8-hashes.txt), [verification record](evidence/structured-study-import-slice-b-rereview-2026-10-03/review-verification.json). Submitted report and conditional prompt are preserved byte-for-byte as `.md.txt` history in `submitted/`.

## Earlier finding disposition

| Finding | Disposition in this revision |
| --- | --- |
| BPREP-R1: swallowed errors and invalid post-commit rollback/handle ownership | Earlier mechanism addressed in the proposed throwing flush, mutable cell and write queue. Snapshot/replacement must also satisfy the new BPREP-R4 below. This is design review, not proof of an implemented adapter. |
| BPREP-R2: unsupported old-binary guarantees | Addressed in the revised compatibility section: v0.5.1 has schema 8, no practice-test panel and no current newer-schema restore guard. Downgrade usability remains unverified and D3 remains pending. Metadata wording needs the minor precision below. |
| BPREP-R3: native operation/error/equality/test contract | Substantially improved, but still open for the command-boundary and serialization correction below. |

## BPREP-R4 — [P2] Reinitialize sql.js connection invariants after exports and replacement

**Exact submitted locations:** report §4.5, lines 318–352; conditional prompt Phase 3, lines 106–116. The plan calls `cell.current.export()` immediately before `BEGIN IMMEDIATE`, again during successful durable persistence, and constructs `new SQL.Database(preOpSnapshot)` after a failed flush. None of these paths reapplies connection invariants.

The locked and installed sql.js version is **1.14.2**. A disposable in-memory probe measured `PRAGMA foreign_keys = 1` before snapshot export and **0 after export**. An orphan insert then succeeded and deleting a parent left its child behind. A replacement handle opened from the snapshot also had enforcement off. Reinitializing it restored rejection and cascade behavior; a later successful export reset enforcement again. This agrees with [sql.js's export documentation](https://sql.js.org/documentation/Database.html#export), which describes reopening the connection and resetting PRAGMAs.

**Impact:** following the proposed sequence disables referential enforcement before the new transaction and leaves the adapter in that state after a flush or recovery. Atomic commit alone does not preserve connection behavior. The current adapter also has a pre-existing export/reset exposure; this preparation review does not authorize an independent production repair ahead of accepted A2.

**Required correction:** specify one connection initializer and the exact points at which it runs and verifies required settings: initial open, snapshot export before BEGIN, durable export before releasing ownership, and replacement recovery before any user can access the handle. Cover exceptions during export/reinitialization; disable/refuse access when a usable invariant-preserving handle cannot be restored. Identify all existing handle users, including debrief saves, and prevent use of invalidated statements. Keep the design contingent on the eventual accepted A2 API.

Add planned real-sql.js tests checking the PRAGMA plus orphan rejection and cascade behavior after each lifecycle transition, preservation of prior rows/storage bytes, subsequent ordinary/debrief writes, and a safe refusal after initializer/recovery failure. A mock-only export test cannot prove this behavior.

[Probe source](evidence/structured-study-import-slice-b-rereview-2026-10-03/sqljs-lifecycle-probe.cjs), [observations](evidence/structured-study-import-slice-b-rereview-2026-10-03/sqljs-lifecycle-observations.json). Exit 0 means the dependency observations were confirmed; it does not mean Slice B passes.

## BPREP-R3 remains open — [P2] Make the IPC contract cover argument decoding and exact JSON

**Exact submitted locations:** report §4.3, lines 218–271; conditional prompt Phase 2, lines 44–75; test matrix lines 393 onward. The proposed command accepts a deserializable `StructuredImportSaveOperation` and promises every refusal, including unknown fields, as a fixed `{code, message}` error.

In locked Tauri **2.11.5**, `CommandArg::from_command` deserializes before calling the command body and converts failures to `InvalidArgs`. Tauri converts that error to a string; its macro rejects or propagates failed arguments before invoking the body. Serde **1.0.229** includes the unknown field name in its default diagnostic. Consequently, a synthetic unexpected field cannot reach the promised `NativeImportSaveFailure` mapper in this signature, and the diagnostic can echo that supplied key. This is confirmed source behavior, not an executed app/IPC test.

The success example also leaves `material_id` as a snake-case variant field: enum `rename_all = "snake_case"` renames variants, not their fields. No explicit TypeScript success union and serialized JSON examples settle whether the consumer should read `material_id` or `materialId`. See [Serde's container attributes](https://serde.rs/container-attrs.html).

**Required correction:** specify a boundary that can classify malformed operation values before database access and emit allowlisted application failures without forwarding Serde/SQL/private diagnostics. Receiving the operation as an untyped JSON value and doing explicit typed decoding inside the command is one possible design; define transport-envelope errors separately rather than promising control over all framework failures. Give exact TS success/failure definitions, Rust serialization attributes, serialized `saved`/`already_saved` examples and a complete static code/message mapping. Specify bounded inputs and normalization/field-presence rules without changing Slice A's accepted format.

Plan tests at that boundary for unknown keys (including synthetic private-looking names), missing/wrong-type fields, malformed IDs/hash and nested payloads; assert zero writes and exact sanitized outputs. Use valid UUID v4 fixtures for idempotency/conflict tests: current examples `m1`, `m2` and `m-conf` would be rejected by the proposed ID guard before reaching their intended assertion. Reconcile the detailed stored-equality list with canonical persistence content, explicitly including both aid titles and question sourcePage; preserve the distinction between a validated client digest and actual stored-content equality.

Locked-source anchors are recorded in the [verification record](evidence/structured-study-import-slice-b-rereview-2026-10-03/review-verification.json). No native implementation or owner-profile access was performed.

## Minor reconciliation and scope

- Label the current matrix **46 total / 42 source / four installed**, rather than presenting 42 as the entire matrix. All entries remain planned. Keep existing IDs and add targeted lifecycle/boundary rows.
- Separate metadata/name matching from source availability: the three A2-named PRs/refs are preparation documents, while the specific Windows implementation branch remains unmatched in this inspection. Do not claim zero A2-named refs or a new Windows-machine audit. Treat earlier toolchain observations as inherited if not remeasured.
- Reconcile report, conditional prompt, README/receipt and three status documents; mark correction delivery as pending Codex review rather than asserting all findings accepted.

Slice A is accepted and merged through PR #62. The narrow exception ends with A. Slice B continues to require published/accepted A2, the M2 real-user check-in/scoped approval and D1–D9 approval, including D3. Installed-account/signing prerequisites and release holds remain open. No source, dependency, migration, UI, provider, installer, account or Windows-owner messaging work is assigned.

**Next authorized task:** [Gemini's final preparation-corrections prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_FINAL_PREPARATION_CORRECTIONS_PROMPT_2026-10-03.md). Correct the bounded documentation package locally and return it uncommitted/unpushed. Codex publishes this review separately and preserves the dirty branch for that work.
