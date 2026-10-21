# Competitive app research: what learners value — 21 October 2026

**Research and product recommendations only.** Prepared against accepted main `f2cf79f` (PR #258), including HW-01d part 2 (#257). No app was installed, subscription purchased, competitor account created, user contacted, application test run, or feature implemented. Read [PRODUCT_SPEC.md](../PRODUCT_SPEC.md), the [existing six-feature research](OFFLINE_TRAINING_RESEARCH_2026-10-21.md) and [implementation roadmap](OFFLINE_TRAINING_ROADMAP_2026-10-21.md) alongside this report. Those existing plans and current owner assignments keep their priority.

## 1. Conclusion

Her Flight Deck sits at the intersection of **a personal training companion, a source-linked study tool, and an offline workspace**. Its closest useful comparisons are The Finer Points for training flow, RemNote/MarginNote for learning from documents, and Anki for sustained practice. NotebookLM is an important source-to-study comparison, but not the only one.

The evidence favors improving the journey from **my material → a short session → an explained mistake → a specific follow-up → my next lesson**. Users also value reading, reviewing and exporting without losing their work. Those are product opportunities, not proof that this app has a unique position or improves examination/flight outcomes.

The strongest immediate recommendation is to finish and polish the existing workflow before introducing more feature families. No competitor code, proprietary question bank, paid course, distinctive design, diagram, or recorded lesson was copied. This research proposes independently implemented interaction patterns.

## 2. Method and evidence strength

### App Store sample

- Captured Apple's public **US** lookup metadata for **18 apps**. This is a dated snapshot, not a ranking or market-share estimate. [Metadata](research/competitive-apps-2026-10-21/apple-metadata.json).
- Requested the public customer-review feed with `sortBy=mostRecent` for 16 apps. Read the **first eight review-bearing entries** returned for each of 15 apps: **120 unique reviews**. Checkride.bot returned no textual entries and is not counted as a user-validation success. Its lookup record had one rating while its cached product page lacked a rating overview.
- The selected reviews run from **19 January 2025 through 20 October 2026**. Eight entries cover only days for a busy app and many months for a quieter app. We did not pretend these were equal calendar windows.
- No star filtering. All 120 entries were retained, including **13 low-information entries**. A positive sentence with two stars was not mechanically classified as negative. Several Chinese/Spanish entries were paraphrased into English; translations have not been independently checked.
- One author manually coded multiple themes per review. The resulting [observation register](research/competitive-apps-2026-10-21/review-observations.json) includes public review IDs, dates, versions, stars, short paraphrases and code definitions. It omits handles and full review text. No identity or personal profile was inferred.
- The collection is a small, purposive recent-review slice, **not a representative customer survey**. Authenticity, purchases, individual outcomes and alleged defects were not independently verified. Equal samples per app deliberately do not weight by popularity. No conversion, retention, revenue, defect-rate, or causal learning claim follows from it.

### Web triangulation

Official help and product pages were used for advertised capabilities, platform/offline boundaries and release notes. App Store featured reviews and two public discussions were supplementary qualitative evidence, outside the 120 count. Vendor-selected testimonials were treated as marketing context, not independent demand validation. We did not rely on affiliate comparison rankings or automated review-summary sites.

Current source was inspected at the baseline for reuse and obvious gaps. This is **source evidence**, not an installed behavior, performance or platform acceptance result. A complaint about an old version is not evidence the latest version still fails. Cached pages differ from current lookup names/counts; use the recorded numeric IDs to identify apps.

## 3. The comparison set

App names below link to US listings; the official documentation later in the report supplies additional capability evidence. These are workflow comparisons, not recommendations to buy subscriptions. Features advertised on a listing were not exercised.

| App / category | Useful comparison | Signal and qualification | Fit for Her Flight Deck |
| --- | --- | --- | --- |
| [Ground School — The Finer Points](https://apps.apple.com/us/app/ground-school/id1444387206) | Ground and flight instruction, short lessons, references, recall | Recent readers praise clear, manageable lessons and embedded references; one questions recurring value. | Connect a short lesson objective, reading and follow-up. Do not imitate a paid video curriculum. |
| [Sporty's Pilot Training](https://apps.apple.com/us/app/sportys-pilot-training/id1272775528) | Organized courses across devices | Content and device choice are praised; sampled reports also describe playback/update issues. One recent review reports improvement. | Protect resumable progress and test each promised platform. Content production is a different business. |
| [Prepware Private Pilot](https://apps.apple.com/us/app/prepware-private-pilot/id334278376) | Topic drills and figure-based questions | A reader values difficult chart practice; others question coverage/category fit or small-screen charts. | Preserve readable figures and exact question scope; never promise the real exam bank. |
| [FlightReady Academy](https://apps.apple.com/us/app/flightready-academy/id998722803) | Courses, practice and reports | Some positive preparation reports coexist with access/support complaints. Account-ban allegations are not adjudicated here. | Saved personal work should remain usable without a school or cloud login. |
| [PlaneEnglish: ARSim](https://apps.apple.com/us/app/planeenglish-arsim/id1461037185) | Rehearsing communication rather than only reading | Users value rehearsal/local scenarios; reports question recognition, tap burden and offline launch. | Explore optional, source-backed communication rehearsal after text oral practice; no operational guidance. |
| [Checkride.bot](https://apps.apple.com/us/app/checkride-bot-oral-exam-prep/id6759470447) | Advertised ACS-aligned spoken questions and debrief | Too little textual review evidence in this sample. Voice retention disclosures matter. | Treat as a design reference only. Do not copy automated satisfactory/unsatisfactory certification language. |
| [AnkiMobile](https://apps.apple.com/us/app/ankimobile-flashcards/id373493387) | Durable scheduled review and personal decks | Repetition/organization are valued; setup, sync and missing-image complaints show friction. | Keep the current review engine; make its existing behavior approachable and verifiable. |
| [RemNote](https://apps.apple.com/us/app/remnote-notes-flashcards/id1545429784) | Notes, references and flashcards in one workflow | Users value integration and scheduling despite a learning curve; text-size and cost requests also appear. | Connect existing bookmark notes, authored items and review. Avoid another separate notes system. |
| [Quizlet](https://apps.apple.com/us/app/quizlet-more-than-flashcards/id546473125) | Easy access to varied practice modes | Reviewers value quick study; others cannot select content or face interruptions. | Fewer steps from selected material to a bounded session; maintain explicit privacy. |
| [Knowt](https://apps.apple.com/us/app/knowt-ai-flashcards-notes/id6463744184) | Material-to-cards/tests and practice customization | Praise for available practice coexists with access/privacy complaints and one detailed review-choice bug report. | Exact frozen answers, private-by-default content, and clear provider/cost boundaries. |
| [Gemini Notebook / NotebookLM](https://apps.apple.com/us/app/gemini-notebook/id6737527615) | Source discussion and generated study/audio | Featured reviews praise audio/ease; recent sample includes account-switch and source-trust concerns. | Optional alternate study formats are promising; source transparency and account independence matter. |
| [StudyFetch](https://apps.apple.com/us/app/study-fetch/id6663574866) | Uploads, tutoring and multiple study formats | Readers value explanations/brief practice; some request pictures, varied application questions and uninterrupted audio. | Improve explanation, variety and short-session flow before adding a tutor or podcast pipeline. |
| [LiquidText](https://apps.apple.com/us/app/liquidtext/id922765270) | Excerpts and cross-document workspace | Users value organizing documents; price/accessibility complaints recur in this small sample. | Lightweight source links and comparison before an infinite canvas. |
| [MarginNote 4](https://apps.apple.com/us/app/marginnote-4-ai-notes-mindmap/id1531657269) | Source-to-note/card relationships | Integration is valued; sampled reports question sync/layout/export behavior. | A source relationship should survive navigation/transfer without an elaborate new workspace. |
| [Readwise Reader](https://apps.apple.com/us/app/readwise-reader/id1567599761) | One reading place, search, highlights and optional assistance | Readers praise integration, optional AI and voice choice; reports also concern parsing/loading. | Strong search, predictable saved content and optional assistance. |
| [Goodnotes](https://apps.apple.com/us/app/goodnotes-ai-notes-docs-pdf/id1444383602) | Flexible personal notebooks and PDF markup | Flexible organization/exports are valued; an explicit reading-state request appears alongside upgrade/reliability complaints. | Calm customization and trustworthy export; handwritten canvas is optional platform work. |
| [ForeFlight](https://apps.apple.com/us/app/foreflight-mobile-efb/id333252638) | Aviation document binders and file organization | Official product comparison only; not in the eight-review sample. | Borrow organizational principles; remain complementary to an EFB, not a navigation replacement. |
| [Obsidian](https://apps.apple.com/us/app/obsidian-connected-notes/id1557175442) | Private local files, links, portable text | Official product comparison only; not in the eight-review sample. | Reinforces local ownership and readable exports; does not imply adopting plugins, sync or graph UI. |

### What the small sample actually counted

These counts include praise, complaints and requests together, with overlapping codes. They describe this dataset, **not how many customers like a feature**. Read individual observations before using a total to prioritize work.

| Theme | Reviews mentioning it | Distinct sampled apps |
| --- | ---: | ---: |
| Value / access clarity | 31 | 12 |
| Reliability / responsiveness | 24 | 9 |
| Guidance / interaction friction | 21 | 10 |
| Continuity / portability | 20 | 9 |
| Retrieval practice / rehearsal | 18 | 8 |
| Content fit / accuracy / faithful capture | 13 | 9 |
| Support / recovery | 13 | 8 |
| Explanations | 8 | 4 |
| Integrated workflow | 7 | 6 |
| Source context / correct review content | 7 | 6 |
| Visual material | 7 | 5 |
| Accessibility | 6 | 5 |
| Short sessions / scheduling | 5 | 5 |
| Optional versus intrusive AI | 5 | 3 |

Motivation/rewards appeared in two entries from one app; explicit private-folder control appeared in one. Those isolated requests are signals to explore, not justification for redesigning the product or introducing streak penalties. The product's no-guilt principle remains authoritative.

## 4. What people seem to value, with contrary evidence preserved

### A. Understanding a mistake, not just seeing a percentage

The Finer Points documents missed-question explanations with source references. A StudyFetch reviewer values tutoring explanations while another reports an update removing the kind of explanation they wanted. A Knowt reader's report about wrong review options illustrates why answer identity matters. These accounts suggest useful explanation/context, not more decorative scoring. [Ground School feature description](https://www.learnthefinerpoints.com/ground-school), [StudyFetch reviews](https://apps.apple.com/us/app/study-fetch/id6663574866?see-all=reviews).

**Implication:** keep exact historical questions/options and explanations; provide a deliberate correction/follow-up action. No inference that a wrong answer reveals the learner's underlying misconception without asking her.

### B. Creating study items without ferrying content across apps

RemNote's reader explicitly connects PDF highlights, notes and cards. Its public user discussion values restoring context while reviewing, while also describing export and mobile friction. LiquidText/MarginNote show related source-workspace patterns. The relevant idea is fewer steps and traceable context, not copying their entire interfaces. [RemNote reader](https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader), [user account of that workflow](https://www.reddit.com/r/remNote/comments/1j66p2n/).

**Implication:** use the existing bookmark note and source identity to propose a card/question, preview it, and deliberately save. Preserve the note; do not silently create dozens of items from highlights.

### C. Useful progress that survives interruption

Many sampled comments concern device continuity, account access or work disappearing. They do not establish failure rates, but they are a strong qualitative warning against making a study companion depend on fragile state. Official Quizlet help describes saved offline progress and downloaded sets. RemNote distinguishes complete desktop media from more limited mobile caching. These are already competitive capabilities. [Quizlet offline help](https://help.quizlet.com/hc/en-us/articles/360030565412-Studying-offline-with-Quizlet-mobile-apps), [RemNote offline boundaries](https://help.remnote.com/en/articles/6752029-offline-mode).

**Implication:** verify exact local media, activity versions and acknowledged saves. Cold launch/restart disconnected is a stronger acceptance case than merely keeping an already-loaded screen open.

### D. Small sessions and clear next steps

Ground School readers value lessons that fit spare time; study-tool readers value varied quick practice. The evidence does not establish one optimal session length. Offer selectable small budgets and stop/resume rather than imposing a large exam every time. The app already has planner budgets and saved activity state; integrate them.

**Implication:** an optional five-, ten-, or fifteen-minute target is a proposed UI choice, not a measured completion promise. A partial session records practice without claiming the full test or homework is complete.

### E. Diagrams and the question visible together

Prepware readers describe small-screen chart difficulty; a featured Sporty's Study Buddy review values keeping the question with its figure. RemNote and Anki document image occlusion. These are particularly relevant to visual aviation study, but no study here demonstrates an aviation learning gain. [Study Buddy review](https://apps.apple.com/us/app/private-pilot-test-prep/id414141811), [RemNote image occlusion](https://help.remnote.com/en/articles/6511625-image-occlusion-cards), [Anki image occlusion](https://docs.ankiweb.net/editing.html#image-occlusion).

**Implication:** readable exact figures first; optional hide/reveal diagrams later. Do not generate replacement charts, distort scales, or silently move a question to a different page/edition.

### F. Optional assistance and fair expectations

Some users like paid features and say they are worthwhile. Others dislike changing access, unclear entitlements, upgrade prompts, or intrusive AI. Reader users explicitly value optional AI. This is not evidence that everyone wants a free product or dislikes AI. [Reader reviews](https://apps.apple.com/us/app/readwise-reader/id1567599761?see-all=reviews), [Obsidian's local-data model](https://obsidian.md/).

**Implication:** keep ordinary saved study usable without provider access. Show what an explicit generation request sends, what needs connectivity, and what remains available if the key is unavailable. No new commercial model is proposed.

## 5. Ideas to use, and what already exists

The following are **recommendations for bounded future assignments**, not approved feature starts. Relative effort/risk is a judgment from the integration surface, not a measured estimate. Reconcile current main and active ownership before assigning a slice.

| Candidate | Source signal and concrete experience | Current Her Flight Deck foundation | Next scope / risk | Existing roadmap fit |
| --- | --- | --- | --- | --- |
| COMP-01: one dependable Continue action | Open the exact reading/card/test state last used, with a clear save/recovery message. | Frozen practice attempts, homework runs, page requests/read marks and library filters exist. | Polish discovery/continuity; do not rebuild persistence. Moderate integration risk. | DIFF-01/02/03; HUB-04/07 |
| COMP-02: explain → source → next practice | After a missed question, see its saved explanation, view its source guidance, then choose a follow-up. Optionally record what was confusing. | Historical missed/skipped review, explanations, SourcePageBadge, authored edits/corrections and instructor questions exist. | A personal misconception note or mixed remedial session needs a scoped retention/version/erasure design. No AI diagnosis. | DIFF-03; HUB-04/05 |
| COMP-03: source beside question | Keep the prompt, exact figure/quote and explanation reachable without repeated window switching. | Source-page guidance and hash-bound bookmarks exist. The native opener cannot guarantee page jumping. | Start with clearer source presentation; embedded selection/figures need reader feasibility, local assets and resource budgets. Higher renderer risk. | DIFF-05; HUB-01/03/08 |
| COMP-04: a small session I can finish or pause | Choose a short target and selected topics, reuse due work, and stop without losing responses. | Existing planner budget, current scheduler, resumable practice, homework composition and live daily-plan integration from #257. | Integrate existing actions; never falsely complete homework on partial practice. Moderate identity/state risk. | DIFF-01/02/03 |
| COMP-05: offline confidence with exact dependencies | Before leaving, see whether selected PDFs, saved questions, images and history are locally available; repair specific missing items. | Offline badges/checks, managed documents and saved content; pressure/activation remains separately gated. | Extend verification and installed disconnected tests. Do not add a parallel download manager or duplicate files. | DIFF-02; OFFLINE-ON |
| COMP-06: visual recall | On a user-selected diagram, cover a label, answer, reveal, then reopen the exact original. | Existing text cards, provenance and document storage. No image-occlusion contract established in this inspection. | Separate image/region/rotation/backup/accessibility design before implementation; avoid proprietary content bundles. Higher format/renderer risk. | Conditional DIFF-05 follow-on |
| COMP-07: calm focused review | Large readable text, reliable keyboard controls, adjustable layout, visible save state and optional reduced chrome. | Existing components, accessibility patterns and compact navigation. | Measured polish of the present screen, preserving focus and review actions. No unnecessary animation. | App polish / relevant DIFF acceptance |
| COMP-08: my terminology in context | Explain a selected acronym in a short source-linked note and let her add it to her own cards. | Notes, cards, sources and questions. | Curated/reviewed definitions or her selected note first. Automatic extraction/homonym handling is separate work; no endless new glossary system. | DIFF-03/04/05 |
| COMP-09: speak or type a scenario | Answer a saved scenario, compare reasoning with a reviewed outline, and keep a question for the instructor. | Existing source-linked study and six-feature oral plan. | Text/free response first. Voice is separately gated for accuracy, consent, retention, on-device availability and accessibility. | DIFF-04 / M6 |
| COMP-10: usable outside the app | Share selected study text or print a clean handout with a separate answer key; restore a complete personal backup when appropriate. | ExportStudyDialog already provides packet/HTML handout, answer-key selection and deliberate correction inclusion. Full backup is separate. | Validate and improve discoverability/layout/fidelity; do not claim print/export is missing or invent another archive. | DIFF-06; EXPORT-01/02 |

**An aviation-specific refinement for the already queued ACS-READY-01:** let her deliberately enter the missed-topic ACS/learning-statement codes from her written-test report, confirm their meaning against the applicable source edition, and select relevant reading/cards/instructor questions. The FAA's current June 2026 FAQ explains that an AKTR includes missed-question codes. Start with manual code entry, not uploading the entire report containing her name, FTN and score. Unknown/outdated codes must stay unresolved; a topic map is not a reconstruction of actual exam questions or an endorsement. This is a candidate within the existing ACS assignment, not an extra priority lane or an implemented import feature. [Current FAA testing FAQ](https://www.faa.gov/training_testing/testing/Frequently_Asked_Questions.pdf).

### Source inspection behind the reuse claims

- [Study Library](../src/pages/StudyLibrary/StudyLibrary.tsx): Library/Review due/History, remembered filters and 100-item paging already exist.
- [Practice review logic](../src/logic/practiceAttemptReview.ts) and [history UI](../src/pages/StudyLibrary/PracticeHistory.tsx): frozen item options, per-attempt responses, missed/skipped filtering, saved explanation and source badge.
- [Practice panel](../src/pages/StudyLibrary/PracticeTestPanel.tsx): explicit start/resume, saved responses, completion and abandonment. These contracts must survive a short-session UI.
- [Document page panel](../src/pages/StudyLibrary/navigation/DocumentPagesPanel.tsx): last requested page, explicit read mark and bookmarks. Do not turn opened pages into claimed reading or comprehension.
- [Export dialog](../src/pages/StudyLibrary/ExportStudyDialog.tsx): packet/printable handout already implemented in source; content selection and separate answer key are not new proposals.
- [Merged homework report](HW01D_REPORT_2026-10-21.md): the previously pending quiz-run/daily-plan wiring is now present at this baseline. Its historical report is evidence of implementation scope, not fresh execution by this research author.

## 6. What to avoid copying

1. **A broad EFB, chart/weather engine, paid ground-school curriculum or school administration system.** These expand the product and support burden beyond its personal preparation purpose. ForeFlight document organization is useful inspiration without adopting operational responsibilities. [ForeFlight Documents](https://foreflight.com/products/foreflight-mobile/documents/).
2. **A graph or canvas merely because competitors have one.** The sample supports connected information, not demand for a particular visualization. Try direct links and a simple topic collection first.
3. **A claimed real FAA question bank or pass/readiness score.** The FAA's current June 2026 FAQ says live knowledge-test questions are not released and the question bank changes. Reviewer score stories and assertions of stale questions cannot establish actual bank coverage. [Current FAA testing FAQ](https://www.faa.gov/training_testing/testing/Frequently_Asked_Questions.pdf), [current testing index](https://www.faa.gov/training_testing/testing).
4. **Punitive streaks, invented grades or mandatory daily quotas.** A small number of reward requests does not override the app's no-guilt philosophy. Show acknowledged work and realistic next steps.
5. **Voice-first dependence.** ARSim reviews show both perceived value and recognition frustration. Checkride.bot's listing discloses provider audio handling and retained transcripts; an app's own no-training statement is not the entire processing chain. No claim of those apps working entirely offline follows. Preserve a text option. [ARSim reviews](https://apps.apple.com/us/app/planeenglish-arsim/id1461037185?see-all=reviews), [Checkride.bot disclosures](https://apps.apple.com/us/app/checkride-bot-oral-exam-prep/id6759470447).
6. **An always-visible AI tutor or local LLM.** Optional explicit assistance is different from a permanent chat interface. The owner's exclusion of local models remains in force.
7. **Automatic sync/merge, silently changed originals, or new formats hidden inside packet v1.** Sync complaints are reasons to prove fidelity and recovery, not permission to rush synchronization. Retain existing backups, supported readers, migrations, erasure and relative-path contracts.

## 7. Recommended assignment order

This is a recommendation within the accepted queue, not a replacement priority decision:

1. **Prove the existing foundation:** offline activation/pressure and current homework/export acceptance, installed Mac/Windows continuity and backup/recovery. Reuse COMP-01/05/10 checks where already in scope.
2. **Polish the study session:** COMP-07 plus discoverability for COMP-01/02/04. Build on the now-merged homework/daily-plan integration. Keep current scheduling and no-school/no-instructor use.
3. **Reduce source friction:** COMP-03, first with existing bookmarks/notes; gate an embedded reader independently. Consider COMP-08 only when it fits that same learning flow.
4. **Evaluate visual recall:** a small COMP-06 proof using synthetic or rights-cleared diagrams, with equivalent-display/coordinate/backup tests. Do not adopt Anki/RemNote implementation code without the separate license/dependency process.
5. **Broaden rehearsal:** reviewed text scenarios under COMP-09; voice and audio formats are later optional experiments.

The accepted six DIFF groups remain the roadmap structure. COMP IDs are evidence references and candidate scopes, not ten approved new features. Do not create a second parallel roadmap, reserve migrations, move the owner's ACS/SCHOOL/FLIGHTLOG queue, or start an unassigned implementation round.

## 8. Validate the ideas with the actual learner

These are proposed research tasks, not completed usability tests. Use a synthetic PDF, a small saved study set and an isolated test profile. Test the current version before a prototype; record exact build, device/RAM, OS, source bytes/pages, library size and cold/warm state. Observe the learner's actions; do not collect journal or account information.

| Task | Observation to capture | Acceptance boundary |
| --- | --- | --- |
| Import the demo PDF and choose the next study action | Steps, time, wrong turns and requests for help | Existing library remains intact; duplicate/cancel/retry states are clear. |
| Answer a question, then inspect its source | Can she find the exact figure/page and return without losing the question? | Correct source identity; native reader guidance is honest. |
| Study for a short interval, leave, restart and continue | Restore position, responses, focus and acknowledged save state | No duplicate attempt, lost answer or accidental homework completion. |
| Review a mistake and choose what to do next | Does the explanation help, and can she record a specific question? | Exact historical options; personal inference stays hers. |
| Disconnect after a full app close, reopen and study | PDFs/images/questions locally available; missing-item explanation | No provider request for saved work; fresh generation remains explicit. |
| Export two selected cards and a handout, then inspect it | Print readability, answer-key separation and contents | No private journal/instructor correction included accidentally. |
| Use larger text and keyboard/screen reader | Reading, figure access, focus order and cancellation | Windows and installed Mac assessed separately; phone evidence later. |

For performance, use existing corpus and harnesses before proposing optimization. Record repeated timings and peak memory under controlled conditions; report distributions and failures, not one favorable run. A prototype is better only if the same tasks show fewer errors/less friction without regressions. No speedup is claimed here. One friend's results can guide her app; they are not market validation.

## 9. Evidence and follow-up limits

The 120 review paraphrases and snapshot are reproducible by app/review IDs and feed URLs, subject to reviews being edited/removed. Public full text was read as working material outside the repository, not republished. No user handles, personal notes, raw profiles, provider credentials, copied banks or proprietary code are included.

Official sources explicitly support offline features in competitors: [Readwise's selective cache and desktop/mobile distinctions](https://docs.readwise.io/reader/docs/faqs), [Sporty's download instructions](https://sportys.gorgias.help/en-US/offline-265902?isEmbedded=true), the RemNote and Quizlet articles above. Therefore **offline availability alone is not a defensible exclusivity claim**; the proposed value is the complete personal training workflow and proven local reliability.

Failed accesses were not counted as reads: an attempted Readwise `/faqs/offline` URL returned 404 (the correct general FAQ was then read); one r/flying discussion returned a cache miss and supplies no conclusion here; Apple's RSS URLs were inaccessible to the web reader, so they were retrieved successfully with direct public HTTP requests and all selected entries read locally. No full-text learning-efficacy review or competitor hands-on test was conducted.

The [evidence method](research/competitive-apps-2026-10-21/README.md) and validation receipt accompany the report. Publication follows the owner's request that research/roadmap work be accessible on GitHub; Claude retains independent review and merge ownership. No self-approval, release, feature adoption or installed-readiness claim is made.
