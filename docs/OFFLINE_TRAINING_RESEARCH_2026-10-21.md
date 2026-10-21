# Offline flight-training differentiation: research — 21 October 2026

**Research and planning only.** Requested by the owner after discussing six ways Her Flight Deck could stand out from NotebookLM. No feature, package, migration, provider request, installed test or release was performed. The proposed delivery contracts are in the [implementation roadmap](OFFLINE_TRAINING_ROADMAP_2026-10-21.md); the main [ROADMAP](../ROADMAP.md) remains the priority authority.

Repository inspected: `rickydeleon49-ui/Flight-training-`, main **`2b5b146543e1dfa30e056ab416ee9067a3b6fe5e`**, through merged PR #256. Package version is 0.5.7; schema registration reaches migration 0020. Research was performed from Windows. Statements below distinguish observed source, documented external capabilities, and proposed behavior. Old reports saying a feature is uncommitted are not used to override newer Git history.

## 1. Conclusion and corrections to the initial suggestions

Build around a repeatable outcome: **prepare for a lesson, study the relevant source, remember the difficult parts, preserve what the instructor corrected, and carry the work safely to the next device.** Deliver that routine with reliable local storage and honest availability indicators.

Three corrections matter:

1. Google already documents card/quiz explanations, remembered flashcard progress, resumption, and missed-card practice. Basic quizzes and remembering wrong answers are competitive basics, not a unique advantage. [G1]
2. This repository already implements much of the foundation. Saved attempts, card reviews, manual authoring, page identities, PDF-derived kits and homework should be extended, not re-created.
3. Offline is a collection of capabilities, not a single Boolean. A local PDF, searchable text, saved questions, and new cloud-generated answers have different prerequisites. The first three can be local; cloud generation still needs a connection. A new local AI model is explicitly excluded by the owner's existing plan.

The proposed advantage is the integrated, inspectable training history and its reliability. This is a product hypothesis, not a demonstrated exclusive market position or a claim of improved pilot proficiency.

## 2. Research method and confidence

- Consulted Google's own help, original learning-research records, FAA teaching/assessment/ACS material, Anki documentation, SQLite documentation, W3C standards, Apple APIs, Mozilla PDF.js documentation and Tauri runtime documentation.
- Inspected current source paths and recent merge history rather than treating dated plans as implementation evidence. No application behavior was run or newly certified in this research task.
- Refreshed GitHub metadata for five relevant upstream repositories. The [snapshot](research/offline-training-2026-10-21/repositories.json) records actual stars, archive state and inspected revision/license identities. The existing 1,000-star rule applies to the actual code repository, not its parent project.
- Learning findings support design choices, not aviation outcome percentages. No study of this app, no personal review-history analysis and no usability trial was conducted.
- Google help currently uses the title **Gemini Notebook**. “NotebookLM” is retained here as the owner's comparison label; this report does not infer a rename timeline.
- Access limitations: IES guide and PDF URLs returned maintenance pages; the Washington University full-paper PDF timed out; the UC repository full text returned 429. Their available indexed abstracts/primary publication records were inspected, not a claimed full-text systematic review. FAA chapter 6 was readable; chapter 5 exceeded the browser tool's size limit. Its indexed description and FAA scenario index provide limited corroboration. None of those failed fetches is reported as a successfully read full document.

## 3. What Google's documentation actually establishes

| Capability | Official evidence | Consequence for Her Flight Deck |
| --- | --- | --- |
| Source-derived cards/quizzes and explanations | The help describes customizable study aids and explanation controls. [G1] | Do not market another PDF-to-quiz button as the distinction. |
| Retained flashcard progress and missed-card practice | The help says progress is remembered across leaving/returning and provides missed-card review. [G1] | Differentiate through durable lesson-linked evidence and revision-safe follow-up, rather than claiming Google has no memory. |
| Offline audio | The mobile help explicitly documents downloaded Audio Overviews. [G2] | Do not claim NotebookLM has no offline features. |
| A complete offline flight-training loop | These pages do not establish the particular lesson/debrief/homework/edition-aware workflow proposed here. | This is an opportunity to validate, not proof that no Google feature or other competitor can do something similar. |

No logged-in competitor application, offline test, subscription limits or undocumented feature absence was tested. Recheck current official documentation before publishing marketing comparisons.

## 4. What already exists in this repository

The baseline is a source inventory, not an installed acceptance report. Links resolve to the inspected files; the Git SHA above fixes their meaning if later code changes.

| Discussed idea | Existing implementation inspected | Remaining gap / qualification |
| --- | --- | --- |
| Next-flight preparation | [recommendations](../src/logic/recommendations.ts), [preparation](../src/logic/preparation.ts), [lesson brief](../src/logic/lessonBrief.ts), journal/actions/questions and M3 evidence | Recommendations already have deterministic reasons and budgets. Connect exact homework/study evidence to the approved next-session/lesson flows; do not introduce another planner. Private journal text is deliberately excluded from ordinary brief export. |
| Offline lesson packs | [offline service](../src/services/offlineContent.ts), [readiness wording](../src/logic/offlineReadiness.ts), [PDF kit engine](../src-tauri/src/pdf_study_kit.rs), [Homework](../src/pages/StudyLibrary/HomeworkView.tsx), [homework contract](../src/domain/homework.ts) | A PDF-derived study kit is not a multi-document lesson pack. Homework can provide composition; verified aggregate availability and a complete resume flow remain distinct work. Extraction/search release activation is still gated. |
| Learning from mistakes | [practice sessions](../src/data/repositories/practiceSessionRepository.ts), [frozen-attempt review](../src/logic/practiceAttemptReview.ts), [card scheduler](../src/logic/cardScheduler.ts), [library review rules](../src/logic/cardLibrary.ts) | Durable attempts, missed/skipped review and `simple-v1` already exist. The gap is useful source-linked mixed follow-up and session selection; FSRS is a separately gated evaluation. |
| Oral-exam practice | Existing guides/questions, instructor questions and M3 evidence; M6 and STUDY-HUB-05/06 plan related outcomes | No dedicated versioned free-response oral-session contract was established by this inventory. A multiple-choice response record cannot be relabelled as an oral assessment. |
| PDF annotations and source study | [native navigation](../src-tauri/src/navigation.rs), [navigation repository](../src/data/repositories/navigationRepository.ts), [page panel](../src/pages/StudyLibrary/navigation/DocumentPagesPanel.tsx), split lineage, [PDF-kit provenance](../src/data/pdfKitSources.ts) | Identity-aware page guidance and bookmarks with saved notes already exist. The native opener explicitly cannot command the external reader to jump to a page. True embedded highlighting/selection is not delivered by those APIs. |
| Portable training history | [backup format](backup-format.md), native backup/restore, [study export](../src/logic/studyExport.ts), [GEN-03](OFFLINE_GEN_PLAN_2026-10-20.md#gen-03--packet-hand-off-and-plain-how-to), existing iOS plans | Full backup and a study packet are different contracts. Packet v1 excludes PDFs and attempt/review history; current export drops machine page links/per-item origins. iOS still needs current-schema, file-access and installed-device verification. |

Recent history resolves several stale status paragraphs: PR #249 merged GEN-03; #250/#252 merged OFFLINE-ON-1 and pressure-check tooling; #254/#255/#256 merged homework storage, UI and card-run evidence. The current homework contract still reserves `action_id` as null and supports card runs only: test-run attribution and daily-plan integration remain unfinished at this SHA. The top of the older roadmap still calls migration 0020 proposed; it is actually registered. This report records the discrepancy without rewriting all historical entries or marking the rest of HW-01d complete.

## 5. Evidence translated into product decisions

### 5.1 Retrieval, spacing and honest confidence

Roediger and Karpicke's prose-learning experiments support retrieval practice for delayed retention relative to additional restudy; their report also distinguishes confidence from later performance. Cepeda and colleagues' synthesis shows that useful spacing depends on the retention interval. These are memory studies, not evidence that an app can judge real flight skills, predict an FAA result or prescribe one universally optimal review ladder. [L1–L2]

**Design recommendation:** ask her to retrieve before revealing the answer; show the exact missed item and its source; return to it later. Preserve correct/incorrect, “don't know,” unanswered, card self-rating and instructor observation as different kinds of evidence. Optional confidence collection is a later reviewed field, not something inferred from speed or inserted into existing scores.

Anki documents workload/retention trade-offs and warns that using Hard for a forgotten answer gives a scheduler misleading input. [A1] Her Flight Deck should first make its existing Again/Hard/Good/Easy meanings and manageable backlog clear. Continue P54-06's pinned FSRS comparison; do not replace `simple-v1`, add a retention slider or claim a speedup from this research. Reset erasure and incomplete surviving review histories remain hard transition boundaries.

### 5.2 Lesson-linked learning and oral scenarios

FAA assessment guidance distinguishes recognizing an answer from generating and applying one, and describes learner-centered critique with specific feedback. The FAA scenario index invites tailoring examples to the training environment. [F1–F2] This supports a source-backed, reflective practice format; the app does not inherit the instructor's authority.

**Design recommendation:** a scenario asks for a decision, reasoning and missing information, then reveals a reviewed discussion outline. Allow “not sure” and “ask my instructor.” Keep aircraft/edition assumptions visible. Log self-assessment separately; never turn an automated oral score or quiz percentage into a solo endorsement or flight-readiness verdict. Use the relevant current ACS publication as an organizing reference, with reviewed mappings. [F3]

### 5.3 Offline availability is a verified dependency set

Apple's iCloud file metadata distinguishes a current local copy from a stale local copy or an item not downloaded. [P1] A filename or successful picker selection is therefore not adequate proof that all needed bytes are ready for disconnected use.

**Design recommendation:** evaluate each selected activity against exact local dependencies: managed PDF bytes/hash for reading; saved set/version for cards; exact test version for practice; matching cache coverage only when text search or local kit creation is requested. Image-only PDFs may still be readable offline even when extraction yields no text. Deleting a derived cache must not delete saved questions or falsely mark the underlying PDF missing. A pending cloud job is never a prerequisite for using already saved work.

Use the existing [OFFLINE-ON pressure gate](OFFLINE_ON_PRESSURE_CHECK.md). Source/debug enablement, accepted M5 measurements, minimum-spec evidence and the published build's switches must remain separate observations. No research recommendation enables the switch or accepts unobserved pressure results.

### 5.4 Reliable annotation anchors, with explicit reader limits

W3C distinguishes quote selectors (exact text with context) from character-position selectors and warns that positions are brittle across changes. [S1] An anchor needs a document representation identity, not just a page number.

**Proposed application design:** associate annotations with the managed content hash, physical page, extractor/normalization version, bounded quote/context and an explicitly defined offset unit. Existing PDF-kit offsets are UTF-8 byte offsets; W3C character offsets and JavaScript UTF-16 indices are not interchangeable. Conversion needs independent Unicode vectors. Repeated text, rotated pages and changed editions must become ambiguous/stale rather than silently reattach.

First connect the existing page-bound bookmark notes to deliberate “make a card/question” actions. Reuse NavigationBookmark title/notes and its verified content/page identity; do not introduce another page-note table for an already supported operation. Treat embedded text selection and geometric highlighting as a separate feasibility decision. Keep app annotation operations from rewriting original PDF bytes and store new annotation data in app-owned side tables. External reader edits cannot be prevented by the present opener; detect changed bytes on reinspection and invalidate stale anchors rather than promising otherwise.

Mozilla documents bounded rendering concerns, worker/API version matching and partial annotation support; its current FAQ's legacy build lists Safari 18+ as mostly supported. Tauri uses WKWebView on macOS. [S2–S3] Therefore installing Safari is not a substitute for proving the chosen app/runtime combination, and current upstream PDF.js is not automatically a macOS 12 reader solution. Apple PDFKit is a native candidate for selection/annotations, but an Apple implementation is not Windows parity. [P2]

### 5.5 Portable ownership without silent synchronization

SQLite documents a consistent online-backup snapshot and warns against unsafe copying of live databases and their journals. [D1–D2] Keep the existing snapshot/staging/integrity/rollback path instead of putting a live database inside a cloud-synced folder.

Current complete backup is **format v3**, with v1/v2 readers retained; the inspected schema ceiling is 20. SHA-256 detects changed bytes, not trusted authorship or authoritative aviation content. On iOS, a selected external file needs proper security-scoped access before copying to app-owned staging. [P3] Persist relative archive identities and restore into the receiving device's storage, never a sender's absolute Mac path.

**Design recommendation:** use the existing one-material packet for deliberately sharing study text, existing backup for full personal transfer/recovery, and CSV/handouts for outside tools/paper. The Anki manual supplies separated-text import rules, not evidence that every CSV or spreadsheet-safe escape round-trips identically. [A2] Do not advertise Anki compatibility until a named importer/version and field mapping are observed. A reusable multi-source pack with PDFs and history is a future, separately versioned format decision, not an extension smuggled into packet v1.

## 6. Recommendations for the six features

These are product recommendations; their exact contracts, slices and tests are in the linked roadmap.

1. **Next-flight preparation:** extend existing Daily Flight Plan/Homework/briefs with chosen source-backed study tasks and explanations. Work without an enrolled school, instructor or scheduled lesson. Do not export personal debriefs implicitly.
2. **Offline lesson packs:** use a homework assignment as the initial collection. Show capability-specific availability, preserve exact selected versions, and resume unfinished work without needing a provider. Avoid a second “pack” database or a new file format for the first version.
3. **Practice that remembers mistakes:** build on existing due cards and frozen attempts. Offer a short, bounded mixed follow-up with an explanation of why each item appears. Never infer proficiency from completion or modify an old result after content changes.
4. **Oral practice:** start with text prompts and visible source-linked discussion criteria. A local answer/self-review session works without speech recognition or AI. Recording/transcription is optional later work; Apple on-device recognition depends on capability support, and silent cloud fallback is unacceptable in an offline mode. [P4]
5. **Study in the source:** connect existing bookmark notes to study actions first; revision-safe highlights only after the renderer/platform feasibility gate. Make an annotation into a card only through an explicit preview/save with source attribution.
6. **Portable training history:** improve backup/import confidence and device compatibility before adding sync or merge. Her Mac backup → user-selected iPhone import remains the mobile direction; a generic archive parser is not a finished iOS app.

## 7. Upstream reuse assessment

Snapshot date: 21 October 2026. Stars indicate the owner's selection threshold only, not correctness, security, browser compatibility or adoption approval.

| Actual repository | Stars | License evidence | Decision |
| --- | ---: | --- | --- |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | 54,031 | Apache-2.0 | Eligible evaluation reference. Reuse prior reader/extraction work; new embedded adoption needs pinning, notices, native/WebKit budgets and macOS 12 evidence. |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4,111 | MIT | Eligible reference; continue the existing P54-06 comparison, not a second scheduler project. |
| [open-spaced-repetition/fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) | 449 | BSD-3-Clause | Below 1,000; not eligible for direct adoption without an explicit exception. |
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 829 | MIT | Same below-threshold restriction; parent's stars do not qualify the port. |
| [ankitects/anki](https://github.com/ankitects/anki) | 32,188 | GitHub metadata: NOASSERTION; actual LICENSE states AGPL-3.0-or-later with listed component exceptions | Learn from documented workflows/file interoperability. Do not copy application code into this app on the assumption that “open source” means unrestricted reuse. No license decision or code adoption made. |

All five were non-archived at inspection. The metadata file includes immutable commit/license links and byte hashes, not copied source or a new dependency. Existing [OSS adoption rules](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md), [Study Hub shortlist](STUDY_HUB_OSS_RESEARCH_2026-10-17.md) and approved evaluations still govern. No graph server, vector database, orchestration framework or local model is needed for the initial six outcomes.

## 8. Validation plan and research limits

Before claiming a product advantage, observe these complete tasks with synthetic data on each supported installed platform:

- Import a PDF, author or save reviewed study content, disconnect networking, restart, read/review/answer/save/resume, reconnect: no lost work, misleading badge or unrequested upload.
- Replace/delete a source, clear a text cache, regenerate a set, erase history and restore an old supported backup: identities and warnings remain truthful; cleared history is not reconstructed from another feature.
- Choose work for a lesson, complete it in the intended run, then show its exact evidence; merely opening the PDF or reviewing unrelated cards must not complete homework.
- Export only selected material, cancel/fail an export, then restore/import on a fresh device/profile. Check exact preserved/lost fields against the output contract, not only counts.
- With consent, ask her to prepare for a real upcoming or imagined lesson, find the explanation for a missed question and resume after an interruption. Record task completion, errors, confusing labels and clicks; do not invent effectiveness percentages from a small usability exercise.

Reuse the existing benchmark harness and synthetic text/image-heavy/long-PDF corpus. Record cold/warm conditions, content counts/bytes/pages, hardware, OS/runtime, p50/p95, maximum observed memory, cancellation and build size. No timing or memory improvement was measured here. Preserve the owner's accepted saved-content p50 exception (28.2 ms versus the original 20 ms target); do not silently change either the target or acceptance history. The existing extraction gate's 512 MiB counted cap/640 MiB RSS ceiling is not evidence that arbitrary new workloads fit those limits, and M5/32 GiB evidence is not minimum-spec evidence.

Keyboard-only operation, visible focus, screen-reader status and large readable controls belong in every interaction. W3C's target-size guidance is one reference, not a certification of this app. [S4] Oral practice is not a real-time cockpit aid; no live-weather or aircraft-specific go/no-go feature is added by this plan.

## 9. Primary-source register

All URLs were searched/opened on 21 October 2026. Access qualifications above apply. Only short paraphrases are used; third-party articles, PDF contents, product source and commercial question banks are not copied into the app.

| ID | Primary source and inspected topic |
| --- | --- |
| G1 | [Google: flashcards/quizzes](https://support.google.com/gemininotebook/answer/16958963?hl=en): explanations, saved progress, resumption and missed-card review. |
| G2 | [Google: mobile app](https://support.google.com/gemininotebook/answer/16296687?hl=en): documented mobile features and downloaded audio. |
| L1 | [Roediger & Karpicke, 2006, DOI 10.1111/j.1467-9280.2006.01693.x](https://pubmed.ncbi.nlm.nih.gov/16507066/): indexed primary abstract/publication record; [author-hosted PDF](https://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Roediger-Karpicke-2006_PsychSci.pdf) timed out. |
| L2 | [Cepeda et al., 2006, DOI 10.1037/0033-2909.132.3.354](https://pubmed.ncbi.nlm.nih.gov/16719566/): indexed primary abstract; [UC repository](https://escholarship.org/uc/item/3rr6q10c) returned 429 on full access. |
| A1 | [Anki deck options](https://docs.ankiweb.net/manual/deck-options): review limits, FSRS/workload and rating semantics. Product documentation, not an independent effectiveness trial. |
| A2 | [Anki text-file imports](https://docs.ankiweb.net/manual/importing/text-files): UTF-8, delimiters, escaping, field mapping and multiline constraints. |
| F1 | [FAA Instructor's Handbook, chapter 6](https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/aviation_instructors_handbook/08_aih_chapter_6.pdf), printed pp. 6-1–6-7: formative/authentic/learner-centered assessment. |
| F2 | [FAA scenario index](https://www.faa.gov/training_testing/training/fits/scenarios): contextualized scenario examples; not this app's syllabus. |
| F3 | [FAA ACS index](https://www.faa.gov/training_testing/testing/acs): observed Private Pilot Airplane entry FAA-S-ACS-6C, April 2024/effective 31 May 2024. Recheck the applicable revision when implementing mappings. |
| S1 | [W3C Web Annotation Data Model §§4.2.4–4.2.5](https://www.w3.org/TR/annotation-model/#selectors): quote/position selectors and resource-change limitations. |
| S2 | [PDF.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions): browser support, rendering resources, worker version matching and annotation scope; [library API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html). |
| S3 | [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/): system runtime and WKWebView versus Windows WebView2. |
| S4 | [W3C target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): pointer-target size/spacing guidance. |
| D1 | [SQLite Online Backup API](https://sqlite.org/backup.html): consistent database snapshots and incremental locking. |
| D2 | [SQLite corruption hazards](https://sqlite.org/howtocorrupt.html): live database/journal copying and storage/locking hazards. |
| P1 | [Apple file download state](https://developer.apple.com/documentation/foundation/urlresourcekey/ubiquitousitemdownloadingstatuskey): local/current file availability; [states](https://developer.apple.com/documentation/foundation/urlubiquitousitemdownloadingstatus). |
| P2 | [Apple PDFSelection](https://developer.apple.com/documentation/pdfkit/pdfselection) and [PDFAnnotation](https://developer.apple.com/documentation/pdfkit/pdfannotation): native selection and annotation primitives, not a cross-platform implementation. |
| P3 | [Apple file importer](https://developer.apple.com/documentation/swiftui/view/fileimporter(ispresented:allowedcontenttypes:allowsmultipleselection:oncompletion:oncancellation:)): security-scoped URL lifetime and cancellation. |
| P4 | [Apple on-device recognition capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) and [request policy](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition): capability-dependent offline speech. |

The [IES guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1) remains a relevant existing roadmap reference, but its content was unavailable in this session and is not represented as newly verified. Repository-specific observations are tied to the source baseline, not to upstream claims.
