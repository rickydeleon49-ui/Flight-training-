# Offline study, homework and export: owner-approved delivery plan

## Authority and order

On 18 October 2026 Pacific, the owner approved these additions and explicitly chose **“Yes—prioritize offline study → homework → exports”** after the current release and any task already underway. The owner clarified that searching a subject should retrieve PDF information as well as saved study content.

This priority supersedes the older unstarted scheduler → weather → FAA next-task order. Finish the current release obligations and already-assigned work; then deliver the sequence below in independently reviewable slices. Preserve P54-06/PR210 work and its accepted evidence, P54-07 weather, P54-08 FAA references, STUDY-HUB-01–08 and OSS-01–06. Their remaining work stays queued, with overlapping prerequisites reused here. Do not restart or discard completed proofs, adopt a scheduler, or launch a second search/export implementation.

**Approval is for product scope and prioritization.** It does not select a package or OCR/model asset, approve an unreviewed schema contract, or establish installed behavior. This planning change performs no application/profile/provider/release operation. Recheck the live release/task state before starting: the inspected STATUS at main `e42e2b3125ceff6572dd10877e6bfc9507335c19` reports v0.5.7 published; that historical report is not a new release verification by this task.

## Foundation already present; gaps to implement

| Existing source at the inspected main | Reuse and remaining gap |
| --- | --- |
| Managed originals in `src-tauri/src/documents.rs`; stored paths are relative to documents/ | Read the app-owned file using its actual contract, never an assumed app-root path. Moving the original external file should not break study. |
| Saved guides/cards/tests and `MaterialDetailOffline.test.ts` | Preserve their independent availability when Gemini is disconnected, slow or unavailable. This is not new offline AI generation. |
| `src/logic/quickFind.ts`, library filters and topics/tags | Existing record/metadata lookup is not a production index of PDF passages and every saved guide/card/question. Extend one coherent search experience. |
| P54-02 search evaluation and accepted phase-2 proof | Reuse FTS5/MiniSearch comparisons and fixtures. The proof met 8/10 measured targets; warm-query/RSS misses, hard memory enforcement, native fidelity and production decisions remain open. Proof acceptance does not close these gates. |
| Next actions, material notes, lesson preparation, card/practice histories | Extend these relationships for assignments and manual study; preserve identities and outcomes. An assignment is more structured than a single existing next action. |
| `ExportStudyDialog`, `studyExport`, `studyHandout` and native `study_export.rs` | Share or print already exports one material's chosen guide/cards/questions as v1 JSON or self-contained printable HTML. Add discoverability, bulk handouts and CSV without replacing validated save/import behavior. |

## Delivery map

| Order | ID | Deliverable | Dependencies / review boundary |
| --- | --- | --- | --- |
| 1 | OFFLINE-01 | Local content inventory, extraction/readiness contract and rebuildable cache | Reuse P54-01/02 and HUB-01/08. Resolve production extraction/resource gates before shipping a parser. |
| 2 | OFFLINE-02 | One subject search across eligible PDF passages and saved study content | OFFLINE-01; actual native engine decision and unchanged-area P54-02 evidence. |
| 3 | OFFLINE-03 | Manual study content and source-linked annotations | Reuse existing notes/bookmarks/card-version contracts; review new provenance/edit persistence before coding. |
| 4 | HOMEWORK-01 | Homework view, linked activities and lesson/daily-plan integration | Use available offline content; reuse actions/preparation and HUB-04/07. Split persistence and UI into separate reviewed slices if needed. |
| 5 | EXPORT-01 | Discoverable export center and selected multi-material handout | Reuse P54-04 and existing native atomic saves; no incompatible v1 JSON aggregation. |
| 6 | EXPORT-02 | Portable flashcard CSV and improved print/PDF workflow | EXPORT-01; explicit CSV safety/fidelity contract and physical print/import checks. |

**OFFLINE-02-OCR** is the explicit scan-coverage subtask: detect scans from OFFLINE-01, compare native Mac recognition with the existing Tesseract shortlist, and implement one approved bounded lane. A text-PDF search slice can be accepted with scans clearly marked unavailable; it cannot claim all PDFs are searchable. Unresolved OCR adoption need not hold homework/export for already-readable sources. Preserve this subtask visibly until scan coverage is verified.

## OFFLINE-01 — Local content and honest readiness

### Product behavior

- Imported originals, saved guides, cards, practice questions, notes and saved assignments stay usable after a restart with no Gemini connection. Local reading/search requires no key and must not wait for a provider-status check.
- Keep source availability separate from search readiness: a PDF can be available to read while its text is unindexed, partial or unreadable. Show clear states such as **On this Mac**, **Preparing search**, **Searchable**, **Partly searchable**, **Scanned—text recognition needed**, **Missing**, and **Could not process**. Do not imply the generic labels alone are final UI copy.
- Persist content identity, extraction version, per-page coverage and errors. Bind text/page spans to the actual managed document revision; preserve PDF page, printed-page labels and split/original coordinates separately.
- Build text/search caches as derived data. Losing or rebuilding a cache must not lose originals, guides, annotations, homework, review history or correction records. Restoring a backup invalidates incompatible derived data and rebuilds it safely. Durable user annotations and manual content belong in authoritative backup data.
- Prepare only local content. Opening the library, starting the app or pressing a local “Prepare for offline study” action must never silently upload documents or generate material with Gemini.

### Acceptance

Verify fresh import, moved external original, replacement during extraction, deletion, split descendants, corrupt/password-protected PDFs, Unicode, tables/multi-column pages, text/scanned/mixed pages, cancellation, crash/restart and restore. A stale worker cannot publish text for a newer source. Partial extraction reports exact coverage and retains its failures; empty extracted text is not successful comprehensive indexing.

Use bounded reads/IPC, independently terminable extraction, enforced request/time/output limits and a defensible whole-process memory strategy. The old sampled watchdog is not a hard memory cap. Preserve its missed measurements and resource/fidelity decisions; do not relabel them passed or move unbounded decompression into the main app process. Pin any extractor and its shipped assets, verify licenses and supported macOS behavior before production adoption. Browser mode must retain an honest metadata fallback if its actual SQLite/runtime cannot support the desktop content engine.

## OFFLINE-02 — Search a subject and find the related study material

### Search contract

- One Study Library search defaults to the entire eligible **study collection**, with filters for topic/tag, material, content type and document revision. It is not an unrestricted search of the Mac or the finance/key/profile directories.
- Include readable PDF passages, saved guide sections, card fronts/backs, practice-question stems, personal study notes, linked instructor questions and homework. Later activities appear when their storage contract ships. Identify coverage by category so “no match” is distinct from “some documents have not been indexed.”
- A query such as **crosswind landing** returns grouped, ranked matches with document/material title, type, a short escaped snippet and a usable destination. A PDF hit opens the correct managed revision/page, with native Open fallback if the embedded reader cannot support the Mac. A card/question/note hit opens that actual record.
- Distinguish literal passage matches from topic-related suggestions. Topic synonyms/aliases must be inspectable and deterministic; local retrieval must not fabricate a synthesized AI answer or pretend every related item contains the query text.
- Keep aircraft and publication revisions visible. Do not merge contradictory aircraft-specific limits or procedures into a single asserted fact. Respect existing practice-test answer-reveal rules: snippets must not bypass an active attempt's hidden-answer contract.
- Bound query length/complexity, result payloads and pagination. Escape snippets and treat imported text as data, never HTML, executable queries or instructions. Stable result ordering, keyboard navigation and clear empty/error/partial states are required.

### Acceptance and engine decision

Choose the smallest adequate production approach using the [research](OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md) and P54-02 evidence. Native SQLite FTS5 is the leading existing-infrastructure candidate; MiniSearch remains the measured alternative. This roadmap does not adopt either or authorize putting an FTS5-only migration into the browser/shared authoritative database.

Before engine integration, document the exact query semantics (words, quoted phrases, case/diacritic folding, optional prefix/typo behavior), limits, native/browser fallback and unresolved production isolation decisions. Reuse previous pre-registration; record any changed targets before measurement. Measure cold indexing/restart, warm p50/p95 query time, worst-case payload, total derived storage and whole-process peak memory on recorded hardware and representative corpus sizes. Do not accept a fast mock or metadata-only benchmark as PDF passage performance.

Regression corpus: text PDFs, scan-only and mixed PDFs, rotated pages, multi-column layouts, ligatures, Unicode/symbols, repeated topics across sources, superseded revisions, split-page mapping, corrupt files, huge compressed pages, deleted/replaced material, interrupted rebuild and restore. Assert expected hits and exclusions, not just nonempty results. In a network-denied installed synthetic lane, restart and search with no key: the results and source destinations must still work and no provider request may occur.

## OFFLINE-02-OCR — Searchable scans

Detect and label unreadable pages first. Evaluate one native Mac text-recognition lane against Tesseract.js/native Tesseract using the same owned scan/mixed-page fixtures. Tesseract.js does not accept PDFs directly: page rendering plus worker/WASM/language data must be accounted for. Check actual minimum-macOS compatibility, offline asset availability, recognition quality, per-page progress, cancel/restart and CPU/memory/storage bounds.

Bundle approved assets or provide a deliberate, disclosed initial asset download; do not claim fresh-install air-gapped readiness when a download is still required. Once assets exist, OCR and search must not need a provider. OCR results retain page and engine/version provenance and visible uncertain/missing regions. They are derived text, not verified aviation facts. Replacing the PDF invalidates stale OCR. Do not add two engines or a cloud OCR service by default.

## OFFLINE-03 — Create and keep useful study material manually

Let the user write a summary/guide, create or edit cards and practice questions, and attach source-linked notes/highlights without Gemini. Reuse existing bookmarks and annotations where they satisfy the need; review a minimal anchored-highlight design rather than replacing the reader/editor stack. An anchor binds to a document revision and page/passage and becomes explicitly stale on replacement rather than drifting to unrelated text.

Manual content must be labeled **user-created** or **instructor correction**, with deliberate provenance, not passed through the current AI-generated default. Review storage/render/export provenance together. Preserve original/imported text, deliberate edits, card/practice version identities and historical outcomes. Regeneration must not silently overwrite edits; reuse HUB-03's change-preview/version contract when needed. Support duplicate-action guards, atomic failure behavior, cancel, deletion, restart, and complete backup/restore. Do not add a rich-text framework or offline language model merely to create basic notes/cards.

## HOMEWORK-01 — One place for assigned and self-directed study

### Default product scope

- A **Homework** view inside Study Library with upcoming/in-progress/completed filters. An assignment has a title, optional instructions, optional due date and optional instructor/lesson association. Enrollment, school, instructor and due date are never required.
- One assignment can contain ordered activities: read a selected document/page range; review a selected card set; take a selected practice test; write a reflection; prepare instructor questions; or a simple manual checklist item. Link the actual material/content identity, not only a display title. New homework can also exist before any document is attached.
- Example: **Before Saturday: read chapter 6 pages 4–12; review the linked cards; take the linked quiz; write two questions.** The assignment remains available offline and links back to its sources.
- Reuse next actions and lesson-preparation selectors through one reviewed ownership contract. Do not create duplicate daily-plan actions or a second scheduler. Explain why homework appears in the daily plan, preserve user-pinned work and session stability, and link back to the assignment.
- Keep activity completion, assignment completion, test scores, recall and proficiency distinct. Opening a PDF or clicking a card is not automatic mastery. Define each auto-completion criterion before implementing it; allow explicit manual completion for reading/reflection. Display recorded quiz outcomes without silently changing the assignment's pass rule.
- Completion history survives edits. Changing a due date or reopening homework does not erase attempts/reviews. If a linked source or test version is replaced/deleted, keep the assignment and history with a repairable warning. Never count an unrelated later attempt or a stale callback toward completion.

### Persistence and verification

Start with a short additive schema/domain proposal: assignment/activity identities, ordered relationships, states, revisions, completion evidence, deletion behavior and links to actions/events. Use the next available migration only after review; never change shipped SQL. Plan repository parity, restore validators and forward/older-version limitations explicitly. Preserve backups and test failure halfway through multi-activity save, repeated clicks, simultaneous windows, stale completion, activity reorder, reopened work, missing links, canceled/rescheduled lessons, date boundaries/timezones, app restart and backup/restore. Accessibility and local date semantics reuse the current app contracts.

No instructor portal, messages, automatic sharing, school account, calendar sync or external task service is part of the first homework release. Instructor questions stay local until deliberately exported through a later supported selection.

## EXPORT-01 — Easy-to-find exports over the accepted implementation

- Add an obvious **Export / Print** entry from Study Library and retain the per-material Share or print action. Preview selected material titles, included parts, counts, formats and whether answers are included before saving.
- Support selecting multiple materials for a single organized **printable handout**, with distinct material headings, per-section source/provenance labels, stable ordering and an optional separate answer-key section. Do not silently include personal notes, homework instructions, instructor/journal content, history, settings, paths or credentials. A future “include notes/homework” option needs explicit selection and its own export contract.
- Continue to offer validated v1 JSON study packets for **one material**. Multi-material JSON is not the current v1 contract: do not combine several sources into one packet and silently lose relationships. A re-importable multi-material container requires a separately reviewed format/import extension; initial bulk handouts do not depend on it.
- Retain current native atomic save, chosen-destination and source/session ownership behavior. Cancel, double-click, material switch, replacement during save, disk-full/write/rename failure and oversized output must not produce a false success or overwrite another session's status. Do not change the existing format's limits silently.
- Full-library backup remains a separate recovery operation. A portable study export excludes original PDFs and review/attempt histories unless a future format explicitly supports and discloses them.

## EXPORT-02 — Flashcard portability and dependable paper study

Add a bounded UTF-8 CSV export for selected cards: front, back, material title and supported source label/page/provenance. Choose and document delimiter/header/newline/quoting rules and retain exact card ordering. Test commas, quotes, multiline text, Unicode, blank optional fields and spreadsheet formula prefixes. Spreadsheet-safe escaping must be disclosed and must not mutate the saved cards; do not claim protected spreadsheet output is automatically lossless in every flashcard importer. Keep the existing validated packet route for app-to-app interchange.

Test an explicit card-field mapping against a named external importer before advertising compatibility. Anki's documented UTF-8 separated-field import is a format reference, not authorization to install Anki or add its code/dependencies. No .apkg generator or scheduling-history transfer is needed in this slice.

Improve the existing self-contained handout and explain **open → print → Save as PDF**. Provide readable guide formatting, flashcard front/back or question/answer sheets and practice questions with an optional separate key. Unchecked answers must be absent from the artifact, not hidden only by CSS. Test Letter/A4 pagination, long cards/tables, missing glyphs, page breaks, accessible reading order and offline fonts/styles; no remote images, scripts or font fetches.

One-click direct PDF is a conditional follow-up only if the native/HTML print route cannot meet the agreed workflow. Evaluate the existing route first, then at most one renderer using the research; do not add both pdf-lib and PDFKit. Any binary PDF output needs its own bounded native byte-save contract and installed visual verification, not base64 shoved through an existing text/JSON command.

## Implementer entry point and stopping rule

1. Fetch, inspect current release/assigned-task state and read the top of ROADMAP, STATUS and PROJECT_HANDOFF. Preserve dirty work; reuse a suitable clean isolated worktree. Start no parallel competing implementation.
2. After release obligations/current assignment finish, start **OFFLINE-01 only**, with an exact source inventory and bounded extraction/cache production-gap closure proposal. Reuse the accepted P54-02 proof and its open findings. Routine UI choices can be resolved locally; do not reopen the owner's product-priority decision.
3. If an existing approved dependency/schema decision does not cover the needed change, present one concrete proposal with evidence and impact. Do not install candidates solely because they meet the star threshold. Independent review must resolve remaining production/adoption gates before that code ships.
4. For each implementation slice, run focused regressions first, then the applicable normal source gate once. Preserve failures, record source hashes and exact exits, update the trackers, and leave one report with a precise next reviewer prompt. Independent review and green exact-head CI are required before integration. Agents do not automatically publish or expand into the next slice.
5. Installed acceptance uses a recorded synthetic lane and exact candidate identity. No source-suite result establishes native PDF navigation/printing, scan quality, accessibility, supported-Mac coverage or a real offline workflow. Do not launch into an everyday profile or make provider calls to implement this plan.

Related plans: [Study Hub](STUDY_HUB_ROADMAP_2026-10-17.md), [existing OSS shortlist](STUDY_HUB_OSS_RESEARCH_2026-10-17.md), [new focused research and verified repository snapshot](OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md), [P54-02 acceptance and open limits](P54_02_PHASE2_ACCEPTANCE_2026-10-17.md), [P54-04 implementation](P54_04_STUDY_EXPORT_REPORT_2026-10-16.md).
