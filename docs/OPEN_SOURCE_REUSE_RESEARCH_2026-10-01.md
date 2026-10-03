# Open-source reuse research for Her Flight Deck

Research date: 1 October 2026, Pacific time. Star counts are exact GitHub API snapshots from this research and will change. The requirement was interpreted as **at least 1,000 stars**.

Published to the shared GitHub repository on 2 October 2026. This preserves the October 1 research snapshot, not a fresh claim about current upstream releases. Start from [the shared handoff](PROJECT_HANDOFF.md) and [the Mac continuation prompt](OPEN_SOURCE_MAC_HANDOFF.md).

## Decision

The best opportunities are small components that fit the existing React 19 / TypeScript / Tauri 2 / Rust / SQLite application: large-library rendering, offline search, structured study-file validation, Markdown display, and review scheduling. Keep the current application and database. A wholesale fork of a notebook or flashcard app would introduce more integration and migration work than these targeted additions.

Prioritize **TanStack Virtual**, **MiniSearch**, **FSRS4Anki / Obsidian Spaced Repetition**, and **react-markdown + Zod** after the existing data-safety repairs. These are proposed uses, not measured improvements or approved dependencies. Browser compatibility, licenses of the chosen version/files and regression tests must pass before adoption.

PDF research found a material Mac constraint: current React-PDF documentation requires Safari 18; current PDF.js documentation also lists Safari 18+ for its legacy build. Those releases are not an established solution for the declared macOS 12 target. Evaluate an alternative viewer separately and retain native Open as the fallback. Do not silently raise the supported OS version or assume an older package/polyfill is secure and compatible.

## Search method and scope

Eight GitHub repository queries used `stars:>=1000 archived:false`, covering PDFs, Rust PDF tooling, TypeScript PDF tooling, spaced repetition, flashcards, Tauri notes, TypeScript search and virtualization. Up to 35 results were retrieved per query. After deduplication, **170 qualifying repositories** were screened at the metadata level. This is not a claim to have audited all their source or every GitHub match.

A smaller candidate group received README/license inspection; selected React packages also received peer-dependency inspection. Sources were official repository APIs, repository files and project documentation. No repository setup instructions were executed, app dependencies installed, code copied into Her Flight Deck, benchmark run or PR created for this research.

The local project review covered `ROADMAP.md`, `package.json`, `src-tauri/Cargo.toml` and the Study Library list. The library already shows 100 cards initially and offers another 100 at a time. Virtualization therefore needs a measured benefit over this existing limit; it is not justified merely because lists exist. `lopdf` is already an app dependency.

## Ranked practical candidates

All repositories in this table have at least 1,000 stars. License statements refer to the checked upstream boundaries, not an audit of every transitive dependency.

| Repository | Stars | Checked license | What we could reuse | Fit / decision |
| --- | ---: | --- | --- | --- |
| [TanStack/virtual](https://github.com/TanStack/virtual) | 7,128 | [MIT](https://github.com/TanStack/virtual/blob/main/LICENSE) | Windowed rendering for lists/grids; variable-size measurement patterns | Strong performance prototype for large Study Libraries. Its inspected React package accepts React 19. Keep our styling and data layer. |
| [lucaong/minisearch](https://github.com/lucaong/minisearch) | 6,151 | [MIT](https://github.com/lucaong/minisearch/blob/master/LICENSE.txt) | In-memory offline full-text search, prefixes, fuzzy matches and field ranking | Strong search prototype for titles, tags, notes and saved study content. Bound index memory and update it incrementally. |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4,085 | [MIT](https://github.com/open-spaced-repetition/fsrs4anki/blob/main/LICENSE) | Review-scheduling algorithm/reference implementation | Strong M2 reference. Its Anki scheduler is not a drop-in npm module for our app; adapt only reviewed scheduling logic with equivalence tests. |
| [st3v3nmw/obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) | 2,575 | [MIT](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/LICENSE) | Markdown Q/A and cloze-card parsing, note review, context and due queues | Strong reference for outside-AI study files and review UX. Extract independent pieces; do not bring in Obsidian's plugin runtime. |
| [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) | 15,903 | [MIT](https://github.com/remarkjs/react-markdown/blob/main/license) | Render study guides as headings, lists, tables via appropriate plugins and links | Strong display candidate for imported guides. Inspected package permits React 19. Keep raw HTML disabled and control links/plugins. |
| [colinhacks/zod](https://github.com/colinhacks/zod) | 44,050 | [MIT](https://github.com/colinhacks/zod/blob/main/LICENSE) | Runtime validation of structured imported guides/cards/questions | Strong bounded import boundary. Apply to the new format, not a rewrite of every existing validator. |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | 19,355 | [MIT](https://github.com/radix-ui/primitives/blob/main/LICENSE) | Accessible dialog, menu and tab primitives | Useful incremental usability option where an actual keyboard/focus defect is reproduced. Do not replace all existing dialogs at once. |
| [J-F-Liu/lopdf](https://github.com/J-F-Liu/lopdf) | 2,259 | [MIT](https://github.com/J-F-Liu/lopdf/blob/main/LICENSE) | Rust PDF document handling and upstream examples/tests | Already used. Improve or contribute upstream as justified; do not add a second PDF manipulation engine automatically. |
| [qpdf/qpdf](https://github.com/qpdf/qpdf) | 5,452 | [Apache-2.0](https://github.com/qpdf/qpdf/blob/main/LICENSE.txt) | Independent PDF structural checks and page-selection tooling | Best initial role is developer QA and a comparison tool. Bundling a C++ library/sidecar would need separate packaging and size evidence. |
| [embedpdf/embed-pdf-viewer](https://github.com/embedpdf/embed-pdf-viewer) | 4,523 | [Apache-2.0 SDK boundary](https://github.com/embedpdf/embed-pdf-viewer/blob/main/LICENSING.md) | Embedded viewer SDK and examples, backed by a PDFium-derived runtime | Conditional M4 prototype. Verify exact package licenses, offline WASM/worker loading and macOS 12 WebKit. The separately licensed CloudPDF server is outside this recommendation. |

### Why these are the strongest fits

**TanStack Virtual:** compare the current 100-item rendering approach against a narrow prototype at 100, 1,000 and 10,000 materials. Test variable card heights, filters, selected items, scrolling, keyboard focus and screen-reader access. Use only one virtualization library. An upstream smooth-scrolling claim is not evidence of a speedup in Her Flight Deck.

**MiniSearch:** begin with selected text fields and relevant ranking, not a full duplicate of every PDF in memory. Keep the index derived from committed records; rebuild or invalidate it after restore, failed import, deletion and replacement. Compare existing search and any consistently available SQLite search capability before choosing a new dependency. Avoid storing derived index data as authoritative backup state. Its inspected repository's last push was September 2025; review release maintenance before pinning a version.

**FSRS / Obsidian:** first implement durable card/question IDs, content versions, review events and saved attempts from M2. Then connect a scheduler to explicit user ratings. Port only isolated, licensed logic and verify it against fixed upstream vectors. Freeze the algorithm version in stored scheduling state; test time zones, missed days, repeated submissions and backup/restore. Do not present a review schedule as proof of flight proficiency.

**react-markdown + Zod:** together they fit the planned outside-AI workflow: an assistant produces a structured study file, the app validates it, previews it and imports it deliberately. Markdown alone does not contain a reliable answer key. An offline practice test requires explicit questions, options and answers in the imported format; generating a test from free-form prose still requires a separate generation step. Preserve provenance and require review rather than implying imported answers are correct.

**Radix:** its low-level components can retain our visual style. A small dialog pilot should preserve draft recovery, cancellation, busy guards and focus restoration. Introducing a component library without a demonstrated defect would add churn during release preparation.

**lopdf / qpdf:** retain existing splitting limits, original-file protection, separate records and cleanup boundaries. Use qpdf as an independent check/comparison where helpful, but structural validity alone does not prove the correct pages and images survived. Also compare text, page ordering and rendered fixtures. No PDF engine fixes SQLite transaction or ownership defects for us.

## Conditional alternatives and later-platform options

| Repository | Stars | Checked license | Appropriate use / constraint |
| --- | ---: | --- | --- |
| [nextapps-de/flexsearch](https://github.com/nextapps-de/flexsearch) | 13,804 | [Apache-2.0](https://github.com/nextapps-de/flexsearch/blob/master/LICENSE) | Alternative to MiniSearch when a measured workload benefits from its worker/index options. Compare one against the other; do not install both by default or add a separate database service. |
| [bvaughn/react-window](https://github.com/bvaughn/react-window) | 17,208 | [MIT](https://github.com/bvaughn/react-window/blob/main/LICENSE.md) | Alternative list/windowing library if the selected layout is a better match. Choose it or TanStack Virtual after a small prototype. |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | 53,973 | [Apache-2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE) | PDF viewing/text/annotation reference, conditionally useful for M4. Current browser-support documentation does not establish macOS 12 compatibility, even using its legacy build. |
| [wojtekmaj/react-pdf](https://github.com/wojtekmaj/react-pdf) | 11,186 | [MIT](https://github.com/wojtekmaj/react-pdf/blob/main/LICENSE) | React wrapper for PDF.js. Current default-branch documentation is for 11.x and requires Safari 18 and React 19. React fit is good; the Mac minimum is a blocker to treating it as a drop-in. |
| [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | 17,430 | [Apache-2.0 license option inspected](https://github.com/cure53/DOMPurify/blob/main/LICENSE) | Only if importing/rendering HTML is a deliberate requirement. Safer initial scope is Markdown without raw HTML. Sanitize appropriate content and forbid dangerous URLs; do not assume sanitizing makes executable document formats safe. |
| [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | 38,615 | [MIT core](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md) | Later rich study-guide editing. Review extension licenses; commercial offerings are separate. Do not introduce a full editor merely to display a guide. |
| [groue/GRDB.swift](https://github.com/groue/GRDB.swift) | 8,672 | [MIT](https://github.com/groue/GRDB.swift/blob/master/LICENSE) | Strong SQLite option if the dedicated iOS app uses Swift. Do not replace the desktop Rust driver. Current README lists Swift 6.1+/Xcode 16.3+ and iOS 13+/macOS 10.15+; development-tool requirements differ from end-user requirements. |
| [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) | 8,654 | [MIT](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md) | Secondary PDF algorithm/prototype reference. Inspected last push was July 2024. Not a recommended production replacement for existing Rust splitting without current maintenance, memory and equivalent-output evidence. |

Relevant browser sources: [React-PDF compatibility](https://github.com/wojtekmaj/react-pdf#compatibility), [PDF.js supported environments](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported), and [Apple's Safari 18 platform release](https://support.apple.com/en-us/121241). Apple lists Ventura and Sonoma for that Safari release; this does not establish Safari 18 availability on Monterey/macOS 12. The latest default-branch documentation is not, by itself, proof of the latest published package's status. Pin and verify the exact selected release.

## Larger apps worth studying rather than importing wholesale

| Repository | Stars | License boundary | Useful lessons / reuse decision |
| --- | ---: | --- | --- |
| [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) | 39,710 | [MIT](https://github.com/lfnovo/open-notebook/blob/main/LICENSE) | Source collections, transformations and notebook workflows. The inspected setup uses Python, Next.js/React, SurrealDB and Docker. Borrow narrow concepts or reviewed licensed utilities, not that backend stack. Its README describes citation capabilities as basic; provenance still needs our own checks. |
| [readest/readest](https://github.com/readest/readest) | 24,783 | [AGPL-3.0](https://github.com/readest/readest/blob/main/LICENSE) | Particularly relevant Tauri/TypeScript reading-app reference for navigation and reading UX. Do not copy its code under the assumption that attribution alone satisfies its license. |
| [laurent22/joplin](https://github.com/laurent22/joplin) | 56,556 | [AGPL default with directory overrides](https://github.com/laurent22/joplin/blob/dev/LICENSE) | Resource ownership and mature offline-note workflows worth deeper study. Verify the license of every chosen component; root metadata is not enough. Our archive/restore format must remain ours. |

For any copied code, preserve required license/copyright/NOTICE material, record its upstream URL, commit/version and modifications, and inspect transitive dependencies. GPL/AGPL components need a deliberate compliance decision before incorporation and distribution. Do not copy branding, proprietary question banks, or unrelated licensed content just because an app repository is public.

### Results not suitable for unrestricted reuse

- [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF), **93,409 stars**: the [root license](https://github.com/Stirling-Tools/Stirling-PDF/blob/main/LICENSE) permits MIT reuse outside named exceptions, but lists different licenses for engine and several proprietary/desktop/cloud areas. Its popularity does not authorize taking every PDF operation or desktop component. A file-level licensing review would be needed before selecting a specific utility.
- [PageLM](https://github.com/CaviraOSS/PageLM), **2,025 stars**: its [community license](https://github.com/CaviraOSS/PageLM/blob/main/LICENSE.md) restricts use to personal/educational/non-commercial research purposes. It is not included in the general reusable open-source shortlist.
- Some smaller specialist libraries failed the 1,000-star threshold, and one candidate's root license endpoint did not resolve. Neither was promoted as a verified reusable choice. A failed license lookup is not proof of either permission or prohibition.

## Implementation order for our project

1. **Finish foundation repairs first.** Current A2 atomic material/tag/file ownership work remains its own task. No external package makes a pooled SQLite transaction atomic or fixes cancellation deleting a referenced file. Finish the remaining compatibility/offline-study audit corrections as well.
2. **Measure Study Library performance.** Profile current 100-item display and search at fixed datasets, then compare a narrow MiniSearch or TanStack Virtual prototype only where the baseline exposes a problem. Separate search costs from render costs.
3. **Build M2 durable attempts and review history.** Establish stable content identity, attempts, due queues and backup round trips before attaching FSRS scheduling. Save review state in the existing data model through tested additive changes.
4. **Add outside-AI study import.** Evaluate Zod for a bounded, versioned JSON schema and react-markdown for display. Import explicitly selected local content, preview validation errors, preserve prior content and test cancellation/rollback. Do not auto-upload material or expose provider keys in the webview.
5. **Prototype embedded PDF reading in M4.** Investigate EmbedPDF's Apache SDK as one candidate alongside current PDF.js constraints. Check actual macOS 12 WebKit behavior, WASM/worker memory, file access and offline loading before committing to a viewer. Bundle selected assets locally; no CDN requirement for ordinary offline study.
6. **Keep iOS separate.** GRDB is an option for a Swift client, not authorization to change the chosen mobile framework. The transfer remains explicit Mac backup to iPhone import, with archive validation and Keychain handling rather than automatic sync.

## Tests and measurements required before taking code

- **Rendering/search:** synthetic 100/1,000/10,000-material fixtures; typing latency, filter/sort time, time to usable view, memory and bundle delta. Record hardware, OS, dataset and distributions, not one favorable run. Verify missing/removed/updated items, index rebuild after restore, large notes and keyboard selection.
- **Import/display:** valid and invalid schema versions, Unicode, oversize content, missing/duplicate question IDs, malformed answer keys, raw HTML/script payloads, URL handling, Cancel and failed database save. No arbitrary JavaScript/MDX evaluation of imported guides.
- **Scheduling:** fixed reference outputs, no mutable global hooks, deterministic time, overdue/missed reviews, undo/resubmit, content regeneration, transaction failures, backup/restore and offline use. Do not overwrite older attempt history when questions change.
- **PDF:** long/text-heavy/image-heavy fixtures; ordering, rotations, shared resources and output rendering; preserved original SHA-256; 50 MiB and 1,000-page generated-part limits; failure cleanup and concurrency with autosave/backup. Measure before changing the current splitter.
- **Platforms:** React 19/Vite integration, installed Windows behavior, and real Apple Silicon tests at the declared macOS minimum and a newer OS. CI packaging is not an installed-app smoke test. For a viewer, verify its documented browser baseline and actual WKWebView independently.
- **Licensing/security:** inspect the exact chosen package/tag/files, lock dependencies, scan advisories, capture notices and retain provenance for adapted code. Mixed-license apps require component-level selection.

Follow the existing local-first workflow: focused tests during each task, one complete local gate after corrections, uncommitted implementation for independent review, then one reviewed push and exact-head CI. This research changes no app behavior and makes no performance or Mac-readiness claim.

## Saved evidence

The user's October 1 decision to finish the current task first and adopt only tested, isolated additions is captured in [the adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md). It also explains why Safari 18 is a candidate reader's compatibility constraint rather than a requirement to open Safari when installing the app.

The portable [research evidence snapshot](research/OPEN_SOURCE_SNAPSHOT_2026-10-01.json) contains all eight queries, 170 screened repositories, shortlist threshold receipts, candidate metadata, license lookup boundaries, inspected React peer ranges and SHA-256 receipts for the original evidence files. No Windows path is required to read it.

Full upstream source and license URLs are linked above. Raw third-party READMEs and source trees are not vendored here. Inspect and pin the exact version/files before adoption; the snapshot is research evidence, not a software bill of materials for adopted dependencies. The broad inventory includes comparisons and unresolved licenses; only the ranked/conditional decisions above constitute the proposed shortlist.
