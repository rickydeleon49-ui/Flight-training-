# M2 saved practice-session scope — focused re-review, 4 October 2026

> Follow-up: the [reviewed scope is ready for owner approval](M2_PRACTICE_SESSION_SCOPE_ACCEPTANCE_2026-10-04.md). The [conditional PR 1 assignment](M2_PRACTICE_SESSION_PR1_PROMPT_2026-10-04.md) is the next source task after approval. This document is historical.

**Decision: M2S-R1's retention mismatch is closed; M2S-R2 and M2S-R3 are partially corrected and remain open.** Finish the two remaining contract sections together using the [model-neutral finalization assignment](M2_PRACTICE_SESSION_SCOPE_FINALIZATION_PROMPT_2026-10-04.md). The proposed feature and two-PR split remain sound. Scope/retention approval and source implementation are still pending.

## Identity and verification

- Reviewed checkout: `/Users/rickymac/code/Flight-training-pr70-integration`, detached main `504a253ffc99650e0903aa3cf452034bd93d13ac`.
- Only working change: untracked `docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`, 426 lines, SHA-256 `b7c14382344fd53ff1178bbfb682bdebe9c02e96e7253cbde7eb35483db22dc8`. This matches the submitted handoff.
- [Frozen revised draft, reproducible SQLite observations and verification receipt](evidence/m2-practice-session-scope-rereview-2026-10-04/README.md) are published for other agents. The implementer's draft remains uncommitted and unchanged.
- Read the entire revised proposal, the previous review/assignment, relevant migration initialization, writers, accepted atomic adapter and restore validation. Executed the proposed SQL with foreign keys enabled in disposable in-memory SQLite only; no application tests, app launch, owner data or release work.

## Closed and improved areas

**M2S-R1:** Policy A now explicitly retains full frozen questions/options/explanations/student responses and title for completed attempts. Its deletion trigger preserves completed review, makes the retained version inactive and detached, and removes unfinished attempts and their unused version. The synthetic deletion fixture confirms this exact lifecycle with no FK violations. Policy approval remains the owner's choice; closure of this planning finding does not approve retention.

**M2S-R2 improvements:** One active version per material is constrained, cross-version response INSERTs are refused, contradictory selected-index/"I don't know" flags are refused in the tested case, completed-state mutation is prohibited in prose, scoring is backend-derived, and UI save acknowledgement is honest.

**M2S-R3 improvements:** Legacy conversion has durable marker/error columns and a proposed startup runner; Gemini/import/material-deletion hooks are enumerated; semantic restore checks and the complete conditional source gate are listed.

## M2S-R2 — retry/recovery assertions still lack a durable contract (P2, open)

**Revised draft:** lines 284–379 (Appendix B), 405–426 (planned tests), and SQL lines 220–267.

The state table says identical operation IDs replay prior results and the test table expects changed-input reuse to conflict, but neither defines storage of operation identity/request identity/result, its atomic commit with state, or replay precedence. No operation receipt or equivalent identity field appears in the proposed tables. Retake and abandon still lack exact request/result shapes. Strict payload bounds, authoritative timestamps, resume cursor, rollback/lock wait and browser durable recovery rules requested in the previous assignment are absent.

**Trigger and impact:** retake operation R commits attempt A, then its acknowledgement is lost. After restart, replay R must return A without abandoning it or creating B. A second request reusing R with changed inputs must conflict. The current proposal offers no persisted data/algorithm with which to distinguish these cases. A replayed completion result must also preserve its original result/timestamp rather than be recomputed after later state changes.

**Constraint observations, not application bugs:** the SQL sketch accepts two in-progress attempts for one material, an ordinary response with `selected_index = NULL`/`is_dont_know = 0`, and a cross-version UPDATE despite the INSERT trigger. The response operation explicitly allows upserts/changed choices. Atomic validation may enforce these rules instead of SQL, but that division and concurrency sequence must be stated. SQLite CHECK accepts NULL unless the predicate excludes it explicitly.

**Finish:** define a durable receipt or equivalent storage/replay algorithm, all five exact operation contracts, strict ownership/state/bounds rules, scoring/cursor policy, bounded contention and native/browser durability/recovery. Reuse the accepted connection-owner/atomic-save behavior. Map tests to changed-input reuse, restart/lost acknowledgement, concurrent start/retake, UPDATE ownership, NULL selection, immutable completion and refused/failed browser recovery. Do not redesign accepted adapters or add an unnecessary full audit.

## M2S-R3 — restore/conversion sequence still conflicts with proposed writes (P2, open)

**Revised draft:** lines 123–133 (§5), 385–404 (Appendix C).

1. **Old backups:** §5 requires all four new tables without qualifying by archived schema version, then promises schema 1–10 backups upgrade normally. Current `backup.rs:2849` invokes `verify_application_database` on staging **before** publishing the restore plan; validation is read-only (`backup.rs:369`). Old archives legitimately lack the new tables. The literal proposed check rejects them before Migration 11 can run. A minimal synthetic schema-10 fixture passes current basic-table/ceiling predicates and fails the new unconditional table requirement. This is a predicate diagnostic, not an executed Rust restore test.
2. **Startup reconversion:** Appendix C selects every legacy row with NULL conversion/error markers. Its import/Gemini writers create a legacy row plus an active version but do not specify setting/reconciling those markers atomically. A newly imported unmarked row is selected again at the next startup; inserting another active version conflicts with the new unique index. The synthetic SQL fixture confirms selection plus the conflict. The document must explicitly prevent this, rather than leave the implementer to infer it.
3. **Writer ordering and execution point:** Gemini replacement says insert the new active version and then deactivate the old one. The unique active-version index requires the opposite transition order within one rollback-safe transaction. "On application database initialization" also needs the actual entry point: desktop migrations run during `Database.load` in `createTauriDatabase`, not before that load in Tauri setup. Define conversion completion before repository access for native and browser paths, including startup after restore. Include the actual `removePracticeTest` and material/file-removal paths, not only a nonexistent `removeStudyMaterial` method.

**Finish:** use schema-aware restore validation (old supported schema uses existing checks; schema 11 requires all new structures/semantic invariants; future schemas refuse), then an explicit startup upgrade sequence preserving staged-restore safety. Tie legacy row/version/items/markers/active transition/unfinished-attempt policy into the same owned transaction. Validate every legacy question rather than accepting any nonempty parsed array, and define corrupt-row handling and PR 1 behavior while the old UI remains. Add old/new/corrupt archive, interrupted conversion, failed replacement and startup-after-import planned tests. Verify completed result/response consistency, not just table existence and item FKs.

The broad claim that all old binaries refuse to **open** schema-11 databases is also unsupported: current main's ceiling is enforced in backup validation. State the tested/designated archive-restore boundary; treat raw database downgrade as unsupported unless a particular binary is actually verified.

## Nonblocking cleanup to include in the same edit

Fix GitHub-relative source links (`../src/...`, `../src-tauri/...`), remove unmeasured 1,800-line/5–20KB claims, remove the unsupported normal-sleep data-loss example, and use synthetic letter questions instead of regulatory examples. Put the deliberate erase-history path and access to retained review after source deletion in PR 2's interface list. Keep owner choices genuine and concise; engineering defaults belong in the contract.

## Next step

One model completes the [single finalization prompt](M2_PRACTICE_SESSION_SCOPE_FINALIZATION_PROMPT_2026-10-04.md), marks each requested rule with its exact document location, and stops for focused re-review. Preserve closed retention work. Do not implement M2, launch the app or rerun source gates for this document-only task. Accepted Slice B/A2, the real-user waiver and unverified installed/release gates remain unchanged.
