# Finish the resumable-practice-test proposal — model-neutral correction assignment, 4 October 2026

Any owner-selected model may complete this task. One active implementer; Codex reviews and coordinates Git.

## Result and boundary

Revise the existing `docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md` into one coherent owner-reviewable scope. Close **M2S-R1–R3** from the [independent review](M2_PRACTICE_SESSION_SCOPE_REVIEW_2026-10-04.md). Preserve the proposed user outcome and reasonable two-PR split. This is a document correction, not authorization to implement M2.

Use `/Users/rickymac/code/Flight-training-pr70-integration`. The reviewed proposal is the only uncommitted change on accepted source `1f5ea3e4db6e66b8c1a7dfee236d43e0a3cb22b6`; SHA-256 `b6f036757d91b24ae971d47a00c05bcd1c28b9c3437e9349517a01ad8418717c`. Check path/status/hash once. Preserve competing changes and the historical Slice B snapshot branch; do not reset or pull over the uncommitted proposal.

Fetch/read the latest review documents without merging over the draft, using `git show origin/main:<path>` or GitHub if necessary. Read the [frozen proposal and SQLite observations](evidence/m2-practice-session-scope-review-2026-10-04/README.md). Keep a byte-identical original snapshot before editing.

The real-user check-in waiver remains effective. Scope approval and retention decisions for this new feature are still pending. Do not ask the owner questions yet: prepare the concrete choices and complete implementation contract first.

## 1. M2S-R1 — make retention an honest owner decision

The present table says “summaries” but the SQL retains full versioned content, all responses and unfinished attempts.

Choose one recommended policy, with a real alternative and concrete consequences:

- If retaining historical review, explicitly disclose which question/choice/answer/explanation/source-title data survives deletion. Define completed, abandoned and in-progress attempts separately; unused version cleanup, inactive detached versions, and a deliberate erase-history path.
- If retaining only scores/titles, define purging of full content/responses and loss of detailed review.
- Describe deletion of the material/PDF separately from retention of derived study history, including backup retention limits. Do not imply deleting active records erases all historical copies.
- Reconcile decision table, schema/FKs, atomic deletion, UI notice and test rows. Drop the unsupported less-than-1KB claim.
- Do not claim any retention choice has already been approved.

Keep the main document short. Detailed schema belongs in the appendix.

## 2. M2S-R2 — write the missing native/browser contract

Use a consistent action vocabulary and valid JSON examples for all operations, including retake. A compact operation/state table should settle:

1. IDs and bounded strict payload validation; unknown keys; fixed sanitized errors; authoritative clock/production timestamps and injected test clock.
2. Version/item ownership; at most one applicable active version and resumable attempt; which invariants have SQL constraints and which are verified atomically.
3. Persistent operation identity for each mutation: identical retries return the previous result, changed-input reuse conflicts, concurrent start/retake cannot duplicate attempts, and a late response retry cannot mutate a completed/abandoned attempt.
4. State transitions for start/resume, record, complete, retake, regeneration and deletion. Define whether accepted answers can be changed; keep the first scope simple and explain the consequences.
5. “I don't know” is an explicit response; unanswered/skip is different. Define resume position and navigation, optional early completion, denominator/rounding and each result count. Derive scoring from frozen questions and stored responses, never client isCorrect or score fields.
6. Immutable completion: same completion retry preserves result/timestamps; conflicting or invalid transitions are refused; no response can reference another version's question.
7. Bounded lock wait, rollback, sql.js serialized durable writes/recovery, unsupported atomic-driver refusal, refresh failures and lost acknowledgement. Reuse accepted A2 patterns rather than redesigning the database layer.
8. UI acknowledges saved state only after success. Explain what happens if a save fails or the app exits before acknowledgement; preserve the same retry identity and recover acknowledged/unknown-commit results without a false no-loss guarantee.

Supply planned test rows for conflicting retries, two concurrent starts/retakes, cross-version response, completed-state mutation, invalid selected-index/dont-know combinations, cursor recovery, rollback, refused browser storage and failed recovery. Remove the unsupported under-5ms threshold. No full matrix or performance benchmark is needed for this proposal.

## 3. M2S-R3 — reconcile the actual migration and writer paths

Inspect only relevant current source. Explicitly choose SQL migration plus restart-safe conversion, or a safe first-use conversion path; state where native/browser execution occurs and how startup/restore enters it.

Specify:
- Additive schema number based on current main; no edits to shipped migrations.
- Legacy validation, all-or-nothing conversion of each test, bounds/corruption handling, stable persisted identity across restart/restore, collision/retry behavior, and durable sanitized conversion status. Do not leave an unmigrated flag with no storage/read contract.
- Existing Gemini save/regeneration, Slice B native/browser import, test removal and material deletion integration. Import remains create-new; replacement import is deferred.
- Atomic creation of version/items and transition of the active version, with the chosen unfinished-attempt policy. Failed generation/save must preserve the previous usable version and progress. Historical attempts keep their own content.
- How PR 1 remains safe with the old UI still active until PR 2, including old read/write compatibility and corrupt-row visibility.
- New-table completeness and semantic checks for backup/restore, version/item ownership and immutable result consistency; preserve existing staged-restore rollback and file safety. Snapshot capture alone is insufficient.
- Concrete older archive upgrade, current archive round trip, corrupt new-table archive refusal, interrupted conversion/restore and rollback fixtures. Distinguish database schema version from app version; do not claim every historical binary behaves like current main.

Update the conditional PR 1 file/interface list with those writer/validation hooks. Its source gate includes typecheck, frontend tests, build, full Rust tests, Clippy, fmt, Cargo lock and diff checks, plus migration/restore/contract checks appropriate to the change. Implementation remains conditional on owner approval.

## 4. Finish once and stop

Correct baseline mistakes and use repository-relative links so the proposal works on GitHub. Replace aircraft-number examples with clearly synthetic study content. Remove unsupported size, time, code-length and legal guarantees. Keep only genuine owner decisions; routine engineering choices belong in the proposal.

Keep the main scope roughly two readable pages; use appendices for schema, exact contracts and test mapping. Reuse the existing design instead of producing a new broad architecture package.

Verify links, JSON/schema consistency and agreement between choices, lifecycle and tests. An in-memory diagnostic of proposed SQL is optional where it settles a real ambiguity; do not create a shipped migration, alter application code/dependencies, run the full app suites, launch the app, access real data or perform release/account work.

Return revised document path/hash, a concise R1–R3 correction map, and the proposed owner decision summary. Leave it uncommitted/unpushed for Codex review, then stop. Do not implement PR 1 or start another roadmap task.
