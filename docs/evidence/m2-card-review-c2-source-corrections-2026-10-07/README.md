# M2-4 / C2 source corrections C2SRC-R1/R2 (8 October 2026)

**State: C2SRC-R1/R2 corrected, pending independent re-review.** Not accepted. The changes are uncommitted and unpushed:
- Worktree: `/Users/rickymac/code/Flight-training-c2-implementation`
- Branch: `codex/m2-card-review-c2-implementation`
- Base and HEAD: `cc84964737067cfa5fa5ed20ddf125a74b10b003`
- Nothing staged

Assignment: `docs/M2_CARD_REVIEW_C2_SOURCE_CORRECTIONS_PROMPT_2026-10-07.md` and `docs/M2_CARD_REVIEW_C2_SOURCE_REVIEW_2026-10-07.md`, read from `origin/main` (`c7bf53f`, PR #121) with `git show`. Nothing was pulled into the dirty tree.

## Starting state

- **Submitted source:** all 30 files in the `files` object of the implementation pack's `source-hashes.json` matched before any edit.
- **Implementation evidence:** all 57 `SHA256SUMS` entries verified.
- **Competing changes:** none.
- **`origin/main` after PR #121:**
  - It adds the reviewer documents and pack, a byte-identical copy of the implementation pack (58 files checked), and a review section in `STATUS.md` / `PROJECT_HANDOFF.md`.
  - It changes no application source.
  - The local `STATUS.md` and `PROJECT_HANDOFF.md` are now `origin/main`'s text plus the two top entries, the implementation entry and this round's. A merge should only add those lines.
- **Dependencies:** borrowed by symlinking the planning clone's `node_modules`, whose `package-lock.json` is byte-identical. The link is removed before handoff.

## Frozen diagnostic

The reviewer's `C2SourceReviewDiagnostic.test.ts` (SHA-256 `53a91a43…646d5c`, the same as the `origin/main` copy) was copied verbatim into `src/pages/StudyLibrary/` and removed after the final run. It was never edited.

| Run | Result | Receipt |
| --- | --- | --- |
| Baseline, submitted source | 3 failed / 0 passed, exit 1, no unhandled errors. Same failing lines as the reviewer's receipt (152, 166, 186). | `receipts/frozen-baseline/` |
| Final source | **3 passed**, exit 0 | `receipts/frozen-final/` |

**A finding about the frozen R2 case.** At baseline it fails at line 186, a precondition, not at its reconciliation assertion (line 191). The dialog rendered the pending label as `{provenance}.`, and the trailing period is a second text node. Exact-text lookup therefore never matched, and the case never reached the stale-label check. The reviewer's own receipt fails at the same line, 186:27.

The dialog now shows provenance in the same `Badge` the list uses. With only that presentation change and the original copied-row state (scratch revert V2), the frozen case fails at **line 191**, the real reconciliation assertion. So the defect is real and the frozen case does catch it; the fix below is what makes it pass.

## Corrections

### C2SRC-R1: a published data revision

`AppDataContext.tsx` holds `data` and a monotonic `dataRevision` in one state value. Every publication increments the revision in the same update, so the two can never disagree.
- **When it advances:** a refresh advances it only when it is the latest started refresh, using the existing `refreshVersion` guard. Every completed `mutate` publishes through refresh.
- **Startup:** the startup load publishes only if no refresh has published yet. Previously a slow startup load could overwrite a newer refresh. This is the same rule that keeps obsolete loads from rolling data back.
- **Pending deletion:** `hidePending` is unchanged and is not a publication; the deletion's commit is.

`StudyLibrary.tsx` drops the metadata key (material id / updatedAt / topic / priority; set updatedAt and card count). It passes `dataRevision` to `StudyLibraryReviewDue`, `StudyLibraryHistory` and `BinderReviewStatus`.
- `useLibraryReviews.ts` puts the revision into the existing `useOwnedStream` key, so a change goes through the existing `invalidate()`: new generation, fresh clock, cleared failed read.
- No second controller and no new timers.
- Render work is O(1): no card payload is serialized or hashed.
- Reader budgets and native code are unchanged.

### C2SRC-R2: the history viewer follows its event

`StudyLibraryHistory.tsx` stores the selected event ID, not a copy of the row. It derives the shown row from the stream's current `rows`.
- **Version checks:** a finished check (`applyHistoryEnrichment`) appears in the open viewer.
- **Card text:** `front` / `back` / `rating` / `reviewedAt` come from the event and are never patched, so the question and answer stay exactly as reviewed.
- **Rows that leave:** if the row leaves the list (invalidation, a filter, deletion, Refresh), the viewer closes and an effect clears the ID. Neither a later page containing the same event nor an obsolete completion can reopen it.
- **Unchanged:** the `Dialog` component, focus behavior and read-only text. Provenance is now a `Badge` (see the finding above).

## Additional bounded reads

The revision changes with every publication, not only card or material changes.

**Effect while a C2 view is mounted:** a completed mutation or refresh makes the mounted stream start over and read its first page again. Only one tab panel is mounted at a time, so that is one stream:

| Tab | Stream | Re-read cost (C2-D9 budgets) |
| --- | --- | --- |
| Review due | due | ≤ 250 candidates / 2,500 cards / 2 MiB; 170 statements, about 40 ms in-process at 5,000 materials (implementation pack `measure/`) |
| History | history | 22 statements |
| Library | binder | due budget, page size 250 |

**When it doesn't happen:** mutations made on other pages don't cause reads, because the library is unmounted then and reads on mount anyway.

**Why it's acceptable:**
- Each read is bounded, read-only and owned. An obsolete one cannot publish (tested).
- Publications on the Study Library page are user actions: editing, importing, deleting or reviewing.
- The previous key already re-read on any material metadata change.
- The extra cost buys correctness for content that has the same count and timestamp, state-only reviews and restored data, which no metadata key can detect cheaply.

## Permanent tests (9 new)

Mapped in [REQUIREMENTS.md](REQUIREMENTS.md).

`StudyLibraryReviews.test.ts`, 7 new cases, real app through the production save paths:
- R1:
  - the same-count, same-timestamp replacement across Review due, History and the binder (promotes both frozen R1 cases)
  - the binder open during the replacement
  - a state-only review saved through `mutate`
  - a restore-like replacement on refresh
  - a held pre-publication read finishing after the new one starts
- R2:
  - the frozen pending → resolved flow (promoted, resolving to "Earlier version", with exact historical text)
  - the selected row disappearing while a check and the next page are both held

`src/state/appDataRevision.test.ts`, 2 new cases: the revision advances per publication, and an obsolete refresh finishing last changes neither data nor revision.

**Reverting each fix alone** (`run_reverts.py`, isolated scratch copy, files restored and SHA-checked; `receipts/reverts/`):

| Variant | Failed |
| --- | --- |
| V1, the original metadata key | 8: all 5 R1 UI cases, both frozen R1 cases, and the disappearing-row case |
| V2, the original copied row | 3: the frozen R2 case at line 191 and both R2 UI cases |
| V3, revision advances for obsolete loads | 1: the obsolete-refresh case |

## Final gate (sequential, `receipts/final/`)

Toolchain: Node 22.23.3, npm 10.9.9, rustc/cargo 1.99.0, Xcode 27.0 with the MacOSX27.0 SDK.

| Step | Result |
| --- | --- |
| Focused Vitest (8 C2/C1 files + `appDataRevision.test.ts`) | 109 passed / 1 skipped (the deliberate fixture regenerator), exit 0 |
| Focused native `card_` | 31 passed, exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 102 files (3 skipped); **2,808 passed / 5 skipped**, 0 failed, **no unhandled errors**, exit 0 |
| `npm run build` | exit 0 |
| `cargo test --locked --all-targets` | **420 passed / 6 ignored**, exit 0 |
| Clippy `-D warnings`, `cargo fmt --check`, `npm run test:cargo-lock` | exit 0 each. No Rust source changed this round, so Clippy finished from cache. |
| Whitespace hygiene (tracked diff + 39 new files) | 0 problems, exit 0 |
| Preservation | Migrations 0001–0012, the migration checksum registry, `migrations.ts` and schema version 12 are unchanged. All nine planning packs verify their own `SHA256SUMS`, and all 18 earlier C2 packs are byte-identical to base. The implementation pack's 57 manifest entries verify, and its 58 files are byte-identical to `origin/main`. Exit 0. |

The gate ran once, after the source settled. The frozen diagnostic copy was already removed, so `npm test` does not include it.

**Not rerun:** the planning-proof diagnostics, the native fixture regeneration and the measurements. No reader or native source changed.

## Changed paths in this round

Compared with the 30 submitted hashes: 7 changed and 23 identical. In addition, one tracked file changed and one test was added.

| Path | Change |
| --- | --- |
| `src/state/AppDataContext.tsx` (tracked, newly changed) | `dataRevision` published with each winning snapshot; startup cannot overwrite a newer refresh |
| `src/state/appDataRevision.test.ts` (new) | Revision tests |
| `src/pages/StudyLibrary/StudyLibrary.tsx` | Metadata key removed; `dataRevision` passed to Review due, History and the binder |
| `src/pages/StudyLibrary/useLibraryReviews.ts` | Stream keys use `dataRevision` |
| `src/pages/StudyLibrary/StudyLibraryReviewDue.tsx` | Prop renamed to `dataRevision` |
| `src/pages/StudyLibrary/StudyLibraryHistory.tsx` | Selection by event ID; derived row; close on disappearance; provenance badge in the viewer |
| `src/pages/StudyLibrary/StudyLibraryReviews.test.ts` | 7 permanent cases |
| `STATUS.md`, `docs/PROJECT_HANDOFF.md` | New top entry; text otherwise equals `origin/main` |
| `docs/evidence/m2-card-review-c2-source-corrections-2026-10-07/` | This pack |

## Limitations

- No installed app, desktop IPC end to end, WebKit, VoiceOver, signing or release work.
- The extra re-reads are bounded but not timed here (see the reads section).
- An undo-pending deletion is still listed by the readers until it commits. That is unchanged and outside this round.

## Manifests

- `source-hashes.json`: the 32 delivered source/document paths outside this directory (the 30 submitted plus the two new to this round), rooted at the repository. It is in the same `files` structure, with `changedThisRound` listed.
- `SHA256SUMS`: every file in this directory except itself, rooted here.
