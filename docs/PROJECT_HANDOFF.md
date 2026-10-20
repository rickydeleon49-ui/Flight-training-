## OFFLINE-03a round-7 correction locally GREEN; exact-head CI required — 19 October 2026

Qwen implements; Codex independently reviews/tests, loops corrections and integrates after green CI on the exact current head. The owner has authorized this ongoing workflow and gated merges; no repeated workflow sign-off is needed. Tool sandbox boundaries still apply.

Before merging PR #237, Codex reproduced an already-absent journal case and returned it to Qwen. The corrected provider now distinguishes confirmed absence from a present or unreadable journal and preserves immediate failure/retry on rejected acknowledgement. Code: `d6ce015`. **166 focused and 3,927 full frontend tests passed / 6 skipped; typecheck/build/lock/whitespace pass.** Two new cases fail against prior published `72f2be2`. Prior failed runs and cancelled superseded CI are preserved. [Current acceptance report](OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md).

**Integration:** PR #237 replaces closed draft #236. Wait for green CI on its corrected exact head, merge with a head-match guard, and verify main inclusion. Then start isolated **OFFLINE-03b practice-question authoring** from accepted main; a bounded implementation-plan assignment is prepared. Keep 03c deferred, extraction/search dormant and existing release/installed/performance gates open. Entries below are history.

## OFFLINE-03a local source review GREEN; Qwen implements, Codex reviews and integrates — 19 October 2026

**Current owner workflow:** Qwen implements; Codex independently reviews and tests, loops corrections, and merges only after accepted work and green CI on the exact submitted head. This supersedes earlier role defaults for this roadmap tranche.

The final acknowledgement/restart correction is committed as `9d3a90c` on `claude/offline-03a-core-fixes`. The reviewed operation now survives rejected or false journal acknowledgements and is cleared only after successful acknowledgement. Four new integration regressions fail against Claude's original source and pass after the correction. Fresh checks: **164 focused; 3,925 full frontend passed / 6 skipped; typecheck/build/cargo-lock/whitespace exit 0**. Unchanged native receipts remain **844 passed / 11 ignored**. [Source acceptance and integration handoff](OFFLINE_03A_SOURCE_ACCEPTANCE_2026-10-19.md); [evidence](evidence/offline-03a-2026-10-19/README.md).

**Integration rule:** this branch replaces draft #236. GitHub records its exact-head CI/merge state; no merge before those gates pass. **Next after verified merge: OFFLINE-03b manual practice questions**, then homework → exports. 03c remains deferred; extraction/search dormant; existing flake, performance and installed/minimum-spec release gates stay open. Entries below are history.

## OFFLINE-03a implemented locally (Claude); Codex review and exact-head CI pending — 19 October 2026

**Role change.** At the owner's request, Claude took over OFFLINE-03a from Codex. Claude reviewed PR #236's authoring core locally (round 1 RED: an instructor correction could be relabelled and exported by default; three minor findings) and fixed all four. The owner approved proposal revision 5: ordinary rewrites also enter the retirement list. Branch: `claude/offline-03a-core-fixes`, which supersedes #236. [Report](OFFLINE_03A_REPORT_2026-10-19.md); [reviewer prompt](OFFLINE_03A_REVIEWER_PROMPT_2026-10-19.md).

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

**Review state:** Codex round 1 was RED (the regeneration-review save could lose choices or apply twice; restore missed a stale check). Both are fixed, with failing-first regressions. **Where to resume, and the 03b plan:** [handoff](OFFLINE_03A_HANDOFF_2026-10-19.md).

**Next:** full local gate, Codex round 2, then one push for exact-head CI and a PR (closing #236 as superseded); then 03b practice questions. The FLAKE-CR-01, 02c p50, extraction/search and installed/minimum-spec gates remain open. Entries below are history.

## OFFLINE-03a authoring rules implemented; persistence/editor still pending — 19 October 2026

PRs #234 and #235 were reviewed/revalidated under the owner’s direct merge request and merged with green exact-head CI (`4ff7c9d`, `fc3ef34`); author review was disclosed rather than represented as independent-model approval. The first bounded OFFLINE-03a implementation is on `codex/offline-03a-authoring-core`. It prepares immutable add/edit/correct/delete plans with prior logical content retained, stable IDs/source pages, retirement overflow refusal, exact/near-match review, truthful origin labels and private-by-default instructor export selection. **55 focused cases pass; full frontend 3,835 passed / 6 skipped with zero unhandled errors, and typecheck/build/hygiene pass.** This is an in-process core, not a raw parser, persisted history or finished manual-editing feature. No production screen imports it and no migration/release flag changed. [Report](OFFLINE_03A_AUTHORING_CORE_REPORT_2026-10-19.md); [reviewer assignment](OFFLINE_03A_AUTHORING_CORE_REVIEWER_PROMPT_2026-10-19.md).

**Next:** review the core, then the remaining coupled 03a migration/browser-native persistence, canonical-origin/backup parity and editor/history/regeneration/export integration. Preserve the owner’s five approved defaults. Complete and review 03a before 03b manual practice questions; 03c remains deferred. Then homework → exports. Do not mark OFFLINE-03a complete or expose a partial writer. Existing release/installed/pressure gates remain open; earlier entries below are history.

## App audit and polish: four source/browser corrections pending review — 19 October 2026

A bounded audit of ten app screens at desktop/narrow widths and synthetic material creation reproduced the clipped Gemini confirmation **Cancel** (V057-UI-01), long progress-text overflow, every-second live-status updates and dangling form hint references. Shared layout/accessibility corrections and regression coverage are supplied on `codex/app-polish-audit`, based on accepted main `fdbf290`; no unmerged PR #234 code was copied. [Audit and reviewer handoff](APP_POLISH_AUDIT_2026-10-19.md); [evidence](evidence/app-polish-audit-2026-10-19/README.md).

**V057-UI-01:** source/browser fix supplied, independent review/CI and installed verification pending. The final bundled-font recheck passes twenty routes, five dialog layout cases and two short-window keyboard cases, with no fixture sends on Cancel. The original failing regression and first gate receipts are preserved. Native code, schemas, dependencies and release flags are unchanged. Final gate: **3,778 frontend tests passed / 6 skipped, zero unhandled errors**; typecheck/build/whitespace exit 0.

**Still open:** V057-DB-01 (classify sidecars safely), REL-CI-01 (release timeout), FLAKE-CR-01, saved-search p50 miss, extraction/search release gates and installed/minimum-spec verification. PR #234’s separate approved proposal/search-link correction still needs review. Resume OFFLINE-03a → 03b after accepted planning integration; then homework → exports. Nothing merged, enabled or released by this audit. Entries below remain historical.

## Current offline-study handoff: OFFLINE-03 defaults approved; search-link recovery pending review — 19 October 2026

PRs #231 (native document search), #232 (search UI) and #233 (saved-content search) are merged; accepted main for this handoff is `fdbf290`. Earlier “ready for PR” entries below are history. Extraction/search remain dormant in release builds.

Claude’s OFFLINE-03 proposal revision 3 received a saved **GREEN** review before usage ran out. The owner subsequently explicitly approved **all five recommendations**: additive migration 0016, Keep my items, enabled manual editing after acceptance, deferred passage quotes, and packet v1 with provenance-loss disclosure. Revision 4 records those decisions and defines atomic refusal at retirement entry 2,001, with no eviction or draft loss. No OFFLINE-03 feature or migration is implemented yet. [Proposal](OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md); [completion report](OFFLINE_03_COMPLETION_HANDOFF_2026-10-19.md); [next implementation assignment](OFFLINE_03_IMPLEMENTATION_PROMPT_2026-10-19.md).

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

**Owner requested finishing current work, then pausing. No further roadmap task or merge now.** [Latest self-review and pause report](OFFLINE_02A_SELF_REVIEW_AND_PAUSE_2026-10-19.md); [resume/reviewer prompt](OFFLINE_02A_FINAL_REVIEW_RESUME_2026-10-19.md); [budget owner decision](OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md). Codex authored these corrections, so independent acceptance remains pending.

Closed the reproduced missing/changed-trigger validation defect and the after-hash stamp race. Background initialization now reports `index_preparing` before admitting search, distinguishes failed initialization and supports retry/cache replacement. Final native tests: **813 passed / 11 ignored**; strict lint/format/lock/source checks pass. Unchanged frontend evidence (3,728 passes) is reused.

The owner explicitly approved cold 10k ≤750 ms and added index ≤3× canonical text. Final measurements: **588.53 ms**, **1.693×–2.663×**; both amended criteria pass. All 90 exact hit sets/capped prefixes and 4,050 timed searches pass without errors. Warm p95: 15.39 ms at 10k / 38.20 ms at 30k; concurrent 13.78 ms. Original 300 ms/1× failures remain historical evidence. The original 30k ≤1 s or background-before-search rule remains; no proposed 3-second replacement was adopted.

**OFFLINE-02A-COLD/STORAGE:** closed against the documented owner-approved criteria, subject to independent verification. **OFFLINE-02A-REVIEW:** next when the owner resumes; inspect Codex's work, then normal PR and exact-head CI before any merge. Only after accepted integration: 02b search UI/navigation (handle `index_preparing` explicitly) → 02c saved study content → homework → exports. Offline release flags remain off; installed/minimum-spec/pressure gates remain unverified. Do not resume automatically. Earlier entries below are preserved history.

## OFFLINE-02a native implementation complete; acceptance budgets open — 19 October 2026

Codex completed Claude's quota-interrupted cache/search work in the existing `Flight-training-offline-01` worktree on `codex/offline-02a-completion`. [Report](OFFLINE_02A_COMPLETION_REPORT_2026-10-19.md), [independent reviewer handoff](OFFLINE_02A_REVIEWER_HANDOFF_2026-10-19.md), [measured budgets](evidence/offline-02a-completion-2026-10-19/BUDGETS.md). Design rev6 was merged in PR #230 (`123b4fc`); older pending-design entries below are historical. **No 02a acceptance or merge is claimed.**

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

**The real PHAK changed:** 25 pages moved to `text_unreadable`, because their font maps exist but `lopdf` cannot parse them and it emits glyph ids as letters. That garbage was previously counted as text. The conservative rule also withholds their good text, so span-level filtering is a recorded OFFLINE-02 follow-up. Codex round 3 was RED: `lopdf`'s extractor ignores `q`/`Q`. Text is now flagged if it is unmapped under either the PDF's graphics state or the extractor's last-`Tf` view, with an exact-text regression; the PHAK is unchanged. Native tests: 773 passed. [Report](OFFLINE_01C_REPORT_2026-10-19.md). Earlier entries remain historical.

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

**The sampled RSS watchdog is not implemented.** Codex **rejected both caps for release enablement** (384 and 256 MiB) pending real-document and memory-pressure evidence. Extraction therefore stays dormant: it is not triggered by import and not enabled in any release. Next: 01b (UI), then 01c (real documents). [Report](OFFLINE_01A_REPORT_2026-10-19.md). Earlier entries remain historical.
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

[Proposal](OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md). Earlier entries remain historical.

## Next task: OFFLINE-01; P54-06 phase B part 2 queued — 19 October 2026

**Integrated:**
- **#223**, P54-06 phase A with the P54BASE-R1 correction: Codex review GREEN, merged as `e42e2b3`.
- **#224**, phase B part 1, the frozen FSRS-6 preregistration: Codex rounds 1 and 2 were RED on contract gaps, all closed; round 3 GREEN; merged as `f10a520`.

The "pending review" wording in their entries below is historical.

**Owner decision, 19 October 2026:** start **OFFLINE-01** next. P54-06 phase B part 2 (the in-house candidate, measurements and transition simulations) waits in the scheduler queue behind the offline → homework → exports tranche. Its preregistration (`docs/evidence/p54-06-phase-b-2026-10-19/PREREGISTRATION.md`) stays frozen and binding for when it resumes. Claude implements and Codex reviews. Earlier entries remain historical.

## Three v0.5.7 maintenance follow-ups tracked — 19 October 2026

[Actionable scope](V057_MAINTENANCE_FOLLOWUPS_2026-10-19.md): **V057-UI-01** clipped Gemini-dialog Cancel; **V057-DB-01** classify backup/restore sidecars before any safe owned-temp cleanup; **REL-CI-01** cold/warm release Check budget and cache completion. GitHub confirms the 20-minute timeout occurred after Rust tests passed, during the lockfile check. These are planning/investigation items, not implemented fixes. Sidecars are not automatically cosmetic or disposable. Preserve offline study → homework → exports/current assignments; escalate only confirmed data risk. No application, database/profile or workflow was changed by this update.

## Offline study, homework and exports prioritized by owner — 18 October 2026 Pacific

Planning approved, not implemented: after the current release and any already-assigned task, prioritize **offline study → homework → exports**. This replaces the older unstarted scheduler/weather/FAA next-task order; those items and accepted evidence remain queued. [Detailed plan](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md), [focused OSS research](OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md). Start OFFLINE-01 first; PDF passage search must cover saved study content with honest per-page/scan states and zero provider calls. Homework reuses actions/lessons/history; exports extend the existing one-material JSON/print route. Seven actual upstream repos rechecked above 1,000 stars; no dependency adopted. No app, schema, profile, installer or release changed by this planning task. Earlier entries remain historical; inspect live release/assignment status before starting.

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

No candidate, production, dependency, migration or version change. Part 2 (the candidate, measurements against simple-v1 and transition simulations) follows only after this is accepted. [Preregistration](evidence/p54-06-phase-b-2026-10-19/PREREGISTRATION.md). Earlier entries remain historical.

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

[Report](P54_06_FEASIBILITY_BASELINE_REPORT_2026-10-17.md#p54base-r1-correction--claude-19-october-2026). P54-07 weather and P54-08 FAA references follow. Earlier entries remain historical.

## Combined release installed blocker: managed-source path correction — 18 October 2026

The private v0.5.6 combined candidate built and launched, but the first 40-card synthetic study-aid attempt failed **before upload (0 admissions/submissions)**: batch checks looked for documents-relative file paths at the app-data root. This is a confirmed product regression, not a diagnosis of the friend's connection. v0.5.6 remains private and is retired; the bounded source/test/copy correction and next-candidate v0.5.7 metadata are **pending independent review**, not accepted or published. [Report](GEN_REL_INSTALLED_SOURCE_FIX_REPORT_2026-10-18.md), [reviewer assignment](GEN_REL_INSTALLED_SOURCE_FIX_REVIEWER_PROMPT_2026-10-18.md). Original profile returned intact; synthetic key/evidence remain isolated. Corrected installed/live and backup/restore outcomes must be recorded before release. P54-06 → P54-07 → P54-08 remains after release; no feature loop restarted. Earlier entries remain historical.

## GEN-REL-05 + GENREL04-R12 accepted (Claude round 2 GREEN) and integrated — 19 October 2026

Codex implemented larger source-grounded flashcard sets (20/40/60 targets, default 40), bounded batches, recoverable drafts and deliberate final acceptance, preserving prior content/history and the shared limits. The carried GENREL04-R12 cleanup correction is closed. Claude round 1 was **RED**, with blocking GENREL05-R1; round 2 was **GREEN**, closing R1–R4. Integrated in **PR #219, merge `e07f77e`**. [Report](GEN_REL_05_IMPLEMENTATION_REPORT_2026-10-19.md) and [review evidence](evidence/gen-rel-05-2026-10-19/). Live-provider and installed-app behavior remain **UNVERIFIED**.

## Next patch release includes GEN-REL-01–05 — owner decision 18 October 2026

The owner's “lets get 5 shipped too” decision includes all five improvements in the same next patch release, superseding a 01–04-only candidate. All five are now integrated; **next is an owner-run build and installed verification of the combined patch-release candidate, followed by normal release gates before publication**. No release has been built or published. The count defaults were implementation proposals, not owner-specified counts; release scope does not authorize lifting recovery bounds.

After that release, resume the preserved P54-06 feasibility queue, including PR #210's coverage correction (no scheduler adoption or migration implied), then P54-07 weather and P54-08 FAA references, followed by the approved Study Hub and related open-source evaluation sequence. Reuse accepted search/navigation evidence and retain unresolved production-search/adoption gates. This docs update grants no new merge, dependency, profile/provider-access or publication authority.

## User-reported generation timeout: confirmed message — 18 October 2026

The owner's screenshot shows **“Gemini did not answer in time. Check the internet connection and try again.”** It confirms the timeout-message path, not a cause or a measured five-minute wait. The friend's installed version, document size/pages, selected model and transport stage remain unknown; it proves no bad key, exhausted quota or faulty internet. The source's 300-second request timeout does not establish her build's behavior; GEN-REL-03 now also bounds active work across stages/retries.

[The plan](GENERATION_RELIABILITY_PLAN_2026-10-18.md) retains delayed upload/headers/body and dropped-connection synthetic acceptance requirements, preserved validated results and prior study content, and sanitized stage diagnostics. GEN-REL-01–05 source integration does not establish what her installed build contains or close live-provider/installed acceptance. Earlier tracker entries remain historical.

## GEN-REL-04 accepted by Codex review (round 6 GREEN) and integrated by Claude — 18 October 2026

Integrated in **PR #217, merge `3d50a64`**; reviews are under [`docs/evidence/gen-rel-04-2026-10-18/`](evidence/gen-rel-04-2026-10-18/).

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

**IMPLEMENTED, PENDING REVIEW; not accepted, committed or merged.** The uncommitted work is in the worktree `Flight-training-gen-rel-01` (`claude/gen-rel-01`, base main 45b4e2a). [Report](GEN_REL_01_IMPLEMENTATION_REPORT_2026-10-18.md), [reviewer assignment](GEN_REL_01_REVIEWER_PROMPT_2026-10-18.md).

- **PDF reuse:** a PDF is uploaded once to Google's Files API and referred to by guide and practice-test requests; it is never sent inline again. Reuse is bound to the key's hash, the content SHA-256, the type and the selected source, held in a bounded session-only cache (16 entries) and confirmed `ACTIVE` before each reuse.
- **Concurrency and recovery:** preparation is coalesced and epoch-guarded. Expired, failed or deleted copies are re-prepared at most once, and only this cache's uploads are deleted.
- **Send confirmation:** offers "Choose a chapter or pages first" (the existing split; nothing is sent) and explains the temporary 48-hour Google copy and exactly what leaves the Mac.
- **Inline sources:** images and text are now held to the encoded request limit.

Synthetic loopback tests only. Final gate exit 0: 3,648 frontend and 561 native tests, build, Clippy, fmt, lock sync, helper 26/26 (after removing an editor build folder; the first run is kept), migrations unchanged. Live-provider and installed-Mac behaviour are UNVERIFIED. GEN-REL-02 has not started.

## TOP PRIORITY: generation reliability before other feature work — 18 October 2026

The owner approved the four improvements after a friend reported slow/failed study-guide/test generation, requested **one at a time before anything else**, and assigned implementation to Claude. This instruction supersedes the earlier queue priority; it does not erase accepted work. [Detailed scope, defaults and acceptance matrix](GENERATION_RELIABILITY_PLAN_2026-10-18.md).

| Order | ID | Required outcome / gate |
| --- | --- | --- |
| 1 | GEN-REL-01 | Send less and reuse source preparation: deliberate chapter/page-first managed selection, reusable PDF upload/reference, content/credential/expiry-safe bounded native cache; prove guide+test do not transfer the same PDF twice. |
| 2 | GEN-REL-02 | Recoverable background jobs and validated checkpoints: navigation/restart-safe ownership, source-bound saves, preserved previous content, no repeat provider call for save-only recovery. |
| 3 | GEN-REL-03 | Bounded retries and clear diagnosis: transient transport/status handling, one shared active-time budget, retained attempt limits, actionable quota/auth/model/output/save errors; no indefinite waiting or false exactly-once claim. |
| 4 | GEN-REL-04 | Honest job-scoped progress, Cancel and stage-appropriate Retry/Resume; no fake percentages, post-cancel writes or obsolete notices. |
| 5 | GEN-REL-05 | More source-grounded flashcards after reliability: proposed40-card default with20/40/60 choices, batches up to10, honest source-limited counts and draft recovery; preserve existing cards/history. |

**Next implementer:** complete **GEN-REL-01 only**, using the [full model-neutral assignment](GENERATION_RELIABILITY_FIRST_IMPLEMENTER_PROMPT_2026-10-18.md), then submit source/evidence for independent review and stop. Each next item waits for the previous item's review/integration. Routine implementation defaults are in the plan; do not restart product-decision questionnaires. Her exact error/build/file size is pending and must not be invented.

**Additional owner request:** more flashcards. Current generation asks for10–20; GEN-REL-05 records the larger-set request. The numeric defaults above are proposed, since the owner has not specified a count. It follows01–04 and does not expand Claude's current GEN-REL-01 task.

P54-06/PR210, including its known P54BASE-R1 proof-coverage correction, is paused and preserved; no FSRS comparison or migration. P54-07/08 and Study Hub/OSS follow-on work retain their relative order after reliability. PR164's external tooling remains separate. No implementation is claimed by this planning entry, no app/profile/provider/release action is performed, and agents do not merge. Earlier tracker history follows unchanged.

## P54-05 calendar reviewed; boundary corrections pending independent review — 17 October 2026

Gemini's ce3c948 submission matches8 source hashes/23 evidence checksums. Codex reproduced six boundary failures and fixed UID property injection, noncanonical-date output and invalid timestamp/end-range handling in an isolated review branch;11 permanent cases plus the existing focused suites pass81/81. Raw author full-gate receipts remain unchanged; final diff/log treatment and current tracker bindings are corrected. [Review and precise reviewer assignment](P54_05_CALENDAR_INDEPENDENT_REVIEW_2026-10-17.md). No merge authorized. Installed Calendar/save-dialog behavior remains unverified; the separate scheduler evaluation does not authorize production adoption. Earlier history follows unchanged.

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
- Verification gates: 70 focused tests, full frontend 3,629 passed / 6 skipped, native 533 passed / 6 ignored, typecheck, build, strict Clippy, fmt, lock sync, and schema helper (26/26) all pass with exit 0. [Report](P54_05_CALENDAR_EXPORT_REPORT_2026-10-17.md), [Reviewer prompt](P54_05_CALENDAR_EXPORT_REVIEWER_PROMPT_2026-10-17.md).

## Study Guide hub directions approved — 17 October 2026

Owner approved all eight recommendations, recorded as STUDY-HUB-01–08 in ROADMAP, in this order: source-linked explanations; connected topics; corrections/version handling; explainable study sessions; better wrong-answer explanations; questions grounded in selected documents; study-informed lesson preparation; visible processing quality. [Detailed acceptance criteria](STUDY_HUB_ROADMAP_2026-10-17.md). Planning only; retain the current P54 queue and active calendar assignment, and reuse overlapping source/navigation/scheduling/FAA work. No application, dependency, migration or provider change. No merge authorized in this documentation task. Earlier entries follow unchanged.

## P54-06 evaluation reviewed and corrected; production remains simple-v1 — 17 October 2026

Gemini's e8da4d5 evaluation needed factual corrections on erased history, numeric guarantees, algorithm/package versions and migration assumptions. Corrected documentation preserves reset erasure, requires reference-vector/numeric proof and keeps schema14 verification frozen. [Findings and next model scope](P54_06_EVALUATION_REVIEW_2026-10-17.md). Next is bounded non-production feasibility; no library exception, FSRS engine, migration or retention UI is adopted. No merge authorized; current calendar/Study Hub work remains separate. Earlier history follows unchanged.

## STUDY-UI-01 file-bar overlap corrected; pending review — 17 October 2026

Owner screenshot confirmed file metadata squeezed by three non-wrapping actions. The detail bar now separates readable file details from a wrapping action row; handlers and the material-form bar are unchanged. Isolated production-JSX/CSS browser probe: before22/36, after36/36; existing lineage suite9/9 and typecheck pass. [Report and evidence](STUDY_FILE_ROW_LAYOUT_FIX_2026-10-17.md). Source/browser checks only; installed rendering unverified. No merge authorized; current roadmap/agent work continues unchanged.

## P54-05 lesson brief: review corrections BRIEF-R1/R2 applied; pending re-review — 17 October 2026

**PENDING RE-REVIEW; NO SELF-MERGE.** Claude fixed both findings from Codex's PR204 review in `LessonBriefDialog.tsx`:
- **BRIEF-R1:** choices no longer carry into another lesson.
- **BRIEF-R2:** a late save from an earlier lesson or session no longer shows a notice or releases a newer save's lock.

Dialog state is now one session per open lesson, replaced in the same render on a lesson change or reopen, and every save result is owned by its session. 5 permanent held-promise regressions: all fail on b30af19 and pass on the fix. The review's reproductions pass 11/11; focused 53/53; typecheck clean. Native code unchanged; part B not started. [Report](P54_05_LESSON_BRIEF_REPORT_2026-10-17.md).

## P54-05 part A (lesson brief) implemented; pending independent review — 17 October 2026

**PENDING REVIEW; NO SELF-MERGE.** Claude implemented the approved lesson brief on `claude/p54-05-lesson-brief`, from main 32582f2. Every schedule item now has a Lesson brief dialog with:
- a printable page showing the stored details, `lessonPreparation()` readiness with exact parity, and attached reading (title, type, topic);
- only the follow-ups she ticks, from the newest earlier journal entry and open goal questions, de-duplicated.

Saved through the shared native path as a new `brief` kind (html, 1 MiB cap); browser mode prints instead. Lesson notes, reflections, finances, material notes and paths are never included (sentinel tests). Full frontend 3,584/6 skipped; native 532/6 ignored; typecheck, build, strict Clippy, fmt, lock and helper 26/26 pass. First-attempt typecheck and Clippy failures are retained. No dependency or migration; navigation page labels deferred. Part B (calendar) follows acceptance. [Report](P54_05_LESSON_BRIEF_REPORT_2026-10-17.md).

## Navigation and export accepted for combined main integration — 17 October 2026 (UTC)

PR203's independent save-correction acceptance is verified and merged into PR193 atc99fcb2. PR193 now contains the accepted navigation head69768bf and current main3e59d71, preserving both feature histories. Full combined local gate9/9 passes:3,563 frontend/6 skips,531 Mac native/6 ignored, build/types, strict Clippy/fmt/lock/helper26/26/hygiene. Only MaterialDetail and native command registration combine reviewed feature contributions; other feature source is unchanged. [Integration acceptance](NAV_EXPORT_INTEGRATION_ACCEPTANCE_2026-10-17.md). Final exact-head current-main CI still gates the containing PR193 merge, which will also contain all PR189 commits.

**Next, once this integration is on origin/main:** proceed directly to approved P54-05 PartA. The old continuation's Phase1 is complete; no repeated independent review or owner-default questionnaire. [Direct lesson-brief implementation prompt](P54_05_LESSON_BRIEF_IMPLEMENTATION_PROMPT_2026-10-17.md). Calendar follows PartA review. Source integration does not imply installed/release acceptance; no app/profile/provider/installer/signing/release operations. Earlier pending entries below are historical after the containing PR merges.

## P54-04 save corrections implemented; P54-03 integrated — 16 October 2026

P54-03/#191 independently accepted and merged at3266f193 after exact-head CI and independent3,284 frontend/build/helper checks. P54-04/#193 remains pending: Codex implemented a synchronous one-save lock and fixed pending content/output/answer-key controls;4 new UI cases include2 baseline failures. Added meaningful native partial-write/flush/unwind/post-write-rename coverage; retracted the unproven Windows cleanup suspicion. Final gate8/8:3,320 frontend/490 native, strict Clippy/build/types/fmt/lock/helper26/26/hygiene. [Correction report](P54_04_SAVE_RECOVERY_REPORT_2026-10-16.md), [reviewer assignment](P54_04_SAVE_REVIEWER_PROMPT_2026-10-16.md). Our source needs independent review and exact-head CI; no self-merge. M4 correction#194 likewise awaits independent review. Queue order persists; no app/profile/provider/installer/release operation. History follows unchanged.

## P54-04 study export and printable handouts implemented; pending review — 16 October 2026

**IMPLEMENTED, PENDING CODEX REVIEW; NO SELF-MERGE.** Stacked on P54-03 (PR #191), whose guide formatter the handout reuses; review #191 first. **Share or print** on a material saves the chosen guide, flashcards and/or practice questions as a printable handout (.html; optional answer key on its own page) or as an `hfd-study-packet` v1 file. Every packet passes the import's own validator and must import exactly as chosen, or nothing is written. A new native command saves through the macOS dialog with an all-or-nothing write. Only chosen study content travels: no paths, ids, notes, history or settings. No dependency, schema, capability or version change. Checks: 3,316 frontend / 486 Rust tests, typecheck, build, clippy, fmt, lock and diff checks pass. The installed save dialog, end-to-end re-import and WebKit printing are unverified. [Report](P54_04_STUDY_EXPORT_REPORT_2026-10-16.md). Queue order unchanged; next is P54-02. Historical entries follow unchanged.

## P54-05 direction approved; phase2 proof merged — 17 October 2026 (UTC)

The owner approved following Claude's recommendations unless a concrete technical issue required a correction. **P54-05 both parts approved:** brief first, calendar second; dialog-only choices, floating local times, one-hour default, rescheduled-as-cancelled representation, checklist off by default, single-lesson scope. The reviewer corrected the minute-derived SEQUENCE collision and omitted METHOD:PUBLISH from this organizer-free snapshot export. No schema/dependency or update/sync promise is added. [Approval and exact decisions](P54_05_SCOPE_APPROVAL_2026-10-17.md); [updated scope](P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md); [next substantial model-neutral assignment](P54_05_NEXT_IMPLEMENTER_PROMPT_2026-10-17.md).

**P54-02 phase2 proof is accepted and merged via PR199 atc9347fe:** independent77/77 proof cases,17/17 runner regressions, frozen diagnostics,26 helper checks,55 final/58 prior evidence members and green exact-head CI39008744348. This is exploratory evidence, not production adoption. Existing budget/memory/fidelity/owner-decision gaps remain. PR193 still needs independent acceptance of Codex's save correction and current-main integration before brief implementation; PR189 integration remains separately pending. Preserve queue order and all earlier history. No app/profile/provider/installer/release work occurred in this scope approval.

## P54-05 lesson brief and calendar export: scope proposed for review — 17 October 2026

**PROPOSED SCOPE ONLY; NOTHING IMPLEMENTED OR APPROVED.** P54-02 phase 2 is pending review and owner decisions, so Claude drafted the next queue item's scope for Codex review; queue order is unchanged. Two independently approvable parts:
- **A, a printable lesson brief:** the existing prep checklist and "Ask:" questions, attached reading and ticked follow-ups only. Lesson notes, journal reflections and finances are never included.
- **B, a one-time `.ics` file:** an in-house RFC 5545 writer with a stable UID, explicitly not sync, and no new dependency.

Both reuse P54-04's save and printable-HTML path, so PR193 must reach main first. Eight owner decisions are listed, including the calendar time model (floating local time recommended), default duration, SEQUENCE and what `rescheduled` means. [Scope](P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md).

## P54-02 phase2 proof independently accepted for integration — 17 October 2026 (UTC)

P54P2-R1–R6 are closed for the exploratory proof at2351d36: independent77/77 native cases,17/17 runner tests and the prior frozen stream/ownership diagnostics pass;55 final and58 prior evidence members verify from Git. Current-main integration preserves all histories and proof bytes. The containing PR199 commit supplies final exact-head CI/merge. [Acceptance](P54_02_PHASE2_ACCEPTANCE_2026-10-17.md). This accepts the proof/evidence package, not production search:8/10 measured targets, no hard worker memory cap, real-document/native fidelity and owner adoption decisions remain open. P54-05 proposal is separately under owner-approved-default review. Navigation/export integration remains separate; no app/profile/provider/installer/release work.

## P54-02 phase 2 final corrections R5–R6 delivered; pending independent review — 17 October 2026

**PROOF CORRECTIONS ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude completed P54P2-R5–R6 on PR199. R5: a checked result now needs exit 0 and a clean, fully framed end of stream. Trailing frames, malformed or oversized trailing lines, a partial final frame and reader errors are failures that index nothing; all four failed (indexed) on 06f4bf3. R6: the runner captures source bytes once, creates its example exclusively, and removes it only if it still holds those bytes, so a matching edit by another writer is preserved and fails. 06f4bf3 deleted it. Suite 77/77; runner regressions 17/17. The same 8/10 pre-registered targets met, both misses unchanged. Prior evidence untouched; no application change. [Report](P54_02_PHASE2_FINAL_CORRECTIONS_REPORT_2026-10-17.md).

## P54-02 phase 2 corrections R1–R4 delivered; pending independent review — 17 October 2026

**PROOF CORRECTIONS ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude completed P54P2-R1–R4 on PR199 (`claude/p54-02-worker-proof`). R2: one bounded settlement loop; success needs a complete result and exit 0 (EOF-alive, result+exit 3 and result+stall now settle as failures by themselves, nothing indexed). R3: fail-closed runner with content-hash preservation; 13 permanent runner regressions (13/13 corrected, 11 fail and 2 error on submitted). R4: caller size check before spawn and bounded incremental hashing; an oversized publication replacement is refused unread. R1: the 12 original raw logs were ignored by Git and lost; disclosed, with a labeled replacement run and Git-blob-verified manifests. Suite 71/71; the same 8/10 pre-registered targets met, both misses unchanged. Pre-registration and original evidence untouched; no application change. [Report](P54_02_PHASE2_CORRECTIONS_REPORT_2026-10-17.md).

## P54-02 phase 2 worker proof delivered; pending independent review — 16 October 2026

**PROOF ONLY; PENDING REVIEW; NO SELF-MERGE.** Claude delivered the bounded extraction-worker and search-contract proof on `claude/p54-02-worker-proof`. Limits and targets were pre-registered in a7813e7 before any code ran. Suite 63/63 (first run 62/63 retained). Pre-registered targets: 8 of 10 met; **missed** warm-query p95 at 10,000 (61.8 ms vs 50) and whole-process peak RSS (285 MiB vs 256), reported unchanged. macOS refuses `ulimit -v`; the sampled RSS watchdog overshot by up to 270 MiB, so there is **no hard memory bound** yet. Proposed contract: native FTS5 in a separate disposable cache, literal AND queries, no implicit prefix/fuzzy, diacritic folding, hash-bound page destinations, browser metadata fallback. No engine or dependency adopted; no application file changed. [Report](P54_02_PHASE2_WORKER_PROOF_REPORT_2026-10-16.md).

## P54-02 phase2 re-review: original fixes verified; two final corrections — 17 October 2026 (UTC)

PR199 head06f4bf3 remains pending acceptance. Independent checks reproduce71/71 native proof cases and13/13 runner regressions; all58 replacement evidence members verify from Git. Original EOF/exit failures, caller bounds and false-PASS gates are corrected, with original missing logs honestly disclosed. Two further boundary failures remain: **P54P2-R5**, a completed child can leave trailing frames/malformed or partial output unvalidated and still index; **P54P2-R6**, matching edits to the source and temporary example can fool cleanup into deleting another writer's work. [Re-review](P54_02_PHASE2_REREVIEW_2026-10-17.md); [one consolidated final correction prompt](P54_02_PHASE2_FINAL_CORRECTIONS_PROMPT_2026-10-17.md). Preserve all prior fixes, receipts, preregistered budgets and the two measured misses. No production adoption.

PR189's69768bf CI is green but it still needs current-main reconciliation/final exact-head integration; PR193 still needs its independent export acceptance/current-base integration. Queue order and owner decisions remain unchanged. No app/profile/provider/installer/release work. Earlier dated entries below are historical.

## Independent review: panel fix accepted; search proof needs four corrections — 16 October 2026

**NAV-UI-01 accepted:** PR198 at cb4afba passed independent234 navigation tests, the two original frozen diagnostics, typecheck/build and helper26/26; exact-head CI39004376950 is green. Merged into PR189 as69768bf. PR189 remains open: reconcile current main and require final combined-source exact-head CI before main integration. Accepted R11/R12 are preserved.

**P54-02 phase2 / PR199 requires P54P2-R1–R4:**30/42 submitted evidence members exist and verify in Git;12 logs are missing. The original63/63 suite reproduces, but new diagnostics show EOF can hang past deadline, a complete-result worker exiting3 can still index, and the runner can print PASS after failed measurements or preservation. Caller hashing also lacks the preregistered input boundary. [Independent review](NAV_WORKER_INDEPENDENT_REVIEW_2026-10-16.md); [one precise correction assignment](P54_02_PHASE2_CORRECTIONS_PROMPT_2026-10-16.md). Keep original receipts/preregistration and reported8/10 targets unchanged; no production engine/default adoption.

**Next integration order:** finish current-base navigation integration, record independent export acceptance and retarget/reconcile PR193 with main, then complete/review PR199 corrections in the approved queue. No app/profile/provider/installer/release work is needed. Earlier entries below are retained as historical snapshots.

## NAV-UI-01 [P3] panel notices implemented; pending independent review — 16 October 2026

**PENDING REVIEW; NO SELF-MERGE.** Claude implemented the quick review's follow-up on `claude/nav-ui-01-panel-notices`, stacked on PR189 b5e6b99. Pages-panel notices (check result, read-mark and removal failures) are now owned by the repository/controller/material context that started the action: a retired completion publishes nothing, and a context change clears old notices. 7 permanent cases; 4 fail on the unfixed panel. Navigation 101/101, full frontend 3,527/6 skipped, typecheck/build/helper pass. R11/R12 source unchanged. [Report](NAV_UI_01_PANEL_NOTICES_REPORT_2026-10-16.md).

## Quick review: corrections integrated into feature branches; one nonblocking UI follow-up — 16 October 2026

PR194 and PR195 are merged into their feature branches; earlier "draft/pending correction" entries below are historical. PR189 headc9ad743 has Claude's recorded R11/R12 independent acceptance and current-main merge, with combined-source CI pending at review time. PR193 head27c3971 is green against the old formatted-guide base; it still needs a recorded independent export acceptance, retarget/reconciliation with main and final current-base CI before integration.

**NAV-UI-01 [P3], after navigation integration:** a held Check pages result from repositoryA can leave an obsolete success/error message after the mounted panel switches toB. Two diagnostics reproduce it; B's saved/current state stays correct. Bind panel notices to the initiating context/lifetime; retain live messages and existing persistence guards.126 existing focused tests and combined build/types pass;2 new diagnostic assertions fail as expected. [Review, exact fix scope and receipts](QUICK_ROADMAP_CODE_REVIEW_2026-10-16.md). Do not reopen accepted R11/R12 or delay their integration solely for this rare display issue. P54-03 is merged; P54-02 phase2 worker/search proof remains next in the approved order. No new dependency, app/profile/provider/installer/release work. History follows unchanged.

## M4 R11–R12 correction accepted and merged into PR189; current-base CI pending — 16 October 2026

Independent review of Codex's correction found no defects; PR194 merged into `claude/m4-slice1` at 4f2aef8 with the exact-head guard. PR189 now includes current main (P54-03 guides, search evidence) with all tracker histories retained. It merges into main only after green exact-head CI on this combined source. [Acceptance](M4_LIFECYCLE_ACCEPTANCE_2026-10-16.md).

## Roadmap delivery checkpoint: formatted guides merged; corrections awaiting review; search proof recorded — 16 October 2026

**P54-03 accepted:** PR191 merged at3266f193 after independent source review,3,284 local frontend tests/build/helper26/26 and green exact-head CI. [Acceptance](P54_03_ACCEPTANCE_2026-10-16.md). **M4/P54-01:** Codex implemented R11/R12 in draft[PR194](https://github.com/rickydeleon49-ui/Flight-training-/pull/194), stacked on189,33 new cases and3,488 frontend tests; application source passed CI38992516422; receipt-only publication head35bd450 is rechecking, independent review still required. **P54-04:** duplicate-save and editable-pending-selection fixes plus native failure proofs are in draft[PR195](https://github.com/rickydeleon49-ui/Flight-training-/pull/195), stacked on193;3,320 frontend/490 Mac native and full8-check gate pass; independent review required. Source is not self-accepted. Both PRs carry detailed reviewer assignments and preserved failure receipts.

**P54-02 phase1 exploratory evidence recorded:** actual native FTS5 works, browser sql.js FTS5 is absent;3KB compressed PDF yields1MB extracted text before a length check.18 engine runs on100/1,000/10,000 synthetic materials,36 identical result-id set checks and9 accent-folding differences. No engine/dependency or production feature selected. [Report](P54_02_SEARCH_EVALUATION_2026-10-16.md), [next substantial worker-proof assignment](P54_02_EXTRACTION_WORKER_PROOF_PROMPT_2026-10-16.md). Native interaction, real handbook fidelity, hard extraction/cancellation limits and production restore/index lifecycle remain pending. Approved queue order persists. Primary settings, active Claude worktrees, owner profiles/keys and historical evidence remain untouched; no app/provider/installer/signing/release operation. [Full independent review and integration order](ROADMAP_REVIEW_HANDOFF_2026-10-16.md). History follows unchanged.

## M4 R11–R12 implemented by Codex; independent review pending — 16 October 2026

Owner assigned Codex implementation duties. Isolated `codex/m4-lifecycle-corrections` stacks on published PR189; Claude's active work is preserved. Per-context/lifetime action leases prevent retired refresh dispatches; unique click/controller markers preserve source-badge cleanup.33 new permanent cases;94 focused and4 frozen tests pass; full frontend3,488 pass/6 skipped, build/types and helper26/26 pass. [Implementation report](M4_LIFECYCLE_CORRECTIONS_REPORT_2026-10-16.md), [independent reviewer assignment](M4_LIFECYCLE_REVIEWER_PROMPT_2026-10-16.md). This is implementation evidence, not acceptance; exact-head CI and independent review still gate PR189. No native source, schema/version, app/profile/provider/installer/release work. Prior history follows unchanged.

## P54-03 integration fixes R1–R2 applied; pending review — 16 October 2026

**PENDING CODEX REVIEW; NO SELF-MERGE.** Both findings of the [PR191 integration review](PR191_INTEGRATION_REVIEW_2026-10-16.md) are addressed on `claude/p54-03-formatted-guides` after merging current main (`333db29`). **R1:** only the observation-test readiness gate from `c14afff` is ported (`skillScreens.test.ts`, waits for "Add an observation" to be enabled); no M4 source. The preserved held-skill-list diagnostic, appended temporarily, passed 2/2 on this branch (the old click opens no dialog; the gated sequence records one observation) and was then removed. The red run 38989843373 is preserved. **R2:** only the three current tracker bindings (bytes, SHA-256), `generatedAt`, and their four SHA256SUMS lines are refreshed; historical bindings are unchanged; all checksum entries verify; the schema-14 helper was rerun in a fresh disposable clone with no build output. Full formatter acceptance remains pending. Historical entries follow unchanged.

## P54-03 formatted study guides implemented; pending review — 16 October 2026

**IMPLEMENTED, PENDING CODEX REVIEW; NO SELF-MERGE.** P54-01's first slice (PR #189) awaits review and its later substeps depend on it, so work moved to the next unblocked queue item; queue order is unchanged. The owner chose an in-house formatter over react-markdown: no new dependency. Study-guide section bodies (saved guides and the import preview) now show lists, nested bullets, numbered steps, bold/italic, quotes, inline code and pipe tables. Nothing becomes a link, image or HTML; stored text, backups and schema are unchanged; plain guides read as before. The Gemini prompt now allows that simple formatting (no provider call made). Checks: 3,284 frontend / 477 Rust tests, typecheck, build, clippy, fmt, lock and diff checks pass; the schema-14 helper fails one case locally only because rust-analyzer wrote `src-tauri/target/flycheck0`. Installed WKWebView and VoiceOver behaviour are unverified. [Report](P54_03_FORMATTED_GUIDES_REPORT_2026-10-16.md). Historical entries follow unchanged.

## P54-03 PR191 integration fixes recorded — 16 October 2026

Before accepting the guide-formatting PR191 at reviewed head5f06d97: **P54-03-R1**, port the bounded observation-test readiness correction without importing unaccepted M4 source, and get green exact-head CI; **P54-03-R2**, reconcile current tracker history and refresh its3 stale current manifest bindings/checksums (all3 mismatches verified). [Integration findings](PR191_INTEGRATION_REVIEW_2026-10-16.md). Full formatter/parser/rendering acceptance remains pending; this was a bounded integration review. Preserve Claude's active terminal work and reconcile newer changes first. M4 R11–R12 remain the separate preceding integration fixes; queue order unchanged. Historical entries follow unchanged.

## M4 Slice1 review: R11–R12 lifecycle fixes before integration — 16 October 2026

Published PR189 headc234005 corrects the original R5–R10 failure sequences and has green exact-head CI (3455 frontend/517 Linux Rust). Independent review still reproduces2 bounded lifecycle defects: **R11**, an old action's finally can start a fresh read on a retired repository and replace current state; **R12**, an old source-badge completion can clear a newer request's cleanup marker, allowing an open after unmount. Fix both before accepting PR189;3 new regression cases fail and the single-request control passes. [Precise review](M4_SLICE1_R11_R12_REVIEW_2026-10-16.md), [correction handoff](M4_SLICE1_R11_R12_CORRECTIONS_PROMPT_2026-10-16.md). Claude is actively working through Terminal: reconcile its newer work before editing; no competing implementation was started by the reviewer. Owner scope approvals and queue order persist. Source tests do not verify installed behavior. Historical entries follow unchanged.

## M4 Slice1 R5–R10 corrected; PR189 resubmitted for review — 16 October 2026

**SUBMITTED FOR CODEX REVIEW; not accepted or merged.** All six re-review findings are corrected on `claude/m4-slice1` (PR189). [Correction report](M4_SLICE1_R5_R10_CORRECTION_REPORT_2026-10-16.md). R5: bookmarks open only on the content they were saved on. R6: a bookmark draft keeps its original content after a refresh. R7: only the latest reload publishes. R8: guidance checks ownership before opening; source badges retire on unmount. R9: the CI failure was a test clicking a still-disabled button while the skill list loaded, reproduced with a held load and fixed with a readiness wait. R10: native checks derive the page count from the PDF bytes, repair a wrong cached count and refuse the request. The completion report's restore claim is corrected (an unobserved A→B→A is not detectable). Frozen diagnostics are permanent regressions. Final gate exit 0: 3,455 frontend and 518 native tests, build, Clippy, fmt, lock sync, schema-14 helper 26/26, diff check; native steps also pass on SDK 26.5. Source tests only; installed behaviour is unverified. No release, version, dependency, schema, app, profile or provider work.

## M4 Slice1 PR189 requires R5–R10 corrections — 16 October 2026

The feature is implemented but not accepted at reviewed head6d8c608. Independent review reproduced stale-bookmark opening, bookmark-draft rebinding, late reload publication, superseded guidance opening and native cached-count bounds defects; exact-head CI also failed one existing skill-screen case. [Re-review](M4_SLICE1_REREVIEW_2026-10-16.md), [one correction assignment](M4_SLICE1_R5_R10_CORRECTIONS_PROMPT_2026-10-16.md). Existing512 native tests and183 focused frontend tests pass, but five new diagnostics fail; no merge is authorized by those passing subsets. All66 submitted paths are frozen and the author checkout is preserved. Owner approval OD-1–OD-10 persists; queue order unchanged. No app/profile/provider/installer/release work. Historical entries follow unchanged.

## M4 Slice1 document navigation complete; submitted for review — 16 October 2026

**SUBMITTED FOR CODEX REVIEW; not accepted or merged.** One source PR on `claude/m4-slice1` delivers the owner-approved Slice1 (OD-1–OD-10, OD-6 refuse-and-explain) and closes the partial review's four findings at source level. [Report](M4_SLICE1_COMPLETION_REPORT_2026-10-16.md).

- **R1:** read confirmation names the content hash and saved generation it was made for; bookmarks name the content. Stale requests change nothing.
- **R2:** success replies must match every request-bound field.
- **R3:** native commits, confirmations and bookmarks reread the managed file inside their own transaction; deletion, relinking or replacement after inspection cannot authorize a save. A verified native open hands only checked content to the default reader.
- **R4:** the genuine tampered schema-14 case is restored; the node test driver (not production) now leaves a refused file unchanged.
- **Feature:** migration 0015 (four tables), shared native/browser operation and validation cases, request controller with local epochs and durable supersession, source badges in four study views, and a "Find your place" panel with page entry, last requested page, separate read mark, bookmarks, save-only retry and file restore.
- **Schema-14 helper:** still frozen at 14; its pins are compared with the registered 1–14 prefix and it refuses a schema-15 library.

Source tests only; installed reader/IPC behaviour is unverified. No release, version bump, dependency, app launch, profile or provider use. Queue order is unchanged. Historical entries follow unchanged.

## M4 Slice1 scope approved; partial implementation needs completion — 16 October 2026

The owner directly approved OD-1–OD-10, including OD-6 refuse-and-explain. [Approval](M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md). The isolated `claude/m4-slice1` worktree has saved checkpoints ed82811/07fdcfa plus one preserved trim patch; it is not accepted or on main. Independent review reproduced stale read-confirmation and inconsistent-acknowledgement defects, identified native cached-file validation and tamper-test coverage gaps, and confirmed the remaining schema14 helper failure. [Review](M4_SLICE1_PARTIAL_REVIEW_2026-10-16.md). Complete the approved feature and corrections together under [the continuation assignment](M4_SLICE1_CONTINUATION_PROMPT_2026-10-16.md), then stop for independent review. No release/profile/build/provider authorization is implied; queue order is unchanged.

OPENFOLDER-01 is independently accepted and merged as PR#187 at774f730; its earlier submitted-for-review entry below is historical. Installed Finder behavior on those bytes remains unverified. Historical entries follow unchanged.

## OPENFOLDER-01 empty-folder fallback corrected; submitted for review — 16 October 2026

The empty/unreadable Mac data-folder fallback in `open_data_folder` is corrected in `src-tauri/src/backup.rs`. For an empty `.app` root, the command now asks the opener to *reveal* the folder instead of *opening* it, and Finder's behaviour on an installed Mac was **not observed** because no app launch was performed. Read/enumeration failures return an informative I/O error instead of falling back to `open_path`; an unreadable individual entry inside the folder now stops the reveal with an error, where it was previously skipped. Working database and child reveal behavior are preserved, permissions remain narrow, and an opener test adapter tests routing, missing root, and permission-denied listing without opening Finder. `open_data_folder_in` is private. [Report](OPEN_DATA_FOLDER_FOLLOWUP_COMPLETION_2026-10-16.md).

Checks: full frontend 3,252 passed / 6 skipped, Rust 477 passed / 6 ignored, cargo clippy `--locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, cargo fmt, lock sync, typecheck, build, 21/21 schema-14 checksums, and 26 schema-helper tests pass. Submitted for Codex review; no self-merge.

The separate model-budget/timeout evaluation and M4 R37–R39 retain their existing assignments. The eight-item queue order is unchanged. Historical entries follow unchanged.

## M4 prototype accepted for integration; production scope decision next — 16 October 2026

**R37–R39 closed in the evidence-only prototype**, effective after this acceptance PR passes exact-head CI and merges. Independent current-main Node22/26 runners pass104 mapped tests and24 mutants; assigned five, previous four and adapted frozen five pass on each. Direct unadapted4/5 remains disclosed. [Acceptance](M4_ROUND6_ACCEPTANCE_2026-10-16.md). All709 submitted files are preserved; old tracker prefixes are reconciled with current history rather than replacing it.

**Next:** owner dispositions of [OD-1–OD-10](M4_PRODUCTION_SCOPE_DECISIONS_2026-10-16.md), then real native-reader source links/bookmarks/last-requested tracking under the [current handoff](M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md). OD-6 explicitly recommends refusing invalid references, matching the tested resolver; the earlier clamping proposal is unapproved. The old conditional implementation draft is superseded, preserved historically, and must not drive a production port.

No production M4 source or migration0015 registration, embedded-viewer dependency, installed/provider test or new release is included. The eight-item roadmap order is unchanged; OPENFOLDER-01 and model-budget evaluation remain separate. Source acceptance is not owner approval of the new feature scope. Historical author and project entries follow unchanged.

## M4 round 6 (R37–R39) corrected — pending Codex review — 16 October 2026

**IMPLEMENTED, UNCOMMITTED, PENDING CODEX REVIEW.** Claude corrected the three findings of the [round-5 review](M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md) in the existing M4 checkout.

- **R37:** a newer request now retires older work before any ownership read or reservation can fail.
- **R38:** a reservation now proves its claim persisted before issuing a token.
- **R39:** the install record keeps the real signal.
- **Diagnostics:** the review's five new ones pass 5/5 on Node 22 and 26; the earlier ones are preserved.
- **Lanes:** both lanes pass with 104 mapped tests and 24 mutants (Node 22 live npm 10 install; Node 26 validated npm 10 reuse).
- **Not done:** M4 stays evidence-only. OD-1–OD-10 stay proposed, P54-01 and migration 0015 are unstarted, and the eight-item queue order is unchanged. [Report](M4_DOCUMENT_NAVIGATION_ROUND6_CORRECTIONS_REPORT_2026-10-16.md).
- **Note:** this checkout's trackers date from `7e49558`. Reconcile with current `main` when committing.

## GEM-01 wording follow-up accepted and merged — 16 October 2026

PR #184 merged at4a8a92f after independent source review and successful exact-head CI. Settings now distinguishes Argon's rate/capacity fallback from403 access refusal, matching Rust and README. Independent Settings tests3/3, typecheck/build/hygiene pass; CI covers3,252 frontend,474 Linux Rust and26 helper tests. [Acceptance](GEM01_WORDING_ACCEPTANCE_2026-10-16.md). No new release or live provider verification is claimed.

The separate model-budget/timeout evaluation remains open. M4 R37–R39 and OPENFOLDER-01 retain their existing assignments, and the eight-item queue order is unchanged. Historical entries follow unchanged.

## M4 round5 reviewed: ownership corrections required; release record accepted — 16 October 2026

**M4 stays evidence-only and unmerged.** Both independent Node22/26 runners pass93 mapped tests and20 mutants; prior four diagnostics pass and frozen five pass through the disclosed seed adapter. New diagnostics expose **R37** (failed newer reservation leaves older opener/save live: page5 becomes10 and UI reverts to opened) and **R38** (ignored claim INSERT/UPDATE issues duplicate undurable tokens). **R39**, a non-blocking receipt issue, loses an install child's real termination signal. All five new assertions fail on both lanes. [Review](M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md) · [single precise correction assignment](M4_ROUND5_CORRECTIONS_PROMPT_2026-10-16.md).

**RELREC-01 is resolved:** PR #178 merged at2f4cca2 after exact-head CI38952463917 on2d6c432. Six tracked native screenshots inspected; complete21-entry evidence inventory and21 helper checksums verify;26 helper tests pass. Existing raw receipts/artifact hashes are preserved. This accepts existing release evidence and adds no new installed/provider verification.

**Next:** finish R37–R39 in the existing uncommitted M4 worktree and return for Codex review; preserve all round5 receipts and594 frozen input hashes. P54-01 production, OD-1–OD-10 dispositions and migration0015 remain unapproved/unstarted. The eight-item queue order is unchanged. The merged Open folder fix and its separate OPENFOLDER-01 follow-up retain their prior status; no new release is built or published. Historical entries follow unchanged.

## PR #178 release record: six screenshots published (RELREC-01) — 16 October 2026

**PENDING CODEX REVIEW; NOT MERGED.** PR #178's release record now tracks its six native screenshots.

- **Screenshots:** all six are synthetic, with no key value, and sit in `docs/evidence/mac-v055-release-2026-10-16/screenshots/`. They were force-added by exact path, and the global image-ignore rule is unchanged. The [release record](MAC_V055_RELEASE_2026-10-16.md) links each one.
- **Inventory:** a new `EVIDENCE_SHA256SUMS` lists the report and every evidence file. `ARTIFACT_SHA256SUMS` stays the separate binary-artifact inventory.
- **Not done:** no rebuild or native rerun, and no installer, profile, database or key committed.
- **Branch:** reconciled with main `4d38733`. Tracker history and the eight-item queue are unchanged; only the schema-14 helper's current tracker hashes were refreshed.

## Open folder fix accepted and merged; empty-folder follow-up tracked — 16 October 2026

PR #180's native Finder correction passes independent source review: **3,252 frontend tests / 475 Rust tests**, typecheck/build/lint/fmt/lock/hygiene and26 schema-helper tests pass. The nine reviewed application files remain identical after updating the branch to current main. Final head `0b818860` passed exact-head CI; #180 merged at `2a203df`, with all nine application hashes confirmed again. No new release is built or published; released v0.5.5 bytes are unchanged. [Review](OPEN_DATA_FOLDER_REVIEW_2026-10-16.md).

**OPENFOLDER-01 (non-blocking):** the empty-root macOS branch still uses plain open-path on the `.app` directory; enumeration failures are indistinguishable from emptiness. Normal startup/library behavior is fixed. Track the bounded [follow-up](OPEN_DATA_FOLDER_FOLLOWUP_PROMPT_2026-10-16.md) before claiming every recovery-state folder opens. Keep this maintenance item separate from the unchanged eight-item post-release queue.

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

[Release record](MAC_V055_RELEASE_2026-10-16.md). Historical entries below keep their original status.

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

[Release record and notes](MAC_V054_RELEASE_2026-10-16.md). The eight-item post-release queue (P54-01…08) is unchanged. Historical entries below keep their original status.

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

Not executed: erasure UI, VoiceOver, standard account/minimum OS, mid-save fault injection, signing and notarization. [Report](MAC_V054_FINAL_CANDIDATE_REPORT_2026-10-15.md). The eight-item post-release queue (P54-01…08) is unchanged. Historical entries below keep their original status.

## Desktop corrections accepted; fresh final v0.5.4 candidate next — 15 October 2026

**Independent source review ACCEPTED, effective after the containing PR passes exact-head CI and merges.** DESKTOP-V054-01 (material dates), -04 (backup dates) and -03 (post-restore foreground activation) pass review with no blocking code findings. DESKTOP-V054-02 remains investigated/not reproduced; its original automation no-window outputs retain an unconfirmed cause. Independent gate9/9 exit0:44 focused,3,242 frontend/6 skipped,467 Rust/6 ignored, typecheck/build/fmt/Clippy/lock/hygiene clean. Submitted47 hashes and35 checksums matched; private test-build binary/signature matched read-only. Native evidence is one counted implementer focus run, not a new reviewer-installed test. [Acceptance](MAC_V054_DESKTOP_CORRECTIONS_ACCEPTANCE_2026-10-15.md).

**Next:** [fresh private local v0.5.4 candidate and exact-candidate verification](MAC_V054_FINAL_CANDIDATE_PROMPT_2026-10-15.md) from the containing PR's accepted merged main. Preserve e928601/fee7869/UNCOMMITTED artifacts. Original dirty implementation package remains intact. No new build, app launch/profile access, signing or publication was performed by this review. Remaining installed/platform gaps stay explicit; all eight selected improvements remain queued after v0.5.4, in the owner-approved order below. Earlier entries retain their historical status.

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

Not executed: the schema-14 restore data comparison and the schema-12 exact-candidate restore. The older-backup matrix is incomplete; tombstone UI, VoiceOver, standard account and signing remain open. The original profile was returned intact. [Report](MAC_V054_DESKTOP_CORRECTIONS_REPORT_2026-10-15.md). Historical entries below keep their original status.

## Native v0.5.4 run completed; two follow-ups open — 15 October 2026

Owner authorized fresh synthetic data in this account, explicitly an **administrator-account UID501 test**. Actual e928601 candidate installed and launched. Save/restart, PDF picker/Open/chapter, genuine populated13→14 retention, current/older backup data restoration, Skills saves/history, cancellation, guarded-backup failure and damaged-archive refusal passed their bounded checks. **DESKTOP-V054-01:** Added/Last reviewed display the UTC day in the evening (confirmed P2). **DESKTOP-V054-02:** two restore self-restarts left no accessible window, although data restored; root cause unconfirmed, independent lifecycle/tooling investigation required. [Native report](MAC_V054_DESKTOP_VERIFICATION_2026-10-15.md) · [one model-neutral correction prompt](MAC_V054_DESKTOP_CORRECTIONS_PROMPT_2026-10-15.md).

**Next task:** fix01 and disposition02 with focused tests; then verify affected behavior on an independently identified corrected local candidate. Standard-account/hfdtest, exact-candidate schema12 restore, deliberate erased-observation/tombstone UI coverage, VoiceOver, minimum macOS, signing/notarization and publication remain unverified/deferred. Gatekeeper assessment rejected the ad-hoc candidate; normal local launch succeeded without a bypass. No full-release acceptance is claimed. App stopped; original synthetic profile/key preserved at the default root; other test profiles/backups recoverable locally. Historical entries below retain their original status.

## Fresh v0.5.4 local candidate accepted — 15 October 2026

**Independent review ACCEPTED for the private local lane, with report integration through exact-head CI in the containing PR.** The fresh candidate is built from frozen source **e9286017d3ca8b1faa1c8f5568c708d43e0b3050**, including PR167 and PR169. Independent review matched all candidate14/14 and earlier-candidate37/37 hashes, verified the local ad-hoc app/ZIP/read-only DMG contents and matching executable identity, reran26 helper tests plus lock checks and all17 browser scenarios. No application/version/dependency change was made by this report integration. [Acceptance and independent evidence](MAC_LOCAL_V054_FRESH_CANDIDATE_ACCEPTANCE_2026-10-15.md).

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

[Report and reviewer handoff](MAC_LOCAL_V054_FRESH_CANDIDATE_REPORT_2026-10-15.md). Desktop launch, installation, hfdtest, installed upgrade and restore, Gatekeeper, VoiceOver, signing and publication remain UNVERIFIED/deferred. Historical entries below keep their original status.

## v0.5.4 source preparation and QA tooling accepted — 15 October 2026

**Independent review ACCEPTED for exact-head CI/integration in PR #167.** QA-01 and QA-02 are closed in source: real ARM64 Cargo output is recognized with its strict shape/link/tracked-file guards, and helper replay permits only the two synchronized root application-version fields. The five version files consistently declare **0.5.4**, with no dependency change. PR #169's flight-time/medical fixes are included and unchanged. [Acceptance](MAC_LOCAL_V054_QA_ACCEPTANCE_2026-10-15.md).

Independent combined verification: **26 helper tests passed / 0 skipped**, **3,221 frontend passed / 6 skipped**, typecheck, frontend build and Cargo-lock checks pass. The submitted corrected helper replay passes all **12 stages**, with all 15 walker cases; refreshed combined replay/CI identities are recorded in the containing PR closeout. Historical failure receipts and original submission manifests remain snapshots, not claims about later tracker bytes.

**Next task:** [fresh private local v0.5.4 candidate from the accepted merged source](MAC_LOCAL_V054_FRESH_CANDIDATE_PROMPT_2026-10-15.md). The existing fee7869 app/ZIP/DMG remains hash-identical and predates PR169; no new native candidate was built by this review. Freeze the containing PR's merged source before a new build; preserve older artifacts. The earlier automatic DMG stall remains unexplained and requires truthful receipts if repeated. Current authorization remains local unsigned/ad-hoc plus automated/browser testing; desktop launch, hfdtest, signing credentials/notarization and public publication remain deferred. M4 prototype and M5 policy/requirements decisions remain separate.

## Local v0.5.4 QA-01/QA-02 tooling corrections — pending independent review — 15 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Claude, uncommitted on `codex/local-v054-build-check` (HEAD `93a88df`), per the [QA follow-up prompt](MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Scripts and docs only; no application source, dependency, migration, version, signing or native-artifact change.

- **LOCAL-V054-QA-01:** the build-output recognizer now accepts the one supported cross-target folder, `src-tauri/target/aarch64-apple-darwin`, only in Cargo's exact shape: its own single-linked cache tag and real `debug`/`release` profiles. Unknown or lookalike target names, stray entries, symlinked folders or profiles, missing, invalid, symlinked or hard-linked tags, and tracked paths inside build output still refuse. The original 11 walker scenarios are kept, with 4 added.
- **LOCAL-V054-QA-02:** the post-merge replay now permits only the two synchronized application-version fields in `package-lock.json`, decided by the tested `compareDependencyLock` before any worktree is created. An identical lock passes as before. The replay still installs the baseline lock on the immutable `16f9cf3` baseline and certifies only the helper component.

Measured results, the check-only replay of the new bytes and preserved original failures: [reviewer handoff](MAC_LOCAL_V054_QA_FOLLOWUP_HANDOFF_2026-10-15.md). The automatic DMG stall stays a separate, unexplained observation. Installed tests, desktop launch, hfdtest, signing and publication remain deferred. Historical entries below keep their original status.

## Local v0.5.4 build tested; tooling follow-ups open — 15 October 2026

A provisional local ARM64 v0.5.4 test artifact was built from clean version-only commit `fee7869` (accepted functional parent `f2a7090`). Staged ad-hoc app and private DMG verified read-only, hashes matched, image detached. Automated results: frontend 3,202 passed / 6 skipped; native Mac Rust 465 / 6 ignored; 12 browser routes and 13 functional scenarios passed. No installed app/profile/hfdtest use; desktop launch remains deferred by the owner's current choice.

**Open:** LOCAL-V054-QA-01, helper suite 22/23 because genuine `target/aarch64-apple-darwin` output is classified as unexpected; LOCAL-V054-QA-02, replay recipe refuses version-only package-lock metadata. The automatic Tauri DMG phase stalled once; manual local image creation/verification succeeded, cause unconfirmed. Do not call the whole gate green or silently weaken/delete fixtures. Version configuration is prepared on `codex/local-v054-build-check`, not yet integrated into main. [Build report](MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md) · [precise next-model task](MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md).

Next: independently review version/evidence and complete the bounded tooling follow-up; preserve the test artifact. Public release/signing, installed tests, M4 production and unapproved requirements remain separate/deferred. Historical entries below describe their original checkpoints.

## Sweep follow-ups accepted; next release work — 15 October 2026

**Independent source review ACCEPTED for exact-head CI/integration in the containing PR.** SWEEP-1014-TIMES and SWEEP-1014-MEDICAL, including SWEEP-R1, pass re-review. The original seven-case diagnostic passes unchanged; independently rerun frontend: **3,221 passed / 6 skipped**, typecheck and production bundle pass. [Acceptance and evidence](SWEEP_FOLLOWUPS_ACCEPTANCE_2026-10-15.md). Earlier submission/review receipts remain historical and unchanged. Installed Mac behavior remains unverified/deferred.

**Current roadmap position:** M1 daily planning and M2 study/review source work are delivered; the first M3 skills/evidence slice is delivered. This sweep completes the two historical flight-time/medical-conflict follow-ups after the containing PR passes exact-head CI and merges. M4 viewer/navigation remains an unshipped evidence prototype with separate ownership. M5 cost analytics have a delivered first slice; refunds/credits and requirement decisions RQ-D1–D7 remain open. No additional requirement implementation or provider adoption is authorized by this acceptance.

**Next priority:** resolve QA-01 (real Apple Silicon Cargo target output rejected by the schema14 helper) and disposition QA-02 (version-only lockfile replay restriction), using the [existing model-neutral follow-up in PR #167](https://github.com/rickydeleon49-ui/Flight-training-/blob/codex/local-v054-build-check/docs/MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Preserve its build/failure evidence and check for an existing owner before editing. PR #167's provisional local ad-hoc v0.5.4 artifact predates this sweep: it does not contain these new fixes. Its CI passed, but tooling findings, independent version review and the exact final candidate source remain open. Do not merge it or rebuild solely because this sweep is accepted. Desktop launch/hfdtest, Apple signing/notarization and public publication stay deferred.

## Schema14 package accepted; F1–F3 follow-up — 15 October 2026

The independently reviewed package merged unchanged in [PR #165](https://github.com/rickydeleon49-ui/Flight-training-/pull/165) at `8450526` after exact-head CI run 38803089531 passed (3,202 frontend / 464 Rust; original skips/ignores retained). F1–F3 are a separate non-blocking follow-up: precise Linux helper CI step, [canonical post-merge reproduction](evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md#7-post-merge-source-only-reproduction-f2), and named full-self-check refusals with a meaningful regression. Helper tests now 23/23, zero skips; schema14 self-check remains 102/102. Final exact-head CI and reproduction identities are recorded with the follow-up PR closeout and [report](MAC_SCHEMA14_FOLLOWUP_F1_F3_2026-10-15.md).

No pin, overlay allowlist, production comparison rule, migration or frozen evidence changed. Earlier pending-review entries below are historical. Next: exact-head CI/integration of this follow-up, then local unsigned v0.5.4 source/version preparation. Installed hfdtest, signing/publication and packaged Mac checks remain deferred; primary and separately owned work remain untouched.

## Schema14 preparation completed for review — 15 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** The saved REL-01 / MAINT-143-KEYS package is recovered onto accepted main `16f9cf3` in `codex/schema14-verification-completion` at `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`. Original saved hashes verified 10/10 and evidence checksums 4/4; original worktree preserved. Current focused checks: 117 Vitest, 21 helper tests, proof 12/12 (schema14 self-check 102/102), typecheck and Cargo-lock pass. The intentional historical schema13 ceiling alarm remains. Current inventory/evidence and exact review steps: [reviewer handoff](MAC_SCHEMA14_COMPLETION_REVIEWER_HANDOFF_2026-10-15.md).

The proof binds the repository overlay to `16f9cf3` while retaining the immutable `8a260c0` schema contract and unchanged migrations/fixtures. Source-only synthetic evidence does not close installed gates. Next action: independent review/CI/integration, then the selected local unsigned v0.5.4 source/version preparation. hfdtest, signing/publication and M4 production remain deferred/separately owned. No commit, push, build or profile access. Older entries below retain their historical status.

## Claude consolidation and next owner — 14 October 2026

Reviewed source packages are consolidated for exact-head CI/integration: nine bug fixes, M5 cost analytics, material Again readiness, timezone maintenance and screenshot routing. The original red PR161 receipt is preserved; the new rendered test waits on observable completion and has a delayed-crypto regression. Requirements remain a proposal, not approval. [Review](CLAUDE_WORK_CONSOLIDATION_REVIEW_2026-10-14.md).

Next implementation priority is the existing [saved schema14 package](MAC_SCHEMA14_UNMERGED_CONTINUATION_2026-10-12.md), followed by the accepted local unsigned v0.5.4 route after review. Reuse the existing owner/work; do not launch a competing package. Apple signing/publication, hfdtest, M4 production and RQ-D1–D7 remain separate. Current Git coordination is explicitly authorized to Codex by the owner's review/merge/cleanup request. All older entries below are retained as historical submission snapshots.

## M2 Review due clock recovery — 14 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW** (Claude `claude-opus-5-5` medium; uncommitted isolated worktree; base `e87874b`). This is the only queue job for this work (`6d5fca12ebf7`).

- `useLibraryDueStream` now re-checks the computer's current local day on mount, at the midnight timer, on window focus and on return to a visible document. Hidden-state notifications are ignored.
- **When the day boundary changed:** it invalidates the old generation, which drops its pages and failed read. It then reads page one with a fresh clock, the latest filters and a null cursor.
- **When the boundary is unchanged:** it reads nothing and keeps everything already loaded.
- One timer is always re-armed from the current clock. This also fixes the old redundant read, and the lost timer when the timer fired on an unchanged day.
- The fix uses ordinary browser events, with no polling or new dependency. Scheduling, persistence, migrations, History, Retry, Check again and StrictMode ownership are unchanged.
- **Verification (Node 22.23.3):**
  - New hook suite: 21 passed. New rendered real-SQLite suite: 5 passed.
  - `StudyLibraryReviews` 16, `deferredReviewRead` 10, `localDay` 5 and `StudyLibrary` 2 passed.
  - Typecheck, build and `git diff --check` exit 0.
  - Against unchanged production source: 14/21 and 3/5 fail. Both disposable mutants are caught.
- **Limitations:**
  - Sub-day relearning refresh and material-level sessions remain separate.
  - Webview event delivery across sleep and zone change on an installed app is unverified.
  - G1–G3 and release gates stay deferred.
- PR159/154/155/157 and M3 production are integrated. Keyboard `f163efd3f8f1`, parity `d8ff795089fc`, schema14 preparation, MAINT-143-KEYS, timezone PR152 and REL-03 are preserved and excluded. M4 remains separately gated.

[Implementation report](M2_REVIEW_DUE_CLOCK_RECOVERY_REPORT_2026-10-14.md). Entries below are unchanged.

## Study Library scenario test isolation — 14 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW** (Claude, uncommitted isolated worktree, base `cb0ece1`). Test-only M2 maintenance.

- `src/perf/studyLibraryScenarios.test.ts` now gives each of the 18 benchmark scenarios its own named, sequential test. Each test runs on a freshly mounted real Study Library with its own disposable SQLite: the 16 ordinary scenarios at 240 materials and the two expanded scenarios at 1,000. Every run uses the existing `only` selector.
- Coverage accounting is new. It detects a scenario that is unassigned, assigned twice, a duplicate name, skipped, unfinished or run twice. The check that both expanded scenarios are ineligible at 240 materials is kept.
- All harness checks, spot checks, negative controls and fixture/transaction tests are retained. Harness `2af0e3af…` and fixture `93b834e5…` are unchanged. Budgets stay at 30 s and 60 s per test; there are no retries, skips or production changes.
- Verification (Node 22.23.3):
  - The unchanged baseline passed 11/11 in 42.68 s. The historical timeouts in `runs/20261014-004448-779238` were full-suite load stalls and **did not reproduce**.
  - The final suite passed 31/31 in 34.31 s, and typecheck exit 0.
  - Six disposable mutations (omit, duplicate, skip, intermediate id, intermediate count, inert control) each failed as intended.
- This isolates stalls for diagnosis; it does not cure timeouts under load. Splitting the test raises the aggregate time the suite may take. M4, the schema14 parity package `d8ff795089fc` and the other packages are untouched.

[Implementation report](STUDY_LIBRARY_SCENARIO_ISOLATION_REPORT_2026-10-14.md). Entries below are unchanged.

## M2 focused practice review — 13 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW** (Claude, uncommitted isolated worktree, base `c9a15ab`).

- A confirmed completed practice result now links to that exact attempt's review with `?review=missed`.
- Completed-attempt history has All questions / Missed or skipped controls. Plain links still open on All questions.
- Missed or skipped covers incorrect, don't-know and unanswered questions, classified from frozen items. Original numbering, explanations, source pages and the immutable score are kept.
- No persistence, migration, scoring, dependency or M4 change.
- Verification:
  - Node 22: six focused suites 77 passed; `npm test` 3071 passed / 6 skipped; typecheck, build, cargo test 465 / fmt / clippy, cargo-lock and diff checks all exit 0.
  - The new rendered regressions fail 6/6 against the baseline UI, and the classification mutants are caught.
  - The default Node 26.10.0 lane has 165 failures that also occur on the baseline (`localStorage` undefined); they are recorded, not caused here.

[Implementation report](M2_FOCUSED_PRACTICE_REVIEW_REPORT_2026-10-13.md). This does not complete M2 and makes no installed/release claim. M4 and other entries below are unchanged.
## MAINT-143-TZ corrected — 12 October 2026

**Corrected, pending independent review; uncommitted and unpushed** (base `3d27ef3`, isolated worktree `agents/task-20261012-210510-179657`). The change is test-only. The date-helper and practice-history suites now set their time zone explicitly with literal boundary days. Practice history also freezes the clock. TZ is restored exactly, and the Notes hook no longer leaves `TZ="undefined"`. The five required suites (dates, practice-history dates, notes, localDay, useLocalToday) pass 43/43 under UTC, Los Angeles and Kiritimati on Node 26 and Node 22. The worktree has no `origin` remote, so the base was checked read-only through the GitHub API: upstream `main` is `3d27ef3`, and no open PR claims the task. A UTC-day reversion fails 10 cases in every zone. [Verification report](MAINT_143_TZ_VERIFICATION_2026-10-12.md).

Only MAINT-143-TZ changes status. MAINT-143-KEYS stays with the schema14 package. M4 R28–R32 and installed/signing/release gates are unchanged.

## M4 round-3 independent review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R28–R32.** Submitted full runners reproduce 52 passing tests on Node22/26 and delivered checksums verify45/45; five new diagnostics fail on both lanes. Confirmed: duplicate durable ownership across concurrent controllers, pending save surviving abort, stale callback publication, asserted installation/final-verification receipts, and incomplete mutant/count traceability. Sequential restart and simple late-retry fixes are retained; M4 remains evidence-only. Gemini's submission is untouched.

[Independent review](M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md) · [One model-neutral correction assignment](M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md). Prior ownership/handoff history remains below; integration stays with the current Git coordinator.

## Historical: Local workspace maintenance — 11 October 2026

Historical record retained below; the newer M4 round-4 correction assignment above governs current work.

Primary main is clean and synchronized to `8a260c0` after preserving the unpublished October 10 preflight on a recovery branch and verified local bundle. Four retired C2/lineage checkouts are removed with source refs, useful receipts and the historical installer preserved. Gemini's active M4 and all other dirty/handoff checkouts are untouched. PR #142 is now merged; PR #143 and #146 fixes are merged. PR #148 remains the open M4 R23–R27 correction handoff, not an accepted production change. Older entries below describe their original snapshots.

[Cleanup/current-state report](LOCAL_WORKSPACE_REVIEW_AND_CLEANUP_2026-10-11.md). No installed/release gates are closed by this cleanup.

## Historical M4 round-2 review

Historical record retained below; the newer M4 round-4 correction assignment above governs current work.

**11 October M4 round-2 review (Gemini submission): CORRECTIONS REQUIRED M4-R23–R27.** Restart and late-retry generation defects; the report's test and mutant names don't match what ran. [Review](M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md); [Gemini round-3 assignment](GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md).

**11 October reviewer switch:** Claude reviews while Codex is unavailable (rule 4); Gemini implements [M4 round-2 corrections](GEMINI_M4_ROUND2_CORRECTIONS_PROMPT_2026-10-11.md). #142 accepted, branch updated, check passed; #144 accepted as self-review and replaced by #146 on main. Owner confirmed Claude as the Git coordinator (merger) for now. [Review](REVIEWER_SWITCH_AND_PR_REVIEW_2026-10-11.md).

## Installed findings source fix accepted — 11 October 2026

PR #143 merged as `b178066` after independent review and exact-head required CI. The practice-history timestamp fix passes 10 focused regressions; the old screen fails the three rendered cases with the observed malformed-date symptom. Restore sets aside only three post-export receipt keys and protects all other metadata/records/files. Original PR #142 snapshots retain their FAIL/diffs. Historical helper: 98/99 checks on Node22/26; the schema13-vs-live14 anchor already fails on base (85/86). One nonblocking valid `__proto__` metadata-key omission is assigned to the next helper task; it causes refusal, not a false PASS or data loss.

[Independent review](PR143_PRACTICE_DATE_RESTORE_REVIEW_2026-10-11.md) · [One source-only schema-14 verification preparation assignment](MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md).

PR #142's owner-authorized administrator-account synthetic schema12→13 results are separate installed evidence, still an open evidence PR. They do not cover the current M3 schema14 binary or close standard-account/mid-save/signing/release gates. No installed re-run is performed by this review. M4 remains separately in flight; protected dirty checkouts and prior evidence are preserved.

## M4 integration corrections re-reviewed (round 2) — 11 October 2026

**CORRECTIONS REQUIRED: M4-R13–R22 (5 P1, 5 P2).** M3 production is integrated (PR #140 → `c32918b`, required check green), so accepted main ships migration 0014. Verified retained: R9 count/range/direction/nullable-lineage refusals and deletion guidance, R10 single-transaction replacement with trigger-fault rollback plus populated upgrade, reopen, real-file backup/drift/restore and cascade, R11 content-scoped progress, pre-opener bounds refusal and `retrySave()`, R12 real module-copy mutants and the pinned scratch artifact audit (recorded `pdf.mjs` digest matches executed bytes). Suites 21/7/2, exit 0 identically on Node 22.23.3 and 26.10.0.

Blockers to fix in order: R13 replace the post-await compensating rewrite with commit-time ownership that rejects an obsolete generation inside the durable commit (measured: the stale page 42 does reach storage; when the rewrite is forced to fail the database keeps 42 while the caller is told 3, silently); R14 no write may publish a content hash or printed label it does not own (measured: the rewrite stamps `SHA_A`/`printed-A-label` onto the newer page); R15 require a trusted destination count for successful `child_to_root`/`child_to_parent`; R16 bind printed label maps to content identity and carry it in the resolved record; R17 introduce the single validated destination record (material ID, coordinate space, content identity, physical page, trusted count) and consume it from resolver through opener and persistence, because the controller currently trusts the caller's `totalPages`. Then R18 (unreachable arithmetic guard / mis-named case), R19 (unknown identity must persist `unverified`, deterministically across lanes), R20 (manifest covers 20 of 26; receipts partly hardcoded — measure, don't assert; emit the manifest last and re-verify), R21 (bind the older-binary probe to the real `CURRENT_SCHEMA_VERSION = 14`, apply every shipped migration including 0014, and prove candidate coexistence inside the pack), R22 (make the PDF.js step resolvable from the pack itself, assert the engine per step, write receipts incrementally, and use the `legacy` entrypoint so the project Node 22 lane completes — reviewer-verified on both lanes with the same pinned 6.3.289, keeping the modern-build Node 22 failure as a labelled historical artifact).

Review evidence with reproducers for both engine lanes: [M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md), [evidence pack](evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/README.md); active assignment for the implementing model: [M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md).

M4 remains evidence-only — no production migration, dependency, backup-format or shipped-migration change, and no M4 production approval. OD-1–OD-10 stay proposed until preparation passes; do not present them to the owner now. M3-D1–D9 approval persists. Preserve the frozen prior packs, the two positive controls and all original failures. The submission worktree, primary checkout and M3 worktrees are untouched and stay that way. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; no installer, signing, release, provider call, physical test-account run or everyday-profile access.

## M3 production implementation reviewed and completed — 11 October 2026

The authorized first production slice is complete: migration 14, native/TS/browser transactions and restore guards, skills/debrief UI, history and explicit follow-up/status/confidence. Codex took over the interrupted implementation at the owner's request, fixed confirmed retry/draft/provenance/navigation defects, completed the browser-driver checks, strengthened two masked history-cursor regressions and finished evidence/benchmarks. Final local gate receipts and integration conditions are in the [review and completion report](M3_SKILLS_EVIDENCE_IMPLEMENTATION_REVIEW_AND_COMPLETION_2026-10-11.md). GitHub merge requires required checks for the exact published head.

M3-D1–D9 approval persists; shared accepted fixtures, shipped migrations and dependencies are preserved. M4 remains separately assigned preparation with OD-1–OD-10 proposed. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; this is source-level work, not installed/signing/release acceptance. [Next model-neutral reviewer handoff](M3_COMPLETION_NEXT_REVIEWER_PROMPT_2026-10-11.md).

## M4 integrated preparation re-review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R9–R12.** Retain the original behavior fixes and genuine PDF.js/file-backed SQLite demonstrations. Submitted22 tests pass on disclosed Node26; Node22 has a preserved scratch PDF.js Promise.try failure. Earlier current-source diagnostics10 pass; previous adapted cases14 pass/1 historical scanner failure legitimately superseded by real parser proof. New integration diagnostics14 failures/2 controls cover incomplete destinations, non-atomic identity/navigation validity and obsolete durable-save commits.

- [Independent integration re-review](M4_DOCUMENT_NAVIGATION_INTEGRATION_REREVIEW_2026-10-11.md).
- [One active model-neutral integrated correction assignment](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_PROMPT_2026-10-11.md).
- 32 current submitted paths frozen;28 current,40 previous and29 first-review checksums verify; original receipts/manifest6/6 archived exactly. Review snapshots are not M4 production acceptance. OD-1–OD-10 proposed; candidate unregistered. M3's production approval remains active; primary/M3 dirty worktrees untouched. G1–G3 deferred/unexecuted/unverified.

## M4 corrected preparation independent re-review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R5–R8.** The original ten diagnostics now pass against current source (frozen test bytes unchanged); submitted proof/SQLite tests 15 passed and Python probe3 checks passed. Independent new diagnostics reproduce13 failures with2 valid controls. Remaining work: complete numeric provenance/range validation, persisted replacement/restore proof, opener intent/save ownership, and truthful parser/artifact evidence plus conditional handoff.

- [Independent re-review](M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md).
- [One active model-neutral correction assignment](M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).
- 25 submitted paths frozen;21 current and29 earlier-review checksums verify. Review snapshot publication is not acceptance of M4 production. OD-1–OD-10 remain proposed; candidate migration remains unregistered. Claude's M3 production approval remains active. Protected dirty worktrees untouched; G1–G3 deferred/unexecuted/unverified.

## M3 production slice authorized — 11 October 2026

**Owner-approved M3-D1–D9 as written.** The owner approved the implementation task after independent corrected-scope acceptance. [Decision record](M3_SKILLS_EVIDENCE_OWNER_APPROVAL_2026-10-11.md); [one active model-neutral production assignment](M3_SKILLS_EVIDENCE_PRODUCTION_START_PROMPT_2026-10-11.md). Both former conditional gates are satisfied; earlier PROPOSED/pending-approval entries remain historical.

Implement one complete native/TypeScript/UI slice from current main in an isolated worktree, preserving the primary and preparation checkouts and parallel M4 work. Copy accepted fixtures, retain reviewed recovery contracts, and leave the implementation uncommitted/unpushed for independent review. No production code is implemented by this approval publication. G1–G3 remain deferred/unexecuted/unverified; M4, installed testing, signing and release are separate.

## M3 corrected scope/prototype accepted — 11 October 2026

**Preparation ACCEPTED; production awaits owner approval of M3-D1–D9.** M3-R8–R10 closed: independent 192 prototype tests / 3 opt-in skips, strict typecheck, 8 native tests, 7 TS/UI + 2 native frozen diagnostics, all exit 0; 7 independently sampled decisive reversions caught. 190 submitted hashes / 57 latest and 60 current-scope checksums / 7 document hashes / 30 anchors verify. Earlier correction history remains preserved.

- [Acceptance](M3_SKILLS_EVIDENCE_SCOPE_ACCEPTANCE_2026-10-11.md).
- [Nine proposed defaults](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md); [conditional production assignment](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md) activates only after owner approval.
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
- Report: [M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md).
- Evidence: [m3-skills-evidence-scope-remaining-corrections-2026-10-11](evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/README.md).

**Still true:**
- M3-D1–D9 remain **PROPOSED**; candidate 0014 is unchanged and unregistered; production is unchanged.
- The native writer and readers are unbuilt, and the UI evidence is jsdom only.
- G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.

## M3 interrupted correction package — 11 October 2026

**INCOMPLETE; continuation required.** The local R8–R10 code and tests pass a bounded independent completion audit: 191 prototype tests / 3 opt-in skips, strict typecheck, 8 native tests, 7 TS/UI and 2 native frozen diagnostics, all exit 0. The historical-equivalent diagnostic receipts, targeted new sensitivity proofs, current regeneration/validation-performance receipts, report/tracking updates and final manifests remain unfinished. Current checkpoint: 145/145 paths; production anchors: 30/30 unchanged. No source acceptance or implementation integration.

- [Completion review](M3_SKILLS_EVIDENCE_INTERRUPTED_WORK_COMPLETION_REVIEW_2026-10-11.md).
- [One active model-neutral continuation](M3_SKILLS_EVIDENCE_REMAINING_PACKAGE_CONTINUATION_PROMPT_2026-10-11.md), superseding the prior prompt for resuming this interrupted package.
- In-flight implementation remains local/uncommitted; both dirty worktrees preserved. M3 defaults remain proposed; candidate 0014 unregistered; G1–G3 deferred/unexecuted/unverified.

## M3 scope independent re-review — 11 October 2026

**CORRECTIONS REQUIRED, narrowed to M3-R8–R10.** Independently verified corrected baseline: 162 prototype tests passed / 2 opt-in skipped, strict typecheck clean, native 7 passed; earlier native diagnostics 5 passed. Most R1–R7 work is verified and retained. Remaining issues: full-draft metadata acknowledgment (R8), reverse history-to-receipt validation (R9), and cached-content eviction after confirmed erasure (R10). New diagnostics reproduce 6 TS/UI failures and 1 native failure with positive controls passing.

The reviewer corrected the earlier R2a diagnostic's invalid erase setup; the valid-argument equivalent fails on original source and passes on corrected source. The old unpaged R4 API is intentionally superseded. Do not reopen those settled corrections.

- [Independent re-review](M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md).
- [One active model-neutral correction assignment](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).
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
- Report: [M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md).
- Evidence: [m3-skills-evidence-scope-corrections-2026-10-11](evidence/m3-skills-evidence-scope-corrections-2026-10-11/README.md).
- Corrected [scope](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and [conditional implementation prompt](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).

**Still true:**
- M3-D1–D9 remain **PROPOSED**, pending owner approval.
- Candidate 0014 is unchanged and unregistered.
- Production code, migrations 0001–0013, dependencies and release configuration are unchanged.
- The native writer is specified, not built; the UI evidence is jsdom only.
- G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.
- The primary clone's Mac preflight work was left untouched.

## M3 scope/prototype independent review — 2026-10-10

**CORRECTIONS REQUIRED: M3-R1–R7.** The original 102 prototype tests, strict typecheck and 7 native tests pass independently, but frozen reviewer diagnostics reproduce 17 TS/UI failures and 3 native failures, with valid controls passing. Fix write/publication ownership, uncertain-save reconciliation and draft retention, StrictMode lifecycle, bounded access to every revision, receipt ownership, restored catalog rules and date-edit pagination before technical acceptance.

- Review: [M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md](M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md).
- Next model-neutral task: [M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md).
- Original submission/evidence published for collaboration, **not accepted**. M3-D1–D9 remain PROPOSED; conditional production assignment remains inactive. Candidate 0014 is evidence only, not registered.
- Original dirty M3 worktree and the primary clone's separate Mac preflight documents were preserved. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.


**10 October M3 skills and feedback evidence: scope and prototype PROPOSED, pending senior review.** Delivered together:
- the [scope](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md): contracts, UI flow, candidate schema and nine PROPOSED owner defaults (M3-D1–D9);
- the [evidence pack](evidence/m3-skills-evidence-scope-2026-10-10/README.md): candidate migration 0014, a runnable disposable prototype, shared fixtures, a rusqlite twin, receipts and SHA256SUMS;
- the [conditional implementation prompt](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).

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

**10 October active roadmap continuation — M3 skills and feedback evidence:** The owner requested continuing the roadmap after deferring installed Mac verification. [Next model-neutral assignment](M3_SKILLS_EVIDENCE_SCOPE_PROMPT_2026-10-10.md): deliver one scope/runnable disposable prototype/candidate-schema/conditional implementation package linking debrief observations to stable skills and follow-up actions, with honest attribution and retained history. New M3 defaults remain proposed until reviewed and approved; no production migration is activated by this handoff. Accepted M1/M2 source is preserved; remaining M2 UX requirements must be recorded rather than assumed complete. G1–G3 stay deferred/unexecuted/unverified; signing/release gates remain separate.

**10 October owner deferred installed Mac verification:** Do not execute the hfdtest G1–G3 assignment or request its login until the owner resumes it. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt recovery BLOCKED/source-covered. Source/preparation acceptance stands; ordinary roadmap development may continue under existing scope approvals. No everyday-account substitution or release-gate bypass is authorized. [Owner decision](MAC_INSTALLED_VERIFICATION_OWNER_DEFERRAL_2026-10-10.md).

**10 October Mac verification preparation accepted for integration:** MACV-R9–R11 senior integration review passed;13 focused/syntax/transfer commands exit0,23 submitted hashes/13 production anchors/66 final evidence entries/11 staged inputs verify. Original correction reports and receipts are historical and preserved. [Acceptance](MAC_SCHEMA13_INTEGRATION_ACCEPTANCE_2026-10-10.md); [next installed-verification prompt](MAC_SCHEMA13_INSTALLED_VERIFICATION_PROMPT_2026-10-10.md). G1–G3 remain UNEXECUTED/UNVERIFIED, post-receipt recovery BLOCKED/source-covered. Owner-authorized hfdtest/local ad hoc lane persists; no actual install, app launch, rebuild, provider or signing/release work. This review does not claim different-agent independence. Required exact-head GitHub checks must pass before merge.

**10 October MACV-R9–R11 implemented, pending independent review:** Production operator test/PATH bypasses removed; fixed account/workspace and run-bound permission recovery; complete-v3/SQLx migration13 checksum checks; checked installer and corrected canonical human walkthrough. Reviewer5 failures now pass with disclosed adapters. Helper86, frozen10/7/operator6, operator47, new helper44, installer15 pass;6/6 reverted boundaries fail. Staged11 inputs verify;13 production anchors, earlier27 frozen evidence/report/attribute files and4 installer artifacts unchanged. [Report](MAC_SCHEMA13_FINAL_CORRECTIONS_2026-10-10.md); [walkthrough](evidence/mac-schema13-final-corrections-2026-10-10/RUNBOOK-G1-G3.md). Work remains uncommitted/unpushed; no actual install/account/GUI/provider/signing/release work. G1–G3 UNEXECUTED/UNVERIFIED; post-receipt BLOCKED/source-covered. Earlier completion entries remain historical.

**10 October Mac schema-13 operator and full-comparison corrections: MACV-R7–R8 implemented, pending independent review; G1–G3 still UNEXECUTED.** Closes MACV-R7 (operator permissions, recovery, fail-closed path/account checks, human walkthrough) and MACV-R8 (complete database and schema comparisons, participating schema-13 tables/indexes/rows) together, read from `origin/main` `79fd8c5` (`docs/MAC_SCHEMA13_OPERATOR_REVIEW_2026-10-09.md`, `docs/MAC_SCHEMA13_OPERATOR_FINISH_PROMPT_2026-10-09.md`, reviewer pack) with `git show`; the dirty primary was not pulled/reset/stashed and 29/30 submitted hashes from last review match (only `scripts/mac-schema13-profile-snapshot.mjs` modified). MACV-R3 accepted and untouched — both `*-adhoc.dmg` candidates still hash `b3ead813…`/`ddb0594e…`, staged kit copies byte-identical, no rebuild/rebundle/re-sign. R7: separate task workspace `HFD_WORKSPACE` under `/Users/hfdtest/Downloads/hfd-schema13-workspace` separating readable kit inputs from UID 502 outputs; fail-closed account inspection (`dseditgroup` exit 2 refused); fail-closed path policy (rejects `..`, symlinks, clobbering, and self-nesting); versioned key-value backup mode record `hfd-backup-mode-record/1` parsed with `IFS='='` without whitespace splitting to handle "Application Support" spaces, dev:inode checks, and safe idempotent repeated recovery; corrected standalone human runbook (`RUNBOOK-G1-G3.md`) with explicit OLD relaunch, confirmed stopped checks, explicit task mountpoints, and pre-receipt abort recovery test followed by successful retry. R8: snapshot schema `hfd-mac-profile-snapshot/3` with per-object type and definition anchors; normalized definitions for all 6 migration 0013 objects; `unchanged` checks all 33 retained tables + both 0013 tables (counts, framed cell digest, column order, PKs), schema objects, definitions, ledger, and document anchors (added operation/lineage rows or altered indexes fail); `upgrade` requires genuine 12->13 ledger, empty initial 0013 tables, complete 0013 addition set matching shipped SQL; `restore` requires migrated structure and zero residual operation/lineage rows; `history` remains partial and ineligible for gate certification. Evidence: promoted reviewer operator diagnostics 21/21 passed (exit 0); promoted reviewer helper diagnostics 7/7 passed (exit 0); helper self-checks 86/86 passed (exit 0); frozen diagnostics 10/10 passed (exit 0); operator selftest 22/22 passed (exit 0); 7 revert sensitivity mutations all flipped to fail (`allFlippedToFail: true`); staged kit transfer 10/10 passed. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt recovery remains blocked/source-covered. [Corrections report](MAC_SCHEMA13_OPERATOR_CORRECTIONS_2026-10-10.md); [evidence pack](evidence/mac-schema13-operator-corrections-2026-10-10/README.md). Next: a human operator executes `RUNBOOK-G1-G3.md` inside `hfdtest` desktop session and returns screenshots + receipts; G1–G3 stay UNVERIFIED until observed; Developer ID/notarization/version/publication remain separate owner decisions. Uncommitted/unpushed.

**8 October Mac schema-13 helper + operator-kit corrections: MACV-R4–R6 closed in preparation; frozen diagnostics 10/10, self-check 74/74; G1–G3 still UNEXECUTED.** Closing `MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md` R4–R6 together, read from `origin/main` `8973df3` (PR #127) with `git show`; the dirty primary was not pulled/reset/stashed and **all 28 frozen submitted hashes verified 28/28 before editing** (no competing changes). MACV-R3 accepted and untouched — both `*-adhoc.dmg` candidates still `b3ead813…`/`ddb0594e…`, staged kit copies byte-identical, **no rebuild/rebundle/re-sign**. R4: process inspection is now *classified* (`stopped|running|error|unavailable|malformed`, only pgrep's documented exit 1 = stopped) with the refusal outside every catch and ahead of any DB/WAL/SHM read or copy; both candidate installs probed; operator CLI hard-requires uid 502 + `hfdtest` + non-admin (two fail-closed probes) + `realpath`-checked canonical approved root, so `--profile`/`--expect-uid` cannot retarget and no flag relaxes it (scratch fixtures only via an internal test path `parseArgs` cannot construct); symlink/hard-link/non-regular roots, sidecars and documents refuse; every `--json` is checked **before any read** against profile root, DB/WAL/SHM, managed documents and both input receipts by path **and dev:inode**, symlinked/relative destinations refuse, and the CLI never clobbers existing evidence (`wx`); a failed WAL copy cleans up and refuses, with originals re-hashed around the copy so a mid-copy change proves a live writer. R5: `quote()`/delimiter hashing replaced by a length-prefixed frame of table identity + ordered column identity + **real** primary key (declared-key mismatch or a PK-less table refuses), each cell by true `typeof()` — int64 via BigInt, REAL as 8-byte IEEE-754 (`1`/`1.0`/`-0.0`/`0.0` distinct), TEXT/BLOB as full `hex(col)` bytes because node:sqlite truncates TEXT at an embedded NUL — so the reviewer's NUL case now detects real SQLite bytes; inventory = shipped schema (33 retained tables **incl.** `practice_session_operations`/`card_review_operations`/`debrief_operations`) + ledger rows + schema-object digest + protected `documents/**` vs separately recorded runtime artifacts (`backups/**`, `last-run-version.txt`) + isolation facts; snapshots validated before any verdict (missing table/digest/inventory = refusal, never an empty-map pass); four contracts — `unchanged` (schema-12 refusal passes without demanding 0013 tables/version 13), `upgrade` (populated baseline, ledger prefix + 13, both tables present, only 0013's 2 tables + 4 indexes added), `restore` (retained history **and** document bytes identical; changed document fails alone), `history` (explicitly partial, `gateEligible:false`, never a gate); `verdict`/`retainedMeaning` live in the receipt and a v1 declared-subset capture can never certify a physical gate. R6: `RUNBOOK-G1-G3.md` is a standalone human kit staged with both accepted installers, fixtures A/B/C, the offline packet (`d5101e8c…`), the helper and `env.sh` under `/Users/Shared/hfd-schema13-kit-2026-10-08/` with `TRANSFERSHA256SUMS.txt` re-verified inside `hfdtest` (world-writable → mismatch means stop); Cmd-Q + `$HFD_OP stopped` before **every** snapshot/baseline/copy/switch (old A1/A7/B3/B6/B7/D3 live snapshots removed), one purpose per gate, corrected nested **C2 = root 141–160 of 1,050, 20 pages** (C1 120–140/21, A 3–7/5 kept) with copies 41→P and 141→B, no `…`/angle-bracket placeholders in executable commands, no `HOME`/`CODEX_HOME`, full backup sha256 + `manifest.json` + payload count/byte sum (the shared `0.5.3` cannot separate OLD from NEW), startup/safety artifacts not treated as refusal evidence. New `hfd-operator.sh`: never-deleting validated `move`/`copy` (lane + stop + absent destination + no self-nesting + whole-folder only → a rerun cannot nest/clobber; refusal-test profile moved to `profiles/schema12-refusal-test` and kept) and `block-backups`/`unblock-backups` that record the original mode and restore + verify it on success, failure **or** abort. Evidence: unmodified frozen harness (`14c40581…` = reviewer's published checksum) 3-pass/7-fail → **10/10 exit 0**; self-check **74/74 exit 0**, byte-reproducible ×3; 11 reverted behaviours mapped to the assertion each breaks (two non-biting cases disclosed); 15 operator-script cases pass with both profiles intact after refusals; 13 production anchors unchanged; `.gitattributes` untouched (pack has zero trailing-whitespace/CR, nothing ignored). No app source/migration/config/lockfile/candidate change; no GUI launch, install, signing, notarization, CI trigger, provider call or publication; everyday profile untouched; post-receipt recovery still **BLOCKED/source-covered** with the same unimplemented seam proposal. [Corrections report](MAC_SCHEMA13_HELPER_CORRECTIONS_2026-10-08.md); [evidence + operator kit walkthrough](evidence/mac-schema13-helper-corrections-2026-10-08/README.md). Next: a person runs the walkthrough in `hfdtest` and returns `$HFD_EVID` + `profiles/` + screenshots — G1–G3 stay UNVERIFIED until observed; Developer ID/notarization/version/publication remain separate owner decisions. Uncommitted/unpushed.

**8 October Mac schema-13 preparation corrections: MACV-R1–R3 closed; strict bundle verification now passes; G1–G3 still UNEXECUTED.** Closing `MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md`, read from `origin/main` `21581fc` (PR #126) with `git show`; the dirty primary was not pulled/reset/stashed and all 12 frozen submitted hashes + 13 source anchors verified 25/25 before editing (no competing changes). R3: the rejected builds carried only the linker's ad hoc signature (`adhoc,linker-signed`, `Info.plist=not bound`, `Sealed Resources=none`) so strict verification exited 1; rebundling the existing verified build products through a scoped `--config` overlay with Tauri's ad hoc identity `-` (no rebuild, no tracked config change) yields NEW `36a7b39` dmg `b3ead813…`/exe `82468893…` and OLD `2a6a415` dmg `ddb0594e…`/exe `2e44bfbb…` that pass `codesign --verify --strict` and `--verify --deep --strict` with **exit 0**, sealed resources and the real bundle id — re-verified by read-only remount with the reviewer's own commands. Still no Developer ID/team/ticket and `spctl` rejected: **local ad hoc, behaviour-only, not distributable**; rejected originals preserved byte-for-byte, old hashes not reused. R1: one chronological explicit/reversible walkthrough — OLD on a fresh task-owned schema-12 profile, populate via the installed UI (PDFs + offline packet `02-flashcards-and-test.json` `d5101e8c…`, complete the 2-question attempt, rate a card), export a genuine schema-12 `.hfdbackup`, quit + preserve the whole profile, NEW on the same active root, then profile switches with neither app running for the OLD refusal and the NEW restore; distinct `/Users/hfdtest/Applications/HFD-{NEW,OLD}-<sha>/` installs launched by full path with uid 502/non-admin/resolved-root/in-session hash confirmations. New `scripts/mac-schema13-profile-snapshot.mjs` (read-only; `_sqlx_migrations` authority not `user_version`; real table names; `quote()`-typed deterministic digests ordered by primary key; WAL read through a copy; refuses wrong uid/root and a running app) passes 8/8 isolated checks: unchanged control, modified-history detection, wrong-root and wrong-uid refusal, WAL fidelity, and applying the real shipped 0013 keeps retained history identical with ledger 13. R2: corrected all "of 400" (A is 10 pages → 3–7 is a 5-page child "of 10"; B is 1,050 → child at root 120–140 **of 1,050**, 21 pages, sibling 60–80), separated copy-page from the child's own page 1, added real direct and nested companion siblings with root-vs-parent grouping (different ranges ≠ different editions), fixed cancel semantics (before Save nothing exists; during Save dialogs are non-dismissible, Cancel disabled), and added a reachable installed failure/recovery through the pre-receipt `createBackup()` abort with zero-creation assertions and a successful retry. The post-receipt pending/reconcile/cancel subcase is **blocked / source-covered** (named native + UI tests, S1/S3) with the smallest separately reviewed debug-only seam proposed — no bypass, no mock sold as a physical pass. Two narrow `.gitattributes` `-whitespace` lines cover only the raw `hdiutil` receipts. No source/schema/provider/lockfile change; no GUI launch, install, signing, notarization, CI trigger or publication; everyday profile untouched. [Corrections report](MAC_SCHEMA13_PREPARATION_CORRECTIONS_2026-10-08.md); [evidence + runbook](evidence/mac-schema13-preparation-corrections-2026-10-08/README.md). Next: a person runs `RUNBOOK-G1-G3.md` in `hfdtest` and records observations — G1–G3 stay UNVERIFIED until then; Developer ID/notarization/version/publication remain separate owner decisions. Uncommitted/unpushed.

**8 October Mac schema-13 installed verification: candidates built + fixtures verified; G1–G3 PREPARED, UNEXECUTED.** Confirmed PR #125 MERGED (merge commit `36a7b39`; required `Checks` workflow SUCCESS, not bypassed); primary `/Users/rickymac/code/Flight-training-` was clean and fast-forwarded `2a6a415 → 36a7b39` (`main == origin/main`, clean), no competing changes on main, archival preservation branches untouched (read-only). The read-only preflight first showed the two owner prerequisites unmet (`P-TEST-ACCOUNT`/`P-SIGNING` = USER_ACTION, 0 code-signing identities, installed smoke 0/8, `readyForInstalledUse:false`). The owner then authorized, in-session, the isolated lane (`hfdtest`, standard non-admin, synthetic-only) **and** a fresh **local UNSIGNED** candidate from `36a7b39`. Built two local unsigned `aarch64` DMGs with the SDK pinned to MacOSX26.5 (default 27.0 is a recorded linker failure) — NEW schema-13 `36a7b39` (dmg `6aecab86…`, exe `9c7056c3…`) and OLD schema-12 `2a6a415` (dmg `455eb12d…`, exe `efc33cb8…`, `2a6a415` confirmed ancestor) — both `tauri build` exit 0; packages verified **read-only without launching** (mount → `codesign`/`plutil`/`lipo` → preflight `--app` → detach): arm64, `Signature=adhoc`, `TeamIdentifier=not set`, preflight integrity `failed`, not stapled, Gatekeeper rejected — **local unsigned, not Developer ID, not notarized, not distributable**; frozen v0.5.3 not reused/replaced, no tag/publish. Three synthetic PDF fixtures regenerate matching `MAC_PARITY_CHECKLIST` §4. Staged both DMGs for the operator at `/Users/rickymac/code/.qwen/tmp/schema13-candidates/`. **G1 smoke / G2 populated schema-12→13 upgrade / G3 older-backup restore + newer-binary refusal are PREPARED but UNEXECUTED** — need a person to install/launch in the `hfdtest` GUI session and record observables/screenshots per `docs/evidence/mac-schema13-verification-2026-10-08/RUNBOOK-G1-G3.md`; not run, not simulated, not marked pass; the schema-12 library is created via the OLD app, not forged by script. Nothing signed/notarized/published; everyday profile untouched; no env-var guessing. [Verification report](MAC_SCHEMA13_VERIFICATION_2026-10-08.md); [evidence](evidence/mac-schema13-verification-2026-10-08/README.md). Remaining owner action: a person executes G1–G3 in `hfdtest`; Developer ID/notarized distribution + a release version beyond `0.5.3` remain separate. Report + evidence uncommitted/unpushed.

**10 October Mac operator re-review — corrections required:** Earlier R7/R8 diagnostics pass independently (frozen10, helper7, operator6; helper86, expanded operator21, self-test22). New diagnostics expose5 failures: shipped operator test overrides and cross-run recovery; incomplete-v3 and missing13 restore PASS. The walkthrough also has incorrect executable hashes and missing launch/import/cleanup steps. [Review](MAC_SCHEMA13_OPERATOR_REREVIEW_2026-10-10.md); [active model-neutral correction](MAC_SCHEMA13_OPERATOR_FINAL_CORRECTIONS_PROMPT_2026-10-10.md). All13 production anchors and accepted installers unchanged;30 submitted paths frozen. Implementation remains dirty/pending acceptance; G1–G3 UNEXECUTED/UNVERIFIED. No build/install/account/provider/signing/release work. Older completion claims remain historical.

**9 October Mac schema13 operator/full-comparison review — R7/R8 corrections required:** Prior frozen10, helper74 and operator15 checks independently pass; all24 submitted and10 staged-kit hashes verify, production anchors unchanged. New scratch diagnostics: operator2 controls/4 failures (spaced-path unblock, account-error handling, traversal/symlink escapes); helper2 controls/5 failures (schema13 rows/schema changes ignored and missing0013 indexes accepted). Staged output roots also remain UID501/mode0755 and cannot be written by hfdtestUID502. Preserve candidate acceptance and previous fixes; finish safe per-user operator workspace/recovery and complete gate comparison in one round. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt installed subcase blocked. [Review](MAC_SCHEMA13_OPERATOR_REVIEW_2026-10-09.md); [active model-neutral finish assignment](MAC_SCHEMA13_OPERATOR_FINISH_PROMPT_2026-10-09.md). Dirty primary preserved; no unaccepted helper integration.

**8 October Mac schema-13 preparation re-review — MACV-R3 closed; R4–R6 corrections required:** Both corrected ad hoc candidates independently pass strict executable/bundle verification with matching hashes; no rebuild needed. All 22 submitted checksums and 13 original production anchors verify. Snapshot self-check passes8/8, but frozen isolated diagnostics yield3 controls pass/7 failures: swallowed live-app/inspection refusals, output overwriting a scratch DB, wrong refusal/restore comparison semantics, missing snapshot facts and embedded-NUL hash loss. Correct helper boundaries/digests and the standalone stopped-app operator sequence; nested C2 must map to root141–160. Source acceptance stands; G1–G3 and the post-receipt installed subcase remain unverified/blocked. Dirty primary and valid candidates preserved. [Re-review](MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md); [one active model-neutral assignment](MAC_SCHEMA13_HELPER_CORRECTIONS_PROMPT_2026-10-08.md). Submitted closure claims are historical inputs, not independent acceptance.

**8 October Mac schema-13 preparation independently reviewed — corrections required (MACV-R1–R3):** PR #125/source acceptance stands. Eight submitted evidence checksums, both staged DMG/executable hashes and all three PDF fixture hashes verify. Both exact app bundles fail strict signature verification (exit 1: missing signature resources); local ad hoc display is not an integrity pass. Correct the OLD/NEW profile/backup sequence with offline history seeding, fixture/page/sibling expectations and achievable failure cases, then prepare valid local ad hoc packages. G1–G3 remain UNEXECUTED/UNVERIFIED; no everyday-profile launch or public release. Original report/evidence and dirty tracking inputs are preserved unchanged; this review supersedes the submitted operator handoff. [Review](MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md); [active model-neutral correction assignment](MAC_SCHEMA13_PREPARATION_CORRECTIONS_PROMPT_2026-10-08.md). Original build logs are explicitly included in publication. Primary implementer changes were not overwritten.

**8 October split-lineage integrated after source acceptance:** Owner-approved SL-D1–D8, accepted round-5 scope, source implementation and both review/acceptance trails are published together. All 35 submitted source hashes, 32 implementation and 24 source-review checksums verify. F-1 is fixed with an atomic per-process sequence in the test helper; shipping behaviour is unchanged. [Integration and cleanup report](M2_SPLIT_LINEAGE_INTEGRATION_CLEANUP_2026-10-08.md). Local 980-change states are preserved in archive branches; primary will be synchronized after exact-head CI/merge. Installed Apple Silicon smoke, populated upgrade and older-backup restore remain unverified; signing/notarization/version/publication decisions remain separate. Earlier planning prompts are historical.

**8 October M2 split lineage production source ACCEPTED for integration:** Independent source review of `codex/m2-split-lineage-implementation` (base `2a6a415`, nothing staged), on an isolated copy. 35/35 source hashes and 32/32 pack checksums verify; 0001–0012 byte-identical, only 0013 added and byte-identical to the round-5 candidate (checksum `4118a789…b106`), schema 13. Reproduced: 110 focused Vitest, 41 focused native (single-threaded), typecheck, the 15-case validator contract across three engines, sensitivity S1–S5 caught and restored, full `npm test` 2,862/5 skipped, full `cargo test --all-targets` 444/6 ignored. Receipt bound to the owning material, source read once for the exact bytes split; webview cannot mint/edit/extend a receipt; save re-checks pending/source/path/nested-snapshot/id-collisions inside `BEGIN IMMEDIATE`; cancel removes only its own files; `verify_schema_13_lineage_semantics` == `validateSplitLineageState`; older binaries refuse schema 13; a populated schema-12 library upgrades with practice and card history intact. Disclosed Decision 1 (browser drivers read but do not write lineage; native sole writer, `executeMaterialsBatch`/`save_split_materials` stay generic) and Decision 2 (refused saves stay `pending` until reconcile-then-cancel) accepted against the scope. One non-blocking, pre-existing F-1: `documents.rs::split_test_root` `{pid}-{nanos}` temp dirs collide under default parallelism and can redden the native gate; unchanged from base, deterministic in the delivered tests, bounded fix proven. Publish scope + scope review/acceptance + owner approval + implementation + this source review in one PR. Remaining Mac gates: installed Apple Silicon smoke test, upgrade over populated data, restore of an older backup; no signing/packaging/version bump. [Source review](M2_SPLIT_LINEAGE_SOURCE_REVIEW_2026-10-08.md); [acceptance](M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md); [review pack](evidence/m2-split-lineage-source-review-2026-10-08/README.md).

**8 October M2 split lineage implemented, pending independent source review:** The owner approved SL-D1–D8 ("i approve SL-D1 through SL-D8"; recorded in the evidence pack). Production split-source lineage is implemented, uncommitted and unpushed, on `codex/m2-split-lineage-implementation` in the isolated worktree `/Users/rickymac/code/Flight-training-split-lineage-implementation`, base `2a6a415`. Migration 0013 (from the accepted round-5 candidate DDL) and schema 13; the native splitter fingerprints the exact bytes it splits and records a receipt, and a save accepts only that recorded receipt, re-checking the source, its file and a part's parent inside one immediate transaction; parts inherit the source's settings; cancel removes only a split's own files; read-back by operation id. A part's page shows its original and parent, each judged against its own current file, the other parts of the same copy, and a copy-page button. Native and TypeScript schema-13 restore validators agree on a 15-case shared contract. The earlier partial implementation (which did not compile and broke ordinary split saves) was replaced and is preserved in the evidence pack. The accepted split-lineage scope and its review documents are not yet on main. [Evidence and gate results](evidence/m2-split-lineage-implementation-2026-10-08/README.md). Installed-app, release and signing gates remain separate.

**8 October M2 split-source lineage scope SL-R12–SL-R13 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 5 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R12: Nested parent tier records immediate parent's title and file name in `parent_title` and `parent_file_name` while `source_*` preserves root snapshot; re-issuing an identical receipt uses plain INSERT with explicit existing-row policy (never INSERT OR REPLACE), preserving committed and cancelled statuses and refusing saves of cancelled receipts; tamper verification against `split_operation_log` is unconditional (save refused if table is absent); candidate DDL 0013 defines `split_operation_log.source_material_id` with `ON DELETE SET NULL` on nullable source ID, retaining operational history and reconciliation status when source handbook is deleted. SL-R13: Removed `cancelBatch` legacy 3-argument signature; strictly `cancelBatch(db, operationId)` unlinks only files recorded in that operation's receipt plan; deleted `round2CompatAdapter.mjs` and loader source-rewrite hook, using single resolve-only redirect loader; honest recording of retired cases without editing diagnostics (frozen round 2 has 4 pass / 2 retired receipt-less controls; round 2 reviewer has 8 pass / 3 retired controls 1–2 & case 11; round 3 reviewer has 10 pass / 2 retired case 11 DDL path & case 12 cancel signature; each mapped to permanent proof assertion); mutation runner pinned to `--test-reporter=tap`, matches test name and assertion message, exits 1 on miss, writes receipts only to output directory, killing 14/14 mutants identically across two independent runs (exit 0). Verbatim reviewer diagnostic `lineage-round4-review.test.mjs` passes 8/8 (exit 0); proof suite passes 18/18 (exit 0); frozen round 1 passes 7/7 (exit 0). [Corrected scope](M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-five evidence pack](evidence/m2-split-lineage-scope-round5-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October M2 split-source lineage scope SL-R10–SL-R11 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 4 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R10: Removed receipt-less save path entirely (`expectedParentSha256`, `currentParentBytes`, caller `parts` alongside receipt, caller operation ID, `parts[0].sourceTotalPages`, and 1,000-page fallback removed; missing or unreadable source file strictly refuses with verdict `missing`); typed `SplitSourceReceipt` is the sole authority; receipts are made tamper-evident and bound to the database via `split_operation_log` as `pending` with canonical JSON and hash; nested parent snapshot re-verification inside `BEGIN IMMEDIATE` matches lineage row and file path before writing (double-read check removed); page total is explicitly documented as engine page count at split time (production contract from `pdf.rs`, never webview). SL-R11: Moved `split_operation_log` into `candidate_migration_0013.sql` with `operation_id` PK, `source_material_id` FK (ON DELETE CASCADE), canonical JSON/hash, status CHECK (`pending | committed | cancelled`), and timestamps; omitted from test helper so 0001–0012 baseline strictly reflects shipped schema; operation IDs derived strictly from receipt; replay of committed receipt returns persisted rows; conflicting reuse of output IDs throws named `OutputMaterialAlreadyExistsError` before any write; reconciliation reads by operation ID; real `cancelBatch(db, operationId)` marks uncommitted operation `cancelled` and unlinks recorded staged files (no-op after commit; subsequent save of cancelled receipt refused). All 12/12 mutants killed by named assertions in sandboxed mutation runner (exit 0). Verbatim reviewer diagnostic `lineage-round3-review.test.mjs` passes 12/12 (exit 0); proof suite passes 18/18 (exit 0); frozen round-one diagnostic passes 7/7 (exit 0); frozen round-two diagnostic passes 6/6 (exit 0); superseded round-two reviewer diagnostic records 8 passed / 3 failed (exit 1) with controls 1–2 and case 11 disclosed as expected retirements under mandatory receipt enforcement. [Corrected scope](M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-four evidence pack](evidence/m2-split-lineage-scope-round4-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October M2 split-source lineage scope SL-R7–SL-R9 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 3 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R7: Defined typed `SplitSourceReceipt` as the sole accepted provenance input to save; parts carry only selection, title, and output identity with caller hash/root overrides rejected; file-read verification sits honestly outside SQLite transaction; in-transaction re-checks inside `BEGIN IMMEDIATE` verify source material exists, file path is unchanged, and nested parent lineage snapshot is unchanged before writing; bounds derived and bounded by receipt total; historical root snapshot preserved on root deletion (immediate parent never recorded as root). SL-R8: Tier classification is strictly structural (`nested_level = 1` AND `parent_page_start IS NULL` for direct; `nested_level > 1` for nested) and validated via candidate DDL CHECK constraints; two-tier verdicts return `parentStatus = 'unknown'` when parent content hash is NULL regardless of root match; sibling grouping strictly matches effective identity (root ID + root hash for direct, parent ID + parent hash for nested; unknown never matches anything). SL-R9: Cleanup runs exactly once per failed operation and only touches files owned by that operation (concurrent staged operations preserved); deterministic operation ID provides idempotency on resubmission without row/file duplication, and reconciliation reads by operation ID; rebuilt Contract 14 lifecycle seeds parent/child history in shipped 0001–0012, applies candidate 0013, saves split child with distinct file, adds retained-child histories, verifies changed verdict on source byte replacement, deletes parent, and verifies all history rows survive `foreign_keys` export/reopen; isolated mutation runner kills 8/8 mutants with named assertions (exit 0). Proof test passes 18/18 (exit 0); reviewer round-three verbatim diagnostic passes 11/11 (exit 0); frozen round-one diagnostic passes 7/7 (exit 0); frozen round-two diagnostic passes 6/6 (exit 0). [Corrected scope](M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-three evidence pack](evidence/m2-split-lineage-scope-round3-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October split-lineage scope re-review — SL-R4–SL-R6 corrections required:** Six document hashes and 9/20/18 evidence checksums verify. Independent corrected proof 15 pass; frozen diagnostic 7 pass; 4 actual mutations caught. New diagnostics: 2 controls pass / 4 failures. Direct-source tier verification/sibling editions (R4), mandatory source-context/nested save validation (R5), and lifecycle/rollback/mutation evidence (R6) require one bounded planning correction. [Specific re-review](M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md); [active model-neutral round-two assignment](M2_SPLIT_LINEAGE_SCOPE_ROUND2_PROMPT_2026-10-08.md). C2 remains accepted; SL-D1–D8 proposed; no production/installed/release activation. Earlier pending rows are historical.

**8 October split-lineage scope review — corrections required:** Six submitted hashes/nine evidence checksums verify. Submitted proof: 13 pass; independent frozen diagnostics: two controls pass/five assertion failures. SL-R1 requires explicit root/immediate-parent source versions, correct navigation coordinates and atomic save/stale-source contract; SL-R2 requires bounded mapping and real schema identity/type constraints; SL-R3 requires actual shipped-schema/history/restore evidence and real mutation sensitivity. [Review](M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md); [one model-neutral correction assignment](M2_SPLIT_LINEAGE_SCOPE_CORRECTIONS_PROMPT_2026-10-08.md). C2 remains accepted (PR #122); split lineage remains a proposed scope, SL-D1–D8 unapproved. No production/installed/release work activated.

**8 October C2 production source accepted for integration:** C2SRC-R1/R2 closed. All 32 source hashes, 57 original and 30 correction evidence checksums verify. Independent affected/frozen tests: 112 passed / 1 skipped; typecheck/build pass. R2's prior baseline precondition error is corrected in the acceptance; semantic revert independently fails at the real assertion. Submitted final gate: 2,808 frontend pass / 5 skips / zero unhandled; 420 Rust pass / 6 ignored. [Source acceptance](M2_CARD_REVIEW_C2_SOURCE_ACCEPTANCE_2026-10-08.md); containing source PR supplies exact-head CI and merge. Library-wide views are complete; split lineage and installed/platform M2 acceptance remain. [Next model-neutral split-lineage scope/proof assignment](M2_SPLIT_LINEAGE_SCOPE_PROMPT_2026-10-08.md). Earlier pending C2 rows are historical after merge. No signing/release activation.

**8 October C2SRC-R1/R2 corrected, pending independent re-review:** Both source-review findings are corrected, uncommitted and unpushed, in the same isolated worktree and branch (base/HEAD `cc84964`). R1: AppData now publishes a monotonic `dataRevision` that advances only with the snapshot that wins publication (startup, refresh, every completed mutation); Review due, History and the binder invalidate on it instead of the material/count/timestamp key, so same-count and same-timestamp replacements, state-only reviews and restore-like replacements are all picked up. R2: the history viewer follows its event by ID, shows the stream's current row with the event's own question and answer, and closes for good when the row leaves the list. The frozen reviewer diagnostic fails 3/3 at baseline and passes 3/3 unchanged on the final source; 9 permanent tests were added, and each fix reverted alone in a scratch copy is caught. Schema 12, the migration registry and all earlier evidence are unchanged. Not accepted: source re-review, installed and release gates remain separate. [Correction evidence](evidence/m2-card-review-c2-source-corrections-2026-10-07/README.md).

**7 October M2-4 card reviews C2 implemented, pending independent source review:** The owner approved C2-D1–D9 in the implementing session ("I approve C2-D1 through C2-D9"), recorded before any code in [OWNER_APPROVAL.md](evidence/m2-card-review-c2-implementation-2026-10-07/OWNER_APPROVAL.md). Library-wide Review due, card History and binder indicators are implemented, uncommitted and unpushed, on `codex/m2-card-review-c2-implementation` in the isolated worktree `/Users/rickymac/code/Flight-training-c2-implementation`, base `cc84964`. It includes bounded read-only native and browser readers that give identical results (a 35-call shared fixture), an owned stream controller with snapshot Retry, URL-synced tabs, a focused C1 session from Review due, and read-only history inspection. Schema 12 and all earlier C2 evidence packs are unchanged; no dependency, migration, provider, installed, signing or release work. [Evidence and gate results](evidence/m2-card-review-c2-implementation-2026-10-07/README.md); [requirement map](evidence/m2-card-review-c2-implementation-2026-10-07/REQUIREMENTS.md). The dirty planning clone is preserved. Source acceptance and installed/release gates remain separate.

**7 October C2 scope-proof accepted:** C2-E1–E3 closed. Independent eight frozen diagnostics 84/84, submitted proof 71/71 and final end-to-end controls 4/4 pass; mutation controls work. All 39 source hashes/35 evidence checksums and nine submitted packs verify. Actual audit: due 175/150/177; history 22/22/22; enrichment-only 3; combined 24. [Acceptance/defaults](M2_CARD_REVIEW_C2_ACCEPTANCE_2026-10-07.md); [next conditional model-neutral source assignment](M2_CARD_REVIEW_C2_IMPLEMENTATION_START_PROMPT_2026-10-07.md). C2-D1–D9 remain proposed pending owner approval; production C2 not yet activated. C1 and prior waiver persist. Dirty planning clone preserved. No installed/release acceptance claimed; previous correction rows historical.

**7 October C2 state-publication independent re-review — corrections required:** 39 submitted source hashes and 35 evidence checksums verify. Seven frozen diagnostics 74/74 and submitted proof 57/57 pass; prior six demonstrated failures fixed. New diagnostic: one control pass/nine failures across bounded filter-owned enrichment (C2-E1), complete provenance/action publication (E2) and latest-failed-read Retry ownership (E3). [Review](M2_CARD_REVIEW_C2_STATE_PUBLICATION_REREVIEW_2026-10-07.md); [one active model-neutral enrichment assignment](M2_CARD_REVIEW_C2_ENRICHMENT_CORRECTIONS_PROMPT_2026-10-07.md). All eight submitted packs and original dirty clone preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated; earlier review rows historical.

**7 October C2 contract-finish review — corrections required:** 45 submitted hashes and 41 evidence checksums verify. Six frozen diagnostics 67/67 and submitted proof 46/46 pass; mutation controls work. Six new assertion failures remain: failed-parse work reservation, controller issue publication, inspection route, priority-key domain, cross-page enrichment and untargeted provenance regression. Actual SQL calls due 175/150/177; history 22/22/22. [Review](M2_CARD_REVIEW_C2_CONTRACT_REVIEW_2026-10-07.md); [one active model-neutral state-publication assignment](M2_CARD_REVIEW_C2_STATE_PUBLICATION_PROMPT_2026-10-07.md). Dirty implementation clone and all seven submitted packs preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated. Earlier review rows are historical.

**7 October C2 bounded-read corrections re-review — corrections required:** 40 submitted source hashes and 36 evidence checksums verify. Five frozen diagnostics 56/56 and submitted proof 40/40 pass; mutation baseline/four kills/survival control work. Preserve prior progress. New frozen diagnostic: one supported-state control pass / ten failures across silent oversize loss, history absolute bound and mixed-size work admission (R4), incomplete/duplicate/noncanonical cursor fields (R8), and unsupported/invalid inspection state (R10). [Review](M2_CARD_REVIEW_C2_BOUNDS_REREVIEW_2026-10-07.md); [one active model-neutral contract-finish assignment](M2_CARD_REVIEW_C2_CONTRACT_FINISH_PROMPT_2026-10-07.md). Original dirty clone and all six submitted evidence packs preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated. Earlier review rows are historical.

**7 October C2 read-pipeline independent review — corrections required:** 38 submitted hashes and 34 evidence checksums verify. All 48 prior frozen cases and submitted 32-case proof pass; held-A/B mutation and survival controls work. New focused diagnostic: one control pass / seven assertion failures across actual work/byte accounting and history bounds (R4), generated cursor overflow/version/key shape (R8). Preserve authoritative refresh and operation ownership (R9), prior fixes and all five immutable submitted packs. [Review](M2_CARD_REVIEW_C2_PIPELINE_REVIEW_2026-10-07.md); [one active model-neutral bounded-read assignment](M2_CARD_REVIEW_C2_BOUNDED_READ_CORRECTIONS_PROMPT_2026-10-07.md). C2 remains unaccepted and D1–D9 proposed; C1 accepted. Original dirty planning clone unchanged; no production/installed/release work activated. Earlier review rows are historical.

**7 October C2 final-corrections re-review:** 34 submitted hashes verify; all 37 frozen cases and 24 submitted proof cases pass. Preserve filters, current-content revalidation, event identity, basic Retry, history/upgrade proof, actual batching and mutation survival enforcement. Focused follow-up: two controls pass / nine assertions fail across pending consumption/history cursor ownership (R8), authoritative reset/order and synchronous ownership (R9), and unenforced card/raw-byte caps (R4). Owner mutation still fails with its injected mutation removed. [Specific review](M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md); [one focused read-pipeline assignment](M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 remains accepted. The original dirty clone and all prior evidence are preserved. No production/installed/release work authorized.

**7 October C2 completion review — corrections required:** 32 delivery hashes verify; prior frozen diagnostics 9/9 and 12/12 and submitted proof 21/21 pass. Production parity, shipped-schema baseline and actual 3/2 SQL batching are verified. New focused diagnostic: two controls pass / 14 assertion failures across unapplied filters (R7), stale cached cursors (R8), controller event identity/retry/reconciliation (R9), and historical context (R10). Mutation verifier still reports success when expected failures are removed (R11); bounded performance/accounting claims need correction. [Review](M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md); [one active model-neutral correction assignment](M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 acceptance persists. Original dirty planning clone is preserved. No production/installed/release work activated.

**7 October C2 correction re-review:** Preserve nine fixed frozen cases. R1/R4/R5 remain incomplete; new R6 detects drift from C1 validation/scheduling. [Re-review](M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md): corrected proof 15 pass, prior diagnostic 9 pass, new diagnostic one pass/eleven fail. [Active completion assignment](M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md) finishes proof parity, actual-schema batching/ranking/ownership, asynchronous controller and restore/history contract before owner approval. Original dirty planning branch remains intact; read origin/main documents without overwriting it. No production/installed/release work authorized.

**7 October C2 planning review — correction assignment active:** [Review](M2_CARD_REVIEW_C2_SCOPE_REVIEW_2026-10-07.md) confirms C2-R1–R5. Independent submitted proof 15 pass; frozen diagnostics 2 pass/seven fail. [One detailed model-neutral correction prompt](M2_CARD_REVIEW_C2_SCOPE_CORRECTIONS_PROMPT_2026-10-07.md) finishes planning before independent acceptance and C2-D1–D9 owner decisions. Original dirty branch `codex/m2-card-review-c2-scope` in the Mac integration clone remains preserved at `9028675`; read review artifacts from origin/main without applying over it. C1 and its approved defaults remain accepted; no production/native/installed/release work authorized.

**7 October C1 source review accepted for integration:** C1-R1/R2 closed; 37 corrected source hashes, 14 correction and 45 original evidence checksums verify. Independent frozen/panel/dialog tests: 65 passes; integration typecheck/build pass. Submitted full frontend: 2,695 passes/four skips, zero unhandled; unchanged native Xcode evidence reused (415 passes/six ignores). [Acceptance](M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md); containing source PR requires exact-head CI and merge. C1 provides material-level durable card reviews with migration 0012 and no new dependency. [Next model-neutral C2 scope/query-proof assignment](M2_CARD_REVIEW_C2_SCOPE_PROMPT_2026-10-07.md) is planning only, with new product defaults pending later approval. Earlier C1 correction rows become historical after source merge. Installed/signing/release gates remain separate.

**7 October C1 source reviewed; two UI corrections required:** 37 submitted source hashes and 45 evidence checksums verify. Independent affected frontend: 105 passes. New deterministic hook diagnostic: two controls pass/four failures across C1-R1 session-start ownership and C1-R2 history-page ownership (including erased entries resurfacing in UI after reset; database stays erased). [Specific review/Xcode verification](M2_CARD_REVIEW_C1_REVIEW_2026-10-07.md); [one active model-neutral correction assignment](M2_CARD_REVIEW_C1_CORRECTIONS_PROMPT_2026-10-07.md). Xcode 27/SDK 27 native verification: 415 passes/six ignores; desktop debug compile/link, Clippy and fmt pass; arm64 binary declares macOS 12 minimum. C1 remains uncommitted/unaccepted in the Mac implementation clone; approved C-D1–C-D8 persist. No app launch, installed/signing/release verification. Earlier implementation/assignment rows are historical where superseded.

**6 October M2 card C1 authorized:** The owner [approved all eight defaults C-D1–C-D8](M2_CARD_REVIEW_OWNER_APPROVAL_2026-10-06.md) after independent corrected-scope acceptance (PR #108). [Active complete model-neutral C1 assignment](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md): implement material-level card reviews with `simple-v1`, durable version-owned scheduling and generation-protected reset, the next migration and disposable native/browser/UI verification. No repeat scope approval or real-user check-in is required. No new production dependency; implementer leaves changes uncommitted/unpushed for independent review. Prior accepted evidence is unchanged; source acceptance and installed/signing/release gates remain separate. Earlier pending-approval entries are historical.

**6 October M2 card scope accepted for planning:** CRS-R1/R2 closed; independent corrected proof passes 48/48, and all four proposal hashes, 18 correction-evidence checksums and 10 current-proof checksums verify. [Acceptance/defaults](M2_CARD_REVIEW_SCOPE_ACCEPTANCE_2026-10-06.md); [complete conditional model-neutral C1 assignment](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md). All eight product defaults remain pending explicit owner approval; no production dependency/schema/source implementation is activated by planning acceptance. The submitted Q1 mutation receipt had a binding error; independent correctly bound timing mutation proves assertion sensitivity. Prior correction prompts are completed/historical. PR2 acceptance and the check-in waiver persist; installed/signing/release gates remain unresolved.

**6 October M2 card scope reviewed — contract corrections required:** All four proposal hashes and 16 evidence checksums verify; independent submitted scheduler/research proof passes 27/27. Five new targeted planning diagnostics fail: queue timing/current-version filtering (CRS-R1), reset stale-request protection and repeated erase (CRS-R2). [Specific review](M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md); [one active model-neutral correction assignment](M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md). Draft scope/conditional C1 prompt are published for review, not accepted production scope. Scheduler/research work and PR2 acceptance are preserved; owner approval follows corrected scope acceptance. No production source/dependency/schema or installed/release work. Earlier rows are historical.

**6 October M2 PR2 source accepted:** Durable practice, completed-history navigation and explicit atomic erasure are independently reviewed, including R14 read recovery. All 32 submitted path hashes and 34 latest evidence checksums verify. Independent focused checks: 208 passes plus 21 actual import passes, zero unhandled errors; current-main full gate: 2,568 frontend passes/four skips, 391 Rust passes/six ignores, all source checks clean. [Acceptance](M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md) and the containing exact-head-green source PR supersede prior pending-correction entries. [Next model-neutral assignment](M2_CARD_REVIEW_SCOPE_PROMPT_2026-10-06.md): prepare card-review scope and an isolated open-source scheduler evaluation; new production scope/dependency approval remains separate. Installed/signing/release gates remain unresolved; no app launch or release work. Earlier rows are historical.

# Shared project handoff — Windows and Mac

M2 PR2 read recovery review, 6 October 2026: R11–R13 independently closed (160affected tests pass,zero unhandled). One remaining PR2 defect R14: MaterialDetail metadata reads have no rejection handlers; deterministic2failures/2unhandled errors. Those reads are new in PR2, not wholly accepted PR1. Scoped subprocess test timeout allowance approved; global/performance budgets unchanged. All29source/28completion evidence hashes verify. Source remains uncommitted/unaccepted as full PR2. See [review](M2_PRACTICE_SESSION_PR2_READ_RECOVERY_REVIEW_2026-10-06.md) and [active focused model-neutral assignment](M2_PRACTICE_SESSION_PR2_READ_RECOVERY_FIX_PROMPT_2026-10-06.md). Existing approval and controller fixes persist; older entries are historical.

M2 PR2 controller review, 6 October 2026: preserve verified R5–R10 work; StrictMode lifecycle and replacement-content read recovery remain blockers (R11/R12), with one supplementary direct-material lock defect (R13). Independent146frontend passes/3failures/1induced unhandled read rejection;5native erasure passes. All29source/35submitted evidence hashes verify. Answer-click start with acknowledged ordering accepted. Source remains uncommitted/unaccepted. See [review](M2_PRACTICE_SESSION_PR2_CONTROLLER_REVIEW_2026-10-06.md) and [active specific model-neutral correction](M2_PRACTICE_SESSION_PR2_CONTROLLER_FIX_PROMPT_2026-10-06.md). Existing approval/accepted PR1 persist; older review entries are historical.

M2 PR2 correction re-review, 5 October 2026: all ten original diagnostics pass; five remaining UI groups (R5–R9, eight failing assertions) and invalid full-gate claim (R10) require one bounded correction. Independent focused results: 84pass/8fail, zero runtime errors; isolated import21pass. Submitted full log contains two unhandled errors. Source remains uncommitted/unaccepted. See [specific review](M2_PRACTICE_SESSION_PR2_REREVIEW_2026-10-05.md) and [active model-neutral finishing assignment](M2_PRACTICE_SESSION_PR2_FINISH_CORRECTIONS_PROMPT_2026-10-05.md). Existing approval/accepted PR1 persist; older review rows below are historical.

M2 PR2 review, 5 October 2026: application source remains uncommitted; four confirmed UI confirmation/refresh/history-route/erasure-identity blockers remain. Independent focused results: 46 frontend passes, 9 new failures and 4 native erasure passes. See [review](M2_PRACTICE_SESSION_PR2_REVIEW_2026-10-05.md) and [correction assignment](M2_PRACTICE_SESSION_PR2_CORRECTIONS_PROMPT_2026-10-05.md). Existing approval and accepted PR1 remain effective.

M2 PR1 source review completed on 5 October 2026: R1–R4 and remaining startup/FK/rollback corrections verified; 2,498 frontend and 386 Rust tests pass. Integration is conditional on required CI before merge. See [completion review](M2_PRACTICE_SESSION_PR1_COMPLETION_REVIEW_2026-10-05.md) and [PR2 assignment](M2_PRACTICE_SESSION_PR2_PROMPT_2026-10-05.md). Installed/release gates remain separate.

**4 October M2 PR 1 initialization re-review — R3 still open:** [Review](M2_PRACTICE_SESSION_PR1_READINESS_REVIEW_2026-10-04.md) verifies all previous boundary fixes, 29 frontend passes and171 existing native passes. Three additional failures remain: browser invalid-state reopen, missing schema FK definition and conversion committed before semantic failure. [One focused model-neutral assignment](M2_PRACTICE_SESSION_PR1_READINESS_CORRECTIONS_PROMPT_2026-10-04.md) completes actual browser validation, FK metadata and atomic initialization while preserving closed fixes. Source stays uncommitted/unaccepted; PR2 and installed/signing/release work deferred.

**4 October M2 PR 1 R3 boundary review — source still pending correction:** [Review](M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_REVIEW_2026-10-04.md) verifies 29 frontend passes and all 166 backup/recovery/practice tests. Five boundary assertions still fail: wrong-key unique index, no-op ownership trigger, wrong receipt version, false unfinished totals and missing production validation/readiness. Keep verified R1/R2/R4 and earlier R3 fixes. [One concrete model-neutral assignment](M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_CORRECTIONS_PROMPT_2026-10-04.md) finishes already-approved R3 semantics/integration. Source stays uncommitted/unaccepted; PR2 and installed/signing/release work deferred.

**4 October M2 PR 1 corrections re-reviewed — R3 remains open:** [Independent re-review](M2_PRACTICE_SESSION_PR1_REREVIEW_2026-10-04.md) verifies original R1/R2/R4 correction behaviors and all 13 original diagnostics. Focused runs: 26 frontend passes; 27 native passes/six remaining archive-semantic failures. Source is uncommitted/unaccepted. [One focused model-neutral assignment](M2_PRACTICE_SESSION_PR1_VALIDATION_CORRECTIONS_PROMPT_2026-10-04.md) finishes the already-approved R3 contract while preserving closed fixes. PR2 and installed/signing/release work remain deferred.

**4 October M2 PR 1 independently reviewed — corrections required:** [Review](M2_PRACTICE_SESSION_PR1_REVIEW_2026-10-04.md) confirms M2P1-R1–R4: startup reconciliation/readiness, score/no-op timestamp accuracy, schema-11 archive validation and unsupported atomic-writer refusal. Independent disposable diagnostics: seven frontend failures; five native failures and one valid-schema control pass. All 26 submitted hashes still match. [One model-neutral correction assignment](M2_PRACTICE_SESSION_PR1_CORRECTIONS_PROMPT_2026-10-04.md) preserves owner-approved scope. Source remains uncommitted/unaccepted in the Mac integration checkout; PR 2 deferred. No installed/signing/release work. Older planning entries below are historical.

**4 October M2 practice-session proposal reviewed — scope corrections required:** [Independent planning review](M2_PRACTICE_SESSION_SCOPE_REVIEW_2026-10-04.md) keeps the user outcome/two-PR split and requests M2S-R1–R3: truthful retention, complete atomic replay/state contracts, and actual migration/version-writer/restore integration. The draft SQL was exercised only in a disposable in-memory diagnostic; no M2 production defect or implementation is claimed. [One model-neutral correction prompt](M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md) finishes the concrete proposal before owner approval. Original draft stays local/uncommitted; accepted Slice B and installed/signing/release status are unchanged.

**4 October Slice B source accepted:** [Independent acceptance](STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md) closes SB-R1/SB-R2 after verifying the 64-file correction receipt, 124 focused frontend and 65 native tests, and a full sequential integration gate (2,460 frontend pass/four skips; 336 Rust pass/six ignores; build/types/Clippy/fmt/lock/diff clean). The existing production Unicode library is pinned exactly to 0.1.25; no newly resolved package/version. The containing source PR supplies the final CI/merge record. [Next model-neutral assignment](M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) prepares a bounded resumable-practice-test scope for owner approval; no further implementation or migration is authorized yet. MAC-23 / TB-INST-01–04 remain UNVERIFIED. No installed/account/provider/signing/packaging/release work. Older pending-review snapshots below are historical.

**4 October Slice B SB-R1/SB-R2 corrected, pending Codex re-review:** The confirmation preview now displays full inspectable content (guide summary/sections/notes, flashcards front/back, structured questions, choices, answers, explanations) and per-item unverified source references; choice IDs are disclosed in discard reporting and counts include choices and references; explicit absence wording handles guide-only and test-only packets; upload and answers disclaimer states nothing is uploaded and answers come from the packet. SB-R2 promotes the already-locked `unicode-normalization` 0.1.25 crate to a direct dependency in `src-tauri/Cargo.toml` without any new resolved package/version, enforcing full NFC in native line/block normalizers before bounds, title comparison, duplicate choice detection, and idempotent retries. Shared contract fixtures extended to 49 cases. Permanent regressions added for both findings with demonstrated fail-before/pass-after. Full sequential local gate passed (typecheck, 2,460 npm tests pass / 4 skips, build, 336 cargo tests pass / 6 ignored, clippy -D warnings, cargo fmt --check, test:cargo-lock, git diff --check). Implementation remains uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on `codex/structured-study-import-slice-b`. Four installed observations (TB-INST-01–04, MAC-23) remain UNVERIFIED. No release, signing, packaging, account or migration work.

**4 October Slice B implementation review — two corrections required:** [Independent review](STRUCTURED_STUDY_IMPORT_SLICE_B_REVIEW_2026-10-04.md) verifies all 48 submitted hashes, 110 focused frontend tests and 60 native tests. SB-R1 omits inspectable content and per-item references from the confirmation preview; SB-R2 omits native NFC (two failed diagnostics each, with passing TypeScript controls). [One active model-neutral correction assignment](STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md) supersedes the initial assignment for remaining work. It permits only promoting the already-locked unicode-normalization 0.1.25 crate for SB-R2; no new resolved package/version. Implementation remains local, uncommitted and unaccepted. Owner D1–D9 approval, A2 acceptance and check-in waiver persist. Four installed observations remain UNVERIFIED; no account, signing, packaging or release work. Earlier implementation/gate snapshots below are historical where superseded.

**4 October Slice B authorized:** The owner [approved scoped study-packet import and all D1–D9 defaults](STRUCTURED_STUDY_IMPORT_SLICE_B_OWNER_APPROVAL_2026-10-04.md), including the older-version limitation. A2 acceptance and the M2 check-in waiver remain in force. [Active model-neutral implementation assignment](STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) implements preview, create-new atomic save, offline reopening and provenance using accepted Zod. No new dependency/migration/replacement/Markdown or release work. The 65 source/development requirements are in scope; four installed observations remain unverified. Earlier pending-scope entries are historical.

**4 October Mac release preparation accepted:** [Final independent acceptance](MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md) closes RELPREP-R1–R3, including cleanup resilience. All 41 assertions pass independently (32 executable synthetic cases, 9 structural checks); the original diagnostic confirms credential cleanup proceeds and reports failure correctly. [Preparation package](MAC_RELEASE_PREPARATION_2026-10-04.md) and the inactive signing proposal are integrated. Signing credentials/lane, version decision, actual packaging and installed verification remain release prerequisites. [Conditional model-neutral continuation](MAC_RELEASE_CONTINUATION_PROMPT_2026-10-04.md). No signing workflow activation, testing-account work or release publication occurred. Older pending-review entries are historical.

**Mac release cleanup re-review (4 October 2026):** [Independent result](MAC_RELEASE_PREPARATION_CLEANUP_REVIEW_2026-10-04.md): R2b and the main R2a state-transfer corrections accepted; state-file removal failure can abort credential cleanup under GitHub Bash options. All submitted checks pass (37 printed assertions, not the claimed 35). [Focused model-neutral correction](MAC_RELEASE_PREPARATION_CLEANUP_FIX_PROMPT_2026-10-04.md). Proposal remains inactive; no testing-account work or release publication.

**4 October release-proposal re-review:** [Independent checks](MAC_RELEASE_PREPARATION_REREVIEW_2026-10-04.md) accept RELPREP-R1/R3 and pass all 24 submitted synthetic cases. RELPREP-R2 remains for multiline keychain-state/cleanup handling and a manual/main guard before credentials are supplied. [Focused model-neutral assignment](MAC_RELEASE_PREPARATION_WORKFLOW_FIX_PROMPT_2026-10-04.md) covers only those fixes. The proposal remains inactive; implementation/source are preserved; no package rebuild or account work is assigned. Installed/signing/release approval remains unresolved.

**4 October Mac release preparation review — corrections required:** [Independent review](MAC_RELEASE_PREPARATION_REVIEW_2026-10-04.md) verifies the local DMG bytes/hash but finds a corrupt non-active signing patch, incomplete identity/validation guards and incorrect source/observation claims. [Implementation correction assignment](MAC_RELEASE_PREPARATION_CORRECTIONS_PROMPT_2026-10-04.md) targets one bounded proposal/evidence pass without rebuilding or launching the app. Implementer work and active workflows are preserved. Owner has deferred test-account work; installed/signing/release gates remain unverified. A2 source acceptance remains intact.

**Current Mac A2 re-review (4 October):** [Native case-alias regression independently passes](MAC_A2_VERIFICATION_REREVIEW_2026-10-04.md); 29 handoff hashes and 15 mirror pairs verify. [Claude finishes one evidence-only pass](CLAUDE_MAC_A2_VERIFICATION_FINAL_EVIDENCE_PROMPT_2026-10-04.md) before Codex integration. No production change or full matrix is reassigned. Owner priority is a testable Mac build after acceptance, with dedicated-account/signing/installed prerequisites retained.

Updated 4 October 2026. **Both machines start here after fetching GitHub.** Task state, plans, review findings, prompts and sanitized evidence must be shared in this repository or a linked PR; do not rely on private chat history or another computer's local files.

Repository: https://github.com/rickydeleon49-ui/Flight-training-. Each machine chooses its own clone location. References to historical `H:`/Windows paths in old notes describe the original review environment, not required paths on the Mac.

## Current state and ownership

**4 October final Mac A2 review accepted:** [Independent acceptance](MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md) closes MVER-R1–R3 and publishes the native regression plus corrected evidence. Production source is unchanged. The owner has deferred test-account work and will wait for a release; no installed testing is authorized by that decision. Apple Developer membership is not available. Installed/signing/release checks remain unverified. [Next Claude assignment](CLAUDE_MAC_RELEASE_PREPARATION_PROMPT_2026-10-04.md) prepares a reviewable release path without launching the app or publishing a release. Older pending-review entries below are historical.

**Current Mac verification review (4 October):** [MVER-R1–R3 corrections requested](MAC_A2_VERIFICATION_REVIEW_2026-10-04.md); [Claude handles the focused follow-up](CLAUDE_MAC_A2_VERIFICATION_CORRECTIONS_PROMPT_2026-10-04.md). Submitted report/evidence remain uncommitted in the existing Mac verification checkout. A2 accepted source stays merged; no installed certification or new roadmap slice follows this review.

**Current owner decision (4 October):** [M2 real-user check-in waived](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md). A2 is accepted and merged through PR #78 (`5587251`); [Claude verifies the published source on the Mac](CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md). Other Slice B decisions and installed/signing/release prerequisites remain separate. Use this decision when evaluating older gate snapshots.

**Primary platform:** the owner confirmed the main user will use the Mac. Follow [the Mac-first development/readiness plan](MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md). Reviewed source and evidence must be available through GitHub and validated here; preserve Claude's active Mac baseline and the Windows A2 owner. [Sanitized Mac verification receipt](evidence/mac-source-evaluation-2026-10-02/VERIFICATION_RECEIPT.md) is shared for cross-machine review.

This is a dated handoff snapshot. Read current STATUS, the branch/PR and its exact head before editing; update this table when ownership or acceptance changes.

| Work | Shared source/evidence | State / next action |
| --- | --- | --- |
| A1 restore retention/restart safety | Main via [PR #42](https://github.com/rickydeleon49-ui/Flight-training-/pull/42); [acceptance](RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md) | Shared-source repair merged. Preserve its recovery/backup guarantees. |
| Mac onboarding | Main via [PR #43](https://github.com/rickydeleon49-ui/Flight-training-/pull/43); [Mac guide](MAC_GITHUB_HANDOFF_2026-10-02.md) | GitHub-only setup, fixtures, prompt and report template available. |
| Physical Mac source evaluation | Mac branch `codex/mac-source-evaluation-report`; [draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44) | Source and packaging evidence incorporated with the accepted baseline publication. PR #44 is superseded once that publication merges. Signing findings retained; installed smoke tests pending a dedicated test account and acceptable signing state. |
| A2 atomic material saves | [Mac acceptance](MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md), [Mac report](MAC_A2_VERIFICATION_2026-10-04.md), [evidence](evidence/mac-a2-verification-2026-10-04/README.md); source PR #78 | MVER-R1–R3 closed by independent review. The Mac case-alias regression and APFS evidence are accepted for source integration. Installed behavior and signing remain UNVERIFIED. Owner will wait for a release and has deferred test-account work; M2 waiver persists; Slice B scoped approval/D1–D9 remain separate. |
| A3–A6 audit work | [Full audit](FULL_REPOSITORY_AUDIT_2026-09-29.md) and STATUS | A3/A4 source merged; A6 source accepted for publication. A5 corrections already exist in tooling; verify remaining Mac evidence rather than rewrite them. Installed gates remain open. |
| A3 WebKit compatibility (Claude) | Main via [PR #48](https://github.com/rickydeleon49-ui/Flight-training-/pull/48), merge `1ae6986`; [acceptance](MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md), [report](MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md) | R1–R4 source corrections merged after required CI passed on reviewed head `fc5c391`. Historical draft PR #47 is incorporated. Installed macOS 12.0–12.2, current WKWebView and VoiceOver remain UNVERIFIED. |
| A4 saved study content offline (Claude) | Main via [PR #49](https://github.com/rickydeleon49-ui/Flight-training-/pull/49), merge `db15394`; [acceptance](MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md), [report](MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md) | Source merged after required CI passed on reviewed head `c4bed81`. Saved content is available independently of generation; installed offline (MAC-19) remains UNVERIFIED. |
| A6 Gemini retry wording (Claude) | Main via [PR #50](https://github.com/rickydeleon49-ui/Flight-training-/pull/50), merge `b5bf8e0`; [acceptance](MAC_A6_RETRY_WORDING_ACCEPTANCE_2026-10-02.md), [report](MAC_A6_RETRY_WORDING_IMPLEMENTATION_2026-10-02.md) | Source merged after required CI passed on reviewed head `e25d940`. Retry wording corrected; live/installed behavior remains UNVERIFIED. |
| A5 evidence reconciliation (Claude) | `codex/mac-a5-evidence-reconciliation`, base `b5bf8e0`; [acceptance](MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md), [report](MAC_A5_EVIDENCE_RECONCILIATION_2026-10-02.md), [receipts](evidence/mac-a5-reconciliation-2026-10-02/README.md) | Documentation/evidence accepted for required CI/merge. Source unchanged; fixture/archive/native/PDFKit evidence reconciled with limits. Windows/Mac split-size cause unknown; installed checks remain UNVERIFIED. [Claude A2 preparation](CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md) follows publication. |
| Mac Study Library baseline (Claude) | Reviewed branch `codex/mac-study-library-baseline`, original base `a4339fc`; [report](MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md), [evidence](evidence/mac-study-baseline-2026-10-02/README.md) | [R1–R3 source/evidence accepted independently](MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md), committed for exact-head CI and merge. MiniSearch no-go. No virtualization adoption justified for the initial 100/200-card displays; expanded displays up to 1,000 cards are measured in jsdom and remain an open question needing installed evidence. Installed testing is not started (account and signing prerequisites unmet). |
| Open-source reuse | [Research](OPEN_SOURCE_REUSE_RESEARCH_2026-10-01.md), [plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md), [Slice A source acceptance](STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md) | First production adoption: exactly Zod 4.6.5 under the narrow Slice A exception, with jitless validation and notice. MiniSearch remains no-go; other packages remain gated. Installed compatibility is UNVERIFIED. |
| M2 study sessions / outside-assistant import | [M2 design](M2_STUDY_LIBRARY_DESIGN_2026-09-27.md), [contract](STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md), [Slice A acceptance](STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md), [B preparation acceptance](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_ACCEPTANCE_2026-10-03.md) | Slice A merged via PR #62. BPREP-R1–R4 closed as specifications; accepted [plan](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) and [owner-approved implementation prompt](STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) have 69 planned tests. A2 is accepted/published via PR #78 and the [real-user check-in is waived](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md). Scoped approval/D1–D9 are now recorded in the owner approval; installed/release gates remain separate. The [older gate review](STRUCTURED_STUDY_IMPORT_SLICE_B_GATE_REVIEW_2026-10-03.md) records the earlier correct stop; its A2/check-in observations are superseded. No duplicate preparation is assigned. Slice B UI/save source is [independently accepted](STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md); SB-R1/SB-R2 are closed. [Next scope assignment](M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) prepares resumable practice tests for owner approval. No migration or Markdown adoption is approved. |
| Release | [Review process](RELEASE_REVIEW_PROCESS.md) and [Mac tracker](MAC_PARITY_CHECKLIST.md) | Windows hold on v0.5.1; v0.5.2 retired; frozen v0.5.3 Mac candidate held. No publication or candidate replacement authorized here. |
| Mac installed readiness / signing (Claude) | Local `codex/mac-installed-readiness-preparation`, base `8b15948`; [runbook](MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md), [preflight](MAC_READINESS_PREFLIGHT.md), [evidence](evidence/mac-installed-readiness-preparation-2026-10-03/README.md) | [Accepted for source integration](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md): R1–R4 closed, 85 focused tests passed with 1 deliberate skip. Installed phases 1–8 are UNVERIFIED. Owner actions: a standard test account; confirm private-repository environment eligibility; the signing decision and credentials. |

## Handoff rules for every task

Follow the owner's [development and review workflow](PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md). Codex serves as senior software developer and independent reviewer, with responsibility for precise work, focused reviews and steady delivery pace.

1. Before work, fetch the remote and record repository, branch, base/head SHA, clean/dirty state, owner/role and machine. Inspect ongoing PRs. Never reset, stash, force-push or edit another machine's branch to make it match yours.
2. Assign one implementer and one Git coordinator at a time. Claude/Gemini roles can switch when the user says so; the handoff must record the active assignment. Mac evidence and Windows source corrections may proceed independently, but avoid simultaneous edits to the same branch/file.
3. Implement locally, run focused tests for each substantive change, then one complete required local gate after corrections. Leave source uncommitted for independent review under the current workflow. Share the implementation report and next prompt using [the task template](templates/TASK_HANDOFF_TEMPLATE.md).
4. Codex owns independent review and reviewed commit/push/PR/exact-head-CI/merge unless the user explicitly assigns another coordinator. If Codex usage is unavailable, the user's designated Claude reviewer may take over; record that switch rather than silently self-reviewing. Do not push known failing source just to share or debug it.
5. A report can be shared on a documentation-only draft PR without including broken source. State whether code is local, on a branch, merged or unavailable. Never claim a handoff is executable on the other computer when its required source exists only locally.
6. Store important plans, review notes, correction prompts, sanitized logs/receipts and final decisions under docs, linked from STATUS and this index. Use repository-relative paths and exact source/artifact identities. Include failing attempts and conditional skips; do not upload only a favorable run.
7. Keep API keys/tokens, real databases, private documents, large generated PDFs, installers, node_modules and target out of Git. Share concise sanitized evidence and hashes; keep protected raw evidence local and label any review limitation. Public upstream source should be linked/pinned rather than copied indiscriminately.
8. Review locally before the one intended push. Use required CI as the final gate, with docs-only checks where appropriate. Do not start duplicate full matrices, duplicate background processes or speculative CI runs. Resolve failures locally, then apply one focused correction if a runner-specific issue remains.
9. Before merge verify exact PR-head checks, current main, intended diff, migrations/lockfiles/configuration and independent acceptance. After merge confirm merged state, origin/main, a clean synchronized coordinator checkout and safe branch cleanup. Preserve another machine's dirty work; it must deliberately reconcile the new main before its own PR.
10. Update this index, STATUS and MAC_PARITY_CHECKLIST for relevant shared changes. Distinguish source tests, development/browser tests, DMG packaging, signing assessment and installed-app smoke tests. Neither machine's test results automatically certify the other platform or macOS 12.

## Continue on the Mac

- **Current next assignment:** after the containing A2 source PR merges, run [the accepted-source A2 Mac verification prompt](CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md). Earlier source-unavailable observations remain historical; do not repeat preparation or claim installed readiness.

- [Slice A is merged and independently accepted](STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md) via PR #62. [B preparation is accepted](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_ACCEPTANCE_2026-10-03.md); use the [active model-neutral implementation prompt](STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) for one current gate check and implementation only when all prerequisites clear. No further preparation rewrite is assigned. B/C, installed and release gates remain unchanged.

- Installed-readiness preparation is delivered locally, corrected for the [Codex readiness review](MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md) (R1–R4), and [accepted for source integration](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md): the [runbook and signing package](MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md) and the [read-only preflight](MAC_READINESS_PREFLIGHT.md). Next gate: the owner provides a standard test account and makes the signing decision; then run phase 1 on the artifact the owner selects. No installed result exists yet.

- Completed preparation assignment: [Claude’s read-only Mac readiness tool and isolated installation/signing runbook](CLAUDE_MAC_INSTALLED_READINESS_PREPARATION_PROMPT_2026-10-03.md). The [corrected A2 preparation is accepted](MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md); matching A2 source and actual installed-account/signing prerequisites remain open.

- Current outcome: A3/A4/A6 are merged (PRs #48/#49/#50), and [A5 evidence is accepted](MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md) for documentation publication. After required CI/merge and clean Mac synchronization, use [Claude's A2 verification-preparation prompt](CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md). A2 still needs its Windows owner's matching reviewed source; preparation can proceed while dependent verification waits. The [A2 preparation package](MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md), corrected for PREP-R1 to R3, is [independently accepted for publication](MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md). Mac execution waits for that accepted, published source. Installed-test account/signing gates remain unmet.

- Completed baseline assignment (review and corrected acceptance retained): [Claude Mac baseline prompt](CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md), with [report review and measurement limits](MAC_REPORT_REVIEW_2026-10-02.md). Claude implements the bounded synthetic baseline and candidate recommendation; Codex reviews. No production dependency adoption or M2 migration is assigned by this task.

- Existing task: [Mac session prompt](MAC_SESSION_PROMPT.md), with the source-evaluation report incorporated from PR #44. Continue missing observed smoke tests safely; do not blindly repeat unchanged successful commands.
- Future reuse work: [open-source Mac prompt](OPEN_SOURCE_MAC_HANDOFF.md). Start with source/evidence review and measured baselines, not package installation.
- Pending source correction contract: [A2 R6/R7 prompt](A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md). It cannot run against main until its matching implementation is made available under the review workflow.

Research star counts, license observations and peer ranges are October 1 snapshots, not current-version guarantees. Re-check the selected version and source boundary before taking code. Follow ROADMAP and the existing data/security guarantees; this index does not authorize release or new migrations.

[Publication contents and local validation receipt](SHARED_HANDOFF_PUBLICATION_2026-10-02.md).


## 2026-10-07 — C2 production source review

C2-D1–D9 approval is recorded; source remains uncommitted in the isolated implementation checkout. Independent review requests C2SRC-R1 (same-count/timestamp content invalidation) and C2SRC-R2 (open history inspection provenance). Existing affected frontend tests: 100 passed / 1 skipped; typecheck clean; five focused native tests passed. Three frozen UI diagnostics fail by assertion. Source is not accepted. See [source review](M2_CARD_REVIEW_C2_SOURCE_REVIEW_2026-10-07.md) and [correction prompt](M2_CARD_REVIEW_C2_SOURCE_CORRECTIONS_PROMPT_2026-10-07.md).
