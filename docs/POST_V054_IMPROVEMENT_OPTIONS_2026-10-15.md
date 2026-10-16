# Possible improvements after v0.5.4 — 15 October 2026

**Decision document only. All options below are PROPOSED, not approved implementation work.** The owner wants the next Mac release as soon as practical and will select improvements for the roadmap **after that release**. Do not add these features or dependencies to v0.5.4. Do not treat publication of this document as approval of an option, provider, new data contract or migration. No roadmap/status/handoff file is changed by this research.

## Current app and release context

The source baseline examined is accepted main `7f2a62421cc48679e59e7769c1ee9ca11e02c8e4`. The frozen native v0.5.4 candidate remains e928601. A separate, dirty `codex/v054-desktop-corrections` checkout contains active implementer work. This research did not edit it, run tests against it, install packages, launch the app, touch profiles or make provider requests. Local correction claims remain pending independent review. The immediate release work stays with the correction/review/candidate-verification process in [the native report](MAC_V054_DESKTOP_VERIFICATION_2026-10-15.md) and its [assignment](MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md). No public distribution, signing or release authorization is inferred here.

Existing production functionality already includes Quick Find, library filters and progressive100-item display; imported guides/cards/tests; persistent practice history with a missed/skipped review filter; card due queues with simple-v1 scheduling; chapter extraction/source lineage; debriefs and Skills history; lesson checklists/material links; portable backups; and a first cost-analytics slice. Proposals should extend these, not build parallel systems. M4 navigation/viewer is an existing prototype track with unresolved work, not a shipped reader. M5 requirements/refunds have separate pending decisions.

## Source findings that affect the choices

1. `src/logic/quickFind.ts` searches selected record text: material titles/notes/tags/filenames, note bodies, questions/answers, and other record fields. It does not extract and search PDF page text. Library search explicitly covers titles/notes/tags. This is a functional search opportunity, not evidence that existing search is slow.
2. `src/pages/StudyLibrary/MaterialDetail.tsx` renders guide sections as headings and plain paragraph bodies. It does not use a Markdown renderer. The question/card system already supports source-page fields for some content.
3. `src/logic/studyPacket/payload.ts` explicitly previews outside-import source claims/references but discards them on save; imported card/question sourcePage is null. That is an approved current-format limitation, not a newly discovered release defect. Future persistent references need a reviewed contract and honest unverified labeling.
4. `src/pages/StudyLibrary/StudyLibrary.bench.test.ts` has an opt-in100/2,500/5,000-item server-render benchmark. It explicitly excludes database I/O and native WebView paint. This research ran no benchmark and makes no measured speed or memory claim.
5. The repository has an import flow but no selected-study-packet export flow or calendar export flow identified in the reviewed source. Complete-library backup is already available and serves a different purpose.
6. Existing M2 retains content versions and answers. It already offers review of missed/skipped questions. Existing M3 deliberately keeps learner confidence distinct from instructor/proficiency judgments. New features must preserve those semantics.

## Shortlist and relative effort

Effort is an engineering assessment of integration plus meaningful verification, not a calendar promise. Small means a bounded presentation/export change; medium adds significant integration or persistent state; large includes a document pipeline/runtime, compatibility work or scheduling-state changes. No estimate assumes upstream examples already work in Tauri.

| ID | User-facing outcome | Effort | Initial recommendation |
|---|---|---|---|
| P54-01 | Source-linked reading, named bookmarks and resume position | Medium first slice; large for full embedded reader | Highest-value core continuation |
| P54-02 | Search inside local PDFs and saved study text | Large | Keep, after a narrow extraction/index proof |
| P54-03 | Clearer formatted study guides | Small–medium | Good early improvement |
| P54-04 | Export selected study material to a portable packet/handout | Medium | Good early improvement |
| P54-05 | A focused lesson brief and calendar-file export | Small–medium | Useful optional daily-workflow improvement; its two parts can be selected separately |
| P54-06 | Adaptive flashcard scheduling using FSRS | Medium–large | Later, conditional on package selection and usage |
| P54-07 | Airport weather beside lesson preparation | Medium | Optional provider feature |
| P54-08 | Reviewed FAA reference shelf and optional ACS skill links | Medium; larger for question-source linking | Useful once the training path is selected |

### P54-01 — source-linked reading and bookmarks

**Experience:** reopen a handbook where you stopped; save named pages; use a question/card's source link to reach its actual document and page. Keep split-part page coordinates and printed page labels distinct. This builds on M2 lineage and the existing M4 work rather than replacing it.

**First slice:** reliable document/page destinations, resume position, bookmarks and a clear native Open fallback that displays the requested page when the OS viewer cannot be directed there. Make persistent imported references an explicit optional extension: preserve their provenance as claims, bind selected documents by identity/hash, and never fabricate references for older saved imports. Contract/version/migration and backup impact need review.

**Second slice:** an embedded offline reader with lazy page rendering, zoom and text selection. EmbedPDF's current upstream main warns that v3 is under development and recommends its v2 branch for stable use. Evaluate an exact stable release/artifact; do not copy main or assume that a browser demo proves Mac support. React-PDF's documented Safari18 minimum remains a concern for the declared macOS12 target. [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer), [React-PDF compatibility](https://github.com/wojtekmaj/react-pdf#compatibility).

**Acceptance:** bookmarks/resume survive restart and complete backup/restore; replaced/deleted sources invalidate stale links appropriately; nested split translation stays correct; late callbacks cannot save/publish an obsolete page; native fallback is visible; installed Apple Silicon and supported WebKit testing cover the selected reader. Existing [M4 round4 work](M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md) must be reconciled before a new implementation starts.

### P54-02 — document search, offline

**Experience:** searching “crosswind” finds a passage inside an imported handbook with document title, page and a useful excerpt, alongside related notes/materials. Existing title search remains available before indexing completes.

**Technical choices:** assess SQLite FTS5 for a persistent local index and MiniSearch for a bounded in-memory index with typo tolerance. FTS5 provides full-text queries/ranking; its availability depends on the actual SQLite build. MiniSearch supports fuzzy/prefix matching and updates in memory. Neither extracts PDF text or performs OCR for us. Start with text-bearing PDFs, saved guides and notes; mark image-only scans as not indexed rather than returning a misleading empty result. [SQLite FTS5](https://www.sqlite.org/fts5.html), [MiniSearch](https://github.com/lucaong/minisearch).

**Tradeoffs:** text extraction, page identity, background cancellation, memory and index freshness are the substantial work. Keep derived text/indexes rebuildable and separate from authoritative user data; original PDFs/bookmarks remain protected by backups. Bind cached extraction to content hashes and invalidate it after replacement/restore. OCR is a later independent choice.

**Acceptance:** real100/1,000/10,000-material fixtures; cold indexing and warm search measured separately; native painted interaction and memory observed; edits/deletes/replacements/restores cannot yield stale results; malformed PDFs and cancellation recover; query syntax handled safely. Choose an engine after measurements, not before. No speedup is claimed by this document.

### P54-03 — readable formatted guides

**Experience:** study-guide bodies display lists, emphasis, quotations, and comparison tables instead of showing Markdown punctuation as ordinary text. Existing plain guides remain readable.

**Candidate:** react-markdown, with a narrowly selected GFM extension only if tables/task-list syntax is chosen. Its default renderer avoids raw HTML execution, but custom URL handlers/plugins/components still need review. Plan to skip raw HTML, retain controlled external-link handling and avoid automatic remote images. This improves presentation; it does not validate an imported answer's correctness. [react-markdown](https://github.com/remarkjs/react-markdown).

**Acceptance:** plain and formatted old/new guides, long words/tables, keyboard/screen-reader structure, dangerous URLs, raw HTML and remote image inputs; offline behavior; exact pinned package and notices; actual older WebKit compatibility. No Tiptap/full editor is needed for this slice. Adding a renderer must not silently promise support for HTML/MDX import.

### P54-04 — selective study export and handouts

**Experience:** select one guide/card/test set and save a portable study packet, or print a readable handout, without sharing the entire application backup. Useful for another assistant or deliberate instructor review; no automatic external sending.

**Approach:** use our existing hfd-study-packet contract and validator for compatible exports. A new library is not automatically necessary. Serialize explicit choices/answer keys consistently; make inclusion clear. Do not imply a content export contains attempt history, review schedules, Skills records or full-library restore state. Preserve legacy/imported provenance honestly and never export provider credentials or unrelated profile/flight/finance records.

**Acceptance:** export→validate→preview→import round-trip content equivalence; generated and imported sources; unsupported/malformed legacy content gets a clear refusal/preview; create new identities on import without rewriting past attempts; save-dialog cancellation and failure; selected content only. Existing v1's discarded-reference limitation must be disclosed; richer reference export belongs to the separately reviewed P54-01 contract extension. Printable handouts are an optional second output, not a new backup format.

### P54-05 — lesson brief and calendar export

**Experience:** one readable briefing brings together the existing lesson preparation checklist, linked reading, chosen questions and recent selected follow-ups. A separate “Add to calendar” action exports the lesson as an .ics file for manual import into a calendar application.

**Approach:** reuse existing schedule/preparation data. iCalendar is a published interchange standard, so a standards-based exporter can be assessed before adding a library. This proposal does not include two-way synchronization, account credentials or background calendar permissions. The initially inspected adamgibbons/ics repository is below the owner's1,000-star threshold; it is not an approved dependency. [RFC5545](https://www.rfc-editor.org/rfc/rfc5545), [ics candidate](https://github.com/adamgibbons/ics).

**Acceptance:** local times, explicit zones, DST, all-day events and missing time fields; stable event identity; cancellation and rescheduling behavior clearly explained. Reimporting a file must not be marketed as reliable live synchronization. Brief generation includes only chosen content and excludes unrelated private notes. The brief and calendar export can be approved independently.

### P54-06 — adaptive flashcards

**Experience:** card return dates respond to actual review history rather than the fixed simple-v1 ladder. A daily review limit and clear upcoming workload could be assessed alongside scheduling, without implying flight proficiency.

**Candidate:** FSRS. The original FSRS4Anki research reference remains relevant. Current organization projects offer TypeScript and Rust implementations, but the repository pages inspected show fewer than1,000 stars for ts-fsrs and fsrs-rs. Those do not satisfy the owner's original direct-adoption threshold; record a future explicit exception or select another compliant integration route before taking code. They are not drop-in approval just because the algorithm reference qualified. [FSRS4Anki](https://github.com/open-spaced-repetition/fsrs4anki), [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs).

**Tradeoffs:** the app already has a functioning scheduler. New scheduling must preserve native-authoritative writes, old review events and algorithm-version semantics; avoid two disagreeing TS/Rust schedulers or silently rewriting old history. Full parameter optimization is separate from scheduling and need not be part of the first slice.

**Acceptance:** fixed reference vectors, timezone/clock boundaries, Again/Hard/Good/Easy, overdue cards, double submission, rollback, version transition, regeneration and backup/restore. Measure user-facing behavior and due workload; do not claim a demonstrated learning improvement from unit tests. Recommend after practical use of v0.5.4 shows a benefit is needed.

### P54-07 — airport weather in lesson preparation

**Experience:** select a lesson airport and view its METAR/TAF with issue time, fetch time and the original report. The existing daily plan/lesson detail is the natural location.

**Provider:** Aviation Weather Center's official API supports observations and forecasts. Its current documentation says browser cross-origin access is not permitted and requests are rate-limited. A desktop implementation should therefore assess a bounded Rust-side request and cache, rather than assume a browser fetch will work. [Official API](https://aviationweather.gov/data/api/).

**Tradeoffs:** a network feature and provider contract review are added; airport matching and freshness matter more than a decorative weather card. Raw reports and observation/forecast distinction should remain visible. This is lesson-preparation context, not a go/no-go or flight-briefing decision.

**Acceptance:** timestamp/timezone and forecast validity, no-data/204, rate-limit429, outage/offline cache clearly labeled with age, stale refresh suppression and no implied live status. Only requested station data is sent, not personal training history or documents. No weather call was made during this research. Prior WX-01 approval remains a separate decision.

### P54-08 — official reference shelf and ACS links

**Experience:** keep a reviewed set of FAA references available offline, with publication identity/revision and deliberate refresh. Optionally link a skill or question to an appropriate ACS task/reference so the learner can inspect the official source.

**Source:** the FAA publishes the Airman Certification Standards and companion material. Begin with a chosen training path and reviewed mapping; retain the15 built-in skills/custom skills. A code or reference is not an FAA question bank, endorsement or certification-readiness verdict. [FAA ACS index](https://www.faa.gov/training_testing/testing/acs).

**Tradeoffs:** subject-matter review and revision handling are the essential work. Selecting ACS mappings is distinct from adopting the currently unapproved M5 requirement/eligibility proposal. Do not infer qualifying hours or official instructor sign-off from a study score.

**Acceptance:** exact publication/version/source links and last-checked date; valid/invalid/unknown mappings, changed or retired tasks, retained history and offline opening. A knowledgeable instructor/human review precedes publishing mappings. Prior FAA-01 approval remains separate.

## What I would not prioritize immediately

- **Virtualization:** retain TanStack Virtual/react-window as conditional performance tools. Progressive100-item rendering already exists. Measure real scrolling/typing before adding one. [TanStack Virtual](https://github.com/TanStack/virtual).
- **Full rich-text editor:** Tiptap is a separate editing product surface; P54-03 can improve reading without it.
- **OCR, voice ATC, broad AI assistants and cloud sync:** each expands complexity substantially; establish the basic reading/study loop first. No source content, microphone data or personal record upload is authorized by this research.
- **New cost dashboards or requirement engines:** a first cost slice already ships, while refunds and RQ-D1–D7 are pending. Reuse those existing proposals instead of creating another overlapping workstream.
- **Wholesale app imports:** Open Notebook, Readest and Joplin remain design references; none is a shortcut around our data/backup/runtime requirements.

## Suggested decision and sequence

My engineering recommendation is to consider keeping **P54-01, P54-03 and P54-04 as the first group**, followed by **P54-02 after the extraction/index proof**. These are complementary: readable content, portable content, source context and finding the right passage. They can operate offline without another AI provider request. P54-05 is an independent convenience choice; P54-06–08 should be separate later decisions.

Approval can select only part of an option (for example bookmarks without an embedded viewer, or lesson briefs without calendar export). After the next release, reconcile selected IDs with the existing M2/M4/M5/M6 roadmap and record the chosen scope, acceptance checks and owner. Do not duplicate existing M4 implementation ownership or silently turn research into dependency approval.

These are researched options rather than tested integrations; no performance or Mac-compatibility improvement is claimed. No dependencies were installed and no application test/build was needed for this document. Exact versions/licenses/transitive assets and the owner's repository-selection criteria must be checked again when a component is actually proposed for adoption.
