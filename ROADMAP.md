# Her Flight Deck roadmap

**Current plan, organized 21 October 2026.** This top section is the single place to see where things stand and what comes next. Everything below "History" is the dated decision log, newest first, kept unchanged for provenance. Where the two disagree, this section and later owner decisions win.

## Where things stand

**Released:** v0.6.0, published as Latest from `main` at `7d7d878`. The next release is **0.6.1**; 0.5.2 and 0.5.6 are retired.

**Done in `main` through v0.6.0:**
- **Offline reading and search foundations:** OFFLINE-01, OFFLINE-02 and its saved-content search, and OFFLINE-03a/b, so she can write and edit her own summaries, cards and practice questions.
- **OFFLINE-GEN:** a study kit made from her PDF with no AI (#238–#249).
- **HOMEWORK-01:** homework with six kinds of activity. Cards and quizzes complete themselves; homework shows in the daily plan and in search (#253–#257).
- **v0.6.0:** Ask Gemini and the completed 0.5.9 work (#267).

**0.6.1 work in progress:** the 0.6.1 polish/export work, ACS-READY-01 manual tokenizer and archived-code crosswalk, and corrected accessible-name test are merged to `main` in PR #268 (`0416353`). Exact-head and post-merge checks passed; no 0.6.1 tag or release exists. Browser print preview and physical paper output remain unverified; Safari automation timed out before opening the saved HTML. Local ACS-READY-01 commits add a date resolver for Private Airplane tests dated 2024-05-31 through 2026-10-23 and current FAA-S-ACS-6C catalog slices for the eight PA.I.A, 17 PA.I.B, 34 PA.I.C, 22 PA.I.D, eight PA.I.E codes, 14 PA.I.F codes, and 19 PA.I.G codes, 22 PA.I.H codes, 28 PA.I.I codes, 17 PA.II.A codes, 11 PA.II.B codes, seven PA.II.C codes, 23 PA.II.D codes, 23 PA.II.E codes, 13 PA.II.F codes, 15 PA.III.A codes, 13 PA.III.B codes, 33 PA.IV.A codes, 28 PA.IV.B codes, 29 PA.IV.C codes, 29 PA.IV.D codes, 31 PA.IV.E codes, and 29 PA.IV.F codes, 34 PA.IV.G codes, 27 PA.IV.H codes, 26 PA.IV.I codes, 20 PA.IV.J codes, 32 PA.IV.K codes, 27 PA.IV.L codes, 29 PA.IV.M codes, and 21 PA.IV.N codes, and 17 PA.V.A codes, and 19 PA.V.B codes, and 24 PA.VI.A codes, and 16 PA.VI.B codes, and 13 PA.VI.C codes, and 11 PA.VI.D codes, and 12 PA.VII.A codes, and 23 PA.VII.B codes, and 23 PA.VII.C codes. Dates outside the verified range and codes outside those task slices remain unresolved. A complete current-code catalog, user-facing study connections, UI and persistence remain incomplete.

## The queue

Only the owner reorders this list. Each item ships as one or more bounded slices, each with failing-first tests, Claude's independent review and exact-head CI.

Rows 1–3 are complete: OFFLINE-ON and 0.6.1 polish are merged to `main`, and v0.6.0 is published. Row 4 implementation and synthetic native save verification are complete: Markdown export, the combined handout builder and Library entry point, selected-card CSV, PDF workflow instructions, pagination polish, plus native HTML/CSV saves. Browser print preview, PDF creation and physical Letter/A4 output remain unverified. Full pre-merge frontend checks found and fixed one stale export-dialog accessible-name assertion (4,842 passed / 6 skipped after correction); full Rust tests passed with synthetic fixture access. Row 5 ACS-READY-01 has manual AKTR tokenization, an offline crosswalk for the 18 archived Private Airplane codes in FAA-G-ACS-2 Section 8, a date resolver for FAA-S-ACS-6C (effective 2024-05-31, verified through 2026-10-23), and local catalog slices for eight current PA.I.A, 17 PA.I.B, 34 PA.I.C, 22 PA.I.D, eight PA.I.E, 14 PA.I.F, 19 PA.I.G, 22 PA.I.H, 28 PA.I.I, 17 PA.II.A, 11 PA.II.B, seven PA.II.C, 23 PA.II.D, 23 PA.II.E, 13 PA.II.F codes, 15 PA.III.A codes, 13 PA.III.B codes, 33 PA.IV.A codes, 28 PA.IV.B codes, 29 PA.IV.C codes, 29 PA.IV.D codes, 31 PA.IV.E codes, and 29 PA.IV.F codes, 34 PA.IV.G codes, 27 PA.IV.H codes, 26 PA.IV.I codes, 20 PA.IV.J codes, 32 PA.IV.K codes, 27 PA.IV.L codes, 29 PA.IV.M codes, and 21 PA.IV.N codes, and 17 PA.V.A codes, and 19 PA.V.B codes, and 24 PA.VI.A codes, and 16 PA.VI.B codes, and 13 PA.VI.C codes, and 11 PA.VI.D codes, and 12 PA.VII.A codes, and 23 PA.VII.B codes, and 23 PA.VII.C codes. Older/later dates remain unresolved, and the rest of the current ACS remains unmapped. User-facing study connections, UI and persistence remain future slices.

| # | Item | What she gets | Includes | Plan |
| --- | --- | --- | --- | --- |
| 1 | **OFFLINE-ON** | PDF study kits and offline search in the installed app | — | [runbook](docs/OFFLINE_ON_PRESSURE_CHECK.md) |
| 2 | **POLISH-01** | The new screens polished; a visual check at desktop and narrow widths; small fixes (FLAKE-GEN-01, the "overdue since" date format) | — | owner scope set 21 Oct |
| 3 | **Release 0.5.8** | Everything above, installable. Claude prepares it; the owner tags and publishes | — | `scripts/release.sh` |
| 4 | **EXPORT-01/02** | One clear Export / Print place: handouts across materials, flashcard CSV, better print / Save as PDF, separate answer keys; Markdown export that works in Obsidian or any notes app (one note per guide section, flashcards, page references kept; owner, 22 Oct 2026) | COMP-10; the export half of DIFF-06 | [plan](docs/OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md) |
| 5 | **ACS-READY-01** | An ACS-linked view of what she has studied. **Plus:** she types in the missed-topic codes from her knowledge-test report (AKTR) to get matching reading, cards and instructor questions; she never uploads the report itself | AKTR code entry | [research](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md) |
| 6 | **SCHOOL-01** | A scorecard to compare flight schools | — | 20 Oct entry below |
| 7 | **FLIGHTLOG-01** | A discovery-flight log that carries into her real logbook later | — | 20 Oct entry below |
| 8 | **STUDY-FLOW-01** | **Prepare for my next flight:** a short session she can finish or pause; one dependable Continue; a calm, large-text, keyboard-friendly review screen | DIFF-01, COMP-01, COMP-04, COMP-07; HUB-04/07 | [DIFF plan §2](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) |
| 9 | **MISTAKES-01** | **Practice that remembers mistakes:** missed question → explanation → source → small follow-up; an optional "what confused me" note; her own terms as cards | DIFF-03, COMP-02, COMP-08; HUB-05 | [DIFF plan §4](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) |
| 10 | **PACKS-01** | **Offline lesson packs:** a homework assignment shows exactly what works offline before she travels, and repairs what's missing | DIFF-02, COMP-05; HUB-08 | [DIFF plan §3](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) |
| 11 | **PDF-STUDY-01** | **Study from the PDF:** page notes become study items; the source sits beside the question. Highlights and an embedded reader only after a feasibility decision that keeps macOS 12 working | DIFF-05, COMP-03; HUB-01/03; OSS-01 | [DIFF plan §6](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) |
| 12 | **VISUAL-01** | **Visual recall:** hide a label on her own diagram, answer, reveal. A small proof first | COMP-06 | [research §5](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md) |
| 13 | **ORAL-01** | **Oral-exam scenarios:** typed answers compared with a reviewed outline, with self-review kept separate. Voice is a later, separately approved experiment | DIFF-04, COMP-09; M6 | [DIFF plan §5](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) |

**After the queue,** still approved and waiting, in this order:
1. **The scheduler: P54-06** phase B part 2. This is the FSRS comparison; production stays on `simple-v1` until the owner decides otherwise.
2. **Weather: P54-07 / WX-01**, airport weather in lesson preparation.
3. **The FAA reference shelf: P54-08 / FAA-01/02.**
4. **Study Hub HUB-02/06**, connected topics and grounded questions. The other HUB items are absorbed into rows 8–11 above.

**Other lanes:**
- **iOS:** verified Mac-to-iPhone restore of the current schema; the portability half of DIFF-06.
- **OFFLINE-02-OCR:** search for scanned pages. Gated.
- **OFFLINE-03c:** deferred.
- **Open-source evaluations OSS-01–08:** evaluate only; nothing is adopted without the owner.

## Rules every item keeps

- **School, instructor, a lesson and an account stay optional.** No guilt mechanics, streak penalties or pass/readiness scores. Completion never claims mastery.
- **Her data is protected:**
  - migrations only add;
  - the bundle id never changes;
  - backups and restores stay guarded;
  - saved work survives a restart while offline.
- **No local AI models.** No new dependency or migration without the owner. An embedded PDF reader and voice each need their own approval.
- **Aviation content** is labelled as a study aid to check against FAA guidance and her instructor. The app never claims to have the real FAA question bank.
- **Workflow:** Codex implements, then Antigravity, then Qwen Flash. Claude reviews, tests and merges. The owner tags and publishes releases.

## Owner-only items

- Rotate the exposed OpenRouter key.
- After 0.5.8, the real-world PDF check on her 8 GB Mac. If it's slow, the follow-up is a 384 MiB cap.
- The FAA medical and student pilot certificate are not started. A pre-solo paperwork checklist can be offered again.

## Research behind the queue

- [Offline training research](docs/OFFLINE_TRAINING_RESEARCH_2026-10-21.md) and its [six-feature plan](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) (#258).
- [Competitive app research](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md) (#259): 18 apps and 120 public reviews.
- Main lesson: finish and polish the connected routine before adding new feature families. That routine runs from her material, to a short session, to an explained mistake, to a follow-up, to her next lesson.
- Earlier research: [Study Hub](docs/STUDY_HUB_ROADMAP_2026-10-17.md), [open-source shortlist](docs/STUDY_HUB_OSS_RESEARCH_2026-10-17.md), [offline-study open source](docs/OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md).

---

# History (dated decisions, newest first)

## Owner decision: the researched features join the roadmap — 21 October 2026

The owner approved adding the proposed features from the [six-feature roadmap](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) (DIFF-01–06, #258) and the [competitive research](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md) (COMP-01–10, #259) to the roadmap. They are now **planned work, in the order below**. Each slice still gets its own bounded prompt, failing-first tests, Claude's review and exact-head CI before it merges. The gates written in those documents still apply:
- no local AI models;
- no dependency or migration without the owner;
- separate approvals for an embedded PDF reader and for voice;
- no pass or readiness score;
- no guilt mechanics;
- school, instructor and lesson stay optional.

**The queue.** The current work stays first and is unchanged. The new work follows the research's recommended order: polish the study session, then reduce source friction, then visual recall, then rehearsal.

| # | Item | What she gets | Folds in |
| --- | --- | --- | --- |
| 1 | OFFLINE-ON (#260) | PDF study kits and offline search in installed builds | — |
| 2 | POLISH-01 | New homework screens polished, visual check, FLAKE-GEN-01, small fixes | — (scope already set) |
| 3 | Release 0.5.8 | Prepared by Claude; the owner tags and publishes | — |
| 4 | EXPORT-01/02 | Clear packet, handout, CSV and backup choices | **COMP-10** (handouts with a separate answer key, discoverability and print fidelity); the export half of **DIFF-06** |
| 5 | ACS-READY-01 | ACS-linked readiness view | **ACS code entry:** she types the missed-topic codes from her knowledge-test report (AKTR). She never uploads the report itself: no name, FTN or score. Unknown or outdated codes stay unresolved. |
| 6 | SCHOOL-01 | School scorecard | — |
| 7 | FLIGHTLOG-01 | Discovery-flight log | — |
| 8 | STUDY-FLOW-01 | **Prepare for my next flight:** a short session she can finish or pause, one dependable **Continue**, and a calm, large-text, keyboard-friendly review screen | **DIFF-01**, **COMP-01**, **COMP-04**, **COMP-07** |
| 9 | MISTAKES-01 | **Practice that remembers mistakes:** missed question → saved explanation → source → a small follow-up; an optional "what confused me" note; her own terminology notes turned into cards | **DIFF-03**, **COMP-02**, **COMP-08** |
| 10 | PACKS-01 | **Offline lesson packs:** a homework assignment shows exactly which readings, cards and quizzes work offline before she travels, and repairs missing items | **DIFF-02**, **COMP-05** |
| 11 | PDF-STUDY-01 | **Study from the PDF:** page notes become study material, and the source sits beside the question. Highlights and an embedded reader come only after a feasibility decision that keeps macOS 12 working. | **DIFF-05**, **COMP-03** |
| 12 | VISUAL-01 | **Visual recall:** cover a label on her own diagram, answer, then reveal. A small proof first, with synthetic or rights-cleared images. | **COMP-06** (gated) |
| 13 | ORAL-01 | **Oral-exam scenarios:** text answers compared with a reviewed outline, with self-review kept separate. Voice is a later, separately approved experiment. | **DIFF-04**, **COMP-09** |
| — | iOS lane | Portable history: verified Mac-to-iPhone restore of the current schema | Rest of **DIFF-06** (separate platform track) |

Existing scheduler, weather, FAA and Study Hub queues are kept. HUB items that overlap a row above are reconciled when that row is assigned. The order can change only by an owner decision.

## Competitive app and user-review research — 21 October 2026

[Comparative research and candidate scopes](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md) adds a public App Store/web survey: 18 metadata records and 120 manually read recent reviews across 15 apps, with [method and evidence](docs/research/competitive-apps-2026-10-21/README.md). The sample is qualitative and not representative. Recommendations emphasize continuity, explanation/source context, manageable sessions and dependable offline access. COMP-01–10 are evidence-backed candidates mapped to existing DIFF/HUB work, **not ten approved feature starts or a new priority queue**. Preserve the existing owner order, current scheduler, no-guilt/no-enrolment experience and separate reader/voice/format/platform gates. No app code, dependency, migration, runtime switch, release or readiness status changed. Baseline main `f2cf79f` includes HW-01d quiz/daily-plan integration; do not reassign that completed source work as new implementation.

## Offline training differentiation: researched roadmap addition — 21 October 2026

The owner requested a deep research pass and a roadmap for the six discussed features. [Research, primary sources and current-code inventory](docs/OFFLINE_TRAINING_RESEARCH_2026-10-21.md) and [implementation slices/acceptance criteria](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) now define that follow-on work. **Planning addition only:** no feature, migration, dependency, model, release switch or implementation-priority change is authorized by publishing these documents.

The product focus is a private training routine that connects lessons, source-linked study, corrections and durable offline progress. Google's current documentation already describes remembered card progress and missed-card practice; those alone are not differentiators. The research does not claim NotebookLM has no offline features or that it lacks every proposed workflow.

**Reconciled baseline: main `2b5b146` (PR #256), version 0.5.7/schema 20.** GEN-03 (#249), OFFLINE-ON-1/pressure tooling (#250/#252), homework storage/UI (#254/#255) and card-run evidence (#256) are merged. The older entry below still calls migration 0020 proposed and GEN-03 local; those statements are historical. HW-01d test-run/daily-plan integration and OFFLINE-ON pressure/activation acceptance remain open at this baseline. Source presence is not installed or release acceptance.

| Acceptance group | Deliverable to complete | Build on / boundary |
| --- | --- | --- |
| DIFF-01 — Next-flight preparation | A short, explainable, editable session tied to selected homework, missed topics and instructor questions | Extend existing M1 recommendations, P54-05 briefs and HUB-04/07. Remain useful without a school, instructor or next lesson; private debrief content is not exported automatically. |
| DIFF-02 — Offline lesson packs | One assignment collects exact reading/card/quiz versions with checked capability-specific availability and restart-safe resume | Extend HOMEWORK-01 and existing kits/readiness. Distinguish local PDF, saved content and searchable text; no duplicate pack generator or automatic queued upload. |
| DIFF-03 — Mistake-based practice | Exact-version missed/skipped review leads to a bounded, source-linked follow-up | Reuse M2 history/card queues and HUB-04/05. `simple-v1` remains production; the existing FSRS feasibility/transition/owner gates still apply. |
| DIFF-04 — Offline oral scenarios | Saved text/free-response practice with visible source-linked discussion criteria and separate self-review | M6 follow-on after source/content review. No certification score; recording/recognition is later and separately scoped, with no silent cloud fallback. |
| DIFF-05 — Study from the PDF | Connect existing page/bookmark notes to study; selected text/highlights after a reader feasibility decision | Extend M4/HUB-01/03/08. The existing external-reader opener cannot guarantee a page jump. Preserve originals, macOS 12 and Windows fallback; no renderer/dependency adopted here. |
| DIFF-06 — Portable training history | Clear packet/handout/CSV/backup choices and verified current-schema Mac-to-iPhone restore | Finish EXPORT-01/02 and the separate iOS lane. Packet v1 is not a full backup; retain v3 backup integrity and v1/v2 compatibility. No automatic merge/sync or unversioned portable-pack extension. |

**Sequence remains:** active homework and unresolved OFFLINE-ON gates → remaining HOMEWORK-01 → EXPORT-01/02 → ACS-READY-01 → SCHOOL-01 → FLIGHTLOG-01; existing scheduler/weather/FAA/Study Hub queues remain. These six groups refine overlapping approved work and queue genuinely new gaps; they do not preempt an in-flight assignment. Later connected-session, bookmark-to-study/highlight and text-oral slices need bounded reviewer assignments. Mobile compatibility can be audited separately without blocking desktop sessions.

Keep the owner's exclusion of local AI models. No new provider, package, permission, format, migration number, minimum OS or efficacy claim is adopted. The owner explicitly requested GitHub publication of this research on 21 October; Codex may commit/push this documentation branch and open its review PR. Claude retains independent review and merge ownership; publication is not approval. [Cross-machine handoff](docs/OFFLINE_TRAINING_RESEARCH_HANDOFF_2026-10-21.md).

## Owner decisions: review workflow, offline-generation fallback and next features — 20 October 2026

OFFLINE-GEN plan approved with owner defaults D1–D8 (20 October 2026); GEN-FIX-1 merged (PR #239).
HW-01a's [Homework schema/domain proposal](docs/HOMEWORK_01_PROPOSAL_2026-10-21.md) is awaiting the owner's decisions; migration 0020 remains proposed only.
GEN-01 is complete (#245–#248). GEN-03, packet hand-off and the plain how-to,
is the last OFFLINE-GEN slice; its local implementation awaits Claude's review.

**OFFLINE-ON complete pending release (21 October 2026):** OFFLINE-ON-2b wires
one explicit release opt-in to PDF study kits and offline document/saved-content
search, including homework (#231–#233, #257). FLAKE-CR-01 is fixed (#250).
The owner accepted saved-content p50 of 28.2 ms and the baseline plus
[warning-pressure pass](docs/evidence/offline-on2b-2026-10-21/RESULT.md): five
synthetic fixtures, near-cap 269 MiB RSS, over-cap clean refusal at 428 MiB.
The owner's M5 / 32 GiB is weaker evidence than a minimum-spec Mac. Her Mac has
8 GB RAM: after the update, prepare one real chapter PDF with her usual apps
open; if slow, follow up with a 384 MiB cap. This round leaves the 512 MiB cap
unchanged. Installed/8 GB acceptance remains open. No release is published by
this configuration round; Claude reviews, tests and merges. See the
[build gates](README.md#offline-pdf-reading-and-search),
[runbook](docs/OFFLINE_ON_PRESSURE_CHECK.md) and
[round report](docs/OFFLINE_ON2B_REPORT_2026-10-21.md).

Migration 0019 `study_set_save_operations` approved by the owner (20 October 2026): receipts for study-set saves that come from the PDF kit only; ordinary saves are unchanged.

### Workflow (owner, 19–20 October 2026)

- **Codex implements** every project change.
- When Codex is out of usage, work goes straight to the next implementer instead of waiting.
- Implementer order (owner, 20 October 2026): Codex first, then Gemini (Gemini CLI, model gemini-3.8-flash), then Qwen Flash only as the last backup.
- **Claude** assigns precise rounds, reviews, and independently re-runs the gates with mutation checks. For UI rounds that also means a browser-mode walkthrough with Playwright and the `run` skill.
- When Claude is out of usage (owner, 20 October 2026): Codex takes over review, testing and merging with the same workflow; Gemini, then Qwen Flash, implement in the meantime.
- After a GREEN review and green exact-head CI, Claude merges with `--match-head-commit` and verifies the work is on main.
- From 2:00 to 3:00 AM on 20 October only, Claude may implement directly before the weekly usage reset.
- This replaces the earlier arrangements.

### OFFLINE-03b status

- Persistence, native parity, schema-17 validation and backup are done locally and reviewed. That covers r4–r6c; r7 was reviewed GREEN on 20 October; a schema-14 helper-test update for schema 17 is queued before publishing.
- The UI rounds come next:
  - r8: the editor and Previous versions;
  - r9: regeneration review and the checkpoint;
  - r10: exports and labels.
- Then one coherent PR. Nothing is published yet.

### New tranche, OFFLINE-GEN, right after OFFLINE-03b and before HOMEWORK-01 (owner, 20 October 2026)

**Why:** on her slow internet, Gemini generation often fails, apparently while waiting for results. She has not yet used the update that shows generation progress (GEN-REL-04). The owner wants study material to keep working with just the PDF.

| Order | ID | Outcome |
| --- | --- | --- |
| 0 | OFFLINE-GEN-00 | **Diagnose before building.** Get her onto the current build, which shows progress, and record which stage fails and the exact message. Then reproduce slow-link failures with the existing fake Gemini server (`fake_gemini.rs`): slow uploads, a slow first byte, and responses that trickle in. Measure them against today's single non-streaming `generateContent` request and its 300-second generation cap. Evaluate streaming responses and smaller per-section requests. No real key, profile or provider call. |
| 1 | OFFLINE-GEN-01 | **Study kit made from her PDF, with no AI and fully offline,** built from the OFFLINE-01 per-page text cache: glossary and definition flashcards; fill-in-the-blank cards for key terms and numbers; an outline guide from the PDF's bookmarks and headings, with key sentences and page links; and draft practice questions that open in the OFFLINE-03b editor for her review before saving. Every item is labelled as pulled from her PDF on this Mac, never as AI-written. How that provenance is stored is decided at plan review. Instant, with no network. |
| 2 | OFFLINE-GEN-02 | **Generate-later queue.** A generation she requests while offline or on a slow link waits in a visible queue, which she can cancel. It runs in small per-chapter pieces once the connection is good, with each piece checkpointed (reusing GEN-REL-02), so finished pieces are kept if a later one fails. It never uploads anything she did not ask for. **Resume where she left off (owner, 20 October 2026):** if a step-by-step study-guide generation times out or fails partway, every section already finished stays saved durably, across closing the app and restarting. Pressing Try again continues from the first unfinished section; it never starts over and never re-requests finished sections. It reuses the uploaded PDF reference (GEN-REL-01) instead of uploading again while that reference is still valid. Progress shows which sections are done ("3 of 7 sections ready"). If the PDF or its chosen pages changed since she started, she is told, and the work restarts only with her agreement. |
| 3 | OFFLINE-GEN-03 | **Packet hand-off.** The owner generates on a fast connection, exports a study packet and sends it to her, and she imports it. Verify that packet v1 import carries the guide, cards and practice test, close any gaps, and add short plain-language how-to steps. |

**Excluded by the owner:** a local AI model. It is not planned.

### New features after EXPORT-02 (owner, 20 October 2026), in this order

| Order | ID | Outcome |
| --- | --- | --- |
| 1 | ACS-READY-01 | She is studying for the FAA knowledge test now. Tag practice questions, cards and study sets to FAA ACS areas, and show a calm per-area readiness view that feeds Study Focus. |
| 2 | SCHOOL-01 | A school scorecard comparing schools side by side: cost per hour, aircraft, Part 61 or 141, availability, and how her discovery flight felt, linked to Finances. School stays optional. |
| 3 | FLIGHTLOG-01 | A discovery flight log: an entry per flight now (date, aircraft, school, instructor, time, what she did) that carries into her real logbook later. |

**Context recorded:** she has not started her FAA medical or her student pilot certificate. A pre-solo paperwork checklist was offered and not chosen; it can be proposed again later.

### Updated overall order

GEN-03 → OFFLINE-ON → HOMEWORK-01 → EXPORT-01/02 → ACS-READY-01 → SCHOOL-01 → FLIGHTLOG-01. After those, the earlier queued scheduler, weather and FAA work. OFFLINE-03c stays deferred.

### Housekeeping

PR #164 (old controller-recovery docs) is superseded by main and conflicts with it. The owner is closing it, with its branch kept.

## OFFLINE-03a round-7 correction locally GREEN; exact-head CI required — 19 October 2026

Qwen implements; Codex independently reviews/tests, loops corrections and integrates after green CI on the exact current head. The owner has authorized this ongoing workflow and gated merges; no repeated workflow sign-off is needed. Tool sandbox boundaries still apply.

Before merging PR #237, Codex reproduced an already-absent journal case and returned it to Qwen. The corrected provider now distinguishes confirmed absence from a present or unreadable journal and preserves immediate failure/retry on rejected acknowledgement. Code: `d6ce015`. **166 focused and 3,927 full frontend tests passed / 6 skipped; typecheck/build/lock/whitespace pass.** Two new cases fail against prior published `72f2be2`. Prior failed runs and cancelled superseded CI are preserved. [Current acceptance report](docs/OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md).

**Integration:** PR #237 replaces closed draft #236. Wait for green CI on its corrected exact head, merge with a head-match guard, and verify main inclusion. Then start isolated **OFFLINE-03b practice-question authoring** from accepted main; a bounded implementation-plan assignment is prepared. Keep 03c deferred, extraction/search dormant and existing release/installed/performance gates open. Entries below are history.

## OFFLINE-03a local source review GREEN; Qwen implements, Codex reviews and integrates — 19 October 2026

**Current owner workflow:** Qwen implements; Codex independently reviews and tests, loops corrections, and merges only after accepted work and green CI on the exact submitted head. This supersedes earlier role defaults for this roadmap tranche.

The final acknowledgement/restart correction is committed as `9d3a90c` on `claude/offline-03a-core-fixes`. The reviewed operation now survives rejected or false journal acknowledgements and is cleared only after successful acknowledgement. Four new integration regressions fail against Claude's original source and pass after the correction. Fresh checks: **164 focused; 3,925 full frontend passed / 6 skipped; typecheck/build/cargo-lock/whitespace exit 0**. Unchanged native receipts remain **844 passed / 11 ignored**. [Source acceptance and integration handoff](docs/OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md); [evidence](docs/evidence/offline-03a-2026-10-19/README.md).

**Integration rule:** this branch replaces draft #236. GitHub records its exact-head CI/merge state; no merge before those gates pass. **Next after verified merge: OFFLINE-03b manual practice questions**, then homework → exports. 03c remains deferred; extraction/search dormant; existing flake, performance and installed/minimum-spec release gates stay open. Entries below are history.

## OFFLINE-03a implemented locally (Claude); Codex review and exact-head CI pending — 19 October 2026

**Role change.** At the owner's request, Claude took over OFFLINE-03a from Codex. Claude reviewed PR #236's authoring core locally (round 1 RED: an instructor correction could be relabelled and exported by default; three minor findings) and fixed all four. The owner approved proposal revision 5: ordinary rewrites also enter the retirement list. Branch: `claude/offline-03a-core-fixes`, which supersedes #236. [Report](docs/OFFLINE_03A_REPORT_2026-10-19.md); [reviewer prompt](docs/OFFLINE_03A_REVIEWER_PROMPT_2026-10-19.md).

**What she can now do:**
- write her own study guide;
- edit, correct or delete its summary, sections and cards;
- see and restore Previous versions;
- review a regenerated guide that would otherwise replace her items: Keep my items is the default, and what she deleted is held back.

**How it is built:**
- **Migration 0016:** add-only.
- **One atomic save in both engines:** the whole previous set goes to history first; a change made elsewhere is refused as stale; a retry is recognised.
- **Card review snapshots:** they carry who wrote each card. Legacy hashes are unchanged, checked against independent vectors.
- **Exports:** instructor corrections stay out unless she includes them.

**Local gates:** native 844 passed, clippy/fmt exit 0, schema-14 helper 26/26; frontend in the report. Nothing pushed yet, nothing merged, enabled or released.

**Review state:** Codex round 1 was RED (the regeneration-review save could lose choices or apply twice; restore missed a stale check). Both are fixed, with failing-first regressions. **Where to resume, and the 03b plan:** [handoff](docs/OFFLINE_03A_HANDOFF_2026-10-19.md).

**Next:** full local gate, Codex round 2, then one push for exact-head CI and a PR (closing #236 as superseded); then 03b practice questions. The FLAKE-CR-01, 02c p50, extraction/search and installed/minimum-spec gates remain open. Entries below are history.

## OFFLINE-03a authoring rules implemented; persistence/editor still pending — 19 October 2026

PRs #234 and #235 were reviewed/revalidated under the owner’s direct merge request and merged with green exact-head CI (`4ff7c9d`, `fc3ef34`); author review was disclosed rather than represented as independent-model approval. The first bounded OFFLINE-03a implementation is on `codex/offline-03a-authoring-core`. It prepares immutable add/edit/correct/delete plans with prior logical content retained, stable IDs/source pages, retirement overflow refusal, exact/near-match review, truthful origin labels and private-by-default instructor export selection. **55 focused cases pass; full frontend 3,835 passed / 6 skipped with zero unhandled errors, and typecheck/build/hygiene pass.** This is an in-process core, not a raw parser, persisted history or finished manual-editing feature. No production screen imports it and no migration/release flag changed. [Report](docs/OFFLINE_03A_AUTHORING_CORE_REPORT_2026-10-19.md); [reviewer assignment](docs/OFFLINE_03A_AUTHORING_CORE_REVIEWER_PROMPT_2026-10-19.md).

**Next:** review the core, then the remaining coupled 03a migration/browser-native persistence, canonical-origin/backup parity and editor/history/regeneration/export integration. Preserve the owner’s five approved defaults. Complete and review 03a before 03b manual practice questions; 03c remains deferred. Then homework → exports. Do not mark OFFLINE-03a complete or expose a partial writer. Existing release/installed/pressure gates remain open; earlier entries below are history.

## App audit and polish: four source/browser corrections pending review — 19 October 2026

A bounded audit of ten app screens at desktop/narrow widths and synthetic material creation reproduced the clipped Gemini confirmation **Cancel** (V057-UI-01), long progress-text overflow, every-second live-status updates and dangling form hint references. Shared layout/accessibility corrections and regression coverage are supplied on `codex/app-polish-audit`, based on accepted main `fdbf290`; no unmerged PR #234 code was copied. [Audit and reviewer handoff](docs/APP_POLISH_AUDIT_2026-10-19.md); [evidence](docs/evidence/app-polish-audit-2026-10-19/README.md).

**V057-UI-01:** source/browser fix supplied, independent review/CI and installed verification pending. The final bundled-font recheck passes twenty routes, five dialog layout cases and two short-window keyboard cases, with no fixture sends on Cancel. The original failing regression and first gate receipts are preserved. Native code, schemas, dependencies and release flags are unchanged. Final gate: **3,778 frontend tests passed / 6 skipped, zero unhandled errors**; typecheck/build/whitespace exit 0.

**Still open:** V057-DB-01 (classify sidecars safely), REL-CI-01 (release timeout), FLAKE-CR-01, saved-search p50 miss, extraction/search release gates and installed/minimum-spec verification. PR #234’s separate approved proposal/search-link correction still needs review. Resume OFFLINE-03a → 03b after accepted planning integration; then homework → exports. Nothing merged, enabled or released by this audit. Entries below remain historical.

## Current offline-study handoff: OFFLINE-03 defaults approved; search-link recovery pending review — 19 October 2026

PRs #231 (native document search), #232 (search UI) and #233 (saved-content search) are merged; accepted main for this handoff is `fdbf290`. Earlier “ready for PR” entries below are history. Extraction/search remain dormant in release builds.

Claude’s OFFLINE-03 proposal revision 3 received a saved **GREEN** review before usage ran out. The owner subsequently explicitly approved **all five recommendations**: additive migration 0016, Keep my items, enabled manual editing after acceptance, deferred passage quotes, and packet v1 with provenance-loss disclosure. Revision 4 records those decisions and defines atomic refusal at retirement entry 2,001, with no eviction or draft loss. No OFFLINE-03 feature or migration is implemented yet. [Proposal](docs/OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md); [completion report](docs/OFFLINE_03_COMPLETION_HANDOFF_2026-10-19.md); [next implementation assignment](docs/OFFLINE_03_IMPLEMENTATION_PROMPT_2026-10-19.md).

**OFFLINE-02C-LINK-READ:** Codex reproduced an unhandled database rejection while resolving a practice-question search link, including after unmount. A bounded correction adds sanitized status and read-only Retry; two regressions and the five focused suites pass (51/51). The correction and revision-4 additions require independent review; no self-acceptance or merge. Full frontend gate: **3,777 passed / 6 skipped, zero unhandled errors**; typecheck and build pass. Receipts are in `docs/evidence/offline-03-handoff-completion-2026-10-19/`.

**Still open:** saved-content worst-case cached p50 28.2 ms versus 20 ms; FLAKE-CR-01; minimum-spec/pressure and installed search acceptance. Reuse valid native/search measurements for unchanged code. Next: review/integrate this completion package with exact-head CI, then 03a → 03b, followed by the approved homework → exports priority. 03c remains deferred. No provider/profile/installer/release work in this package.

## OFFLINE-02b merged; OFFLINE-02c saved-content search ready for PR, dormant — 19 October 2026

OFFLINE-02b merged as PR #232 (`bfb8b04`). The same PR's CI fix gave the schema-14 parity test room on runners, which also clears `main`'s red run.

**OFFLINE-02c** ([report](docs/OFFLINE_02C_REPORT_2026-10-19.md)) searches guides, current cards, practice stems (never answers), notes and instructor questions in their own section. Each result opens the actual item, digest-checked for guides and cards.
- **Review:** Codex reviewed the addendum (rev 4 GREEN after 3 RED), the native code (GREEN after 1 RED), the UI (GREEN after 1 RED) and the measurement (RED once: sample admission, the post-edit check and percentile labels, all fixed in run 3), all locally.
- **Measurement:** release build, frozen before timing, run 3; runs 1–2 are preserved. Every correctness check and all 324 post-edit reference checks are exact, and every target passes **except** the cached p50 for the worst-case query "the" (28.2 ms in the worst process against 20 ms; p95 28.8 ms).
- **Tests:** 827 native, 3,775 frontend.
- **Owner decision:** dormant behind the same switch as document search.

**Follow-up FLAKE-CR-01 (pre-existing):** the card-review tests in `CardReviewPanel.test.ts` and the Review-due flow are load-sensitive.
- **On CI:** #233's first run failed one of them (C1-R2: "Recent reviews" was present after a held page resolved).
- **Locally:** the same family fails on a clean `main` when the full suite runs twice at once (2–3 failures per round).
- **Not changed by 02c.** It needs its own investigation, including whether C1-R2 shows a real race.

02c's own direct-link tests were given longer waits for slow runners.

**Next:** exact-head CI on #233, then merge.

## OFFLINE-02b search UI implemented and reviewed; dormant — 19 October 2026

With the build opt-in, the Study Library search box also searches the text of prepared PDFs among the materials the other filters select.

**What she sees:**
- **Results:** grouped by material, with the page and a highlighted snippet. Snippets render only as text, never as HTML.
- **Coverage line:** it separates "no match" from not prepared, still being checked, being prepared, couldn't be prepared, missing files, and image or unreadable pages.
- **Opening a result:** the file is re-checked by hash first, then opened at the page through the existing navigation controller. A changed file, a missing file and a failed check each get their own wording.
- **Split parts** also show the original's page.

**How it behaves:**
- Only the newest answer and the newest click are used.
- A changed search, a newer click or leaving the page retires an open that is still in progress.
- A temporary "getting search ready" state is waited out, arrow keys move between results, and each result button is described by its passage.

**Dormant builds** return before any hook runs: nothing is rendered and no request is made.

**Review:** Codex rounds 1 and 2 were RED, with 5 findings and then 1; round 3 was GREEN. All of it ran locally, to save Actions minutes. Frontend tests: 3,752 passed; typecheck and build pass.

**Not verified:** the painted UI. Browser mode has no native side, so this check waits for installed acceptance when the feature is enabled.

**Stacked on** PR #231 (02a).

## OFFLINE-02a independently reviewed and corrected; ready for PR — 19 October 2026

Claude reviewed `codex/offline-02a-completion` independently.

**Review result:**
- **Checks:** 813 native tests, fmt and strict Clippy pass. No dependency, lockfile, migration or frontend changes. `rusqlite`'s `functions` feature is dev-only. Search stays off in releases.
- **Budgets:** the owner-approved 750 ms and 3× budgets are recorded, and the original misses are preserved.
- **Accepted** subject to three corrections, now committed (`f8995ec`):
  1. **The destination check no longer waits for a preparation in progress.** It hashed through the slot that a preparation holds for up to 120 s; it now hashes without the slot.
  2. **Coverage counts blank pages as searchable,** as in the readiness summary.
  3. **Deleted materials and notes without a document** are no longer counted as missing files.
- **Tests and review:** both regressions fail on the previous source. 814 native tests pass, and fmt, strict Clippy and cargo-lock pass. Codex reviewed the corrections locally: **GREEN**.

**Next:** one push for exact-head CI, then merge, then OFFLINE-02b. To save Actions minutes, the review loop stays local until then.

## OFFLINE-02a corrected and paused by owner — 19 October 2026

**Owner requested finishing current work, then pausing. No further roadmap task or merge now.** [Latest self-review and pause report](docs/OFFLINE_02A_SELF_REVIEW_AND_PAUSE_2026-10-19.md); [resume/reviewer prompt](docs/OFFLINE_02A_FINAL_REVIEW_RESUME_2026-10-19.md); [budget owner decision](docs/OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md). Codex authored these corrections, so independent acceptance remains pending.

Closed the reproduced missing/changed-trigger validation defect and the after-hash stamp race. Background initialization now reports `index_preparing` before admitting search, distinguishes failed initialization and supports retry/cache replacement. Final native tests: **813 passed / 11 ignored**; strict lint/format/lock/source checks pass. Unchanged frontend evidence (3,728 passes) is reused.

The owner explicitly approved cold 10k ≤750 ms and added index ≤3× canonical text. Final measurements: **588.53 ms**, **1.693×–2.663×**; both amended criteria pass. All 90 exact hit sets/capped prefixes and 4,050 timed searches pass without errors. Warm p95: 15.39 ms at 10k / 38.20 ms at 30k; concurrent 13.78 ms. Original 300 ms/1× failures remain historical evidence. The original 30k ≤1 s or background-before-search rule remains; no proposed 3-second replacement was adopted.

**OFFLINE-02A-COLD/STORAGE:** closed against the documented owner-approved criteria, subject to independent verification. **OFFLINE-02A-REVIEW:** next when the owner resumes; inspect Codex's work, then normal PR and exact-head CI before any merge. Only after accepted integration: 02b search UI/navigation (handle `index_preparing` explicitly) → 02c saved study content → homework → exports. Offline release flags remain off; installed/minimum-spec/pressure gates remain unverified. Do not resume automatically. Earlier entries below are preserved history.

## OFFLINE-02a native implementation complete; acceptance budgets open — 19 October 2026

Codex completed Claude's quota-interrupted cache/search work in the existing `Flight-training-offline-01` worktree on `codex/offline-02a-completion`. [Report](docs/OFFLINE_02A_COMPLETION_REPORT_2026-10-19.md), [independent reviewer handoff](docs/OFFLINE_02A_REVIEWER_HANDOFF_2026-10-19.md), [measured budgets](docs/evidence/offline-02a-completion-2026-10-19/BUDGETS.md). Design rev6 was merged in PR #230 (`123b4fc`); older pending-design entries below are historical. **No 02a acceptance or merge is claimed.**

Functional gate: 3,728 frontend passes; 809 distinct native passes across the full and final service receipts; 26 schema-helper passes; strict lint/type/build/format/lock/immutability checks pass. All 90 independent hit sets and 90 capped prefixes match. Worst warm p95: 15.37 ms at 10k, 38.44 ms at 30k; concurrent 10k: 13.36 ms. Both failed and corrected measurement runs are preserved.

Complete these before accepting 02a or starting 02b:

| Task | Required result | Current evidence |
| --- | --- | --- |
| **OFFLINE-02A-REVIEW** | Independent review of Codex's completion and relevant interactions, one consolidated correction report if needed | Pending; source/evidence manifests and reviewer handoff supplied |
| **OFFLINE-02A-COLD** | 10k reopen + first query ≤300 ms; verify the prescribed background-before-search fallback when 30k validation exceeds 1 s. Keep full first-open checks, deadlines and file-identity invalidation | 570.97 ms at 10k; 2,042.01 ms cold validation at 30k. Validation is background work; thresholds remain visibly missed |
| **OFFLINE-02A-STORAGE** | Added index ≤1.0× canonical text, or a separately approved representation/contract amendment. Preserve exact snippet/canonical/delete/recovery behavior; never change the denominator or silently relax the budget | 1.693×–2.663× across the frozen corpora; full canonical external content plus inverted index exceeds the target |

Then resume the approved order: **02b search UI/navigation → 02c saved study content → homework → exports**. Native extraction/search and readiness UI remain dormant in releases; neither workflow flag was enabled. Minimum-spec pressure and installed acceptance remain unverified. NFKC is settled; prefix/fuzzy matching and topic aliases were not added. Primary checkout/profile/installers were not touched.

## OFFLINE-01b merged; OFFLINE-02 search design (revision 6) pending re-review — 19 October 2026

OFFLINE-01b merged as PR #229 (`b65ae4a`) after Codex round 1 was RED and round 2 GREEN. Offline study stays dormant in releases.

**Owner decision (19 October 2026): OFFLINE-02 uses SQLite FTS5.** The index lives in the native, disposable offline content cache, never in her database, a migration or a backup; browser mode keeps today's metadata search. The [design and pre-registration](docs/OFFLINE_02_SEARCH_DESIGN_2026-10-19.md) fixes the query rules (words and phrases only, operators as literal text, case/accent folding, NFKC with the existing `unicode-normalization` crate), limits, coverage, the slices (02a index, 02b UI, 02c study records) and release-build targets, before any engine code. Three owner questions are listed there (prefix search, NFKC, topic aliases); none blocks 02a.

## OFFLINE-01c merged; OFFLINE-01b readiness UI, round-1 corrections — 19 October 2026

OFFLINE-01c merged as PR #228 (`a3324a1`) after Codex rounds 1–3 were RED and round 4 GREEN. The release cap stays rejected pending pressure testing on dedicated minimum-spec Macs.

**OFFLINE-01b** (`docs/OFFLINE_01B_REPORT_2026-10-19.md`) adds the §4.4 readiness wording to the material page and library cards, with **Prepare for offline study**. It is **dormant in releases on both sides**: native preparation needs a debug build or `HFD_OFFLINE_EXTRACTION=1`, the UI needs `VITE_OFFLINE_EXTRACTION=1`, and a test fails if any workflow or config sets either flag. Codex round 1 was RED: worker mode itself bypassed the gate (now refused with exit 69 in builds without the opt-in, proven against the real release binary), and a replaced file kept the old file's readiness (now keyed by file identity). Frontend tests: 3,728 passed; native: 775 passed.

## OFFLINE-01a merged; OFFLINE-01c real-document evidence — 19 October 2026

OFFLINE-01a merged as PR #227 (`4941b05`) after Codex rounds 1–2 were RED and round 3 GREEN. Extraction stays dormant: Codex rejected both caps for release pending real-document evidence. Claude did **01c before 01b** to supply that evidence; it is pending Codex review.

**Corpus:** public-domain FAA handbooks, hash-recorded and kept outside Git.

**What it showed:**
- **One page sank the whole handbook:** the full Pilot's Handbook (524 pages) breached at page 449, because page 450 decodes to 60.5 MB and 2.18 million operations.
- **Fixed with a per-page content budget of 8 MiB,** which stops decoding at the limit: that page alone `failed` and the handbook completes, 522 text pages.
- **Loading costs about 4.5× the file:** 238 MiB live for 71,546 objects; peak 383 MiB counted and 534 MiB RSS. **Cap proposed at 512 MiB.**
- **The full Airplane Flying Handbook** (261 MiB) is refused by size; its chapters complete using 18–68 MiB.
- **Fidelity limits are reported:** glyphs drawn twice come out doubled, and some word gaps are lost.

Codex round 1 was RED on these, all now corrected:
- an unreadable page could still be decoded without the budget;
- the budget didn't stop the form walk once exhausted;
- receipts recorded the wrong cap;
- checksummed `.log` receipts were never committed (also for 01a, now fixed);
- some claims overreached, including CID text without ToUnicode, which was wrongly reported as text and is now `text_unreadable`.

**Codex rejected the 512 MiB cap for release enablement** until pressure testing on dedicated, supported test Macs (including minimum spec) during installed acceptance. Memory-pressure simulation was not run on the owner's Mac. Codex round 2 was RED on two more font-rule gaps, now fixed:
- **Font state:** the font flag now follows `q`/`Q` and is inherited into forms.
- **Map usability:** a font counts as mapped only if `lopdf` actually parses its ToUnicode map.

**The real PHAK changed:** 25 pages moved to `text_unreadable`, because their font maps exist but `lopdf` cannot parse them and it emits glyph ids as letters. That garbage was previously counted as text. The conservative rule also withholds their good text, so span-level filtering is a recorded OFFLINE-02 follow-up. Codex round 3 was RED: `lopdf`'s extractor ignores `q`/`Q`. Text is now flagged if it is unmapped under either the PDF's graphics state or the extractor's last-`Tf` view, with an exact-text regression; the PHAK is unchanged. Native tests: 773 passed. [Report](docs/OFFLINE_01C_REPORT_2026-10-19.md). Earlier entries remain historical.

## OFFLINE-01a: native extraction worker and content cache; round-2 corrections pending re-review — 19 October 2026

Claude implemented slice 01a (PR #227). Codex round 1 was RED on six blocking findings, all now corrected with regressions:
- `blank` hiding unreadable content: content is now resolved and decoded strictly with `flate2`, the owner-approved direct dependency at the same locked version (one line in `Cargo.lock`).
- Transient failures cached permanently.
- No re-hash after the worker finished.
- Unbounded parallel hashing: now a single de-duplicated queue.
- Unconfirmed end of file on the pipes.
- Incomplete memory evidence.

Codex round 2 was RED on three more, now corrected: failures before identity was verified could still be cached; reader errors had to outrank the marker; and a malformed `/Predictor` was accepted. **Native tests:** 758 passed (was 686).

**Release measurements** (observations): every content-stream, load-time object-stream and cross-reference-stream bomb is stopped by the 384 MiB counted cap. **Peak RSS can exceed that cap: up to 525 MiB, about 1.37×.** Ordinary 1,000–2,000-page documents used 15–20 MiB.

**The sampled RSS watchdog is not implemented.** Codex **rejected both caps for release enablement** (384 and 256 MiB) pending real-document and memory-pressure evidence. Extraction therefore stays dormant: it is not triggered by import and not enabled in any release. Next: 01b (UI), then 01c (real documents). [Report](docs/OFFLINE_01A_REPORT_2026-10-19.md). Earlier entries remain historical.
## OFFLINE-01 inventory and gap-closure proposal; pending review — 19 October 2026

Claude delivered the first OFFLINE-01 deliverable: a source inventory and an extraction and cache proposal. It is pending Codex review; no code changed. Revision 5 answers Codex rounds 1–4, all RED on contract gaps: memory bounds, decompression coverage, restore and stale readiness, scan diagnosis, and fail-closed worker dispatch.

**Inventory findings:**
- Today's search is the Study Library filter (title, notes, topic, type, tags) and QuickFind (material title, notes, tags and file name, plus notes, events, goals, instructor questions and other records). **Neither searches document, guide, card or practice-question text.**
- Reading never waits on Gemini.
- Backups exclude any other file in the app folder, but restore doesn't remove such files.
- Existing features (Check pages, splitting, the page-length check, flashcard batches) parse whole PDFs with `lopdf` inside the main app process. This is an existing exposure, now recorded.

**Proposal:**
- A worker mode in the shipped binary that is fail-closed on any use of its flag, reuses the P54-02 bounds and finalization rule, and runs one worker at a time.
- A **capped allocator in the worker**, which bounds the requested bytes of every Rust heap allocation, including `lopdf`'s own decompression. It is not a footprint or RSS bound. A breach is signalled once, without allocating, on a best-effort basis: an undelivered signal reports a generic worker failure, never success. Both aborting and fallible paths are covered, and `realloc` accounting is exact. The measured cap, the footprint overhead, the app-mode cost and the residual risks must be accepted at review. The owner approved direct `flate2`/`weezl` dependencies, but they aren't needed, so 01a changes no dependency.
- A content-addressed derived `content-cache.db` that stays correct across restores, with readiness verified by a fresh hash in each session. It needs no migration and doesn't choose the search engine.
- Per-page outcomes from bounded recursive inspection. They never label an unknown cause, and say "image pages", never "scanned".
- Slices: 01a native, 01b UI, 01c fidelity and release measurements, then installed acceptance. Each stops for authorized integration.

[Proposal](docs/OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md). Earlier entries remain historical.

## Next task: OFFLINE-01; P54-06 phase B part 2 queued — 19 October 2026

**Integrated:**
- **#223**, P54-06 phase A with the P54BASE-R1 correction: Codex review GREEN, merged as `e42e2b3`.
- **#224**, phase B part 1, the frozen FSRS-6 preregistration: Codex rounds 1 and 2 were RED on contract gaps, all closed; round 3 GREEN; merged as `f10a520`.

The "pending review" wording in their entries below is historical.

**Owner decision, 19 October 2026:** start **OFFLINE-01** next. P54-06 phase B part 2 (the in-house candidate, measurements and transition simulations) waits in the scheduler queue behind the offline → homework → exports tranche. Its preregistration (`docs/evidence/p54-06-phase-b-2026-10-19/PREREGISTRATION.md`) stays frozen and binding for when it resumes. Claude implements and Codex reviews. Earlier entries remain historical.

## Owner priority update: offline study → homework → exports — 18 October 2026 Pacific

The owner approved the expanded scope and explicitly selected **offline study → homework → exports as the next priority after the current release and any task already underway**. This supersedes the older unstarted scheduler → weather → FAA next-task order; preserve active assignments and all existing P54/Study Hub work. Remaining scheduler, weather and FAA work stays queued behind this tranche. Read the [precise delivery/acceptance plan](docs/OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md) before implementation. Current release/task state must be checked live; this planning entry does not reopen or certify a release.

| Order | ID | Outcome |
| --- | --- | --- |
| 1 | OFFLINE-01 | Managed content inventory, durable per-page text/readiness and rebuildable derived cache; close actual P54-02 production extraction/resource gaps. |
| 2 | OFFLINE-02 | Search a subject across readable PDF passages, guides, cards, practice-question stems, notes and linked study records; grouped hits, source revision/page links, honest coverage and no provider calls. |
| 3 | OFFLINE-03 | Manual summaries/cards/questions and source-linked notes/highlights, correct user/instructor provenance, preserved edits and histories. |
| 4 | HOMEWORK-01 | Study Library Homework view for self/instructor-assigned multi-activity work; optional dates/instructor/lesson, linked reading/cards/tests/reflections, completion history, daily-plan/prep reuse. |
| 5 | EXPORT-01 | Discoverable Export / Print and selected multi-material handouts; reuse native saves and existing one-material v1 packet contract. |
| 6 | EXPORT-02 | Bounded UTF-8 flashcard CSV, explicit spreadsheet/import policy, improved offline print/Save as PDF and separate optional answer keys. |

**OFFLINE-02-OCR** remains an explicit gated scan-coverage subtask. Search must include PDFs; scanned pages require text recognition and partial/unprocessed pages must be visible. Ship text-PDF search honestly first, then a bounded approved OCR lane; pending OCR need not block homework/exports for readable content. Existing titles/metadata search and saved offline study are foundations, not proof of complete PDF search.

[Refreshed OSS research](docs/OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md) and [API/license snapshot](docs/research/OFFLINE_STUDY_OSS_SNAPSHOT_2026-10-18.json) reuse OSS-01/02/04: evaluate native SQLite FTS5 against the existing MiniSearch alternative, retain PDF.js Mac compatibility gates, and compare native OCR with one Tesseract option. **OSS-07** is conditional PapaParse versus a small tested CSV writer for EXPORT-02; **OSS-08** is conditional direct-PDF renderer evaluation (PDFKit versus pdf-lib) only if accepted HTML/native printing is inadequate. Neither is adopted. All seven refreshed actual repositories exceed 1,000 stars; source/licensing/resource/compatibility gates remain.

**Next implementer:** after the release/current assignment, start OFFLINE-01 only using the plan's entry point. Reuse P54-02 evidence; do not duplicate accepted proofs, change a dependency/migration without the applicable review, start a scheduler migration, or claim that saved content means new AI generation works offline. Detailed source/installed acceptance and one-review-slice stopping rules are in the plan. Earlier entries retain historical status.

## v0.5.7 maintenance items made actionable — 19 October 2026

The owner requested the three release observations be tracked as work. [Precise scope and acceptance](docs/V057_MAINTENANCE_FOLLOWUPS_2026-10-19.md):

| ID | Task / completion rule |
| --- | --- |
| V057-UI-01 | Reproduce and fix the clipped Cancel action in Gemini Send confirmations; verify all footer actions, constrained sizes/enlarged text, keyboard/fallback dialogs and no provider call on Cancel. Installed usability remains to be independently verified. |
| V057-DB-01 | Classify reported backup/restore `-shm`/`-wal` leftovers by exact database/path/lifecycle before changing cleanup. Active WAL can hold committed data. Clean only proven operation-owned disposable artifacts after safe closure; test WAL-only rows, busy/concurrent/crash cases and retained backups. Normal active sidecars can close as expected behavior with evidence. |
| REL-CI-01 | Correct the release Check job's 20-minute cold-run budget while retaining all verification and release guards. v0.5.7 Rust tests passed; timeout cancelled the later lockfile check and skipped cache saving/build. Profile cold/warm stages/cache outcomes; evaluate a finite 45-minute Check budget and prove nonpublishing cold/warm completion. |

These are planned maintenance, not completed fixes or a declaration that the released database is unsafe. Preserve offline study → homework → exports and current assignments. Confirmed data-integrity risk from the sidecar investigation would take precedence; otherwise app polish can join a bounded patch. Resolve REL-CI-01 before relying on the next release automation run. Do not delete active logs, retarget v0.5.7 or trigger publication as cleanup.

## P54-06 phase B part 1: FSRS-6 comparison preregistered; pending review — 19 October 2026

Claude froze the phase-B contract before writing any candidate code. It is pending Codex review.
- **Algorithm:** FSRS-6 with 21 parameters.
- **Oracle:** the unmodified FSRS4Anki scheduler, release v6.1.3, blob `724a2f4`. Its repository has 4,110 stars and an MIT license. ts-fsrs and fsrs-rs are below the star threshold and are not used.
- **How the oracle runs:** in an isolated `vm` context, after checking its blob ID and SHA-256.
- **Vectors:**
  - 30 oracle scenarios over 66 steps (initial ratings, same-day, on-time chains, lapses, lateness, bounded and rounding-adjacent states, the stability ceiling);
  - 42 hand-specified contract vectors (refusals for every prior field, counter overflow and their order, clocks, overflow, the 180-day product cap, the stability ceiling, Again policy).
- **Tolerances:** difficulty and stability must be exactly equal. Intervals are checked in a range only, because the oracle fuzzes them.
- **Recorded oracle quirks,** which become candidate deviations C1–C3:
  - stability can round to 0;
  - ordering pushes intervals past the cap;
  - stability can grow past the accepted ceiling;
  - a zero-day review throws.
- **Checks:** the preregistration tests pass 10/10, and the reference check reproduces all vectors. Codex rounds 1 and 2 were RED on contract gaps (successor states above the stability bound; no prior-timestamp validation; counter overflow at the safe-integer maximum); all are closed.

No candidate, production, dependency, migration or version change. Part 2 (the candidate, measurements against simple-v1 and transition simulations) follows only after this is accepted. [Preregistration](docs/evidence/p54-06-phase-b-2026-10-19/PREREGISTRATION.md). Earlier entries remain historical.

## v0.5.7 published; P54-06 phase A P54BASE-R1 correction pending review — 19 October 2026

**v0.5.7 is published** (macOS, 06:40 UTC, marked Latest) from tag `v0.5.7` at main `e8f6808`. That commit combines GEN-REL-01–05, the #221 managed-source fix and the #222 version bump. The published asset is the exact locally built ad-hoc DMG that was installed and tested, as with v0.5.5. Its SHA-256 is `57a3c913071b4763bdb5d311e300273b66035e58c13840129cfae4ee84d36c30`. The tag-triggered release workflow hit its 20-minute Check timeout without a Rust cache and built nothing; publication did not depend on it.

**Installed test of that DMG.** It ran on the synthetic profile via the v057 handoff script, against live Gemini Standard (`gemini-3.5-flash`) with the test key, which was never read. The owner's profile was returned with identical recorded metadata. Results:
- **Passed:**
  - a 40-card generation from the real 3-page PDF;
  - navigation during generation;
  - deliberate save and discard;
  - cancelling mid-run, which kept a 30/60 draft;
  - Try again finishing 60/60 distinct cards;
  - a practice test;
  - backup without the key, and restore with a `before-restore` copy.
- **Minor findings:** the practice-test Send dialog clips its Cancel button, and backup and restore leave SQLite `-shm`/`-wal` sidecar files behind.
- **Unverified:** Gatekeeper and notarization, a standard account, macOS 12.x, VoiceOver and Windows.

The local evidence is under `Flight-training-backups/local-candidates/2026-10-19-v0.5.7-e8f6808/`.

**P54-06 resumes with the P54BASE-R1 correction to PR #210's phase-A baseline**, implemented by Claude and pending Codex review:
- The runner now refuses any `--fixtures` corpus whose required vectors keep their IDs but change their inputs. The inputs are frozen in `required-inputs.json`, which is bound by a digest.
- The sources are repinned to `e8f6808`. Only the app version string in the lockfile changed.
- The frozen author diagnostic gives 1 pass / 2 fail before the fix and 3 pass after it.
- The proof gives 19/78/6; its tests pass 29/29.
- No production, dependency, migration or version change. Phase B is not started.

[Report](docs/P54_06_FEASIBILITY_BASELINE_REPORT_2026-10-17.md#p54base-r1-correction--claude-19-october-2026). P54-07 weather and P54-08 FAA references follow. Earlier entries remain historical.

## Combined release installed blocker: managed-source path correction — 18 October 2026

The private v0.5.6 combined candidate built and launched, but the first 40-card synthetic study-aid attempt failed **before upload (0 admissions/submissions)**: batch checks looked for documents-relative file paths at the app-data root. This is a confirmed product regression, not a diagnosis of the friend's connection. v0.5.6 remains private and is retired; the bounded source/test/copy correction and next-candidate v0.5.7 metadata are **pending independent review**, not accepted or published. [Report](docs/GEN_REL_INSTALLED_SOURCE_FIX_REPORT_2026-10-18.md), [reviewer assignment](docs/GEN_REL_INSTALLED_SOURCE_FIX_REVIEWER_PROMPT_2026-10-18.md). Original profile returned intact; synthetic key/evidence remain isolated. Corrected installed/live and backup/restore outcomes must be recorded before release. P54-06 → P54-07 → P54-08 remains after release; no feature loop restarted. Earlier entries remain historical.

## GEN-REL-05 + GENREL04-R12 accepted (Claude round 2 GREEN) and integrated — 19 October 2026

Codex implemented larger source-grounded flashcard sets (20/40/60 targets, default 40), bounded batches, recoverable drafts and deliberate final acceptance, preserving prior content/history and the shared limits. The carried GENREL04-R12 cleanup correction is closed. Claude round 1 was **RED**, with blocking GENREL05-R1; round 2 was **GREEN**, closing R1–R4. Integrated in **PR #219, merge `e07f77e`**. [Report](docs/GEN_REL_05_IMPLEMENTATION_REPORT_2026-10-19.md) and [review evidence](docs/evidence/gen-rel-05-2026-10-19/). Live-provider and installed-app behavior remain **UNVERIFIED**.

## Next patch release includes GEN-REL-01–05 — owner decision 18 October 2026

The owner's “lets get 5 shipped too” decision includes all five improvements in the same next patch release, superseding a 01–04-only candidate. All five are now integrated; **next is an owner-run build and installed verification of the combined patch-release candidate, followed by normal release gates before publication**. No release has been built or published. The count defaults were implementation proposals, not owner-specified counts; release scope does not authorize lifting recovery bounds.

After that release, resume the preserved P54-06 feasibility queue, including PR #210's coverage correction (no scheduler adoption or migration implied), then P54-07 weather and P54-08 FAA references, followed by the approved Study Hub and related open-source evaluation sequence. Reuse accepted search/navigation evidence and retain unresolved production-search/adoption gates. This docs update grants no new merge, dependency, profile/provider-access or publication authority.

## User-reported generation timeout: confirmed message — 18 October 2026

The owner's screenshot shows **“Gemini did not answer in time. Check the internet connection and try again.”** It confirms the timeout-message path, not a cause or a measured five-minute wait. The friend's installed version, document size/pages, selected model and transport stage remain unknown; it proves no bad key, exhausted quota or faulty internet. The source's 300-second request timeout does not establish her build's behavior; GEN-REL-03 now also bounds active work across stages/retries.

[The plan](docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md) retains delayed upload/headers/body and dropped-connection synthetic acceptance requirements, preserved validated results and prior study content, and sanitized stage diagnostics. GEN-REL-01–05 source integration does not establish what her installed build contains or close live-provider/installed acceptance. Earlier tracker entries remain historical.

## GEN-REL-04 accepted by Codex review (round 6 GREEN) and integrated by Claude — 18 October 2026

Integrated in **PR #217, merge `3d50a64`**; reviews are under [`docs/evidence/gen-rel-04-2026-10-18/`](docs/evidence/gen-rel-04-2026-10-18/).

**Generation progress is now honest and job-scoped**, and it can be cancelled.

- **Progress.** Each event names its job and the stage actually reached (preparing, uploading, Google preparing the PDF, checking the uploaded copy, waiting for Gemini, receiving, checking, pausing, saving), plus the attempt and the elapsed time. It is shown in a polite live status, never as a percentage.
- **Cancel** is a real, keyboard-reachable button. The journal decides, under its lock, whether a job is cancelled or completes, and every request (generation, upload, file check, each cleanup DELETE) asks the journal for admission under that same lock. Once a cancel is recorded, nothing more is sent, and nothing is saved.
- **Cancel by request id.** A cancel goes by the window's own request id, so it works without progress events and before the job has even begun.
- **A cancelled job never comes back on its own.** It survives a restart as cancelled and is never resent. Its record cannot be removed while its command is still finishing.
- **An answer that beat the cancel** is offered to save or discard, never saved by itself.
- **Recovery.** After a failure, cancel or interruption, **Try again** goes through the Send confirmation and reuses a PDF already prepared with Google. **Save again** remains checkpoint-only. GENREL03-R1 (file-check diagnostics) is closed.

Codex review took six rounds: R1–R4, R5–R6, R7–R8, R9–R10, R11, then GREEN, all corrected with regression tests whose pre-fix failures are kept. Non-blocking GENREL04-R12 (keep queued cleanup entries if a cancel drops the cleanup future) was carried into GEN-REL-05 and is now closed in PR #219. [Report](docs/GEN_REL_04_IMPLEMENTATION_REPORT_2026-10-18.md) and [round-6 review](docs/evidence/gen-rel-04-2026-10-18/review-r6/codex-review-round6-green.md). Live-provider and installed-Mac behavior remain UNVERIFIED.

The `DocumentPagesPanel` click-ownership fix (PR #216, Codex GREEN) was merged first, under the owner's broader instruction ("you can merge anything you feel is ready"). GEN-REL-05 has since integrated in PR #219; the combined release gate above is next.

## GEN-REL-03 accepted (Codex review GREEN, Claude's independent gate green) and integrated by Claude — 18 October 2026

Codex completed GEN-REL-03 from Claude's interrupted work (PR #215). That gives one 300-second active budget across the upload, file readiness, generation, retries, the backup model and cleanup, with a 15-second connect limit and at most three generation attempts. `Retry-After` is honored only within the budget. Failures are classified by stage (unreachable, upload, no answer in time, answer cut short, connection dropped, quota, refusal, blocked or truncated output), without blaming the internet unless a connection was never made. A sanitized details line is added to each failure, and GENREL01-R12 is closed.

A fresh read-only Codex review (round 1) was GREEN, with one non-blocking finding: GENREL03-R1, file-check diagnostics, carried into GEN-REL-04. Because Codex also completed the code, Claude reviewed the diff independently (no blocking defect) and reran the full gate on `8ea8439`: npm 3,676 / 6 skipped, cargo 642 / 6 ignored, all other checks green. [Acceptance evidence](docs/evidence/gen-rel-03-completion-2026-10-18/acceptance/README.md). Live-provider and installed-Mac behavior remain UNVERIFIED. **Next:** GEN-REL-04 (honest progress, Cancel and stage-appropriate Retry/Resume).

## GEN-REL-03 completed from Claude's interrupted task; pending independent review — 18 October 2026

**IMPLEMENTED; NOT ACCEPTED OR MERGED.** Codex preserved Claude's four partial source files, reproduced the incomplete test compilation, and finished the shared generation budget and diagnosis package on `codex/gen-rel-03-completion`, base `17c80ee` (#214). [Report](docs/GEN_REL_03_IMPLEMENTATION_REPORT_2026-10-18.md), [independent reviewer assignment](docs/GEN_REL_03_REVIEWER_PROMPT_2026-10-18.md).

One 300-second active provider-work budget covers PDF preparation, shared waits, requests, retry delays and fallback; at most three generation submissions include fallback and missing-file recovery. Transient retries respect Retry-After; quota/auth/payment/model/output failures are actionable and sanitized. Timeouts no longer automatically blame the internet, uncertain remote completion/cost is disclosed, blocked/truncated replies are refused, and GENREL01-R12 expiry checks are corrected. Restart makes no automatic provider calls; Save again uses the validated checkpoint. Synthetic tests only; live-provider and installed-Mac behavior remain UNVERIFIED.

This is the current task, not authority to merge. GEN-REL-04 follows its independent acceptance/integration; GEN-REL-05 remains after 04. Exact friend timeout evidence is recorded separately in PR #213; her installed build and document size remain unknown. Prior tracker history follows unchanged.

## GEN-REL-02 accepted by Codex review (round 5 GREEN) and integrated by Claude — 18 October 2026

Generations now belong to the app, not the page. An answer is saved only to the material it was made from, while that material, its file bytes and its saved revision are unchanged. A native journal (`gemini-jobs.json`, outside backups) keeps each validated answer as a checkpoint, so **Save again** never calls Gemini. After a reload or restart, a finished answer waits for a deliberate save or discard, an interrupted one is never resent, and answers for deleted documents are shown on every screen until dismissed. A committed backup restore clears the journal, or keeps it quarantined until it can be cleared.

Codex review took five rounds: R1–R8, R9–R13, R14, then R15 and R16 (non-blocking), all corrected with regression tests. Round 5 was GREEN. [Report](docs/GEN_REL_02_IMPLEMENTATION_REPORT_2026-10-18.md) and [round-5 review](docs/evidence/gen-rel-02-2026-10-18/review-r4/codex-review-round5-green.md). Gate: npm 3,676 passed / 6 skipped, cargo 613 passed / 6 ignored, typecheck, build, strict Clippy, fmt, cargo-lock, schema-14 helper 26/26, no migration, dependency or version change. Live-provider and installed-Mac behavior remain UNVERIFIED. A pre-existing timing-sensitive wait in `DocumentPagesPanel.test.ts` failed once locally and was classified with evidence (`docs/evidence/gen-rel-02-2026-10-18/README.md`). **Next:** GEN-REL-03 (bounded retries and clear diagnosis, including GENREL01-R12), implemented by Claude under the same review-then-merge instruction.

## GEN-REL-01 accepted by Codex review (round 4 GREEN) and integrated by Claude — 18 October 2026

**Owner authority change (18 October 2026):** for the GEN-REL-01 to 05 series only, the owner instructed Claude: "once codex says its green i want you to merge and automatically move on", with at least five review rounds allowed. Each GEN-REL item is therefore merged by Claude after a GREEN Codex read-only review and green exact-head CI, and the next item starts immediately. All other work keeps the rule that agents do not merge.

GEN-REL-01 passed four Codex rounds: R1–R5 (round 1), R6–R9 (round 2), then R10 and R11 (round 3), all corrected with regression tests. Round 4 was GREEN. [Report, including the round 1–3 corrections](docs/GEN_REL_01_IMPLEMENTATION_REPORT_2026-10-18.md) and [round-4 review](docs/evidence/gen-rel-01-2026-10-18/review-r3/codex-review-round4-green.md). Complete corrected gate: npm 3,648 passed / 6 skipped, cargo 585 passed / 6 ignored, typecheck, build, strict Clippy, fmt, cargo-lock, schema-14 helper 26/26, protected paths unchanged.

**Open, non-blocking:** GENREL01-R12, the reuse expiry is not rechecked after a slow confirmation or on shared adoption. It is carried into GEN-REL-03 (bounded recovery). Live-provider and installed-Mac behavior remain UNVERIFIED. **Next:** GEN-REL-02 (recoverable background jobs), implemented by Claude.

## GEN-REL-01 implemented; pending independent review — 18 October 2026

**IMPLEMENTED, PENDING REVIEW; not accepted, committed or merged.** The uncommitted work is in the worktree `Flight-training-gen-rel-01` (`claude/gen-rel-01`, base main 45b4e2a). [Report](docs/GEN_REL_01_IMPLEMENTATION_REPORT_2026-10-18.md), [reviewer assignment](docs/GEN_REL_01_REVIEWER_PROMPT_2026-10-18.md).

- **PDF reuse:** a PDF is uploaded once to Google's Files API and referred to by guide and practice-test requests; it is never sent inline again. Reuse is bound to the key's hash, the content SHA-256, the type and the selected source, held in a bounded session-only cache (16 entries) and confirmed `ACTIVE` before each reuse.
- **Concurrency and recovery:** preparation is coalesced and epoch-guarded. Expired, failed or deleted copies are re-prepared at most once, and only this cache's uploads are deleted.
- **Send confirmation:** offers "Choose a chapter or pages first" (the existing split; nothing is sent) and explains the temporary 48-hour Google copy and exactly what leaves the Mac.
- **Inline sources:** images and text are now held to the encoded request limit.

Synthetic loopback tests only. Final gate exit 0: 3,648 frontend and 561 native tests, build, Clippy, fmt, lock sync, helper 26/26 (after removing an editor build folder; the first run is kept), migrations unchanged. Live-provider and installed-Mac behaviour are UNVERIFIED. GEN-REL-02 has not started.

## TOP PRIORITY: generation reliability before other feature work — 18 October 2026

The owner approved the four improvements after a friend reported slow/failed study-guide/test generation, requested **one at a time before anything else**, and assigned implementation to Claude. This instruction supersedes the earlier queue priority; it does not erase accepted work. [Detailed scope, defaults and acceptance matrix](docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md).

| Order | ID | Required outcome / gate |
| --- | --- | --- |
| 1 | GEN-REL-01 | Send less and reuse source preparation: deliberate chapter/page-first managed selection, reusable PDF upload/reference, content/credential/expiry-safe bounded native cache; prove guide+test do not transfer the same PDF twice. |
| 2 | GEN-REL-02 | Recoverable background jobs and validated checkpoints: navigation/restart-safe ownership, source-bound saves, preserved previous content, no repeat provider call for save-only recovery. |
| 3 | GEN-REL-03 | Bounded retries and clear diagnosis: transient transport/status handling, one shared active-time budget, retained attempt limits, actionable quota/auth/model/output/save errors; no indefinite waiting or false exactly-once claim. |
| 4 | GEN-REL-04 | Honest job-scoped progress, Cancel and stage-appropriate Retry/Resume; no fake percentages, post-cancel writes or obsolete notices. |
| 5 | GEN-REL-05 | More source-grounded flashcards after reliability: proposed40-card default with20/40/60 choices, batches up to10, honest source-limited counts and draft recovery; preserve existing cards/history. |

**Next implementer:** complete **GEN-REL-01 only**, using the [full model-neutral assignment](docs/GENERATION_RELIABILITY_FIRST_IMPLEMENTER_PROMPT_2026-10-18.md), then submit source/evidence for independent review and stop. Each next item waits for the previous item's review/integration. Routine implementation defaults are in the plan; do not restart product-decision questionnaires. Her exact error/build/file size is pending and must not be invented.

**Additional owner request:** more flashcards. Current generation asks for10–20; GEN-REL-05 records the larger-set request. The numeric defaults above are proposed, since the owner has not specified a count. It follows01–04 and does not expand Claude's current GEN-REL-01 task.

P54-06/PR210, including its known P54BASE-R1 proof-coverage correction, is paused and preserved; no FSRS comparison or migration. P54-07/08 and Study Hub/OSS follow-on work retain their relative order after reliability. PR164's external tooling remains separate. No implementation is claimed by this planning entry, no app/profile/provider/release action is performed, and agents do not merge. Earlier tracker history follows unchanged.

## P54-05 calendar reviewed; boundary corrections pending independent review — 17 October 2026

Gemini's ce3c948 submission matches8 source hashes/23 evidence checksums. Codex reproduced six boundary failures and fixed UID property injection, noncanonical-date output and invalid timestamp/end-range handling in an isolated review branch;11 permanent cases plus the existing focused suites pass81/81. Raw author full-gate receipts remain unchanged; final diff/log treatment and current tracker bindings are corrected. [Review and precise reviewer assignment](docs/P54_05_CALENDAR_INDEPENDENT_REVIEW_2026-10-17.md). No merge authorized. Installed Calendar/save-dialog behavior remains unverified; the separate scheduler evaluation does not authorize production adoption. Earlier history follows unchanged.

## P54-05 part B (single-lesson calendar export) implemented; pending review — 17 October 2026

**PENDING REVIEW; NO SELF-MERGE.** Gemini implemented part B of the approved P54-05 scope on `gemini/p54-05-calendar-export`, from accepted main `2fc27b90aacd33183a8e5c0f3047008df37383b4`. Every eligible schedule item (scheduled, cancelled, rescheduled) has an "Add to calendar…" dialog:
- Saves a single-lesson `.ics` file using an in-house RFC 5545 writer with stable UID (`<event.id>@herflightdeck.invalid`), UTC `DTSTAMP`, and floating local times without `Z` or `TZID` (preserving clock times across DST boundaries).
- Honors approved reviewer corrections: `METHOD` and `SEQUENCE` are strictly omitted; no `ORGANIZER`, attendees, or alarms.
- Date-only arithmetic provides default 1-hour duration for start-only events with rollover across midnight, month-end, leap day, and year-end; all-day events use `VALUE=DATE` with exclusive next-day end. Equal/earlier end, end without start, and malformed dates/times are rejected with clear errors.
- Rescheduled lessons export as cancelled with an explanation that the replacement lesson needs its own file.
- Plain language explains file-only import, duplicate risks upon re-import, floating local times, and browser mode limitations (no native save attempted).
- Preparation checklist export starts unticked (false by default) and resets on dialog close or lesson change.
- Stored notes, journal entries, questions, materials, and finances are strictly excluded (verified via unique sentinel tests).
- Reuses native atomic save with new `ExportKind::Calendar` (`.ics`, 64 KiB cap). Dialog implements BRIEF-R1/R2 session ownership and duplicate-click guards.
- Verification gates: 70 focused tests, full frontend 3,629 passed / 6 skipped, native 533 passed / 6 ignored, typecheck, build, strict Clippy, fmt, lock sync, and schema helper (26/26) all pass with exit 0. [Report](docs/P54_05_CALENDAR_EXPORT_REPORT_2026-10-17.md), [Reviewer prompt](docs/P54_05_CALENDAR_EXPORT_REVIEWER_PROMPT_2026-10-17.md).

## Owner-approved open-source evaluation queue — 17 October 2026

The owner approved adding the GitHub shortlist to the roadmap. **Evaluate these integrations; no dependency is adopted by this entry.** Preserve the active P54 work and existing Study Hub sequence. Reuse prior measurements instead of reopening accepted research. [Eligibility, licenses and technical limits](docs/STUDY_HUB_OSS_RESEARCH_2026-10-17.md).

| ID | Candidate / approved evaluation outcome |
| --- | --- |
| OSS-01 | PDF.js: close supported-Mac reader/page-reference gaps using existing M4 evidence; retain honest source identity and bounded loading. |
| OSS-02 | MiniSearch: complete the existing comparison with actual native SQLite FTS5 for bounded offline guide/passage retrieval and rebuild behavior. |
| OSS-03 | jsdiff: prototype a bounded, escaped regeneration-change preview when STUDY-HUB-03 starts; preserve user edits and historical versions. |
| OSS-04 | Tesseract.js: compare a bounded image-page OCR lane with native Mac OCR; native Tesseract is an alternative, not a second required engine. |
| OSS-05 | Transformers.js: evaluate local semantic matching only after a measured lexical-retrieval gap; verify model licenses, offline assets and Mac resource limits. |
| OSS-06 | Orama: conditional local search challenger if existing engines lack a required capability. Fuse remains optional title/topic lookup, without duplicating adequate search. |

Every adoption needs a pinned version, actual repository eligibility, distributed-license review, meaningful compatibility/resource tests and independent source review. FSRS language ports remain below the1,000-star rule; no exception or in-house scheduler adoption is granted here. LlamaIndexTS remains excluded as archived. No merge authorized. Earlier roadmap history follows unchanged.

## Owner-approved Study Guide hub improvements — 17 October 2026

The owner approved all eight Study Guide recommendations, in the proposed order. The Study Guide becomes the central study hub backed by original documents. **Planning approved; implementation not started by this entry.** Keep the current P54 queue and active calendar-export assignment ahead of this follow-on sequence. Reuse accepted work from overlapping P54 items instead of duplicating it. [Detailed scope and acceptance criteria](docs/STUDY_HUB_ROADMAP_2026-10-17.md).

| Order | ID | Approved outcome |
| --- | --- | --- |
| 1 | STUDY-HUB-01 | Source links beside explanations, carried into cards and quiz explanations, tied to document revision and page. |
| 2 | STUDY-HUB-02 | Connected topics linking guides, cards, missed questions, instructor questions and lessons. |
| 3 | STUDY-HUB-03 | User/instructor corrections, dependency visibility, regeneration previews and source-version handling that preserve edits/history. |
| 4 | STUDY-HUB-04 | Explainable, manageable next study sessions based on missed questions, due cards and upcoming lessons. |
| 5 | STUDY-HUB-05 | Useful wrong-answer explanations, source reading and optional explain-in-your-own-words prompts. |
| 6 | STUDY-HUB-06 | Questions grounded in selected documents, with evidence gaps, conflicting sources and aircraft applicability visible. |
| 7 | STUDY-HUB-07 | Lesson preparation and deliberately selected follow-up study informed by study activity; reviewed ACS links later. |
| 8 | STUDY-HUB-08 | Honest document-processing states for readable text, scans, partial extraction, retry and OCR needs. |

[Open-source shortlist](docs/STUDY_HUB_OSS_RESEARCH_2026-10-17.md): actual GitHub counts/licenses checked; reuse PDF.js/MiniSearch evidence, consider jsdiff for regeneration previews, evaluate OCR later, and keep semantic retrieval conditional. No package adopted.

Source references, connected topics and corrections/version handling form the foundation. Existing privacy, offline, backup/restore, independent-review and exact-head CI requirements continue. This approval adopts no dependency, migration, provider integration or OCR engine. Earlier dated entries below retain their historical status.

## P54-06 evaluation reviewed and corrected; production remains simple-v1 — 17 October 2026

Gemini's e8da4d5 evaluation needed factual corrections on erased history, numeric guarantees, algorithm/package versions and migration assumptions. Corrected documentation preserves reset erasure, requires reference-vector/numeric proof and keeps schema14 verification frozen. [Findings and next model scope](docs/P54_06_EVALUATION_REVIEW_2026-10-17.md). Next is bounded non-production feasibility; no library exception, FSRS engine, migration or retention UI is adopted. No merge authorized; current calendar/Study Hub work remains separate. Earlier history follows unchanged.

## STUDY-UI-01 file-bar overlap corrected; pending review — 17 October 2026

Owner screenshot confirmed file metadata squeezed by three non-wrapping actions. The detail bar now separates readable file details from a wrapping action row; handlers and the material-form bar are unchanged. Isolated production-JSX/CSS browser probe: before22/36, after36/36; existing lineage suite9/9 and typecheck pass. [Report and evidence](docs/STUDY_FILE_ROW_LAYOUT_FIX_2026-10-17.md). Source/browser checks only; installed rendering unverified. No merge authorized; current roadmap/agent work continues unchanged.

## P54-05 lesson brief: review corrections BRIEF-R1/R2 applied; pending re-review — 17 October 2026

**PENDING RE-REVIEW; NO SELF-MERGE.** Claude fixed both findings from Codex's PR204 review in `LessonBriefDialog.tsx`:
- **BRIEF-R1:** choices no longer carry into another lesson.
- **BRIEF-R2:** a late save from an earlier lesson or session no longer shows a notice or releases a newer save's lock.

Dialog state is now one session per open lesson, replaced in the same render on a lesson change or reopen, and every save result is owned by its session. 5 permanent held-promise regressions: all fail on b30af19 and pass on the fix. The review's reproductions pass 11/11; focused 53/53; typecheck clean. Native code unchanged; part B not started. [Report](docs/P54_05_LESSON_BRIEF_REPORT_2026-10-17.md).

## P54-05 part A (lesson brief) implemented; pending independent review — 17 October 2026

**PENDING REVIEW; NO SELF-MERGE.** Claude implemented the approved lesson brief on `claude/p54-05-lesson-brief`, from main 32582f2. Every schedule item now has a Lesson brief dialog with:
- a printable page showing the stored details, `lessonPreparation()` readiness with exact parity, and attached reading (title, type, topic);
- only the follow-ups she ticks, from the newest earlier journal entry and open goal questions, de-duplicated.

Saved through the shared native path as a new `brief` kind (html, 1 MiB cap); browser mode prints instead. Lesson notes, reflections, finances, material notes and paths are never included (sentinel tests). Full frontend 3,584/6 skipped; native 532/6 ignored; typecheck, build, strict Clippy, fmt, lock and helper 26/26 pass. First-attempt typecheck and Clippy failures are retained. No dependency or migration; navigation page labels deferred. Part B (calendar) follows acceptance. [Report](docs/P54_05_LESSON_BRIEF_REPORT_2026-10-17.md).

## Navigation and export accepted for combined main integration — 17 October 2026 (UTC)

PR203's independent save-correction acceptance is verified and merged into PR193 atc99fcb2. PR193 now contains the accepted navigation head69768bf and current main3e59d71, preserving both feature histories. Full combined local gate9/9 passes:3,563 frontend/6 skips,531 Mac native/6 ignored, build/types, strict Clippy/fmt/lock/helper26/26/hygiene. Only MaterialDetail and native command registration combine reviewed feature contributions; other feature source is unchanged. [Integration acceptance](docs/NAV_EXPORT_INTEGRATION_ACCEPTANCE_2026-10-17.md). Final exact-head current-main CI still gates the containing PR193 merge, which will also contain all PR189 commits.

**Next, once this integration is on origin/main:** proceed directly to approved P54-05 PartA. The old continuation's Phase1 is complete; no repeated independent review or owner-default questionnaire. [Direct lesson-brief implementation prompt](docs/P54_05_LESSON_BRIEF_IMPLEMENTATION_PROMPT_2026-10-17.md). Calendar follows PartA review. Source integration does not imply installed/release acceptance; no app/profile/provider/installer/signing/release operations. Earlier pending entries below are historical after the containing PR merges.

## P54-04 save corrections implemented; P54-03 integrated — 16 October 2026

P54-03/#191 independently accepted and merged at3266f193 after exact-head CI and independent3,284 frontend/build/helper checks. P54-04/#193 remains pending: Codex implemented a synchronous one-save lock and fixed pending content/output/answer-key controls;4 new UI cases include2 baseline failures. Added meaningful native partial-write/flush/unwind/post-write-rename coverage; retracted the unproven Windows cleanup suspicion. Final gate8/8:3,320 frontend/490 native, strict Clippy/build/types/fmt/lock/helper26/26/hygiene. [Correction report](docs/P54_04_SAVE_RECOVERY_REPORT_2026-10-16.md), [reviewer assignment](docs/P54_04_SAVE_REVIEWER_PROMPT_2026-10-16.md). Our source needs independent review and exact-head CI; no self-merge. M4 correction#194 likewise awaits independent review. Queue order persists; no app/profile/provider/installer/release operation. History follows unchanged.

## P54-04 study export and printable handouts implemented; pending review — 16 October 2026

**IMPLEMENTED, PENDING CODEX REVIEW; NO SELF-MERGE.** Stacked on P54-03 (PR #191), whose guide formatter the handout reuses; review #191 first. **Share or print** on a material saves the chosen guide, flashcards and/or practice questions as a printable handout (.html; optional answer key on its own page) or as an `hfd-study-packet` v1 file. Every packet passes the import's own validator and must import exactly as chosen, or nothing is written. A new native command saves through the macOS dialog with an all-or-nothing write. Only chosen study content travels: no paths, ids, notes, history or settings. No dependency, schema, capability or version change. Checks: 3,316 frontend / 486 Rust tests, typecheck, build, clippy, fmt, lock and diff checks pass. The installed save dialog, end-to-end re-import and WebKit printing are unverified. [Report](docs/P54_04_STUDY_EXPORT_REPORT_2026-10-16.md). Queue order unchanged; next is P54-02. Historical entries follow unchanged.

## P54-05 direction approved; phase2 proof merged — 17 October 2026 (UTC)

The owner approved following Claude's recommendations unless a concrete technical issue required a correction. **P54-05 both parts approved:** brief first, calendar second; dialog-only choices, floating local times, one-hour default, rescheduled-as-cancelled representation, checklist off by default, single-lesson scope. The reviewer corrected the minute-derived SEQUENCE collision and omitted METHOD:PUBLISH from this organizer-free snapshot export. No schema/dependency or update/sync promise is added. [Approval and exact decisions](docs/P54_05_SCOPE_APPROVAL_2026-10-17.md); [updated scope](docs/P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md); [next substantial model-neutral assignment](docs/P54_05_NEXT_IMPLEMENTER_PROMPT_2026-10-17.md).

**P54-02 phase2 proof is accepted and merged via PR199 atc9347fe:** independent77/77 proof cases,17/17 runner regressions, frozen diagnostics,26 helper checks,55 final/58 prior evidence members and green exact-head CI39008744348. This is exploratory evidence, not production adoption. Existing budget/memory/fidelity/owner-decision gaps remain. PR193 still needs independent acceptance of Codex's save correction and current-main integration before brief implementation; PR189 integration remains separately pending. Preserve queue order and all earlier history. No app/profile/provider/installer/release work occurred in this scope approval.

## P54-05 lesson brief and calendar export: scope proposed for review — 17 October 2026

**PROPOSED SCOPE ONLY; NOTHING IMPLEMENTED OR APPROVED.** P54-02 phase 2 is pending review and owner decisions, so Claude drafted the next queue item's scope for Codex review; queue order is unchanged. Two independently approvable parts:
- **A, a printable lesson brief:** the existing prep checklist and "Ask:" questions, attached reading and ticked follow-ups only. Lesson notes, journal reflections and finances are never included.
- **B, a one-time `.ics` file:** an in-house RFC 5545 writer with a stable UID, explicitly not sync, and no new dependency.

Both reuse P54-04's save and printable-HTML path, so PR193 must reach main first. Eight owner decisions are listed, including the calendar time model (floating local time recommended), default duration, SEQUENCE and what `rescheduled` means. [Scope](docs/P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md).

## P54-02 phase2 proof independently accepted for integration — 17 October 2026 (UTC)

P54P2-R1–R6 are closed for the exploratory proof at2351d36: independent77/77 native cases,17/17 runner tests and the prior frozen stream/ownership diagnostics pass;55 final and58 prior evidence members verify from Git. Current-main integration preserves all histories and proof bytes. The containing PR199 commit supplies final exact-head CI/merge. [Acceptance](docs/P54_02_PHASE2_ACCEPTANCE_2026-10-17.md). This accepts the proof/evidence package, not production search:8/10 measured targets, no hard worker memory cap, real-document/native fidelity and owner adoption decisions remain open. P54-05 proposal is separately under owner-approved-default review. Navigation/export integration remains separate; no app/profile/provider/installer/release work.

## P54-02 phase 2 final corrections R5–R6 delivered; pending independent review — 17 October 2026

**PROOF CORRECTIONS ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude completed P54P2-R5–R6 on PR199. R5: a checked result now needs exit 0 and a clean, fully framed end of stream. Trailing frames, malformed or oversized trailing lines, a partial final frame and reader errors are failures that index nothing; all four failed (indexed) on 06f4bf3. R6: the runner captures source bytes once, creates its example exclusively, and removes it only if it still holds those bytes, so a matching edit by another writer is preserved and fails. 06f4bf3 deleted it. Suite 77/77; runner regressions 17/17. The same 8/10 pre-registered targets met, both misses unchanged. Prior evidence untouched; no application change. [Report](docs/P54_02_PHASE2_FINAL_CORRECTIONS_REPORT_2026-10-17.md).

## P54-02 phase 2 corrections R1–R4 delivered; pending independent review — 17 October 2026

**PROOF CORRECTIONS ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude completed P54P2-R1–R4 on PR199 (`claude/p54-02-worker-proof`). R2: one bounded settlement loop; success needs a complete result and exit 0 (EOF-alive, result+exit 3 and result+stall now settle as failures by themselves, nothing indexed). R3: fail-closed runner with content-hash preservation; 13 permanent runner regressions (13/13 corrected, 11 fail and 2 error on submitted). R4: caller size check before spawn and bounded incremental hashing; an oversized publication replacement is refused unread. R1: the 12 original raw logs were ignored by Git and lost; disclosed, with a labeled replacement run and Git-blob-verified manifests. Suite 71/71; the same 8/10 pre-registered targets met, both misses unchanged. Pre-registration and original evidence untouched; no application change. [Report](docs/P54_02_PHASE2_CORRECTIONS_REPORT_2026-10-17.md).

## P54-02 phase 2 worker proof delivered; pending independent review — 16 October 2026

**PROOF ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude delivered the bounded extraction-worker and search-contract proof on `claude/p54-02-worker-proof`. Limits and targets were pre-registered in a7813e7 before any code ran. Suite 63/63 (first run 62/63 retained). Pre-registered targets: 8 of 10 met; **missed** warm-query p95 at 10,000 (61.8 ms vs 50) and whole-process peak RSS (285 MiB vs 256), reported unchanged. macOS refuses `ulimit -v`; the sampled RSS watchdog overshot by up to 270 MiB, so there is **no hard memory bound** yet. Proposed contract: native FTS5 in a separate disposable cache, literal AND queries, no implicit prefix/fuzzy, diacritic folding, hash-bound page destinations, browser metadata fallback. No engine or dependency adopted; no application file changed. [Report](docs/P54_02_PHASE2_WORKER_PROOF_REPORT_2026-10-16.md).

## P54-02 phase2 re-review: original fixes verified; two final corrections — 17 October 2026 (UTC)

PR199 head06f4bf3 remains pending acceptance. Independent checks reproduce71/71 native proof cases and13/13 runner regressions; all58 replacement evidence members verify from Git. Original EOF/exit failures, caller bounds and false-PASS gates are corrected, with original missing logs honestly disclosed. Two further boundary failures remain: **P54P2-R5**, a completed child can leave trailing frames/malformed or partial output unvalidated and still index; **P54P2-R6**, matching edits to the source and temporary example can fool cleanup into deleting another writer's work. [Re-review](docs/P54_02_PHASE2_REREVIEW_2026-10-17.md); [one consolidated final correction prompt](docs/P54_02_PHASE2_FINAL_CORRECTIONS_PROMPT_2026-10-17.md). Preserve all prior fixes, receipts, preregistered budgets and the two measured misses. No production adoption.

PR189's69768bf CI is green but it still needs current-main reconciliation/final exact-head integration; PR193 still needs its independent export acceptance/current-base integration. Queue order and owner decisions remain unchanged. No app/profile/provider/installer/release work. Earlier dated entries below are historical.

## Independent review: panel fix accepted; search proof needs four corrections — 16 October 2026

**NAV-UI-01 accepted:** PR198 at cb4afba passed independent234 navigation tests, the two original frozen diagnostics, typecheck/build and helper26/26; exact-head CI39004376950 is green. Merged into PR189 as69768bf. PR189 remains open: reconcile current main and require final combined-source exact-head CI before main integration. Accepted R11/R12 are preserved.

**P54-02 phase2 / PR199 requires P54P2-R1–R4:**30/42 submitted evidence members exist and verify in Git;12 logs are missing. The original63/63 suite reproduces, but new diagnostics show EOF can hang past deadline, a complete-result worker exiting3 can still index, and the runner can print PASS after failed measurements or preservation. Caller hashing also lacks the preregistered input boundary. [Independent review](docs/NAV_WORKER_INDEPENDENT_REVIEW_2026-10-16.md); [one precise correction assignment](docs/P54_02_PHASE2_CORRECTIONS_PROMPT_2026-10-16.md). Keep original receipts/preregistration and reported8/10 targets unchanged; no production engine/default adoption.

**Next integration order:** finish current-base navigation integration, record independent export acceptance and retarget/reconcile PR193 with main, then complete/review PR199 corrections in the approved queue. No app/profile/provider/installer/release work is needed. Earlier entries below are retained as historical snapshots.

## NAV-UI-01 [P3] panel notices implemented; pending independent review — 16 October 2026

**PENDING REVIEW; NO SELF-MERGE.** Claude implemented the quick review's follow-up on `claude/nav-ui-01-panel-notices`, stacked on PR189 b5e6b99. Pages-panel notices (check result, read-mark and removal failures) are now owned by the repository/controller/material context that started the action: a retired completion publishes nothing, and a context change clears old notices. 7 permanent cases; 4 fail on the unfixed panel. Navigation 101/101, full frontend 3,527/6 skipped, typecheck/build/helper pass. R11/R12 source unchanged. [Report](docs/NAV_UI_01_PANEL_NOTICES_REPORT_2026-10-16.md).

## Quick review: corrections integrated into feature branches; one nonblocking UI follow-up — 16 October 2026

PR194 and PR195 are merged into their feature branches; earlier "draft/pending correction" entries below are historical. PR189 headc9ad743 has Claude's recorded R11/R12 independent acceptance and current-main merge, with combined-source CI pending at review time. PR193 head27c3971 is green against the old formatted-guide base; it still needs a recorded independent export acceptance, retarget/reconciliation with main and final current-base CI before integration.

**NAV-UI-01 [P3], after navigation integration:** a held Check pages result from repositoryA can leave an obsolete success/error message after the mounted panel switches toB. Two diagnostics reproduce it; B's saved/current state stays correct. Bind panel notices to the initiating context/lifetime; retain live messages and existing persistence guards.126 existing focused tests and combined build/types pass;2 new diagnostic assertions fail as expected. [Review, exact fix scope and receipts](docs/QUICK_ROADMAP_CODE_REVIEW_2026-10-16.md). Do not reopen accepted R11/R12 or delay their integration solely for this rare display issue. P54-03 is merged; P54-02 phase2 worker/search proof remains next in the approved order. No new dependency, app/profile/provider/installer/release work. History follows unchanged.

## M4 R11–R12 correction accepted and merged into PR189; current-base CI pending — 16 October 2026

Independent review of Codex's correction found no defects; PR194 merged into `claude/m4-slice1` at 4f2aef8 with the exact-head guard. PR189 now includes current main (P54-03 guides, search evidence) with all tracker histories retained. It merges into main only after green exact-head CI on this combined source. [Acceptance](docs/M4_LIFECYCLE_ACCEPTANCE_2026-10-16.md).

## Roadmap delivery checkpoint: formatted guides merged; corrections awaiting review; search proof recorded — 16 October 2026

**P54-03 accepted:** PR191 merged at3266f193 after independent source review,3,284 local frontend tests/build/helper26/26 and green exact-head CI. [Acceptance](docs/P54_03_ACCEPTANCE_2026-10-16.md). **M4/P54-01:** Codex implemented R11/R12 in draft[PR194](https://github.com/rickydeleon49-ui/Flight-training-/pull/194), stacked on189,33 new cases and3,488 frontend tests; application source passed CI38992516422; receipt-only publication head35bd450 is rechecking, independent review still required. **P54-04:** duplicate-save and editable-pending-selection fixes plus native failure proofs are in draft[PR195](https://github.com/rickydeleon49-ui/Flight-training-/pull/195), stacked on193;3,320 frontend/490 Mac native and full8-check gate pass; independent review required. Source is not self-accepted. Both PRs carry detailed reviewer assignments and preserved failure receipts.

**P54-02 phase1 exploratory evidence recorded:** actual native FTS5 works, browser sql.js FTS5 is absent;3KB compressed PDF yields1MB extracted text before a length check.18 engine runs on100/1,000/10,000 synthetic materials,36 identical result-id set checks and9 accent-folding differences. No engine/dependency or production feature selected. [Report](docs/P54_02_SEARCH_EVALUATION_2026-10-16.md), [next substantial worker-proof assignment](docs/P54_02_EXTRACTION_WORKER_PROOF_PROMPT_2026-10-16.md). Native interaction, real handbook fidelity, hard extraction/cancellation limits and production restore/index lifecycle remain pending. Approved queue order persists. Primary settings, active Claude worktrees, owner profiles/keys and historical evidence remain untouched; no app/provider/installer/signing/release operation. [Full independent review and integration order](docs/ROADMAP_REVIEW_HANDOFF_2026-10-16.md). History follows unchanged.

## M4 R11–R12 implemented by Codex; independent review pending — 16 October 2026

Owner assigned Codex implementation duties. Isolated `codex/m4-lifecycle-corrections` stacks on published PR189; Claude's active work is preserved. Per-context/lifetime action leases prevent retired refresh dispatches; unique click/controller markers preserve source-badge cleanup.33 new permanent cases;94 focused and4 frozen tests pass; full frontend3,488 pass/6 skipped, build/types and helper26/26 pass. [Implementation report](docs/M4_LIFECYCLE_CORRECTIONS_REPORT_2026-10-16.md), [independent reviewer assignment](docs/M4_LIFECYCLE_REVIEWER_PROMPT_2026-10-16.md). This is implementation evidence, not acceptance; exact-head CI and independent review still gate PR189. No native source, schema/version, app/profile/provider/installer/release work. Prior history follows unchanged.

## P54-03 integration fixes R1–R2 applied; pending review — 16 October 2026

**PENDING CODEX REVIEW; NO SELF-MERGE.** Both findings of the [PR191 integration review](docs/PR191_INTEGRATION_REVIEW_2026-10-16.md) are addressed on `claude/p54-03-formatted-guides` after merging current main (`333db29`). **R1:** only the observation-test readiness gate from `c14afff` is ported (`skillScreens.test.ts`, waits for "Add an observation" to be enabled); no M4 source. The preserved held-skill-list diagnostic, appended temporarily, passed 2/2 on this branch (the old click opens no dialog; the gated sequence records one observation) and was then removed. The red run 38989843373 is preserved. **R2:** only the three current tracker bindings (bytes, SHA-256), `generatedAt`, and their four SHA256SUMS lines are refreshed; historical bindings are unchanged; all checksum entries verify; the schema-14 helper was rerun in a fresh disposable clone with no build output. Full formatter acceptance remains pending. Historical entries follow unchanged.

## P54-03 formatted study guides implemented; pending review — 16 October 2026

**IMPLEMENTED, PENDING CODEX REVIEW; NO SELF-MERGE.** P54-01's first slice (PR #189) awaits review and its later substeps depend on it, so work moved to the next unblocked queue item; queue order is unchanged. The owner chose an in-house formatter over react-markdown: no new dependency. Study-guide section bodies (saved guides and the import preview) now show lists, nested bullets, numbered steps, bold/italic, quotes, inline code and pipe tables. Nothing becomes a link, image or HTML; stored text, backups and schema are unchanged; plain guides read as before. The Gemini prompt now allows that simple formatting (no provider call made). Checks: 3,284 frontend / 477 Rust tests, typecheck, build, clippy, fmt, lock and diff checks pass; the schema-14 helper fails one case locally only because rust-analyzer wrote `src-tauri/target/flycheck0`. Installed WKWebView and VoiceOver behaviour are unverified. [Report](docs/P54_03_FORMATTED_GUIDES_REPORT_2026-10-16.md). Historical entries follow unchanged.

## P54-03 PR191 integration fixes recorded — 16 October 2026

Before accepting the guide-formatting PR191 at reviewed head5f06d97: **P54-03-R1**, port the bounded observation-test readiness correction without importing unaccepted M4 source, and get green exact-head CI; **P54-03-R2**, reconcile current tracker history and refresh its3 stale current manifest bindings/checksums (all3 mismatches verified). [Integration findings](docs/PR191_INTEGRATION_REVIEW_2026-10-16.md). Full formatter/parser/rendering acceptance remains pending; this was a bounded integration review. Preserve Claude's active terminal work and reconcile newer changes first. M4 R11–R12 remain the separate preceding integration fixes; queue order unchanged. Historical entries follow unchanged.

## M4 Slice1 review: R11–R12 lifecycle fixes before integration — 16 October 2026

Published PR189 headc234005 corrects the original R5–R10 failure sequences and has green exact-head CI (3455 frontend/517 Linux Rust). Independent review still reproduces2 bounded lifecycle defects: **R11**, an old action's finally can start a fresh read on a retired repository and replace current state; **R12**, an old source-badge completion can clear a newer request's cleanup marker, allowing an open after unmount. Fix both before accepting PR189;3 new regression cases fail and the single-request control passes. [Precise review](docs/M4_SLICE1_R11_R12_REVIEW_2026-10-16.md), [correction handoff](docs/M4_SLICE1_R11_R12_CORRECTIONS_PROMPT_2026-10-16.md). Claude is actively working through Terminal: reconcile its newer work before editing; no competing implementation was started by the reviewer. Owner scope approvals and queue order persist. Source tests do not verify installed behavior. Historical entries follow unchanged.

## M4 Slice1 R5–R10 corrected; PR189 resubmitted for review — 16 October 2026

**SUBMITTED FOR CODEX REVIEW; not accepted or merged.** All six re-review findings are corrected on `claude/m4-slice1` (PR189). [Correction report](docs/M4_SLICE1_R5_R10_CORRECTION_REPORT_2026-10-16.md). R5: bookmarks open only on the content they were saved on. R6: a bookmark draft keeps its original content after a refresh. R7: only the latest reload publishes. R8: guidance checks ownership before opening; source badges retire on unmount. R9: the CI failure was a test clicking a still-disabled button while the skill list loaded, reproduced with a held load and fixed with a readiness wait. R10: native checks derive the page count from the PDF bytes, repair a wrong cached count and refuse the request. The completion report's restore claim is corrected (an unobserved A→B→A is not detectable). Frozen diagnostics are permanent regressions. Final gate exit 0: 3,455 frontend and 518 native tests, build, Clippy, fmt, lock sync, schema-14 helper 26/26, diff check; native steps also pass on SDK 26.5. Source tests only; installed behaviour is unverified. No release, version, dependency, schema, app, profile or provider work.

## M4 Slice1 PR189 requires R5–R10 corrections — 16 October 2026

The feature is implemented but not accepted at reviewed head6d8c608. Independent review reproduced stale-bookmark opening, bookmark-draft rebinding, late reload publication, superseded guidance opening and native cached-count bounds defects; exact-head CI also failed one existing skill-screen case. [Re-review](docs/M4_SLICE1_REREVIEW_2026-10-16.md), [one correction assignment](docs/M4_SLICE1_R5_R10_CORRECTIONS_PROMPT_2026-10-16.md). Existing512 native tests and183 focused frontend tests pass, but five new diagnostics fail; no merge is authorized by those passing subsets. All66 submitted paths are frozen and the author checkout is preserved. Owner approval OD-1–OD-10 persists; queue order unchanged. No app/profile/provider/installer/release work. Historical entries follow unchanged.

## M4 Slice1 document navigation complete; submitted for review — 16 October 2026

**SUBMITTED FOR CODEX REVIEW; not accepted or merged.** One source PR on `claude/m4-slice1` delivers the owner-approved Slice1 (OD-1–OD-10, OD-6 refuse-and-explain) and closes the partial review's four findings at source level. [Report](docs/M4_SLICE1_COMPLETION_REPORT_2026-10-16.md).

- **R1:** read confirmation names the content hash and saved generation it was made for; bookmarks name the content. Stale requests change nothing.
- **R2:** success replies must match every request-bound field.
- **R3:** native commits, confirmations and bookmarks reread the managed file inside their own transaction; deletion, relinking or replacement after inspection cannot authorize a save. A verified native open hands only checked content to the default reader.
- **R4:** the genuine tampered schema-14 case is restored; the node test driver (not production) now leaves a refused file unchanged.
- **Feature:** migration 0015 (four tables), shared native/browser operation and validation cases, request controller with local epochs and durable supersession, source badges in four study views, and a "Find your place" panel with page entry, last requested page, separate read mark, bookmarks, save-only retry and file restore.
- **Schema-14 helper:** still frozen at 14; its pins are compared with the registered 1–14 prefix and it refuses a schema-15 library.

Source tests only; installed reader/IPC behaviour is unverified. No release, version bump, dependency, app launch, profile or provider use. Queue order is unchanged. Historical entries follow unchanged.

## M4 Slice1 scope approved; partial implementation needs completion — 16 October 2026

The owner directly approved OD-1–OD-10, including OD-6 refuse-and-explain. [Approval](docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md). The isolated `claude/m4-slice1` worktree has saved checkpoints ed82811/07fdcfa plus one preserved trim patch; it is not accepted or on main. Independent review reproduced stale read-confirmation and inconsistent-acknowledgement defects, identified native cached-file validation and tamper-test coverage gaps, and confirmed the remaining schema14 helper failure. [Review](docs/M4_SLICE1_PARTIAL_REVIEW_2026-10-16.md). Complete the approved feature and corrections together under [the continuation assignment](docs/M4_SLICE1_CONTINUATION_PROMPT_2026-10-16.md), then stop for independent review. No release/profile/build/provider authorization is implied; queue order is unchanged.

OPENFOLDER-01 is independently accepted and merged as PR#187 at774f730; its earlier submitted-for-review entry below is historical. Installed Finder behavior on those bytes remains unverified. Historical entries follow unchanged.

## OPENFOLDER-01 empty-folder fallback corrected; submitted for review — 16 October 2026

The empty/unreadable Mac data-folder fallback in `open_data_folder` is corrected in `src-tauri/src/backup.rs`. For an empty `.app` root, the command now asks the opener to *reveal* the folder instead of *opening* it, and Finder's behaviour on an installed Mac was **not observed** because no app launch was performed. Read/enumeration failures return an informative I/O error instead of falling back to `open_path`; an unreadable individual entry inside the folder now stops the reveal with an error, where it was previously skipped. Working database and child reveal behavior are preserved, permissions remain narrow, and an opener test adapter tests routing, missing root, and permission-denied listing without opening Finder. `open_data_folder_in` is private. [Report](docs/OPEN_DATA_FOLDER_FOLLOWUP_COMPLETION_2026-10-16.md).

Checks: full frontend 3,252 passed / 6 skipped, Rust 477 passed / 6 ignored, cargo clippy `--locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, cargo fmt, lock sync, typecheck, build, 21/21 schema-14 checksums, and 26 schema-helper tests pass. Submitted for Codex review; no self-merge.

The separate model-budget/timeout evaluation and M4 R37–R39 retain their existing assignments. The eight-item queue order is unchanged. Historical entries follow unchanged.

## M4 prototype accepted for integration; production scope decision next — 16 October 2026

**R37–R39 closed in the evidence-only prototype**, effective after this acceptance PR passes exact-head CI and merges. Independent current-main Node22/26 runners pass104 mapped tests and24 mutants; assigned five, previous four and adapted frozen five pass on each. Direct unadapted4/5 remains disclosed. [Acceptance](docs/M4_ROUND6_ACCEPTANCE_2026-10-16.md). All709 submitted files are preserved; old tracker prefixes are reconciled with current history rather than replacing it.

**Next:** owner dispositions of [OD-1–OD-10](docs/M4_PRODUCTION_SCOPE_DECISIONS_2026-10-16.md), then real native-reader source links/bookmarks/last-requested tracking under the [current handoff](docs/M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md). OD-6 explicitly recommends refusing invalid references, matching the tested resolver; the earlier clamping proposal is unapproved. The old conditional implementation draft is superseded, preserved historically, and must not drive a production port.

No production M4 source or migration0015 registration, embedded-viewer dependency, installed/provider test or new release is included. The eight-item roadmap order is unchanged; OPENFOLDER-01 and model-budget evaluation remain separate. Source acceptance is not owner approval of the new feature scope. Historical author and project entries follow unchanged.

## M4 round 6 (R37–R39) corrected — pending Codex review — 16 October 2026

**IMPLEMENTED, UNCOMMITTED, PENDING CODEX REVIEW.** Claude corrected the three findings of the [round-5 review](docs/M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md) in the existing M4 checkout.

- **R37:** a newer request now retires older work before any ownership read or reservation can fail.
- **R38:** a reservation now proves its claim persisted before issuing a token.
- **R39:** the install record keeps the real signal.
- **Diagnostics:** the review's five new ones pass 5/5 on Node 22 and 26; the earlier ones are preserved.
- **Lanes:** both lanes pass with 104 mapped tests and 24 mutants (Node 22 live npm 10 install; Node 26 validated npm 10 reuse).
- **Not done:** M4 stays evidence-only. OD-1–OD-10 stay proposed, P54-01 and migration 0015 are unstarted, and the eight-item queue order is unchanged. [Report](docs/M4_DOCUMENT_NAVIGATION_ROUND6_CORRECTIONS_REPORT_2026-10-16.md).
- **Note:** this checkout's trackers date from `7e49558`. Reconcile with current `main` when committing.

## GEM-01 wording follow-up accepted and merged — 16 October 2026

PR #184 merged at4a8a92f after independent source review and successful exact-head CI. Settings now distinguishes Argon's rate/capacity fallback from403 access refusal, matching Rust and README. Independent Settings tests3/3, typecheck/build/hygiene pass; CI covers3,252 frontend,474 Linux Rust and26 helper tests. [Acceptance](docs/GEM01_WORDING_ACCEPTANCE_2026-10-16.md). No new release or live provider verification is claimed.

The separate model-budget/timeout evaluation remains open. M4 R37–R39 and OPENFOLDER-01 retain their existing assignments, and the eight-item queue order is unchanged. Historical entries follow unchanged.

## M4 round5 reviewed: ownership corrections required; release record accepted — 16 October 2026

**M4 stays evidence-only and unmerged.** Both independent Node22/26 runners pass93 mapped tests and20 mutants; prior four diagnostics pass and frozen five pass through the disclosed seed adapter. New diagnostics expose **R37** (failed newer reservation leaves older opener/save live: page5 becomes10 and UI reverts to opened) and **R38** (ignored claim INSERT/UPDATE issues duplicate undurable tokens). **R39**, a non-blocking receipt issue, loses an install child's real termination signal. All five new assertions fail on both lanes. [Review](docs/M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md) · [single precise correction assignment](docs/M4_ROUND5_CORRECTIONS_PROMPT_2026-10-16.md).

**RELREC-01 is resolved:** PR #178 merged at2f4cca2 after exact-head CI38952463917 on2d6c432. Six tracked native screenshots inspected; complete21-entry evidence inventory and21 helper checksums verify;26 helper tests pass. Existing raw receipts/artifact hashes are preserved. This accepts existing release evidence and adds no new installed/provider verification.

**Next:** finish R37–R39 in the existing uncommitted M4 worktree and return for Codex review; preserve all round5 receipts and594 frozen input hashes. P54-01 production, OD-1–OD-10 dispositions and migration0015 remain unapproved/unstarted. The eight-item queue order is unchanged. The merged Open folder fix and its separate OPENFOLDER-01 follow-up retain their prior status; no new release is built or published. Historical entries follow unchanged.

## PR #178 release record: six screenshots published (RELREC-01) — 16 October 2026

**PENDING CODEX REVIEW; NOT MERGED.** PR #178's release record now tracks its six native screenshots.

- **Screenshots:** all six are synthetic, with no key value, and sit in `docs/evidence/mac-v055-release-2026-10-16/screenshots/`. They were force-added by exact path, and the global image-ignore rule is unchanged. The [release record](docs/MAC_V055_RELEASE_2026-10-16.md) links each one.
- **Inventory:** a new `EVIDENCE_SHA256SUMS` lists the report and every evidence file. `ARTIFACT_SHA256SUMS` stays the separate binary-artifact inventory.
- **Not done:** no rebuild or native rerun, and no installer, profile, database or key committed.
- **Branch:** reconciled with main `4d38733`. Tracker history and the eight-item queue are unchanged; only the schema-14 helper's current tracker hashes were refreshed.

## Open folder fix accepted and merged; empty-folder follow-up tracked — 16 October 2026

PR #180's native Finder correction passes independent source review: **3,252 frontend tests / 475 Rust tests**, typecheck/build/lint/fmt/lock/hygiene and26 schema-helper tests pass. The nine reviewed application files remain identical after updating the branch to current main. Final head `0b818860` passed exact-head CI; #180 merged at `2a203df`, with all nine application hashes confirmed again. No new release is built or published; released v0.5.5 bytes are unchanged. [Review](docs/OPEN_DATA_FOLDER_REVIEW_2026-10-16.md).

**OPENFOLDER-01 (non-blocking):** the empty-root macOS branch still uses plain open-path on the `.app` directory; enumeration failures are indistinguishable from emptiness. Normal startup/library behavior is fixed. Track the bounded [follow-up](docs/OPEN_DATA_FOLDER_FOLLOWUP_PROMPT_2026-10-16.md) before claiming every recovery-state folder opens. Keep this maintenance item separate from the unchanged eight-item post-release queue.

**Other work:** #179 is already merged. #178 needs RELREC-01 screenshot publication/inventory. The active M4 prototype still needs R33–R36 under its existing correction prompt; no production adoption or migration0015. Claude's native Finder observation is implementer evidence; this reviewer ran automated checks and inspected saved metadata, without launching the app, manipulating a profile, reading a key or calling a provider. Preserve historical entries below.

## Independent review: M4 corrections required; release follow-ups triaged — 16 October 2026

**M4 remains evidence-only; corrections R33–R36 are required before adoption.** Independent Node22/26 replays preserve72 mapped tests and16 mutants, and the prior frozen five diagnostics pass. Four new diagnostics fail on both lanes: claim-write errors return undurable tokens, unreserved future tokens commit, verified-reuse lacks validated install execution evidence, and active invented mutant IDs can evade the report checker. The real runner also reproduces both evidence false positives. [Review](docs/M4_RELEASE_INDEPENDENT_REVIEW_2026-10-16.md) · [one correction handoff](docs/M4_RELEASE_REVIEW_CORRECTIONS_PROMPT_2026-10-16.md).

**Release follow-ups:** PR176/177 received bounded retrospective source/artifact review;13 relevant frontend tests and typecheck pass, and published v0.5.4/v0.5.5 assets match tested candidates. No paid Gemini call or new native/Rust run was performed. PR178 stays open for RELREC-01: six locally present native screenshots are ignored and missing from its Git tree; publish them with a complete evidence inventory. PR179's owner-scoped Gatekeeper documentation was independently reviewed and merged at b88e80a after exact-head CI. Signed/notarized, standard-account, VoiceOver and other unverified limits remain explicit.

**Next:** Claude, as owner-selected M4 implementer, corrects the existing prototype and PR178 separately, preserving all receipts/checkouts. No merge before Codex re-review. P54-01 production work and migration0015 stay unstarted pending M4 acceptance and disposition of proposed OD-1–OD-10. The eight-item queue order is unchanged; small GEM-01 wording/budget evaluation observations are recorded in the review and do not reorder it. Historical entries below retain their original status.

## v0.5.5 published with the Gemini 4 Argon choice; Codex review restored before merges — 16 October 2026

**PUBLISHED; RETROSPECTIVE CODEX REVIEW REQUESTED.** [v0.5.5](https://github.com/rickydeleon49-ui/Flight-training-/releases/tag/v0.5.5) is the Latest release: the exact tested `7e49558` DMG `620ed755…`, ad-hoc only, with `spctl` rejecting it. [v0.5.4](https://github.com/rickydeleon49-ui/Flight-training-/releases/tag/v0.5.4) (`1048e463…`) was published earlier the same day.

- **GEM-01 is released.** The installed 0.5.5 upgraded from 0.5.4, and the Settings Standard/Argon choice works with a placeholder key and no provider call. The send dialog names Argon and was cancelled. Restore plus foreground recovery passes, and Cmd-Q quits. Data matches apart from the accepted daily-plan rollover.
- **Process:** #176 and #177 were merged and v0.5.4/v0.5.5 published by Claude on the owner's instruction, **without independent Codex review**. The owner has restored the rule that **Codex reviews before any merge**; those PRs and this record are submitted for review.
- **Next:** the post-release queue resumes at P54-01, unchanged in order. All work is left as PRs for Codex.

[Release record](docs/MAC_V055_RELEASE_2026-10-16.md). Historical entries below keep their original status.

## Owner-requested Gemini model choice (GEM-01): implemented, pending review — 16 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** The owner asked for a better Gemini model on a paid key ("option 1"). This is a new owner-added item, outside the eight-item post-release queue (P54-01…08, unchanged and still waiting). It targets the next version, 0.5.5 or later. The released v0.5.4 bytes are unchanged.

- **What it does:**
  - Settings → Gemini offers **Standard (Gemini Flash)** or **Most capable (Gemini 4 Argon, `gemini-4-argon`)**.
  - The choice is stored in a `gemini-model` file beside the key. It is never in SQLite or a backup (the archive allowlist admits only the database and `documents/`), and a missing or unreadable choice means Standard.
  - **Send this file to Google?** names the model that will read the file, and saved study aids and practice tests say which model made them.
- **Fallback:** Argon falls back to Gemini Flash once. A `429` from Argon (no billing, or its limit reached) moves to Flash at once. A `403` from Argon explains that billing is needed and points to the Standard choice. Standard's retry and Flash-Lite behaviour is unchanged.
- **Google facts checked on 16 October 2026** (ai.google.dev models, deprecations and pricing pages):
  - `gemini-4-argon` is stable and accepts PDFs. It is not on the free tier: $2 / $10 per 1M tokens in / out, rising to $4 / $20 on 1 December 2026.
  - `gemini-3.5-flash` has no shutdown date, and Google routes it to `gemini-3.6-flash`.
  - Google recommends `gemini-3.8-flash` for new projects. Repinning Standard is left as a separate decision.
- **Checks:** 474 Rust tests (7 new), clippy `-D warnings`, fmt, 3,251 frontend tests (8 new, run in UTC), typecheck, build and the Cargo lock check all pass. There was no native run and no provider call.
- **Not verified:** a live request to `gemini-4-argon`, and Google's exact refusal for a key without billing (the `403`/`429` handling follows the documented codes).

## v0.5.4 Mac release authorized by the owner, with signing waived — 16 October 2026

**Owner decision:** publish the accepted, unsigned fbff255 v0.5.4 Mac build as a GitHub release. Apple Developer ID signing and notarization will follow another day. REL-05 (signing) and REL-08 (standard account, interrupted save) are **waived by the owner for this release, not passed**.

- **Asset:** the exact verified bytes, uploaded unchanged. DMG `1048e4636190d07afcbf2da76fc38822cd13189552b03a0ed69265870857676d` (5,086,379 B), executable `a809e7b1…a181a8f`. Tag `v0.5.4` targets `fbff255`. There is no CI rebuild, so published bytes are tested bytes.
- **Gatekeeper:** `spctl` rejects the build, so downloaders should expect macOS to block it. The release notes do not describe a way around it.
- **Visibility:** the repository is private, so the release is visible to collaborators only.
- **Release policy:** Mac candidate version set to 0.5.4. The v0.5.3 draft stays frozen, 0.5.2 stays retired, and Windows stays held on v0.5.1 with no Windows asset.
- **Housekeeping:** the old 0.5.3 app was retired from this Mac's `/Applications` (`824688…eb28`, reversible).
- **Sequence:** this PR with green CI, then a draft release with the asset re-downloaded and hash-checked, then publication on the owner's explicit "publish".

[Release record and notes](docs/MAC_V054_RELEASE_2026-10-16.md). The eight-item post-release queue (P54-01…08) is unchanged. Historical entries below keep their original status.

## Final private v0.5.4 candidate accepted for local testing — 15 October 2026

**Independent review ACCEPTED within the selected administrator UID501 synthetic-data lane, through the containing PR's exact-head checks.** No blocking application defect found. Exact fbff255 candidate artifacts and installed executable matched; native screenshots/observer logs support corrected dates, automatic restart and foreground recovery. Independent checks:26 helper tests,57 focused tests and Cargo-lock passed. Offline verification confirms complete schema definitions, exact ledger coverage/checksums, retained ledger rows, seeded contents, PDFs, integrity and foreign keys.

**Schema12 disposition:** the one `daily_plan_session` difference is expected local-day rollover; it remains reported, not excluded or converted to an identical-rows verdict. No training record or document loss found. Standard-account, minimum-OS, VoiceOver, erasure/native-fault, Developer ID/notarization and public publication retain their unverified/deferred status. Gatekeeper assessment rejects the ad-hoc candidate. The owner profile is returned; no reviewer app launch/profile/key access occurred.

**Next:** owner local testing using the exact installed fbff255 path. No new build or implementation is required by this review. [Acceptance](docs/MAC_V054_FINAL_CANDIDATE_ACCEPTANCE_2026-10-15.md) · [local-use handoff](docs/MAC_V054_LOCAL_USE_HANDOFF_2026-10-15.md). The eight-item improvement queue remains unchanged and starts after v0.5.4. Historical entries below retain their original status.

## Final private v0.5.4 candidate (fbff255): installed verification complete in the UID501 lane — pending independent review — 16 October 2026

**BUILT AND VERIFIED ON THE INSTALLED CANDIDATE; PENDING INDEPENDENT REVIEW.** Uncommitted on `main` at `fbff255` (tree `713eb74f909367c72b31bdf3da0bf63301256dd1`). Administrator UID501, synthetic data only; not a standard-account pass.

- **Candidate:** `local-candidates/2026-10-15-v0.5.4-fbff255/`. DMG `1048e463…`, ZIP `7e55ccc7…`, executable `a809e7b1…`; 6/6 artifact checksums OK. Installed at `~/Applications/Her Flight Deck Verification fbff255/`.
  - **Gatekeeper:** `spctl` rejects it (exit 3). This is an ad-hoc seal only, not Developer ID or notarized.
- **Restores into the exact candidate:** populated schema 14, genuine schema 13 and genuine old-app schema 12 (`6845044f…`). Each restarted automatically, with an on-screen window within 0.5 s.
  - **Foreground recovery confirmed on these bytes:** with Claude confirmed frontmost while the new process ran (schema 13 and 12), the restored app brought itself forward 0.17–0.45 s later.
- **Offline comparisons:** retained rows, original schema, original ledger rows (all columns) and managed PDFs are identical. New migrations 13 and 14 have shipped checksums, success 1 and seed 15/15.
  - **One honest difference (schema 12):** the app regenerated the stale 2026-10-11 `daily_plan_session` for today after the restore. It is not excluded.
- **Date labels at 23:00 PDT (UTC already 16 October):** Added, Last reviewed, Settings safety copies and confirmation, and the Data Recovery list and confirmation all read "Thursday, October 15".
- **Quit:** Cmd-Q each time, with the process confirmed ended.
- **Your profile:** returned intact; the Gemini key was never read. No old binary opened, nothing deleted, no provider calls.

Not executed: erasure UI, VoiceOver, standard account/minimum OS, mid-save fault injection, signing and notarization. [Report](docs/MAC_V054_FINAL_CANDIDATE_REPORT_2026-10-15.md). The eight-item post-release queue (P54-01…08) is unchanged. Historical entries below keep their original status.

## Desktop corrections accepted; fresh final v0.5.4 candidate next — 15 October 2026

**Independent source review ACCEPTED, effective after the containing PR passes exact-head CI and merges.** DESKTOP-V054-01 (material dates), -04 (backup dates) and -03 (post-restore foreground activation) pass review with no blocking code findings. DESKTOP-V054-02 remains investigated/not reproduced; its original automation no-window outputs retain an unconfirmed cause. Independent gate9/9 exit0:44 focused,3,242 frontend/6 skipped,467 Rust/6 ignored, typecheck/build/fmt/Clippy/lock/hygiene clean. Submitted47 hashes and35 checksums matched; private test-build binary/signature matched read-only. Native evidence is one counted implementer focus run, not a new reviewer-installed test. [Acceptance](docs/MAC_V054_DESKTOP_CORRECTIONS_ACCEPTANCE_2026-10-15.md).

**Next:** [fresh private local v0.5.4 candidate and exact-candidate verification](docs/MAC_V054_FINAL_CANDIDATE_PROMPT_2026-10-15.md) from the containing PR's accepted merged main. Preserve e928601/fee7869/UNCOMMITTED artifacts. Original dirty implementation package remains intact. No new build, app launch/profile access, signing or publication was performed by this review. Remaining installed/platform gaps stay explicit; all eight selected improvements remain queued after v0.5.4, in the owner-approved order below. Earlier entries retain their historical status.

## v0.5.4 desktop corrections: 01, 03, 04 fixed; 02 not reproduced — pending independent review — 15 October 2026

**IMPLEMENTED (01, 03, 04) AND INVESTIGATED (02); PENDING INDEPENDENT REVIEW.** Claude, uncommitted (03 and 04 added on the owner's instruction to complete every fix found) on `codex/v054-desktop-corrections` (base `7f2a624`).

- **DESKTOP-V054-01, fixed:** Material detail "Added" and "Last reviewed" now show the local calendar day, via `localDayOf`, with an explicit fallback for unreadable values.
  - Rendered tests fail 4/5 on the old source.
  - Date suites pass 63/63 in UTC, Los Angeles and Kiritimati.
  - Full suite 3,232 passed; typecheck and build pass.
- **DESKTOP-V054-02, not reproduced:** two native restores (populated schema 14, then genuine schema 13 from a self-restarted process) each showed an on-screen main window within about 2 s, observed independently through the window server.
  - **Confirmed instead:** the self-restarted app is never activated (Tauri spawns the binary directly), so it can come back behind other windows.
  - The schema-13 restored data matched the earlier frozen restore exactly.
  - No app code was changed for 02.
- **DESKTOP-V054-03, fixed:** after a completed startup restore, `setup` shows and focuses the main window (`set_focus` activates the app). Refused, rolled-back and blocked restores are unchanged.
  - Rust: 467 passed, clippy `-D warnings` clean; two new outcome tests.
  - Native, separately labelled local build (`…-desktop-corrections-UNCOMMITTED`, ad-hoc, not a release candidate): with Claude confirmed frontmost while the restarted process finished the restore, the restored app became frontmost on its own about 3 s later, with an on-screen window throughout.
- **DESKTOP-V054-04, fixed:** Settings and Data Recovery list safety copies by the local day parsed from the UTC name (`backupLocalDay`), with an explicit unknown-date fallback. Rendered test fails 3/3 on the old source; seen natively as "Thursday, October 15" for copies named 2026-10-16.
- **Full checks after all fixes:** 3,242 frontend tests passed; typecheck, build and `git diff --check` pass.
- **Still open:**
  - **Six installed copies share the bundle ID**, including 0.5.3 in `/Applications`; launch by exact path only.

Not executed: the schema-14 restore data comparison and the schema-12 exact-candidate restore. The older-backup matrix is incomplete; tombstone UI, VoiceOver, standard account and signing remain open. The original profile was returned intact. [Report](docs/MAC_V054_DESKTOP_CORRECTIONS_REPORT_2026-10-15.md). Historical entries below keep their original status.

## Owner-approved improvement queue after v0.5.4 — 15 October 2026

**Owner decision:** add all eight [researched improvement options](docs/POST_V054_IMPROVEMENT_OPTIONS_2026-10-15.md), in the recommended order below, to the roadmap. **Start after the next v0.5.4 release.** Finish release corrections, independent review and the agreed candidate verification first; none of these improvements expands v0.5.4. Selection approves these product directions for the post-release queue; exact dependency versions, new storage contracts and provider integrations still receive their normal implementation/review checks.

| Order | ID | Approved outcome | Scope and completion criteria |
| --- | --- | --- | --- |
| 1 | P54-01 | Source links, bookmarks and continue reading | Reuse the existing M4 work/owner. Deliver reliable document/page destinations, named bookmarks and resume position, with original/split/printed-page coordinates distinguished and native Open fallback. Extend imported reference persistence through a reviewed contract with honest provenance. Then evaluate and integrate an offline embedded reader only once actual supported-Mac compatibility, bounded loading and licensing are demonstrated. Require stale-operation/content-replacement guards, restart and backup/restore coverage. |
| 2 | P54-03 | Clearer formatted study guides | Add controlled formatting for lists, emphasis, quotations and tables while preserving plain saved guides. Review the exact renderer/extensions; skip raw HTML, control links and remote images, and test offline, accessibility and supported WebKit behavior. A full rich-text editor is not part of this item. |
| 3 | P54-04 | Selective study export and printable handouts | Export chosen guides/cards/tests through the reviewed packet format, with a printable handout output. Verify export/validation/import content equivalence, answer keys, new import identities, historical attempt preservation and cancelled/failed saves. Keep full-library backups separate and do not include unrelated records or credentials. Reuse any reference-contract work from P54-01. |
| 4 | P54-02 | Search inside local PDFs and saved study content | First prove bounded text extraction/page identity and compare actual SQLite FTS5 availability with MiniSearch on realistic datasets. Then integrate the justified local engine with excerpts/page destinations, background cancellation, hash-based invalidation and restore/index rebuild behavior. Text-bearing PDFs first; explicitly identify unindexed scans. Measure native responsiveness, cold indexing and memory; do not infer performance from server-render timing. OCR remains separate. |
| 5 | P54-05 | Lesson brief and calendar export | Build a readable brief from existing lesson checklist, linked reading and deliberately selected questions/follow-ups; add manual .ics export. Verify event identity, local times/zones/DST, all-day and missing-time cases, cancellation/rescheduling, and chosen content only. This is file interchange, not two-way calendar synchronization or calendar-account access. |
| 6 | P54-06 | Adaptive flashcard scheduling | Evaluate FSRS against the working simple-v1 experience, then implement a reviewed, versioned transition that retains review history and native-authoritative writes. Verify reference vectors, clocks/timezones, repeat submissions, failures, regeneration and backup/restore. Direct candidate packages must satisfy existing repository-selection criteria or receive an explicit exception; choosing this feature does not silently waive the original1,000-star filter. Scheduling is not a proficiency or certification verdict. |
| 7 | P54-07 | Airport weather in lesson preparation | Review and integrate the official Aviation Weather Center METAR/TAF contract using bounded native requests/cache where appropriate. Show original report and issue/fetch times; test station identity, observation/forecast validity, no-data/rate-limit/outage/offline/stale states. Keep it lesson-preparation context, not a flight go/no-go decision. No training history or document upload. This queues the existing WX-01 direction; it does not authorize provider calls during release work. |
| 8 | P54-08 | FAA reference shelf and ACS links | Build a reviewed, versioned offline FAA reference shelf for the selected training path, then optional ACS links for skills/questions. Record publication identity, mapping provenance and refresh date; obtain knowledgeable human review before publishing mappings. Test missing/changed references and retained history. Coordinate the existing FAA-01/M3/M4 direction. M5 refunds and RQ-D1–D7 eligibility/requirements decisions remain separate. |

**Coordination:** preserve this order when writing the next feature assignment. Use existing M2/M3/M4/M5/M6 implementations and prototypes rather than duplicate systems. Each item gets a bounded assignment with meaningful tests and one consolidated correction handoff if needed. Reconcile in-flight M4 ownership before editing. Report any blocked substep and preserve the approved order when proposing its next action; do not silently reorder the queue or broaden scope. No feature has been implemented or tested by this roadmap decision. Earlier dated entries retain their historical status.

## Native v0.5.4 run completed; two follow-ups open — 15 October 2026

Owner authorized fresh synthetic data in this account, explicitly an **administrator-account UID501 test**. Actual e928601 candidate installed and launched. Save/restart, PDF picker/Open/chapter, genuine populated13→14 retention, current/older backup data restoration, Skills saves/history, cancellation, guarded-backup failure and damaged-archive refusal passed their bounded checks. **DESKTOP-V054-01:** Added/Last reviewed display the UTC day in the evening (confirmed P2). **DESKTOP-V054-02:** two restore self-restarts left no accessible window, although data restored; root cause unconfirmed, independent lifecycle/tooling investigation required. [Native report](docs/MAC_V054_DESKTOP_VERIFICATION_2026-10-15.md) · [one model-neutral correction prompt](docs/MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md).

**Next task:** fix01 and disposition02 with focused tests; then verify affected behavior on an independently identified corrected local candidate. Standard-account/hfdtest, exact-candidate schema12 restore, deliberate erased-observation/tombstone UI coverage, VoiceOver, minimum macOS, signing/notarization and publication remain unverified/deferred. Gatekeeper assessment rejected the ad-hoc candidate; normal local launch succeeded without a bypass. No full-release acceptance is claimed. App stopped; original synthetic profile/key preserved at the default root; other test profiles/backups recoverable locally. Historical entries below retain their original status.

## Fresh v0.5.4 local candidate accepted — 15 October 2026

**Independent review ACCEPTED for the private local lane, with report integration through exact-head CI in the containing PR.** The fresh candidate is built from frozen source **e9286017d3ca8b1faa1c8f5568c708d43e0b3050**, including PR167 and PR169. Independent review matched all candidate14/14 and earlier-candidate37/37 hashes, verified the local ad-hoc app/ZIP/read-only DMG contents and matching executable identity, reran26 helper tests plus lock checks and all17 browser scenarios. No application/version/dependency change was made by this report integration. [Acceptance and independent evidence](docs/MAC_LOCAL_V054_FRESH_CANDIDATE_ACCEPTANCE_2026-10-15.md).

Candidate folder: `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601/`. DMG SHA256: `7a93541a1fe7c9ccaa540deb8b164ac0ac09da8bc5c33b8ae1fed6755ad499b9`. Signature is **local ad-hoc only**, not Developer ID/notarized. The native candidate was not rebuilt or launched during review; oldfee7869 artifacts remain intact.

**Release position:** source/version preparation and the fresh local build/package/browser lane are complete. Desktop launch/install, standard-account use, installed populated-data upgrade and older-backup restore, native pickers/PDF flow, Gatekeeper and VoiceOver remain **UNVERIFIED/deferred**. Existing deferral persists; do not open another preparatory audit or launch a profile automatically. The next release action is an owner-selected installed/use lane when requested. Signing/publication remains deferred. M4 remains a separately owned prototype; M5 refunds/requirements decisions remain separate and unapproved.

## Fresh local v0.5.4 candidate built from e928601 — pending independent review — 15 October 2026

**BUILT AND VERIFIED WITHIN THE LOCAL LANE; PENDING INDEPENDENT REVIEW.** Claude, uncommitted on report branch `codex/local-v054-fresh-candidate`. Frozen source `e9286017d3ca8b1faa1c8f5568c708d43e0b3050` (PR #167, including PR #169). One `aarch64-apple-darwin` app was built with `--bundles app` (exit 0, 59 s), then sealed ad-hoc on a staged copy and packaged once through the recorded bounded lane. The DMG was created in 4 s with no stall, inspected read-only and detached.

- **Candidate:** `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601/`.
  - DMG SHA-256 `7a93541a…d499b9`;
  - ZIP `068695bf…decf47`;
  - final executable `b60d2e6c…848822`.
- **Status:** LOCAL_ADHOC, private test only. No Developer ID, notarization or Gatekeeper claim.
- **Checks:**
  - helper tests 26/26 on the new ARM64 output;
  - Cargo lock check passes;
  - RUNBOOK component replay 12/12 (helper on baseline `16f9cf3` only);
  - browser QA 17/17, including both medical-date directions and nothing written before a choice;
  - frontend 3,221 reused from the identical accepted tree.
- **Preserved:** the `fee7869` candidate still verifies 37/37 and was not relabelled.

[Report and reviewer handoff](docs/MAC_LOCAL_V054_FRESH_CANDIDATE_REPORT_2026-10-15.md). Desktop launch, installation, hfdtest, installed upgrade and restore, Gatekeeper, VoiceOver, signing and publication remain UNVERIFIED/deferred. Historical entries below keep their original status.

## v0.5.4 source preparation and QA tooling accepted — 15 October 2026

**Independent review ACCEPTED for exact-head CI/integration in PR #167.** QA-01 and QA-02 are closed in source: real ARM64 Cargo output is recognized with its strict shape/link/tracked-file guards, and helper replay permits only the two synchronized root application-version fields. The five version files consistently declare **0.5.4**, with no dependency change. PR #169's flight-time/medical fixes are included and unchanged. [Acceptance](docs/MAC_LOCAL_V054_QA_ACCEPTANCE_2026-10-15.md).

Independent combined verification: **26 helper tests passed / 0 skipped**, **3,221 frontend passed / 6 skipped**, typecheck, frontend build and Cargo-lock checks pass. The submitted corrected helper replay passes all **12 stages**, with all 15 walker cases; refreshed combined replay/CI identities are recorded in the containing PR closeout. Historical failure receipts and original submission manifests remain snapshots, not claims about later tracker bytes.

**Next task:** [fresh private local v0.5.4 candidate from the accepted merged source](docs/MAC_LOCAL_V054_FRESH_CANDIDATE_PROMPT_2026-10-15.md). The existing fee7869 app/ZIP/DMG remains hash-identical and predates PR169; no new native candidate was built by this review. Freeze the containing PR's merged source before a new build; preserve older artifacts. The earlier automatic DMG stall remains unexplained and requires truthful receipts if repeated. Current authorization remains local unsigned/ad-hoc plus automated/browser testing; desktop launch, hfdtest, signing credentials/notarization and public publication remain deferred. M4 prototype and M5 policy/requirements decisions remain separate.

## Local v0.5.4 QA-01/QA-02 tooling corrections — pending independent review — 15 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Claude, uncommitted on `codex/local-v054-build-check` (HEAD `93a88df`), per the [QA follow-up prompt](docs/MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Scripts and docs only; no application source, dependency, migration, version, signing or native-artifact change.

- **LOCAL-V054-QA-01:** the build-output recognizer now accepts the one supported cross-target folder, `src-tauri/target/aarch64-apple-darwin`, only in Cargo's exact shape: its own single-linked cache tag and real `debug`/`release` profiles. Unknown or lookalike target names, stray entries, symlinked folders or profiles, missing, invalid, symlinked or hard-linked tags, and tracked paths inside build output still refuse. The original 11 walker scenarios are kept, with 4 added.
- **LOCAL-V054-QA-02:** the post-merge replay now permits only the two synchronized application-version fields in `package-lock.json`, decided by the tested `compareDependencyLock` before any worktree is created. An identical lock passes as before. The replay still installs the baseline lock on the immutable `16f9cf3` baseline and certifies only the helper component.

Measured results, the check-only replay of the new bytes and preserved original failures: [reviewer handoff](docs/MAC_LOCAL_V054_QA_FOLLOWUP_HANDOFF_2026-10-15.md). The automatic DMG stall stays a separate, unexplained observation. Installed tests, desktop launch, hfdtest, signing and publication remain deferred. Historical entries below keep their original status.

## Local v0.5.4 build tested; tooling follow-ups open — 15 October 2026

A provisional local ARM64 v0.5.4 test artifact was built from clean version-only commit `fee7869` (accepted functional parent `f2a7090`). Staged ad-hoc app and private DMG verified read-only, hashes matched, image detached. Automated results: frontend 3,202 passed / 6 skipped; native Mac Rust 465 / 6 ignored; 12 browser routes and 13 functional scenarios passed. No installed app/profile/hfdtest use; desktop launch remains deferred by the owner's current choice.

**Open:** LOCAL-V054-QA-01, helper suite 22/23 because genuine `target/aarch64-apple-darwin` output is classified as unexpected; LOCAL-V054-QA-02, replay recipe refuses version-only package-lock metadata. The automatic Tauri DMG phase stalled once; manual local image creation/verification succeeded, cause unconfirmed. Do not call the whole gate green or silently weaken/delete fixtures. Version configuration is prepared on `codex/local-v054-build-check`, not yet integrated into main. [Build report](docs/MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md) · [precise next-model task](docs/MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md).

Next: independently review version/evidence and complete the bounded tooling follow-up; preserve the test artifact. Public release/signing, installed tests, M4 production and unapproved requirements remain separate/deferred. Historical entries below describe their original checkpoints.

## Sweep follow-ups accepted; next release work — 15 October 2026

**Independent source review ACCEPTED for exact-head CI/integration in the containing PR.** SWEEP-1014-TIMES and SWEEP-1014-MEDICAL, including SWEEP-R1, pass re-review. The original seven-case diagnostic passes unchanged; independently rerun frontend: **3,221 passed / 6 skipped**, typecheck and production bundle pass. [Acceptance and evidence](docs/SWEEP_FOLLOWUPS_ACCEPTANCE_2026-10-15.md). Earlier submission/review receipts remain historical and unchanged. Installed Mac behavior remains unverified/deferred.

**Current roadmap position:** M1 daily planning and M2 study/review source work are delivered; the first M3 skills/evidence slice is delivered. This sweep completes the two historical flight-time/medical-conflict follow-ups after the containing PR passes exact-head CI and merges. M4 viewer/navigation remains an unshipped evidence prototype with separate ownership. M5 cost analytics have a delivered first slice; refunds/credits and requirement decisions RQ-D1–D7 remain open. No additional requirement implementation or provider adoption is authorized by this acceptance.

**Next priority:** resolve QA-01 (real Apple Silicon Cargo target output rejected by the schema14 helper) and disposition QA-02 (version-only lockfile replay restriction), using the [existing model-neutral follow-up in PR #167](https://github.com/rickydeleon49-ui/Flight-training-/blob/codex/local-v054-build-check/docs/MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Preserve its build/failure evidence and check for an existing owner before editing. PR #167's provisional local ad-hoc v0.5.4 artifact predates this sweep: it does not contain these new fixes. Its CI passed, but tooling findings, independent version review and the exact final candidate source remain open. Do not merge it or rebuild solely because this sweep is accepted. Desktop launch/hfdtest, Apple signing/notarization and public publication stay deferred.

## SWEEP-1014-TIMES and SWEEP-1014-MEDICAL implemented — 15 October 2026

**IMPLEMENTED; SWEEP-R1 CORRECTED, PENDING INDEPENDENT RE-REVIEW.** Claude, uncommitted on branch `claude/sweep-followups-2026-10-15` (base `f2a7090`). [Report](docs/SWEEP_FOLLOWUPS_REPORT_2026-10-15.md) · [review (changes requested, #168)](docs/SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md) · [SWEEP-R1 correction](docs/SWEEP_FOLLOWUPS_CORRECTION_R1_2026-10-15.md).

- **SWEEP-1014-TIMES:**
  - the Flight log and each entry now point out saved flights whose times don't add up, with a "Correct times" link;
  - the times are never changed and still count in the totals, which the hour reference says.
- **SWEEP-1014-MEDICAL:**
  - when Settings and her latest medical record disagree, the Certificates tab asks which date matches her certificate, and only her choice updates the other record;
  - only the first choice is accepted while it saves, and a choice made against dates that have since changed writes nothing (SWEEP-R1);
  - Settings and the reminders say the dates differ;
  - an earlier medical kept as history is not treated as a conflict.

There is no schema, migration, backup or dependency change. M5-COST-REFUNDS and PIPE-161-01 remain open.

## Schema14 package accepted; F1–F3 follow-up — 15 October 2026

The independently reviewed package merged unchanged in [PR #165](https://github.com/rickydeleon49-ui/Flight-training-/pull/165) at `8450526` after exact-head CI run 38803089531 passed (3,202 frontend / 464 Rust; original skips/ignores retained). F1–F3 are a separate non-blocking follow-up: precise Linux helper CI step, [canonical post-merge reproduction](docs/evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md#7-post-merge-source-only-reproduction-f2), and named full-self-check refusals with a meaningful regression. Helper tests now 23/23, zero skips; schema14 self-check remains 102/102. Final exact-head CI and reproduction identities are recorded with the follow-up PR closeout and [report](docs/MAC_SCHEMA14_FOLLOWUP_F1_F3_2026-10-15.md).

No pin, overlay allowlist, production comparison rule, migration or frozen evidence changed. Earlier pending-review entries below are historical. Next: exact-head CI/integration of this follow-up, then local unsigned v0.5.4 source/version preparation. Installed hfdtest, signing/publication and packaged Mac checks remain deferred; primary and separately owned work remain untouched.

## Schema14 preparation completed for review — 15 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** The saved REL-01 / MAINT-143-KEYS package is recovered onto accepted main `16f9cf3` in `codex/schema14-verification-completion` at `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`. Original saved hashes verified 10/10 and evidence checksums 4/4; original worktree preserved. Current focused checks: 117 Vitest, 21 helper tests, proof 12/12 (schema14 self-check 102/102), typecheck and Cargo-lock pass. The intentional historical schema13 ceiling alarm remains. Current inventory/evidence and exact review steps: [reviewer handoff](docs/MAC_SCHEMA14_COMPLETION_REVIEWER_HANDOFF_2026-10-15.md).

The proof binds the repository overlay to `16f9cf3` while retaining the immutable `8a260c0` schema contract and unchanged migrations/fixtures. Source-only synthetic evidence does not close installed gates. Next action: independent review/CI/integration, then the selected local unsigned v0.5.4 source/version preparation. hfdtest, signing/publication and M4 production remain deferred/separately owned. No commit, push, build or profile access. Older entries below retain their historical status.

## Claude work consolidation — 14 October 2026

Independent review accepts the nine-defect bug sweep, the first M5 cost-analytics slice, material-level Again clock refresh, screenshot routing and timezone-test maintenance in this consolidation. Completion below is effective when the reviewed consolidation passes exact-head CI and merges; no installed Mac or signing result is claimed. [Review and verification](docs/CLAUDE_WORK_CONSOLIDATION_REVIEW_2026-10-14.md). Original submissions and the primary's unpublished notes have recoverable local snapshots; prior tracker history remains below.

| Item | Outcome / next action |
| --- | --- |
| Bug sweep, nine source defects | Accepted: local-calendar backup age/name; unambiguous history dates; changed-flight-time consistency; finite toolkit defaults/shared reminder bounds; same-date medical deduplication; positive lesson expenses; cancellation-estimate refusal; short-date year suffix. Meaningful regressions retained. |
| M5 cost analytics, first slice | Accepted: one lesson per linked expense group; paired lesson cost/logged hours; visible possible-double-count warning; six-month expense table; one-off spending excluded from hourly extrapolation. M5 remains partial. |
| MAINT-143-TZ / SWEEP-1014-TZ-CI | Accepted: exact TZ restoration and literal boundary cases; backup filename test explicitly uses Los Angeles even under UTC CI. Relevant tests verified in UTC, Los Angeles and Kiritimati. MAINT-143-KEYS remains with schema14 preparation. |
| CI-161-01 | Corrected: rendered tests await observable real crypto/SQLite completion without advancing the review clock, rather than 20 fake-timer turns. New delayed-digest regression catches the old wait; production display-only clock behavior is retained. Prior failed CI remains linked in the review. |
| Screenshot helper | Accepted: HashRouter URLs, collision refusal, rendered-route checks and truthful OS-dark naming; no product dark theme added. |
| M5 requirements | [Proposal published](docs/M5_REQUIREMENTS_SCOPE_PROPOSAL_2026-10-14.md), **not approved for implementation**. RQ-D1–D7 still require owner decisions; rule data requires knowledgeable human review. Instrument totals and recent dual time cannot establish specific training-purpose evidence. |
| SWEEP-1014-TIMES | Accepted for integration in the containing PR: read-only affected-entry warnings and correction links; saved values and totals preserved, reference caveat retained. |
| SWEEP-1014-MEDICAL | Accepted for integration in the containing PR: explicit authority choice, synchronous pending protection, fresh-state validation and failure/retry coverage; no reconciliation on load. |
| M5-COST-REFUNDS | Pending model decision: define refunds/credits and their effect on totals, paired rates and trends, then add repository/UI/restore regressions. Unlinked journal hours and period-specific cost rates remain explicit later scope. |
| PIPE-161-01 | Pending external-controller work: bounded failed-CI repair dispatch, durable duplicate/two-attempt guards, fresh source-hash approval and green exact-head checks before merge. Keep this local tooling outside application source; no controller restart or automation is performed here. |

**Next release priority (superseded by October 15 review submission above):** complete the existing [saved schema14 corrections](docs/MAC_SCHEMA14_UNMERGED_CONTINUATION_2026-10-12.md), including own-key-safe metadata proofs and final measured inventories; independently review/integrate them, then prepare the approved [local unsigned v0.5.4 candidate](docs/MAC_LOCAL_UNSIGNED_V054_CONTINUATION_PROMPT_2026-10-14.md). Version files still say 0.5.3. Apple signing/public distribution and hfdtest remain deferred; M4 stays separately owned. WX-01/FAA-01 provider approval and M5 requirements decisions are not inferred from this review/merge authorization.

## Mac release completion track — updated 14 October 2026

**Owner decision — 14 October 2026: proceed with a fresh local unsigned/ad-hoc v0.5.4 test candidate.** Preparation and local candidate building are authorized after the remaining source corrections pass review. Apple Developer membership, Developer ID signing and notarization are deferred until the owner requests that route; they do not block this local candidate. Public publication and automatic installed/profile testing are not authorized by this decision.

[Decision and boundaries](docs/MAC_LOCAL_UNSIGNED_V054_OWNER_DECISION_2026-10-14.md) · [Complete model-neutral continuation assignment](docs/MAC_LOCAL_UNSIGNED_V054_CONTINUATION_PROMPT_2026-10-14.md). Keep the existing single coordinator and implementation ownership; the version choice v0.5.4 is settled.

[Historical public-release readiness review](docs/MAC_RELEASE_READINESS_REVIEW_2026-10-12.md). Current main at the route decision is `cb0ece14239e4bacbd845642329ba47e98fe1d13`; the [independent review in PR #158](https://github.com/rickydeleon49-ui/Flight-training-/pull/158) covers merged #154/#155/#157. Current main ships M3/schema14 and still declares version 0.5.3. The installed evidence in PR #142 covers older schema12→13 candidates. The frozen September v0.5.3 draft is not the new local candidate.

**Claim one existing task owner before editing.** Continue saved schema14/M4 work rather than starting duplicate runs. Coordinate overlapping metadata fixes through one owner. Preserve the dirty primary roadmap/continuation, all frozen evidence and other agents' work. Mark an item complete only after its evidence is reviewed and, where applicable, integrated.

| Item | Current status / dependency | Agent task and completion evidence |
| --- | --- | --- |
| REL-01 — current-schema verification | Active saved work; unmerged/unaccepted | Continue [schema14 preparation](docs/MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md). Finish the proof walker's bounded build-infrastructure classification and sensitivity checks, current execution summaries and final source manifests/checksums. Preserve passing tests and original failures; do not fabricate missing pre-edit observation. Provide reviewed schema13→14 upgrade and older-backup restore proofs covering all M3 tables and retained records/files. |
| REL-02 — maintenance integration | MAINT-143-TZ accepted in this consolidation; MAINT-143-KEYS remains with REL-01 | Preserve the integrated timezone-test correction and correct production date semantics. Finish the own-key-safe metadata map and real SQLite/JSON/strict-comparison special-key regressions under the existing [maintenance assignment](docs/MERGED_PR_DATE_METADATA_FIXES_PROMPT_2026-10-12.md). Update the older queue below only after actual acceptance. |
| REL-03 — dependency alert triage | `source-map-js` fixed by merged #154 and independently reviewed; medium `glib` alert #1 still open | Preserve the accepted source-map-js correction; finish the reviewed disposition of [glib alert #1](https://github.com/rickydeleon49-ui/Flight-training-/security/dependabot/1). Record development/runtime and platform applicability; the locked Apple Silicon graph has no glib dependency path. Apply justified compatible corrections with relevant regression checks, or document the reviewed disposition. Do not infer a demonstrated Mac exploit or blindly force a transitive major upgrade. |
| REL-04 — version and release scope | Accepted: source frozen at e928601, all five version files0.5.4, QA fixes integrated in PR167 | Preserve that source/artifact identity; report-only commits do not change the built candidate. Older v0.5.3 and fee7869 artifacts remain frozen. |
| REL-05 — signing/notarization lane | DEFERRED by owner on 14 October; not a prerequisite for the local unsigned candidate | When the owner later requests signed distribution, follow [conditional release continuation](docs/MAC_RELEASE_CONTINUATION_PROMPT_2026-10-04.md) and [accepted preparation](docs/MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md). Obtain owner lane approval and securely provision Developer ID/notarization credentials. Review/activate the bounded workflow; retain manual/main guards, private artifact boundary, cleanup/error handling and Windows hold. Actual signatures, hardened runtime, timestamps, notarization and stapling must verify; proposal tests are not signing results. |
| REL-06 — one private current candidate | Complete within the private local lane: fresh e928601 app/ZIP/DMG independently verified | Use the accepted e928601 candidate identity above.17 browser scenarios and26 helper checks passed; local ad-hoc only. No installed, Developer ID or public-release claim. |
| REL-07 — exact-installer installed verification | After REL-06; existing hfdtest deferral persists and this route decision does not launch a profile | For a later owner-authorized installed run, test the exact intended Apple Silicon installer: record normal installation/launch and actual Gatekeeper behavior without bypasses; Developer ID/notarization acceptance remains deferred for the unsigned lane. Cover relevant Study Library/M3/history features; PDF import/open/reveal and splitting; populated-data upgrade to schema14; older-backup restore and safe newer-backup refusal. Verify retained records/files and record hardware/macOS/source/run/artifact identities. Prior schema13 tests cannot substitute; source tests cannot be relabelled installed PASS. |
| REL-08 — remaining recovery/isolation acceptance | Standard-account and mid-save/post-receipt cases unresolved | Supply real isolated-lane and recovery evidence. If a packaged fault seam is unavailable, record the case as blocked and obtain a separately reviewed scope decision or equivalent evidence; do not suppress it or invent physical success. The former administrator-account authorization covers its recorded run, not automatic access to the everyday profile for this candidate. |
| REL-09 — publication | DEFERRED; no public release, tag or release draft authorized for the current local test route | Follow the [release review process](docs/RELEASE_REVIEW_PROCESS.md). Verify checksums, version and release notes, then publish the same tested bytes. Any rebuild changes the candidate and requires its own verification. Keep Windows on its separate held pathway; do not attach unapproved Windows installers. |

**Scope and pace:** M4 is still an unshipped evidence prototype with its own [R28–R32 assignment](docs/M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md). It can remain outside the current Mac release; finishing the entire roadmap is not a prerequisite for shipping accepted features. Do not expand release scope to M4 without its separate acceptance/owner decisions. Reuse valid source/CI evidence and run checks proportional to the changed area; avoid overlapping full matrices.

**Current progression:** finish/review REL-01–03 and prepare the selected v0.5.4 source/version configuration through REL-04; freeze the accepted source and produce the authorized local unsigned REL-06 candidate. Supply the owner with the exact artifact identity and human test steps. REL-07–08 remain honestly unverified until an authorized installed run; REL-05 and REL-09 wait for the owner to request signed distribution/publication. Agent handoffs must name the completed item, remaining dependencies, exact evidence and next owner/agent action. Existing roadmap entries below are historical where superseded by current acceptance.

## Active M4 continuation after historical review reconciliation — 12 October 2026

Use the [current independent review](docs/M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md) and [round-4 correction assignment R28–R32](docs/M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md). PR #148 preserves the earlier round-2 findings and round-3 prompt as history; it does not reactivate them or accept M4 production.

Before restarting agents, check for an existing M4 owner/run and continue that saved work rather than launch a duplicate. The owner chooses the implementer for each new run. Preserve retained corrections, frozen evidence and protected checkouts. Resolve concurrent durable ownership, abort/pending-save behavior, stale callback publication, truthful execution receipts and complete mutant/count traceability according to R28–R32. Reviewers require actual named passing regressions and final measured manifests; do not reopen retained fixes without new evidence.

M4 stays evidence-only, OD-1–OD-10 stay proposed, and installed/signing/release gates stay deferred. The separate [merged-PR maintenance assignment](docs/MERGED_PR_DATE_METADATA_FIXES_PROMPT_2026-10-12.md) remains queued; coordinate its metadata-key item with the schema14 preparation owner to avoid duplicating work. No new agent run or production integration is authorized merely by these documentation notes.

## Queued merged-PR maintenance — 12 October 2026

**Owner-authorized; pending implementation.** Complete the two confirmed PR #143 findings before claiming this maintenance work finished. They are separate from Gemini's current M4 correction task.

| Item | Confirmed finding | Required acceptance |
| --- | --- | --- |
| MAINT-143-TZ | Date tests assume noon UTC has the same date in every local zone. Under Pacific/Kiritimati, 3/7 helper cases and 1/3 practice-history cases fail although production conversion is correct. | Control both test suites' time zones explicitly; retain a meaningful local/UTC boundary case; relevant date/Notes/history suites pass under UTC, Los Angeles and Kiritimati. |
| MAINT-143-KEYS | The snapshot helper's plain object map drops a valid `__proto__` SQLite metadata key: one database row yields zero own digest keys and verification refuses. | Use an own-key-safe map; real SQLite/JSON round-trip and unchanged/restore coverage for `__proto__`, `constructor`, `toString` and Unicode; changed/added/removed non-receipt keys remain protected. |

[Complete model-neutral implementation assignment](docs/MERGED_PR_DATE_METADATA_FIXES_PROMPT_2026-10-12.md). MAINT-143-KEYS is already part of [schema14 verification preparation](docs/MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md): claim one owner and reuse that correction if underway. Preserve the historical schema13 ceiling alarm, frozen evidence and exact three-key restore-only exclusion policy. No application build/install/profile/signing/release work is authorized by this queue entry. Earlier roadmap entries below retain their original historical status.

## M3 production implementation reviewed and completed — 11 October 2026

The authorized first production slice is complete: migration 14, native/TS/browser transactions and restore guards, skills/debrief UI, history and explicit follow-up/status/confidence. Codex took over the interrupted implementation at the owner's request, fixed confirmed retry/draft/provenance/navigation defects, completed the browser-driver checks, strengthened two masked history-cursor regressions and finished evidence/benchmarks. Final local gate receipts and integration conditions are in the [review and completion report](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_REVIEW_AND_COMPLETION_2026-10-11.md). GitHub merge requires required checks for the exact published head.

M3-D1–D9 approval persists; shared accepted fixtures, shipped migrations and dependencies are preserved. M4 remains separately assigned preparation with OD-1–OD-10 proposed. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; this is source-level work, not installed/signing/release acceptance. [Next model-neutral reviewer handoff](docs/M3_COMPLETION_NEXT_REVIEWER_PROMPT_2026-10-11.md).

## M3 production slice authorized — 11 October 2026

**Owner-approved M3-D1–D9 as written.** The owner approved the implementation task after independent corrected-scope acceptance. [Decision record](docs/M3_SKILLS_EVIDENCE_OWNER_APPROVAL_2026-10-11.md); [one active model-neutral production assignment](docs/M3_SKILLS_EVIDENCE_PRODUCTION_START_PROMPT_2026-10-11.md). Both former conditional gates are satisfied; earlier PROPOSED/pending-approval entries remain historical.

Implement one complete native/TypeScript/UI slice from current main in an isolated worktree, preserving the primary and preparation checkouts and parallel M4 work. Copy accepted fixtures, retain reviewed recovery contracts, and leave the implementation uncommitted/unpushed for independent review. No production code is implemented by this approval publication. G1–G3 remain deferred/unexecuted/unverified; M4, installed testing, signing and release are separate.

## M3 corrected scope/prototype accepted — 11 October 2026

**Preparation ACCEPTED; production awaits owner approval of M3-D1–D9.** M3-R8–R10 closed: independent 192 prototype tests / 3 opt-in skips, strict typecheck, 8 native tests, 7 TS/UI + 2 native frozen diagnostics, all exit 0; 7 independently sampled decisive reversions caught. 190 submitted hashes / 57 latest and 60 current-scope checksums / 7 document hashes / 30 anchors verify. Earlier correction history remains preserved.

- [Acceptance](docs/M3_SKILLS_EVIDENCE_SCOPE_ACCEPTANCE_2026-10-11.md).
- [Nine proposed defaults](docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md); [conditional production assignment](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md) activates only after owner approval.
- No production migration/dependency/app source change; candidate0014 unregistered. Native production writer/readers unbuilt; UI evidence jsdom. G1–G3 deferred/unexecuted/unverified. Both dirty worktrees preserved.

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

**11 October delivered first production slice:** the 15 built-in/custom catalog, deliberately attributed debrief observations, append-only paged history, deletion snapshots and irreversible erasure, explicit follow-up links/addressed choice, and separate status/confidence now have native, TypeScript, browser and UI implementations. [Completion review](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_REVIEW_AND_COMPLETION_2026-10-11.md) records the gate and exact GitHub integration conditions. ACS mappings, automatic extraction, verified-instructor input and flight-proficiency recommendations are not added by this slice. Installed G1–G3 remain deferred/unexecuted/unverified.

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
