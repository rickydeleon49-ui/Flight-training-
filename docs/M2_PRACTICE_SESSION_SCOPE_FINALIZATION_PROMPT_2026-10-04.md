# Finish M2 practice-session contracts — model-neutral assignment, 4 October 2026

Any owner-selected model may complete this task. One implementer; Codex provides technical direction, independently reviews and coordinates Git. This is the next active assignment after the [focused re-review](M2_PRACTICE_SESSION_SCOPE_REREVIEW_2026-10-04.md).

## Outcome and authorization

Finish the existing saved/resumable-practice-test proposal so the owner can approve one concrete scope. **M2S-R1's retention mismatch is closed. M2S-R2 and M2S-R3 remain open.** Preserve Policy A as the recommended, not yet approved, default and the two sequential source PRs. Correct both remaining sections together; do not start application implementation.

Use `/Users/rickymac/code/Flight-training-pr70-integration`. Last verified base: detached `504a253ffc99650e0903aa3cf452034bd93d13ac`; sole working change `docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`, SHA-256 `b7c14382344fd53ff1178bbfb682bdebe9c02e96e7253cbde7eb35483db22dc8`. Codex may synchronize the clean base with the new review-only main commit while preserving this untracked draft. Check status/hash once; preserve unexpected changes, do not reset or overwrite another agent's work. Do not edit the separate dirty primary clone or historical Slice B snapshot branch.

Read the latest re-review, [frozen revised draft/observations](evidence/m2-practice-session-scope-rereview-2026-10-04/README.md) and relevant source only. Use `git show origin/main:<path>` if review documents are not in the checkout. Preserve a byte-identical pre-edit copy outside the proposed application source. The older [correction assignment](M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md) supplies context; this prompt gives the remaining completion criteria.

## 1. M2S-R2: make retries and durable state implementable

Replace Appendix B's promises with a compact normative contract. Choose routine engineering defaults yourself and state them precisely; do not ask the owner to design storage or serialization.

### Durable operation identity

Specify actual receipt storage (a small operation table is a reasonable default) or an equally concrete persisted design. State key, action, normalized request identity, authoritative time and saved result; mutation and receipt commit together. Include receipt retention, backup/restore and history-erasure handling. Distinguish stable retry identity from a newly intended user action.

Define ordering: validate the strict request; inspect committed operation identity inside the owned transaction; identical retry returns the stored result, changed-input reuse returns `OPERATION_CONFLICT`; only an unseen operation checks current state and applies a transition. A late retry of an already committed response/completion returns its old result without mutating a closed attempt; a new response operation against a closed attempt fails. Do not leave conflicting statements between the state table and test rows.

Cover this exact scenario: R retakes successfully and creates A; acknowledgement is lost; restart; replay R returns A and does not abandon A/create B. Specify two concurrent different start/retake calls, their serialization, and the single applicable in-progress attempt invariant. Choose SQL uniqueness and/or transaction ownership with explicit checks; no reliance on React state.

### Exact wire/state contract

Provide valid JSON request/result examples or an exact typed field table for **all five** actions: `start_or_resume`, `record_response`, `complete_attempt`, `retake_attempt`, `abandon_attempt`. No comments inside blocks labelled JSON. Define required/optional/null fields, UUID/ID representation, maximum request/field sizes, integer/index bounds, rejected unknown keys and fixed sanitized errors. Reuse accepted import question limits where appropriate; do not truncate valid content silently or accept client `isCorrect`/score.

Use an authoritative native/browser production clock; tests inject one. Decide whether client timestamps are absent or validated metadata, never authority over committed result time. Specify material/version/attempt/item ownership and stale active-version behavior.

Keep editable in-progress choices if preserving the current recommendation, but define request ordering/revision checks so an old retry cannot overwrite a newer answer. Enforce ownership on UPDATE/upsert as well as INSERT. An ordinary choice requires a non-NULL integer within frozen options; "I don't know" requires NULL and is always incorrect; unanswered is no stored response. Correct the SQL NULL-CHECK gap or explicitly enforce the rule in both transaction implementations.

Define resume position, navigation/skip behavior, whether early completion is allowed, answered/correct/incorrect/dont-know/unanswered counts, denominator and rounding. Completion derives from frozen content and committed responses, then becomes immutable. Retake uses the latest active version; completed historical attempts remain untouched.

### Failure and durability sequence

Reuse `src/data/connectionOwner.ts`, `sqlJsDb.ts`, existing transaction helpers and native atomic-save conventions. State bounded native lock wait (existing five-second convention is appropriate), BEGIN/validation/mutation/receipt/COMMIT/rollback sequence, and unsupported-driver refusal. For browser development mode, serialize the whole operation; return success only after durable export/store; restore last stored state on refused storage; disable/refuse subsequent operations if recovery cannot re-establish FK invariants. No production hosted-storage claims.

Explain lost IPC acknowledgement, refresh failure after commit, and stable-ID recovery. UI cannot declare pending work saved. A failed UI refresh cannot convert a successful commit into a fresh retake request. Keep this short and reference accepted adapter behavior rather than rewriting its implementation.

Add planned test rows for restart/replay/conflict, concurrent start/retake, stale response ordering, cross-version UPDATE, NULL/invalid selection, cursor recovery, immutable completion, failure after partial writes, refused browser storage and failed recovery. These are future source acceptance tests, not claims that source exists now.

## 2. M2S-R3: fix migration/writer/restore sequencing

### Startup conversion and writers

Name actual initialization entry points and ordering. Desktop SQL migrations run during `Database.load` in `createTauriDatabase`; perform native conversion after that load and before repositories can read/write sessions. Browser conversion runs after `applyMigrations` with owned durable execution before repository use. Specify behavior after startup restore and conversion failure. Do not run Migration 11 conversion in Tauri setup before tables exist.

Define bounded all-or-nothing validation/conversion of each legacy test: question structure/options/correct index/text/reference limits, deterministic or persisted stable version/item identity, collision/existing-version handling, malformed/empty cases and sanitized durable status. A nonempty JSON array alone is insufficient validation. Corrupt content stays intact and unavailable for sessions, with an honest read/UI status. Resolve how PR 1 remains safe with the old UI still active until PR 2; don't claim a PR 1 UI notice that isn't implemented there.

List actual hooks and atomic write order:

- `documentRepository.savePracticeTest` and its native/browser owned save path: validate first; deactivate previous active version, abandon old unfinished attempt under D2, insert new version/items, update legacy row and conversion marker in the **same** transaction. Failure rolls everything back, retaining old usable content/progress. Unique-index-compatible ordering is required.
- Slice B `src-tauri/src/study_packet.rs` and `src/data/structuredImportTransaction.ts`: create-new import remains unchanged in meaning; legacy row, new version/items and conversion marker commit with the material. A newly imported row must not be selected for duplicate conversion on restart. Preserve Slice B retry/identity behavior.
- Actual `removePracticeTest`, repository `remove` and `src/services/documents.ts::removeMaterialWithFile`: state which versions/unfinished attempts/receipts survive or are pruned, with completed-history preservation and staged file-deletion safety. Fix nonexistent method names in the proposal.
- Define the future erase-history operation and its minimal PR 2 affordance, including how retained completed review is reached after its source material is gone. This is history access, not library-wide quiz generation.

### Schema-aware backup/restore

Current staged restore calls `verify_application_database` before installing the plan. It reads the staged database without migrating it. State a schema-version decision table:

- Supported old archives without Migration 11: existing structural/safety checks pass without requiring new tables; startup applies all missing migrations and conversion in the chosen sequence.
- Schema 11: require every new table/column/index/receipt structure the design relies on; validate FK/ownership, active/resumable uniqueness, choice bounds, attempt state/counters and immutable completed result consistency.
- Newer schema: refuse with the existing newer-format message before installing anything.

Preserve existing staged rollback and file safety. Decide where post-conversion validation occurs and how interrupted/failed conversion resumes without duplicate versions or replacing the owner's good data. Do not mutate archives in the read-only verifier. Specify old archive upgrade, current archive round trip including receipts, malformed/cross-version/inconsistent-result archive refusal, failed replacement, startup-after-import and interrupted conversion/restore planned fixtures.

Narrow downgrade wording to the supported schema/archive boundary. Current main's ceiling is a backup-validator guard; do not assert every historical binary rejects raw database open. App version and database schema version are different. Old-app use of an upgraded database is unsupported unless a specific binary is verified.

## 3. Keep the owner scope clear and finish once

Keep the main owner scope roughly two readable pages with detailed contracts in appendices. Retain recommended defaults: Policy A completed historical review, D2 abandon with notice on regeneration, single-material sessions, safe legacy corruption skip, informational practice-score wording, immediate training feedback. Retention and M2 scope approval are still pending; the prior real-user check-in waiver remains effective.

Fix relative source links (`../src/...`, `../src-tauri/...`), remove speculative line-count/storage figures, use synthetic letter questions, and drop the unverified normal-sleep progress-loss example. Keep the conditional PR 1 file list complete and PR 2 explicitly covering history access/erasure. No extra roadmap, release or architecture package.

Before returning, create a small completion table with **exact section/line locations** for: durable receipt/replay/conflict; all five action shapes; validation/clock/ownership; scoring/cursor; native/browser recovery; initialization; writer/marker ordering; schema-aware restore/semantic checks; old/new/corrupt/interrupted planned fixtures. If one is missing, finish it before claiming resolution.

Verification is document-only: check whitespace, GitHub-relative links, valid JSON/consistent field names, and agreement between DDL, normative rules and test rows. An in-memory proposed-schema diagnostic is optional; label it honestly. Do not ship Migration 11, edit application/dependency/workflow files, run app suites, launch the app, access real data, call providers, package or release.

Return the revised path/hash, concise R2/R3 closure map with locations, verification actually performed and owner-facing defaults. Leave all changes uncommitted/unpushed for Codex's focused review, then stop. No PR 1 implementation until the owner approves the finalized scope.
