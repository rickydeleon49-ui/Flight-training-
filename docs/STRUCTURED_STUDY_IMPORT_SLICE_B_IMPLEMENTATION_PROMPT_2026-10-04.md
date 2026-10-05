# Implement structured study import Slice B — owner-approved model-neutral assignment, 4 October 2026

**Superseded for remaining work:** implementation has been submitted and independently reviewed. Use the [SB-R1/SB-R2 correction assignment](STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md). This initial assignment is historical; do not restart implementation.

Any implementation model selected by the owner may complete this assignment. Use `/Users/rickymac/code/Flight-training-pr70-integration` on `codex/structured-study-import-slice-b`, prepared from updated origin/main. Use one active implementer. Codex owns senior engineering review and Git integration. Confirm checkout, branch, HEAD, status and current main once; preserve other checkouts and historical evidence. Do not edit the dirty primary checkout.

**Owner approval is recorded:** [Slice B scope and all D1–D9 defaults](STRUCTURED_STUDY_IMPORT_SLICE_B_OWNER_APPROVAL_2026-10-04.md), including D3's older-version tradeoff. The [accepted preparation](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_ACCEPTANCE_2026-10-03.md) closes BPREP-R1–R4. The [M2 check-in waiver](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md) remains in force. Do not ask again for scoped approval, D1–D9 or check-in notes, and do not stop source implementation solely because signing/installed evidence is pending.

Read [the development workflow](PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md), the approved preparation report (especially §4.3–4.6 and §5), accepted packet contract and current code. This assignment supersedes the older conditional model-named prompt. Execute the five implementation phases below; do not write another preparation report before coding.

## 1. One startup verification

1. Confirm accepted Slice A source is in main (`src/logic/studyPacket/` and `src-tauri/src/study_packet.rs`, PR #62).
2. Confirm accepted A2 ancestry through PR #78 and subsequent Mac acceptance. Keep its atomic-save, file-ownership and refresh behavior intact; use current function anchors rather than assuming historical line numbers still match.
3. Confirm the owner approval document is on origin/main. Scope/check-in decisions are already resolved by the linked owner records. D1–D9 are approved; D10–D12 and Slice C remain out of scope.
4. Confirm clean tracked/untracked state on the agreed branch, based on synchronized main. Existing ignored build output/evidence may remain locally; never delete it merely to make a status look clean. The Git coordinator preserves earlier accepted local handoffs on a separate snapshot branch. Do not reset or stash unknown changes.
5. Record the source identity and begin implementation. If a genuinely unexpected competing change exists, preserve it and report the precise conflict; do not reinterpret historical pending-gate paragraphs as new blockers.

Source/development results remain separate from actual installed Mac/VoiceOver evidence. No installed test or signing workflow is assigned by this source task.

---

## 2. Phased implementation plan

Implement Slice B in five focused, reviewable phases. Run focused tests after each phase.

### Phase 1: Domain types and repository mappers
1. In `src/domain/types.ts`:
   - Widen `AiStudySet.provider` and `PracticeTest.provider` from `"gemini"` to `"gemini" | "import"`.
   - Ensure `model: string` accommodates empty string `""` for imported content.
2. In `src/data/repositories/documentRepository.ts`:
   - Update `mapAiStudySet` (line 87) and `mapPracticeTest` (line 97) to read `row.provider` through an allowlist:
     ```ts
     provider: row.provider === "import" ? "import" : "gemini",
     ```
   - Preserve existing `saveAiStudySet` and `savePracticeTest` functions (they continue writing `'gemini'` for AI-generated aids).
   - Ensure malformed or legacy rows safely default to `"gemini"`.

### Phase 2: Native SQLite atomic command and application decoding boundary
1. In `src-tauri/src/study_packet.rs`:
   - Define Rust success and error shapes with explicit wire attributes:
     ```rust
     #[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
     #[serde(tag = "status", rename_all = "snake_case")]
     pub enum NativeImportSaveResult {
         Saved {
             #[serde(rename = "materialId")]
             material_id: String,
         },
         AlreadySaved {
             #[serde(rename = "materialId")]
             material_id: String,
         },
     }

     #[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
     #[serde(rename_all = "camelCase")]
     pub struct NativeImportSaveError {
         pub code: String,
         pub message: String,
     }
     ```
   - Implement `save_structured_study_material_atomically(operation: serde_json::Value, state: State<'_, AppState>) -> Result<NativeImportSaveResult, NativeImportSaveError>`:
     - Offload to background worker thread via `tauri::async_runtime::spawn_blocking`.
     - **Application Decoding Boundary & Normative Validation Table Enforcement:**
       * Explicitly enforce the complete normative field-by-field validation table in [`STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md`](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) §4.3 before touching the database.
       * Validate `operation` is a JSON Object.
       * Perform strict typed decoding checking all known keys at root and nested levels (`material`, `studySet`, `practiceTest`, `sections`, `flashcards`, `questions`, `options`).
       * Reject ANY unknown key (including synthetic or private-looking names) with static `NativeImportSaveError { code: "INVALID_ARGUMENT", message: "The import operation payload is malformed or invalid." }`. Never echo unknown key names or raw serde messages.
       * Validate RFC 4122 UUID v4 format and equality `operationId == materialId` -> `INVALID_OPERATION_ID`.
       * Validate 64-character lowercase hex `contentHash` -> `INVALID_HASH_FORMAT`.
       * **Substantive Content Rule:** A study set is substantive if its normalized summary is non-empty OR it contains sections OR it contains flashcards. A practice test is substantive if it contains questions (≥1). The operation must contain at least one substantive study aid (summary-only guide, guide+cards, cards-only, or practice test). Notes alone do not count. If both aids are null or non-substantive -> `EMPTY_SUBSTANTIVE_CONTENT`.
       * **Title Consistency:** When present, `studySet.title` and `practiceTest.title` must strictly equal `material.title`. Mismatched aid titles -> `INVALID_ARGUMENT`.
       * **Bounded Input Limits:** Enforce single-line vs block normalization, code-point lengths (title 1-200, summary ≤ 20,000, sections ≤ 100 with heading 1-200 / body ≤ 20,000, flashcards ≤ 500 with front 1-1,000 / back 2,000, questions 1-200 with question 1-2,000 / explanation 1-4,000, notes ≤ 5,000). Exceeding bounds -> `CONTENT_LIMIT_EXCEEDED`. Blank required strings -> `INVALID_ARGUMENT`.
       * **Options & Key Validation:** Questions have 2-6 unique options under case-insensitive folded matching. `correctIndex` must be a non-negative integer within `0..options.len()`. Violations -> `INVALID_ARGUMENT`.
       * **SourcePage Invariant:** `sourcePage` must be strictly `null` (or None) on all flashcards and questions -> `INVALID_SOURCE_PAGE`.
       * **Provenance & Defaults:** `provider == "import"` and `model == ""` -> `UNSUPPORTED_PROVIDER`.
     - **Pinned rusqlite connection:**
       * `Connection::open(&db_path)`.
       * Set `busy_timeout(Duration::from_secs(5))`.
       * Enable referential integrity: `pragma_update(None, "foreign_keys", "ON")`.
       * Start transaction with `transaction_with_behavior(TransactionBehavior::Immediate)`.
     - **Idempotency check (Inspecting actual stored content):**
       * If row with `id = material_id` exists in `study_materials`:
         - Compare stored `title` with incoming `material.title`. If different -> `IDEMPOTENCY_CONFLICT`.
         - Compare nullable presence and all stored fields in `ai_study_sets` and `practice_tests` (titles, summary, sections, flashcards with sourcePage null, source_notes, questions with sourcePage null).
         - If all canonical stored content matches payload: commit transaction and return `Ok(NativeImportSaveResult::AlreadySaved { material_id })`.
         - If any stored content differs (or forged hash sent): return `Err(NativeImportSaveError { code: "IDEMPOTENCY_CONFLICT", ... })`.
     - **Insert statements:**
       * Insert into `study_materials` (id, title, material_type='study_guide', topic='general', review_status='needs_review', priority='later', created_at=now, updated_at=now, notes='', file_path=NULL).
       * If `studySet` present: insert into `ai_study_sets` (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider='import', model='', generated_at=now, updated_at=now).
       * If `practiceTest` present: insert into `practice_tests` (source_material_id, title, questions_json, provider='import', model='', generated_at=now, updated_at=now).
     - Commit transaction and return `Ok(NativeImportSaveResult::Saved { material_id })`.
2. In `src-tauri/src/lib.rs`:
   - Register `study_packet::save_structured_study_material_atomically` in Tauri `invoke_handler`.

### Phase 3: Database interfaces and driver adapters
1. In `src/data/db.ts`:
   - Add `saveStructuredImportAtomically?(operation: StructuredImportSaveOperation): Promise<NativeImportSaveResult>` to `SqlDatabase`.
   - Export interfaces `StructuredImportSaveOperation`, `NativeImportSaveResult`, `NativeImportSaveError`.
2. In `src/data/tauriDb.ts`:
   - Implement `saveStructuredImportAtomically`:
     * Invoke native command `save_structured_study_material_atomically`.
     * Intercept unexpected framework rejections or outer envelope errors and map to `{ code: "IPC_TRANSPORT_ERROR", message: "Desktop communication failure during structured study import." }`.
3. In `src/data/sqlJsDb.ts`:
   - Implement `initializeConnection(db: SqlJsDatabaseHandle): void`:
     * Execute `db.run("PRAGMA foreign_keys = ON;");`.
     * Verify `db.exec("PRAGMA foreign_keys;")[0].values[0][0] === 1`. Throws if invariant check fails.
   - Implement `saveStructuredImportAtomically` with full lifecycle management (BPREP-R4):
     * Check adapter is usable (`cell.isUsable`).
     * Serialize execution via `saveMutex`.
     * Capture pre-operation snapshot: `const preOpSnapshot = cell.current.export();`.
     * Immediately run `initializeConnection(cell.current)`.
     * `cell.current.run("BEGIN IMMEDIATE")`.
     * Execute insert statements.
     * `cell.current.run("COMMIT")`.
     * Call durable persistence:
       - `const bytes = cell.current.export();`
       - Run `initializeConnection(cell.current)`.
       - Write to `localStorage.setItem(STORAGE_KEY, btoa(...));`.
     * If durable persistence throws (export or storage failure):
       - Reconstruct handle: `const restoredDb = new SQL.Database(preOpSnapshot);`.
       - Run `initializeConnection(restoredDb);`.
       - Swap handle: `cell.current.close(); cell.current = restoredDb;`.
       - Throw typed `StorageDurabilityError`. Prior storage is untouched.
       - If recovery or reinitialization fails: mark `cell.isUsable = false`, throw `DatabaseDisabledError`.
   - Ensure all queries free prepared statements in `finally` blocks.
4. In `src/data/repositories/documentRepository.ts`:
   - Implement `importStudyPacket(operation: StructuredImportSaveOperation): Promise<NativeImportSaveResult>`.
   - **Enforce strict refusal:** If `!db.saveStructuredImportAtomically`, throw `AtomicPersistenceUnsupportedError`. Do **NOT** fall back to sequential repository writes.

### Phase 4: UI integration and accessibility
1. Create `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx`:
   - Modal using `Dialog` (`src/components/ui/Dialog.tsx`) and `useModalDialog`.
   - State machine:
     * `picking` -> calls `pickStudyPacket()`. If cancelled (`null`), close dialog cleanly.
     * `validating` -> calls `validatePacketText(picked.text, { bomRemoved: picked.bomRemoved })`. If invalid, display allowlisted error codes and paths.
     * `preview` -> mint `materialId = newId()` once. Display title, counts of cards/questions/sections, unverified claims, and `discardedOnSave` summary.
     * `saving` -> compute `contentHash = sha256(canonicalPersistenceJson(payload))`. Call `importStudyPacket(op)`. Prevent duplicate clicks via synchronous ref lock.
     * `error` -> display failure with "Try again" button reusing the same preview and `materialId`.
   - Full A3 accessibility: focus trap, `Escape` key closes dialog (when not saving), backdrop click closes, ARIA attributes.
2. In `src/pages/StudyLibrary/StudyLibrary.tsx`:
   - Add "Import study packet…" button to the `PageHeader` action area.
   - Wire button to open `ImportStudyPacketDialog`.
3. In `src/pages/StudyLibrary/MaterialDetail.tsx`:
   - When `studySet?.provider === "import"` or `practiceTest?.provider === "import"`:
     * Change card title to "Imported study packet" (do NOT show "Gemini study assistant").
     * Display imported-content disclaimer: *"Imported from a file you selected. Its answers and source references have not been checked by Her Flight Deck. Verify against current FAA material, aircraft documents and your instructor."*
     * Do not show the "Gemini will read this document..." empty-state notice.
   - If user attaches a file to an imported material and clicks "Regenerate":
     * Display explicit warning: *"This will replace your imported study guide and practice test with AI-generated content."*

### Phase 5: Verification and acceptance tests
Execute the acceptance matrix specified in [`STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md`](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) §5 (69 planned test rows: 65 source/dev + 4 installed):
1. Native temporary rusqlite tests:
   - Full transaction commit (`TB-ATOM-01`).
   - Injected failure rollback for material, study set, and test inserts (`TB-ROLL-01`, `TB-ROLL-02`, `TB-ROLL-04`).
   - Bounded contention retry on busy lock (`TB-LOCK-01`).
   - Idempotent retry returning `AlreadySaved` with valid RFC UUID v4 (`TB-IDEM-01`).
   - Conflict detection on title, notes, presence, pre-existing, and forged hashes (`TB-CONF-01` to `TB-CONF-06`).
   - Defensive revalidation refusing invalid inputs (`TB-DEF-01` to `TB-DEF-04`).
   - Content varieties: guide-only, test-only, source-notes retention, summary-only guide, and summary-plus-notes (`TB-CONT-01` to `TB-CONT-05`).
2. WebAssembly sql.js lifecycle and durability tests:
   - Transaction commit and storage export (`TB-ATOM-02`).
   - Mid-statement rollback for each insert (`TB-ROLL-03`, `TB-ROLL-05`, `TB-ROLL-06`).
   - Storage failure and export failure durability handling (`TB-DUR-01`, `TB-DUR-02`).
   - Recovery failure and serialized queuing (`TB-DUR-03`, `TB-DUR-04`).
   - Idempotent retry and retry after durability recovery (`TB-IDEM-02`, `TB-DUR-05`).
   - Foreign-key enforcement after snapshot export, durable export, and recovery (`TB-SQLJS-01` to `TB-SQLJS-03`).
   - Storage preservation, subsequent writes, and safe refusal (`TB-SQLJS-04` to `TB-SQLJS-06`).
3. Native IPC decoding, boundary limits, and stored equality tests:
   - Unknown root and nested keys with sanitized outputs (`TB-IPC-01`, `TB-IPC-02`).
   - Missing fields, invalid types, malformed UUID v4, and hash format (`TB-IPC-03` to `TB-IPC-05`).
   - Stored equality checks across mutated guide titles, test titles, sourcePage, and sourceNotes (`TB-IPC-06` to `TB-IPC-09`).
   - Negative/non-integer correctIndex, out-of-range correctIndex, incoming aid title mismatch, whitespace-only empty string, exact boundary limits, and duplicate options (`TB-IPC-10` to `TB-IPC-15`).
4. Repository unit tests:
   - Missing atomic adapter refusal (`TB-REFUSE-01`).
   - Provenance round-trip and allowlist fallback (`TB-PROV-01`, `TB-PROV-02`).
5. Native backup and restore tests:
   - Archive creation and restore preserving `provider: "import"` (`TB-BACK-01`).
6. UI component tests (jsdom):
   - Post-save refresh failure handling matching `mutate`: returns save result, records `lastError`, shows warning, no DB rollback (`TB-REFRESH-01`).
   - Double-click prevention (`TB-UI-LOCK-01`).
   - Picker and preview cancellation zero writes (`TB-UI-CAN-01`, `TB-UI-CAN-02`).
   - Keyboard accessibility, focus trap, Escape cancellation, nested modal lifetime (`TB-UI-A11Y-01` to `TB-UI-A11Y-03`).
   - Wording, disclaimers, and regeneration warnings (`TB-UI-WARN-01`, `TB-UI-REGEN-01`).
7. Future installed tests:
   - WKWebView macOS 12.0–12.2 (`TB-INST-01`), VoiceOver (`TB-INST-02`), offline launch (`TB-INST-03`), installed backup (`TB-INST-04`).
8. Regression guard:
   - Ensure existing Gemini generation, PDF Open, split materials, and quick debrief tests continue passing with zero regressions.

---

## 3. Strict scope boundaries

- **NO database migrations:** Do not add files to `src-tauri/migrations/`. Schema remains at 10.
- **NO replacement flow:** Create-new only.
- **NO new dependencies:** Do not add `react-markdown` (deferred to Slice C) or any other npm package.
- **NO network calls:** Import must function 100% offline.
- **NO packaging or signing:** Do not trigger release workflows.

---

## 4. Verification commands and handoff

Use relevant focused tests while implementing. Map tests to the 69 accepted preparation rows: 65 source/development requirements and four installed observations kept unverified. Do not claim installed results from mocks, Node/jsdom, browser checks or CI. Keep existing meaningful cases; investigate failures locally and consolidate corrections rather than repeatedly launching a full matrix.

After focused checks pass:
1. Run local checks using the scoped toolchain:
   ```bash
   export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
   export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"

   # Focused checks first:
   npm test -- src/services/studyPackets.test.ts src/logic/studyPacket/
   cargo test --manifest-path src-tauri/Cargo.toml --locked study_packet::

   # Full sequential local gate once after corrections:
   npm ci
   npm run typecheck
   cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets
   cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
   cargo fmt --manifest-path src-tauri/Cargo.toml --check
   npm run test:cargo-lock
   npm test
   npm run build
   git diff --check
   ```
If the recorded toolchain/SDK paths are unavailable, inspect the configured local paths and existing setup; do not install or change global toolchains blindly. Keep environment overrides scoped to this task. Run gate checks sequentially and record direct exits/counts; a failure justifies a focused repair and relevant rerun, not parallel duplicate matrices.

2. Update `STATUS.md`, `docs/PROJECT_HANDOFF.md`, and `docs/MAC_PARITY_CHECKLIST.md`.
3. Generate evidence receipt in `docs/evidence/structured-study-import-slice-b-2026-10-04/` with exact SHA-256 hashes.
4. Leave changes uncommitted and unpushed for Codex review.

5. Write a single implementation report with requirement-to-test mapping, precise source/development results, remaining installed limits, changed-file inventory and full SHA-256 hashes. Keep evidence sanitized and distinguish reported from independently verified results.
6. Leave all implementation work uncommitted/unpushed for Codex independent review, then stop. No additional roadmap task, new dependency, signing setup or release work is included. The owner approved this scope; do not ask again for routine implementation decisions already covered by D1–D9. Provide complete bounded work so the reviewer can accept promptly when criteria and checks pass.
