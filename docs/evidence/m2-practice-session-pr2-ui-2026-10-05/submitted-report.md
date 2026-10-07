# M2 Practice Sessions PR 2: Implementation Report, 5 October 2026

Implemented on the Mac for Codex review, under the [model-neutral assignment](../../M2_PRACTICE_SESSION_PR2_PROMPT_2026-10-05.md), the [canonical reviewed scope](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) (Appendices B–E), the [owner approval record](../../M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md), and building on the accepted [PR 1 foundation](../../M2_PRACTICE_SESSION_PR1_COMPLETION_REVIEW_2026-10-05.md).

**Status: Implemented, pending Codex review.**
All changes remain uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-ui`.

---

## 1. Identity and Starting State

| Item | Value |
| --- | --- |
| Checkout | `/Users/rickymac/code/Flight-training-pr70-integration` (git worktree) |
| Branch | `codex/m2-practice-session-ui` |
| Base / Main Commit | `61031d4c7143fdf181bba2cc18616c5345521c3e` (PR #101 merged) |
| Start state | Clean working tree; verified and synchronized with accepted main. |
| Toolchain | Node v22.23.3, npm 10.9.9, rustc 1.99.0, cargo 1.99.0, SDKROOT=`/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` |
| Shipped Migrations | Migrations 1–11 and `migration-checksums.json` are completely untouched and preserved. |

---

## 2. Requirements Implemented

### Section 1: Durable Single-Material Sessions
- **Persistent State Model:** Replaced volatile practice state with durable single-material sessions (`start_or_resume`, `record_response`, `complete_attempt`, `retake_attempt`, `abandon_attempt`) bound to `materialId` and `versionId`.
- **Navigation & Resumption:** Tests resume at the next unanswered ordinal across remounts and route changes. Questions can be skipped and revisited freely using labeled navigation pills (`Question selector`).
- **Accessible Selection:** Answer options render as accessible radio groups (`role="radiogroup"`, `role="radio"`, `aria-checked`, roving `tabIndex`, ArrowUp/Down/Left/Right, Home/End, Enter/Spacebar).
- **Immediate Feedback & Deliberate Edits:** Displays explanation and training tone immediately upon answering. Supports deliberate answer modification mode (`Change answer`) while the attempt remains in-progress.
- **"I Don't Know" Handling:** "I don't know" is tracked distinctly from unanswered and incorrect questions (`is_dont_know = 1`).
- **Early Completion & Honest Counts:** Supports early completion with clear disclosure of unanswered question counts.
- **Immutable Review Session:** Completed attempts present frozen questions, choices, explanations, answer states, and score, accompanied by the approved disclaimer:
  > *"Practice result from your material ({n}%). Not an official FAA knowledge test score or certification of flight readiness."*
- **Offline Reliability:** All saved tests and review sessions function fully offline without network credentials or provider calls.
- **Quarantined Legacy Tests:** Quarantined legacy rows (`legacyError === "MALFORMED_QUESTION"`) display the sanitized regeneration notice without offering a broken start button.

### Section 2: Resilient Pending Actions & Unknown Outcomes
- **UUIDv4 Identity:** Each intended mutation generates a unique UUIDv4 operation ID and typed action payload.
- **Sequential Transaction Chaining:** Chained asynchronously via `saveChainRef` and `persistedAttemptRef` to guarantee atomic serialization and correct revision increments across rapid user actions without dropped events.
- **Transient Failure Handling:** Captures mutation failures with `inFlight: false`, retains pending payload, displays error alert, and offers same-`operationId` retry (`Retry` button).
- **Stale State & Revision Conflict Handling:** On revision or expectation conflict (`REVISION_CONFLICT`, `OPERATION_CONFLICT`), refreshes authoritative repository state and requires deliberate user action rather than overwriting silently.
- **Unmount Protection:** Guards all asynchronous handlers with `isMountedRef` to prevent attempts to query closed database instances upon test completion or page navigation.

### Section 3: Reachable Completed History (Including Deleted Sources)
- **Dedicated History UI:** Created `PracticeHistory.tsx` with route-level integration in `App.tsx` (`/study/history`, `/study/history/:historyKey`, `/study/history/:historyKey/:attemptId`).
- **Study Library Entry:** Added navigation link in `StudyLibrary.tsx` to access practice test history anytime.
- **Material Detail Entry:** Added completed history link directly within `MaterialDetail.tsx`.
- **Detached History Groups:** History entries group by stable `history_key`, displaying retained material titles even after the source material has been deleted.
- **Frozen Version Binding:** Reviewing an attempt displays the exact question and choice snapshot frozen at the attempt's version.

### Section 4: Atomic Explicit History Erasure (Policy A & Appendix E)
- **Scope & Boundaries:** Erases all saved attempts and responses under a selected `history_key` (including in-progress attempts) and prunes unused inactive versions.
- **Preserved Artifacts:** Preserves current active material, test, PDFs, and exported backups.
- **Receipt Tombstones:** Transforms associated receipts into non-content tombstones (`is_erased = 1, result_json = 'null'`), preventing late replays of erased operations.
- **Erasure Receipt:** Writes a non-content `erase_history` receipt containing operation metadata without user content.
- **Truthful Confirmation Modal:** Confirmation modal explicitly discloses that saved history and progress are removed while current tests and backups remain intact.

---

## 3. Requirement-to-Test Mapping

| PR 2 Requirement | Native Rust Test (`src-tauri`) | Frontend Test (`vitest`) | Status |
| --- | --- | --- | --- |
| **Start / Resume at next unanswered ordinal** | `req_01_resumable_session_across_restart` | `PracticeSessionPR2.test.ts: resumes in-progress attempt at nextUnansweredOrdinal across remount` | Passed |
| **"I don't know" distinct from incorrect & unanswered** | `shared_validation_contract_native_outcomes` | `PracticeSessionPR2.test.ts: handles 'I don’t know' distinctly from incorrect and unanswered` | Passed |
| **Deliberate answer edits while in-progress** | `req_02_idempotent_response_replay` | `PracticeSessionPR2.test.ts: allows deliberate answer changes while attempt remains in-progress` | Passed |
| **Skipping and navigation pills** | `req_06_unanswered_skipped_items_persist_as_null` | `PracticeSessionPR2.test.ts: supports skipping and navigation pills across questions` | Passed |
| **Retake attempt (abandons previous, starts fresh)** | `req_07_retake_abandons_and_creates_fresh_attempt` | `PracticeSessionPR2.test.ts: handles retake by abandoning previous attempt and starting fresh` | Passed |
| **In-progress abandon with confirmation** | `req_08_abandon_attempt_terminal_lifecycle` | `PracticeSessionPR2.test.ts: handles in-progress abandon with truthful confirmation` | Passed |
| **Quarantined legacy notice (no broken start button)** | `req_14_malformed_legacy_handling` | `PracticeSessionPR2.test.ts: renders quarantined legacy notice on malformed test without start button` | Passed |
| **Completed history reachable after source deletion** | `req_12_policy_a_deletion_lifecycle` | `PracticeSessionPR2.test.ts: keeps completed history reachable after source material deletion` | Passed |
| **Atomic history erasure with confirmation modal** | `req_erase_history_atomic_pruning_and_tombstones` | `PracticeSessionPR2.test.ts: erases practice history atomically with truthful confirmation modal` | Passed |
| **History erasure refuses late replay of old actions** | `req_erase_history_restart_refusal_and_backup_validation` | `PracticeSessionPR2.test.ts: erases practice history atomically...` | Passed |
| **Unrelated history isolation during erasure** | `req_erase_history_unrelated_isolation_and_safe_new_practice` | `PracticeSessionPR2.test.ts: erases practice history atomically...` | Passed |
| **Erasure validation checks & strict payloads** | `req_erase_history_validation_checks` | `practiceSessionContract.test.ts: erase_history validation` | Passed |
| **Transient mutation error with same-operationId retry** | `req_05_transient_failure_replay_safety` | `PracticeSessionPR2.test.ts: handles transient mutation error with same-operationId retry` | Passed |
| **Keyboard accessibility & roving focus** | — | `PracticeTestPanel.test.ts: supports keyboard navigation between options` | Passed |
| **Offline functionality & generation isolation** | `tb_cont_02_test_only` | `MaterialDetailOffline.test.ts` (11 tests) | Passed |
| **Shared contract validation (43 cases)** | `shared_validation_contract_native_outcomes` | `practiceSessionContract.test.ts` (25 tests) | Passed |

---

## 4. Source Files Modified & Created

```
724c4eab64829dffa530fd7868597bbcb69ea72e1ad5be1a181773d174110fc0  STATUS.md
a2882803a032725764688a36a4c5b95fb254ac1e55fd01fd81525463d598d110  docs/PROJECT_HANDOFF.md
ccc86cc9c771bae724dfe5e621ffe4783fd8afe51e9b189e71ce4326875cfb25  src-tauri/fixtures/practice-validation/cases.json
5d6a2e594fba3e3b60f2b0addc3af5b791dad9b673a501ab149c319122199a5e  src-tauri/src/backup.rs
f9404a0a905745610e4ffad00d2dada3f727c39892b204f35a10c04fec7afbe2  src-tauri/src/lib.rs
d3b2d2c755c6f84cd68848d950d645bc4e08d1d6c085c0dd0928e3afd96729db  src-tauri/src/practice_session_tests.rs
0b2e56c1150ffeaa8d74f23f62b4a25df1af3db2e0a998b2f403897f4215ffa2  src-tauri/src/practice_sessions.rs
545494eff031e0ffe9f3bd49c992b9bed8e23f747911c47c8846fb3ec3eff638  src/App.tsx
c9b715e5fcafbea8f3400964a07a1bccfa6ed8fc705b03067cf18febec44415c  src/data/db.ts
0418491f8f6ec49966b8f483bf57f82f9e5e4dfec9dbd805854b021496e339c1  src/data/practiceSessionContract.test.ts
4681e45bcd2e8de0c2697303385a11b8c01ba37ad48205fd1f91a44d1929da06  src/data/practiceSessionTransaction.ts
8ed4966c9c826099cca45ebbdcc0c954466cc8e08549b062854f1e4d37f52d01  src/data/practiceStateValidation.ts
a03ff3162d036fa29b7a3a9623a54c3a764a7f729719b23f3bc75d43c68f6b26  src/data/repositories/practiceSessionRepository.ts
46d8fc03c9631c8313c17cf1949318ddf2157d45cda740acc5469ca8b861c0ca  src/data/sqlJsDb.ts
7c7304ac1700117f33d1de14620be6cd5291a6a7d4451dfdde0f5b610f028da2  src/data/tauriDb.ts
abe33e63043f15bf0a0a4dd3d8a2cb667491e2c73222b583df55c7d2157a25cc  src/data/testing/nodeSqliteDb.ts
a6a930a9f9fc2096ec77b83dc58e103217cfa8745f3a0f5c8132358155cfe5da  src/domain/types.ts
2fd59cfcad46c852f36bff3a7e4ded776200ddc595438e84a964d672c9eaa608  src/pages/StudyLibrary/MaterialDetail.tsx
b930977c2ee3f09eab3878580d414e82e79fb526c63731e0e8480fc213f34003  src/pages/StudyLibrary/PracticeHistory.tsx
03838a9cce58e73d11511118d2d7e3bbfde5405b18fc4a749d7b92165762c503  src/pages/StudyLibrary/PracticeSessionPR2.test.ts
f1ad9dc1f2930509939742376935531bdd42850f852738c0192bc1bd2b176f4d  src/pages/StudyLibrary/PracticeTestPanel.tsx
10213a3ac0daf073ff9dddd5622d9ee9b4fcedecb5f959b227e0cd106e7211b2  src/pages/StudyLibrary/StudyLibrary.tsx
56aa78967e9540443ccdbe34d8918f6de95beb6f412e3150c3e0f0071eab6571  src/pages/StudyLibrary/studyLibrary.css
```

---

## 5. Sequential Integration Gates

All eight sequential verification gates passed cleanly:

1. **Gate 1 (`npm run typecheck`)**: Exit 0. Clean compilation without TypeScript errors.
   - Log: `gate/01-typecheck.txt`
2. **Gate 2 (`npm test`)**: Exit 0. 84 passed files, 3 skipped benchmarks (87 test files total), 2,511 passing tests, 0 failures.
   - Log: `gate/02-npm-test.txt`
3. **Gate 3 (`npm run build`)**: Exit 0. Vite client bundle built in 818ms.
   - Log: `gate/03-build.txt`
4. **Gate 4 (`cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets`)**: Exit 0. 390 passed unit tests, 0 failed, 6 ignored.
   - Log: `gate/04-cargo-test.txt`
5. **Gate 5 (`cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`)**: Exit 0. Zero clippy warnings.
   - Log: `gate/05-clippy.txt`
6. **Gate 6 (`cargo fmt --manifest-path src-tauri/Cargo.toml --check`)**: Exit 0. Formatted per standard.
   - Log: `gate/06-fmt.txt`
7. **Gate 7 (`npm run test:cargo-lock`)**: Exit 0. Cargo.toml and Cargo.lock versions synchronized at 0.5.3.
   - Log: `gate/07-cargo-lock.txt`
8. **Gate 8 (`git diff --check`)**: Exit 0. Clean diff without whitespace or formatting errors.
   - Log: `gate/08-git-diff.txt`

---

## 6. Verification Boundaries

- No app launch against user profile data occurred.
- No network requests were made to Gemini or external APIs during tests.
- No packaging, code signing, notarization, or release artifacts were generated.
- Changes remain completely uncommitted and unpushed in the integration checkout for independent review.
