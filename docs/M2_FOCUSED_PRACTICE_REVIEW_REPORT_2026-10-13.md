# M2 focused practice review: missed or skipped questions — 13 October 2026

**State: IMPLEMENTED, PENDING INDEPENDENT REVIEW.** The changes are local and uncommitted in an isolated worktree. They are not pushed, merged or released. This is one source-only increment toward ROADMAP §7.A ("review missed questions"). It does not complete M2, and it says nothing about installed-app or release readiness.

| Field | Value |
| --- | --- |
| Base | `c9a15ab6110d73bcb8c0eca1e380bd442b129827` (PR #155 provenance on main) |
| Worktree | `runs/20261013-215343-296952/worktree`, branch `agents/task-20261013-215343-296952` |
| Implementer | Claude (`claude-opus-5-5`), owner-selected; Codex or the designated reviewer reviews independently |
| Scope sources | CLAUDE.md, PRODUCT_SPEC.md, ROADMAP §7.A/§7.C, M2 practice scope §1/§4, M2 practice owner approval (D1 retained review, D5 practice-score wording) |

## What changed for her

- **Completed result → focused review.** When a finished practice test is confirmed as saved, the result card now offers **Review missed or skipped questions** next to Retake and View practice history. The link opens that exact attempt's review with only the questions to look at again.
- **All questions / Missed or skipped.** Every completed-attempt review now has these two controls. Existing "Review attempt" links still open on All questions. Missed or skipped shows incorrect answers, "I don't know" answers and unanswered questions, in the original order and with their original numbers ("Question 3 of 4"). Each one keeps its answer labels, explanation and source-page wording.
- When nothing was missed, the focused view says so ("Nothing missed or skipped") and offers **Show all questions**.
- The overall score, breakdown badges and the practice-result disclaimer stay the same in both views.

## Design

- `src/logic/practiceAttemptReview.ts` (pure, new):
  - Classifies each frozen item from its own `correctIndex` and this attempt's own response. The stored `isCorrect` flag and responses from other attempts are not used.
  - Returns entries sorted by `ordinal`, numbered `ordinal + 1`.
  - Filters entries for each view, parses `?review=` (only `missed` focuses; anything else means All questions), and builds an encoded attempt path.
  - Its inputs are read-only and it always returns fresh arrays.
- `PracticeHistory.tsx`:
  - The `review` query parameter selects the view. Native `<button aria-pressed>` controls sit in a labelled `role="group"` and reuse the existing `filter-chips` styles and global `:focus-visible`.
  - Switching views rewrites only the query (`replace`). It does not re-read anything, write anything or start an attempt.
  - The loaded attempt and any load error are now keyed to the route identity (`historyKey|attemptId`). Even for the render before the reset effect runs, a different route shows Loading rather than the previous attempt's questions. The existing generation guard still drops late reads.
- `PracticeTestPanel.tsx`:
  - The link renders only when `phase === "completed"`, `result.attemptId` is present, the panel's own attempt has that ID, and the retained version is that attempt's version. The `historyKey` comes from that version, not the material ID.
  - It is hidden during an unknown-outcome completion and while a retake is pending.
  - It uses the same `#/…` anchor pattern as the existing "View practice history" link.
- **No changes to:** persistence, schema, migrations, scoring, the native opener, M4 page navigation, dependencies, version or identity. `studyLibrary.css` was allowed but not needed.

## Changed-file inventory (7 of the 8 allowed paths)

| Path | Change |
| --- | --- |
| `src/logic/practiceAttemptReview.ts` | new, 85 lines |
| `src/logic/practiceAttemptReview.test.ts` | new, 9 tests |
| `src/pages/StudyLibrary/PracticeAttemptReview.test.ts` | new, 6 rendered tests |
| `src/pages/StudyLibrary/PracticeHistory.tsx` | modified, +152/−95 |
| `src/pages/StudyLibrary/PracticeTestPanel.tsx` | modified, +18 |
| `docs/M2_FOCUSED_PRACTICE_REVIEW_REPORT_2026-10-13.md` | new, this report |
| `docs/PROJECT_HANDOFF.md` | modified, +15 (top entry) |

`src/pages/StudyLibrary/studyLibrary.css` is unchanged.

## Requirement-to-test mapping

The pure tests are in `practiceAttemptReview.test.ts` (P). The rendered tests are in `PracticeAttemptReview.test.ts` (R). Rendered tests use the real `AppDataProvider` over a disposable node:sqlite file. Every record is created through the existing repositories and `saveSessionAction`.

| Requirement | Test |
| --- | --- |
| All four outcomes come from the frozen `correctIndex`; the stored `isCorrect` is ignored | P "covers all four outcomes…", "treats a don't-know response…" |
| Missed = incorrect, don't-know and unanswered; correct is excluded | P "counts every outcome except correct…"; R "focuses on incorrect, don't-know and unanswered…" |
| Mixed order, frozen ordinal order and original numbers | P "keeps frozen ordinal order…" (input shuffled); R headings `1, 3, 4 of 4` |
| Another attempt's response is ignored | P "ignores another attempt's response…" |
| Empty focused results (all-correct, no items) | P "returns an empty focused view…"; R "shows a clear empty focused view…" (message, then Show all questions → 4 items) |
| Inputs stay unchanged | P "does not mutate its inputs…" (deep-frozen inputs) |
| `?review=missed` focuses; unknown values and plain links mean All | P "opens the focused view only for review=missed"; R "keeps ordinary attempt links and unknown query values on All questions" (`everything`, `MISSED`, empty, plus a click through "Review attempt") |
| Encoded identifiers in the route | P "encodes both identifiers…" (`m 1/ä?#`, `a/b c`); R checks the panel's exact `href` |
| Link targets the exact acknowledged attempt and its retained `historyKey`; not shown on unknown completion; hidden during a pending retake | R "appears only after acknowledged completion…" (first completion rejects with an unknown error → no link; Retry → link; DB attempt ID equals the link's; following the link opens the focused view of that attempt) |
| Partial completion | R panel case (correct / incorrect / don't know / unanswered) and the mixed history case |
| Accessible names, keyboard operation, `aria-pressed` | R mixed case (group name, native focusable buttons, `aria-pressed` true/false after each switch) |
| Explanation, answer labels and source page kept | R mixed case (`Mixed why n`, `Source p. 1n`, `(Your choice)`, `(Correct answer)`) |
| Score, responses, timestamps and status unchanged; no writes, no re-read, no attempt start, no provider request | R mixed case: full `practice_attempts` / `practice_responses` / `practice_test_versions` rows equal before and after; `saveSessionAction`, `getItems` and `fetch` not called |
| Frozen content after test replacement and source deletion | R "still reviews the frozen questions after the test is replaced and the source deleted" |
| Route change plus a delayed earlier read cannot publish another attempt's questions or selection | R "never shows a delayed earlier attempt's questions…" (A?missed with its item read held → B plain shows All; releasing A leaves B; going back to A shows its own focused view) |

## Sensitivity (actual results)

Each run used the `--configLoader runner --no-cache` vitest invocation. Every mutation was restored afterwards and checked with `cmp` or `git diff --stat`.

| Mutation | Result |
| --- | --- |
| Baseline `c9a15ab` `PracticeHistory.tsx` + `PracticeTestPanel.tsx` | R **6/6 fail**. Panel: no "Review missed or skipped questions" link. Focused case: expected 3 headings, got 4 (the baseline shows every question). The rest have no All questions control or empty message. |
| Focused view drops don't-know | P 2 fail, R 3 fail (5 of 15) |
| Focused view drops unanswered | P 2 fail, R 3 fail (5 of 15) |
| Classify by stored `isCorrect` instead of `correctIndex` | P 3 fail |
| Post-read generation guard removed | R race case fails |
| Generation guard and route-key binding both removed | R race case fails |

Limit: the route-key binding on its own is defense in depth for a single render. jsdom does not observe that frame separately, so the race test is carried by the generation guard.

## Commands and results

Machine: macOS (Darwin 27.0.0). CI uses Node 22 (`.github/workflows/checks.yml`).

Six named focused suites (Node 22.23.3), exit 0, 6 files, **77 tests passed**:

```bash
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache \
  src/logic/practiceAttemptReview.test.ts \
  src/pages/StudyLibrary/PracticeAttemptReview.test.ts \
  src/pages/StudyLibrary/PracticeTestPanel.test.ts \
  src/pages/StudyLibrary/PracticeSessionPR2.test.ts \
  src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts \
  src/pages/StudyLibrary/PracticeSessionPR2Corrections.test.ts
```

| File | Tests |
| --- | --- |
| `practiceAttemptReview.test.ts` | 9 |
| `PracticeAttemptReview.test.ts` | 6 |
| `PracticeTestPanel.test.ts` | 8 |
| `PracticeSessionPR2.test.ts` | 10 |
| `PracticeSessionPR2Finish.test.ts` | 34 |
| `PracticeSessionPR2Corrections.test.ts` | 10 |

Two adjacent suites were also run in the same development pass with the same flags: `PracticeHistoryDates.test.ts` (3) and `PracticeMetadataReadRecovery.test.ts` (12), for 8 files and 92 tests passed, exit 0.

`npm run typecheck` passed (exit 0) during development.

Consolidated gate after final corrections:

| Command | Exit | Result |
| --- | --- | --- |
| `npm test` (Node 22.23.3), i.e. `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache` | 0 | 131 files passed, 4 skipped; 3071 tests passed, 6 skipped |
| `npm run typecheck` | 0 | |
| `npm run build` | 0 | |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 0 | 465 passed, 6 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 0 | |
| `npm run test:cargo-lock` | 0 | 0.5.3 in sync |
| `git diff --check` | 0 | New untracked files also checked: no trailing whitespace |

**Failure recorded on the default Node lane.** The machine's default `node` is 26.10.0.

- On that lane `npm test` exits 1: 165 failures in 19 files, plus `PracticeSessionPR2.test.ts` in the focused run.
- Cause: under Node 26 the global `localStorage` is undefined without `--localstorage-file`, so `localStorage.clear()` in `beforeEach` throws. There are also some node:sqlite parity cases.
- Comparison: the same 20 files fail with exactly **165 failed / 59 passed** when the baseline `c9a15ab` UI files are swapped in. These failures existed before this increment and are not caused by it.
- The new rendered test does not call `localStorage`, so it runs on both lanes.
- No existing test was weakened or edited.

No dependency was restored or installed. The prepared `node_modules` was used as-is.

## Preserved

- PR #155 provenance, PR #154 source-map-js and timezone PR #152.
- schema14 `runs/20261012-202254-779884`, MAINT-143-KEYS `runs/20261012-223624-013056` and REL-03 `runs/20261013-142913-309257`.
- The separately owned M4 work, shipped migrations, bundle identifier, version 0.5.3 and backup format.
- The primary checkout.

## Not done / open

- No screenshot or installed WKWebView/VoiceOver check. Evidence is jsdom only.
- Practice IDs only allow `[A-Za-z0-9_.-]`, so the rendered encoded-route check uses a valid ID. Encoding of reserved characters is proven by the pure path test.
- Next step: independent review. No further increment has been started.
