# OFFLINE-01a: native extraction worker and content cache

**Status: implemented; round-1 review corrections applied; pending re-review.** Claude implemented it; Codex reviews. Base: main `8d3ebfc`. This follows the accepted [proposal](OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md) (revision 5). Evidence is in [`evidence/offline-01a-2026-10-19/`](evidence/offline-01a-2026-10-19/).

**One owner-approved dependency change:** `flate2`, at the same locked 1.1.10, is now a direct dependency for strict content decoding (round 1, finding 1). `Cargo.lock` gains one line in the app's own dependency list; no package is added or changed. There is no change to migrations, the frontend or the backup format. The two new commands are registered but not yet called by the UI (that is 01b). Nothing calls a provider.

## What was built (`src-tauri/src/extraction/`)

| Part | File | What it does |
| --- | --- | --- |
| Allocator | `alloc.rs` | A counting global allocator for the whole binary (§4.2). It counts the **requested** bytes of live allocations from process start: `alloc`, `alloc_zeroed`, growth reserved before `realloc` and rolled back on failure, shrinkage credited after success, `dealloc`. Reservations use a compare-and-swap loop with checked arithmetic. **App mode stops counting** once the process knows it is the app; after that there is no cap and no shared counter. Worker mode keeps counting and sets a cap before reading input. A breach sets a sticky flag and writes a static marker once with a raw `write` (Unix only; elsewhere the breach shows as `worker_failed`). |
| Worker | `worker.rs`, `main.rs` | Selected **only** by exactly `[exe, "--hfd-extract-worker"]`, checked before Tauri starts. Any other use of the flag exits 64 without output. It reads one request (at most 4 KiB, unknown fields refused), with compiled-in maximums a request can lower but never raise. It runs on one thread with a fixed 8 MiB stack, verifies the file's SHA-256, refuses encrypted files, and writes NDJSON frames, checking the breach flag before every frame. Fault-injection hooks exist only in debug builds. |
| Inspection | `inspect.rs` | Per-page outcomes (§4.4): `text`, `blank`, `image_only`, `text_unreadable`, `unknown`, `failed`. Content is decoded **strictly**, and Form XObjects are followed recursively (at most 8 levels, with cycle detection). `blank` and `image_only` require a complete inspection. |
| Supervisor | `supervisor.rs` | Spawns the worker with an empty environment and drains stdout (512 KiB frame, 32 MiB stream) and stderr (4 KiB kept) concurrently until end of file. It enforces the deadline and cancellation, validates the frame sequence and classifies only after exit plus end of file on both pipes. `memory_limit` is reported only when the marker arrived; any other abnormal end is `worker_failed`. |
| Cache | `cache.rs` | `content-cache.db`, keyed by content SHA-256 and extractor version. Each publish is atomic. A missing, foreign-schema, incomplete or corrupt cache is deleted and rebuilt. Only deterministic whole-file failures are stored. Pruning is bounded. The file is outside the backup archive by design. |
| Service and commands | `service.rs` | Readiness is never stored. It comes from the file's hash, which counts as verified only once hashed **in this session**, by streaming so large files stay out of memory. Preparation **re-hashes before deciding**, runs one worker at a time, and publishes only under the hash the worker read. Two commands: `offline_content_readiness(materialIds)` and `prepare_offline_content(materialId)`. |

## Tests: 753 native passed, 0 failed, 7 ignored (was 686)

- **Unit tests, 28 new:**
  - **Allocator:** accounting, cap and sticky breach, `realloc` rules, failed system allocations, overflow, a cap below live bytes, concurrency, and app mode stopping counting without underflow. A worker that has a cap cannot stop counting.
  - **Inspection:** text, blank, image XObject, inline image, image on the page with text in a form, a missing XObject, a cyclic form, forms past and within the depth limit, malformed content, and a text operator with no usable font.
  - **Worker:** argument dispatch and the request schema.
  - **Cache:** round trip and reopen, republish, disposal (incomplete, foreign schema, garbage file), bounded prune.
  - **Service:** §4.4 summaries with neutral wording, and a check that no extraction source reaches Gemini, the key or the network.
- **`tests/extraction_worker.rs`, 13 tests, using the real binary as the worker:**
  - pages in order;
  - identity mismatch;
  - a non-PDF and oversized input;
  - the page text limit;
  - a **content-stream bomb** (96 MiB decoded from under 1 MB) and an **object-stream bomb decoded while loading**, both stopped as `memory_limit`;
  - an aborting breach, a **fallible `try_reserve` breach** and a breach at startup, all `memory_limit` with no success;
  - a **stack overflow**, classified `worker_failed`;
  - the deadline and cancellation;
  - the flag with extra arguments;
  - an empty, oversized or unknown request.
- **`tests/extraction_service.rs`, 7 tests:**
  - a new session shows `checking`, then reuses the cache;
  - **rollback to older bytes and forward again**;
  - a **database-only restore**;
  - a **late worker**;
  - **the same stamp with different bytes**, both across sessions and at action time;
  - moved, missing, unsafe-path and non-PDF files;
  - a file that can't be processed.

## Failures kept and fixes made

- **A real defect, found by the tests:** `prepare` checked readiness before re-hashing. In an older session, after an in-place rewrite that kept the stamp, it reported `Searchable` and extracted nothing. It now re-hashes first. The failing run before the fix is kept: `receipts/prepare-rehash-before-fix.log`, exit 101.
- **A failed measurement gate, which changed the design:** with counting always on, the shared counter was **about 60–320× slower across three runs** for an allocation-heavy loop on 4–8 threads (`receipts/app-mode-overhead-counting-always.txt`, `-intermediate.txt`). App mode now stops counting, as the proposal allowed; see the numbers below.
- **Test-fixture failures (not product defects; output shown in the session and not kept as raw logs):** the first object-stream fixture was never referenced by a cross-reference stream, so `lopdf` correctly never decoded it and extraction succeeded. The second was written uncompressed, because `lopdf`'s save options default to compression level 0. The final fixture sets level 6 and is proven to load uncapped and to be stopped by the cap.
- **Build and lint:** `fetch_update` is deprecated on this compiler while its replacement is newer than MSRV 1.77.2, so it was replaced with a compare-and-swap loop. The `write` declaration now takes `c_void`. One clippy `redundant_closure` is fixed; its failing receipt is `receipts/clippy-first.log`.

## Measurements (release build, Apple M5; observations, not bounds)

Worker binary SHA-256: `e6b8a93ef19b82305648c7ff0c0519889cb9156fc6be0503560430298b5f2f43` (`receipts/release-worker.sha256`). Default cap: 384 MiB of counted requested bytes. Raw results: `receipts/measurements.json`; harness: `measure.py`. Round-1 results for the earlier binary are kept in `receipts/round1-superseded/`.

| Case | Result | Peak RSS | Counted peak | Wall time |
| --- | --- | ---: | ---: | ---: |
| Text, 1 page | success | 9.8 MiB | 32 KB | 0.26 s |
| Content stream decoding to 64 MiB | success | 300.3 MiB | 201.4 MB | 0.07 s |
| Content-stream bomb, 1 GiB decoded | **`memory_limit`** | **524.8 MiB** | cap breached | 0.07 s |
| The same with a 64 MiB cap | **`memory_limit`** | 77.8 MiB | cap breached | 0.02 s |
| Object-stream bomb, 1 GiB, decoded **while loading** | **`memory_limit`** | 268.6 MiB | cap breached | 0.38 s |
| Cross-reference-stream bomb, 1 GiB, at load | **`memory_limit`** (exit 70, marker) | 268.7 MiB | cap breached | 0.04 s |
| Arrays nested 200,000 deep | reported `malformed` (`lopdf` refuses the nesting) | 10.2 MiB | – | 0.01 s |
| 300,000 small objects | success | 300.5 MiB | 305.3 MB | 0.40 s |
| 2,000 distinct compressed pages (churn) | success | 20.2 MiB | 9.1 MB | 0.53 s |
| 1,000-page text document | success | 15.4 MiB | 4.6 MB | 0.16 s |
| 400 pages sharing one 2 MiB stream | every page `failed` (`page_text_limit`) | 193.0 MiB | 46.2 MB | 12.8 s |

**What this shows:**
- **Every bomb is stopped by the cap,** whether the decoding happens in a content stream, an object stream or a cross-reference stream. The two load-time cases breach inside `lopdf`'s loader.
- **RSS is not bounded by the cap.** The worst case seen is the 1 GiB content bomb: **524.8 MiB RSS against a 384 MiB counted cap (about 1.37×).** Strict inspection decodes a stream itself and `lopdf` then decodes it again, and the allocator keeps freed buffers. On successful files, RSS was between 0.98× and 1.5× of the counted peak.
- **A very large object graph is the largest legitimate case seen:** 300,000 objects, 305 MB counted, close to the cap. Ordinary documents stayed small: 1,000 or 2,000 pages of text used 15–20 MiB.
- **Repeated decoding of a shared stream costs time** (12.8 s, inside the 120 s deadline), not unbounded memory.
- **The active Flate backend** is `miniz_oxide` only (`receipts/feature-tree-*.txt`; `zlib-rs` is not compiled in).

**Cap options for the reviewer:**
- **Keep 384 MiB counted.** Observed RSS reaches about 525 MiB.
- **Lower it to 256 MiB.** Observed RSS would scale to roughly 350 MiB, but the 300,000-object case would then be refused.

Either way the cap is a bound on requested bytes, not on RSS.

**App-mode allocator cost** (`receipts/app-mode-overhead.txt`; release build, median of five runs, 2,000,000 allocate/free pairs per thread):

| Threads | System | App mode (counting stopped) | Counting kept on (not shipped) |
| ---: | ---: | ---: | ---: |
| 1 | 17.5 ms | 17.2 ms (−2.1%) | 18.1 ms (+3.1%) |
| 4 | 18.6 ms | 20.3 ms (+9.5%) | 1,157 ms (+6,135%) |
| 8 | 27.1 ms | 30.7 ms (+13.1%) | 7,924 ms (+29,120%) |

Codex round 1 accepted this app-mode cost for the microbenchmark. Representative app-operation timing remains for installed acceptance.

## Review round 1 corrections (Codex RED, findings 1–7)

| Finding | Correction | Evidence |
| --- | --- | --- |
| 1. Incomplete inspections could become `blank` | `inspect.rs` resolves every `/Contents` entry itself and decodes each stream **strictly**: unfiltered, or a single FlateDecode with no predictor, through `flate2` (owner-approved direct dependency, same locked version; `Cargo.lock` gains one line in the app's dependency list). It does this because `lopdf` keeps partial output from corrupt Flate or LZW data and skips missing objects. A dangling, missing, non-stream or undecodable entry makes the page `failed`, even if part of it yielded text. | 6 new tests (dangling reference, valid plus missing stream, corrupt Flate, ASCIIHex, LZW, truncated Flate, compressed blank, no `/Contents`). The old implementation fails 4 of them: `receipts/r1-inspect-before-fix.log`, exit 101. |
| 2. Transient failures poisoned a hash | `cacheable()` stores only `encrypted`, `malformed`, `input_too_large`, `total_text_limit` and `memory_limit`. Identity and I/O failures, timeouts, cancellations and crashes are never stored. | A unit test, plus `a_transient_identity_failure_is_not_cached_against_the_original_bytes`, which replaces the file before the worker reads it, then restores it and prepares successfully. |
| 3. No fresh hash after the worker finished | `prepare_with` re-hashes the file after the worker finishes and before reporting. | `a_file_replaced_after_the_worker_read_it_never_shows_the_old_result`: a stamp-preserving replacement in the same session, using a debug-only `sleepAfterRead` hook. |
| 4. Unbounded, parallel hashing | One executor thread per session handles every verify and prepare, through a de-duplicated queue capped at 1,024. All hashing and extraction is serialized by one lock. | `queued_work_is_deduplicated_serialized_and_completes`. |
| 5. Unconfirmed end of file | `read_frames` and `read_stderr` return explicit results: interruptions are retried, and any other error, a reader panic or a lost channel is `worker_failed`. Classification is a pure `classify()`. | 6 supervisor unit tests: injected reader errors and interruptions, 12 adversarial frame sequences, partial and oversized frames, marker present versus absent, unconfirmed pipes, stop reasons. |
| 6. Incomplete memory evidence | Counted peak reported in the `end` frame; load-time object-stream and cross-reference-stream bombs, deep nesting, 300,000 objects, churn and a 1,000-page document added; feature-tree receipts. **The sampled RSS watchdog is not implemented** (revised contract below). | The table above. |
| 7. Coverage | Concurrent shrinking against reservations (allocator), the pure classification tests, the adversarial sequences and the PDF cases above. | Unit and integration tests. |

**Pre-fix receipts:** findings 1 and 5 can run against the old code (finding 1's receipt is above). The regressions for findings 2–4 call `prepare_with`, `enqueue_*` and `wait_idle`, which only exist in the fixed code, so the old code can't run them; no artificial pre-fix receipt is claimed.

**Revised contract: no sampled RSS watchdog.** Proposal §4.2 kept "the sampled RSS watchdog as a backstop". P54-02 showed such a watchdog overshoots by 66–270 MiB, so it bounds nothing, and sampling another process's RSS portably adds platform code. The worker's protections are therefore the counted cap, the deadline, one worker at a time and the measured RSS behaviour above. **This revision needs the reviewer's explicit acceptance.**

## Limits and what is not done

- **The cap bounds requested allocation bytes, not footprint or RSS.** The residual risks are as stated in proposal §4.2. **The reviewer must accept the cap (384 MiB), the observed overhead and these risks before extraction is enabled in a release.**
- **Not yet built:**
  - The UI (01b).
  - Triggers on import.
  - Non-PDF files: text, Markdown and images show `unsupported`.
  - Real-document fidelity and release timing on real files (01c). For example, `lopdf` extracts only page-level text, so text that lives only in forms is reported as `text_unreadable`.
  - Installed acceptance: packaged and translocated launch, painted interaction, supported Macs.
  - Moving the existing main-process `lopdf` parsing into the worker.
- **Breach signalling is Unix-only;** on other platforms a breach is a plain `worker_failed`.
- **Within one session,** an in-place rewrite that keeps the stamp is caught at action time but can show stale readiness until the next session. Across sessions nothing is trusted.

## Gate

- Strict clippy and fmt pass.
- Native tests: 753 passed, 0 failed, 7 ignored. fmt, strict clippy and the lockfile check pass.
- The release build succeeds.
- The schema-14 helper and tracker bindings are recorded in `receipts/`.
- No frontend source changed. CI runs the full matrix at the exact head.

Raw receipts and their SHA-256 sums are in `evidence/offline-01a-2026-10-19/`. The [reviewer prompt](OFFLINE_01A_REVIEWER_PROMPT_2026-10-19.md) lists what to check.
