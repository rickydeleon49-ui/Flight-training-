# Performance and usability polish — 27 September 2026

_Branch `feature/m1-d6-debrief-links`. Committed baseline `d6e2ec3` plus the uncommitted, reviewed D7 acceptance work. Measurements below are implementation evidence, not independent performance measurements by Codex. Codex separately reviewed the changes and reran the focused tests._

## 1. State and environment

| Item | Value |
| --- | --- |
| Baseline | `d6e2ec3` plus the uncommitted D7 files (`ROADMAP.md`, `STATUS.md`, `src-tauri/src/debrief.rs`, `docs/M1_D7_ACCEPTANCE_2026-09-27.md`, `src/acceptance/`) |
| Machine | Windows 11 Pro 10.0.26200 x64; AMD Ryzen 7 5800X3D; Radeon RX 9070 XT |
| Frontend runtime | Node v24.16.0; Vitest with jsdom; `node:sqlite` with the app's own migrations |
| Browser check | Vite dev server (browser mode, sql.js in the built-in Chromium pane's own storage, isolated from the real profile) |
| Native runtime | rustc 1.98.1, `cargo test --release` (optimized) |
| Desktop app | **Not launched.** This machine holds a real Her Flight Deck profile, and no isolated profile was verified (same reason as D7). |

Other work in the tree was preserved. An untracked `docs/MAC_PARITY_CHECKLIST.md` (created at 12:01 by another session) was not touched.

## 2. Separate correction: D7 source check (not performance)

`listed_modules_do_not_reference_reqwest_directly_outside_gemini` normalized line endings with literal multi-line strings, so the replacement was a line break for a line break. On CRLF source, the test-module boundary was never found.
- It now uses a helper, `production_source`, with escaped `"\r\n"` → `"\n"` normalization, then cuts at the `#[cfg(test)]` + `mod tests` block.
- New test `the_reqwest_source_check_treats_lf_and_crlf_alike` proves LF and CRLF fixtures give identical results. It also proves a direct reference in production code is still caught, including one placed after a test-only helper or after a comment mentioning `#[cfg(test)]`.
- Temporarily replacing the normalization with `source.to_string()` made that test fail. It was then restored.

It remains a limited source check, not proof of offline behaviour.

## 3. Method

- **Datasets:** synthetic, in three tiers chosen to match one student pilot, where most actions end up completed and most questions answered.

  | Tier | Meaning | Materials | Actions | Journal entries | Questions |
  | --- | --- | ---: | ---: | ---: | ---: |
  | Small | First weeks | 100 | 100 | 30 | 50 |
  | Medium | About a year | 1,000 | 400 | 150 | 250 |
  | Large | Several years, heavily split library | 5,000 | 1,500 | 500 | 800 |

  One action in 5 is open and one question in 3 unanswered. An earlier run with 5,000 mostly-open actions was discarded as unrealistic.
- **Frontend benchmark:** `src/perf/appResponsiveness.bench.test.ts`, gated by `HFD_BENCH=1`. It uses the real `AppDataProvider` and pages with query counting and a React Profiler. Each figure is the median of 5 repeats (search: 30 keystrokes), with min and max.
  - These times are JavaScript, React and SQLite work in Node/jsdom.
  - They are **not** WebView paint, Tauri IPC or packaged-app startup.
- **Chromium check:** Flight Deck → Questions in the dev-server browser app, 1 warm-up plus 5 measured runs. Each run is timed until the rows are in the DOM and layout has been forced. Paint isn't included: the pane was hidden, which pauses animation frames.
- **Native benchmarks** (ignored by default, run with `--ignored --nocapture` in release mode, 3 repeats):
  - `pdf::tests::split_benchmark_long_and_image_heavy`
  - `pdf::tests::gemini_local_preparation_benchmark`
  - `debrief::tests::complete_backup_benchmark_large_library`

## 4. Findings, ranked by user impact

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Opening **Questions** is slow with a long history. It rendered every question, and each row scanned every material, lesson and journal entry to find its links. | jsdom, large: 531 ms median (488–592), about 15,000 DOM nodes. Chromium, 800 questions and 1,000 materials: 595 ms median (432–642). | **Fixed** (§5.1) |
| 2 | **Restoring a complete backup** is much slower than creating one. After writing each file, staging reopened it to hash it, and each reopen of a just-written file cost about 19 ms on this Windows machine (on-access scanning is the likely cause; the component wasn't identified). | Release, 5,000 records and 300 × 200 KB files: export 631 ms, validate 163 ms, restore 6,856 ms median (6,832–6,887). Phase timing: reopen ≈ 5.7 s, hashing ≈ 0.18 s, flush 0.47 s. | **Fixed** (§5.2) |
| 3 | In compact windows (≤ 900 px) the whole page scrolled sideways. A screen-reader-only label in the navigation escaped the nav's own scroll area. | Chromium at 470 px: document 824 px wide; the only element past the edge was a `span.visually-hidden` in a nav link. | **Fixed** (§5.3) |
| 4 | Sorting a large library | jsdom, large: 71–78 ms median | Not changed; under 100 ms |
| 5 | Each change reloads every table (22 queries per change) | jsdom: 10 ms small, about 43–69 ms large (varies between runs) | Not changed. See §7. |
| 6 | Flight Deck with a large record | jsdom, large: 60–93 ms median | Not changed |
| 7 | PDF splitting | Release: 3,000-page book split automatically in 105 ms (102–114); 59 MB, 1,200-page image PDF in 1,728 ms (1,689–1,753); manual pages 101–600 in 24 ms and 520 ms. Runs off the UI thread. | Not a bottleneck; no algorithm change |
| 8 | Gemini local preparation | Release, 49.5 MB 1,000-page PDF: page count 52 ms, read 9 ms, Base64 31 ms, JSON body 56 ms (66 MB body). A 900-page text PDF takes about 6 ms. | Not a bottleneck; no change |
| 9 | Study Library search typing | jsdom: 6–20 ms per keystroke across tiers | Fine |

**Checked without finding a problem:**
- Notes autosave is debounced (700 ms), stops on a failed save instead of looping, and writes only after an edit.
- Timers and listeners (undo bar, local date, Quick Find) are cleaned up on unmount.
- `prefers-reduced-motion` already disables animations and transitions globally.
- A global `:focus-visible` style exists.
- The main JavaScript entry is 381.14 kB (118.56 kB gzip), identical to the D7 build.

## 5. Changes

### 5.1 Questions (measured improvement)

`src/pages/Questions/Questions.tsx`:
- Each row's material, lesson and debrief now come from id maps built once per data change, instead of scanning every record for every row.
- The list mounts 100 rows at a time, with "Showing N of M questions" and "Show 100 more questions". This follows the pattern the Study Library already uses.
- The status filters and the total count still cover the whole list. Changing the filter starts again from one page.
- The "Before your next lesson" card is unchanged and still lists every unasked question.

| Measurement | Before | After |
| --- | ---: | ---: |
| jsdom, large (800 questions) | 531 ms (488–592), 14,993 nodes | 63 ms (57–110), 1,930 nodes |
| jsdom, medium (250 questions) | 166 ms (157–280) | 63 ms |
| jsdom, small (50 questions) | 47 ms | 47 ms (no paging below 100) |
| Chromium, 800 questions | 595 ms (432–642), 15,178 nodes | 62 ms (46–102), 2,115 nodes |

The id maps on their own gave only about 18% at the large size (531 → 437 ms). Limiting the rendered rows was the decisive change.

Tests in `Questions.paging.test.ts`:
- paging, "Show more" until every question is reachable, and a filter covering the whole list;
- no paging controls for a short list;
- correct links, including "Source material unavailable" after a real deletion.

### 5.1a Review corrections to the Questions paging (27 September 2026)

Codex's review reproduced two defects in §5.1, and both were confirmed here by new tests that failed on the §5.1 code:

1. **Unsaved answers were lost when a row left the visible page.** The typed answer and the "editing" state lived inside each row. A new question (or a filter change) pushed the row past the first 100, React unmounted it, and the text was gone when she showed more.
2. **Paging didn't reset when switching back to a filter.** The expanded limit was stored with the filter it belonged to. Switching Everything → Answered → Everything found the old "Everything" expansion again (200 rows instead of 100).

Fix, in `src/pages/Questions/Questions.tsx`:
- **Drafts keyed by question id.** Unsaved answers now live on the page, keyed by question id, instead of in each row. A row that leaves the visible page keeps its draft, and when it's shown again the editor reopens with that text.
- **Nothing autosaved.** Only "Save answer" writes, and only for that question.
- **Save and Cancel.** A successful save clears only that question's draft; a failed save keeps it. Cancel now deliberately discards that question's unsaved answer, and reopening starts from the saved answer. (Previously Cancel kept stale typed text inside the row.)
- **Deleted questions.** A draft whose question no longer exists has no row and no editor, so it can't write anywhere. Drafts are in memory only and end when she leaves the page.
- **Filter reset.** Every real filter change now explicitly resets to 100 rows. Choosing the already-selected filter changes nothing.
- **Unchanged:** rendering stays bounded to 100 rows at a time, and filters and counts still cover the whole list.

New tests in `src/pages/Questions/Questions.drafts.test.ts`, using the real page, provider and SQLite with deterministic `created_at` order. On the §5.1 code, 4 of the 8 failed:
- A draft survives a new question pushing its row off the page, and is restored after Show more. Nothing is autosaved.
- A draft survives filter changes and paging.
- Several drafts stay apart, and saving one clears only that one.
- A failed save keeps the draft.
- Switching away and back resets to one page, before and after expanding the other filter.
- Choosing the same filter again doesn't reset.

Benchmark with the same dataset and method (jsdom, large tier, 800 questions, median of 5), comparing the §5.1 run, correction run 1 and correction run 2:
- **Questions:** 62.7 ms, 77.5 ms and 77.5 ms. Medium tier: 62.7, 78.3 and 77.0 ms.
- **DOM nodes:** 1,930 in all three, so rendering is still bounded.
- **How to read it:** medians in this method fall on steps of about 15.5 ms (46, 62, 77 ms), the polling interval of the wait-for-element loop, so the difference is one step. The method can't resolve a smaller cost. It remains about 7× below the original 531 ms (14,993 nodes).
- **Not repeated:** the Chromium browser check was not rerun for the correction; its 62 ms figure applies to the §5.1 code.

### 5.1b Review correction: Questions answer-save race and per-question save ownership (27 September 2026)

Codex's deterministic delayed-save probe exposed a lost-edit issue when saving an answer:
1. Open a question's answer editor and type "Submitted answer".
2. Click Save answer while delaying the database update with a test-controlled promise.
3. While pending, type "Newer answer".
4. Release the database update.
5. The database persisted "Submitted answer", but the newer draft disappeared because the save completion called `onDraftChange(null)` unconditionally.

Root cause:
- Draft clearance was unconditional: completing an older in-flight write cleared `answerDrafts.get(question.id)` without checking whether the active draft had been edited or reopened since the save began.
- Controls remained active during saving: the pilot or automation could change the textarea, click Save multiple times (triggering concurrent redundant writes), or click Cancel while a write was already in flight to SQLite.
- Row unmounting during filter changes or paging did not preserve in-flight saving state, potentially allowing duplicate submissions after remounting.

Fix, in `src/pages/Questions/Questions.tsx`:
- **Per-question save ownership & monotonic revisions:** Drafts are stored as `{ text: string, revision: number }` using a monotonic revision counter (`nextDraftRevisionRef`). When a save begins, it captures `submittedRevision`. Upon successful database update, `clearAnswerDraftRevision(question.id, submittedRevision)` removes the draft only if the current draft's revision still matches `submittedRevision`. Newer typing or a newly opened editing session has a higher revision and survives intact.
- **Synchronous in-flight guard (`savingQuestionIdsRef`):** A component-level ref set updated synchronously before awaiting the mutation blocks duplicate submissions even when multiple clicks occur within the same React render/batch.
- **Conflicting controls disabled during save:** While `savingQuestionIds.has(question.id)` is true, the question's `TextArea`, `Save answer` button (labeled "Saving…"), `Cancel` button, status `Select`, and delete `IconButton` are disabled.
- **Honest Cancel definition:** Cancel is disabled during an in-flight save (`disabled={isSaving}`), making clear that an in-flight database write cannot be cancelled or undone mid-flight. When not saving, Cancel discards the draft as before.
- **Pending state across filter changes and remounts:** In-flight saving state is tracked at the page level (`savingQuestionIds`), surviving filter changes and pagination unmount/remount cycles.
- **Failed save retains draft:** If `mutate` fails, the draft is retained and controls re-enable for safe retry; the synchronous guard is released in `finally` so retries and later deliberate saves proceed unblocked.
- **Independent questions:** Other questions remain fully editable and independent while one question is saving.

Automated regression tests in `src/pages/Questions/Questions.drafts.test.ts` (using controlled promises `createGate()` instead of sleeps; 14 tests total):
- New typing during delayed save is preserved, with conflicting controls disabled.
- An old completion cannot clear a newer editing session.
- Duplicate clicks within a single React batch produce only one submission, and later edit/save works.
- Pending ownership survives filtering away and back.
- Delayed failure preserves input, releases the guard, and permits retry.
- Another question's draft remains unaffected during a delayed save.

### 5.2 Complete-backup restore (measured improvement)

`src-tauri/src/backup.rs` (restore staging):
- Each file is hashed as its bytes stream from the archive to disk (`copy_and_hash`), instead of being reopened and read back after writing.
- The same checks still apply before staging: exact size, SHA-256 against the archive's integrity record, and `sync_all` for durability.
- Validation (`inspect_archive`) still hashes every archive entry first. Nothing else in export, validation, rollback or format support changed.

| Measurement (release, n = 3) | Before | After |
| --- | --- | ---: |
| Stage and apply restore | 6,856 ms (6,832–6,887) | 1,142 ms (1,083–1,250) |
| Export (unchanged code) | 631 ms | 671 ms (run-to-run variation) |
| Validate (unchanged code) | 163 ms | 167 ms |

**Integrity note:** the previous read-back hashed what the operating system returned for the new file, usually from its cache rather than the disk. Hashing the exact bytes written catches the same archive corruption or tampering. The size check and `sync_all` are unchanged.

Tests:
- New: `restored_files_are_hashed_from_exactly_the_bytes_written`.
- All 44 backup tests pass, including `a_same_size_content_change_fails_the_integrity_check`, the format v1/v2/v3 tests, and the hostile-archive tests.

### 5.3 Compact-window horizontal scroll (usability fix, verified in Chromium)

In `src/components/layout/shell.css`, the compact (≤ 900 px) `.nav` is now `position: relative`, so its screen-reader-only text stays inside the nav's own scroll area.

Measured at 470 px wide: the document was 824 px and is now 470 px. The nav still scrolls internally, and the hidden label is still present. At 1,280 px wide the rule doesn't apply: the nav stays a static column.

`shell.css.test.ts` is only a source guard, because jsdom can't lay out CSS.

## 6. Commands and results (one at a time, 27 September 2026)

| Command | Result |
| --- | --- |
| `cargo test reqwest` (D7 correction) | 2 passed; the normalization mutation made the fixture test fail |
| `npm ci` | 0 vulnerabilities |
| `npm test` | 58 files passed, 3 skipped; 536 passed, 3 skipped (benchmarks) |
| `npm run build` | Succeeded; entry 381.14 kB (118.56 kB gzip) |
| `cargo fmt --check` | Clean |
| `cargo clippy --all-targets -- -D warnings` (after touching sources to force a re-lint) | Clean |
| `cargo test` | 158 passed, 5 ignored (benchmarks) |
| `git diff --check` and a new-file whitespace/conflict scan | Clean |
| Frontend benchmark before and after | See §4 and §5.1 |
| Native benchmarks (release) | See §4 and §5.2 |

**Intentionally not run:**
- packaged or installed app startup (real profile on this machine);
- live Gemini requests (not authorized);
- a macOS build.

### 6b. Correction-pass validation (27 September 2026, frontend and docs only)

| Command | Result |
| --- | --- |
| `npx vitest run src/pages/Questions/Questions.drafts.test.ts` on the §5.1 code | 4 failed, 4 passed (reproductions) |
| `npx vitest run src/pages/Questions src/acceptance src/components/layout/shell.css.test.ts src/pages/FlightJournal/debriefLinks.test.ts` | 6 files, 28 passed |
| `HFD_BENCH=1 npx vitest run src/perf/appResponsiveness.bench.test.ts`, run twice | Questions: large 77.5 and 77.5 ms, medium 78.3 and 77.0 ms, small 61.7 and 46.2 ms; 1,930 DOM nodes (see §5.1a) |
| `npm test`, first run | 1 failed: `Questions.paging.test.ts` › "shows a page at a time…" **timed out** at 5 s under full-suite load |
| The same test on its own | 2.27–2.39 s with the corrected code, 2.27–2.28 s with the §5.1 code, so the correction didn't slow it |
| Fix | An explicit 20 s limit for the five long-list tests (seeding hundreds of questions); no assertion changed |
| `npm test`, final | 59 files passed, 3 skipped; 544 passed, 3 skipped (benchmarks) |
| `npm run build` | Succeeded; entry 381.14 kB (118.56 kB gzip), unchanged |
| `git diff --check` and a new-file whitespace/conflict scan | Clean |

### 6c. Save-race correction validation (27 September 2026, frontend and docs only)

| Command | Result |
| --- | --- |
| `npx vitest run src/pages/Questions/Questions.drafts.test.ts` on §5.1a code with reproduction test | 1 failed, 8 passed (`AssertionError: expected undefined to be 'Newer answer'`) |
| `npx vitest run src/pages/Questions/Questions.drafts.test.ts` with per-question ownership | 14 passed (all 6 new controlled-promise regression tests passed) |
| `npx vitest run src/pages/Questions src/acceptance src/components/layout/shell.css.test.ts` | 5 files, 22 passed |
| `npm test` | 59 files passed, 3 skipped; 550 passed, 3 skipped (benchmarks) |
| `npm run build` | Succeeded; entry 381.14 kB (118.56 kB gzip), unchanged |
| `git diff --check` | Clean |

No Rust file changed in this pass, so prior Rust validation results remain applicable and reused. Installed Mac behavior remains UNVERIFIED.

## 6a. Independent review by Codex (separate from the implementation results above)

Codex reported these independent checks, run before this correction:
- Questions paging, the shell source guard and D7 acceptance: 8 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml backup`: 45 passed, 1 ignored benchmark.
- `cargo test --manifest-path src-tauri/Cargo.toml reqwest`: 2 passed.
- `git diff --check`: clean.

Temporary probes reproduced both Questions paging defects (§5.1a) and were then removed.

Codex made no independent performance measurements. Every timing in this note is from the implementation runs described in §3.

## 7. Remaining bottlenecks and hypotheses (not changed, not proven)

- **Refresh after every change:** every change reloads all tables (22 queries). At the large tier that's roughly 43–69 ms in jsdom, varying between runs. Targeted refreshes could cut it, but they would need careful invalidation tests. Not justified at the measured cost.
- **Sort:** large-library sort (about 71–78 ms) and Flight Deck (60–93 ms) are under 100 ms in jsdom. Real WebView timings are unknown.
- **Gemini memory:** a near-limit document holds the file, its Base64 text and the serialized body at once, about 180 MB. Memory wasn't measured and nothing was changed.
- **Not measured:**
  - PDF import (picker → app-owned copy → record) timing;
  - first navigation including lazy route-chunk loading (the jsdom benchmark imports pages directly);
  - WebView paint, packaged startup and IPC latency;
  - native and WebView memory (the jsdom heap figures aren't meaningful);
  - UI responsiveness during a real backup;
  - Gemini network and model latency.

  This note covers the areas measured in §4, not the whole app.
- **Restore cause:** the per-file reopen cost is attributed to on-access scanning by elimination only. It may differ on other machines and on macOS.

## 8. Security, data-loss, migration and platform review

- **Migrations:** none added or changed. The debrief ledger and contract are untouched.
- **Backup:** atomic finalization, rollback, previous-backup preservation and all format and integrity checks are unchanged apart from the restore hashing in §5.2. The API key remains excluded from archives.
- **Permissions:** the bundle identifier `com.herflightdeck.app`, app-owned document paths and the opener scopes are unchanged. No new dependency was added.
- **No profile touched:** nothing ran against the real profile; the browser check used the preview pane's own storage.
- **No release:** no version change, no installer rebuilt or distributed, no release.

## 9. Unverified checks

- **Windows installed app:**
  - Questions with a long history;
  - a complete restore of a large library, timed;
  - the compact window width;
  - Flight Deck and Study Library interactions.
- **Apple Silicon:** all of the above, plus Finder, Preview and native dialogs. A macOS build would only be packaging evidence.
