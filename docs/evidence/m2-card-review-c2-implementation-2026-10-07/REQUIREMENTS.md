# M2-4 / C2 requirement-to-test map

The files are:
- **pure**: `src/logic/cardLibrary.test.ts`
- **reader**: `src/data/cardLibraryReader.test.ts` (node:sqlite and sql.js)
- **parity**: `src/data/cardLibraryParity.test.ts` (node, sql.js, select fallback) and `src-tauri/src/card_library_tests.rs` (native)
- **controller**: `src/pages/StudyLibrary/deferredReviewRead.test.ts`
- **UI**: `src/pages/StudyLibrary/StudyLibraryReviews.test.ts` (real router, AppDataProvider, MaterialDetail, disposable SQLite)

| Requirement | Tests |
| --- | --- |
| Discover valid unmaterialized current cards; reads never write | reader `discovers current cards that were never reviewed, without writing anything`; native `shared_card_library_contract_native_outcomes` (DB file byte-identical afterwards) and `reads_refuse_before_readiness_and_never_open_for_writing`; UI history no-write assertion |
| Current-content version identity; never trust `is_active` | reader `evaluates the current content version only; A -> B -> A …`, `an earlier version is detected from the current saved cards, never from stored flags`; parity calls `history-material`, `due-all-*` (`m-regen`) |
| Accurate due/new filtering (C1 semantics) | pure `counts exact Again instants, the exclusive local boundary, and excludes paused or flagged cards`, `filters: mixed materials …`; reader `Again is due at its exact instant …`, `filters by status and topic …`; mutants E1, E2, N1 |
| Urgency ranking within bounded batches; deterministic ties | pure `ranks Again, then day, then new …`; UI `Review due ranks discovered materials …`; parity `due-all-first` |
| Complete context-owned cursor validation | pure `round-trip as canonical base64 …`, `validate the complete due shape …`, `validate the history shape …`; reader `a changed filter or clock refuses an old cursor before any SQL`; parity `due-stale-cursor`, `due-wrong-cursor-type`, `due-invalid-cursor`, `due-noncanonical-cursor`, `history-stale-cursor` |
| Lossless continuation (page-size changes, small batches) | reader `continuation is lossless and duplicate-free through page-size and batch changes`; parity `due-small-batch-*`, `due-all-*` |
| Leftover revalidation (deleted, emptied, ineligible) | reader `leftover candidates are revalidated …`; mutant R2 |
| Byte preflight before transfer; 8 MiB ceiling; issue with encoded inspection target | reader `an over-8 MiB set is never transferred …`; UI `blocked oversize content is shown with its Study link and never claims caught up …`; parity `history-enrichment-only` (oversize pending) |
| Conservative reservation; failed reservations stay spent; valid sets reconcile; single-set lane | reader `work reservations: …`; parity `due-tight-budget-*`, `due-single-set-lane`, `history-enrichment-only` (malformed/empty stay charged); mutant R1 |
| Shared history target/page accounting; deduplicated raw reads | reader `a target already on the page is read once; page and targets share one work budget …`; parity `history-combined`, `history-tight-budget`, `history-enrichment-budget` |
| Enrichment-only reads without event paging | reader `enrichment-only reads no events …`; controller `enrichment works after pagination ends, keeps event order and cursor …` |
| Filter-owned targets; invalid targets refused before SQL | reader `invalid targets are refused before any SQL`; parity `history-enrichment-filtered`, `history-too-many-targets`, `history-invalid-target` |
| Fair pending progress after pagination completes | controller `enrichment works after pagination ends …` (250-target batches, remainder kept); UI `pending provenance stays unknown until Check versions resolves it, after pagination has ended` |
| Unknown provenance stays unknown; per-event comparison; resolution clears blockers; oversize excluded from automatic retry | controller `patches only targets: …`; reader tight-budget pending assertions |
| Stable event IDs, order and cursor; filters before LIMIT | reader `event IDs, order and cursor stay stable across tied timestamps; filters apply before LIMIT` |
| Scheduler ownership; raw audit retained | pure `schedule validation …` (three cases); native `schedule_validation_owns_the_event_scheduler_version`; reader `an unsupported scheduler version keeps its raw audit text but no interval` |
| Synchronous operation locks; stale-result rejection; obsolete synchronous throws | controller `same-turn duplicate requests share one read …`, `an invalidated read can never publish …`, `an obsolete synchronous reader throw cannot clear a newer held operation`, `an obsolete enrichment failure cannot poison …`; mutant C1 |
| Exact failed-read Retry with immutable dispatch snapshot; invalidation clears it | controller `Retry repeats the failed read's immutable snapshot exactly …`, `the most recent live failure is the one retried, in either order …`; UI `a failed read shows Retry, which repeats exactly the same read-only request`; mutants C3 (killed), C2 (equivalent, see README) |
| Real StrictMode; navigation/unmount ownership | UI `StrictMode mounts settle into one list; leaving the tab makes a held read obsolete`; controller `dispose blocks late publication …` |
| Content drift invalidation | UI `regenerated content invalidates the loaded list and reads it again`; reader version-drift case |
| Caught up only when exhausted, empty and unblocked | controller `caught up only when traversal is exhausted with no rows and no blocked issues`; UI oversize and caught-up case |
| Page, enrichment-call and loaded-view progress kept apart | controller enrichment case (`lastEnrichmentSummary`, `pagesLoaded`); UI `the last version check read 1 card set` |
| Tabs, URL sync, compatible history navigation | UI `tabs follow the address, Back returns, and practice history keeps its own page` |
| Review due opens a focused C1 session (C2-D2) | UI `Review due ranks discovered materials and opens a focused C1 session for the chosen one` |
| Read-only history inspection | UI `lists ratings with earlier-version provenance and a read-only historical card view` |
| Binder indicators | UI `binder cards show due and new counts, and Caught up only once every material is checked` |
| Card ratings separate from practice scores (C2-D7) | UI asserts the disclaimer and the separate Practice test history link |
| Native/TypeScript identity (results, cursors, messages, routes) | parity, all 35 calls on four engines; native `every_native_message_is_the_typescript_allowlisted_message`, `inspection_targets_match_encode_uri_component`; Tauri adapter shape checks in `tauriDb.ts` |
| Offline: no provider or network | UI `afterEach` asserts no `fetch` and no Gemini calls |
| Shipped schema 12 unchanged; earlier evidence unchanged | gate step `11 preserved` |
