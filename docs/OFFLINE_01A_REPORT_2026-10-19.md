# OFFLINE-01a: native extraction worker and content cache

**Status: implemented, pending independent review.** Claude implemented it; Codex reviews. Base: main `8d3ebfc`. This follows the accepted [proposal](OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md) (revision 5). Evidence is in [`evidence/offline-01a-2026-10-19/`](evidence/offline-01a-2026-10-19/).

**No change to dependencies, `Cargo.lock`, migrations, the frontend or the backup format.** The owner-approved direct `flate2`/`weezl` dependencies were not needed. The two new commands are registered but not yet called by the UI (that is 01b). Nothing calls a provider.

## What was built (`src-tauri/src/extraction/`)

| Part | File | What it does |
| --- | --- | --- |
| Allocator | `alloc.rs` | A counting global allocator for the whole binary (§4.2). It counts the **requested** bytes of live allocations from process start: `alloc`, `alloc_zeroed`, growth reserved before `realloc` and rolled back on failure, shrinkage credited after success, `dealloc`. Reservations use a compare-and-swap loop with checked arithmetic. **App mode stops counting** once the process knows it is the app; after that there is no cap and no shared counter. Worker mode keeps counting and sets a cap before reading input. A breach sets a sticky flag and writes a static marker once with a raw `write` (Unix only; elsewhere the breach shows as `worker_failed`). |
| Worker | `worker.rs`, `main.rs` | Selected **only** by exactly `[exe, "--hfd-extract-worker"]`, checked before Tauri starts. Any other use of the flag exits 64 without output. It reads one request (at most 4 KiB, unknown fields refused), with compiled-in maximums a request can lower but never raise. It runs on one thread with a fixed 8 MiB stack, verifies the file's SHA-256, refuses encrypted files, and writes NDJSON frames, checking the breach flag before every frame. Fault-injection hooks exist only in debug builds. |
| Inspection | `inspect.rs` | Per-page outcomes (§4.4): `text`, `blank`, `image_only`, `text_unreadable`, `unknown`, `failed`. Content is decoded **strictly**, and Form XObjects are followed recursively (at most 8 levels, with cycle detection). `blank` and `image_only` require a complete inspection. |
| Supervisor | `supervisor.rs` | Spawns the worker with an empty environment and drains stdout (512 KiB frame, 32 MiB stream) and stderr (4 KiB kept) concurrently until end of file. It enforces the deadline and cancellation, validates the frame sequence and classifies only after exit plus end of file on both pipes. `memory_limit` is reported only when the marker arrived; any other abnormal end is `worker_failed`. |
| Cache | `cache.rs` | `content-cache.db`, keyed by content SHA-256 and extractor version. Each publish is atomic. A missing, foreign-schema, incomplete or corrupt cache is deleted and rebuilt. Only deterministic whole-file failures are stored. Pruning is bounded. The file is outside the backup archive by design. |
| Service and commands | `service.rs` | Readiness is never stored. It comes from the file's hash, which counts as verified only once hashed **in this session**, by streaming so large files stay out of memory. Preparation **re-hashes before deciding**, runs one worker at a time, and publishes only under the hash the worker read. Two commands: `offline_content_readiness(materialIds)` and `prepare_offline_content(materialId)`. |

## Tests: 735 native passed, 0 failed, 7 ignored (was 686)

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

Worker binary SHA-256: `07e39d98d50f9d31b550643e3cf029fd6186b29b5566d8d9251fdceda23ba34e` (`receipts/release-worker.sha256`). Default cap 384 MiB. Raw results: `receipts/measurements.json`; harness: `measure.py`.

| Case | File size | Result | Peak RSS | Wall time |
| --- | ---: | --- | ---: | ---: |
| Text, 1 page | small | success | 9.8 MiB | 0.24 s |
| Content stream decoding to 64 MiB | under 1 MB | success (under the cap) | 204.3 MiB | 0.09 s |
| Content stream decoding to 1 GiB | about 1 MB | **`memory_limit`**: marker delivered, SIGABRT | 268.8 MiB | 0.04 s |
| The same with a 64 MiB cap | about 1 MB | **`memory_limit`** | 45.8 MiB | 0.02 s |
| 400 pages sharing one 2 MiB stream | small | every page `failed` (`page_text_limit`) | 191.6 MiB | 12.7 s |

**What the measurements show:**
- Peak RSS stayed under the configured cap in every run. The 1 GiB bomb was refused at a large allocation request before memory reached the cap.
- A successful 64 MiB decode used about three times its decoded size in RSS (copies during parsing and extraction). That is the footprint overhead the cap does not count.
- Repeated decoding of one shared stream costs **time** (12.7 s, inside the 120 s deadline), not unbounded memory.

These are observations on synthetic files, not a guarantee.

**App-mode allocator cost** (`receipts/app-mode-overhead.txt`; release build, median of five runs, 2,000,000 allocate/free pairs per thread):

| Threads | System | App mode (counting stopped) | Counting kept on (not shipped) |
| ---: | ---: | ---: | ---: |
| 1 | 17.5 ms | 17.2 ms (−2.1%) | 18.1 ms (+3.1%) |
| 4 | 18.6 ms | 20.3 ms (+9.5%) | 1,157 ms (+6,135%) |
| 8 | 27.1 ms | 30.7 ms (+13.1%) | 7,924 ms (+29,120%) |

The app-mode cost is one relaxed load and a branch per allocation: about 1.7–3.6 ms over 8–16 million allocate/free pairs in this worst-case loop. Real app operations allocate far less densely; representative app-operation timing was not measured and remains for installed acceptance.

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
- Native tests: 735 passed, 0 failed, 7 ignored.
- The release build succeeds.
- The schema-14 helper and tracker bindings are recorded in `receipts/`.
- No frontend source changed. CI runs the full matrix at the exact head.

Raw receipts and their SHA-256 sums are in `evidence/offline-01a-2026-10-19/`. The [reviewer prompt](OFFLINE_01A_REVIEWER_PROMPT_2026-10-19.md) lists what to check.
