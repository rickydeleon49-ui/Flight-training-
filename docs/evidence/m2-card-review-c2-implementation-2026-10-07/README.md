# M2-4 / Card Reviews C2 — production implementation evidence (7 October 2026)

**State: implemented, pending independent source review.** Uncommitted and unpushed on branch `codex/m2-card-review-c2-implementation` in the isolated worktree `/Users/rickymac/code/Flight-training-c2-implementation`, base and HEAD `cc84964737067cfa5fa5ed20ddf125a74b10b003` (PR #120). Nothing is staged.

## Activation

- No trusted approval record existed on `origin/main`, so the implementer stopped and presented the nine defaults. The owner replied **"I approve C2-D1 through C2-D9"**. This was recorded in [OWNER_APPROVAL.md](OWNER_APPROVAL.md) before any code.
- No competing C2 implementation existed on any remote branch or worktree. The dirty planning clone `/Users/rickymac/code/Flight-training-pr70-integration` (`codex/m2-card-review-c2-scope`, `9028675`) was not pulled, reset, stashed, switched or written. Its `node_modules` was only *linked* from this worktree, because the lockfiles are byte-identical, so nothing was installed. The link is removed at the end and is not part of the delivery.
- Assignment: [start prompt](../../M2_CARD_REVIEW_C2_IMPLEMENTATION_START_PROMPT_2026-10-07.md), [implementation prompt](../../M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md), [scope](../../M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md), [acceptance](../../M2_CARD_REVIEW_C2_ACCEPTANCE_2026-10-07.md).

## What was built

| Area | Files |
| --- | --- |
| Pure rules | `src/logic/cardLibrary.ts` (new):<ul><li>limits from C2-D9, the encoded `getStudyInspectionTarget` and fixed error messages</li><li>strict canonical-base64 cursors with complete, context-owned due and history validation (exact keys)</li><li>`validateScheduleState` owned by the event's scheduler version</li><li>due/new counting identical to the C1 queue, and urgency ranking</li></ul>It reuses `cardIdentity`, `cardScheduler` and `localDay` without duplicating them. |
| Browser/test reader | `src/data/cardLibraryReader.ts` (new): the accepted proof pipeline.<ul><li>keyset candidate scan</li><li>byte preflight before any transfer</li><li>a shared admission ledger: 500-card reservation before each raw read, failed parses stay charged, valid sets reconcile, single-set lane, 8 MiB ceiling</li><li>batched state reads, filters before ranking</li><li>leftover-candidate revalidation</li><li>history keyset with filters before `LIMIT`</li><li>filter-owned, deduplicated, bounded target enrichment and enrichment-only mode</li></ul>It reads every derived current version, including never-reviewed (unmaterialized) cards, and never trusts `is_active`. |
| Native reader | `src-tauri/src/card_library.rs` (new) and `card_library_tests.rs`. Commands `get_library_review_due` and `get_library_recent_reviews` are registered in `lib.rs`. They open the database read-only, wait for readiness, and run each page in one deferred transaction (a consistent snapshot, then rolled back). The pipeline, results and cursors are identical to the TypeScript reader. |
| Drivers and service | <ul><li>`db.ts`: optional `readLibraryReviewDue` / `readLibraryRecentReviews`</li><li>`sqlJsDb.ts` / `testing/nodeSqliteDb.ts`: owned reads on the one connection</li><li>`tauriDb.ts`: native invoke with allowlisted code+message pairs and result-shape checks</li><li>new `repositories/cardLibraryRepository.ts`, registered as `cardLibrary`, with a fallback over `select`</li></ul> |
| Controller | `src/pages/StudyLibrary/deferredReviewRead.ts` (new):<ul><li>a synchronous operation lock with a unique token per generation</li><li>a single discriminated failed-read descriptor holding an immutable dispatch snapshot; Retry repeats exactly that snapshot</li><li>authoritative invalidation</li><li>history enrichment patches and fair batches of at most 250 pending targets, callable after pagination ends</li><li>separate latest-page and latest-enrichment summaries plus loaded-view counts</li></ul> |
| React ownership | `useLibraryReviews.ts` (new): the first page loads on mount (StrictMode-safe), and unmounting disposes the stream. Filter, content or local-midnight changes invalidate with a freshly captured clock. |
| UI | `StudyLibrary.tsx`:<ul><li>Library / Review due / History tabs kept in the `?tab=` address, with Back working</li><li>binder indicators ("2 due · 3 new", "Caught up" only once everything has been checked)</li></ul>New `StudyLibraryReviewDue.tsx` (status and topic filters, urgency list, issues linking to `/study/<encoded id>`, Load more / Keep looking, Retry or Start over, page-local progress) and `StudyLibraryHistory.tsx` (material and topic filters, rating and provenance badges, Check versions, Load more, and a read-only historical card dialog). The C1 panel gets `autoStart` and `MaterialDetail` passes it, so Review due opens a focused session for that one material (C1 caps unchanged). `studyLibrary.css`. |
| Fixture | `src-tauri/fixtures/card-library/cases.json` (new): a C1-built synthetic library dumped to SQL plus one set over 8 MiB, and 35 calls (chained cursors and refusals). Expected results come from the TypeScript reader, and the native reader must equal them. |

Existing-file test edits: `StudyLibrary.test.ts` adds `aiStudySets: []` to its hand-built app-data mock, a field the real `AppData` always has.

## Deliberate decisions (disclosed)

1. **`/study/history` stays the practice-test history page.** It already serves practice history, and the Library header links to it. Redirecting it would remove practice history or mix the two, against C2-D7. Card history lives at `/study?tab=history`, and each page links to the other. Old links and Back keep working.
2. **Due/new counting follows the C1 queue exactly.** The accepted proof model counted a flagged card as due and treated a never-rated card whose row only came from suspend/resume as not new. Production uses the C1 rules instead:
   - suspended or flagged cards are neither due nor new
   - a card with no row, or a never-rated row, is new
   - Again cards are due at their exact instant
   - day cards are due before the exclusive local midnight
3. **Ties sort by code unit, not locale,** so the TypeScript and native readers order identically.
4. **The cursor `lu` field is bounded stored text (1–64 characters), not a canonical instant.** It must equal `study_materials.updated_at` exactly, and older rows may not store the 24-character form. A canonical-only check could stall pagination for good.
5. **History defaults to the C2-D9 card-work budget of 2,500.** The prompt's type comment said 500, but the approved C2-D9 says 2,500; with 500, a 20-event page could resolve only one material per call.
6. **Enrichment records always carry `reason` and `inspectionTarget`** (nullable), and the history summary adds `eventsReturned`, so both readers produce identical JSON. Summary field names are the executed `rawReads` / `rawBytesTransferred`.
7. **Retry under invalidation.** Retry repeats the captured snapshot. Invalidation clears the failed read, so a pre-invalidation snapshot can never be replayed into a new filter, clock or content state.

## Results (actual)

Toolchain: Node 22.23.3, npm 10.9.9, rustc/cargo 1.99.0, Xcode 27.0 (27A266a) with `SDKROOT` = Xcode `MacOSX27.0.sdk`, macOS arm64, cwd = the worktree.

**Sequential gate, attempt 2 — all green, the final source state** (`receipts/attempt2/`). Attempt 1 (`receipts/attempt1/`) was also green: 2,796 passed / 5 skipped, 420 Rust passed. It was superseded only because the desktop-adapter test `src/data/cardLibraryTauri.test.ts` was added after it.

| Step | Result |
| --- | --- |
| Focused Vitest (8 C2/C1 UI files) | 100 passed / 1 skipped (the deliberate fixture regenerator), exit 0 |
| Focused native (`card_`) | 31 passed, exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 101 files; **2,799 passed / 5 skipped**, 0 failed, **0 unhandled errors**, exit 0 |
| `npm run build` | exit 0 |
| `cargo test --locked --all-targets` | **420 passed / 6 ignored**, exit 0 |
| Clippy `-D warnings`, `cargo fmt --check`, `npm run test:cargo-lock` | exit 0 each |
| Whitespace hygiene (tracked diff + every new file) | 0 problems, exit 0 |
| Preservation | Migrations 0001–0012, the registry and schema version 12 are unchanged. All nine planning packs verify against their own `SHA256SUMS` (eight pack-rooted, scope-corrections repository-rooted). All 18 earlier C2 packs are byte-identical to base. Exit 0. |

New tests:
- frontend: 70 cases (pure 11, adapter 3, reader 32, parity 4 plus the skipped regenerator, controller 10, UI 9) and one corrected mock
- native: 5 (`card_library_tests.rs`)

Before the gate, Clippy flagged `Option::is_none_or` as newer than the crate's MSRV of 1.77.2; it was replaced with explicit matches. No gate attempt failed. The mutation runs below came after attempt 1 and before attempt 2, and restored every file byte-for-byte.

**Sensitivity** (`run_mutations.py`, `mutation-results.json`, `receipts/mutations/`). Each file was restored byte-for-byte and SHA-256-checked.

| ID | Reintroduced defect | Outcome |
| --- | --- | --- |
| E1 | Paused/flagged cards counted | Killed (C1-semantics assertions) |
| E2 | Again judged by the end-of-day bound | Killed |
| R1 | Failed parse refunds its reservation | Killed |
| R2 | Leftovers re-shown without revalidation | Killed |
| C1 | Ownership ignores the generation | Killed |
| C3 | Retry does nothing | Killed (no repeated read) |
| N1 | Native reader counts paused/flagged | Killed (native fixture) |
| C2 | Retry uses live state instead of the snapshot | **Survives, equivalent mutant.** In this design a failed read's snapshot can only differ from live state after an invalidation or a success, and both clear the failure first. |

Run 1 is preserved in `receipts/mutations-run1/`. Its R2 variant was caught only by a crash, not an assertion, and was replaced.

**Production statement counts and timings** (`measure/`, run once, node:sqlite in-process, synthetic 5,000 materials × 12 cards and 10,000 events, median of 7):

| Call | Statements | Median |
| --- | --- | --- |
| Due first page | 170 | 39.6 ms |
| Due continuation | 150 | 14.2 ms |
| `due_today` | 170 | 39.7 ms |
| Weather topic | 170 | 37.9 ms |
| History first page | 22 | 14.3 ms |
| History next page | 22 | 15.8 ms |
| History topic filter | 22 | 7.5 ms |
| History enrichment-only (2 targets) | 4 | 0.5 ms |
| History page + 2 targets | 25 | 14.9 ms |

A full due traversal took 120 pages, 15,590 statements and 2.13 s.

The accepted proof's fixture receipts were 175/150/177, 22/22/22, 3 and 24 statements. Counts are the same order. In-process time is higher than the proof's 6.07 ms because production hashes asynchronously (Web Crypto) and every read goes through the connection owner. The native reader's timing, desktop IPC and WebKit rendering are **not measured**.

**Visual check** (browser mode, scratch Vite config only to serve the linked `node_modules`, synthetic database): the binder indicators, Review due, a focused session started from Review due, History and the historical card dialog rendered at 1,280 and 390 px with no page errors.

**Not rerun:** the eight accepted reviewer diagnostics (84/84) and the 71-case proof suite. They test the unchanged proof model, there was no new reason to rerun them, and their packs verify unchanged.

[Requirement-to-test map](REQUIREMENTS.md).

## Limitations

- No installed app, VoiceOver, Gatekeeper, signing or release work. The desktop IPC path is covered by adapter tests with injected `invoke`, plus native reader tests, but was never run end to end in a launched app.
- Binder indicators show only what the binder's own bounded stream has checked ("Check more" continues); unchecked materials show no label rather than a guess.
- The midnight timer and content-key invalidation run while the Study Library is mounted. Card writes in a material page remount the library on return.

## Manifests

- `source-hashes.json`: every changed or new delivery file outside this directory, **rooted at the repository**.
- `SHA256SUMS`: every file in this directory except itself, **rooted here**.
