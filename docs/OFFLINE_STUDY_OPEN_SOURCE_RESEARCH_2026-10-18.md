# Focused open-source research: offline study, homework and exports

**Research and evaluation recommendations only; nothing installed or adopted.** Local date: 18 October 2026 Pacific. App source inspected at main `e42e2b3125ceff6572dd10877e6bfc9507335c19`. This extends the [17 October shortlist](STUDY_HUB_OSS_RESEARCH_2026-10-17.md) and supports the [owner-approved delivery plan](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md).

GitHub API metadata was refreshed for each actual repository. All seven meet the owner's **at least 1,000 GitHub stars** criterion and were not archived or disabled at retrieval. [Machine-readable snapshot](research/OFFLINE_STUDY_OSS_SNAPSHOT_2026-10-18.json) contains the UTC retrieval time, stars, default-branch commit, last push, license path/blob and SHA-256 of license text fetched at that commit. MIT/Apache license headers were checked; transitive/distributed-package/font/model review remains an adoption task. Counts and branch tips change; these are dated observations, not permanent guarantees.

## Recommended decisions for implementation planning

1. **Reuse the native SQLite FTS5 versus MiniSearch work.** Leading candidate: FTS5 in a disposable derived native cache, conditional on closing P54-02 production/resource/fidelity decisions. Keep MiniSearch as the existing measured alternative. No new search server, vector database or agent framework is justified by offline subject lookup.
2. **Reuse the managed-document and PDF extraction/navigation contracts.** PDF.js remains a conditional compatibility candidate, not an automatically suitable macOS12 reader/parser. Searchable text must come from a verified local extraction lane; existing parser proofs do not establish installed reading or safe memory use.
3. **Detect scans before choosing an OCR engine.** Compare macOS-native recognition with one Tesseract option on the same fixtures. OCR is the extra step that makes image-only PDF pages searchable. It is not supplied by a full-text search library.
4. **Homework needs app-domain work, not a third-party task-management platform.** Reuse SQLite relationships, next actions, lessons and existing UI. Add no cloud/task/graph service just to build an assignment checklist.
5. **Extend the accepted export and native atomic-save implementation first.** Small CSV export may need no dependency. PapaParse is a focused candidate if its tested writer saves meaningful work. Preserve printable HTML/Save as PDF before considering a direct PDF renderer.

## Candidate map and limits

| Actual repository | Stars at retrieval | License header checked | Role and decision |
| --- | ---: | --- | --- |
| [lucaong/minisearch](https://github.com/lucaong/minisearch) | 6,172 | MIT | Existing alternative for local text ranking/prefix/fuzzy lookup. In-memory index: measure whole-process memory and rebuild cost. Not PDF extraction, OCR or source verification. Reuse P54-02 evidence. |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | 54,013 | Apache-2.0 | Existing PDF viewing/extraction candidate. Keep the pinned M4/P54 evidence and actual WebKit compatibility gates; no unreviewed current-version upgrade. |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | 38,771 | Apache-2.0 | Conditional OCR of rendered page images. Needs worker/WASM/language assets and page-rendering/resource accounting. Compare with native Mac recognition before adoption. |
| [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | 77,065 | Apache-2.0 | Alternative native OCR engine, not a second required dependency. Native packaging, architecture, trained-data licensing and resource bounds remain work. |
| [mholt/PapaParse](https://github.com/mholt/PapaParse) | 13,590 | MIT | Focused candidate for correct CSV serialization and optional formula-prefix protection. Basic bounded export can also use a small tested writer; do not add it merely for one formatting helper. |
| [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) | 8,662 | MIT | Deferred direct-PDF creation/modification candidate. Does not provide a ready-made formatted-study-guide layout. Snapshot last push is July2024; reassess maintenance/security and font/layout work at adoption. Not selected as a text-search extractor. |
| [foliojs/pdfkit](https://github.com/foliojs/pdfkit) | 10,721 | MIT | Conditional direct-PDF renderer if the accepted print workflow is inadequate. JavaScript PDFKit, distinct from Apple's native PDFKit. Compare one pinned release, offline fonts, browser-build integration, layout and resource use with the existing route. |

## Why SQLite FTS5 is the leading existing-infrastructure candidate

[SQLite's FTS5 documentation](https://sqlite.org/fts5.html) describes full-text matching, ranking and snippet/highlight functions. This can support local passage lookup without sending a query or document to a provider. It is a text index: extraction, source identity, per-page coverage and safe result rendering remain app responsibilities.

The app's [P54-02 evaluation](P54_02_SEARCH_EVALUATION_2026-10-16.md) tested the locked native SQLite and browser sql.js builds: native FTS5 worked; browser FTS5 did not. A shared authoritative FTS5 migration would therefore be inappropriate. A separate rebuildable native cache with honest browser metadata fallback was recommended in the proof, but has not been adopted by this document.

The [accepted phase-2 proof](P54_02_PHASE2_ACCEPTANCE_2026-10-17.md) still has warm-query/RSS misses and unresolved hard memory enforcement, real-PDF/native fidelity and production choices. Do not rerun accepted lifecycle proofs unnecessarily, or replace failed targets with easier ones after measurement. Close actual gaps before shipping content search.

## MiniSearch, PDF.js and OCR qualifications

[MiniSearch's upstream README](https://github.com/lucaong/minisearch#features) explains its in-memory offline use and local resource assumptions. This fits a bounded collection; it does not establish acceptable memory for the app's larger corpus. Last push was September2025 at this snapshot, which is a maintenance signal to inspect, not proof of abandonment or suitability.

[PDF.js's current compatibility FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) lists Safari18+ even for the translated/polyfilled legacy build. The app's supported-Mac minimum is older. Pin and test the actual runtime path rather than infer compatibility from the word legacy. Existing native extraction and source-navigation work should be reused before any new embedded renderer is selected.

[Tesseract.js's project scope](https://github.com/naptha/tesseract.js#project-scope) and [FAQ](https://github.com/naptha/tesseract.js/blob/master/docs/faq.md) state that it does not take PDFs directly. Rendering pages to images is a separate stage. An air-gapped implementation must account for bundled worker/core/language files, pixels, concurrency, cancellation and peak memory. Do not silently use a CDN or cloud fallback.

[Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images) is a relevant native-platform comparison, not an open-source package or a repository qualifying through stars. Verify the chosen API, language assets and behavior on the app's actual supported Macs; do not substitute an API requiring a newer macOS without a reviewed compatibility plan. Benchmark scan quality and resource use before recommending a winner. Neither OCR lane was installed or benchmarked in this planning task.

## Export candidates and concrete boundaries

[PapaParse's documented `unparse` API](https://www.papaparse.com/docs) supports CSV writing and configurable formula escaping. Spreadsheet safety can change the serialized field spelling. Make that policy visible, preserve the database text and test external-import fidelity; do not treat CSV escaping as authentication or a universal lossless interchange guarantee.

[Anki's official text-import manual](https://docs.ankiweb.net/importing/text-files.html) documents UTF-8 separated fields and field mapping. Use it as a concrete optional interoperability target for front/back/source columns. Do not advertise .apkg or scheduling-history interchange merely because a CSV can be imported. No Anki code/package is proposed.

The current HTML handout is already self-contained and uses the reviewed formatter/save path. Direct PDF adds a separate renderer and binary-output/save contract. [pdf-lib's README](https://github.com/Hopding/pdf-lib#fonts-and-unicode) describes custom-font handling and standard-font character limitations; Unicode and pagination need deliberate work. [PDFKit's getting-started guide](https://pdfkit.org/docs/getting_started.html) and [text documentation](https://pdfkit.org/docs/text.html) describe browser output and layout/font APIs; inspect a pinned released build rather than assume the current site matches it. Font assets/licenses, supported WebKit, memory limits, accessibility, printed page breaks and native saves need evidence. Adopt neither renderer unless it materially improves an approved workflow over HTML printing.

The existing v1 study packet is one-material interchange, not a multi-material library container. Preserve its validator/equivalence checks and history exclusions. Bulk printing does not authorize inventing a new JSON schema or replacing complete backups.

## Adoption gate and scope of this research

For any candidate actually proposed: record an exact released version/source pin, real repository eligibility at decision time, license/transitive/font/model notices, advisory/maintenance review, bundle and asset impact, supported-Mac/native/browser behavior, and measured performance against declared fixtures. Add only the approved necessary dependency after independent review. A core-library license does not automatically license language data, fonts or models.

No local LLM, semantic embedding engine, second cloud AI provider or large orchestration framework is needed for the initial offline retrieval/homework/export scope. Existing conditional semantic research stays deferred until a measured lexical-search gap. No dependency, lockfile, schema, app code, key, profile or installer changed during this research; no library benchmark or installed compatibility pass is claimed.
