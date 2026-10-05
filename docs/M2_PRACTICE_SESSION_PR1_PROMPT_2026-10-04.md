# M2 practice sessions PR 1 — model-neutral implementation assignment, 4 October 2026

Any owner-selected model may implement this task. One implementer; Codex independently reviews and coordinates commits, GitHub PRs and merge.

## Authorization and starting state

**Authorized now: the owner approved all M2 defaults and PR 1 on 4 October 2026.** The [owner approval record](M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md) is the authority; begin the bounded source implementation without another scope-confirmation request. Read the [planning acceptance](M2_PRACTICE_SESSION_SCOPE_ACCEPTANCE_2026-10-04.md) and [canonical reviewed scope](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md), especially Appendices B–E. The earlier uncommitted proposal/finalization handoff is historical; Appendix E and the revised wire shapes govern. This explicit M2 approval is separate from the earlier Slice B approval; the real-user check-in waiver remains effective.

Use `/Users/rickymac/code/Flight-training-pr70-integration`. Codex publishes/synchronizes the reviewed scope before this assignment. Confirm repository/base/working status once, fetch latest main and start a clean `codex/m2-practice-session-foundation` branch from accepted main, or reuse a matching active branch after verifying it contains no competing work. Preserve unexpected changes and the historical Slice B branch; do not reset another agent's work or use the separate dirty primary clone. No additional worktree is needed unless a real conflict requires isolation.

Implement PR 1 to completion, including its required source verification and handoff. Resolve routine engineering choices within the reviewed contract; ask only if a concrete new conflict changes approved scope or safe data handling. Signing credentials and release decisions are not prerequisites for this source task.

## Deliver useful data foundation, keeping UI for PR 2

Implement durable single-material practice attempts for Gemini-generated and imported tests, with versioned questions, response persistence, immutable completion, retake/abandon and deterministic recovery. Existing UI continues reading the legacy practice_tests shape during PR 1. Do not implement resume/history/erase UI, FSRS, multi-material quizzes, new provider/API work or release tasks.

The approved defaults are detailed completed-history retention, abandon unfinished work with notice on regeneration, safe whole-row legacy corruption skip, informational scores and immediate training feedback. The data layer exposes status/history/current-attempt reads for PR 2; a UI notice is not claimed implemented in PR 1.

## 1. Additive schema and initialization

- Reconfirm current registered schema ceiling before allocating Migration 11. Add `0011_practice_sessions.sql` and register it in Rust/TypeScript plus migration checksums; never edit shipped migration bytes. Keep proposed tables/constraints, receipt association, tombstones and nonnegative revision semantics from the reviewed scope. Include stable `history_key` so deleted-source reviews remain addressable.
- Set the source ceiling to the new migration and keep registration/snapshots consistent. Use existing UUID v4, SHA-256, clock and SQLite facilities; no new package/service is needed.
- Desktop conversion runs after `Database.load` in `createTauriDatabase` through an awaited native owned operation before repositories become ready. Browser conversion runs after migrations through the existing connection-owner/localStorage durable path before adapter exposure. Guard relevant native session/test writes against uninitialized conversion state; do not claim unrelated IPC is globally blocked.
- Validate each complete legacy PracticeQuestion array, including 200-question imported tests. Preserve question order/options/key/explanation/sourcePage exactly within the reviewed bounds. Imported sourcePage remains NULL; do not invent references. Malformed/empty/out-of-bound rows remain intact with sanitized durable status; never convert a partial test or silently truncate.
- Persist version/item IDs and marker in one transaction. Restart/restore reuses them; reconcile a matching existing version if its marker is unset and reject a conflicting version rather than adopting stale content. Failed conversion rolls back its writes, leaves original rows/recovery files and safely retries; do not imply rollback of an already committed SQL migration.

## 2. Atomic native/browser/test contracts

- Add the database surface, `PracticeSessionRepository` and native `save_practice_session_atomically` boundary for the five exact actions, with corresponding browser and single-connection test implementations. Register commands normally; no permissive capability/dependency changes or sequential persistence fallback.
- Validate strict field sets/types/IDs/bounds, selected-index/dont-know combinations, ownership and authoritative timestamps. Use allowlisted sanitized errors; reject client score/correctness/time authority and unknown keys.
- Commit state and durable operation receipt together. Canonical request identity is derived locally and shared through native/browser fixtures. Identical replay returns its original result; changed-input reuse conflicts; matching erased tombstones refuse. End transactions on replay/error as well as mutation. A late replay cannot alter closed state.
- Use attempt revision checks for response, complete and abandon; stale newly intended operations cannot overwrite a more recent answer. Retake checks expected current attempt identity, preventing two stale retakes from abandoning each other's new attempt. Two starts serialize to the single applicable attempt. Preserve one active version and in-progress attempt per material.
- Derive correctness/tallies/rounded score from frozen questions and stored selections. Separate dont-know from unanswered; support early completion and NULL next-unanswered cursor when all questions are answered. Closed results/timestamps are immutable.
- Expose current-state refresh and completed-history reads. Do not confuse a historical receipt snapshot with current state or convert a post-commit read failure into a fresh mutation. Future UI retries the original pending action while it exists; restart reads persisted state without claiming volatile operation IDs survive.
- Preserve accepted A2/Slice B connection ownership, five-second native contention bound, rollback, FK reinitialization and browser durable export/store/recovery. Browser storage is existing development-only localStorage, not IndexedDB/OPFS or a hosted backend. Refused storage must not report success; failed recovery disables/refuses later operations. Unsupported drivers refuse before writes.

## 3. Integrate existing writers and deletion safely

- Gemini save/regeneration validates replacement first, then atomically deactivates old active version, applies unfinished-attempt policy/revision, inserts new version/items and updates the legacy row/marker while clearing a prior conversion error. Failure preserves the old usable test and progress.
- Extend accepted native/browser Slice B import transactions to create version/items/marker with the material/legacy row. Preserve create-new meaning, provider/model/sourcePage semantics and accepted import operation/hash retry behavior. A successful import must not be converted again on restart.
- Cover `removePracticeTest`, repository `remove` and `removeMaterialWithFile`. Completed review remains; removing source/test prunes applicable unfinished attempts/unused versions and tombstones their receipts. Material/PDF deletion keeps staged-file rollback/finalization. Avoid raw pooled multi-statement transactions.
- PR 1 prepares stable history association/tombstone/read contracts; PR 2 implements explicit history-erasure UI and its atomic operation under the approved retention boundary. Do not leave an erasure design requiring edits to a shipped migration later.

## 4. Schema-aware backup/restore

Update the staged read-only validator without changing existing file/staging safety. Supported old archives validate with their old schema and upgrade after installation; they do not require new tables. Current-schema archives require every necessary new structure and validate FK/ownership, uniqueness, detached inactive state, question/choice bounds, state/time/result consistency and receipt shape/history association. Recompute completed counts/score instead of merely checking non-null fields. Future schemas refuse before installing anything.

Historical receipts need not equal current mutable state. Tombstones may refer to erased attempts but cannot retain saved answers/results. Keep old archive, current round-trip including receipts, corrupt structure/result, interrupted conversion/restore and rollback fixtures. Preserve recovery copies on failure. Do not mutate staged archives in the read-only verifier or claim every old app binary behaves like current inspected source.

## 5. Meaningful proof and finishing gate

Start with focused native/browser/repository/migration/restore tests. Exercise actual production paths; table-only diagnostics do not prove command replay, atomicity or durability. Use shared wire/canonical identity fixtures for both languages.

Cover the complete scope Appendix D/E, especially retake lost acknowledgement/restart, changed-input reuse, concurrent starts/stale retakes, stale answer/completion races, invalid NULL/index/dont-know flags, cross-version UPDATE, immutable results, all-answered/early-completion scoring, partial-write rollback, refused browser storage/failed recovery, replacement failure, startup-after-import, 200-question conversion, malformed rows, detached history/tombstones and old/new/corrupt/interrupted archives. PR 2 UI-only checks remain explicitly deferred.

When focused checks pass, run one sequential required source gate using the accepted Mac toolchain/SDK setup: typecheck; full frontend tests; production build; full locked Rust all-target tests; locked Clippy with warnings denied; fmt; Cargo-lock check; diff/migration consistency checks. Read current package/scripts for exact commands. Record actual exit codes/counts, distinguish skipped/ignored results, and rerun only justified failures or changed areas. No overlapping full matrices.

All storage fixtures use disposable databases/browser stores, never the owner's live profile. No app launch, provider calls, dedicated-account setup, installed test, packaging/signing or release execution is authorized by this task.

Return one implementation report with changed files, requirement-to-test map, relevant decisions/deviations, exact evidence/log paths, final file hashes and remaining limits. Update STATUS/handoff only as implemented pending independent review, never accepted or installed-verified. Leave changes uncommitted/unpushed and stop for Codex review before PR 2. Do not start another roadmap feature.
