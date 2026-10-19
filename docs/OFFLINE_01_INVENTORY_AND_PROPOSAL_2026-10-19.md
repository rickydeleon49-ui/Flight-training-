# OFFLINE-01: source inventory and extraction/cache gap-closure proposal

**Status: proposal for independent review. No code, dependency, migration or behavior change.** This is the first OFFLINE-01 deliverable, as the [plan's entry point](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md#implementer-entry-point-and-stopping-rule) requires. Claude implements and Codex reviews. Base: main `e27c390`.

**Revision 4** answers Codex rounds 1–3 (all RED). Earlier text is in Git history. The changes:
- the memory strategy is now a capped allocator in the worker, with exact accounting, breach signalling and its limits stated (§4.2);
- verified readiness requires a fresh hash in the current session (§4.3);
- image detection inspects content recursively, and nothing is called a scan (§4.4);
- the worker is fail-closed on any use of its flag (§4.1);
- the parent plan's evidence gates are explicit (§5).

## 1. What is stored today, and what is offline and searchable

| Content | Where it lives | In a complete backup | Usable offline today |
| --- | --- | --- | --- |
| Imported originals (PDF, TXT, MD, images, DOCX/RTF) | Files under `documents/`, with the path in `study_materials.file_path`. An original can also be moved or replaced on disk. | Yes (`documents/`) | Yes: opened from disk, no network |
| PDF identity | `material_content_identities` (SHA-256, total pages, verified time), migration 0015 | Yes (database) | Yes |
| Navigation state | `material_bookmarks`, `material_reading_state`, `material_operation_claims` | Yes | Yes |
| Split parts and lineage | `material_split_lineage`, `split_operation_log` | Yes | Yes |
| Saved study guide and its cards | `ai_study_sets` (`title`, `summary`, `sections_json`, `flashcards_json`, `source_notes`) | Yes | Yes: rendered from SQLite |
| Card review versions, items and history | `card_versions`, `card_items` (`front`, `back`, `source_page`), `card_review_state`, `card_review_events`, `card_review_operations` | Yes | Yes |
| Practice tests and history | `practice_tests` (`questions_json`, still loaded by the document repository), `practice_test_versions`, `practice_test_items` (`question_text`, `options_json`, `explanation`, `source_page`), `practice_attempts`, `practice_responses` | Yes | Yes |
| Notes | `notes` (`title`, `body`) | Yes | Yes |
| Material notes and next actions | `study_materials.notes`, `next_actions` | Yes | Yes |
| Gemini key, model and job journal | Files beside the database (`gemini-key`, `gemini-model`, `gemini-jobs.json`) | **No**, by design | n/a |

**Search coverage today:**
- **Study Library filter:** material title, notes, topic, type and tags.
- **QuickFind (⌘K):** material title, notes, tags and original file name. It does not match topic or type labels. It also searches notes, events, goals, instructor questions and answers, and other records.
- **Neither** searches the text of documents, saved guides, cards or practice questions.

**What the backup holds:** `allowed_archive_path` in `backup.rs` admits only:
- the archive manifest and integrity files;
- `her-flight-deck.db` and its `-wal`;
- `documents/`.

`-shm` is not archived; production exports use an online SQLite snapshot. Any other file in the app folder, such as a derived cache, is excluded by design. **Restore does not remove unknown files**, so a cache survives a restore (§4.3).

**Reading never waits on Gemini.** The material page shows "Checking the Gemini connection…" only inside the AI panel. OFFLINE-01 must keep it that way.

## 2. Existing PDF parsing that the plan's resource rules touch

The production app already parses whole PDFs **inside the main process** with `lopdf 0.42.0`:
- `navigation::identity_of_bytes`, behind Check pages;
- `gemini_batches` page validation;
- `pdf.rs`, through `read_pdf_once` and `pdf::count_pages`, for splitting and the page-length check before Gemini.

`Document::load_mem` decompresses **object streams and cross-reference streams while loading**, and content streams later when text is extracted. That exposure exists today; OFFLINE-01 must not add to it, and text extraction runs only in a separate, killable process. Moving the existing parsing out of the main process is a listed follow-up (§5, item 7).

`lopdf` uses `flate2 1.1.10` for FlateDecode and `weezl 0.1.12` for LZWDecode. Both are already in `Cargo.lock`.

## 3. What P54-02 proved and what remains open

The accepted [phase-2 proof](P54_02_PHASE2_WORKER_PROOF_REPORT_2026-10-16.md) ([acceptance](P54_02_PHASE2_ACCEPTANCE_2026-10-17.md)) covered:
- a process-isolated worker, with supersession and cancellation;
- input, frame and stream bounds, and the deadline kill;
- a finalization rule: clean terminal reader event, valid complete protocol and successful exit before any result is accepted;
- identity re-check at publication, and error privacy;
- a disposable FTS5 cache;
- 8 of 10 preregistered targets met.

Open, and reused here rather than re-proven:

| Gap | P54-02 evidence | Needed before shipping |
| --- | --- | --- |
| **G1 Memory** | `ulimit -v` is unsupported on macOS. The sampled 512 MiB watchdog overshot by 66–270 MiB. Those overshoots are observations, not a maximum. No production memory budget was accepted. | A reviewed whole-process memory strategy, with any residual risk explicitly accepted (§4.2). |
| **G2 Fidelity** | Only generated single-font WinAnsi text. CID, complex-font and Unicode are untested; image-only pages are reported as `no_extractable_text`, which does not prove they are scans. | Real public documents plus CID, Unicode and table fixtures; per-page outcomes that never guess (§4.4). |
| **G3 Release-profile numbers** | A debug build. Warm p95 61.8 ms against a 50 ms target, and whole-process RSS 284.9 MiB against 256 MiB, were both missed. | Release-profile measurements with a per-stage memory split. OFFLINE-02 (search) owns the query-latency target. |
| **G4 App integration** | The proof was a disposable Cargo example. | A worker mode in the shipped binary, a supervisor, readiness and app-level tests. |
| **G5 Native and supported-Mac behavior** | Not measured. | Painted native interaction, a packaged or translocated launch, and supported macOS versions, verified at installed acceptance. |
| **G6 Owner choices** | FTS5 versus MiniSearch, folding (ß, CJK), prefix search, browser behavior. | These belong to **OFFLINE-02**. OFFLINE-01 stores page text without choosing an engine. |

## 4. Proposal

### 4.1 Worker in the shipped binary

`main.rs` looks at its arguments **before Tauri is initialized**:
- If the argument list is exactly `[exe, "--hfd-extract-worker"]`, the process becomes the worker.
- If `--hfd-extract-worker` appears in **any other** form (duplicated, combined with other arguments or in a different position), the process exits immediately with a fixed error code. It never falls through to starting the app, so it never opens the database or a WebView.
- Any argument list without the flag starts the app normally.

The flag can be typed by a user, so it grants nothing: the worker can only read one file and write text to its own standard output.

**In worker mode the process:**
- reads **one** request of at most 4 KiB from standard input. Empty, oversized, malformed or late input exits with a fixed error code and no output;
- uses **compiled-in maximum limits**. A request may lower a limit but never raise it;
- opens no database, network, window or WebView, and writes nothing inside the app bundle. It does not depend on where the app is installed, which also makes it safe under App Translocation;
- stops on its first internal error, with no partial success.

**The supervisor:**
- spawns `std::env::current_exe()`, refusing to start if that fails;
- runs **one worker at a time** (P54-02 used 2), so that one worker's memory limit is not multiplied;
- enforces the P54-02 bounds: input 128 MiB, page 64 KiB, total text 16 MiB, frame 512 KiB, stream 32 MiB, plus a deadline;
- kills and reaps the worker on timeout, supersession or cancellation;
- accepts a result only under the P54-02 finalization rule, then re-hashes the managed file before publishing.

Installed acceptance includes a packaged, translocated launch (§5, item 4).

### 4.2 Memory: a capped allocator in the worker

**The strategy:** the shipped binary installs a counting global allocator that wraps the system allocator.

**Accounting** (in both modes):
- The counter starts at process start, so allocations made before the worker reads its arguments are included.
- It tracks the **requested** bytes of `alloc`, `alloc_zeroed` and `realloc` (as the size difference) minus `dealloc`.
- Each allocation first **reserves** its bytes with a compare-and-swap loop, so concurrent reservations can never jointly pass the cap.
- If the system allocator then fails, the reservation is released.

**Cap check** (worker mode only):
- When worker mode starts, before any input is read, the cap is set (for example 384 MiB, with the final value set by measurement in 01a). If the counter already exceeds it, the worker exits.
- A reservation that would pass the cap returns null.

**Signalling a breach without allocating:**
- Before returning null, the allocator sets a static `CAP_BREACHED` flag.
- It writes a fixed, static marker to the worker's standard error with a raw file-descriptor write, which allocates nothing.

**Both failure paths are covered:**
- **Infallible allocations** call Rust's allocation-error handler, and the worker aborts.
- **Fallible allocations** (for example `try_reserve`, which locked `lopdf 0.42.0` uses in `filters/png.rs`) return an error to their caller. The worker checks `CAP_BREACHED` before emitting any success frame or its terminal event, and stops with no success if it is set.

**How the supervisor classifies the outcome:**
- **`memory_limit`** only when the static marker is present.
- **An undifferentiated `worker_failed`** for any other abnormal exit, including a stack overflow or another abort.
- A breach never publishes a success.

**What the cap bounds:** the **requested allocation bytes** of every Rust heap allocation the worker makes, whatever makes it:
- reading the file;
- `lopdf` parsing, including object and cross-reference streams decompressed while loading;
- content-stream decompression, including repeated decoding;
- text decoding and result frames.

It does not depend on predicting how `lopdf` parses a file. The deadline bounds CPU time, and the sampled RSS watchdog stays as a backstop.

**What it does not bound, stated plainly.** The cap is **not** a bound on heap footprint or RSS:
- **Allocator overhead:** the system allocator's metadata, size-class rounding, fragmentation and freed pages it retains all sit outside the count. Repeated allocation and freeing can grow the footprint beyond the counted bytes.
- **The worker's stack:** the worker runs extraction on one thread with an explicit, fixed stack size, so overflow aborts the worker. That is reported as `worker_failed`.
- **Fixed overheads:** the binary's code and read-only pages.
- **Kernel-side buffers.**
- **Memory mapped outside the allocator:** none was found in the inspected extraction paths. The resolved feature tree confirms `miniz_oxide` as the active Flate backend; 01a records `cargo tree -e features` as evidence.
- **System pressure:** a worker near its cap still uses real memory. Running one worker at a time limits that.

01a measures, in release builds, how peak RSS relates to counted bytes for:
- decompression bombs in content, object and cross-reference streams;
- deep object graphs;
- shared streams referenced by many pages;
- repeated allocate/free churn;
- large real files.

It then proposes the cap and states the observed footprint overhead. Those are **observations, not a bound**. **Shipping requires the reviewer to accept the cap, the measured overhead and these residual risks explicitly.**

**App-mode cost:** the app has no cap, but every Rust allocation and deallocation still passes through the counter: an atomic read-modify-write plus the wrapper's branch. Under concurrency that can contend.
- 01a measures app-mode overhead in a release build, both with an allocation-heavy microbenchmark and with representative app operations (opening the library, rendering a large study set, a backup).
- The reviewer accepts that overhead, or 01a moves the counter behind a worker-only fast path. That alternative must then show it still counts worker allocations from process start.

**Owner decision, 19 October 2026:** the owner approved direct `flate2` and `weezl` dependencies for bounded decompression. The capped allocator does not need them, so **01a makes no dependency change**. The approval remains available if a later, separately reviewed defence-in-depth pre-scan is justified. The raw-byte pre-scan in revision 2 is withdrawn: as Codex round 2 showed, it could not be shown to cover exactly what `lopdf` decodes. Deadline plus watchdog alone (option (c)) is not proposed for shipping.

### 4.3 Readiness and page text: a content-addressed derived cache, no migration

A separate SQLite file, `content-cache.db`, in the app data folder. It is outside the backup archive and opened only by native code through `rusqlite`. **Entries are keyed by content, not by material**, because extracted text is a pure function of a file's bytes and the extractor version:
- **`extraction`:** keyed by `content_sha256` and `extractor_version`. It holds the overall outcome, page counts by outcome, completion state and a privacy-safe error code.
- **`page_text`:** keyed by `content_sha256`, `extractor_version` and physical page index. It holds the text (empty unless the outcome is `text`), the per-page outcome (§4.4) and an error code.
- **`cache_meta`:** schema version and a `building`/`complete` flag. A cache that isn't complete, has a different schema or fails an integrity check is deleted and rebuilt.

**A material's readiness is never stored.** It is derived when needed by finding the hash of the material's *current* managed file and looking that hash up.

**Finding the current hash:**
- A material's last known `(path, size, mtime, inode)` and hash are kept only as a **hint**. Different bytes can keep the same tuple, for example after an in-place rewrite that preserves timestamps.
- **Verified readiness requires the file's bytes to have been hashed in the current app session.** Until then the material shows **On this Mac** with "Checking…", never **Searchable**.
- A bounded background queue hashes one file at a time after launch, and before preparation.
- Because the hint is never trusted across sessions, a restore (which restarts the app) or a rollback needs no special invalidation.
- A missing file shows **Missing**.
- Anything that acts on content re-hashes the file at that moment: publishing, OFFLINE-02 search hits and page destinations.

A test changes a file's bytes while keeping its tuple, and checks that readiness stays unverified until the file is re-hashed.

**Why this survives restore without a fingerprint:**
- Restoring an older backup, rolling back a profile, or restoring only the database while documents and the cache survive cannot make a cached entry *wrong*, because each entry describes exact bytes.
- After a restore, each material resolves to whatever file is actually on disk. Identical bytes reuse their text; different bytes miss and are re-extracted.
- A worker started before a restore publishes only under the hash it read and re-verified. That result is correct for those bytes, and is simply not used if the restored file differs.
- Entries for hashes no longer referenced are pruned by a bounded clean-up.

**Tests:** same-profile rollback to an older backup; database-only restore with surviving documents and cache; an original replaced with older bytes; an original moved outside the app; a worker that finishes after a restore.

Originals, guides, cards, notes, histories and annotations are never touched by the cache, and losing it only costs re-extraction. Because nothing authoritative changes, no migration is allocated. Durable user annotations and manual content (OFFLINE-03) will need authoritative tables and their own review.

**Browser mode:** no file import exists there, so no extraction or cache. Today's metadata search is unchanged, and readiness is shown as unavailable.

### 4.4 Per-page outcomes that never guess

Each page's content is inspected **recursively**, within fixed bounds:
- the page's content streams;
- every Form XObject it invokes, through the resources in force at that point;
- at most 8 levels deep, with cycle detection, and within the worker's time and memory limits.

**Inspection is complete** only when every invoked content stream and form was resolved and read without error. If anything was missing, cyclic, too deep, unsupported or failed, inspection is **incomplete**.

| Outcome | Rule | How it's shown |
| --- | --- | --- |
| `text` | Non-empty extracted text | counts as searchable |
| `blank` | Complete inspection found no text-showing operators and no image drawn | counts as searchable (nothing to find) |
| `image_only` | Complete inspection found at least one image drawn (image XObject or inline image) and **no** text-showing operators anywhere, forms included | "This page is an image. Text recognition is needed to search it." |
| `text_unreadable` | Text-showing operators were found, but extraction produced no usable text (for example a CID font without a ToUnicode map) | "Some text on this page couldn't be read" |
| `unknown` | Inspection was incomplete | "This page couldn't be fully checked" |
| `failed` | Extraction error; a privacy-safe code is kept | "This page couldn't be processed" |

`image_only` says only that the page's content is an image. It does **not** claim the page was scanned.

A material's state summarizes exact per-page counts:
- **Searchable:** every page is `text` or `blank`.
- **Partly searchable:** with counts, for example "41 of 50 pages".
- **Image pages need text recognition:** used **only** when every page that isn't searchable is `image_only`.
- **Couldn't read some pages:** the neutral wording, used whenever `text_unreadable`, `unknown` or `failed` pages exist.
- **Missing** and **Could not process** apply to the whole file.

Empty extraction never counts as searchable coverage, and an unknown cause is never given a specific diagnosis.

### 4.5 Preparation never uploads

Extraction is triggered only by:
- a successful import or replacement;
- an explicit **Prepare for offline study** action;
- a background catch-up limited to local files.

Nothing reads the Gemini key or calls a provider. A test asserts that no Gemini path is reachable from the extraction module.

## 5. Delivery slices and stopping rule

Every slice, and installed acceptance, follows the parent plan's evidence rules:
- focused regressions first, then the applicable normal gate once;
- failed receipts are kept, never relabeled;
- source hashes and exact exit codes are recorded;
- trackers are updated, and one report is left with a precise reviewer prompt;
- then Codex review and green exact-head CI.

Each slice then **stops for authorized integration**. Nothing moves to the next slice automatically, and nothing is published automatically. Installed acceptance names the exact candidate it tested (source commit, executable and DMG hashes).

1. **OFFLINE-01a, native extraction and cache.** The worker mode (§4.1); the capped allocator (§4.2) with measured peak RSS and a proposed cap; the content-addressed cache (§4.3); per-page outcomes (§4.4); and readiness commands.
   - **Tests, all native and synthetic:**
     - fresh import, replacement during extraction, deletion;
     - an original moved outside the app;
     - split parts;
     - corrupt, encrypted and password-protected PDFs;
     - Unicode, text, blank, image-only, unreadable and mixed pages;
     - bombs in content, object and cross-reference streams;
     - a shared stream referenced by many pages, and deep or cyclic forms;
     - a page that draws an image directly and text through a form;
     - cancellation, a crash and restart, and a stale worker;
     - every restore case in §4.3;
     - partial coverage, with empty text never counting as searchable;
     - argument handling: exact flag, duplicated flag, flag with extra arguments;
     - allocator breaches on both an aborting path and a fallible `try_reserve` path, each classified `memory_limit` with no success published, and a stack overflow classified `worker_failed`;
     - standard-input fail-closed behavior;
     - a file whose bytes change while its tuple stays the same;
     - no Gemini reachability.
2. **OFFLINE-01b, honest readiness in the UI.** Study Library and the material page show the §4.4 states in warm, plain wording, with **Prepare for offline study**. Existing metadata search is unchanged.
3. **OFFLINE-01c, fidelity and release measurements.**
   - **Documents:** public-domain FAA handbooks (exact URL, hash and licence note, kept outside Git), plus CID, Unicode, multi-column and table fixtures.
   - **Measurements:** release-profile timing and memory, with real per-page coverage reported honestly.
4. **Installed acceptance (G5),** on the recorded synthetic lane:
   - import, prepare, restart offline, restore and rebuild;
   - a packaged, translocated launch;
   - painted native interaction;
   - supported-Mac coverage as available, with anything unavailable stated as unverified.

   No everyday profile and no provider calls.
5. The allocator cap and residual risks accepted by the reviewer (§4.2) before 01a's extraction is enabled in a release.
6. Search itself is OFFLINE-02, with its own engine and folding decisions.
7. **Follow-up:** move the existing main-process `lopdf` parsing (§2) into the worker, or bound it. It is listed so the exposure stays visible; it is not part of 01a.

## 6. Decisions

- **Owner (made 19 October 2026):** approved direct `flate2` and `weezl` dependencies. They are not needed by 01a's capped allocator and remain unused unless a later defence-in-depth step is separately reviewed (§4.2).
- **Reviewer, at 01a:** accept or reject the measured allocator cap, the observed footprint overhead, the app-mode cost and the stated residual risks.
- **Reviewer, now:** confirm the capped-allocator strategy, the content-addressed derived cache with no migration, session-verified readiness, the worker contract and the per-page outcome rules.

Search-engine and folding choices remain with OFFLINE-02.
