# M2 Study Library sessions — design and decision record

**4 October current state:** Structured study import Slice B is [accepted for source integration](STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md). The real-user check-in has been waived; installed/release observations remain separate. The [next assignment](M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) prepares one bounded saved/resumable-practice-test scope using this existing M2 design. Remaining retention/versioning decisions and new migration/attempt implementation still require owner scope approval. Earlier check-in and pending-import descriptions below are historical where superseded.

_Prepared 27 September 2026 from merged `main` at `1d86d57` (PR #35). Planning only: no migration, product code, release version, or user data changed._

## Goal and entry gate

Make saved Study Library content useful for repeatable, offline study: resume a practice test, keep trustworthy attempt history, review flashcards due, and see what was studied. Extend the existing Study Library rather than creating a parallel product.

**Gate before implementation:** ROADMAP.md requires a check-in with the one real user after she has used M1's plan and quick debrief for one to two weeks. Record what she actually used, skipped, and requested. Use that feedback to confirm or narrow this plan before migration 11 or M2 UI work. Installed Mac parity and Windows release holds remain separate; this document does not mark them complete.

## Current code, not assumptions

- Migration 7 creates `ai_study_sets`, one row per source material. Flashcards and sections are JSON arrays with no durable item IDs. The row stores provider, model, generation and update time.
- Migration 9 creates `practice_tests`, also one row per source material with a JSON questions array. Saving a replacement test overwrites the active row. The questions have text, choices, correct index, explanation and optional source page, but no stable question IDs.
- `PracticeTestPanel.tsx` keeps index, selected answer and score in React state. A component keyed by `practiceTest.updatedAt` resets when regenerated. Closing/restarting loses the attempt; Retake resets the same in-memory panel.
- `MaterialDetail.tsx` already keeps guide, cards, test and source file together. Each automatic PDF part is its own material and can have its own generated content. Parent/source page-range lineage is not yet a durable first-class relationship.
- `AppDataContext` loads arrays of materials, study sets and tests. Adding thousands of attempts/review events to that global load would slow navigation; M2 history should be queried in bounded pages.
- The current backup archive saves the SQLite database and managed documents. New authoritative M2 tables must be included in database validation and backed up/restored without changing the archive's safety guarantees.

References: `src-tauri/migrations/0007_ai_study.sql`, `0009_practice_tests.sql`, `src/domain/types.ts`, `src/data/repositories/documentRepository.ts`, `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `MaterialDetail.tsx`, `src/state/AppDataContext.tsx`.

## Decisions to confirm at the M1 check-in

| Decision | Proposed default | Why it needs the user's input |
| --- | --- | --- |
| First M2 value | Resume and review practice tests before a full spaced-repetition system | Confirm which study activity she actually returns to |
| Deleted source | Keep minimal attempt text, result and source title for history; remove the PDF and generated active content after explicit confirmation | Avoid surprising retention of material she meant to erase |
| Regenerated content | Preserve completed attempts against the exact old version; start new attempts from the new version | Old answers must never be scored against replacement questions |
| Short sessions | One selected material first; a multi-material collection only after observed demand | Avoid unnecessary navigation and query complexity |
| Score wording | 'Practice result from your material'; never an official FAA score or flight proficiency | Distinguish study feedback from certification/readiness |
| Review scheduler | Deterministic, versioned simple intervals first | Avoid unexplained 'mastery' or an unreviewed scheduling dependency |

Record the answers in a dated check-in note and update this design before implementation. If she cannot test M1 yet because distribution is held, document that explicitly and keep M2 at planning/contract-test stage.

## Check-in protocol to unlock implementation

After she has access to a safe M1 build and one to two weeks of use, ask for a short walkthrough using her own records; do not copy private notes, PDFs or credentials into an issue. Capture only her answers and a sanitized example:

1. Show how she used the Daily Flight Plan. Which recommendations were opened, skipped or ignored, and why? Did any action feel duplicated or irrelevant?
2. Show one quick debrief. Was turning an improvement into an action, linking a material, or carrying a question to the next lesson useful? What was awkward?
3. On a material she studied, ask whether she would return first to a guide, cards, or practice questions. Does she need a saved test to resume after closing the app?
4. Ask how she expects Retake and generated replacements to work. Should an old score and missed-question list remain visible when a new test is generated?
5. Ask what 'delete this material' should mean for past attempt text and scores. Offer concrete choices: erase all history with it, keep a minimal historical record, or ask each time. Do not silently choose one.
6. Ask what a useful short review session looks like (one material, due cards, or a chosen collection) and what result she trusts. Avoid implying an official FAA score.
7. Record the Mac model/macOS version if she uses the Mac app and distinguish observed app behavior from requested changes. Report crashes, missing files and backup issues separately as higher-priority reliability defects.

Write a dated check-in note with decisions, observed examples, unresolved questions and any changed priorities. Obtain an explicit go-ahead on the revised M2 scope before migration 11. If she cannot use M1 because the installer/release hold persists, record that and keep this design preparatory.
## Proposed durable model (implementation sketch, not migration SQL)

1. **Content versions.** `study_content_versions`: stable ID, material ID when available, kind (`guide`, `flashcards`, `practice_test`), provider/model, generated timestamp, content hash, active/replaced state, and a minimal source snapshot. A unique active version per material/kind should be enforced. Do not use `updatedAt` as an identity. Preserve immutable old versions needed by history.
2. **Stable items.** `study_items`: stable ID, content-version ID, ordinal, kind (`card` or `question`), prompt/front, answer/back, choices/correct index/explanation as appropriate, optional source page and user flag. Item text is frozen for that version. An edited or regenerated item belongs to a new version. Validate choice indices and page bounds before persistence.
3. **Practice attempts and responses.** `practice_attempts`: ID, version ID, started/completed timestamps, state (`in_progress`, `completed`, `abandoned`), and any frozen scoring-policy version. `practice_responses`: stable ID or unique `(attempt_id,item_id)`, selected option or explicit `dont_know`, answered time. One response per item per attempt; retries update only that response. Completion is an atomic transition and stores an immutable result snapshot. An unfinished test has no final score.
4. **Card review state and events.** `card_review_state` is the current projection (due date/time, interval, repetitions, suspended flag, scheduler version); `card_review_events` are immutable records with unique operation ID, item ID, Again/Hard/Good/Easy, prior/new state, and timestamp. One operation ID applies once. State and event commit together.
5. **Split lineage.** A nullable parent material ID plus source page first/last and original-source identity, with explicit behavior when parent is deleted. Validate that ranges refer to the source version and do not infer lineage from a filename. This is metadata; the existing stored PDF bytes and 50 MiB/1,000-page contract remain unchanged.

The exact table names/columns and retention policy require review before writing migration 11. Prefer FK constraints, indexes on active versions, attempts by material/date, due work, and paged history. Avoid storing secrets or copies of full PDFs in these tables. Keep generated content snapshots just large enough to explain historical answers after source replacement/deletion, subject to the chosen retention policy.

### Migration and legacy content rules

- Never rewrite shipped migrations 1–10. Add a new migration and update both Rust/Tauri and TypeScript migration registration and checksums.
- Existing `ai_study_sets` and `practice_tests` are authoritative local content. Convert them once to a first content version and stable item IDs, or use a tested deterministic first-use upgrade. The version identity must not change on restart or backup/restore. Collision handling and malformed JSON must be specified; malformed rows must not silently become empty content.
- Preserve existing aggregate Pilot Toolkit quiz history separately. It has no proved item/version provenance and must not be presented as M2 attempts.
- New generation writes an entire validated version and active pointer atomically; failed generation or save leaves the previous active version and all history intact.
- Desktop multi-table writes need a pinned native transaction, as D6 demonstrated; the browser/test adapter needs equivalent behavior and contract fixtures. Do not assemble a transaction from separate pooled Tauri SQL calls.
- Idempotency keys must cover start, response, completion and card review operations at the right granularity. Reopening or retrying cannot duplicate a result or review event.

## Review scheduler contract to design before implementation

Use an injected clock and explicit local-date conversion for display and daily queues. The pure scheduler takes prior state, one Again/Hard/Good/Easy rating, scheduler version and now, and returns next state. Test first exposure, failure, overdue work, suspension/resumption, local midnight, time-zone change and clock rollback. Define a nonzero minimum interval and bounded maximum. Label this 'review scheduling', not measured mastery. If FSRS is later considered, require a separate dependency/licensing review, migration path, and equivalent behavior tests.

## Reviewable implementation stages

| Stage | Deliverable | Required gate |
| --- | --- | --- |
| M2-0 | User check-in record; validated scope; exact schemas/contracts and deletion/retention decision; representative synthetic fixtures | No migration before the check-in gate |
| M2-1 | Additive content-version/item migration and legacy conversion; atomic generation replacement; repository contract tests in Rust and browser adapter | Old study sets/tests readable; restart and v1/v2/v3 backup/restore; corrupt legacy cases surfaced honestly |
| M2-2 | Durable practice attempts and responses; Resume, Retake, 'I don't know', missed-question review in current material page | Interrupted session resumes; exactly-once completion; old version still scores against its own items; accessible keyboard flow |
| M2-3 | Card review events/state plus pure scheduler and due queue | Atomic event/projection writes, idempotent clicks, date/time-zone fixtures, suspension and flagged-card behavior |
| M2-4 | Library/Review due/History views and split lineage, with bounded queries | 100/2,500/5,000 materials and 10,000 review items benchmarked; accessible large lists; no global history load |
| M2-5 | Full offline, restore and platform acceptance | Test without key/network; backup integrity, deletion/replacement policy, Windows installed app and Mac tracker updated with honest evidence |

Each stage gets a small branch from updated main, focused failing tests first, local full matrix after corrections, independent Codex review, then one PR/CI run and merge if green. No new release tag in this plan.

## Cross-cutting acceptance and risk checks

- Start → answer → close → reopen → resume → finish; no lost responses or premature score.
- Retake creates a new attempt; regeneration keeps past attempts bound to the old version.
- 'I don't know' is distinct from unanswered and from an incorrect guess.
- Double clicks, retries, app interruption and SQLite contention produce no duplicate attempts, responses or review events; waits are bounded.
- Study previously saved content offline with no Gemini key. Gemini sends only an explicitly selected file; no automatic network call for review/history.
- Source deletion/replacement follows the user-approved retention policy; no dangling active session and no misleading link to a different PDF.
- Backup/export/restore preserves versions, responses, review history and lineage; a failed restore leaves existing valid data intact.
- Keep key/credentials out of study history, logs and archives. The existing transient webview key-entry limitation remains tracked at MAC-16.
- Mac-specific native behavior and performance stay UNVERIFIED until an installed Apple Silicon run. Update `docs/MAC_PARITY_CHECKLIST.md` at every stage.
- Measure render/query costs before optimizing; do not claim installed-app speed from jsdom or CI packaging.

## Work explicitly deferred

Official FAA exam scoring, pilot proficiency claims, AI feedback ingestion, voice coaching, OCR/embeddings, full-library uploads, replacement PDF viewer, and a second independent study system. These have separate roadmap gates or require observed demand.
