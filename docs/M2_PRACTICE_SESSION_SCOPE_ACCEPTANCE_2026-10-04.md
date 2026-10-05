# M2 saved practice-session planning acceptance, 4 October 2026

**Decision: the reviewed planning scope is ready for owner approval.** M2S-R1–R3 are closed against the [canonical reviewed scope](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md), including the explicitly attributed reviewer amendments in Appendix E. This accepts the plan, not application source, Migration 11, installed verification or a release. Owner approval of the M2 defaults and PR 1 remains pending.

## Reviewed identity

- Submitted checkout `/Users/rickymac/code/Flight-training-pr70-integration`, detached main `95874216fd70170460da0a460d47aa5475c7577e`; sole change was the untracked 550-line scope document.
- Submitted SHA-256 `b284c4e6f74369bd6caa065066d6e4346c60c92f6578ebe6e9e01592e3e89a1d`, matching the handoff. [The submitted draft is frozen byte-identically](evidence/m2-practice-session-scope-acceptance-2026-10-04/README.md).
- Published reviewed scope SHA-256 `91c441d44d773f4652078940414d5b916301e7306b8c29267acec99bd15d30ff`. Codex made bounded planning amendments to finish the engineering contract instead of sending another document-only correction round. The evidence includes the exact amendment diff.

## Findings closed

| Finding | Resolution in reviewed scope | Verification boundary |
|---|---|---|
| M2S-R1 — retention mismatch | D1/Appendix A/E disclose completed detailed-history retention, unfinished cleanup, detached grouping and explicit history erasure. Current source/test and older backups are distinguished from erased historical content; minimal non-content retry tombstones are disclosed. | In-memory material deletion retains completed review, prunes the draft/unused version, preserves history association and clears pruned-attempt receipt results. Owner still chooses the policy. |
| M2S-R2 — retry/state/recovery contract | Appendix B/E define all five request/result shapes, durable receipt/replay precedence, revision checks for stale choices/completion, concurrent retake expectations, current-state refresh, score/cursor rules and existing native/sql.js durability. | Corrected SQL rejects duplicate active/draft rows, cross-version INSERT/UPDATE and invalid NULL/dont-know choices. JSON examples parse. Production replay/concurrency/durability behavior is a PR 1 test requirement, not yet tested source. |
| M2S-R3 — migration/writer/restore integration | Appendix C/E name actual initialization/writer/remove paths, atomic marker/version ordering, whole-test conversion supporting 200 imported questions, old/current/future schema validation and recomputed result/receipt semantics. | Relevant current source was inspected. The schema-aware sequence is a normative future contract; no production migration or archive restore was executed. |

## Reviewer amendments and reasons

The implementer's revised SQL and durable receipt table resolved the earlier demonstrated constraint failures. Remaining prose still named IndexedDB/OPFS while the accepted browser adapter uses localStorage, limited legacy conversion to 100 questions while accepted import supports 200, allowed edited responses without stale-request ordering, and lacked receipt/history association after source deletion. These are corrected in the published scope, with revision/history/tombstone fields in its proposed DDL.

The reviewed document also narrows unsupported old-binary claims, names the real initialization/remove paths, settles all-answered cursor and refresh-after-commit behavior, gives actual completed-result validation requirements, clarifies PR 1 old-UI compatibility and adds the missing planned failure/round-trip/interruption cases. Persistent UUID v4 identity avoids a new UUID-v5 dependency/feature requirement. No app source, dependency, workflow or release configuration changed.

## Proportional independent verification

Executed the exact proposed DDL from both documents in disposable in-memory SQLite with FK enforcement: **9 submitted-scope checks and 12 reviewed-scope checks passed**, including the retained deletion lifecycle and added history/tombstone/revision constraints. Parsed all 10 JSON examples in each version. Compared the submitted working file to its frozen copy, checked relative links/anchors, evidence hashes and staged whitespace. See the [reproducible diagnostic and receipt](evidence/m2-practice-session-scope-acceptance-2026-10-04/README.md).

No full frontend/Rust matrix, native command execution, complete archive round trip, application launch, owner profile/data, provider call, packaging or installed test was performed. Those source/installed checks are not implied by planning acceptance. Accepted Slice B/A2 and the real-user waiver remain effective; installed/release gates remain unverified/blocked as previously recorded.

## Concrete owner decision and next assignment

Recommended approval: **D1 Policy A detailed completed history; D2 abandon unfinished attempts with notice on regeneration; D3 single-material practice; D4 preserve and safely skip corrupt legacy tests; D5 informational practice scores; immediate training feedback.** Approve the two-PR scope, with PR 1 data foundation first and PR 2 UI only after independent PR 1 acceptance.

The [model-neutral PR 1 prompt](M2_PRACTICE_SESSION_PR1_PROMPT_2026-10-04.md) is ready but conditional on that owner approval. The previously approved Slice B defaults do not substitute for this new M2 decision. No further planning audit is required before that decision; after approval, assign the substantial source work to one model and review the resulting diff/tests.
