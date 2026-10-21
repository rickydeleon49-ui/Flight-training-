# Offline training: implementation roadmap — 21 October 2026

**Owner-requested roadmap addition; implementation not started by this task.** Covers the six features discussed on 21 October. Read the [research and source register](OFFLINE_TRAINING_RESEARCH_2026-10-21.md) for the evidence, competitor corrections and inspected baseline. [ROADMAP.md](../ROADMAP.md), [AGENTS.md](../AGENTS.md) and the active review loop remain authoritative for work order and ownership.

## 1. Delivery position

The goal is a dependable routine: **choose preparation → study offline → review difficult items → record the lesson → choose follow-up**. School, instructor, a scheduled lesson and an account remain optional. Use the existing screens, storage, identities and provider boundaries.

Baseline main: `2b5b146543e1dfa30e056ab416ee9067a3b6fe5e` (PR #256), package 0.5.7/schema 20. Source inventory only; no fresh app tests or installed claims. HW-01b/c and the card part of HW-01d are merged, while HW test-run/daily-plan integration remains unfinished. GEN-03 is merged. OFFLINE-ON pressure/activation remains a reviewer gate. Earlier roadmap paragraphs saying otherwise are historical snapshots.

**Keep the existing sequence:** finish the active homework round and any unresolved OFFLINE-ON acceptance → remaining HOMEWORK-01 → EXPORT-01/02 → ACS-READY-01 → SCHOOL-01 → FLIGHTLOG-01. Retain existing scheduler/weather/FAA/Study Hub queues. This addition does not move oral practice or a PDF renderer ahead of those choices. Requirements below can refine an existing assigned slice only when its reviewer explicitly includes them; they do not silently expand an in-flight round.

The six DIFF IDs are acceptance groups over that plan, not six replacement systems or new navigation destinations.

| ID | Outcome | Existing owner / dependencies | Incremental scope |
| --- | --- | --- | --- |
| DIFF-01 | Prepare for my next flight | M1, P54-05, HOMEWORK-01 remainder, HUB-04/07; ACS tagging later | Connect exact study/homework evidence and approved follow-ups to current recommendations/briefs. |
| DIFF-02 | Complete offline lesson packs | OFFLINE-01/ON, GEN-01/03, HOMEWORK-01 | Use an assignment as a collection; add aggregate capability checks and dependable resume, not another kit generator. |
| DIFF-03 | Practice that remembers mistakes | M2 attempts/cards, HUB-04/05; P54-06 separately gated | Link missed-version evidence to a bounded next session; keep the current scheduler. |
| DIFF-04 | Offline oral scenarios | M6, HUB-05, reviewed source/ACS mapping | Versioned text/free-response practice and transparent discussion criteria. Voice is optional later work. |
| DIFF-05 | Study directly from the PDF | M4/source lineage, HUB-01/03/08; renderer/OSS gate for highlights | Use existing page/bookmark notes as study inputs; selected text/highlights require a separate feasibility decision. |
| DIFF-06 | Portable training history | Existing backup/packet/export contracts and iOS track | Verify distinctions and current-schema mobile restore; no silent sync/merge or v1 packet extension. |

## 2. DIFF-01 — Prepare for my next flight

**Her workflow.** Open the existing Daily Flight Plan or lesson. See a small suggested session with plain reasons: a due assignment, a page relevant to a chosen difficulty, several due cards, and a question she selected for her instructor. Edit/accept items. After a lesson, deliberately choose which follow-ups become work.

**Reuse:** `logic/recommendations.ts`, `dailyPlan.ts`, `preparation.ts`, `lessonBrief.ts`, homework/action/question repositories and M3 evidence. Complete HW-01d's remaining action/test integration before inventing another link table or planner. Existing priority rules, pinned tasks and accessible remaining work survive.

**Bounded slices:** (a) pure candidate/reason contracts over existing links; (b) accepted-action/homework navigation and idempotent completion wiring; (c) briefing/checklist presentation and privacy review. Use actual available estimates for time budgets; unestimated work stays visibly unestimated. Do not infer a lesson focus from every word in a private journal.

**Acceptance:**

- `DIFF01-A`: fixed inputs, local date and budget produce stable IDs/order/reasons; cold start/no history/no lesson is usable.
- `DIFF01-B`: repeated acceptance, uncertain acknowledgement and restart create one intended action/link; a stale or deleted assignment is refused with a recoverable explanation.
- `DIFF01-C`: moving/rescheduling/cancelling a lesson re-evaluates relevance without rewriting previous completion evidence. Unrelated cards/attempts and opening a PDF do not complete homework.
- `DIFF01-D`: private journal, instructor text, finance/medical records and file paths remain excluded from ordinary exported briefs. Deliberate inclusion requires preview and its existing applicable contract.
- `DIFF01-E`: the selected reading/cards/test/reflection can be reopened and saved while disconnected; no provider is contacted to build the deterministic plan.

**Done means:** an observed end-to-end source→selection→activity→evidence→brief flow, with exact provenance and a usable no-enrolment state. Suggestions and completion do not certify flight readiness.

## 3. DIFF-02 — Complete offline lesson packs

**Her workflow.** A Homework assignment is the initial “lesson pack.” It brings together selected readings, saved guides, card sets, quiz versions, questions and reflection. Before travel she sees which selected activities work without a connection. On return she resumes unfinished work.

**MVP contract.** Derive availability from existing records; propose storage only if the current assignment cannot retain a required identity. Do not duplicate PDFs for every pack. Do not invent a transferable multi-material container in this slice. Every included activity retains its own version/hash and current source-repair flow; historical content is not silently replaced with the latest generation.

**Capability display:**

| Capability | Required evidence | Honest failure |
| --- | --- | --- |
| Read a selected PDF | Managed bytes readable and checked against the selected identity/range | Missing/changed/checking; a cloud placeholder is not ready. |
| Review saved cards/guide | Selected saved version/items available locally | Content missing/changed; offer deliberate repair. |
| Take/resume a saved quiz | Exact test/attempt state is available and writable | Saved attempt/version unavailable; never substitute another quiz. |
| Search source text / create a PDF kit | Release feature enabled and matching cache coverage for the requested pages | Feature unavailable or partial coverage; image pages may still be readable. |
| Generate a new Gemini answer | Explicit queued/requested provider operation and a usable connection | Needs connection; saved study remains usable. |

Evaluate the required capabilities, not every possible one: a reading-only pack does not require OCR, extraction or an AI-generated guide. Recheck after restore, replacement, deletion and return from suspension. A persisted badge is not authoritative. Use existing visibility/batch queries rather than one filesystem/SQL request per card on each render.

**Acceptance:**

- `DIFF02-A`: select several materials, disconnect, restart, read/review/answer/save/resume with exact selected identities. Instrument unexpected application network attempts; require zero for this local workflow. External PDF-reader behavior is observed separately from the app's own egress.
- `DIFF02-B`: mixed text/image PDFs show distinct read/search coverage; unreadable, encrypted, partial and deleted sources do not yield an unqualified ready claim.
- `DIFF02-C`: source replacement or clearing a derived cache invalidates only affected capabilities; accepted saved notes/cards/history remain intact.
- `DIFF02-D`: generation failure/cancellation has no effect on already saved content. Never start a deferred upload merely because a connection returned unless the existing explicitly requested queue contract permits it.
- `DIFF02-E`: navigation away, disk-full, autosave overlap, restore and failed acknowledgement preserve the last acknowledged state; ambiguous commits reconcile by the same operation identity.
- `DIFF02-F`: source/debug switches cannot be mistaken for installed release activation; honor OFFLINE-ON's memory/reviewer gate before exposing extraction/search in distribution.

**Bounded slices:** availability model/read APIs; homework UI/resume; installed disconnected smoke. No new “offline engine” or local model. Finish the agreed source/pressure lane before performance claims.

## 4. DIFF-03 — Practice that remembers mistakes

**Her workflow.** After practice, open the exact missed/skipped items, follow the corresponding source, and select a manageable follow-up. Later, the existing due-card queue brings items back. Explain why each item is suggested; don't turn a large overdue backlog into a guilt-inducing requirement.

**Reuse:** frozen `practiceSessionRepository` versions/responses, `practiceAttemptReview.ts`, current card identities/generation barriers, `simple-v1`, `cardLibrary.ts`, and existing Study Focus/recommendation APIs. Do not create a duplicate attempts database or silently reset/reschedule cards.

**Bounded slices:** (a) exact-version follow-up selector and source destinations; (b) explicit acceptance into an existing study/homework flow; (c) calm explanation/remaining-work UI. A new cross-material durable session is conditional: write a contract only if current homework/card runs cannot meet the observed resume requirement.

**Acceptance:**

- `DIFF03-A`: wrong, don't-know, unanswered and correct remain distinct; source/answer/explanation come from the frozen attempted version, never the newly generated one.
- `DIFF03-B`: revealing an answer or opening a source is not a new scored response. A later correct answer does not rewrite an earlier result.
- `DIFF03-C`: reset, erasure, source deletion, correction and regeneration preserve their existing documented semantics; no erased history is resurrected through a recommendation cache or scheduler transition.
- `DIFF03-D`: duplicate click/retry, app close before acknowledgement, local-midnight/DST/travel and backwards-clock cases preserve one acknowledged event and correct due interpretation in both engines.
- `DIFF03-E`: suggestion size is bounded and opt-in; missing sources and no-history states remain useful. Unselected/overdue work remains accessible.

**FSRS boundary:** finish the existing pinned feasibility/reference-vector comparison and review its actual results before any adoption/transition. A library exception, storage change and retention UI are separate decisions. Self-rated recall, confidence, quiz performance and instructor observations never collapse into one pass/readiness percentage.

## 5. DIFF-04 — Offline oral-exam scenarios

**Her workflow.** Choose a saved, reviewed scenario; read its assumptions; answer before revealing the discussion outline; note uncertainty and choose a follow-up or instructor question. Example content must be authored/reviewed against applicable sources, not supplied as operational flight advice by this research task.

**First version:** text-only, offline, bounded scenario and follow-up tree, optional typed answer, source-linked discussion criteria and explicit self-review. No microphone, live provider, transcript service, automated skill grade or dynamic AI questioning is needed. Keep normal guides/cards/quizzes unchanged.

**Contract proposal for review:** stable scenario/version IDs, captured source revision/aircraft assumptions, rubric revision, prompt order, answer/self-review history and resume state. Decide privacy and erasure before persistence. Existing multiple-choice tables accept selected indices: do not fabricate a correct choice to represent an oral answer. Any additive schema is numbered only when assigned against then-current main.

**Acceptance:**

- `DIFF04-A`: reveal occurs after deliberate action; self-review is visibly separate from an automatic score or instructor assessment.
- `DIFF04-B`: the saved scenario/rubric/source version is frozen for a session; corrections create a new version and flag affected future study without rewriting earlier answers.
- `DIFF04-C`: insufficient evidence, conflicting editions and aircraft mismatch are stated; unsupported claims do not gain authority from an ACS label.
- `DIFF04-D`: no account/enrolment/connection required; interrupt/resume/delete/backup/restore preserve the exact agreed history/privacy contract.
- `DIFF04-E`: keyboard/screen-reader use and long responses work without a hidden time limit or shaming language.

**Later voice gate:** only a separately approved recording/recognition capability trial. Check locale/device support, permission denial, asset availability, retention and deletion. Require local-only recognition with no fallback upload when promising offline. Do not add a local model; the owner excluded it. A transcription is not an objective grade of aeronautical reasoning.

## 6. DIFF-05 — PDF study, source notes and highlights

**Her workflow.** Open a supporting source, save a page-linked note/question, and deliberately turn a passage into reviewed study material. Preserve the original publication and her corrections across edition changes.

**Phase A, over current M4:** NavigationBookmark already stores title, notes, managed content identity, physical page and printed label. Reuse it as the page-note entry point and add only the explicit study-authoring connection or proven editing/navigation gaps. Do not add a second bookmark/page-note table. Retain clear copy-page/open-reader guidance. The current native reader handoff cannot ensure an external app jumps to that page. Do not label file handoff as a verified exact-page jump.

**Phase B, feasibility before highlight implementation:** compare an appropriately pinned shared renderer with a native Apple PDFKit adapter and a Windows path. Reuse existing M4/OSS findings. Current PDF.js upstream support does not prove macOS 12 compatibility. Never raise the app minimum OS, widen filesystem/CSP permissions or install a dependency just to make a prototype pass. Browser/source proof and installed WKWebView/Preview/Windows behavior remain separate gates.

**Phase C, after approval:** sidecar annotations with immutable PDF identity, physical page, quote/context, declared offset/normalization/extractor version, and page-space geometry only where actually provided. W3C character positions must not be confused with existing UTF-8 byte offsets. Store new app annotations separately and preserve original PDF bytes during app annotation operations. External reader edits remain possible; reinspection must detect them and invalidate affected anchors. Source replacement gives stale/ambiguous status; do not fuzzy-attach a safety-relevant note to a different edition automatically.

**Acceptance:**

- `DIFF05-A`: original-file SHA-256 stays identical after add/edit/delete notes/highlights and every cancelled/failed save.
- `DIFF05-B`: Unicode combining marks/emoji, repeated passages, rotated/cropped pages, printed labels and nested split lineage resolve correctly or refuse as ambiguous. Verify 0-based internal page indices versus 1-based displayed physical pages explicitly.
- `DIFF05-C`: missing/replaced sources and extraction-version changes retain the note/quote but invalidate unproved positioning. A citation alone never means an explanation was verified.
- `DIFF05-D`: “Make card/question” opens an editable preview and uses current authoring/version/retirement semantics. Instructor corrections remain private in exports by default.
- `DIFF05-E`: renderer workers/fonts/assets are local, pages are rendered lazily, memory/cancel/cleanup are bounded, and PDF scripts/links cannot cause unrequested uploads or broad file access. Retain the default-reader fallback.
- `DIFF05-F`: independently observe selection, focus, VoiceOver/Windows keyboard operation and performance on each promised installed runtime before enabling the feature.

This is new planning for a capability deliberately excluded from the earlier split-lineage slice. It does not retroactively enlarge or change that delivered contract.

## 7. DIFF-06 — Portable training history

**Her workflow.** Clearly choose one of three outputs: a study packet to share chosen study text; a handout/CSV for paper or an outside tool; or a complete personal backup to move/restore her data. See what is included and what is lost before saving/importing.

**Desktop slice:** finish EXPORT-01/02 over existing commands, including cancellation, atomic save, selected content, separate answer keys and accessible self-contained output. Confirm the full-backup UI identifies missing files and warns that restore replaces current data. “Complete” must not hide `missingAtExport` disclosures.

**Mobile slice:** audit the current schema and archive readers against accepted main first. Old iOS documents reference schema 9 and v2 writers; they are historical, not a current compatibility specification. The current `platform.rs` credential trait remains scaffolding; desktop uses the existing file store, with `keyring` still present for legacy migration. An implemented iOS credential/file boundary must be verified rather than inferred from those traits. Current complete backup writes v3 and restores supported v1/v2; schema-20 homework evidence must be validated, not ignored. Copy a user-selected security-scoped file into controlled staging, check disk capacity/path/size/hash/schema limits, preview replacement, preserve rollback, remap relative storage and import in a disposable profile before any real profile.

**Acceptance:**

- `DIFF06-A`: packet v1 round-trips exactly the fields it actually supports. Explain that PDFs, attempt/review history, job-resume state and machine source anchors do not travel; never link to a receiver's unrelated PDF.
- `DIFF06-B`: full backup preserves all included acknowledged records/managed documents, including new homework/source/correction evidence, while keeping keys, external paths and irrelevant cache/job data out according to its current allowlist. Compatible v1/v2 restores and unknown/newer-schema refusal retain their contract.
- `DIFF06-C`: write/rename/validation failure leaves the previous valid export intact; interrupted restore returns the original database/documents and leaves a diagnosable recovery state. Exercise autosave and PDF work concurrency with bounded waits.
- `DIFF06-D`: inspect actual Mac→iPhone import while disconnected after the file is downloaded; permission denial, picker cancellation, stale cloud placeholders and insufficient capacity are handled. No iOS readiness claim from a desktop parser test.
- `DIFF06-E`: exact contents, counts and lost-field disclosures are checked across guide/cards/test/history/source identity, not only whether an archive opens. A digest validates bytes, not who authored the content.
- `DIFF06-F`: no automatic merge or live database synchronization. A future merge needs independent UUID/version/tombstone/conflict/receipt and rollback design; no “latest timestamp wins” shortcut.

A multi-document portable lesson pack is conditional future format work. Do not append unsupported fields to strict packet v1, rename an archive without changing its contract, or claim that the plain backup is encrypted. Sensitive personal backups need an explicit storage/sharing explanation; this plan does not introduce an encryption dependency or send a file to anyone.

## 8. Reviewable work order and entry criteria

1. **Finish and measure the current lane.** Remaining HW-01d test/action work, agreed OFFLINE-ON pressure/activation and EXPORT-01/02 acceptance. Reuse DIFF-02/06 criteria that fit those approved scopes; leave unrelated ideas queued.
2. **Protect the approved owner queue.** ACS-READY-01 → SCHOOL-01 → FLIGHTLOG-01 remain in order. Do not require a school or aircraft before these workflows are useful.
3. **Scope connected sessions and preparation.** DIFF-02/03/01 refine HUB-04/07 using the completed foundations. Present one bounded assignment at a time; no second scheduler or global recommendation rewrite.
4. **Connect existing bookmark notes before advanced annotations.** DIFF-05 phase A, then a documented runtime/reader feasibility decision before B/C. Reuse the existing source/OSS queue, without bypassing its decisions.
5. **Add oral scenarios.** DIFF-04 text-only after its source/assessment contract and human content review. Voice remains optional.
6. **Run mobile transfer as its own platform lane.** DIFF-06 current-schema audit can proceed as documentation; iOS runtime implementation/device evidence is independently assigned when the owner selects that lane. It does not block desktop follow-up sessions.

These are dependency recommendations for unassigned work, not dates or a permission to preempt current assignments. Each assignment specifies its named worktree, owner/reviewer, baseline, touched files, exact invariants, meaningful tests, resource budget and stopping point. New dependencies, model assets, formats, permissions, minimum OS changes and schemas require their established review/owner decisions. No migration number is reserved by this plan.

## 9. Shared definition of done

- Failing-first regressions for reproduced bugs and fault injection for new data/availability guards. Independent scratch mutations must make the relevant assertions fail; no production test backdoors.
- Native SQLite and browser/test parity for mutations, validation, ids, clocks, privacy and backup semantics. Retain existing erasure/generation/receipt rules and all shipped migration checksums.
- Follow the current AGENTS reviewer recipe, including independent verification and UI walkthrough where applicable. Preserve failed and skipped receipts; no count or “green” claim from zero collected tests or an unreached seam.
- Measure against existing corpus/harness and accepted budgets. Record hardware/runtime, cold/warm conditions, pages/bytes/item counts, timings, memory and build sizes. No optimization claims from inspection; M5 memory-pressure observations are not minimum-spec simulation.
- Disconnected installed tests cover first launch/restart, import/read/study/save/reopen, source changes, cancellation, disk failure and restore. Observe egress separately from network availability; `navigator.onLine` is not proof of either safe offline behavior or a usable provider connection.
- Keyboard/focus/screen-reader checks and readable error/progress messages; preserve macOS 12 fallback and Windows behavior. Claim each platform only at the evidence level actually observed.
- Before publication, reconcile current main and open work, get independent GREEN review, run required CI on the exact head and verify the accepted merge. The implementer never approves/merges its own round. No release/tag/version change is assigned here.

## 10. Decisions intentionally left to the bounded design round

The product directions are now recorded by the owner's request. Only decisions with real behavioral consequences need owner review: transfer fidelity/new format, optional answer/confidence retention, recording/privacy, renderer/minimum OS trade-offs, any below-threshold package exception, and scheduler transition. Routine use of current repositories/UI should not trigger repeated permission requests. Present a concrete reviewed recommendation when such a choice becomes necessary.

Do not add cloud accounts, a local LLM, real-time flight guidance, an instructor portal, automatic journal uploads, automatic cross-device merge, a new chart/weather subsystem, gamified streak penalties or a certification score to satisfy this roadmap.
