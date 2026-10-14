# M2 Saved Content Provenance Implementation Report

**Date:** 13 October 2026
**Milestone Increment:** M2 — Study Library Sessions (ROADMAP.md §7.C) (Active / In-Progress; milestone M2 is not integrated or merged)
**Task:** Expose persisted provenance already stored for saved study guides/flashcards and practice tests in Material Detail
**Implementer:** Antigravity (model-neutral implementation assignment)
**Starting Checkout Baseline:** `017c1c6cfd2ae6574136750e47bfa709264ac17f`
**Current Branch:** `agents/task-20261013-163348-447277`
**Isolated Parent Repository:** `8a260c0b32bc213850ed85bf9488d6ef571354a9` (`isolated-repo [main]`)

---

## 1. Executive Summary & ROADMAP §7.C Alignment

This increment implements ONE display-only increment fulfilling **ROADMAP.md §7.C (Study workspace)**:
> *"Material detail keeps guide, flashcards, practice test, source file and provenance together. ... Show source material, generated date, model, page reference when known, and a flag/report action for questionable generated content. Refer to these as practice results on user material, not an official FAA exam score."*

### Key Implementation Deliverables:
1. **Provenance Display in Material Detail:** Exposes the source material, origin, stored model (when applicable), and locally formatted creation date for saved study aids (guide and flashcards) and saved practice tests.
2. **Strict Metadata Isolation:** Ensured saved guide/flashcard sections and saved practice-test sections each read and display only their own persisted provenance. Neither section borrows metadata from the other or from the user's currently configured Gemini model in Settings.
3. **Provider Semantics:**
   - **Gemini Content:** Displays `Origin: Gemini`, the persisted model name (or `"Model unavailable"` if empty/whitespace), and `Generated <formattedDate>`.
   - **Imported Content:** Displays `Origin: Imported study packet`, no model field (strictly avoiding suggesting an external model, original generation date, or instructor verification), and `Imported <formattedDate>`.
4. **Resilient Date Formatting:** Reuses existing `localDayOf()` and `formatLongDate()` date helpers from `src/lib/dates.ts` without modifying shared helper code or existing PR152 test suites. Correctly resolves ISO 8601 timestamps, SQLite UTC timestamp strings, and UTC/local-day boundaries across timezones.
5. **Deterministic Regressions via Clock Freezing & Proper TZ Restoration:** Freezes system clock (`2026-10-13T12:00:00Z`) across both unit and rendered integration suites using Vitest fake timers (`toFake: ["Date"]`) so date comparisons in `formatLongDate` remain deterministic regardless of execution year. `MaterialDetailProvenance.test.ts` saves `originalTZ = process.env.TZ` in `beforeEach` and restores it completely in `afterEach` (`if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;`) to preserve full isolation from other test suites.
6. **Fail-Closed Unavailable Text:** Explicitly renders `"Model unavailable"`, `"Generated date unavailable"`, `"Imported date unavailable"`, or `"Source material unavailable"` instead of invented facts, `NaN`, or `Invalid Date`.
7. **Zero Persistence Changes:** Read-only UI increment. Reuses existing `AiStudySet` and `PracticeTest` fields. Introduces no database schema migrations, no new dependencies, no network requests, and no global data loads.
8. **Attempt History Preserved:** The practice test summary is specifically labeled as provenance of the saved test (`"Saved practice test provenance"`) without implying it describes a resumed historical attempt.

---

## 2. Baseline, Scope Integrity & Remote GitHub Verification Status

### Baseline Identity & Remote GitHub Status
- **Accepted Starting Baseline:** Commit `017c1c6cfd2ae6574136750e47bfa709264ac17f` on branch `agents/task-20261013-163348-447277`.
- **Coordinator Live Remote Baseline Verification:** Live GitHub check from the coordinator environment confirmed `origin/main` is `017c1c6cfd2ae6574136750e47bfa709264ac17f`, matching the accepted starting baseline commit exactly. No subsequent changes or active assignments overlap with this increment. Within the local terminal sandbox, upstream network access remains unexecuted per sandboxing policy. Baseline integrity is grounded in the coordinator authenticated check, the accepted HEAD `017c1c6cfd2ae6574136750e47bfa709264ac17f`, the pre-approved read-only `git worktree list`, and recorded repository handoffs.
- **Git Worktree Verification:** Pre-approved read-only `git worktree list` verified the isolated layout:
  - `/Users/rickymac/.../isolated-repo 8a260c0 [main]`
  - `/Users/rickymac/.../worktree 017c1c6 [agents/task-20261013-163348-447277]`
- **Preservation of Excluded Work & In-Flight Artifacts:**
  - `source-map-js` remediation (M0 dependency maintenance) strictly preserved
  - `schema14` preparation (`runs/20261012-202254-779884`) strictly preserved
  - `MAINT-143-KEYS` metadata key fix (`runs/20261012-223624-013056`) strictly preserved
  - `timezone PR152` tests (`src/lib/dates.test.ts`, `src/pages/StudyLibrary/PracticeHistoryDates.test.ts`) preserved untouched
  - `REL-03` docs (`runs/20261013-142913-309257`) strictly preserved
  - All M4 work and proposed M4 migrations/items (OD-1–OD-10) remain strictly excluded, untouched, and separately owned.

---

## 3. Inventory of Changed Files

Only the seven authorized paths were edited or created:

| File Path | Status | Purpose |
|---|---|---|
| `src/logic/studyContentProvenance.ts` | **New** | Pure helper module for extracting, resolving, and formatting study content provenance. |
| `src/logic/studyContentProvenance.test.ts` | **New** | Pure helper unit tests with clock freezing, covering Gemini, import, unavailable values, SQLite format, and timezone boundaries. |
| `src/pages/StudyLibrary/StudyContentProvenance.tsx` | **New** | Reusable React component presenting structured provenance metadata in Material Detail cards. |
| `src/pages/StudyLibrary/studyLibrary.css` | **Modified** | Added `.study-provenance` CSS styles matching the Soft Cockpit design philosophy. Trailing blank line at EOF removed; verified 0 trailing whitespace. |
| `src/pages/StudyLibrary/MaterialDetail.tsx` | **Modified** | Added `StudyContentProvenance` component into both the study guide/flashcards card and practice test card. |
| `src/pages/StudyLibrary/MaterialDetailProvenance.test.ts` | **New** | Rendered integration tests exercising MaterialDetail with synthetic disposable records in SQLite, covering distinct guide/test provenance, imports, unavailable metadata, pending/disconnected (configured: false)/failed Gemini, navigation/replacement, TZ cleanup restoration, and omission failure demonstration. |
| `docs/M2_SAVED_CONTENT_PROVENANCE_REPORT_2026-10-13.md` | **New** | This verification report mapping the increment to ROADMAP §7.C and recording gate receipts. |

No other files in the workspace were modified.

---

## 4. Acceptance Criteria & Verification Status

### Criterion 1: Distinct Guide & Test Provenance
- Authored and verified in `src/pages/StudyLibrary/MaterialDetailProvenance.test.ts`:
  - Study aid configured with model `gemini-1.5-flash-guide-model` and timestamp `2026-10-01T12:00:00Z`.
  - Practice test configured with model `gemini-1.5-pro-test-model` and timestamp `2026-10-02T16:00:00Z`.
  - Configured Settings Gemini model set to `gemini-3.5-flash-configured-in-settings`.
  - Assertions confirm each section displays only its own model and formatted date, and neither section borrows from the other or from settings.

### Criterion 2: Gemini vs. Import Semantics & Unavailable Values
- Gemini content displays `Origin: Gemini`, model name, and `Generated <date>`.
- Imported content displays `Origin: Imported study packet`, no model label or value, and `Imported <date>`.
- No instructor verification or external model claims are made for imported packets.
- Empty or whitespace model strings evaluate to `"Model unavailable"` across both study aids and practice tests.
- Malformed timestamps evaluate to `"Generated date unavailable"` or `"Imported date unavailable"` without producing `Invalid Date` or `NaN` across both study aids and practice tests.
- Missing or whitespace source material titles evaluate to `"Source material unavailable"`.

### Criterion 3: Reusing Existing Date Helpers, Clock Freezing & TZ Isolation
- Imported and reused `localDayOf()` and `formatLongDate()` from `src/lib/dates.ts`.
- Zero edits to `src/lib/dates.ts`, `src/lib/dates.test.ts`, or `src/pages/StudyLibrary/PracticeHistoryDates.test.ts`.
- Frozen system clock to `2026-10-13T12:00:00Z` using Vitest `vi.useFakeTimers({ toFake: ["Date"] })` in `studyContentProvenance.test.ts` and `MaterialDetailProvenance.test.ts`.
- Added unit tests in `src/logic/studyContentProvenance.test.ts` with explicit timezone control (`withTimezone` helper preserving and restoring `process.env.TZ`), exercising:
  - ISO 8601 with UTC `Z` and offset.
  - SQLite UTC space-separated timestamps (`YYYY-MM-DD HH:MM:SS`).
  - UTC/local-day date boundaries:
    - `2026-10-03T02:00:00.000Z` evaluates to Oct 3 in UTC, and shifts to Oct 2 in `America/Los_Angeles` (PDT, UTC-7).
    - `2026-10-03T23:30:00.000Z` evaluates to Oct 3 in UTC, and shifts to Oct 4 in `Pacific/Kiritimati` (UTC+14).
- In `src/pages/StudyLibrary/MaterialDetailProvenance.test.ts`, `originalTZ = process.env.TZ` is saved in `beforeEach` and restored in `afterEach` (`if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;`) to preserve test isolation.

### Criterion 4: Offline Resilience, Pending/Disconnected/Failed Gemini, & Missing File Handling
- In `MaterialDetailProvenance.test.ts`:
  - When Gemini status is pending (`getGeminiStatus` returns pending Promise), provenance displays cleanly.
  - When Gemini status is explicitly disconnected (`getGeminiStatus` resolves with `{ configured: false, model: "gemini-disconnected-default" }`), provenance displays cleanly and retains stored model without borrowing the disconnected setting or attempting configuration.
  - When Gemini status is failed (`getGeminiStatus` rejects with an error), provenance displays cleanly.
  - When the source file is missing from disk (`documentExists` returns false), provenance remains readable.
  - Network requests are blocked and proven uncalled (`fetch` spy confirms zero calls).
  - Existing safety disclaimers and saved-content usability remain intact.

### Criterion 5: Replacement, Navigation & Practice Summary Label
- In `MaterialDetailProvenance.test.ts`:
  - When navigating between materials (`/study/mat-nav-1` to `/study/mat-nav-2`), both guide and practice test provenance metadata refresh to the newly selected material, and previous material metadata is removed.
  - **Repository-Driven Replacement Regressions:** Rather than updating table rows directly via raw SQL queries, replacement of saved content is executed directly through repository operations:
    - Saved study guide replacement is executed via `context.mutate((r) => r.documents.saveAiStudySet(...))`.
    - Saved practice test replacement is executed via `context.mutate((r) => r.documents.savePracticeTest(...))`.
    - Initial content seeding also uses repository methods (`repos.documents.saveAiStudySet` and `repos.documents.savePracticeTest`) with fake system clock timestamps.
  - **Refreshed Provenance Verification:**
    - Guide provenance immediately refreshes to the new model (`gemini-replaced-v2-guide`) and locally formatted creation date (`Generated Sunday, October 4`).
    - Practice test provenance immediately refreshes to the new model (`gemini-replaced-v2-test`) and locally formatted creation date (`Generated Monday, October 5`).
  - **Attempt-Version & History Preservation:**
    - Prior to replacement, a practice session attempt is started and completed on `mat2`'s version 1 practice test via `repos.practiceSessions.saveSessionAction(...)`.
    - Following replacement of the practice test via `r.documents.savePracticeTest(...)`, the active version is bumped to version 2 (`activeVer.version.versionNumber === 2`) with the new model.
    - The completed attempt from version 1 is safely preserved in history: `repos.practiceSessions.getCompletedHistory(mat2.id)` contains 1 item with `versionNumber === 1`.
    - In `MaterialDetail`, `View practice history (1)` remains visible and accessible.
    - The practice test provenance card is specifically labelled with `aria-label="Saved practice test provenance"` and heading `"Saved practice test provenance"`, explicitly presenting provenance of the saved test (version 2) rather than describing an earlier-version completed attempt.

#### Criterion 6: Regression & Omission Sensitivity Execution Status
- Pure-helper suite (`src/logic/studyContentProvenance.test.ts`, 12 test cases) and rendered integration suite (`src/pages/StudyLibrary/MaterialDetailProvenance.test.ts`, 6 test cases, including omission sensitivity verification) have been authored, code-reviewed, and executed with exit 0 (18 passed, 0 failed).
- **Reviewed Assertion Coverage:** Synthetic helper and MaterialDetail integration assertions cover metadata isolation, imports, unavailable values, offline access, navigation/replacement, and omission sensitivity.
- **Omission Diagnostic Correction:** Finalized `MaterialDetailProvenance.test.ts` omission assertions to use pure absence semantics (`expect(screen.queryByLabelText(...)).toBeNull()`), eliminating all `.toThrow()` invocations and Testing Library diagnostic error prose dependencies.
- **Node 26 LocalStorage Resilience:** Added defensive guard around `localStorage?.clear?.()` in `MaterialDetailProvenance.test.ts` to ensure full compatibility with Node 26 runtime environments where `globalThis.localStorage` is undefined unless `--localstorage-file` is configured.
- **Receipt Reconciliation & Execution Status:**
  - **Typecheck Verified:** `npm run typecheck` passed with **exit 0** (zero TypeScript diagnostics).
  - **Five Focused Suites Verified:** 5 test files, 43 passed, 0 failed across controller and sandbox environments.
  - **Build Verified:** `npm run build` passed with **exit 0** (`dist/` generated successfully; 1.40s controller, 1.14s sandbox).
  - **Rust Toolchain Checks Verified:** `cargo fmt --check` (exit 0), `cargo clippy` (exit 0), `cargo test` (exit 0, 465 passed, 6 ignored), and `npm run test:cargo-lock` (exit 0).
  - **Whitespace Audit Verified:** `git diff --check` passed with **exit 0** (0 trailing whitespace, 0 trailing blank lines at EOF).
  - **Full Vitest Suite Reconciled:** Preserved historical controller full-suite failure receipts: (1) reviewer-recorded check exit 1 with 3,055 passed, 1 failed (`CardReviewPanel.test.ts:590` expected the "Recent reviews" heading to be absent), 6 skipped; (2) earlier concurrency timeout invocation exit 1 with 3,054 passed, 2 timed out (`skillEvidenceValidationParity.test.ts` and `studyLibraryScenarios.test.ts`), 6 skipped. Neither failure represented a provenance defect; focused rerun of `CardReviewPanel.test.ts` passed 29/29. The subsequent controller full-suite verification run passed completely with exit 0 (129 test files passed, 4 skipped; 3,056 passed, 6 skipped, 0 failed).

---

## 5. Local Verification Matrix, Command Reconciliation & Receipts

### Execution Environments & Detailed Receipts

#### 1. Controller Supported Runtime Environment (Passing Matrix Baseline)
- **Node / Toolchain:** Node v22.23.3 runtime (`/opt/homebrew/opt/node@22/bin/node`, npm v10.9.9 via `/opt/homebrew/opt/node@22/bin/npm`), npm (clean committed lock via controller `npm ci`), Cargo 1.99.0 (5f94df478 2026-08-27), git version 2.56.0.
- **Five Focused Vitest Suites Command (Supplied Focused Command):**
  ```bash
  node node_modules/vitest/vitest.mjs run \
    src/logic/studyContentProvenance.test.ts \
    src/pages/StudyLibrary/MaterialDetailProvenance.test.ts \
    src/pages/StudyLibrary/MaterialDetailOffline.test.ts \
    src/pages/StudyLibrary/MaterialDetailGemini.test.ts \
    src/pages/StudyLibrary/MaterialDetailImport.test.ts \
    --configLoader runner --no-cache
  ```
  *(Executed in controller environment with `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` via Node v22.23.3)*
  *Result:* **PASS (exit 0)** — 5 test files, **43 passed**, 0 failed:
  1. `src/logic/studyContentProvenance.test.ts` (12 passed)
  2. `src/pages/StudyLibrary/MaterialDetailProvenance.test.ts` (6 passed)
  3. `src/pages/StudyLibrary/MaterialDetailImport.test.ts` (4 passed)
  4. `src/pages/StudyLibrary/MaterialDetailGemini.test.ts` (10 passed)
  5. `src/pages/StudyLibrary/MaterialDetailOffline.test.ts` (11 passed)
- **Full Vitest Suite Invocations (Historical Failures & Reconciled Passing Verification):**
  - **Reviewer-Recorded Controller Full-Suite Invocation (Exit 1 - Retained History):**
    ```bash
    npm test -- --configLoader runner --no-cache
    ```
    *Result:* **FAIL (exit 1)** — 133 test files executed; **3,055 passed**, **1 failed**, **6 skipped**.
    *Failure Details:* `CardReviewPanel.test.ts:590` failed expecting the "Recent reviews" heading to be absent (`expect(screen.queryByRole("heading", { name: "Recent reviews" })).toBeNull()`). Investigation confirmed this was an intermittent asynchronous event-drain timing artifact under heavy full-suite concurrency in unisolated test runs, and not a provenance code defect. Focused execution of `CardReviewPanel.test.ts` (`NODE_OPTIONS="--localstorage-file=/tmp/ls" node node_modules/vitest/vitest.mjs run src/pages/StudyLibrary/CardReviewPanel.test.ts --configLoader runner --no-cache`) passed all 29 tests cleanly with exit 0.
  - **Earlier Controller Concurrency Timeout Invocation (Exit 1 - Retained History):**
    ```bash
    npm test -- --configLoader runner --no-cache
    ```
    *Result:* **FAIL (exit 1)** — 133 test files executed; 127 passed, 2 timed out, 4 skipped; **3,054 passed**, **2 timed out**, **6 skipped**.
    *Failure Details:* Timeouts occurred in `src/pages/FlightPath/skillEvidenceValidationParity.test.ts` and `src/pages/StudyLibrary/studyLibraryScenarios.test.ts` during heavy concurrent execution. Neither failure was established as a baseline failure or code defect.
  - **Subsequent Final Controller Full-Suite Invocation (Exit 0 - Verified Passing Run):**
    ```bash
    npm test -- --configLoader runner --no-cache
    ```
    *Result:* **PASS (exit 0)** — 133 test files executed; 129 passed, 4 skipped (133 total); **3,056 passed**, 0 failed, **6 skipped**. All suites including `CardReviewPanel.test.ts` passed cleanly on the controller rerun without errors, establishing full-suite health.
- **Frontend Typecheck Command:** `npm run typecheck` (`tsc --noEmit`) — **PASS (exit 0)** (zero diagnostics).
- **Frontend Build Command:** `npm run build` (`tsc --noEmit && vite build`) — **PASS (exit 0)** in 1.40s (`dist/` generated).
- **Rust Toolchain Commands & Timings:**
  - Format Check: `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — **PASS (exit 0)**, 0 diffs.
  - Clippy Linter: `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — **PASS (exit 0)**, 0 warnings.
  - Native Tests: `cargo test --locked --manifest-path src-tauri/Cargo.toml` — **PASS (exit 0)** (465 passed, 0 failed, 6 ignored).
  - Lock Sync: `npm run test:cargo-lock` — **PASS (exit 0)** (`her-flight-deck` is 0.5.3 in both `Cargo.toml` and `Cargo.lock`).
- **Git Diff & Whitespace Command:** `git diff --check` — **PASS (exit 0)** (0 trailing whitespace, 0 trailing blank lines at EOF).

#### 2. Local Terminal Sandbox Environment (Node v26.10.0 / npm 12.2.0)
- **Environment:** Node `v26.10.0`, npm `12.2.0`, Cargo `1.99.0 (5f94df478 2026-08-27)`.
- **Command Reconciliation & Runner Flags:**
  - Vitest executed with `--configLoader runner --no-cache` to load Vite configuration directly in-memory without generating temporary configuration files.
  - `NODE_OPTIONS="--localstorage-file=/tmp/ls"` supplied for suites relying on global `localStorage` in Node 26.
- **Passing Checks & Timings:**
  - Five Focused Suites: `NODE_OPTIONS="--localstorage-file=/tmp/ls" node node_modules/vitest/vitest.mjs run src/logic/studyContentProvenance.test.ts src/pages/StudyLibrary/MaterialDetailProvenance.test.ts src/pages/StudyLibrary/MaterialDetailImport.test.ts src/pages/StudyLibrary/MaterialDetailGemini.test.ts src/pages/StudyLibrary/MaterialDetailOffline.test.ts --configLoader runner --no-cache` — **PASS (exit 0)** (5 test files, 43 passed, 0 failed).
  - Scoped New M2 Suites: `node node_modules/vitest/vitest.mjs run src/logic/studyContentProvenance.test.ts src/pages/StudyLibrary/MaterialDetailProvenance.test.ts --configLoader runner --no-cache` — **PASS (exit 0)** (2 test files, 18 passed: 12 pure helper + 6 integration, 0 failed, duration 1.33s).
  - Frontend Typecheck: `npm run typecheck` — **PASS (exit 0)**.
  - Frontend Build: `npm run build` — **PASS (exit 0)** in 1.14s (`dist/` generated).
  - Rust Format Check: `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — **PASS (exit 0)**.
  - Rust Clippy Linter: `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — **PASS (exit 0)** in 0.52s.
  - Rust Native Tests: `cargo test --locked --manifest-path src-tauri/Cargo.toml` — **PASS (exit 0)** in 49.06s (465 passed, 0 failed, 6 ignored).
  - Cargo Lock Sync: `npm run test:cargo-lock` — **PASS (exit 0)**.
  - Worktree List: `git worktree list` (pre-approved) — **PASS (exit 0)** (`isolated-repo 8a260c0 [main]` and `worktree 017c1c6 [agents/task-20261013-163348-447277]`).
  - Git Diff Check: `git diff --check` — **PASS (exit 0)**.
- **Retained Historical Baseline Failure Record (Node 26 Engine Specifics):**
  - Full suite run in Node 26 executed 133 files: 125 test suites passed (3,043 tests passed, 6 skipped).
  - 4 test files exhibited pre-existing baseline failures due to Node 26 runtime changes:
    1. `cardValidationParity.test.ts` (`sqlite_master may not be modified` due to Node 26 internal `node:sqlite` engine changes).
    2. `splitLineageValidationParity.test.ts` (`sqlite_master may not be modified`).
    3. `useMaterialNotes.test.ts` (draft recovery storage assertion under Node 26 localStorage).
    4. `quickDebrief.test.ts` (draft recovery storage assertion under Node 26 localStorage).
  - All M2 saved content provenance suites pass 100% across both controller and Node 26 environments.

#### 3. Historical Environmental Failures & Denials (Preserved as History)
- **Historical Full-Suite Controller Failures & Final Reconciliation (Preserved as History):**
  - **Reviewer-Supplied Check Failure:** An initial controller full-suite check exited 1 with `3,055 passed, 1 failed, 6 skipped`, failing at `CardReviewPanel.test.ts:590` (expected the "Recent reviews" heading to be absent). As verified by focused rerun (29/29 tests passed) and the subsequent full-suite pass, this was an intermittent async event-flush artifact under full-suite concurrency rather than any provenance defect.
  - **Earlier Concurrency Timeouts:** An earlier controller full-suite invocation (`npm test -- --configLoader runner --no-cache`) exited 1 with test execution timeouts in `skillEvidenceValidationParity.test.ts` and `studyLibraryScenarios.test.ts` (3,054 passed, 2 timed out, 6 skipped).
  - Both failures are preserved explicitly as historical receipts. The subsequent final controller rerun under the runner configuration loader passed completely with exit 0 (129 test files passed, 4 skipped; 3,056 passed, 6 skipped, 0 failed), confirming full suite health and reconciling the prior failed receipts.
- **Vite Cache Denial (Resolved):** Earlier controller attempts to run `npm test` and `npm run build` failed with `EPERM` on `node_modules/.vite-temp`. Coordinator repaired QA by authorizing isolated dependency `.vite-temp` cache writes; subsequently, all build and test commands completed with exit 0.
- **Sandbox Symlink Isolation (Resolved):** Initial terminal sandbox configurations restricted access to symlinked `runtime/node_modules` (exit 126/1). Owner expanded workspace access to include the run folder workspace, allowing routine development, build, and test commands to run cleanly inside the sandbox.
- **Historical Git Upstream Limits:** Direct live GitHub upstream probes were prevented by initial sandbox DNS resolution; coordinator authenticated check confirmed `origin/main` at `017c1c6cfd2ae6574136750e47bfa709264ac17f`.

### Reconciled Verification Matrices

#### Controller Supported Runtime Matrix (Node v22.23.3 Baseline)

| # | Check | Exact Controller Command Line | Environment | Result | Details & Timings |
|---|---|---|---|---|---|
| 1 | Rust Format Check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Controller | **PASS (exit 0)** | Clean formatting, 0 diffs. |
| 2 | Rust Clippy Linter | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Controller | **PASS (exit 0)** | 0 warnings, 0 errors. |
| 3 | Rust Native Tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Controller | **PASS (exit 0)** | 465 passed, 0 failed, 6 ignored. |
| 4 | Cargo Lock Sync | `npm run test:cargo-lock` | Controller | **PASS (exit 0)** | `her-flight-deck` is 0.5.3 in both `Cargo.toml` and `Cargo.lock`. |
| 5 | Git Diff Whitespace Check | `git diff --check` | Controller | **PASS (exit 0)** | 0 trailing whitespace errors, 0 trailing blank lines across all scoped files. |
| 6 | Five Focused Suites (Vitest) | `node node_modules/vitest/vitest.mjs run src/logic/studyContentProvenance.test.ts src/pages/StudyLibrary/MaterialDetailProvenance.test.ts src/pages/StudyLibrary/MaterialDetailOffline.test.ts src/pages/StudyLibrary/MaterialDetailGemini.test.ts src/pages/StudyLibrary/MaterialDetailImport.test.ts --configLoader runner --no-cache` | Controller (Node v22.23.3) | **PASS (exit 0)** | 5 test files, 43 passed (12 helper, 6 integration, 11 offline, 10 gemini, 4 import), 0 failed. |
| 7 | Frontend Typecheck | `npm run typecheck` | Controller | **PASS (exit 0)** | Zero TypeScript diagnostics (`tsc --noEmit`). |
| 8 | Frontend Build | `npm run build` | Controller | **PASS (exit 0)** | `tsc --noEmit && vite build` completed in 1.40s (`dist/` generated). |
| 9a | Full Test Suite (Reviewer Run) | `npm test -- --configLoader runner --no-cache` | Controller | **FAIL (exit 1)** | 133 suites: 3,055 passed, 1 failed (`CardReviewPanel.test.ts:590`), 6 skipped. Preserved as execution history. |
| 9b | Full Test Suite (Timeout Run) | `npm test -- --configLoader runner --no-cache` | Controller | **FAIL (exit 1)** | 133 suites: 127 passed, 2 timed out, 4 skipped; 3,054 passed, 2 timed out (`skillEvidenceValidationParity.test.ts`, `studyLibraryScenarios.test.ts`), 6 skipped. Preserved as execution history. |
| 9c | Full Test Suite (Final Passing Run) | `npm test -- --configLoader runner --no-cache` | Controller | **PASS (exit 0)** | 133 suites: 129 passed, 4 skipped; 3,056 passed, 6 skipped, 0 failed. Reconciled passing verification. |

#### Local Terminal Sandbox Matrix (Node v26.10.0 / Historical Receipts)

| # | Check | Exact Sandbox Command Line | Environment | Result | Details & Timings |
|---|---|---|---|---|---|
| 1 | Rust Format Check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Sandbox | **PASS (exit 0)** | Clean formatting, 0 diffs. |
| 2 | Rust Clippy Linter | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Sandbox | **PASS (exit 0)** | 0 warnings, 0 errors in 0.52s. |
| 3 | Rust Native Tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Sandbox | **PASS (exit 0)** | 465 passed, 0 failed, 6 ignored in 49.06s. |
| 4 | Cargo Lock Sync | `npm run test:cargo-lock` | Sandbox | **PASS (exit 0)** | `her-flight-deck` is 0.5.3 in both `Cargo.toml` and `Cargo.lock`. |
| 5 | Worktree List | `git worktree list` (pre-approved) | Sandbox | **PASS (exit 0)** | `isolated-repo 8a260c0 [main]` and `worktree 017c1c6 [agents/task-20261013-163348-447277]`. |
| 6 | Git Diff Whitespace Check | `git diff --check` | Sandbox | **PASS (exit 0)** | 0 trailing whitespace errors, 0 trailing blank lines. |
| 7 | Five Focused Suites (Vitest) | `NODE_OPTIONS="--localstorage-file=/tmp/ls" node node_modules/vitest/vitest.mjs run src/logic/studyContentProvenance.test.ts src/pages/StudyLibrary/MaterialDetailProvenance.test.ts src/pages/StudyLibrary/MaterialDetailImport.test.ts src/pages/StudyLibrary/MaterialDetailGemini.test.ts src/pages/StudyLibrary/MaterialDetailOffline.test.ts --configLoader runner --no-cache` | Sandbox | **PASS (exit 0)** | 5 test files, 43 passed, 0 failed. |
| 8 | New Scoped M2 Regressions | `node node_modules/vitest/vitest.mjs run src/logic/studyContentProvenance.test.ts src/pages/StudyLibrary/MaterialDetailProvenance.test.ts --configLoader runner --no-cache` | Sandbox | **PASS (exit 0)** | 2 test files, 18 passed: 12 pure helper + 6 integration, 0 failed (1.33s). |
| 9 | Frontend Typecheck | `npm run typecheck` | Sandbox | **PASS (exit 0)** | Zero TypeScript diagnostics (`tsc --noEmit`). |
| 10 | Frontend Build | `npm run build` | Sandbox | **PASS (exit 0)** | `tsc --noEmit && vite build` completed in 1.14s (`dist/` generated). |
| 11 | Historical Full Test Matrix | `npm test -- --configLoader runner --no-cache` | Sandbox | **RETAINED BASELINE** | 125 test suites passed (3,043 passed, 6 skipped); 4 pre-existing failures under Node 26 engine changes. |

---

## 6. Verification Limits & Reconciled Remaining M2 Scope

### Verification Limits
1. **Interactive Desktop UI:** Tests were authored for the Node jsdom test runner with memory-backed and file-backed disposable SQLite instances; native desktop Tauri webview rendering was not tested interactively.
2. **Mocked Offline AI:** No live network calls to Gemini were performed (mocked and offline by design; verified with network spies confirming zero outbound network requests).
3. **Remote Git Probes:** Live GitHub upstream verification was confirmed by authenticated coordinator check (origin/main `017c1c6cfd2ae6574136750e47bfa709264ac17f`, matching task baseline commit); within the local terminal sandbox, direct live upstream network probes remain unexecuted per sandbox boundaries.
4. **Installed Platform & Packaging Gaps:** Physical desktop smoke tests on Apple Silicon/Windows over populated user data, native OS accessibility (VoiceOver), macOS Developer ID signing, Apple notarization, and Windows SmartScreen/Defender clearance remain unexecuted/deferred.

### Milestone M2 Status & Reconciled Remaining Requirements

> [!NOTE]
> **Milestone M2 is NOT integrated or merged.**
> As defined in `ROADMAP.md` §7, Milestone M2 (Study Library sessions) remains an active, ongoing milestone. While Milestone M3 production is integrated, Milestone M2 as a whole has not been integrated or merged. Prior individual M2 increments were accepted as isolated source-level increments in previous reviews:
> - **Card Review C1 (ROADMAP §7.B):** Material-level card reviews, card-level review state, immutable review events, flip/reveal, deterministic `simple-v1` interval scheduling, exact current-version due work, card-level suspend/flagging before rating, and recent review pagination (`docs/M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md`).
> - **Card Review C2 (ROADMAP §7.B):** Library-wide Review due and History views, queue retrieval pipeline, and batching under deterministic `simple-v1` interval scheduling (`docs/M2_CARD_REVIEW_C2_SOURCE_ACCEPTANCE_2026-10-08.md`). FSRS evaluation remains strictly research-only and was not adopted into production.
> - **Practice Sessions PR1 & PR2 (ROADMAP §7.A):** Durable practice sessions, resumable attempts, and practice history (`docs/M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md`).
> - **Split Lineage (ROADMAP §7.C):** Lineage tracking for split PDFs (`docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md`).

Following this display-only increment for saved content provenance (ROADMAP §7.C), the **remaining requirements for Milestone M2 (ROADMAP.md §7)** are:
1. **Practice Question Flag & Report Action (ROADMAP §7.C):** Action to flag/report questionable generated practice questions/content, excluding disputed questions from progress conclusions/metrics until reviewed. (Card flagging was accepted in C1; this remaining requirement applies specifically to practice questions and generated test items).
2. **Short Multi-Material Sessions (ROADMAP §7.C):** Short study sessions from a selected material or user-approved collection across multiple materials, reusing local saved content without another Gemini request.
3. **In-Viewer Page Jump Navigation (ROADMAP §7.C):** Page reference jump navigation jumping directly to source PDF documents within the viewer (coordinated with M4 document viewer capabilities).

### Retained Installed and Platform Acceptance Gaps (M2 Verification Hold)
In alignment with `M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md`, `ROADMAP.md` §7.C, and `PRODUCT_SPEC.md`, source acceptance does not constitute installed-app or release acceptance. The following platform and installation acceptance gaps remain deferred, unverified, and required before release:
1. **Physical Desktop Platform Smoke & Update Verification:** Installed-app verification on physical Apple Silicon (macOS 12+ / arm64) and Windows desktop platforms over populated user data remains unexecuted.
2. **Native Runtime & Desktop IPC/Plugin Runtime:** Actual desktop IPC runtime with native `tauri-plugin-sql` and SQLite plugin connection pool semantics remains unexecuted in live Tauri webview environments (source jsdom and native Rust integration tests pass, but live desktop webview interaction is deferred).
3. **Accessibility Verification:** System VoiceOver and keyboard navigation verification across native desktop dialogs and views on installed macOS builds remain unverified.
4. **Developer ID Signing & Notarization:** macOS Developer ID signing, Apple notarization, and Windows SmartScreen/Defender clearance gates remain deferred and unresolved.
5. **No Production Release Clearance:** No user profile, production account, or release deployment is authorized; Milestone M2 work remains strictly scoped to source-level verification.

---

## 7. Data Safety, Security & Policy Guarantees

- **Bundle Identifier:** Maintained as `com.herflightdeck.app`.
- **Application Version:** Preserved at `0.5.3` across all manifests (`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`).
- **Database Migrations:** Shipped migrations 0001–0014 remain completely untouched; zero additive migrations introduced.
- **Secrets & API Keys:** Stored Gemini API key security architecture unchanged; webview never receives stored secrets.
- **Platform Guarantees:** Backup/restore format and data compatibility preserved.
- **Scope Containment:** All changes strictly confined to the seven authorized files; M4 ownership and all excluded runs preserved without modification.
