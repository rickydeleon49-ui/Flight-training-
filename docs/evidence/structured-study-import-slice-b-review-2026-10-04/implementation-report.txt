# Structured study import Slice B: implementation report, 4 October 2026

Implemented by Claude (Opus 5.5) on the Mac for Codex review, under the [model-neutral assignment](../../STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) and the [owner approval](../../STRUCTURED_STUDY_IMPORT_SLICE_B_OWNER_APPROVAL_2026-10-04.md) (scope and D1–D9, including D3's older-version limitation). **Everything is uncommitted and unpushed.** Every result below was observed in this checkout by the implementer. None of it is independently verified yet.

## 1. Identity and starting state

| Item | Value |
| --- | --- |
| Checkout | `/Users/rickymac/code/Flight-training-pr70-integration` (git worktree) |
| Branch | `codex/structured-study-import-slice-b` |
| Base / HEAD | `6b418ee3c92f0ba64952d35278aa7c9999f9c824` (= `origin/main` when fetched at start) |
| Start state | Clean tracked and untracked tree on that branch. No intervening work found, so nothing needed preserving. |
| Prerequisites present | Slice A source (`src/logic/studyPacket/`, `pick_study_packet`); A2 atomic saves, connection owner and durable sql.js writes; the owner approval document on main |
| Other checkouts | Primary `/Users/rickymac/code/Flight-training-` (`claude/cool-carson-9wjrub` at `ea18a0e`, 7 dirty entries) was not touched. The earlier PR #70 integration work is on `claude/cool-carson-9wjrub-integration` (`1e052ed`). |
| Toolchain | Node v22.23.3, npm 10.9.9, rustc 1.99.0, cargo 1.99.0, `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` (paths as recorded; `gate/toolchain.txt`) |

## 2. What was built (five phases)

1. **Types and mappers.** `AiStudySet.provider` and `PracticeTest.provider` are now `StudyAidProvider = "gemini" | "import"`. The mappers read `provider` through an allowlist (`"import"` stays `"import"`, anything else becomes `"gemini"`).
2. **Native atomic save** (`src-tauri/src/study_packet.rs`), with the command registered in `lib.rs`:
   - `save_structured_study_material_atomically(app, operation: serde_json::Value)` runs on `spawn_blocking`.
   - **Pass 1, exact shape.** Every key at every level is required, and no other key is allowed.
   - **Pass 2, the normative §4.3 table.** In order: UUID v4 and id equality, then the hash, provider/model, `sourcePage`, line/block normalization with code-point limits, options and `correctIndex`, title equality, notes and substantive content.
   - **Allowlisted errors only.** Nine native codes with fixed messages. Key names, payload text, Serde messages and database errors are never echoed.
   - **Connection.** A dedicated rusqlite connection with `busy_timeout(5 s)`, `foreign_keys = ON` and `BEGIN IMMEDIATE`.
   - **Retries compare stored content.** Material title and type, presence of each aid, and every stored content field; the client hash is never trusted. A match returns `already_saved`; anything else returns `IDEMPOTENCY_CONFLICT`.
   - **Inserts.** Fixed material defaults, plus `provider = 'import'` and `model = ''` on both aids.
3. **Interfaces and adapters.**
   - **`db.ts`:** the contract types.
   - **`tauriDb.ts`:** `invokeStructuredImportSave` passes through only an exact allowlisted code and message pair. Anything else becomes `IPC_TRANSPORT_ERROR`, and the result shape and `materialId` are checked.
   - **`structuredImportTransaction.ts`:** the browser/test mirror of the native validator and transaction.
   - **`sqlJsDb.ts`:**
     - `initializeConnection` switches foreign keys on and then verifies them. It runs at open, after every export, and on the recovered handle before it replaces the live one.
     - `saveStructuredImportAtomically` runs on the A2 connection owner and durable-write path.
     - A failure after the commit restores the last stored bytes and throws `StorageDurabilityError`.
     - If recovery itself fails, the adapter is disabled with `DatabaseDisabledError`.
   - **`documentRepository.importStudyPacket`:** throws `AtomicPersistenceUnsupportedError` and never falls back to separate writes.
4. **UI.**
   - **Study Library:** an `Import study packet…` button opens `ImportStudyPacketDialog`.
   - **Dialog flow:**
     - It picks the file first; a cancelled picker opens nothing.
     - It validates with the accepted `validatePacketText` and shows fixed error messages and paths.
     - The preview shows the title, counts, the disclaimer, unverified source details, warnings and what is not saved. The `materialId` is minted once per preview.
     - "Import as new material" is protected by a synchronous ref lock. The dialog cannot be dismissed while saving.
     - On failure it shows a fixed message and "Try again", which resends the same identity.
     - A failed refresh records `lastError` and stays on the library.
   - **MaterialDetail:**
     - Imported content is titled "Imported study packet" with the imported-content disclaimer.
     - The Gemini empty-state invitations are hidden.
     - Regenerating warns before Gemini replaces imported content.
5. **Tests.** See §4 and §5.

**Defect found and fixed while integrating.** `saveAiStudySet` and `savePracticeTest` upsert with `ON CONFLICT … DO UPDATE` but never updated `provider`. Regenerating an imported guide or test with Gemini would therefore have kept `provider = 'import'` on Gemini content. Both now set `provider = excluded.provider` (always `'gemini'`). This is covered by a test and by mutation M4.

## 3. Deviations and decisions to review

| # | Where | What and why |
| --- | --- | --- |
| V1 | Native normalization | Line and block rules match the validator exactly, including JavaScript `\s` (NBSP and U+FEFF are whitespace; U+0085 is not). **NFC composition is not re-applied natively**: that needs a Unicode table crate, and the slice adds no dependencies. Payloads already arrive in NFC from the accepted validator, and both sides store and compare the same normalized strings. A crafted non-NFC payload is length-checked before composition rather than after. |
| V2 | Native command signature | `app: AppHandle` replaces the prompt's `State<'_, AppState>`. No `AppState` exists; A2's commands resolve the data folder with `app_root`, and this command does the same. |
| V3 | sql.js pre-operation snapshot | Uses A2's `lastStored` (every write is either stored or undone, so between operations the live database equals those bytes) rather than an extra `export()` per import. That avoids an export, and the re-initialization it would require, before `BEGIN`. The other three initializer points are implemented as specified. |
| V4 | Regeneration warning text | The prompt's sentence ("replace your imported study guide and practice test") is inaccurate for one button: each Regenerate replaces only its own aid. The texts are now "…your imported study guide and flashcards…" and "…your imported practice test…". |
| V5 | UUID case | Only lowercase UUID v4 is accepted on both sides, which is what `newId()` and `randomUUID()` produce. That makes id equality and stored-row comparison exact. |
| V6 | Present-but-empty study set | Rejected with `INVALID_ARGUMENT` when a substantive test is present (the payload builder never produces one). A present practice test with no questions is `INVALID_ARGUMENT`. Neither aid substantive gives `EMPTY_SUBSTANTIVE_CONTENT`. |
| V7 | Lock contention | A lock that outlasts `busy_timeout` returns `STORAGE_FAILURE`, an allowlisted code. The repository does not retry automatically: the dialog's "Try again" retries safely with the same identity. |
| V8 | `mutate` | Gained optional `{ refreshFailureMessage, onRefreshError }` so the dialog can show the import-specific refresh warning and avoid opening a material the screen cannot show yet. Existing callers are unchanged. |
| V9 | Browser picker | The native picker is desktop-only, unchanged from Slice A. In browser development mode the dialog reports that import works in the desktop app. Browser persistence is exercised through the sql.js tests. |
| V10 | Route | The app's material route is `/study/:id`, not the `/materials/:id` written in the preparation diagram. |

## 4. Requirement-to-test mapping (65 source/development rows)

**Native rows.** File: `src-tauri/src/study_packet_save_tests.rs`. Each test is named `tb_<row>_…` after its row.

| Rows | Test |
| --- | --- |
| TB-ATOM-01 | `tb_atom_01_commits_material_guide_and_test_together` |
| TB-ROLL-01, 02, 04 | `tb_roll_01_…`, `tb_roll_02_…`, `tb_roll_04_…` (an `ABORT` trigger on each table; the prior row and every column are unchanged) |
| TB-LOCK-01 | `tb_lock_01_…` (a held `BEGIN EXCLUSIVE`; waits at least 4 s and under 10 s, returns `STORAGE_FAILURE`, data intact, then succeeds after release) |
| TB-IDEM-01 | `tb_idem_01_…` (UUID `a1b2c3d4-…`; full snapshot, timestamps included, unchanged) |
| TB-CONF-01 to 06 | `tb_conf_01_…` to `tb_conf_06_…`, using the preparation's six UUIDs |
| TB-CONT-01 to 05 | `tb_cont_01_…` to `tb_cont_05_…` |
| TB-DEF-01 to 04 | `tb_def_01_…` to `tb_def_04_…` |
| TB-IPC-01 to 15 | `tb_ipc_01_…` to `tb_ipc_15_…`. Unknown keys are refused at the root and at six nested levels with sanitized output; 06–09 mutate stored rows; 14 uses ✈ and astral characters to count code points rather than bytes or UTF-16 units. |
| TB-BACK-01 | `tb_back_01_…` (real complete backup, inspect, stage and apply restore; `import` and `gemini` provenance both survive) |

**Browser, repository and UI rows:**

| Rows | Test | File |
| --- | --- | --- |
| TB-ATOM-02 | `TB-ATOM-02: commits all three rows together and stores them` | `src/data/structuredImport.test.ts` |
| TB-ROLL-03, 05, 06 | `%s: a failing %s statement rolls back…` (three cases) | `src/data/structuredImport.test.ts` |
| TB-DUR-01 and TB-SQLJS-04 | `refused storage restores the snapshot; prior rows and stored bytes are untouched` | `src/data/structuredImport.test.ts` |
| TB-DUR-02 | `an export failure after the commit restores the snapshot` | `src/data/structuredImport.test.ts` |
| TB-DUR-03 and TB-SQLJS-06 | `when recovery cannot re-establish foreign keys the adapter is disabled` | `src/data/structuredImport.test.ts` |
| TB-SQLJS-06 | `opening refuses a connection whose foreign keys cannot be verified` | `src/data/structuredImport.test.ts` |
| TB-DUR-04 | `an unrelated write requested mid-import waits until the import is stored` (order: commit, store, unrelated, store) | `src/data/structuredImport.test.ts` |
| TB-DUR-05 | `a retry after a recovered durability failure saves afresh` | `src/data/structuredImport.test.ts` |
| TB-IDEM-02 | `an identical retry is already_saved and changes nothing` (UUID `b2c3d4e5-…`) | `src/data/structuredImport.test.ts` |
| TB-SQLJS-01 | `export resets foreign keys and initializeConnection restores and verifies them` | `src/data/structuredImport.test.ts` |
| TB-SQLJS-02 | `after a committed import's durable export, orphans are refused and deletes cascade` | `src/data/structuredImport.test.ts` |
| TB-SQLJS-03 | `the handle restored after a durability failure enforces foreign keys` | `src/data/structuredImport.test.ts` |
| TB-SQLJS-05 | `ordinary writes and debrief saves work on the recovered handle` | `src/data/structuredImport.test.ts` |
| TB-REFUSE-01 | `refuses without an atomic driver and never falls back to separate writes` | `src/data/repositories/importStudyPacket.test.ts` |
| TB-PROV-01 | `an import reads back with provider 'import' and an empty model` | `src/data/repositories/importStudyPacket.test.ts` |
| TB-PROV-02 | `legacy, unknown or malformed provider values read as 'gemini'` | `src/data/repositories/importStudyPacket.test.ts` |
| TB-REFRESH-01 | `a failed refresh after a successful save keeps the save, records the warning and does not roll back` | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-LOCK-01 | `a rapid second click sends exactly one save` (both clicks in one `act`, so only the ref lock can stop the second) | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-CAN-01 | `cancelling the file picker opens nothing and writes nothing` | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-CAN-02 | `cancelling the preview closes it and writes nothing` | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-A11Y-01 | `focus starts inside, Tab stays inside, and the page behind is out of reach` (fallback modal) | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-A11Y-02 | Native: the `cancel` event and a backdrop click. Fallback: Escape, the backdrop and focus return. | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-A11Y-03 | `Escape closes a nested dialog first and leaves the import preview open` | `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` |
| TB-UI-WARN-01 | Two tests: labels, two disclaimers, no Gemini wording; invitation hidden with a file attached | `src/pages/StudyLibrary/MaterialDetailImport.test.ts` |
| TB-UI-REGEN-01 | `regenerating an imported guide or test warns that Gemini will replace it` (wording V4) | `src/pages/StudyLibrary/MaterialDetailImport.test.ts` |

**Installed rows, explicitly UNVERIFIED** and tracked as MAC-23 in `docs/MAC_PARITY_CHECKLIST.md`: TB-INST-01 (WKWebView on macOS 12.0–12.2 and current), TB-INST-02 (VoiceOver), TB-INST-03 (offline launch), TB-INST-04 (installed backup). The jsdom fallback-modal tests are source-level only and say so in their `describe` title.

**Additional coverage beyond the matrix:**

- **Shared native and browser contract.** `src-tauri/fixtures/import-contract/operation.json` is byte-for-byte what `validatePacketText` and then `buildImportOperation` produce for the accepted fixture `02-flashcards-and-test.json`, which the TypeScript test asserts. Its `contentHash` was recomputed independently in Python. Both implementations replay all 45 cases in `cases.json` and must reach the same outcome with no rows written on refusal.
- **Other native tests:** wire shapes for both results and the error, the full code list, a source check that the command takes `operation: Value` and is registered, a missing database returning `STORAGE_FAILURE` without creating a file, normalization parity, and conflicts on changed provider, model or material type.
- **Other frontend tests:** desktop adapter mapping (raw framework strings, Errors, mismatched messages, unknown codes, a result with the wrong id or status), the operation builder (a known SHA-256 vector, no extra keys, refusal without `crypto.subtle`), Gemini regeneration relabelling provenance, and an unexpected error never shown raw.

## 5. Results

**Focused checks while building**, all passing on their last run:
- Native: `cargo test --locked study_packet::` gives 60 passed (44 new and 16 Slice A).
- `src/data`: the existing 1,513 tests pass after the adapter changes.
- The new frontend files pass: 65, 15, 13 and 4 tests, plus 3 new service tests.

**Fail-before evidence.** Eleven targeted mutations each removed one fix. Each was caught by its test (8 TypeScript exit 1, 3 Rust exit 101), and every file was restored to its original hash. Details in `mutation-results.json`.

| ID | Mutation | Caught by |
| --- | --- | --- |
| M1 | export without `initializeConnection` | TB-SQLJS-02 |
| M2 | provider mapper ignores the stored value | TB-PROV-01 |
| M3 | dialog without the synchronous lock | TB-UI-LOCK-01 |
| M4 | Gemini upsert keeps the imported provider | the provenance test |
| M5 | raw refresh error shown | TB-REFRESH-01 |
| M6 | browser retry trusts stored rows | the conflict test |
| M7 | imported guide titled as Gemini | TB-UI-WARN-01 |
| M8 | adapter passes any rejection through | the adapter test |
| R1 | native retry trusts stored rows | TB-CONF |
| R2 | native accepts unknown keys | TB-IPC-01 |
| R3 | `busy_timeout` 0 | TB-LOCK-01 |

**Required sequential local gate** (`gate/summary.txt`, full logs in `gate/`; each step's output is `gate/<step>.txt`, renamed from the `.log` the run wrote because the repository ignores `*.log`):

| Step | Command | Result |
| --- | --- | --- |
| 01 | `npm test -- src/services/studyPackets.test.ts src/logic/studyPacket/` | exit 0; 7 files, 244 passed |
| 02 | `cargo test --locked study_packet::` | exit 0; 60 passed |
| 03 | `npm ci` | exit 0; 0 vulnerabilities |
| 04 | `npm run typecheck` | **exit 2 on the first run.** Two implicit-`any` parameters in `ImportStudyPacketDialog.test.ts` (test-only typing). The spy was typed. **Rerun: exit 0.** |
| 05 | `cargo test --locked --all-targets` | exit 0; 331 passed, 6 ignored (existing manual benchmarks and opt-in fixtures) |
| 06 | `cargo clippy --locked --all-targets -- -D warnings` | exit 0 |
| 07 | `cargo fmt --check` | exit 0 |
| 08 | `npm run test:cargo-lock` | exit 0 |
| 09 | `npm test` | exit 0; 81 files passed, 3 skipped; 2,448 passed, 4 skipped. The rerun after the typing fix gave the same result. |
| 10 | `npm run build` | **exit 2 on the first run** (its `tsc` step, the same two errors). **Rerun: exit 0.** |
| 11 | `git diff --check` | exit 0 (both runs) |

The affected steps (04, 09, 10, 11) were rerun sequentially once after the fix. No Rust file changed between the first run and the rerun, so steps 02 and 05–08 stand. One rerun attempt exited 127 without executing, because zsh does not word-split a command variable. It is recorded in `summary.txt` and was repeated through bash.

**Regression guard.** All existing Gemini generation, PDF open and split, split materials, quick debrief, A2 contract, backup and Study Library suites are inside the passing full runs above. Frontend: 2,448 passed = 2,348 at A2 acceptance + 100 new tests in this slice. That is consistent but was not re-measured on main here.

## 6. Scope confirmations

- No migration (schema stays at 10; `src-tauri/migrations/` untouched).
- No new dependency (`package.json`, `package-lock.json`, `Cargo.toml` and `Cargo.lock` unchanged).
- No replacement flow; create-new only.
- No Markdown.
- No network calls in import.
- No packet file retained.
- No version, packaging, signing, testing-account or release work.
- The real app was not launched; no owner data was accessed; Gemini was not called.

## 7. Remaining limitations

- The four installed rows (TB-INST-01–04) and MAC-23 are unverified. Nothing here is installed, VoiceOver or older-WebKit evidence.
- V1: native NFC is not re-applied.
- The browser development mode has no file picker (V9).
- The D3 tradeoff stands as approved. Older binaries that restore a Slice B backup display imported aids as Gemini, and downgrade restore behavior is unverified.

## 8. Files

`SHA256SUMS` in this folder lists the SHA-256 of every changed and new file, this README included; the manifest is the only file it omits. Modified tracked files (19), against base `6b418ee`:

- `STATUS.md`, `docs/PROJECT_HANDOFF.md`, `docs/MAC_PARITY_CHECKLIST.md`
- `src-tauri/src/lib.rs`, `src-tauri/src/study_packet.rs`
- `src/data/connectionOwner.ts`, `src/data/db.ts`, `src/data/repositories/documentRepository.ts`
- `src/data/sqlJsDb.ts`, `src/data/tauriDb.ts`, `src/data/testing/nodeSqliteDb.ts`
- `src/domain/types.ts`, `src/logic/studyPacket/types.ts`
- `src/pages/StudyLibrary/MaterialDetail.tsx`, `src/pages/StudyLibrary/StudyLibrary.tsx`, `src/pages/StudyLibrary/studyLibrary.css`
- `src/services/studyPackets.ts`, `src/services/studyPackets.test.ts`, `src/state/AppDataContext.tsx`

New files:

- `src-tauri/src/study_packet_save_tests.rs`
- `src-tauri/fixtures/import-contract/operation.json` and `cases.json`
- `src/data/persistenceErrors.ts`, `src/data/structuredImportTransaction.ts`, `src/data/structuredImport.test.ts`
- `src/data/repositories/importStudyPacket.test.ts`
- `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx` and `.test.ts`
- `src/pages/StudyLibrary/MaterialDetailImport.test.ts`
- this folder (README, `mutation-results.json`, `gate/`, `SHA256SUMS`)
