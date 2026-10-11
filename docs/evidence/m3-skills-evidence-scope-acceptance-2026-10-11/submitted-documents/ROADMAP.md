## M3 remaining corrections M3-R8–R10 — 2026-10-11

**Corrected, pending independent re-review.** The interrupted R8–R10 package is complete, uncommitted and unpushed (`codex/m3-skills-evidence-scope`, base `48fa47d`).

**The three fixes:**
- **M3-R8:** the form acknowledges the **complete** draft (wording, date, who said it, instructor name, skill and debrief) on every submission path. It keeps every changed field and names what is unsaved.
- **M3-R9:** both validators require history → receipt ownership as well as receipt → history. Incomplete hand-written controls were given their real receipts, and a real-writer library fixture was added.
- **M3-R10:** a confirmed erasure evicts that observation's loaded history, cursor and list entry and re-reads the summary. Late answers cannot restore it; outages keep loaded pages.

**Results:**
- **192** prototype tests pass (3 opt-in skipped); typecheck is clean; **8** native tests pass.
- **85 + 29** shared cases agree on node:sqlite, sql.js and rusqlite.
- The re-review's frozen diagnostics pass **7/7** and **2/2**.
- **17/17** decisive reversions are caught. One equivalent mutant is reported and explained.
- Fixtures regenerate byte for byte; restore validation is about 3–9% slower.

**First-review diagnostics:** five fail on the current source. They are R2a's invalid setup, R4 ×2 on the superseded unpaged API, and the built-in retirement control, whose missing receipt R9 now refuses. Valid equivalents pass on all engines.

**Links:**
- Report: [M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md](docs/M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md).
- Evidence: [m3-skills-evidence-scope-remaining-corrections-2026-10-11](docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/README.md).

**Still true:**
- M3-D1–D9 remain **PROPOSED**; candidate 0014 is unchanged and unregistered; production is unchanged.
- The native writer and readers are unbuilt, and the UI evidence is jsdom only.
- G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.

## M3 scope independent re-review — 11 October 2026

**CORRECTIONS REQUIRED, narrowed to M3-R8–R10.** Independently verified corrected baseline: 162 prototype tests passed / 2 opt-in skipped, strict typecheck clean, native 7 passed; earlier native diagnostics 5 passed. Most R1–R7 work is verified and retained. Remaining issues: full-draft metadata acknowledgment (R8), reverse history-to-receipt validation (R9), and cached-content eviction after confirmed erasure (R10). New diagnostics reproduce 6 TS/UI failures and 1 native failure with positive controls passing.

The reviewer corrected the earlier R2a diagnostic's invalid erase setup; the valid-argument equivalent fails on original source and passes on corrected source. The old unpaged R4 API is intentionally superseded. Do not reopen those settled corrections.

- [Independent re-review](docs/M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md).
- [One active model-neutral correction assignment](docs/M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).
- Correction submission published for collaboration, not accepted production code. M3-D1–D9 remain PROPOSED. Candidate 0014 remains unchanged/unregistered. G1–G3 deferred/unexecuted/unverified; post-receipt recovery blocked/source-covered. Both active dirty worktrees preserved.

## M3 scope/prototype corrections M3-R1–R7 — 2026-10-11

**Corrected, pending independent re-review.** All seven review findings are fixed together in the scope/prototype worktree (`codex/m3-skills-evidence-scope`, base `48fa47d`). The work is uncommitted and unpushed.

**Before editing:**
- the 57 frozen submitted hashes, the 51 original checksums and the 30 production anchors were verified;
- the frozen state was reproduced exactly (102 passed; review diagnostics 17 failed / 4 passed in TS/UI and 3 failed / 2 passed natively).

**Results on the corrected code:**
- **162** prototype tests pass (2 opt-in skipped); strict typecheck is clean; **7** native tests pass.
- **72** validation and **29** constraint cases agree on node:sqlite, sql.js and rusqlite.
- The review's native diagnostics pass **5/5**; its TS/UI diagnostics pass **18/21**.
  - The two R4 cases call the deliberately replaced unpaged `history(id)`; the paged equivalent passes.
  - R2a's own setup sends an invalid erase request. With only that argument corrected, it fails on the frozen code and passes on the corrected code.
- 23 new reversions are all caught; S1–S8 were rechecked (S4a still masked by `ConnectionOwner`).
- Benchmarks were re-run for the changed paths.

**Links:**
- Report: [M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md](docs/M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md).
- Evidence: [m3-skills-evidence-scope-corrections-2026-10-11](docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/README.md).
- Corrected [scope](docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and [conditional implementation prompt](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).

**Still true:**
- M3-D1–D9 remain **PROPOSED**, pending owner approval.
- Candidate 0014 is unchanged and unregistered.
- Production code, migrations 0001–0013, dependencies and release configuration are unchanged.
- The native writer is specified, not built; the UI evidence is jsdom only.
- G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.
- The primary clone's Mac preflight work was left untouched.

## M3 scope/prototype independent review — 2026-10-10

**CORRECTIONS REQUIRED: M3-R1–R7.** The original 102 prototype tests, strict typecheck and 7 native tests pass independently, but frozen reviewer diagnostics reproduce 17 TS/UI failures and 3 native failures, with valid controls passing. Fix write/publication ownership, uncertain-save reconciliation and draft retention, StrictMode lifecycle, bounded access to every revision, receipt ownership, restored catalog rules and date-edit pagination before technical acceptance.

- Review: [M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md](docs/M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md).
- Next model-neutral task: [M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md](docs/M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md).
- Original submission/evidence published for collaboration, **not accepted**. M3-D1–D9 remain PROPOSED; conditional production assignment remains inactive. Candidate 0014 is evidence only, not registered.
- Original dirty M3 worktree and the primary clone's separate Mac preflight documents were preserved. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.


**10 October M3 skills and feedback evidence: scope and prototype PROPOSED, pending senior review.** Delivered together:
- the [scope](docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md): contracts, UI flow, candidate schema and nine PROPOSED owner defaults (M3-D1–D9);
- the [evidence pack](docs/evidence/m3-skills-evidence-scope-2026-10-10/README.md): candidate migration 0014, a runnable disposable prototype, shared fixtures, a rusqlite twin, receipts and SHA256SUMS;
- the [conditional implementation prompt](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).

Results:
- Prototype tests: 102 passed on node:sqlite and sql.js (jsdom for the UI); prototype typecheck exit 0.
- Native crate: 7 passed on the app's own rusqlite 0.32.1 with bundled SQLite.
- Shared contracts: 25 validation and 29 constraint cases agree on all three engines.
- Genuine populated schema 13 → 14 upgrade keeps every retained row; a failed upgrade rolls back.
- Backup/restore round trips match; a tampered backup is refused; the shipped schema-13 driver refuses 14 with its bytes unchanged.
- Reversions: 8 caught, 1 masked as expected.
- Source-level benchmarks to 10,000 observations: pages flat at about 0.1–0.23 ms.
- One NULL-unsafe CHECK was found and fixed during prototyping.

Production source, registry and dependencies are unchanged (`origin/main` `48fa47d`). Work is in worktree `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, uncommitted and unpushed. New M3 retention and product defaults need scope acceptance and owner approval before production. Installed G1–G3 stay DEFERRED/UNEXECUTED/UNVERIFIED; post-receipt recovery stays BLOCKED/source-covered. No app launch, provider call, installer, signing or release.

**10 October active roadmap continuation — M3 skills and feedback evidence:** The owner requested continuing the roadmap after deferring installed Mac verification. [Next model-neutral assignment](docs/M3_SKILLS_EVIDENCE_SCOPE_PROMPT_2026-10-10.md): deliver one scope/runnable disposable prototype/candidate-schema/conditional implementation package linking debrief observations to stable skills and follow-up actions, with honest attribution and retained history. New M3 defaults remain proposed until reviewed and approved; no production migration is activated by this handoff. Accepted M1/M2 source is preserved; remaining M2 UX requirements must be recorded rather than assumed complete. G1–G3 stay deferred/unexecuted/unverified; signing/release gates remain separate.

**8 October C2 production source accepted for integration:** C2SRC-R1/R2 closed. All 32 source hashes, 57 original and 30 correction evidence checksums verify. Independent affected/frozen tests: 112 passed / 1 skipped; typecheck/build pass. R2's prior baseline precondition error is corrected in the acceptance; semantic revert independently fails at the real assertion. Submitted final gate: 2,808 frontend pass / 5 skips / zero unhandled; 420 Rust pass / 6 ignored. [Source acceptance](docs/M2_CARD_REVIEW_C2_SOURCE_ACCEPTANCE_2026-10-08.md); containing source PR supplies exact-head CI and merge. Library-wide views are complete; split lineage and installed/platform M2 acceptance remain. [Next model-neutral split-lineage scope/proof assignment](docs/M2_SPLIT_LINEAGE_SCOPE_PROMPT_2026-10-08.md). Earlier pending C2 rows are historical after merge. No signing/release activation.

**7 October C2 final-corrections re-review:** 34 submitted hashes verify; all 37 frozen cases and 24 submitted proof cases pass. Preserve filters, current-content revalidation, event identity, basic Retry, history/upgrade proof, actual batching and mutation survival enforcement. Focused follow-up: two controls pass / nine assertions fail across pending consumption/history cursor ownership (R8), authoritative reset/order and synchronous ownership (R9), and unenforced card/raw-byte caps (R4). Owner mutation still fails with its injected mutation removed. [Specific review](docs/M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md); [one focused read-pipeline assignment](docs/M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 remains accepted. The original dirty clone and all prior evidence are preserved. No production/installed/release work authorized.

**7 October C2 completion review — corrections required:** 32 delivery hashes verify; prior frozen diagnostics 9/9 and 12/12 and submitted proof 21/21 pass. Production parity, shipped-schema baseline and actual 3/2 SQL batching are verified. New focused diagnostic: two controls pass / 14 assertion failures across unapplied filters (R7), stale cached cursors (R8), controller event identity/retry/reconciliation (R9), and historical context (R10). Mutation verifier still reports success when expected failures are removed (R11); bounded performance/accounting claims need correction. [Review](docs/M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md); [one active model-neutral correction assignment](docs/M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 acceptance persists. Original dirty planning clone is preserved. No production/installed/release work activated.

**7 October C2 correction re-review:** C1 acceptance remains in force. [C2 R2/R3 reviewed cases are fixed; R1/R4/R5/R6 require completion](docs/M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md). [Active model-neutral scope completion assignment](docs/M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md) supersedes earlier correction prompts. Production C2 and its defaults await independently supported scope and owner approval.

**7 October C2 planning review:** C1 is accepted in PR #111. Library-wide Review due/History planning needs [C2-R1–R5 corrections](docs/M2_CARD_REVIEW_C2_SCOPE_REVIEW_2026-10-07.md) before owner decisions. [Active model-neutral planning correction assignment](docs/M2_CARD_REVIEW_C2_SCOPE_CORRECTIONS_PROMPT_2026-10-07.md). C2 production execution remains conditional on supported scope acceptance and recorded defaults.

# Her Flight Deck — implementation roadmap

**7 October M2 source update:** material-level card reviews C1 complete independent source review, with migration 0012 and approved `simple-v1` scheduling; the containing PR supplies final CI/merge. See [acceptance](docs/M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md). Next: [C2 Study Library Review due/History scope and disposable query proof](docs/M2_CARD_REVIEW_C2_SCOPE_PROMPT_2026-10-07.md), before owner approval of new defaults. Installed/signing/release gates remain separate. Earlier dated milestone snapshots remain historical.

**4 October current state:** Structured study import Slice B is [accepted for source integration](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md). The real-user check-in has been waived; installed/release observations remain separate. The [next assignment](docs/M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) prepares one bounded saved/resumable-practice-test scope using this existing M2 design. Remaining retention/versioning decisions and new migration/attempt implementation still require owner scope approval. Earlier check-in and pending-import descriptions below are historical where superseded.

Prepared 24 September 2026. Planning document; no feature implementation or release authorization is implied.

Repository: `H:\Ai Repo clones\Flight-training-`

Remote: https://github.com/rickydeleon49-ui/Flight-training-

Reviewed baseline: `a586f91a07529da96fa7856c12be929ab4b29eec` on `main`.

Foundation fixes were being edited during this review. Their implementation and validation are outside this roadmap. Reconcile that work against the final reviewed branch before starting feature development. This roadmap is a separate repository document; it does not alter those fixes.

**Shared continuation (2 October 2026):** both machines start from [the project handoff](docs/PROJECT_HANDOFF.md). The [open-source adoption plan](docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md) and [Mac continuation prompt](docs/OPEN_SOURCE_MAC_HANDOFF.md) support this roadmap without replacing its foundation and M2 user-check-in gates. Research is not dependency or release approval.

**Owner addition (3 October 2026):** [aviation weather and FAA reference data](#17-aviation-weather-and-faa-reference-data-3-october-2026) are now planned product enhancements. A2 corrections are in progress; the owner will notify Codex when they are ready for review. Adding these items does not mark A2 accepted or start their implementation.

## 1. Product decision

Build a dependable training companion that answers: **What should I work on before my next lesson, and why?**

The experience to implement is:

**Lesson → debrief → selected improvement → linked study → review → instructor question → next lesson.**

Keep the existing React/TypeScript/Tauri application, local SQLite storage, Windows support, and Apple Silicon target. Improve the current screens. Do not introduce an account, cloud backend, subscription system, or another application framework to implement this roadmap.

The first feature increment will improve the existing Daily Flight Plan and debrief workflow. The next substantial investment will turn Study Library into a place for repeatable study sessions with saved progress. Skills and readiness follow the collection of trustworthy evidence; they do not precede it.

## 2. Review of the supplied proposal

The proposal's strongest ideas are short daily plans, explainable recommendations, review scheduling, source-linked study, and a connection between lesson feedback and the next lesson. Keep these.

Its weaknesses are excessive scope, several duplicate systems, and readiness displays that imply more certainty than the available data supports. Seventeen feature phases should not become seventeen new navigation destinations.

Specific corrections:

- Today's Flight Plan already exists. Extend `buildDashboard` rather than introducing a parallel Today module.
- Debrief, instructor feedback, confidence, flight hours, instructor questions, milestones, and finance records already exist. Connect and refine them before adding replacement tables.
- Practice tests already exist. The missing capability is durable attempts, missed-question review, resumable sessions, and useful history.
- Core desktop records and managed PDFs already work locally. Offline use is an acceptance criterion throughout the roadmap, not a separate cloud-sync project.
- The generic `/uploads` item is not an established defect in this repository. Managed documents use app-owned storage; do not create a web upload route to satisfy the proposal.
- The proposal's request to avoid plaintext credentials is a separate security design decision. Desktop currently uses a user-profile file for update compatibility; iOS must use Keychain. Do not replace that mechanism casually during feature development.
- Remove mockups showing unexplained overall confidence/readiness percentages. Show self-report, observed performance, recency, and missing evidence separately.
- Do not automatically synchronize devices. The requested first mobile transfer remains Mac backup → user-selected iPhone import, with an explicit replacement warning.
- Additive migrations and tested backup recovery are the rollback strategy. Do not promise that every schema change supports safely opening newer data in an older binary.

### Competitor evidence

The [FlyCowboys App Store listing](https://apps.apple.com/us/app/flycowboys-pilot-training/id6752837940) advertises adaptive study, offline access, practice questions, oral preparation, and radio practice. Its current listing includes Commercial as well as Private and Instrument courses. These are advertised capabilities, not independently tested outcomes.

The [product website](https://www.flycowboys.io/) promotes a study path and readiness analytics. Treat its numerical effectiveness claims as marketing unless independent evidence is available. Its website and [FAQ](https://www.flycowboys.io/faq) do not describe their guarantee identically, which reinforces the need to verify rather than copy claims.

Borrow workflow principles. Do not reproduce their question bank, explanations, figures, branding, or proprietary learning logic. The portfolio's technology choices do not justify changing this app's stack.

## 3. Repository reality and reusable code

Paths below are relative to the repository above.

| Area | Exists today | Actual addition needed |
| --- | --- | --- |
| Home / daily plan | `pages/FlightDeck/FlightDeck.tsx`, `logic/dashboard.ts`, `logic/actions.ts`; next lesson, prep, attention items, questions and plan groups | A short time-budgeted recommendation list, reasons, explicit selection, and per-day skip/defer state |
| Debrief | `JournalEntry`, `JournalForm.tsx`: strengths, difficulty, instructor feedback, questions, confidence; `logic/feedback.ts` collects history | A quick entry path, approved links to actions/resources, later structured skill observations |
| Instructor questions | `Question` already links to event, material and journal; answer/status history | Surface relevant questions inside study and lesson prep, preserve existing status workflow |
| Study Library | Managed import, search/filter/sort, 100-card initial display, guides, cards, generated tests, auto/manual PDF split | Stable study-content identity, saved attempts, review queue, source navigation, short sessions |
| Study content | `AiStudySet` and `PracticeTest` store arrays per source material | Versioned question/card IDs; current `PracticeTestPanel` keeps attempt state in React memory |
| Skills | Broad `Topic` categories and toolkit readiness checklist | A separate, versioned training-skill catalog and evidence history; do not replace Topic values |
| Flight records | `JournalEntry` contains flight times/landings; `logic/flightLog.ts` totals and narrow Part 61 references | Additional qualifying evidence and reviewed rules before any requirements-completion claim |
| Readiness | `ToolkitState.readinessItems`, credentials and `readinessSummary` | Evidence drill-down and missing-data states; preserve existing manually entered items |
| Finances | Expense categories, integer cents, lesson-linked expenses, fund goals | Transparent trends and configurable estimates; consistent definitions of included costs |
| Offline and mobile | Desktop local database/files; iOS architecture and backup documentation | Device builds and import testing require Mac/Xcode; no runnable iOS app is assumed |

## 4. Scope, sequence, and dependencies

Milestone names are scope boundaries, not published version numbers. Do not assign every feature to the next release. The first public version after the retired 0.5.2 must be 0.5.3 or later, subject to the existing release gate.

| Milestone | Deliverable | Depends on | Planning size* |
| --- | --- | --- | --- |
| M0 — Reliable foundation | Backup/document consistency, recoverable deletion, honest release evidence | Independent review of current fixes | 4–7 focused changes plus external device/vendor gates |
| M1 — Daily training loop | Improved plan, quick debrief, approved actions and instructor questions | M0 data-safety fixes | 7 focused changes |
| M2 — Study Library sessions | Durable attempts, missed questions, review queue, study history | M0; integrates with M1 | 6–9 focused changes |
| M3 — Skills and evidence | Skill catalog, observations, feedback links and history | M1; uses M2 study evidence | 4–6 focused changes |
| M4 — Source navigation | PDF page links, bookmarks, bounded viewer and local text search | M2 content identity and M0 file lifecycle | 4–7 focused changes |
| M5 — Training progress | Reviewed requirements, evidence-based readiness, cost trends | M3; rules/content review | 5–8 focused changes |
| M6 — Optional coaching | Explicitly selected feedback parsing, text oral practice, cited assistance | M2–M4; additional privacy review | Spec and quality evaluation before estimate |
| Mobile track | Dedicated iOS app with explicit Mac backup import | M0, schema compatibility, Mac/Xcode/device access | Separate platform milestone |

*Sizes count reviewable implementation slices, not days or promises. Estimate effort after each design/reproduction task. Keep one primary implementation branch active; do not overlap changes to shared schemas or backup code.

Dependency graph:

```text
M0 data safety ──> M1 daily loop ──> M3 skill evidence ──> M5 readiness
       └────────> M2 study sessions ───────┘
                         └────────> M4 source navigation
M1 + M2 + M3 + M4 ────────────────> M6 optional coaching
M0 + compatible schemas + Mac/Xcode ──> iOS backup-import beta
```

Feature work can continue locally while external release clearance is pending, once the relevant data-safety changes are reviewed and merged. Public distribution remains held.

## 5. M0 — Reliable foundation

First reproduce and resolve the previous audit findings against the current implementation:

1. Prove a finalized backup contains the managed documents referenced by its database snapshot, including during concurrent import, replacement, split, and deletion. An inventory of included hashes alone does not prove completeness. Reject incomplete exports clearly; preserve a previous valid backup.
2. Make deletion failure recoverable. Review staging, rollback and restart recovery against Windows open-file behavior. A rename alone is not a complete crash-recovery design; tests must cover every file/database transition.
3. Correct stale security and performance documentation. `AUDIT.md` incorrectly says the key never enters the webview; parts of `STATUS.md` still describe the already-replaced per-page deletion bottleneck. Document actual behavior.
4. Enforce PR checks through GitHub branch protection/rulesets if available for this repository. Until enforcement exists, do not remove the main-branch check merely to save minutes.
5. Skip expensive documentation-only checks safely; avoid redundant platform matrices without removing platform-specific coverage. Do not blindly cancel a release while it is finalizing a draft; define safe cancellation boundaries and prevent concurrent publication for the same tag.
6. Keep dependency exceptions narrow and distinguish affected shipped dependencies from lockfile-only or Linux-only findings.

Exit: deterministic failure/recovery tests pass; reviewer finds no known release-blocking data-loss path. Then test the exact candidate installers on Windows and Apple Silicon, including update over populated data. A signature alone does not establish malware clearance: scan and verify the actual distributable. Never ask the tester to disable platform protections.

## 6. M1 — Daily training loop

### User experience

The existing Flight Deck presents 3–5 recommended items for a user-selected 10, 20, or 30-minute session. Every item explains its source. Unfinished tasks remain available outside the short list. Unestimated tasks show an unknown duration rather than fabricated precision.

A user completes a lesson, adds a quick debrief, selects an improvement, creates an action linked to the lesson, chooses a Study Library resource, and carries one question into the next lesson. Creating an action or marking it complete must not automatically mark a flight skill proficient.

Initial recommendations are deterministic and offline. User-pinned work and due actions take precedence; next-lesson preparation and due study follow. Stable tie-breaking prevents the list from changing on every render. A chosen session remains stable until the user refreshes it, completes work, or its source becomes unavailable.

### Small implementation issues

| ID | Change and location | Acceptance criteria / required evidence | Status |
| --- | --- | --- | --- |
| D1 | Characterize existing behavior in `logic/dashboard`, `actions`, `preparation`, and journal/question repositories | Fixtures prove existing debrief-created actions/questions are retained; identify missing links before adding code | Merged through PR #32 (`e938f84`) (`src/logic/debriefCharacterization.test.ts`) |
| D2 | Add pure recommendation selector in `src/logic` | Same inputs/date yield same ordering; 0/3/20 candidates, time budgets, overdue tasks and unknown estimates tested; reasons include valid source IDs | Merged through PR #32 (`e938f84`) (`src/logic/recommendations.ts`, `src/logic/recommendations.test.ts`) |
| D3 | Extend Flight Deck UI | 3–5 suggestions, available-minutes control, Start, Why this, Skip today, Move to tomorrow; keyboard usable; remaining tasks reachable | Merged through PR #33 (`4e2651c`) (`src/components/dailyPlan/`, `src/logic/dailyPlan.ts`, [note](docs/M1_D3_D4_DAILY_PLAN_2026-09-26.md)) |
| D4 | Persist per-day decisions and accepted links | Idempotent acceptance; skip today is not permanent dismissal; local-date behavior and restart recovery tested; defer shows whether it changes the source action's due date | Merged through PR #33 (`4e2651c`). Planner-only deferral (due dates unchanged); stored in `app_metadata`, no migration |
| D5 | Add quick debrief mode to existing journal flow | Save a short debrief, reopen full editor, no loss of existing fields; deliberate user edits to actions/questions before save | Merged through PR #34 (`0ad0a578eca73e43dc48438bd4ed3278053433bc`) ([note](docs/M1_D5_QUICK_DEBRIEF_2026-09-26.md)) |
| D6 | Connect improvement → action → material → instructor question | Repeated acceptance creates one action/question; links survive restart; deletion shows source unavailable without deleting unrelated history; native transaction for multi-record writes | Merged through PR #35 (`1d86d57`) ([note](docs/M1_D6_DEBRIEF_LINKS_2026-09-26.md)) |
| D7 | End-to-end acceptance and documentation | Existing dataset migration, offline flow, backup/restore and Windows/Mac smoke checklist; provide 90-second workflow demo and exact validation evidence | Acceptance and performance polish merged through PR #35 (`1d86d57`). Windows desktop smoke and Apple Silicon installed-app tests unverified ([note](docs/M1_D7_ACCEPTANCE_2026-09-27.md)) |

D1 → D2 → D3/D4 → D5/D6 → D7. Implement sequentially unless independent work is explicitly assigned.

Do not add AI feedback parsing or a full skill taxonomy to this milestone. The smallest valuable initial change is D2–D3: make the existing plan explainable and manageable.

## 7. M2 — Study Library sessions (highest next investment)

Planning detail: [M2 Study Library design](docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md). This is not authorization to start migration work before the M1 user check-in.

### A. Durable content and practice history

Assign stable IDs to generated cards/questions and preserve generation versions. Current array positions and `updatedAt` are insufficient for durable history: regeneration must not attach an old answer to a different question.

Store completed and in-progress practice sessions, question responses, the exact content version, result, and completion time. An incomplete session is not scored as a completed test. Reopen after restart, resume deliberately, retake as a new attempt, and review missed questions. Add “I don't know”; record it distinctly rather than counting a guessed answer as mastery.

Legacy generated material receives stable identity through an additive migration or deterministic first-use upgrade with tests. Do not invent previous attempts from the existing toolkit's aggregate quiz history; preserve it separately unless provenance proves equivalence.

### B. Review queue

Persist card-level review state and immutable review events. Use Again / Hard / Good / Easy. Start with a deterministic, versioned interval scheduler; adopt a maintained FSRS implementation only after a focused licensing, dependency, behavior and migration review. Avoid claiming adaptive mastery from a few repetitions.

Keep first-use reviews, previously failed cards, and due cards visible. Repeated clicks or resumed writes must not create duplicate review events. A suspended card disappears from due work without losing history. Regenerated or edited content creates an explicit version relationship; old reviews stay attached to what was actually studied.

### C. Study workspace

Within existing Study Library, add views for Library, Review due, and History. Material detail keeps guide, flashcards, practice test, source file and provenance together. Offer short sessions from a selected material or user-approved collection; reuse local saved content without another Gemini request.

Show source material, generated date, model, page reference when known, and a flag/report action for questionable generated content. A flag excludes disputed content from progress conclusions until reviewed. Refer to these as practice results on user material, not an official FAA exam score.

Automatic split parts retain per-part guides and gain parent/source page-range metadata for navigation. Keep the existing 50 MiB/1,000-page contract unless a separately reviewed API compatibility change justifies altering it.

### Exit tests

- Start, answer, close, reopen, resume and finish a test without losing answers.
- Generate replacement content without overwriting past attempts or review history.
- Study saved content offline, with no key configured, and with Gemini unavailable.
- Delete/replace a source without dangling active sessions; preserve meaningful historical text/provenance under an explicit retention policy.
- Backup and restore a populated library including sessions, responses, card history and split lineage.
- Test due-date handling across local midnight/timezone changes using an injected clock.
- Benchmark 100/2,500/5,000 materials and 10,000 review items; query/paginate history rather than loading it all in `AppDataContext`.

## 8. M3 — Skills and feedback evidence

Use a small versioned catalog with stable IDs and optional ACS mappings. Verify mappings against the [FAA ACS index](https://www.faa.gov/training_testing/testing/acs); broad library topics remain unchanged. Allow custom skills without claiming they are official ACS elements.

Store observations linked to a journal entry or source. Distinguish student self-report, student-transcribed instructor feedback, and genuinely verified instructor input. Preserve the original wording and date. No automatic instructor sign-off from a quiz or task.

Display Learning / Practicing / Needs review plus explicit evidence. Confidence is a separate self-rating. A feedback item can be linked to an action and marked addressed by the user; completing the action alone does not prove the feedback was resolved in flight.

Exit: editing an observation retains intelligible history; missing sources are handled; recommendations explain their evidence; small sample sizes show insufficient evidence. One skill's practice score cannot stand in for flight proficiency.

## 9. M4 — Document navigation and local retrieval

Ship in two steps:

1. Source links, bookmarks, last-read page and a material/page destination. Validate actual page ranges; distinguish PDF page index from printed page labels. An unsupported native page jump must visibly fall back to opening the file with the page number shown.
2. Evaluate a maintained embedded viewer with lazy page rendering, bounded memory, keyboard navigation, zoom and text search. Keep native Open/Reveal available. Gate annotations and saved regions behind separate storage/backup tests.

Persist annotations separately from originals. Tie extracted text and annotations to a document content hash; a replacement invalidates stale indexes and prompts before relinking annotations. Derived text is rebuildable and excluded from authoritative backup requirements. Test SQLite FTS availability in both desktop and browser-test adapters before choosing it. OCR, embeddings and full-library AI indexing are deferred until measured retrieval failures justify them.

Exit: long and image-heavy PDFs render without loading all pages at once; source unchanged; links survive compatible restore; no hidden PDF upload; benchmarks include peak memory and painted interactions on actual devices.

## 10. M5 — Progress, requirements and costs

Improve existing Flight Path, Pilot Toolkit and Finances screens rather than adding a parallel Progress system.

Requirements first support one explicitly selected training path, proposed as US Private Pilot Airplane Single-Engine Land under Part 61. Confirm applicability during the specification. Use versioned rule data with authoritative references, review date, qualifying inputs and missing-evidence rules. Consult current official regulations during implementation; this roadmap deliberately does not prescribe hour thresholds.

The current journal does not capture every qualifying flight, distance, route, timing, endorsement or instructor detail. Aggregate totals alone cannot establish eligibility. Missing evidence must produce “Not enough information,” not “Complete.” Part 141, Instrument, Commercial and other jurisdictions are separately reviewed additions.

Readiness shows knowledge practice, flight observations, required evidence and administrative checklist status separately. Existing “Instructor Signed Off” entries are user-entered records, not cryptographically verified endorsements. No pass probability or “safe to fly” decision is generated.

Cost analytics use existing integer cents. Define the denominator for cost/hour; do not mix all lifetime spending with a selected month's hours. Separate incurred expenses from scheduled estimates, avoid counting both a lesson total and its itemized costs, handle refunds, and label projections with user-editable rates and assumptions.

Exit: rule fixtures cover qualifying/nonqualifying/unknown cases; regulatory content gets knowledgeable human review; financial calculations cover duplicate links, zero hours and missing costs; evidence survives export/restore.

## 11. M6 and later — Optional coaching

First optional AI feature: parse user-selected feedback into editable proposals using known skill IDs. Show exactly what will leave the computer. Existing selected-document consent does not authorize uploading training history, notes or finances.

Use read-only retrieval functions with bounded result sizes and explicit schemas. Model output is untrusted. Tools never execute arbitrary SQL or silently write records. Approval produces one idempotent native transaction; invalid/stale IDs or changed sources invalidate the proposal. Treat instructions embedded in PDFs/feedback as content, not application commands.

Text oral practice comes before voice: a few questions grounded in selected sources, citations, saved session and proposed follow-up work. Evaluate factual accuracy, citation validity, and misleading scoring before release. Voice ATC practice is a separate later experiment with microphone permissions, cancellation, cost limits, latency measurement and simulation-only positioning.

Defer broad personal-data assistants, automatic flight tracking, social features, marketplaces, cloud collaboration and a proprietary FAA question bank. Revisit only after the daily/study loop is used successfully.

## 12. Minimal schema and architecture plan

These are proposed entities, not SQL to apply verbatim. Allocate the next migration number from the latest reviewed main; never rewrite shipped migrations.

| Milestone | Proposed storage | Reuse / constraints |
| --- | --- | --- |
| M1 | Planner preferences; per-day decision keyed by local date and source; unique accepted-proposal/source link if required | Reuse `NextAction.estimatedMinutes`, due date and status; journal debrief fields; existing Question links. Do not duplicate entire daily plans initially |
| M2 | Study content versions/items; sessions; responses; review events; review state; split source linkage | Stable IDs and foreign keys; preserve original content/version; content arrays need a deliberate migration; unique response/event IDs prevent duplicate completion |
| M3 | Skill catalog/version; skill observations; optional feedback-to-action linkage | Preserve original journal feedback and broad Topic enum; a typed attribution distinguishes self-report from reported instructor feedback |
| M4 | Document bookmarks/annotations; rebuildable text-index metadata | Document identity/hash plus page index; annotations backed up; caches rebuildable |
| M5 | Training-path preference; qualifying evidence fields; rule-version metadata | Reuse flight records, credentials, finances; do not reinterpret unknown older data as zero or qualified |

Keep calculations in `src/logic`, database access in repositories/native commands, and UI state in components. Add a domain service only when orchestration is genuinely shared. Do not implement eleven empty provider interfaces upfront.

The desktop SQL plugin uses a connection pool: multi-statement transactions must be pinned to one native connection, following the existing split-record pattern. New cross-entity approval/review operations require the same guarantee.

Do not add large attempt/observation arrays to the global load-everything context. Use targeted queries and bounded lists; measure current refresh behavior before refactoring unrelated application state.

For every migration: preserve immutable shipped SQL/checksums, register Rust and TypeScript consistently, test upgrade from populated schema 9, verify the current schema ceiling, and test old backup restore into the new application. Backup format v2 can remain when its container contract still fits; bump database schema independently. Older applications should reject a newer incompatible database clearly. Hide incomplete UI through a narrow feature gate only when necessary; gates do not erase or roll back persisted data.

## 13. iOS delivery track

Preserve shared domain logic and repositories where practical. Use existing `docs/ios` plans and reassess platform boundaries against actual device builds before selecting a rewrite.

Initial iOS scope: import a complete Mac backup from Files/AirDrop, preview the archive, disclose replacement, preserve a recovery copy, open the library and saved study material offline. Use Keychain for the phone's API key; the key is never transferred in the backup. Validate memory/storage requirements before extraction and large PDF processing.

No automatic synchronization or Merge in the first iOS build. Explicitly warn that replacing phone data can discard newer phone-only work, and offer an export first. Desktop and iOS must declare compatible schema versions. Test desktop → phone and phone → desktop only when both implementations actually support the same format/schema.

Physical Apple Silicon, Xcode, simulator/device testing, signing and distribution are external prerequisites. Mobile development must not destabilize desktop file paths or the bundle identifier.

## 14. Definition of done and evidence

Each milestone needs a short specification, named exclusions, migration plan if any, failure cases, focused tests, and a demo with non-sensitive data. Completed means reviewed behavior and recovery evidence, not just passing type checks.

Run focused tests during development. After final corrections, run the full local matrix once: clean dependency install when needed; frontend tests/build; Rust formatting, strict Clippy and tests; diff check. Retain exact commands, commit ID and results. Codex independently reruns sensitive/failing checks as needed. Push one reviewed branch and use CI as final confirmation. Confirm checks on the final PR head before merging; update main before starting the next milestone. No release publication is included in milestone merge authorization.

For performance claims record hardware, OS, commit, release/debug build, dataset, PDF sizes/pages, repetitions, median/tail latency and peak memory. Track startup, route navigation, search, import/split, review retrieval and backup. Suggested initial budgets to validate against baseline: search feedback within 150 ms at 5,000 materials, progress updates at least every second during measurable long phases, and no unexplained >10% regression in comparable median timings. These are proposed acceptance targets, not current measured results or guarantees.

Windows and Mac smoke tests cover native pickers, Open/Reveal, source file moved after import, long/image-heavy PDFs, generation, offline study, backup/restore and installation over existing data. CI packaging is not installed-app evidence. Keep release 0.5.2 retired and existing tags untouched.

Product success is observed locally: completed debriefs, approved actions completed before lessons, resumed/completed study sessions, questions answered, retrieval success and successful restore. Weekly consistency can be shown without punitive streaks. Do not add telemetry or upload private training data by default. Collect tester feedback before adding more modules.

## 15. Next action and handoff

**Next action: complete Codex review of the active M0 backup/deletion corrections.** Do not assign a second agent to edit those files simultaneously.

After M0 merges, the first feature assignment is D1–D2. Give the implementer this scope:

> In `H:\Ai Repo clones\Flight-training-`, start an isolated feature branch/worktree from updated main. Read STATUS.md, the current audit and this roadmap. Characterize the existing daily plan, debrief-created actions and instructor questions. Implement only a pure, deterministic daily-recommendation selector that returns a small list with time estimates, reason/source references and stable ordering. Reuse existing entities; add no AI calls, schema migration, cloud service or replacement dashboard. Cover ranking, budgets, absent data, duplicate candidates and injected-date behavior with focused tests. Leave changes uncommitted, provide the exact base commit, diff summary and test results for Codex review. D3 UI work starts after the selector contract is reviewed.

Claude is the default feature implementer; Gemini takes explicitly assigned security-hardening work or substitutes when the user announces a role switch. Codex reviews and coordinates commits, PR checks and merges under the established workflow.

## 16. Planning amendments (24 September 2026)

### 16.1 M0 status

- **M0-code is complete, pending independent review.** Branch `fix/m0-release-safety` (four commits on `a586f91`) carries:
  - consistent complete backups, with missing and unlinked files recorded rather than refused and in-flight changes retried;
  - recoverable Study Library deletion;
  - backup warnings shown to the user;
  - the release workflow's Rust test gate;
  - updated `AUDIT.md` and `STATUS.md`.

  Local evidence: 404 frontend tests and 123 Rust tests pass, with `cargo fmt`, strict Clippy and the production build clean. Codex reviews and merges it under the established workflow.
- **Branch protection is in place.** The repository ruleset "Protect main" requires the "Tests, types, and the data-safety guards" check and blocks force-pushes and deletion of `main`. This closes M0 item 4.
- **The release gates are unchanged.** Microsoft clearance or code signing of the exact Windows installer, and physical installed-app tests on Windows and Apple Silicon, still block publication. Version `0.5.2` stays retired.

### 16.2 Amendments to the plan

1. **Split M0 into two gates.**
   - *M0-code*: data-safety fixes merged with tests. This unblocks M1.
   - *M0-release*: vendor clearance or signing, plus installed-app tests. This blocks only publication.

   §5's exit condition mixed the two, which conflicted with §4's statement that feature work may continue during the release hold.
2. **Recorded product decision: locked files block deletion.**
   - Deleting a material whose file is open in another app (e.g. a PDF viewer on Windows) fails safely. The record and file are kept, she is asked to close the file, and the material reappears after the undo window.
   - Do not reintroduce record-first deletion or background file retries without a new decision.
3. **Add a library check early in M1 (D0).**
   - Complete backups now report files missing from storage, which she can re-attach, and unlinked files that were left out. She has no way to resolve unlinked files yet, so they will accumulate and the warning will repeat on every backup.
   - Add a Settings → "Check library" action. It lists missing files with a re-attach action, and lists unlinked files with actions to import each one as a new material or move it to the private trash.
   - M2 and M4 depend on reliable file identity, so this comes first.
4. **Check in with her after M1.**
   - This app has one real user. Before M2's schema work starts, she uses the new daily plan and quick debrief for one to two weeks of real lessons or study.
   - Record what she used, skipped and asked for, and set M2's scope from that rather than from competitor features.
5. **Define undo and history semantics before M2/M3.**
   - `deleteWithUndo` (a 7-second window, one pending delete at a time) is used on eight pages. Sessions, responses, review events and observations need an explicit retention policy (§7) before they are stored.
   - Proposal: deleting a source keeps its immutable history with a title/provenance snapshot and hides it from active queues rather than deleting it.
6. **Accessibility is part of every milestone's definition of done.** New controls meet the bar set by the Pilot Toolkit tabs and the practice-test radio group: WAI-ARIA roles, keyboard operation, and status that never relies on colour alone. Each gets focused tests like `PilotToolkit.test.ts`.
7. **Link or summarize the proposal** referenced in §2, so a reader can see what was corrected.
8. **Add rough calendar ranges.** Give a one-line time range per milestone next to its planning size, and revise it after each milestone, so work can be planned around her actual training timeline.
9. **Keep process out of this document.** Agent roles (§15) and absolute local paths (header, §15) belong in a `CONTRIBUTING.md` or agents file. Move them there when that file is created.

### 16.3 Next actions

1. M0 release-safety fixes merged through PR #30 (`bdad35d`).
2. D0 (Settings → Check library) merged through PR #31 at `193d3e1`.
3. D1–D2 (debrief characterization and pure recommendation selector) merged through PR #32 at `e938f84`.
4. D3–D4 merged through PR #33 at 4e2651c. D5 merged through PR #34 at `0ad0a57`. D6/D7 and performance polish merged through PR #35 (`1d86d57`). The M1 user check-in gates M2 implementation. Windows desktop smoke (on an isolated profile) and Apple Silicon installed-app tests remain open.
5. Hold the check-in with her after M1, before M2 starts.

## 17. Aviation weather and FAA reference data (3 October 2026)

Requested by the owner for the product roadmap. Extend the existing daily plan, lesson preparation and Study Library; scope these as optional data integrations after the active A2 corrections and independent acceptance. They do not replace the existing M2 check-in, import-decision or installed/release gates.

| ID | Planned addition | Product use / official source | Acceptance to define before implementation |
| --- | --- | --- | --- |
| WX-01 | METAR/TAF weather for selected lesson airports | Daily Flight Plan and lesson preparation, using the public [NOAA/NWS Aviation Weather Center Data API](https://aviationweather.gov/data/api/). Its documented METAR/TAF request flow uses no API key. | Airport-to-weather-station matching; raw report and readable summary; observation, issue and forecast-validity times; explicit unavailable, stale and offline states. |
| FAA-01 | Airport and radio-frequency reference data | Lesson airport lookup and preparation, using official [FAA NASR datasets](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/). The [1 October 2026 cycle](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/2026-10-01/) documents airport and frequency CSV groups. | Preserve airport identifiers, frequency purpose/units, source and effective cycle; verify mappings and data refresh behavior. Treat published downloads as a dataset integration, rather than assuming a single FAA REST API exists. |
| FAA-02 | ACS and Airman Knowledge Test code references | Ground Gemini practice questions and explanations in the relevant [FAA Airman Certification Standards](https://www.faa.gov/training_testing/testing/acs) and [ACS Companion Guide](https://www.faa.gov/training_testing/testing/acs/acs_companion_guide_pilots.pdf). Connect missed-topic codes to study resources and M3 skill mappings. | Select the certificate/rating and source revision; preserve valid and archived code mappings; cite the source element; evaluate generated questions against that element. Generated practice remains distinguishable from official test questions, and a code match alone does not verify an answer. |

### Implementation sequence and behavior

1. After A2 is independently accepted, specify and prioritize the three additions against the user's lesson/study needs. Keep one implementation assignment active and reconcile any M2/M3 schema or content-identity work first.
2. Weather: request only selected stations, cache bounded results, and retain their timestamps. The API currently limits requests to 100 per minute and does not allow browser cross-origin access; review the desktop/native request route before implementation and recheck the [current API restrictions](https://aviationweather.gov/data/api/#using-the-api). Test no-data responses, timeouts, throttling and stale-cache behavior. Show weather as preparation context with a source link, without issuing an automated flight go/no-go decision.
3. FAA data: start with versioned, reviewable airport/frequency and ACS reference fixtures. Verify current publication formats, reuse terms and effective dates before importing data. Keep reference data available offline, and show its revision and refresh status.
4. Gemini grounding: provide only the selected reference context when the user requests generation. Save source/version provenance with the generated content under the reviewed content model; evaluate unsupported claims and incorrect mappings before adoption. Existing saved study remains usable without a network connection or another Gemini request.

This amendment is planning only. No API client, new dependency, database migration, network call or release work is implemented by this update. Official sources above were checked on 3 October 2026; verify their contracts again when implementation begins.
