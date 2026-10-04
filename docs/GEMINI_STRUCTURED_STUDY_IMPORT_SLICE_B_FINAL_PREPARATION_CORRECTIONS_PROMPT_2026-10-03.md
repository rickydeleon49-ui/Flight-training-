# Gemini: finish Slice B preparation corrections on the Mac

Continue in `/Users/rickymac/code/Flight-training-` on the existing dirty branch `codex/structured-study-import-slice-b-preparation`, HEAD/base `3efe95316b200848178033a68d057f66815cf427`. Your assignment is to finish the **documentation preparation**, addressing **BPREP-R4 and the remaining BPREP-R3 contract issues** from Codex's new independent re-review. Keep the addressed R1/R2 work. Leave everything uncommitted and unpushed for Codex. Do not start Slice B implementation.

## 1. Preserve the exact reviewed state

Read `docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_REREVIEW_2026-10-03.md` and `docs/evidence/structured-study-import-slice-b-rereview-2026-10-03/README.md` from GitHub or with `git show origin/main:<path>` after fetching. Codex publishes the review in a separate worktree. Do not switch/reset/stash/clean/merge this dirty branch to read it.

Verify all seven entries in your current `docs/evidence/structured-study-import-slice-b-preparation-2026-10-03/final-hashes.txt`, whose SHA-256 is `988346289cc0d9c68e8c8251a4635b0f664b9d32a3fc765a8f542947fbb8467b`. Eight files including that receipt were reviewed; exactly three tracked files were modified and five untracked files were present. Preserve and explain any intervening differences. Codex's new `submitted/` evidence contains verbatim inert snapshots of all eight; explicitly rely on those when replacing your active documents and preserve the old receipt locally.

Codex verified all 351 tracked files outside documentation/STATUS unchanged. Keep production code, tests, fixtures, manifests, lockfiles, migrations, Slice A evidence and release identity byte-identical. Read the actual adapter/interface/repository and accepted A2 correction requirements before choosing a proposed design. Any sql.js diagnostic during this assignment must be synthetic, disposable and separate from the app.

## 2. BPREP-R4: specify a complete sql.js handle lifecycle

Read the checked-in `sqljs-lifecycle-probe.cjs` and observations. Locked/installed sql.js 1.14.2 resets `foreign_keys` from 1 to 0 on export. The probe then accepts an orphan and misses a cascade. A handle reconstructed from bytes starts with enforcement off; reinitialization restores it, and a subsequent export resets it again. This is real dependency behavior, not a failed Slice B implementation test.

Rewrite report §4.5 and conditional prompt Phase 3 around one explicit handle initializer. Identify the required connection PRAGMAs and verify them. Explain exactly how the initializer runs on first open, immediately after successful pre-operation snapshot export and before BEGIN, after the durable export and before any other operation can access the handle, and after replacement recovery. Reapplying only during recovery is insufficient. Do not try to change `foreign_keys` while a transaction is active.

Specify ownership through snapshot, transaction, commit, export, storage write, reinitialization and recovery. Make export/reinitialization exceptions observable; describe which errors leave persisted bytes unchanged and which can occur after storage has changed. Define the result and safe refusal state for each case instead of claiming storage is always untouched after any kind of failure. Keep unrelated prior rows intact, prevent another write from being erased by recovery, and ensure a retry never mistakes an in-memory-only save for durable success.

Audit every existing handle user in the plan: select, execute, persist, the existing debrief atomic method and the proposed import method. Explain which operations share the queue/barrier and how closures resolve the current handle. Exports invalidate prepared statements; none may outlive the protected operation. Define how failed reinitialization/recovery disables the adapter before exposing an unusable handle. Keep this contingent on the eventual accepted A2 API rather than independently repairing current source.

Add stable-ID planned **real-sql.js** cases for foreign-key enforcement after snapshot, successful flush and recovered handle replacement. Assert both orphan rejection and delete cascade, prior rows and durable bytes, subsequent ordinary/debrief writes, retry, and initializer/recovery refusal. Keep previous storage/export/queue cases. You may rerun the bounded checked-in synthetic dependency probe if needed; label it separately and never access browser app storage or the owner's database.

## 3. Finish BPREP-R3 at the actual command boundary

The current proposed typed command argument is decoded by Tauri before the command body. Unknown-field/missing/type failures therefore bypass your static `{code, message}` return mapper and can become framework strings. Read the locked-source anchors in Codex's verification JSON. Do not describe `deny_unknown_fields` alone as delivering your promised sanitized error contract.

Choose an explicit application decoding boundary, for example an operation JSON value received by the command and then decoded/validated inside it before any database access. Specify bounded operation inputs, unknown-field policy for every nested type, mandatory/nullable field presence, Unicode normalization and complete existing limits. Separate application errors from failures of the outer Tauri envelope. Never forward raw serde/SQL/paths/payload strings to the UI or receipts. Give a static code/message allowlist and the TypeScript handling of unexpected framework rejections.

Write exact TypeScript success/failure types, Rust attributes and serialized examples for `saved`, `already_saved` and representative failures. Enum `rename_all` changes variant names, not struct-variant field names; explicitly settle `materialId` on the wire or use an equally explicit agreed spelling consistently. Keep `operationId == materialId`, UUID v4 and lowercase 64-hex hash requirements. Do not change the accepted packet contract or add a stored hash column.

Reconcile stored-content equality with every field in `canonicalPersistenceJson`: material title, aid presence, both aid titles, provider/model, summary, sections, flashcards including sourcePage, sourceNotes, and all question/options/answer/explanation/sourcePage content. A client hash is never proof that current database rows match. State which non-content/default material fields must identify an imported material and which mutable metadata are deliberately outside equality.

Use valid UUID v4 examples in all positive/idempotency/conflict rows so they reach the intended condition. Add planned boundary tests for unexpected synthetic private-looking keys, missing/wrong types, malformed IDs/hash, nested unknown fields and exact success JSON. Assert no writes and exact sanitized failures. Keep the full insert/durability/conflict/cancellation/refresh/accessibility matrix; do not turn planned tests into claimed runtime results.

## 4. Reconcile evidence and finish the package

The current matrix has **46 unique rows: 42 source/development plus four future installed tests**, with all 22 original IDs preserved. Correct total/subtotal language, preserve those IDs, and derive new counts after your additions. All rows remain planned. Label any synthetic diagnostic separately.

Use accurate repository-inspection scope: Codex freshly inspected 63 PR metadata entries, zero open PRs before this review publication, and remote branch names. Three A2-named matches are existing documentation/preparation PRs/refs; no match exists for `fix/atomic-study-material-saves` in that inventory. This does not inspect every PR's source or the Windows machine. Record your actual commands/date/scope if refreshing; label inherited environment observations as inherited instead of remeasured.

Update only the preparation report, conditional implementation prompt, evidence README/receipt, STATUS, PROJECT_HANDOFF and Mac tracker. Mark them corrected **pending independent re-review**; do not mark R3/R4 accepted. Preserve Slice A's PR #62 acceptance and every A2/M2/D1–D9, installed-account/signing and release gate. No fresh owner exception exists for B.

Check source references, all local links, all eight deliverable files for whitespace/conflict markers, tracked/untracked inventory and unchanged source. Regenerate the self-excluding receipt. A documentation correction needs no full frontend/Rust/build matrix; keep the scoped toolchain/SDK/locked commands as future implementation instructions only.

Return branch/base and before-edit hash verification; exact R3/R4 issue-to-correction anchors; one coherent handle lifecycle and IPC JSON/error/equality specification; stable-ID counts with all unexecuted cases; unchanged-source proof; final inventory/hash and measured check outcomes. Stop for Codex review. Do not commit/push, alter source/dependencies/schema, implement import UI/persistence, launch/install/sign releases, touch accounts/owner data, call real providers or message the Windows owner.
