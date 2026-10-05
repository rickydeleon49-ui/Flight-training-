# M2 saved practice-session scope — independent review, 4 October 2026

> Follow-up: the [focused re-review](M2_PRACTICE_SESSION_SCOPE_REREVIEW_2026-10-04.md) closes the retention mismatch and identifies the remaining R2/R3 work. Use the [current finalization assignment](M2_PRACTICE_SESSION_SCOPE_FINALIZATION_PROMPT_2026-10-04.md). This original review is historical.

**Decision: revise the proposal before owner approval.** The user outcome and two sequential source PRs are reasonable. Three concrete planning findings remain; this is not a rejection of the roadmap feature or a defect in accepted Slice B. Use the [single model-neutral correction assignment](M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md). No M2 implementation is authorized.

## Reviewed identity and evidence

- Checkout: `/Users/rickymac/code/Flight-training-pr70-integration`, detached accepted main `1f5ea3e4db6e66b8c1a7dfee236d43e0a3cb22b6`.
- Sole working change: untracked `docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`, SHA-256 `b6f036757d91b24ae971d47a00c05bcd1c28b9c3437e9349517a01ad8418717c`.
- [Frozen submitted proposal and synthetic observations](evidence/m2-practice-session-scope-review-2026-10-04/README.md) are shared for other agents. The original proposal remains untouched and uncommitted in its checkout.
- Reviewed the document against PracticeTestPanel, Gemini and Slice B persistence, migration registration and backup validation. Ran only an in-memory SQLite diagnostic of the proposed SQL. No application, migration, full test matrix or owner data was used.

## M2S-R1 — retention decision does not match the proposed data lifecycle (P2)

**Submitted lines:** 68, 130–137, 187–247.

D1 offers “detached attempt summaries”, promises the active test is erased and estimates less than 1 KB per attempt. The schema instead retains every version's complete questions/options/explanations, every response and in-progress attempts. Deletion only nulls material references; detached versions remain `is_active = 1`.

**Concrete evidence:** with foreign keys enabled, deleting the synthetic source retained both full versions, both question items, the completed attempt and its response. Both detached versions still reported active; 4,150 characters of synthetic question text remained. Foreign-key checks reported no violations. This contradicts the summary-only owner decision and its storage claim.

**Required correction:** choose and disclose the actual proposed retention policy. If completed historical review retains frozen question content, say so plainly, define treatment of unfinished attempts/unused versions and a deliberate history-erasure path. If keeping scores/titles only, specify how full content/responses are purged and what historical review is no longer available. Reconcile the decision table, schema, deletion transaction and tests; do not silently approve the policy.

## M2S-R2 — atomic contracts omit the invariants needed for safe resume/retry (P2)

**Submitted lines:** 22–29, 96, 124, 163, 219–247, 260–330, 340–349.

The proposal supplies sample requests and an operationId, but no durable operation-replay rule, conflicting-retry outcome or retake wire contract. It does not define strict field/bound checks, item-to-attempt-version ownership, immutable completed-state refusal, scoring/unanswered rules, response correction policy, authoritative timestamps, bounded contention or failed browser durability behavior. Action names differ between the assignment and examples. “I don't know / Skip for now” conflates an explicit response with an unanswered item. The claim that closing during an in-flight save causes no loss exceeds what asynchronous persistence can guarantee.

**Concrete evidence:** the proposed SQL permits two active versions for one material and a response on a completed attempt using another version's item. It also accepts selected index 99 with both `is_dont_know = 1` and `is_correct = 1`, with no FK violation. A sketch may enforce business rules in transactions instead of every SQL constraint, but the corresponding normative command rules are absent here.

**Required correction:** provide one small state/operation table and consistent exact request/result/error contracts for start/resume, response, completion, retake and regeneration. Define persistent replay identity, same-input retries versus conflicts, ownership, response semantics, resume position, scoring computed from frozen content, immutable completion and atomic/durable failure behavior. Specify which invariants are SQL-enforced and which are checked in the native/browser transaction. UI advances/reveals confirmed progress only after acknowledgement; distinguish acknowledged data from pending/failed or unknown-commit work. Add targeted planned tests for these invariants rather than promising unmeasured under-5ms operations.

## M2S-R3 — migration/versioning/restore integration is not specified (P2)

**Submitted lines:** 17, 69–71, 130–133, 159–173, 253–255, 344–349.

The current migration mechanism registers SQL; the proposal introduces a custom Rust/TypeScript conversion step without an execution point, durable conversion-status record, stable-ID/retry algorithm or failure/recovery sequence. D4's `unmigrated` flag has no representation in the sketch. The first implementation assignment lists session commands but not the existing writers that must create/activate versions and apply regeneration policy atomically.

On current main, `documentRepository.savePracticeTest` updates only the legacy practice_tests row, and Slice B imports create a **new** material rather than overwrite an existing one. The proposal's baseline statement that re-import overwrites a test is incorrect. Without a specified integration path, future sessions could keep using a stale version after the existing writer updates the test.

SQLite snapshots do capture new tables, but capture is not semantic restore validation. Current `backup.rs::verify_application_database` checks SQLite integrity, basic tables and the migration ceiling; raising the ceiling alone does not validate new table completeness, attempt/item version ownership or result consistency. Older-archive migration and hypothetical older-build refusal must be specified/tested, not claimed as already verified.

**Required correction:** define a restart-safe conversion/version-activation path, preserving corrupt original content and using sanitized durable status; enumerate Gemini save, import save, regeneration/removal and material deletion hooks within PR 1. Tie legacy writes, version/items, active-pointer transition and unfinished-attempt policy into the selected atomic operation, or describe a bounded tested reconciliation contract. Specify backup schema/content checks and conversion after restore, with exact old/new archive and failure fixtures. Include build, formatting and Clippy in the conditional source gate.

## Other bounded corrections

Use repository-relative links for GitHub, synthetic examples without aircraft performance assertions, and clear database-schema versus app-version wording. Remove unsupported line-count, latency, storage and legal-compliance guarantees. Keep immediate-feedback behavior as a proposed default unless a real owner decision is needed. Installed macOS/VoiceOver observations remain unverified; no check-in reapproval is required.

## Next step

One implementer revises the existing proposal under the [correction prompt](M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md), preserves the original, verifies the document and stops for Codex review. Keep the two-PR structure if useful. Do not implement production tables, migration 11, commands or UI until a coherent scope and owner decisions are approved. Accepted A2/Slice B and release status remain unchanged.
