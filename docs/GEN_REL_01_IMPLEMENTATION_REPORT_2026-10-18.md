# GEN-REL-01 implementation report — 18 October 2026

**Status: implemented, pending independent review. Not accepted, not committed, not pushed, not merged.**

This covers GEN-REL-01 only: sending less by choosing a chapter or pages first, and reusable PDF preparation. It follows [the assignment](GENERATION_RELIABILITY_FIRST_IMPLEMENTER_PROMPT_2026-10-18.md) and [the plan](GENERATION_RELIABILITY_PLAN_2026-10-18.md), first read from `origin/codex/generation-reliability-roadmap-20261018` before PR #211 merged; they are identical on main at 45b4e2a.

GEN-REL-02 to 05 and the paused scheduler (PR #210) were not started. No provider was called, no real key was used, and no app was launched; no profile, signing, release, version change, migration or dependency was touched. **Live-provider and installed-Mac behaviour are UNVERIFIED.**

## Identity

| | |
| --- | --- |
| **Worktree** | `/Users/rickymac/code/Flight-training-gen-rel-01` (new, isolated) |
| **Branch** | `claude/gen-rel-01` |
| **Base** | Work began on origin/main **2e3f7fee6f84dd094c23ac0dfd7cd1053d2ccc4d**, the planning baseline, with a clean tree. While the work was in progress, another session fast-forwarded this branch's HEAD to current origin/main **45b4e2a09c0cd0ec3751ea689abea0f0855c2c60** (PR #211 merged). That changed only docs, trackers and the schema-14 completion manifest, no source (`git diff --stat 2e3f7fe 45b4e2a`). The uncommitted changes apply to 45b4e2a, and the gated source is byte-identical on either base. |
| **State** | every change is uncommitted in the working tree; nothing is staged |
| **Competing work** | none: no open PR or branch implements GEN-REL (open PRs were #211 docs, #210 paused, #164 docs) |
| **Primary clone** | untouched; its dirty `.claude/settings.json` was left as it was |

Changed and new paths, with SHA-256 values, are in [`source-hashes.txt`](evidence/gen-rel-01-2026-10-18/source-hashes.txt). Baseline hashes of the modified files at 2e3f7fe are in [`baseline-hashes.txt`](evidence/gen-rel-01-2026-10-18/baseline-hashes.txt).

## Provider contract, checked 18 October 2026

From Google's primary documentation ([Files API](https://ai.google.dev/api/files), [document processing](https://ai.google.dev/gemini-api/docs/document-processing), [file input methods](https://ai.google.dev/gemini-api/docs/file-input-methods), [generateContent](https://ai.google.dev/api/generate-content)):

- **Resumable upload.**
  - Start: `POST {base}/upload/v1beta/files` with headers `X-Goog-Upload-Protocol: resumable`, `X-Goog-Upload-Command: start`, `X-Goog-Upload-Header-Content-Length` and `X-Goog-Upload-Header-Content-Type`. The upload URL comes back in `X-Goog-Upload-URL`.
  - Send: post the bytes to that URL with `X-Goog-Upload-Offset: 0` and `X-Goog-Upload-Command: upload, finalize`.
  - The response is `{file:{name, uri, mimeType, state, expirationTime, …}}`, where `state` is `PROCESSING`, `ACTIVE` or `FAILED`.
- **Lookup and removal:** `files.get` is `GET {base}/v1beta/files/{id}`; `files.delete` is `DELETE` on the same path.
- **Reference:** `generateContent` accepts the uploaded file as a `{"file_data": {"mime_type", "file_uri"}}` part. Google's REST sample uses exactly this for an uploaded PDF.
- **Limits:**
  - Uploads are temporary and expire after **48 hours**.
  - PDFs are limited to 50 MB or 1,000 pages, whether inline or uploaded.
  - Inline requests are limited to 100 MB.
- **The newer Interactions-API examples in those pages were not adopted.** This client keeps its existing `generateContent` endpoint, models and HTTP stack.

## What changed

### Native (`src-tauri/src/`)

- **`gemini_files.rs` (new).** The Files API transport (`upload`, `lookup`, `delete`) plus a session-local `PreparedSources` cache:
  - **Key:** a reused copy must match the SHA-256 of the key (never the key itself), the endpoint, the SHA-256 of the selected source's bytes as read now, the MIME type, and the scope (the selected managed source's stored path). A file name, size or modification time alone never matches.
  - **Bounds:** at most **16** ready entries; the least recently used is evicted and its upload deleted. Upload size stays under the existing 50 MB / 1,000-page checks. Processing checks are limited to 12 (1 s doubling to a 5 s cap). Each delete times out after 10 s, and reuse stops 15 minutes before expiry. When Google reports no expiry, the copy is treated as lasting 46 hours.
  - **Readiness:** a cached copy is reused only after `files.get` reports it `ACTIVE`; a cached URI alone is never trusted. `PROCESSING` waits within the bounds above. `FAILED`, missing (403/404) or expired copies are forgotten, and exactly one fresh preparation follows. A lookup failure (5xx or transport) is reported and never retried as an upload.
  - **Coalescing:** a second request for the same key waits for the first preparation's shared result. No lock is held across a network wait.
  - **Epochs:** `invalidate_all()` starts a new epoch on disconnect or a key change. Late completions from the old epoch are never published; they and their waiters get `STALE_CONTEXT`, and their upload is deleted with the key that made it. A dropped preparation releases its waiters and its key (`FlightGuard`).
  - **Validation:** a file resource must have a `files/[a-z0-9-]{1,64}` name, a `uri` exactly equal to `{base}/v1beta/{name}`, the expected MIME type and a valid RFC 3339 expiry. The upload URL must stay under `{base}/upload/v1beta/files`. Nothing else is ever fetched.
  - **Cleanup:** only files this cache created are deleted, by name and with the key that created them. Nothing is listed or enumerated.
  - **Privacy:** upload metadata uses the neutral display name `her-flight-deck-study-source`. Transport errors are reworded without the URL (an upload URL carries a session id). Messages never include the key, file names, `files/…` locators or local paths.
- **`gemini.rs`:**
  - Generation runs through a window-free `GenContext` (HTTP client, endpoint, key, model choice, cache, progress callback), so tests drive the real request code against a loopback server.
  - `study_aid_with` and `practice_test_with` hold the unchanged prompts and schemas, and `run_generation` sends a PDF as a `file_data` reference. **No PDF is embedded inline any more, and nothing falls back to inline.**
  - If a refused request referred to a prepared copy, the copy is looked up. If it is gone or not ready, it is re-prepared once and the request made once more. If it is healthy, the refusal stands, so a retired model still reads as a retired model rather than as a missing upload.
  - Text and images stay inline, now also held to the encoded request limit (base64 plus a 256 KiB allowance must fit within 100 MB). Main checked only the raw size.
  - `configure_gemini` and `disconnect_gemini` end the prepared context and retire the previous key's uploads, bounded and best effort.
  - Retries and fallback, refusal wording, validation and practice-test sanitising are unchanged.
- **`fake_gemini.rs` (new, test only):** a std-thread loopback HTTP/1.1 stand-in that records every request and can hold, drop or fail on cue.
- **`pdf.rs`:** the test-only `write_page_range` is now `pub(crate)`, so split children can be built in tests.
- **`lib.rs`:** registers the new modules.

### Interface

- **`ConfirmDialog`** takes an optional secondary action and is otherwise unchanged.
- **The study-guide and practice-test "Send this file to Google?" confirmations:**
  - For a PDF that can be split, they offer **Choose a chapter or pages first**. This closes the confirmation and opens the existing manual split dialog ("Take out a chapter"), and nothing is sent. The new part is a managed child with existing lineage, generated only after its own **Send to Gemini**.
  - Sending the whole document stays available, still within the existing limits.
- **`geminiSendDisclosure`** (`logic/aiSafety.ts`) adds exactly what leaves the Mac:
  - For a PDF: only this file (and, for a split part, "pages X–Y of “Original”"), a temporary Google copy kept for up to 48 hours so a guide and a test can share it, deletion requested sooner when the file changes or Gemini is disconnected, and the Mac copy left unchanged.
  - For text or images: "sent with this request only".
- **Kept unchanged:** the shared generation lock, the request- and session-owned save guards, source freshness and validation. No auto-upload happens after a split.
- **README** describes the new transfer.

## Acceptance map

| Plan row | Behaviour | Tests / receipts |
| --- | --- | --- |
| **Chapter selection** | Only the approved managed child is sent; the parent is unchanged; saved output goes to the child with its own page (not remapped again); cancelling the split or the confirmation sends nothing. | Native: `only_the_selected_split_part_is_sent_first_page_and_last_page` (first page, last page and a 10-page chapter; uploaded bytes equal the child's bytes exactly, page counts match, parent bytes untouched). UI: `a whole PDF can be narrowed…sends nothing`, `the practice-test confirmation offers the same choice`, `a part sends only that part, names its pages, and saves to the part`, `cancelling sends nothing`, `whole-document generation is still available`. Existing `SplitLineage.test.ts` lineage tests pass unchanged. |
| **Guide then test, same source** | One upload; both generations refer to the same prepared URI; no second full-file or base64 transfer; model provenance kept. | `a_guide_then_a_practice_test_upload_the_pdf_once_and_refer_to_it`, `a_large_pdf_is_uploaded_once_and_never_inlined` (byte counters; `assert_never_inline` scans every request body for the PDF's base64 and for `inline_data`). Measurements are below. |
| **Changed content, key or selected child** | No reuse across contexts; no stale publication. | `changed_bytes_at_the_same_path_and_size_are_prepared_again_and_the_old_copy_retired` (same path and size, different bytes), `a_different_selected_source_or_key_never_shares_a_prepared_copy`, `late_work_from_an_old_key_cannot_replace_the_new_keys_copy`, `a_preparation_that_finishes_after_disconnect_is_never_published_and_its_upload_is_retired`. |
| **Expired, failed or processing file** | No false readiness, unbounded poll or retry loop. | `a_processing_file_is_waited_for_boundedly_before_it_is_used`, `processing_that_never_finishes_stops_at_the_poll_bound_and_retires_the_upload`, `failed_processing_is_explained_without_generation_or_a_retry_loop`, `a_locally_expired_copy_is_not_reused_and_is_prepared_once_more` (fake clock), `a_copy_deleted_at_google_is_detected_before_reuse_and_prepared_once_more`, `a_copy_lost_during_generation_is_prepared_again_exactly_once`, `a_refusal_while_the_copy_is_healthy_stands_and_is_not_turned_into_a_reupload`. Late interface callbacks: the existing `MaterialDetailGemini.test.ts` lock and stale-navigation cases pass unchanged. |
| **Concurrent calls** | Same key coalesces; distinct sources and keys are isolated; the duplicate and stale guards remain. | `concurrent_preparations_of_the_same_source_coalesce_into_one_upload` (three callers, one upload, held by a gate), `distinct_sources_and_credentials_are_never_coalesced`, `an_abandoned_preparation_releases_its_waiters_and_the_key`. Existing duplicate-click tests pass. |
| **Failure / invalid output** | Saved guide, test and history stay intact; the source stays intact; errors are explained honestly. | UI: `a failed generation leaves the saved guide exactly as it was`. Native: `an_unusable_generation_answer_is_refused_and_the_valid_copy_stays_reusable`, `a_throttled_upload_is_explained_once_without_generation`, `an_interrupted_upload_is_explained_caches_nothing_and_the_next_try_uploads_again`, `malformed_upload_answers_are_refused_and_never_followed`, `a_lookup_failure_is_reported_without_uploading_again`. Existing validation and sanitising tests pass. |
| **Resource and privacy** | Existing format and page limits kept; encoded inline limit enforced; bounded cache and polls; no key, content, path or locator in messages or identity. | `text_and_images_still_go_inline_and_are_held_to_the_encoded_request_limit`, `messages_and_cache_identity_never_carry_the_key_locators_or_paths`, `credentials_are_kept_only_as_a_hash`, `provider_file_resources_are_held_to_the_documented_contract`, `timestamps_are_read_exactly`, `the_cache_holds_at_most_sixteen_and_retires_the_least_recently_used`, `a_pdf_is_held_to_googles_page_limit_as_well_as_its_size` (existing). |

## Measurements (synthetic, loopback; not provider speed or reliability)

From [`final/10-measurements.log`](evidence/gen-rel-01-2026-10-18/final/10-measurements.log):

| Case | PDF bytes | Bytes uploaded | Generation requests | Largest generation body | Main's inline base64 for the same two requests |
| --- | --- | --- | --- | --- | --- |
| Guide then test, small PDF | 3,466 | 3,466 (1 upload) | 2 (3,157 B in total) | — | 9,248 |
| Guide then test, 8 MB PDF | 8,405,146 | 8,405,146 (1 upload) | 2 | 1,624 B | 22,413,728 |
| Split first page / last page / pages 11–20 of a 30-page parent | parent 2,666 | 366 / 368 / 1,095 (child only) | 1 each | — | — |

The receipts' `legacy_two_inline_requests_bytes~` figure also adds the 256 KiB per-request allowance, so it is an upper bound. The table shows the exact base64 bytes.

All PDFs now use the upload path; no small-file inline threshold was kept, so no threshold needed justifying. This costs a small PDF one start request, one upload request and, on reuse, one lookup, in exchange for a single, uniform rule: a PDF never goes inline. There are no timing claims.

## Gate

Final sequential gate on the finished source: Node 22.23.3, npm 10.9.9, rustc 1.99.0, with `SDKROOT` scoped to the Command Line Tools MacOSX26.5 SDK for the cargo steps. Receipts are in [final/](evidence/gen-rel-01-2026-10-18/final/):

| Step | Result | Exit |
| --- | --- | --- |
| `npm run typecheck` | clean | 0 |
| `npm test` | 169 files passed, 4 skipped; 3,648 passed, 6 skipped | 0 |
| `npm run build` | built | 0 |
| `cargo test --locked` | 561 passed, 6 ignored | 0 |
| `cargo clippy --locked --all-targets -- -D warnings` | clean | 0 |
| `cargo fmt --check` | clean | 0 |
| `npm run test:cargo-lock` | in sync | 0 |
| `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | first run 25/26: `src-tauri/target` held an editor-created `flycheck0` directory (rust-analyzer diagnostics in this session); kept as [failed/08-…log](evidence/gen-rel-01-2026-10-18/failed/08-schema14-helper-with-editor-flycheck-target.log). After removing only that regenerable directory: 26/26 | 1, then 0 |
| Migrations, checksums, Cargo/npm manifests and locks vs 2e3f7fe | unchanged | 0 |
| Measurements (`cargo test gemini -- --nocapture`) | 67 passed | 0 |
| `git diff --check`, plus a trailing-whitespace scan of new untracked source and docs | clean | 0 |

The documentation was written after the gate; no source changed afterwards. The trackers were then edited and the current schema-14 completion manifest rebound to them, so the helper suite was run once more: 26/26, exit 0 ([final/13-…log](evidence/gen-rel-01-2026-10-18/final/13-schema14-helper-after-manifest-rebind.log)). `git diff --check` was clean again. The evidence folder's `SHA256SUMS` covers all 21 files, and a scan for the synthetic key, upload session ids and API-key prefixes found none.

## Pre-fix failures preserved

- [failed/ui-source-choice-before-fix.log](evidence/gen-rel-01-2026-10-18/failed/ui-source-choice-before-fix.log): the new interface regressions run against unchanged main code. **5 failed** (chapter choice in both dialogs, the storage disclosure, the part's page disclosure, text-only disclosure). **3 controls passed** (cancel, whole document, a failure keeps the saved guide). Exit 1.
- [failed/native-baseline-inline-pdf.txt](evidence/gen-rel-01-2026-10-18/failed/native-baseline-inline-pdf.txt): main had no endpoint seam, so no loopback test could run before the change. This static receipt shows two `inline_data` PDF embeddings, zero Files API references, and the raw-only inline limit.
- [failed/08-schema14-helper-with-editor-flycheck-target.log](evidence/gen-rel-01-2026-10-18/failed/08-schema14-helper-with-editor-flycheck-target.log): the environmental helper failure above.

## Open limits

- **Unverified:** behaviour against Google's real endpoint and models, actual upload latency, quotas, expiry timing, and installed-Mac / WKWebView behaviour.
- **Session-only cache:** quitting the app forgets the prepared copies. Their files are not deleted and expire on Google's side, and the Send text says so.
- **Disconnect and key replacement:** only uploads made with the key being removed are deleted. If the key cannot be read at that moment, the files expire instead.
- **Extra round trips:** reuse costs one `files.get`, and a small PDF now takes three requests instead of one.
- **Deletes add latency:** retiring replaced or evicted copies runs inline before preparation, each limited to 10 s.
- **Missing-file detection is inferred:** it relies on Google refusing with 400, 403 or 404 and on a follow-up lookup. The exact error Google returns for a deleted file in a generation request was not observed live.
- **No new upload retry:** an interrupted upload is explained and the next attempt starts a fresh upload; it is never called "resumed". Broader retry policy is GEN-REL-03.
- **Local file problems:** a missing or replaced local file goes through the existing `prepare_submission` path (missing-file message; new SHA-256 means new key). There is no new local-disk test because that path needs the Tauri app handle.
- **Network module boundary:** the existing reqwest boundary test lists modules that must not use reqwest. `gemini_files.rs` is part of the Gemini client and is not on that list.

## Review round 1 corrections (18 October 2026)

Codex review round 1 (`docs/evidence/gen-rel-01-2026-10-18/review-r1/codex-review-round1.md`, verdict RED) found five blocking issues. The coordinating Claude session corrected them on the same uncommitted tree. The gate receipts in `final/` predate these corrections; the corrected native receipts are in `review-r1/`. Frontend source is unchanged since `final/`.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R1: an ended epoch was not checked on cached reuse, waiter take-up or later steps | Each generation records `PreparedSources::epoch()` before it reads the key (`GenContext::epoch`). `claim` refuses an ended epoch, a cached copy is refused if its epoch ends during its check, `adopt` refuses a shared result from an ended epoch, and `run_generation` refuses before sending and after answering when the lease is no longer current | `r1_a_cached_copy_confirmed_after_disconnect_is_refused_not_returned`, `r1_a_shared_result_taken_up_after_disconnect_is_refused`, `r1_an_operation_begun_before_disconnect_never_uploads_after_it`, `r1_a_lease_from_an_ended_context_is_no_longer_current`, `r1_a_generation_begun_before_disconnect_is_refused_without_any_request` |
| R2: replacement or eviction could delete a copy still in use | `Lease` ownership. Replacement and eviction defer deleting a leased copy (`deferred`), which is deleted by `finish` after its last lease is released. Ending the context still retires at once and its leases stop being current. A waiter only takes up a copy that is still alive | `r2_replacing_content_defers_deleting_a_copy_still_in_use`, `r2_a_shared_copy_retired_before_it_is_taken_up_is_not_handed_out`, `r2_eviction_defers_deleting_a_copy_a_generation_still_uses` |
| R3: a duplicate-upload race between choosing a candidate and registering a flight | One critical section (`claim`) leases a ready copy, joins a running flight or takes ownership. Re-preparation after an unusable copy goes through the same `claim`; at most two looks, with no loop | `r3_choosing_a_copy_and_owning_an_upload_are_one_step`, `r3_concurrent_revalidations_of_a_lost_copy_upload_it_once` |
| R4: a failed check during processing turned into a fresh upload | `wait_until_active` returns `NotReady::{Unusable, Other}`. Only FAILED or missing (`Unusable`) permits one re-preparation; a lookup failure or the poll bound is reported without uploading | `r4_a_failed_check_while_a_cached_copy_is_processing_is_reported_without_uploading`, `r4_a_cached_copy_google_reports_failed_is_prepared_again_once` |
| R5: redirects bypassed the URL restrictions | The application client sets `redirect::Policy::none()`; a 3xx is reported as a refusal | `r5_redirects_are_never_followed_with_the_key_or_the_pdf` (also proves that reqwest's default policy would have followed it, carrying the key) |

Corrected native results: `cargo test --locked` 574 passed, 6 ignored (EXIT 0); the focused `gemini` run 80 passed; strict Clippy EXIT 0; fmt EXIT 0. The fake server gained only test controls (`lookup_gate`, `lookup_script`, `finalize_redirect`, `generate_redirect`, `set_state`). The pre-correction source was not kept separately, and the new tests use the corrected interfaces (`Lease`, `claim`, `adopt`), so they cannot be compiled against it: their failure before the correction is shown by the round-1 reproductions, not by a frozen failing run.

## Review round 2 corrections (18 October 2026)

Codex review round 2 (`docs/evidence/gen-rel-01-2026-10-18/review-r2/codex-review-round2.md`, verdict RED) confirmed that R2–R5 were fixed and that R1 was partly fixed, and found four new blocking issues. Corrected native receipts are in `review-r2/`. The first Clippy run there failed (`too_many_arguments` on `prepare_fresh`, after its allow attribute was lost in an edit). It is kept as `cargo-clippy-failed-too-many-arguments.log`, and the corrected run is `cargo-clippy.log`.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R6: cancellation between flight registration and the owner's guard stranded waiters | `claim` builds the `FlightGuard` in the same critical section that registers the flight (`Claim::Own(FlightGuard)`), so dropping the claim at any await releases the flight and its waiters | `r6_cancelling_during_cleanup_before_the_upload_releases_the_flight_and_its_waiters` |
| R7: fresh publication counted a lease before the lease object existed | The `Lease` is built inside the publishing critical section, before the eviction-cleanup await; cancellation drops it and releases the count | `r7_cancelling_during_eviction_cleanup_leaves_no_ownership_behind` |
| R8: epoch gaps after cleanup awaits and between retries | `prepare_fresh` rechecks the epoch before starting an upload and after its cleanup. `run_generation` checks `GenContext::current()` after `finish`'s cleanup await. `generate_with_retries_at` checks before every primary attempt and before the fallback | `r8_an_owner_whose_context_ends_during_cleanup_never_starts_its_upload`, `r8_a_fresh_copy_whose_context_ends_during_eviction_cleanup_is_refused`, `r8_a_result_is_refused_if_the_context_ends_during_the_final_cleanup`, `r8_a_retry_after_a_pause_is_not_sent_once_the_context_has_ended` |
| R9: unclassified refusals repeated Google's message text | `describe_refusal`'s default branch now uses fixed wording with only the status; `compact_error` is removed | `r9_an_unclassified_refusal_never_repeats_googles_message_text` (file name, URI, key, upload id, private path and a content marker) |

Corrected native results: `cargo test --locked` 581 passed, 6 ignored; the focused `gemini` run 87 passed; strict Clippy and fmt EXIT 0. The fake server gained `delete_gate` and `generate_gate`. Frontend source is unchanged since `final/`. As in round 1, these tests use the corrected interfaces, so their pre-correction failure is shown by the round-2 reproductions rather than a frozen run.

## Review round 3 corrections (18 October 2026)

Codex review round 3 (`docs/evidence/gen-rel-01-2026-10-18/review-r3/codex-review-round3.md`, verdict RED) confirmed that R1–R9 were fixed. It found one blocking issue and one non-blocking issue.

| Finding | Correction | Regression tests |
| --- | --- | --- |
| R10 (blocking): `lookup()` treated a 403 as a missing file, which led to a re-upload | Only a 404 is `Missing`. A 401 or 403 is `Other`, with fixed wording, so it never leads to an upload in cached reuse, processing polls or recovery after generation | `r10_a_permission_refusal_on_the_reuse_check_never_uploads_again`, `r10_a_permission_refusal_while_processing_never_uploads_again`, `r10_a_permission_refusal_after_a_refused_generation_never_uploads_again` |
| R11 (non-blocking): file names were validated more loosely than documented | `valid_name` enforces at most 40 characters, with no leading or trailing dash | `r11_file_names_follow_the_documented_pattern` |

Pre-fix proof: with the round-2 403 mapping temporarily restored, all three R10 tests fail (`review-r3/prefix-r10-failing.log`, EXIT 101). The fixed source was then restored byte for byte (`cmp` clean).

Complete corrected gate (`review-r3/01…10`), Node 22.23.3, with `SDKROOT` scoped to MacOSX26.5 for the cargo steps:

| Step | Result | Exit |
| --- | --- | --- |
| typecheck, build | clean | 0 |
| `npm test` | 3,648 passed, 6 skipped | 0 |
| `cargo test --locked` | 585 passed, 6 ignored | 0 |
| strict Clippy, fmt, cargo-lock | clean | 0 |
| schema-14 helper | 26/26 | 0 |
| `git diff --check`; migrations, checksums, manifests, locks and tauri.conf vs 2e3f7fe | clean; unchanged | 0 |

The only edit to an existing receipt was removing trailing whitespace from `review-r2/codex-review-round2.md` (one line), for diff hygiene.

## Round 4: GREEN, and integration (18 October 2026)

Codex review round 4 (`review-r3/codex-review-round4-green.md`) accepted the work: R1–R11 fixed, no blocking findings. The one non-blocking finding, R12, is carried into GEN-REL-03: the reuse expiry is not rechecked after a slow confirmation or on shared adoption. Under the owner's GEN-REL instruction, Claude integrates once exact-head CI is green. The trackers gained the acceptance entry, and the current schema-14 manifest was rebound to them. The helper suite was then run again (`review-r3/11-…log`, 26/26, EXIT 0).

## First CI run on PR #212: one frontend timing failure (preserved)

[CI run 39156104650](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/39156104650) on head d2187be failed `npm test` with 3,647 passed, 1 failed and 6 skipped. The failure was in `src/pages/StudyLibrary/navigation/DocumentPagesPanel.test.ts`, `adds, lists, opens and removes a bookmark bound to the checked content`: `findByText("This PDF has 50 pages.")` ran past its default 1,000 ms wait, and the test took 1,161 ms on the runner. The raw log is kept in `ci/ci-39156104650-failed.log`.

Classification, with evidence: a runner timing failure, not caused by this change.
- GEN-REL-01 does not change the navigation panel or its "Check pages" flow. Its `MaterialDetail.tsx` changes add only Send-dialog text and an optional dialog button.
- A controlled comparison against base main 45b4e2a, in a temporary detached worktree with the same `node_modules` and Node 22, ran the test 8 times on each tree with every CPU saturated: 0/8 failures on each. Five verbose timings were 158–160 ms on this branch and 155–159 ms on main.
- No recent failed CI run shows this test failing.

No retry, timeout increase or suppression was added. Integration still requires normal CI to pass on the exact final head.
