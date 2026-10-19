# OFFLINE-01: source inventory and extraction/cache gap-closure proposal

**Status: proposal for independent review. No code, dependency, migration or behavior change.** This is the first OFFLINE-01 deliverable, as the [plan's entry point](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md#implementer-entry-point-and-stopping-rule) requires. Claude implements and Codex reviews. Base: main `e27c390`.

**Revision 2** answers Codex round 1 (RED: findings 1–4 blocking, 5–7 non-blocking) and records the owner's approval of memory option (a), §4.2. Round-1 text is in Git history.

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

`main.rs` enters worker mode **only** when the argument list is exactly `[exe, "--hfd-extract-worker"]`. Anything else starts the app normally, and the flag is never combined with other arguments. The argument can be typed by a user, so it grants nothing: the worker can only read one file and write text to its own standard output.

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

### 4.2 Memory: whole-process strategy (option (a) approved by the owner)

**Owner decision, 19 October 2026:** approved adding `flate2` and `weezl` as **direct** dependencies, at the same locked versions, for bounded decompression. No new package enters `Cargo.lock`. This approval covers the dependency only; it does not by itself establish a memory bound.

The strategy has four layers, applied in the worker before `lopdf` is called:
1. **Raw-byte pre-scan.** Every compressed byte in a PDF lives in a top-level stream object; stream objects cannot be nested inside object streams. The worker scans the raw file for each `stream … endstream` body and its dictionary (`/Filter`, `/DecodeParms`, `/Length`, including indirect lengths) **without using `lopdf`**. This covers object streams and cross-reference streams decompressed during loading, and content streams decompressed during extraction.
2. **Bounded decoding.** Each stream is decoded with a size cap: FlateDecode through `flate2`'s streaming decoder and LZWDecode through `weezl`, with predictor parameters respected.
   - The per-stream cap and the **aggregate cap across all streams** are compiled in.
   - Unknown or chained filters beyond an allowlist are refused, and so are encrypted or password-protected files (they show as **Could not process**).
   - Image filters (DCT, JPX, CCITT, JBIG2) are never decoded, because text extraction doesn't need them.
3. **Repeated processing.** `lopdf` decodes some streams more than once (at load, and per page during extraction). Because every stream's decoded size has already been proven within the cap, total decoded work is bounded by a small, measured multiple of the aggregate cap. 01c measures that multiple on adversarial and real files.
4. **Backstops.** The deadline and the sampled RSS watchdog still run. They are documented as a **time bound and a sampled backstop, not a memory cap**.

**Residual risk, stated plainly:**
- `lopdf`'s parsed object graph is proportional to the file, up to 128 MiB of input. Allocation patterns inside `lopdf` and the text decoder are not individually capped.
- Byte limits therefore bound decompression, not whole-process memory.
- Even out of process, a worker under memory pressure can affect the system.

01a measures peak RSS on bombs, deep object graphs and large real files, then proposes a concrete budget. **Shipping requires the reviewer to accept that budget and this residual risk explicitly.** Option (c) on its own (deadline plus watchdog) is **not** proposed for shipping.

### 4.3 Readiness and page text: a content-addressed derived cache, no migration

A separate SQLite file, `content-cache.db`, in the app data folder. It is outside the backup archive and opened only by native code through `rusqlite`. **Entries are keyed by content, not by material**, because extracted text is a pure function of a file's bytes and the extractor version:
- **`extraction`:** keyed by `content_sha256` and `extractor_version`. It holds the overall outcome, page counts by outcome, completion state and a privacy-safe error code.
- **`page_text`:** keyed by `content_sha256`, `extractor_version` and physical page index. It holds the text (empty unless the outcome is `text`), the per-page outcome (§4.4) and an error code.
- **`cache_meta`:** schema version and a `building`/`complete` flag. A cache that isn't complete, has a different schema or fails an integrity check is deleted and rebuilt.

**A material's readiness is never stored.** It is derived when needed by finding the hash of the material's *current* managed file and looking that hash up.

**Finding the current hash:** each material's last known `(path, size, mtime, inode)` maps to its hash in a small table. Any difference re-hashes the file; a missing file shows **Missing**. Anything that can act on content re-hashes the file before using cached text: publishing, search hits from OFFLINE-02, and page destinations.

**Why this survives restore without a fingerprint:**
- Restoring an older backup, rolling back a profile, or restoring only the database while documents and the cache survive cannot make a cached entry *wrong*, because each entry describes exact bytes.
- After a restore, each material resolves to whatever file is actually on disk. Identical bytes reuse their text; different bytes miss and are re-extracted.
- A worker started before a restore publishes only under the hash it read and re-verified. That result is correct for those bytes, and is simply not used if the restored file differs.
- Entries for hashes no longer referenced are pruned by a bounded clean-up.

**Tests:** same-profile rollback to an older backup; database-only restore with surviving documents and cache; an original replaced with older bytes; an original moved outside the app; a worker that finishes after a restore.

Originals, guides, cards, notes, histories and annotations are never touched by the cache, and losing it only costs re-extraction. Because nothing authoritative changes, no migration is allocated. Durable user annotations and manual content (OFFLINE-03) will need authoritative tables and their own review.

**Browser mode:** no file import exists there, so no extraction or cache. Today's metadata search is unchanged, and readiness is shown as unavailable.

### 4.4 Per-page outcomes that never guess

| Outcome | Rule | How it's shown |
| --- | --- | --- |
| `text` | Non-empty extracted text | counts as searchable |
| `blank` | Parsed; no text-showing operators and no image drawn | counts as searchable (nothing to find) |
| `image_only` | **Positively identified:** the page draws at least one image XObject or inline image, and has **no** text-showing operators | "This page is an image; text recognition is needed to search it" |
| `text_unreadable` | Has text-showing operators, but extraction produced no usable text (for example a CID font without a ToUnicode map) | "Some text on this page couldn't be read" |
| `failed` | Extraction error; a privacy-safe code is kept | "This page couldn't be processed" |

A material's state summarizes exact per-page counts:
- **Searchable:** every page is `text` or `blank`.
- **Partly searchable:** with counts, for example "41 of 50 pages".
- **Scanned pages need text recognition:** used **only** when every page that isn't searchable is `image_only`.
- **Couldn't read some pages:** the neutral wording, used whenever `text_unreadable` or `failed` pages exist.
- **Missing** and **Could not process** apply to the whole file.

Empty extraction is never reported as searchable coverage, and an unknown cause is never labelled a scan.

### 4.5 Preparation never uploads

Extraction is triggered only by:
- a successful import or replacement;
- an explicit **Prepare for offline study** action;
- a background catch-up limited to local files.

Nothing reads the Gemini key or calls a provider. A test asserts that no Gemini path is reachable from the extraction module.

## 5. Delivery slices and stopping rule

Each slice has focused regressions first, then one normal gate, then Codex review and green exact-head CI, and **stops for authorized integration**. Nothing moves to the next slice automatically, and nothing is published automatically.

1. **OFFLINE-01a, native extraction and cache.** The worker mode (§4.1); the memory layers (§4.2) with measured peak RSS and a proposed budget; the content-addressed cache (§4.3); per-page outcomes (§4.4); and readiness commands.
   - **Tests, all native and synthetic:**
     - fresh import, replacement during extraction, deletion;
     - an original moved outside the app;
     - split parts;
     - corrupt, encrypted and password-protected PDFs;
     - Unicode, text, blank, image-only, unreadable and mixed pages;
     - bombs in content, object and cross-reference streams;
     - cancellation, a crash and restart, and a stale worker;
     - every restore case in §4.3;
     - partial coverage, with empty text never counting as searchable;
     - argument and standard-input fail-closed behavior;
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
5. The memory budget and residual risk accepted by the reviewer (§4.2) before 01a's extraction is enabled in a release.
6. Search itself is OFFLINE-02, with its own engine and folding decisions.
7. **Follow-up:** move the existing main-process `lopdf` parsing (§2) into the worker, or bound it. It is listed so the exposure stays visible; it is not part of 01a.

## 6. Decisions

- **Owner (made 19 October 2026):** approved direct `flate2` and `weezl` dependencies for bounded decompression (§4.2).
- **Reviewer, at 01a:** accept or reject the measured memory budget and the stated residual risk.
- **Reviewer, now:** confirm the content-addressed derived cache with no migration, the worker contract and the per-page outcome rules.

Search-engine and folding choices remain with OFFLINE-02.
