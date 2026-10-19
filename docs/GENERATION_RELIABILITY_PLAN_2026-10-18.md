# Generation reliability: owner-prioritized delivery plan

## Approval, priority and ownership

On18 October2026 the owner approved the four discussed improvements, requested delivery **one at a time before other feature work**, and assigned implementation to Claude. Filenames and assignments remain model-neutral so another implementer can take over. This is approved implementation direction, not a claim that the features exist or have passed review.

Delivery order is **GEN-REL-01 → GEN-REL-02 → GEN-REL-03 → GEN-REL-04 → GEN-REL-05**. Each has its own reviewable package and independent acceptance before the next starts. Owner controls integration; no agent merge or auto-merge. The existing P54/Study Hub relative order resumes afterward. Pause P54-06/PR210 corrections and phase B while this priority runs; preserve its known P54BASE-R1 finding, fixtures and receipts. Do not start a competing scheduler or another retrieval engine.

**Additional owner request,18 October2026:** generate more flashcards. Queue **GEN-REL-05 after01–04**, before resuming the earlier feature queue. The owner requested a larger set, not a specific number; proposed implementation defaults are40 cards with20/40/60 choices, delivered in batches of up to10. These numbers are a recommendation, not a quotation of owner-approved counts. This does not enlarge Claude's active GEN-REL-01 assignment.

Current source baseline is main2e3f7fee6f84dd094c23ac0dfd7cd1053d2ccc4d. A friend reports slow/failed generation, but her app version, exact error and source size are still pending. Those details can refine diagnosis; their absence does not block the source-confirmed reliability work. Do not label every failure as her internet or Google's capacity.

## Confirmed source behavior

`src-tauri/src/gemini.rs` sends the complete selected file inline for both study-aid and practice-test requests. Requests use a300-second timeout, up to four primary HTTP attempts and one fallback; that is not one overall job deadline. Connection/timeout/body-read errors escape through `?`, outside the HTTP retry path. JSON is parsed after the whole response arrives. `MaterialDetail.tsx` persists results only after generation and rejects callbacks whose original page/material/file context is obsolete. These guards protect data and must not simply be removed to make background generation appear to work.

Saved content is local/offline; Gemini generation requires connectivity. Increasing one timeout, changing providers, or showing a longer spinner alone does not resolve these behaviors.

## GEN-REL-01 — Send less and reuse source preparation

**First implementation assignment; no other feature in this plan starts yet.**

### User behavior and implementation defaults

- Before sending a PDF, make **use this document** versus **choose a chapter/pages first** understandable and deliberate. Reuse `ManualSplitDialog`, `SplitPdfDialog`, `splitSave` and existing managed-child lineage. The first slice generates on the selected managed child, not an undocumented temporary page crop. Never auto-upload after splitting; retain explicit Send confirmation. Whole-document generation remains available within supported limits.
- Focus source reuse on PDFs first. Keep supported text/image behavior working; do not silently convert diagrams, tables or scans to incomplete text. Broader extraction/retrieval remains separately reviewed P54-02 work.
- Use Google's Files API for the reusable PDF path, then reference that same prepared file for guide/cards and practice-test requests. Reuse the existing native HTTP stack; no new SDK, dependency, provider or model change. Verify the current official contract before coding. The generation request must not also embed the same PDF bytes.
- Cache only native, session-local prepared-file metadata initially: no database migration, credential in SQLite, or cloud handle in backups. Bound cache size (default16 ready entries); bound upload bytes, processing polling and waits. A provider upload allowance does not raise PDF/page/model-context limits. If small-file inline routing is retained, justify its threshold with synthetic payload/latency measurements and show that the reusable PDF path meets the no-second-upload contract.
- Bind reuse to the exact selected managed source/content SHA-256, MIME/type, selected scope and credential/project context. A filename, length or mtime alone is insufficient. Coalesce concurrent preparation of the same key; do not hold a global lock through network waits. A change of key, disconnect, source content/selection, expiry or failed provider file state invalidates reuse. Late completion from an old credential/source context must not repopulate the new cache.
- Respect provider expiry/state; a cached URI alone does not establish readiness. Handle processing, failed/deleted/expired files and bounded re-preparation. Validate provider references against the expected provider contract, without introducing arbitrary URL fetching. Distinguish a missing uploaded file from a missing model.
- Explain temporary Google storage in the Send confirmation. The selected local original remains intact. Retire only files created by this operation/cache; never enumerate/delete unrelated project files. Cleanup is bounded/best effort, does not turn a successful generation into a failed save, and discloses provider expiry when immediate removal is unavailable. Never silently fall back to repeated whole-document transfers.

### Required acceptance and evidence

| Case | Required behavior |
| --- | --- |
| Chapter selection | Only the approved managed child is sent; unchanged parent, correct child↔original page lineage and correct source material for saved output. Cancelled split/confirmation sends nothing. |
| Guide then test, same valid source | One PDF upload; two generation requests use the prepared reference. Byte/request counters prove no second full-file or base64 transfer. Preserve outputs' model/source provenance. |
| Changed content / key / selected child | No reuse of the old context; no stale cache publication or result overwrite. Test same path/size with different bytes. |
| Expired/failed/processing file | No false-ready result, unbounded poll or retry loop; bounded clear recovery. Late callbacks cannot take a newer operation's lock. |
| Concurrent calls | Coalesce same-key preparation; isolate distinct sources/credentials; retain existing duplicate-generation and stale-context guards. |
| Failure / invalid output | Existing guide/test/history remains intact; source file remains intact; unsupported files, scans and lost responses are explained honestly. |
| Resource and privacy | Existing format/page limits retained; validate effective encoded request limits where inline remains; bounded reads/cache/polls; no raw key, source content, private path or cloud locator in logs/evidence/backups. |

Use synthetic local HTTP fixtures, controlled promises/clock and captured request bodies. Include small/large PDF, split first/last page, whole-document choice, throttled upload, interrupted upload, failed processing, expiry and HTTP/JSON failures. Record bytes, requests, timeouts and cache invalidation; mock timings are **not** live-provider speed or reliability claims. No automatic provider calls, private document uploads or user-key access during development. Real-provider and installed-Mac acceptance remain separately unverified until an authorized human run.

## GEN-REL-02 — Recoverable background jobs and safe checkpoints

Start only after GEN-REL-01 review/integration. Move operation ownership out of the material page's lifetime. Persist job ID, source/material/content identity, requested output, stage and operation/revision identity; design/review storage before allocating an additive migration or other durable format. Preserve native-authoritative write rules and backup compatibility; credentials/provider handles do not enter exported backups.

Jobs must remain observable while changing pages. A valid completed response can be checkpointed before final save so a storage retry does not call Gemini again. Save only validated complete units as clearly labelled drafts; half a JSON stream is not a completed guide. Existing content remains usable until deliberate valid replacement. Bind final writes to the original exact source/version and reject superseded/deleted/reset/replaced targets; do not weaken the current stale guards.

Model interrupted/unknown outcomes honestly. App restart or network loss does not prove Google stopped or support resuming an inference mid-token. Retain a recoverable job/draft; require deliberate resume where delivery/cost is uncertain. Never silently resend every interrupted job on startup. Preserve attempts and operation identity across recovery.

Tests: navigation A→B→A and unmount, source replacement/deletion, late callbacks, concurrent jobs, duplicate saves, failure before/after response checkpoint and during persistence, app-restart reconstruction, missing credentials, and retained previous content/history. Prove a completed checkpoint retries saving without another provider call. Do not claim production backup/restore from a mocked in-memory job map.

## GEN-REL-03 — Bounded recovery and actionable failure diagnosis

Start after GEN-REL-02 review/integration. Classify connection/DNS, upload, generation timeout, response-read failure, HTTP status/quota/authentication, blocked/incomplete output and local persistence separately. A transport interruption after submission has uncertain remote completion; retries must not promise exactly-once inference or zero additional provider cost. Existing acknowledged local writes remain idempotent.

Initial implementation defaults for review:15-second connect timeout; one300-second **active end-to-end budget** covering upload, provider-file readiness, generation, retries and fallback; at most three generation attempts total including fallback, each bounded by remaining time. No new full300 seconds per retry. Backoff/jitter and valid `Retry-After` must fit the same remaining budget. Persist consumed attempts/budget where resumable jobs require it; a retry/restart must not reset automatic limits. Explicitly paused offline jobs make no requests and require clear resume behavior.

Retry only justified transient failures; distinguish temporary429 from persistent quota/billing exhaustion. Do not loop invalid key/permission/format/model errors. Check actual model support for the installed version without treating every404 as model retirement. Upload recovery uses a provider-confirmed resume protocol if supported; never call a fresh upload “resumed.” Local-save retry reuses the saved validated response. If measured evidence justifies different defaults, document/review the adjustment before final gate rather than silently changing policy.

Tests: deterministic offline/drop/slow-body, failures before/after request submission,400/401/403/404/408/429/500/502/503/504, quota versus capacity, `Retry-After` outside budget, exhausted budget, fallback, clock changes, restart and save-only retry. Sanitize diagnostics: stage, anonymous operation ID, durations, payload counts/status/error category only; no key, document text, source path or unredacted provider body. Distinguish cancelled/failed/unknown/completed.

## GEN-REL-04 — Honest progress, cancellation and useful retry

Start after GEN-REL-03 review/integration. Show actual stages: preparing source, sending/reusing source, waiting for Gemini, validating, saving, complete; include offline/retry-wait/error states. Scope all progress and errors by job and source identity. No fake generation percentages. Show byte progress only when it measures a defined transport/provider acknowledgement; do not label locally queued bytes as server-confirmed.

Provide Cancel and stage-appropriate Retry/Resume. Cancellation stops remaining local work, marks the job durably and suppresses obsolete publication; it cannot promise an already submitted remote request was unprocessed/unbilled. Resolve completion-versus-cancel atomically: never show cancelled while a late unowned save replaces content. Preserve useful completed checkpoints and existing study content. A streaming preview is optional, visibly a draft, and cannot bypass final validation.

Tests: accessible keyboard controls and live status, stale/multi-job events, navigation/restart, cancel during each wait/upload/generation/validation/save boundary, completion racing cancellation, no post-cancel writes or new calls, retry only the failed safe stage, and no spinner with no recoverable action. Browser/source UI tests do not prove installed WKWebView behavior.

## GEN-REL-05 — Larger, source-grounded flashcard sets

**Release scope decision, 18 October 2026:** the owner requested “lets get 5 shipped too”. Complete and independently review 05 after 04, and include all five generation improvements in the same next patch release. This supersedes the suggestion to defer 05 to a later release. Build/installed verification and normal release gates still follow; no completed/released feature, numerical-count approval or new budget is inferred from this scope decision.

Start after GEN-REL-01–04 review/integration. The current combined study-aid prompt asks for10–20 flashcards with an8,192-token output cap. Add a clear target-card-count choice for new generation and deliberate regeneration: proposed default40, options20/40/60. Treat the count as a target/maximum, not a promise that a short source supports that many distinct facts. Explain when fewer grounded cards are available; do not pad with duplicates, unsupported facts or artificial paraphrases. Keep practice-test question count unchanged.

Reuse the prepared selected source from01 and checkpointed jobs from02. Generate card batches of up to10 with bounded requests/output; do not simply ask for60 inside the existing guide-plus-cards JSON response and hope it fits. Preserve source material/content/page identity on every batch. Detect exact normalized question/answer duplicates across batches; source citations and de-duplication alone do not establish factual correctness. Retain quality/disclaimer and unsupported-source behavior.

Checkpoint validated batches as drafts. Publish only the deliberately accepted completed set through the existing reviewed version/replacement contract; failures must not replace the previous guide/cards or damage review history. No automatic incremental append into a live set, card reordering or reassignment of existing progress. Appending more cards to an existing set is separate scope if desired later; it needs explicit identity/history design rather than assuming that changing the ordered card list preserves IDs.

Distinguish planned batch calls from retries and declare a finite whole-job request cap before implementation. Keep GEN-REL-03's shared active-time budget and bounded automatic recovery; never reset the job budget just because another batch starts. Any necessary policy refinement must be explicit, reviewed and tested. Budget exhaustion leaves an honest recoverable draft, not a silently extended spinner or a falsely complete set. Show completed/target counts and allow the already-reviewed cancellation/resume behavior; interrupted or repeated batches cannot be committed twice.

Tests: targets20/40/60, invalid counts, short/empty sources, duplicate/repeated responses, source changes between batches, missing/bad page references, malformed/truncated output, token/byte limits, shared budget and retry exhaustion, cancellation/restart/resume, final-save failure and preserved prior content/history. Measure captured source-upload bytes and bounded request counts on synthetic inputs. Live-provider output quality and duration remain unverified until a separate authorized test. This is a follow-on count-generation feature, not permission to start it alongside GEN-REL-01.

## Shared completion and handoff

Implement **one GEN-REL item per independently reviewed package**. Preserve source/credential/privacy/history guards, all old evidence, frozen helpers and shipped migrations. No release/version change, provider switch or new dependency is implied. Focused regressions during implementation; one final appropriate frontend/native gate after final changes; reuse unchanged-source receipts and require exact-head CI for integration. Failed runs remain separate from corrected final receipts. Leave a report, complete source/evidence manifests and one precise reviewer prompt. Stop after submission; the owner decides merge and the next item.

Authoritative provider references checked18 October2026: [file input methods](https://ai.google.dev/gemini-api/docs/file-input-methods) describes reusable uploads and temporary48-hour retention; [troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) describes transient-error retry/backoff. Verify the exact REST endpoint/model contract before implementation; none of this planning authorizes a live call using an owner key.
