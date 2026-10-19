# OFFLINE-01: source inventory and extraction/cache gap-closure proposal

**Status: proposal for independent review. No code, dependency, migration or behavior change.** This is the first OFFLINE-01 deliverable, as the [plan's entry point](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md#implementer-entry-point-and-stopping-rule) requires. Claude implements and Codex reviews. Base: main `e27c390`.

## 1. What is stored today, and what is offline and searchable

| Content | Where it lives | In a complete backup | Usable offline today | Found by search today |
| --- | --- | --- | --- | --- |
| Imported originals (PDF, TXT, MD, images, DOCX/RTF) | Files under `documents/`, with the path in `study_materials.file_path` | Yes (`documents/`) | Yes: opened from disk, no network | **Title, notes, topic, type, tags and original file name only** (Study Library filter; QuickFind). File content is never searched. |
| PDF identity | `material_content_identities` (SHA-256, total pages, verified time), migration 0015 | Yes (database) | Yes | No |
| Bookmarks and reading position | `material_bookmarks`, `material_reading_state` | Yes | Yes | No |
| Split parts and lineage | `material_split_lineage`, `split_operation_log` | Yes | Yes | Parts appear as materials (metadata only) |
| Saved study guide and its cards | `ai_study_sets` (`title`, `summary`, `sections_json`, `flashcards_json`, `source_notes`) | Yes | Yes: rendered from SQLite | **No.** Neither the library filter nor QuickFind reads guide or card text. |
| Card review versions and items | `card_versions`, `card_items` (`front`, `back`, `source_page`) | Yes | Yes | No |
| Practice tests | `practice_test_versions`, `practice_test_items` (`question_text`, `options_json`, `explanation`, `source_page`) | Yes | Yes | No |
| Notes | `notes` (`title`, `body`) | Yes | Yes | **Yes**, through QuickFind (title and body) |
| Material notes and next actions | `study_materials.notes`, `next_actions` | Yes | Yes | Material notes yes; actions through their own pages |
| Gemini key, model and job journal | Files beside the database (`gemini-key`, `gemini-model`, `gemini-jobs.json`) | **No**, by design | n/a | n/a |

- **Reading never waits on Gemini.** The material page shows "Checking the Gemini connection…" only inside the AI panel; opening, reading and reviewing do not depend on it. The plan's requirement that local reading needs no key is already met. OFFLINE-01 must keep it that way.
- **The backup allowlist already protects a derived cache.** `backup.rs` archives only `her-flight-deck.db`, its `-wal` and `-shm`, and `documents/`. A separate cache file in the app folder is therefore excluded automatically, so it can never become authoritative data.
- **Restore does not clear unknown files.** A cache left over from before a restore would survive it. The cache therefore needs its own validity fingerprint, as P54-02 prototyped.

## 2. Existing PDF parsing that the plan's resource rules touch

The production app already parses whole PDFs **inside the main process** with `lopdf 0.42.0`:
- `navigation::identity_of_bytes`, behind Check pages;
- `gemini_batches` page validation;
- `pdf.rs`, through `read_pdf_once` and `pdf::count_pages`. This covers PDF splitting and the page-length check that runs before a document is sent to Gemini.

`Document::load_mem` reads and parses every object, including object streams, but does not decompress content streams until text is extracted. That exposure exists today; OFFLINE-01 must not add to it. Text extraction, which decompresses every content stream, must run **only** in a separate, killable process. Moving page counting out of the main process is listed as a follow-up (§5, item 6), not hidden.

`lopdf` decodes FlateDecode (via `flate2 1.1.10`) and LZWDecode (via `weezl`) streams when extracting text. Both are already in `Cargo.lock` as `lopdf` dependencies.

## 3. What P54-02 proved and what remains open

The accepted [phase-2 proof](P54_02_PHASE2_WORKER_PROOF_REPORT_2026-10-16.md) ([acceptance](P54_02_PHASE2_ACCEPTANCE_2026-10-17.md)) covered:
- a process-isolated worker, with supersession and cancellation;
- input, frame and stream bounds;
- the deadline kill;
- identity re-check at publication;
- error privacy;
- a disposable FTS5 cache with fingerprint disposal and crash recovery;
- 8 of 10 preregistered targets met.

Open, and reused here rather than re-proven:

| Gap | P54-02 evidence | Needed before shipping |
| --- | --- | --- |
| **G1 Memory** | `ulimit -v` is unsupported on macOS. The sampled 512 MiB watchdog overshot by **66–270 MiB**, so it is not a cap. | A bound the plan accepts (§4.2). |
| **G2 Fidelity** | Only generated single-font WinAnsi text. CID, complex-font and Unicode are untested; image-only pages are reported as `no_extractable_text`, which does not prove they are scans. | Measure licensed public FAA handbooks plus CID, Unicode and tables. Report per-page coverage honestly. |
| **G3 Release-profile numbers** | A debug build. Warm p95 61.8 ms against a 50 ms target, and whole-process RSS 284.9 MiB against 256 MiB, were both missed. | Re-measure in the release profile, with streaming corpus load and a per-stage memory split. OFFLINE-02 (search) owns the query-latency target. |
| **G4 App integration** | The proof was a disposable Cargo example. | A worker mode in the shipped binary, a supervisor, a durable readiness state and app-level tests. |
| **G5 Owner choices** | FTS5 versus MiniSearch, folding (ß, CJK), prefix search, browser behavior. | These belong to **OFFLINE-02**. OFFLINE-01 can store page text without choosing the search engine (§4.3). |

## 4. Proposal

### 4.1 Worker in the shipped binary (no new dependency)

`main.rs` checks for one private argument (`--hfd-extract-worker`) before Tauri starts. In that mode the same executable:
- reads a single bounded request (path, expected SHA-256 and limits) from stdin;
- extracts per-page text with `lopdf`;
- streams bounded NDJSON frames to stdout, then exits.

The worker never opens the database, never touches the network, and starts no window or WebView. The supervisor in the app:
- spawns `std::env::current_exe()`;
- admits at most 2 workers at a time;
- enforces the P54-02 bounds: input 128 MiB, page 64 KiB, total 16 MiB, frame 512 KiB, stream 32 MiB, and a deadline;
- kills and reaps on timeout, supersession or cancellation;
- re-hashes the managed file before publishing.

These are the proof's tested bounds and lifecycle, ported into app code. A separately bundled sidecar is not needed.

### 4.2 Memory bound: recommended choice for owner approval

Options, with the evidence and impact of each:

- **(a) Bounded decompression pre-scan.** Before `lopdf` decompresses anything, the worker walks each content stream's filter chain and decodes it with a size limit:
  - FlateDecode through `flate2`'s streaming decoder;
  - LZWDecode through `weezl`;
  - refusing unknown or excessive filters, and any stream whose decoded size would pass the page or total limit.

  This bounds the decompression-bomb case at its source rather than after allocation. **Impact:** `flate2` (and possibly `weezl`) become *direct* dependencies of the same locked versions. No new package enters `Cargo.lock`; only the root dependency list changes. This still needs the owner's agreement under the dependency rule.
- **(b) A capped allocator in the worker.** A counting global allocator that refuses allocations past a limit. This is a real cap on heap use, but it adds custom unsafe code to the shipped binary, and failure appears as an allocation abort. That abort is acceptable inside the worker, but it is harder to review.
- **(c) Deadline plus sampled watchdog only.** No new dependency. Lower the watchdog threshold (for example 256 MiB) so the measured worst overshot (270 MiB) still stays under about 530 MiB. This is honest only if documented as **not a cap**.

**Recommendation:** ship **(c) first**, inside the worker process. That is already strictly safer than today's in-process parsing, and the worker can never affect the main app's memory beyond its own process. Pursue **(a)** as the hardening step once the owner agrees to the direct dependency. (b) is not recommended. Until (a) lands, the per-page readiness states must say "Could not process" for refusals, and the documentation must not call the watchdog a memory limit.

### 4.3 Readiness and page text: a derived cache, no migration

A separate SQLite file, `content-cache.db`, in the app data folder. It is outside the backup allowlist, so it is excluded by design, and it is opened only by native code through `rusqlite`. Proposed tables:
- **`cache_meta`:** schema version, extraction version, `building`/`complete` state, and a fingerprint of the main database's identity, used to dispose the cache after restore.
- **`material_extraction`:** material id, the content SHA-256 it was extracted from, extraction version, state (`pending`, `searchable`, `partial`, `needs_recognition`, `missing`, `failed`), page counts by outcome, and a privacy-safe error code.
- **`page_text`:** material id, content SHA-256, physical page index, text and outcome. Printed-page labels and split coordinates come from the existing navigation and lineage data and are not duplicated.

This satisfies OFFLINE-01's requirements:
- **Identity:** content, extraction version and per-page coverage are persisted and bound to the managed revision's hash, and a stale worker cannot publish for a newer hash.
- **Loss and rebuild:** losing or rebuilding the cache never touches originals, guides, cards, notes, histories or annotations.
- **Engine-neutral:** the cache uses plain tables, so it **does not choose the search engine**. OFFLINE-02 can add an FTS5 index (or choose MiniSearch) over `page_text` without re-extracting.

No authoritative schema change is needed for OFFLINE-01, so no migration is allocated. Durable user annotations and manual content (OFFLINE-03) will need authoritative tables later, with their own review.

**Browser mode:** no file import exists there, so no extraction or cache. The library shows today's metadata search, and readiness is shown as unavailable rather than pretending.

### 4.4 Preparation never uploads

Extraction is triggered only by:
- a successful import or replacement;
- an explicit **Prepare for offline study** action;
- a background catch-up limited to local files.

Nothing reads the Gemini key or calls a provider; a regression test asserts that no Gemini code path is reachable from the extraction module.

## 5. Delivery slices

Each slice has focused regressions first, then one normal gate, then Codex review and exact-head CI, then a merge. Nothing moves to the next slice automatically.

1. **OFFLINE-01a, native extraction and cache.** The worker mode; the supervisor with all P54-02 bounds; `content-cache.db` with fingerprint, disposal and crash recovery; the readiness API (Tauri commands that read state and request preparation); and memory option (c).
   - **Tests:** every scenario in the plan's acceptance list that can run natively. That means fresh import, replacement during extraction, deletion, split parts, corrupt and password-protected PDFs, Unicode, text, image-only and mixed pages, cancellation, crash and restart, restore fingerprint, a stale worker, partial coverage, and empty text not counting as searchable.
   - **Fixtures:** synthetic only.
2. **OFFLINE-01b, honest readiness in the UI.** Study Library and the material page show the states (**On this Mac**, **Preparing search**, **Searchable**, **Partly searchable**, **Scanned—text recognition needed**, **Missing**, **Could not process**) in warm, plain wording, with the **Prepare for offline study** action. Existing metadata search is unchanged.
3. **OFFLINE-01c, fidelity and release measurements.** Public-domain FAA handbooks (exact URL, hash and licence note, kept outside Git), plus CID, Unicode, multi-column and table fixtures. Release-profile timing and memory measurements, with real per-page coverage results. These are disclosed honestly, including pages that extract poorly.
4. **Installed acceptance.** On the recorded synthetic lane: import, prepare, restart offline, restore, rebuild. No everyday profile and no provider calls.
5. **Memory option (a)**, only after the owner agrees to the direct `flate2`/`weezl` dependency.
6. **Follow-up:** move existing page counting out of the main process, or bound it. This is listed so the existing exposure stays visible; it is not part of OFFLINE-01a.

## 6. Decisions needed

- **Owner:** approve memory option (a), the direct dependency on already-locked `flate2` (and `weezl`) for bounded decompression. Without it, OFFLINE-01 ships with option (c) and an explicitly documented overshoot.
- **Reviewer:** confirm that a derived cache needing no migration, plus a worker mode in the shipped binary, fit the plan's rules and the data-safety rules.

Search-engine and folding choices remain with OFFLINE-02 and are not decided here.
