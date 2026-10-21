## Competitive research: App Store and web — 21 October 2026

[Report](docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md), [method](docs/research/competitive-apps-2026-10-21/README.md) and provenance records cover 18 app metadata snapshots, 120 unique manually read public reviews across 15 apps, and official/web sources. Research-only recommendations reuse existing roadmap groups; no new feature or performance/readiness acceptance. Prepared against main `f2cf79f` after PR #258. Public review allegations and learning outcomes are unverified; sample counts are not customer-wide preference statistics. The owner wants research available on GitHub; Claude retains independent review/merge ownership.

## Offline training differentiation research and roadmap — 21 October 2026

Owner-requested **documentation only**, prepared by Codex on inspected main `2b5b146` (PR #256). [Research and primary sources](docs/OFFLINE_TRAINING_RESEARCH_2026-10-21.md), [six-feature implementation roadmap](docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md) and [review/publication handoff](docs/OFFLINE_TRAINING_RESEARCH_HANDOFF_2026-10-21.md). Current code already supplies attempts/reviews, `simple-v1`, navigation, PDF kits and homework card runs; the plan extends these and preserves the owner queue. It corrects the earlier competitive comparison: Google documents resumed card progress/missed-card review, so the proposed advantage is the complete offline training loop and trustworthy provenance. No feature, dependency, migration, runtime switch or release changed; no new app/device/performance result is claimed. Owner explicitly requested GitHub publication on 21 October: Codex may commit/push this documentation review branch and open its PR; Claude retains independent review and merge ownership. Earlier status entries below retain historical states, not current Git integration claims.

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

## Three v0.5.7 maintenance follow-ups tracked — 19 October 2026

[Actionable scope](docs/V057_MAINTENANCE_FOLLOWUPS_2026-10-19.md): **V057-UI-01** clipped Gemini-dialog Cancel; **V057-DB-01** classify backup/restore sidecars before any safe owned-temp cleanup; **REL-CI-01** cold/warm release Check budget and cache completion. GitHub confirms the 20-minute timeout occurred after Rust tests passed, during the lockfile check. These are planning/investigation items, not implemented fixes. Sidecars are not automatically cosmetic or disposable. Preserve offline study → homework → exports/current assignments; escalate only confirmed data risk. No application, database/profile or workflow was changed by this update.

## Offline study, homework and exports prioritized by owner — 18 October 2026 Pacific

Planning approved, not implemented: after the current release and any already-assigned task, prioritize **offline study → homework → exports**. This replaces the older unstarted scheduler/weather/FAA next-task order; those items and accepted evidence remain queued. [Detailed plan](docs/OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md), [focused OSS research](docs/OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md). Start OFFLINE-01 first; PDF passage search must cover saved study content with honest per-page/scan states and zero provider calls. Homework reuses actions/lessons/history; exports extend the existing one-material JSON/print route. Seven actual upstream repos rechecked above 1,000 stars; no dependency adopted. No app, schema, profile, installer or release changed by this planning task. Earlier entries remain historical; inspect live release/assignment status before starting.

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

## Study Guide hub directions approved — 17 October 2026

Owner approved all eight recommendations, recorded as STUDY-HUB-01–08 in ROADMAP, in this order: source-linked explanations; connected topics; corrections/version handling; explainable study sessions; better wrong-answer explanations; questions grounded in selected documents; study-informed lesson preparation; visible processing quality. [Detailed acceptance criteria](docs/STUDY_HUB_ROADMAP_2026-10-17.md). Planning only; retain the current P54 queue and active calendar assignment, and reuse overlapping source/navigation/scheduling/FAA work. No application, dependency, migration or provider change. No merge authorized in this documentation task. Earlier entries follow unchanged.

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

## Schema14 package accepted; F1–F3 follow-up — 15 October 2026

The independently reviewed package merged unchanged in [PR #165](https://github.com/rickydeleon49-ui/Flight-training-/pull/165) at `8450526` after exact-head CI run 38803089531 passed (3,202 frontend / 464 Rust; original skips/ignores retained). F1–F3 are a separate non-blocking follow-up: precise Linux helper CI step, [canonical post-merge reproduction](docs/evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md#7-post-merge-source-only-reproduction-f2), and named full-self-check refusals with a meaningful regression. Helper tests now 23/23, zero skips; schema14 self-check remains 102/102. Final exact-head CI and reproduction identities are recorded with the follow-up PR closeout and [report](docs/MAC_SCHEMA14_FOLLOWUP_F1_F3_2026-10-15.md).

No pin, overlay allowlist, production comparison rule, migration or frozen evidence changed. Earlier pending-review entries below are historical. Next: exact-head CI/integration of this follow-up, then local unsigned v0.5.4 source/version preparation. Installed hfdtest, signing/publication and packaged Mac checks remain deferred; primary and separately owned work remain untouched.

## Schema14 preparation completed for review — 15 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** The saved REL-01 / MAINT-143-KEYS package is recovered onto accepted main `16f9cf3` in `codex/schema14-verification-completion` at `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`. Original saved hashes verified 10/10 and evidence checksums 4/4; original worktree preserved. Current focused checks: 117 Vitest, 21 helper tests, proof 12/12 (schema14 self-check 102/102), typecheck and Cargo-lock pass. The intentional historical schema13 ceiling alarm remains. Current inventory/evidence and exact review steps: [reviewer handoff](docs/MAC_SCHEMA14_COMPLETION_REVIEWER_HANDOFF_2026-10-15.md).

The proof binds the repository overlay to `16f9cf3` while retaining the immutable `8a260c0` schema contract and unchanged migrations/fixtures. Source-only synthetic evidence does not close installed gates. Next action: independent review/CI/integration, then the selected local unsigned v0.5.4 source/version preparation. hfdtest, signing/publication and M4 production remain deferred/separately owned. No commit, push, build or profile access. Older entries below retain their historical status.

## Claude consolidation accepted — 14 October 2026

The reviewed consolidation contains the nine-defect bug sweep, the first M5 cost-analytics slice, material Again clock refresh with repaired asynchronous tests, timezone maintenance and screenshot routing. Integration remains subject to required exact-head CI. M5 requirements are published as a proposal only; RQ-D1–D7 and knowledgeable human review remain pending. Current release direction is local unsigned v0.5.4; schema14 preparation/metadata proofs and version freeze precede that build, while signing/publication and hfdtest remain deferred. [Independent review](docs/CLAUDE_WORK_CONSOLIDATION_REVIEW_2026-10-14.md) and [current roadmap](ROADMAP.md) supersede the older snapshot statuses below.

## M4 round-3 independent review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R28–R32.** Submitted full runners reproduce 52 passing tests on Node22/26 and delivered checksums verify45/45; five new diagnostics fail on both lanes. Confirmed: duplicate durable ownership across concurrent controllers, pending save surviving abort, stale callback publication, asserted installation/final-verification receipts, and incomplete mutant/count traceability. Sequential restart and simple late-retry fixes are retained; M4 remains evidence-only. Gemini's submission is untouched.

[Independent review](docs/M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md) · [One model-neutral correction assignment](docs/M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md). Prior ownership/handoff history remains below; integration stays with the current Git coordinator.

## Historical: Local workspace maintenance — 11 October 2026

Historical record retained below; the newer M4 round-4 correction assignment above governs current work.

Primary main is clean and synchronized to `8a260c0` after preserving the unpublished October 10 preflight on a recovery branch and verified local bundle. Four retired C2/lineage checkouts are removed with source refs, useful receipts and the historical installer preserved. Gemini's active M4 and all other dirty/handoff checkouts are untouched. PR #142 is now merged; PR #143 and #146 fixes are merged. PR #148 remains the open M4 R23–R27 correction handoff, not an accepted production change. Older entries below describe their original snapshots.

[Cleanup/current-state report](docs/LOCAL_WORKSPACE_REVIEW_AND_CLEANUP_2026-10-11.md). No installed/release gates are closed by this cleanup.

## Historical: M4 round-2 corrections reviewed (Gemini) — 11 October 2026

Historical record retained below; the newer M4 round-4 correction assignment above governs current work.

**CORRECTIONS REQUIRED: M4-R23–R27 (3 P1, 2 P2).** Gemini's round-2 pack reproduces from a clean copy on Node 22.23.3 and 26.10.0: runner exit 0, suites 30/10/3, 43 mapped tests executed, manifest 39/39. The compensating rewrite is gone and R15–R19/R21/R22 are substantively implemented. Blocking problems:
- After an app restart, every reading-position save is rejected, because the controller's generation restarts at 0 while `owner_generation` is stored (R23).
- A late `retrySave` overwrites a newer saved page with the obsolete one (R24).
- None of the 20 test names and none of the mutant names in the report match what actually ran (R25).
- R13 lifecycle and R14(b) regressions are missing (R26), and some runner receipts still assert PASS or verified before checking (R27).

[Review](docs/M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md) · [Gemini round-3 assignment](docs/GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md). Still evidence-only; OD-1–OD-10 proposed; G1–G3 deferred.

## Reviewer switch and open-PR review — 11 October 2026

**Claude is temporary reviewer while Codex is unavailable (owner assignment); Gemini is assigned M4 round-2 corrections R13–R22.** #142 accepted independently; its branch is updated onto main and its check passed. #143 merged after an independent review; Claude's self-review missed the `__proto__` key edge case. #144 accepted as self-review and replaced by #146 on `bf5cf59` (3038 tests pass). The owner confirmed Claude as the single Git coordinator (merger) for now. [Review](docs/REVIEWER_SWITCH_AND_PR_REVIEW_2026-10-11.md) · [Gemini assignment](docs/GEMINI_M4_ROUND2_CORRECTIONS_PROMPT_2026-10-11.md).

## Installed findings source fix accepted — 11 October 2026

PR #143 merged as `b178066` after independent review and exact-head required CI. The practice-history timestamp fix passes 10 focused regressions; the old screen fails the three rendered cases with the observed malformed-date symptom. Restore sets aside only three post-export receipt keys and protects all other metadata/records/files. Original PR #142 snapshots retain their FAIL/diffs. Historical helper: 98/99 checks on Node22/26; the schema13-vs-live14 anchor already fails on base (85/86). One nonblocking valid `__proto__` metadata-key omission is assigned to the next helper task; it causes refusal, not a false PASS or data loss.

[Independent review](docs/PR143_PRACTICE_DATE_RESTORE_REVIEW_2026-10-11.md) · [One source-only schema-14 verification preparation assignment](docs/MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md).

PR #142's owner-authorized administrator-account synthetic schema12→13 results are separate installed evidence, still an open evidence PR. They do not cover the current M3 schema14 binary or close standard-account/mid-save/signing/release gates. No installed re-run is performed by this review. M4 remains separately in flight; protected dirty checkouts and prior evidence are preserved.

## M4 integration corrections re-reviewed (round 2) — 11 October 2026

**CORRECTIONS REQUIRED: M4-R13–R22 (5 P1, 5 P2).** M3 production is integrated: PR #140 merged as `c32918b` with the required check passing for the published head, so accepted main now ships migration 0014. Retained and independently re-verified from this M4 round: count/malformed refusals, first-level nullable schema-13 lineage, direction-specific ranges, `ROOT_DELETED`/`PARENT_DELETED` guidance, single-transaction replacement with trigger-fault rollback, populated-before-DDL upgrade, file-backed reopen, real-file backup/drift/restore, cascade, content-scoped progress, pre-opener bounds refusal, `retrySave()` without opener replay, real disposable module-copy mutants, and the pinned scratch artifact audit (its recorded `pdf.mjs` digest equals the bytes that executed). The three suites pass identically on Node 22.23.3 and Node 26.10.0 (21/7/2, exit 0).

- The R11 "commit fence" is a **compensating rewrite**: the obsolete page 42 write still commits (durable sequence `3 → 42 → 3`), and when the rewrite is made to fail the database keeps **42** while the caller is told page 3 with no surfaced error. The rewrite also re-stamps the obsolete content hash and printed label onto the newer page.
- Translation still returns a successful destination when the destination count is unknown (`null`/absent), printed label maps remain unbound to content identity, and no single validated destination record is used from resolver through opener, which re-derives bounds from caller-supplied `totalPages`.
- Evidence/lifecycle: the "safe integer arithmetic" case is blocked by a different guard and the arithmetic guard is unreachable; durable writers throw engine-dependent raw errors on unknown identity instead of persisting `unverified`; the older-binary probe asserts its own inline `13` ceiling while main ships `14` and the suite premise skips migration 0014; 6 of 26 delivered checksums do not match their own manifest (receipts rewritten after it) and several receipts are hardcoded text rather than measurements; the PDF.js step loads the previous round's untracked `node_modules`, so a clean clone cannot run it and Node 22 crashes uncaught. The same pinned `pdfjs-dist@6.3.289` completes all five fixtures on **both** lanes through its `legacy` entrypoint.
- Candidate migration **0015 coexists with shipped 0014** (reviewer-verified: 14 migrations + candidate → 44 tables, no clash), but the pack must prove this itself.

[Round-2 integration re-review](docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md) · [reproductions and receipts, both engine lanes](docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/README.md) · [One active model-neutral round-2 correction assignment](docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md).

M4 stays evidence-only: no production migration registered, no dependency adopted, no shared-tracking edit absorbed from the submission, no M4 production approval. OD-1–OD-10 remain proposed and are not presented for approval until preparation passes. M3-D1–D9 approval persists and is unchanged. The submission worktree, primary checkout and M3 worktrees remain untouched; frozen prior packs still verify byte-identical. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED.

## M3 production implementation reviewed and completed — 11 October 2026

The authorized first production slice is complete: migration 14, native/TS/browser transactions and restore guards, skills/debrief UI, history and explicit follow-up/status/confidence. Codex took over the interrupted implementation at the owner's request, fixed confirmed retry/draft/provenance/navigation defects, completed the browser-driver checks, strengthened two masked history-cursor regressions and finished evidence/benchmarks. Final local gate receipts and integration conditions are in the [review and completion report](docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_REVIEW_AND_COMPLETION_2026-10-11.md). GitHub merge requires required checks for the exact published head.

M3-D1–D9 approval persists; shared accepted fixtures, shipped migrations and dependencies are preserved. M4 remains separately assigned preparation with OD-1–OD-10 proposed. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; this is source-level work, not installed/signing/release acceptance. [Next model-neutral reviewer handoff](docs/M3_COMPLETION_NEXT_REVIEWER_PROMPT_2026-10-11.md).

## M4 integrated preparation re-review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R9–R12.** Retain the original behavior fixes and genuine PDF.js/file-backed SQLite demonstrations. Submitted22 tests pass on disclosed Node26; Node22 has a preserved scratch PDF.js Promise.try failure. Earlier current-source diagnostics10 pass; previous adapted cases14 pass/1 historical scanner failure legitimately superseded by real parser proof. New integration diagnostics14 failures/2 controls cover incomplete destinations, non-atomic identity/navigation validity and obsolete durable-save commits.

- [Independent integration re-review](docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_REREVIEW_2026-10-11.md).
- [One active model-neutral integrated correction assignment](docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_PROMPT_2026-10-11.md).
- 32 current submitted paths frozen;28 current,40 previous and29 first-review checksums verify; original receipts/manifest6/6 archived exactly. Review snapshots are not M4 production acceptance. OD-1–OD-10 proposed; candidate unregistered. M3's production approval remains active; primary/M3 dirty worktrees untouched. G1–G3 deferred/unexecuted/unverified.

## M4 corrected preparation independent re-review — 11 October 2026

**CORRECTIONS REQUIRED: M4-R5–R8.** The original ten diagnostics now pass against current source (frozen test bytes unchanged); submitted proof/SQLite tests 15 passed and Python probe3 checks passed. Independent new diagnostics reproduce13 failures with2 valid controls. Remaining work: complete numeric provenance/range validation, persisted replacement/restore proof, opener intent/save ownership, and truthful parser/artifact evidence plus conditional handoff.

- [Independent re-review](docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md).
- [One active model-neutral correction assignment](docs/M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).
- 25 submitted paths frozen;21 current and29 earlier-review checksums verify. Review snapshot publication is not acceptance of M4 production. OD-1–OD-10 remain proposed; candidate migration remains unregistered. Claude's M3 production approval remains active. Protected dirty worktrees untouched; G1–G3 deferred/unexecuted/unverified.

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

## M3 interrupted correction package — 11 October 2026

**INCOMPLETE; continuation required.** The local R8–R10 code and tests pass a bounded independent completion audit: 191 prototype tests / 3 opt-in skips, strict typecheck, 8 native tests, 7 TS/UI and 2 native frozen diagnostics, all exit 0. The historical-equivalent diagnostic receipts, targeted new sensitivity proofs, current regeneration/validation-performance receipts, report/tracking updates and final manifests remain unfinished. Current checkpoint: 145/145 paths; production anchors: 30/30 unchanged. No source acceptance or implementation integration.

- [Completion review](docs/M3_SKILLS_EVIDENCE_INTERRUPTED_WORK_COMPLETION_REVIEW_2026-10-11.md).
- [One active model-neutral continuation](docs/M3_SKILLS_EVIDENCE_REMAINING_PACKAGE_CONTINUATION_PROMPT_2026-10-11.md), superseding the prior prompt for resuming this interrupted package.
- In-flight implementation remains local/uncommitted; both dirty worktrees preserved. M3 defaults remain proposed; candidate 0014 unregistered; G1–G3 deferred/unexecuted/unverified.

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

**10 October owner deferred installed Mac verification:** Do not execute the hfdtest G1–G3 assignment or request its login until the owner resumes it. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt recovery BLOCKED/source-covered. Source/preparation acceptance stands; ordinary roadmap development may continue under existing scope approvals. No everyday-account substitution or release-gate bypass is authorized. [Owner decision](docs/MAC_INSTALLED_VERIFICATION_OWNER_DEFERRAL_2026-10-10.md).

**10 October Mac verification preparation accepted for integration:** MACV-R9–R11 senior integration review passed;13 focused/syntax/transfer commands exit0,23 submitted hashes/13 production anchors/66 final evidence entries/11 staged inputs verify. Original correction reports and receipts are historical and preserved. [Acceptance](docs/MAC_SCHEMA13_INTEGRATION_ACCEPTANCE_2026-10-10.md); [next installed-verification prompt](docs/MAC_SCHEMA13_INSTALLED_VERIFICATION_PROMPT_2026-10-10.md). G1–G3 remain UNEXECUTED/UNVERIFIED, post-receipt recovery BLOCKED/source-covered. Owner-authorized hfdtest/local ad hoc lane persists; no actual install, app launch, rebuild, provider or signing/release work. This review does not claim different-agent independence. Required exact-head GitHub checks must pass before merge.

**10 October MACV-R9–R11 implemented, pending independent review:** Production operator test/PATH bypasses removed; fixed account/workspace and run-bound permission recovery; complete-v3/SQLx migration13 checksum checks; checked installer and corrected canonical human walkthrough. Reviewer5 failures now pass with disclosed adapters. Helper86, frozen10/7/operator6, operator47, new helper44, installer15 pass;6/6 reverted boundaries fail. Staged11 inputs verify;13 production anchors, earlier27 frozen evidence/report/attribute files and4 installer artifacts unchanged. [Report](docs/MAC_SCHEMA13_FINAL_CORRECTIONS_2026-10-10.md); [walkthrough](docs/evidence/mac-schema13-final-corrections-2026-10-10/RUNBOOK-G1-G3.md). Work remains uncommitted/unpushed; no actual install/account/GUI/provider/signing/release work. G1–G3 UNEXECUTED/UNVERIFIED; post-receipt BLOCKED/source-covered. Earlier completion entries remain historical.

**10 October Mac schema-13 operator and full-comparison corrections: MACV-R7–R8 implemented, pending independent review; G1–G3 still UNEXECUTED.** Closes MACV-R7 (operator permissions, recovery, fail-closed path/account checks, human walkthrough) and MACV-R8 (complete database and schema comparisons, participating schema-13 tables/indexes/rows) together. Evaluated upstream review documents from `origin/main` at commit `79fd8c5` (`docs/MAC_SCHEMA13_OPERATOR_REVIEW_2026-10-09.md`, `docs/MAC_SCHEMA13_OPERATOR_FINISH_PROMPT_2026-10-09.md`, reviewer pack) with `git show`; dirty primary was not pulled, reset, stashed or overwritten. 29/30 submitted paths from the 2026-10-09 review match byte-for-byte; only `scripts/mac-schema13-profile-snapshot.mjs` was modified. 13/13 production source anchors match byte-for-byte; accepted ad hoc installer candidates remain unchanged (`b3ead813…`, `ddb0594e…`); prior evidence packs preserved byte-for-byte. R7 fixes: defined separate task workspace `HFD_WORKSPACE` under `/Users/hfdtest/Downloads/hfd-schema13-workspace` separating readable kit inputs from UID 502 outputs; fail-closed account inspection (`dseditgroup` exit 2 refused); fail-closed path policy (rejects `..`, symlinks, clobbering, and self-nesting); versioned key-value backup mode record `hfd-backup-mode-record/1` parsed with `IFS='='` without whitespace splitting to handle "Application Support" spaces, dev:inode checks, and safe idempotent repeated recovery; corrected standalone human runbook (`RUNBOOK-G1-G3.md`) with explicit OLD relaunch, confirmed stopped checks, explicit task mountpoints, and pre-receipt abort recovery test followed by successful retry. R8 fixes: snapshot schema `hfd-mac-profile-snapshot/3` with per-object type and definition anchors; normalized definitions for all 6 migration 0013 objects; `unchanged` checks all 33 retained tables + both 0013 tables (counts, framed cell digest, column order, PKs), schema objects, definitions, ledger, and document anchors (added operation/lineage rows or altered indexes fail); `upgrade` requires genuine 12->13 ledger, empty initial 0013 tables, complete 0013 addition set matching shipped SQL; `restore` requires migrated structure and zero residual operation/lineage rows; `history` remains partial and ineligible for gate certification. Test results: promoted reviewer operator diagnostics 21/21 passed (exit 0); promoted reviewer helper diagnostics 7/7 passed (exit 0); helper self-checks 86/86 passed (exit 0); frozen diagnostics 10/10 passed (exit 0); operator selftest 22/22 passed (exit 0); 7 revert sensitivity mutations all flipped to fail (`allFlippedToFail: true`); staged kit transfer 10/10 passed. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt recovery remains blocked/source-covered. [Corrections report](docs/MAC_SCHEMA13_OPERATOR_CORRECTIONS_2026-10-10.md); [evidence pack](docs/evidence/mac-schema13-operator-corrections-2026-10-10/README.md). Work left uncommitted and unpushed for independent review.

**8 October Mac schema-13 helper + operator-kit corrections: MACV-R4–R6 closed in preparation; frozen diagnostics 10/10, self-check 74/74; G1–G3 still UNEXECUTED.** Closing `docs/MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md` findings R4–R6 together. Read from `origin/main` `8973df3` (PR #127) with `git show`; the dirty primary was not pulled/reset/stashed, and **all 28 frozen submitted hashes verified 28/28 before editing** (no competing changes). MACV-R3 is accepted and untouched — both `*-adhoc.dmg` candidates still hash `b3ead813…`/`ddb0594e…` and the staged kit copies verify byte-identical; nothing was rebuilt, rebundled or re-signed. **R4 fail-closed boundaries:** process inspection is now *classified* (`stopped | running | error | unavailable | malformed`; only pgrep's documented exit 1 means stopped) with the refusal outside every catch and ahead of any DB/WAL/SHM read or copy; both candidate installs are probed; the operator CLI hard-requires uid 502 + `hfdtest` + non-admin (two fail-closed probes) + the `realpath`-checked canonical `/Users/hfdtest/Library/Application Support/com.herflightdeck.app`, so `--profile`/`--expect-uid` cannot retarget anything and no flag relaxes it (scratch fixtures live on an internal test path `parseArgs` cannot construct); symlink/hard-link/non-regular roots and sidecars refuse and `documents/**` is walked recursively; every `--json` destination is checked **before any read** against the profile root, DB/WAL/SHM, managed documents and both input receipts by resolved path **and dev:inode**, rejects symlinked/relative paths, and the CLI never clobbers existing evidence (`wx`); a failed WAL copy cleans up and surfaces as a refusal, and the originals are re-hashed around the copy so a mid-copy change proves a live writer. **R5 digests + purposes:** `quote()`/delimiter hashing replaced by a length-prefixed frame carrying table identity, ordered column identity and the **real** primary key (a declared key that disagrees, or no PK, refuses), each cell encoded by its true `typeof()` — int64 via BigInt, REAL as 8-byte IEEE-754 (`1`/`1.0`/`-0.0`/`0.0` distinct), TEXT/BLOB as full stored bytes from `hex(col)` (node:sqlite truncates TEXT at an embedded NUL, exactly why the reviewer's case collided) — so the frozen NUL test detects real SQLite bytes; the inventory is the shipped schema (33 retained tables **including** `practice_session_operations`/`card_review_operations`/`debrief_operations`) plus ledger row content, a schema-object digest, protected `documents/**` bytes versus separately recorded runtime artifacts (`backups/**`, `last-run-version.txt`), and isolation facts; snapshots are structurally validated before any verdict, so a missing table/digest/inventory is a refusal rather than an empty-map pass; four explicit contracts — `unchanged` (a schema-12 refusal passes without demanding 0013 tables or version 13), `upgrade` (populated baseline, ledger prefix + 13, both tables present, only 0013's 2 tables + 4 indexes added), `restore` (retained history **and** document bytes identical; a changed document fails even with matching history) and `history` (explicitly partial, `gateEligible:false`, never a gate) — with `verdict`/`retainedMeaning` in the receipt, and a v1 declared-subset capture can never certify a physical gate. **R6 standalone human kit:** `RUNBOOK-G1-G3.md` staged verbatim with the two accepted installers, fixtures A/B/C (`f6c593f9…`/`0ba9a7e2…`/`b5651eb6…`), the offline packet (`d5101e8c…`), the helper and `env.sh` under `/Users/Shared/hfd-schema13-kit-2026-10-08/` with a `TRANSFERSHA256SUMS.txt` re-verifiable inside `hfdtest` (world-writable location, so a mismatch means stop); explicit Cmd-Q + `$HFD_OP stopped` before **every** snapshot, baseline capture, copy or switch (the old A1/A7/B3/B6/B7/D3 live snapshots are gone), one purpose per gate, corrected nested **C2 = root 141–160 of 1,050, 20 pages** (C1 120–140/21 and A 3–7/5 preserved) with copy destinations 41 into P and 141 into B, no `…`/angle-bracket placeholders inside executable commands, no `HOME`/`CODEX_HOME` assignment, and full backup sha256 + `manifest.json` + payload count/byte sum recorded because the shared `0.5.3` cannot distinguish OLD from NEW, with startup/safety backup artifacts explicitly excluded from refusal evidence. New `hfd-operator.sh` provides validated, reversible, never-deleting `move`/`copy` (lane + confirmed stop + absent destination + no self-nesting + whole-folder only, so a rerun cannot nest or clobber, and the refusal-test profile is moved to `profiles/schema12-refusal-test` and retained) plus `block-backups`/`unblock-backups` that record the directory's original mode and restore and verify it on success, failure **or** abort. **Evidence:** the unmodified frozen harness (`14c40581…`, matching the reviewer's published `SHA256SUMS`) goes 3-pass/7-fail → **10/10, exit 0**; self-check **74/74, exit 0**, byte-reproducible across three runs; eleven reverted behaviours each mapped to the assertion that breaks, with two non-biting cases disclosed honestly; fifteen operator-script cases pass including proof that refused operations left both profiles intact; the 13 production anchors remain **13/13** unchanged. No application source/migration/config/lockfile/candidate change, no `.gitattributes` change needed (zero trailing-whitespace/CR across the pack; nothing gitignored), no GUI launch, install, signing, notarization, CI trigger, provider call or publication; everyday profile untouched; the post-receipt recovery subcase still **BLOCKED/source-covered** with the same unimplemented seam proposal. [Corrections report](docs/MAC_SCHEMA13_HELPER_CORRECTIONS_2026-10-08.md); [evidence + operator-kit walkthrough](docs/evidence/mac-schema13-helper-corrections-2026-10-08/README.md). Remaining: a person executes `RUNBOOK-G1-G3.md` in `hfdtest`; G1–G3 stay UNVERIFIED until observed. Work left uncommitted/unpushed for independent review.

**8 October Mac schema-13 preparation corrections: MACV-R1–R3 closed; candidates now pass strict bundle verification; G1–G3 still UNEXECUTED.** Closing `docs/MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md`. Read from `origin/main` `21581fc` (PR #126) with `git show`; the dirty primary was not pulled/reset/stashed, and **all 12 frozen submitted hashes plus all 13 source anchors verified 25/25 before editing** (no competing changes). The earlier `BLOCKED` entry below stays historical; its exact submitted bytes are frozen in the reviewer pack. **MACV-R3:** diagnosed the failure as bundle integrity, not missing Developer ID — the shipped bundles carried only the linker's ad hoc signature (`adhoc,linker-signed`, `Info.plist=not bound`, `Sealed Resources=none`), so both strict checks exited 1. Rebundled the **existing verified build products** with Tauri's documented ad hoc identity `-` through a scoped `--config` overlay (`tauri bundle`, no rebuild, no tracked config change), producing NEW `36a7b39` dmg `b3ead813…`/exe `82468893…` and OLD `2a6a415` dmg `ddb0594e…`/exe `2e44bfbb…`; `codesign --verify --strict` on the executable and `--verify --deep --strict` on the app now **exit 0 for both**, with `Sealed Resources version=2` and the real bundle id bound, verified by re-mounting each final DMG read-only with the reviewer's own command set. Still no Developer ID/team/hardened trust/no ticket and `spctl` rejected, so these remain **local ad hoc, behaviour-only, not distributable**; the rejected originals (`6aecab86…`, `455eb12d…`) are preserved byte-for-byte and their old hashes are not reused. **MACV-R1:** one chronological, explicit and reversible walkthrough — OLD first on a fresh task-owned schema-12 profile, populate through the installed UI (PDFs + offline `02-flashcards-and-test.json` packet `d5101e8c…`, complete the 2-question attempt, rate a card), export a genuine schema-12 `.hfdbackup`, quit and preserve the whole profile folder, NEW against the same active root, then profile switches with neither app running for the OLD refusal and the NEW restore; installs only in distinct `/Users/hfdtest/Applications/HFD-{NEW,OLD}-<sha>/` paths launched by full path with uid 502/non-admin/resolved-root/hash confirmations in session. Added `scripts/mac-schema13-profile-snapshot.mjs`: read-only, `_sqlx_migrations` ledger (not `user_version`), real table names, `quote()`-based typed deterministic serialization ordered by primary keys, WAL honoured via a copy without touching the original, refusing wrong uid/root/running app — 8/8 isolated checks exit 0 (control, changed-history detection, wrong-root and wrong-uid refusal, WAL handling, applying the real shipped 0013 keeps history identical with ledger 13). **MACV-R2:** removed every wrong "of 400" (A is a 10-page root, so 3–7 is a 5-page child "of 10"; B is 1,050 pages, so its 101–300 parent gives a 21-page child at root 120–140 **of 1,050**, sibling 60–80), separated copy-page destinations from the child's own page 1, added real direct and nested companion siblings with root-vs-parent grouping stated (different ranges are not different editions), fixed cancel semantics (before Save nothing is created; during Save both dialogs are non-dismissible with Cancel disabled), and added a reachable installed failure/recovery via the pre-receipt `createBackup()` abort (`chmod u-w …/backups`) asserting zero receipt/files/library change plus a successful retry. The post-receipt pending/reconcile/cancel subcase is recorded **blocked / source-covered** with named native+UI tests and S1/S3, with the smallest separately reviewed debug-only seam proposed — no bypass, no mock presented as a physical pass. Two narrow `.gitattributes` `-whitespace` lines cover only the raw `hdiutil` mount receipts; all authored docs/code are clean. No source, schema, provider or lockfile change; no GUI launch, install, signing, notarization, CI trigger or publication; everyday profile untouched. [Corrections report](docs/MAC_SCHEMA13_PREPARATION_CORRECTIONS_2026-10-08.md); [evidence + operator runbook](docs/evidence/mac-schema13-preparation-corrections-2026-10-08/README.md). Remaining: a person executes `RUNBOOK-G1-G3.md` in `hfdtest`; G1–G3 stay UNVERIFIED until observed. Work left uncommitted/unpushed for independent review.

**8 October Mac schema-13 installed verification: candidates built + fixtures verified; G1–G3 PREPARED, UNEXECUTED.** Confirmed PR #125 MERGED (merge commit `36a7b39`; required `Checks` workflow SUCCESS, not bypassed); primary `/Users/rickymac/code/Flight-training-` was clean and fast-forwarded `2a6a415 → 36a7b39` (`main == origin/main`, clean), no competing changes on main, archival preservation branches untouched (read-only). The read-only preflight first showed the two owner prerequisites unmet (`P-TEST-ACCOUNT`/`P-SIGNING` = USER_ACTION, 0 code-signing identities, installed smoke 0/8, `readyForInstalledUse:false`). The owner then authorized, in-session, the isolated lane (`hfdtest`, standard non-admin, synthetic-only) **and** a fresh **local UNSIGNED** candidate from `36a7b39`. Acting on that: built two local unsigned `aarch64` DMGs with the SDK pinned to MacOSX26.5 (default 27.0 is a recorded linker failure) — NEW schema-13 `36a7b39` (dmg `6aecab86…`, exe `9c7056c3…`) and OLD schema-12 `2a6a415` (dmg `455eb12d…`, exe `efc33cb8…`, `2a6a415` confirmed ancestor) — both `tauri build` exit 0; verified the packages **read-only without launching** (mount → `codesign`/`plutil`/`lipo` → preflight `--app` → detach): arch arm64, `Signature=adhoc`, `TeamIdentifier=not set`, preflight integrity `failed`, not stapled, Gatekeeper rejected — i.e. **local unsigned, not Developer ID, not notarized, not distributable**; frozen v0.5.3 not reused/replaced, no tag/publish. Regenerated the three synthetic PDF fixtures; all three SHA-256 match `MAC_PARITY_CHECKLIST` §4. Staged both DMGs for the operator. **G1 installed smoke, G2 populated schema-12→13 upgrade (installed app), G3 older-backup restore + newer-binary refusal are PREPARED but UNEXECUTED** — they need a person to install/launch in the `hfdtest` GUI session and record observables/screenshots (see `docs/evidence/mac-schema13-verification-2026-10-08/RUNBOOK-G1-G3.md`); not run, not simulated, not marked pass; the schema-12 library is populated via the OLD app, not forged by script. Nothing signed/notarized/published; everyday profile untouched; no env-var guessing. [Verification report](docs/MAC_SCHEMA13_VERIFICATION_2026-10-08.md); [evidence](docs/evidence/mac-schema13-verification-2026-10-08/README.md). Remaining: a person executes G1–G3 in `hfdtest`; Developer ID/notarized distribution + a release version beyond `0.5.3` remain separate owner decisions. Report + evidence left uncommitted/unpushed for senior review.

**10 October Mac operator re-review — corrections required:** Earlier R7/R8 diagnostics pass independently (frozen10, helper7, operator6; helper86, expanded operator21, self-test22). New diagnostics expose5 failures: shipped operator test overrides and cross-run recovery; incomplete-v3 and missing13 restore PASS. The walkthrough also has incorrect executable hashes and missing launch/import/cleanup steps. [Review](docs/MAC_SCHEMA13_OPERATOR_REREVIEW_2026-10-10.md); [active model-neutral correction](docs/MAC_SCHEMA13_OPERATOR_FINAL_CORRECTIONS_PROMPT_2026-10-10.md). All13 production anchors and accepted installers unchanged;30 submitted paths frozen. Implementation remains dirty/pending acceptance; G1–G3 UNEXECUTED/UNVERIFIED. No build/install/account/provider/signing/release work. Older completion claims remain historical.

**9 October Mac schema13 operator/full-comparison review — R7/R8 corrections required:** Prior frozen10, helper74 and operator15 checks independently pass; all24 submitted and10 staged-kit hashes verify, production anchors unchanged. New scratch diagnostics: operator2 controls/4 failures (spaced-path unblock, account-error handling, traversal/symlink escapes); helper2 controls/5 failures (schema13 rows/schema changes ignored and missing0013 indexes accepted). Staged output roots also remain UID501/mode0755 and cannot be written by hfdtestUID502. Preserve candidate acceptance and previous fixes; finish safe per-user operator workspace/recovery and complete gate comparison in one round. G1–G3 remain UNEXECUTED/UNVERIFIED; post-receipt installed subcase blocked. [Review](docs/MAC_SCHEMA13_OPERATOR_REVIEW_2026-10-09.md); [active model-neutral finish assignment](docs/MAC_SCHEMA13_OPERATOR_FINISH_PROMPT_2026-10-09.md). Dirty primary preserved; no unaccepted helper integration.

**8 October Mac schema-13 preparation re-review — MACV-R3 closed; R4–R6 corrections required:** Both corrected ad hoc candidates independently pass strict executable/bundle verification with matching hashes; no rebuild needed. All 22 submitted checksums and 13 original production anchors verify. Snapshot self-check passes8/8, but frozen isolated diagnostics yield3 controls pass/7 failures: swallowed live-app/inspection refusals, output overwriting a scratch DB, wrong refusal/restore comparison semantics, missing snapshot facts and embedded-NUL hash loss. Correct helper boundaries/digests and the standalone stopped-app operator sequence; nested C2 must map to root141–160. Source acceptance stands; G1–G3 and the post-receipt installed subcase remain unverified/blocked. Dirty primary and valid candidates preserved. [Re-review](docs/MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md); [one active model-neutral assignment](docs/MAC_SCHEMA13_HELPER_CORRECTIONS_PROMPT_2026-10-08.md). Submitted closure claims are historical inputs, not independent acceptance.

**8 October Mac schema-13 preparation independently reviewed — corrections required (MACV-R1–R3):** PR #125/source acceptance stands. Eight submitted evidence checksums, both staged DMG/executable hashes and all three PDF fixture hashes verify. Both exact app bundles fail strict signature verification (exit 1: missing signature resources); local ad hoc display is not an integrity pass. Correct the OLD/NEW profile/backup sequence with offline history seeding, fixture/page/sibling expectations and achievable failure cases, then prepare valid local ad hoc packages. G1–G3 remain UNEXECUTED/UNVERIFIED; no everyday-profile launch or public release. Original report/evidence and dirty tracking inputs are preserved unchanged; this review supersedes the submitted operator handoff. [Review](docs/MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md); [active model-neutral correction assignment](docs/MAC_SCHEMA13_PREPARATION_CORRECTIONS_PROMPT_2026-10-08.md). Original build logs are explicitly included in publication. Primary implementer changes were not overwritten.

**8 October split-lineage integrated after source acceptance:** Owner-approved SL-D1–D8, accepted round-5 scope, source implementation and both review/acceptance trails are published together. All 35 submitted source hashes, 32 implementation and 24 source-review checksums verify. F-1 is fixed with an atomic per-process sequence in the test helper; shipping behaviour is unchanged. [Integration and cleanup report](docs/M2_SPLIT_LINEAGE_INTEGRATION_CLEANUP_2026-10-08.md). Local 980-change states are preserved in archive branches; primary will be synchronized after exact-head CI/merge. Installed Apple Silicon smoke, populated upgrade and older-backup restore remain unverified; signing/notarization/version/publication decisions remain separate. Earlier planning prompts are historical.

**8 October M2 split lineage production source ACCEPTED for integration:** Independent source review of `codex/m2-split-lineage-implementation` (base `2a6a415`, nothing staged), run on an isolated copy. 35/35 source hashes and 32/32 pack checksums verify; 0001–0012 byte-identical, only 0013 added and byte-identical to the round-5 candidate (checksum `4118a789…b106`), schema 13. Reproduced: 110 focused Vitest, 41 focused native (single-threaded), typecheck, the 15-case validator contract across all three engines, sensitivity S1–S5 all caught and restored, full `npm test` 2,862 passed / 5 skipped, full `cargo test --all-targets` 444 passed / 6 ignored. The receipt is bound to the file's owning material and the source is read once for the exact bytes split; the webview cannot mint, edit or extend a receipt (recompute + recorded-hash match + `deny_unknown_fields` + strict TS shape guard); the save re-checks pending, source, path, nested snapshot and id collisions inside `BEGIN IMMEDIATE`; cancel removes only its own files; `verify_schema_13_lineage_semantics` and `validateSplitLineageState` are true twins; older binaries refuse schema 13; a populated schema-12 library upgrades with practice and card history intact. Decision 1 (browser drivers read but do not write lineage — browser mode cannot do PDF I/O; native is the sole writer) and Decision 2 (refused saves stay `pending` until the interface reconciles then cancels) are accepted against the scope; `executeMaterialsBatch`/`save_split_materials` correctly stay generic. One non-blocking, pre-existing finding (F-1): `documents.rs::split_test_root` names temp dirs by `{pid}-{nanos}` and intermittently collides under default parallelism, redding the native gate — unchanged from base, deterministic in the delivered tests, bounded fix proven. Publish scope + scope review/acceptance + owner approval + this implementation + this source review in one PR. Installed Apple Silicon smoke test, upgrade over populated data and restore of an older backup remain open; no signing/packaging/version bump. [Source review](docs/M2_SPLIT_LINEAGE_SOURCE_REVIEW_2026-10-08.md); [acceptance](docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md); [review pack](docs/evidence/m2-split-lineage-source-review-2026-10-08/README.md).

**8 October M2 split lineage implemented, pending independent source review:** The owner approved SL-D1–D8 ("i approve SL-D1 through SL-D8"; recorded in the evidence pack). Production split-source lineage is implemented, uncommitted and unpushed, on `codex/m2-split-lineage-implementation` in the isolated worktree `/Users/rickymac/code/Flight-training-split-lineage-implementation`, base `2a6a415`. Migration 0013 (from the accepted round-5 candidate DDL) and schema 13; the native splitter fingerprints the exact bytes it splits and records a receipt, and a save accepts only that recorded receipt, re-checking the source, its file and a part's parent inside one immediate transaction; parts inherit the source's settings; cancel removes only a split's own files; read-back by operation id. A part's page shows its original and parent, each judged against its own current file, the other parts of the same copy, and a copy-page button. Native and TypeScript schema-13 restore validators agree on a 15-case shared contract. The earlier partial implementation (which did not compile and broke ordinary split saves) was replaced and is preserved in the evidence pack. The accepted split-lineage scope and its review documents are not yet on main. [Evidence and gate results](docs/evidence/m2-split-lineage-implementation-2026-10-08/README.md). Installed-app, release and signing gates remain separate.

**8 October M2 split-source lineage scope SL-R12–SL-R13 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 5 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R12: Nested parent tier records immediate parent's title and file name in `parent_title` and `parent_file_name` while `source_*` preserves root snapshot; re-issuing an identical receipt uses plain INSERT with explicit existing-row policy (never INSERT OR REPLACE), preserving committed and cancelled statuses and refusing saves of cancelled receipts; tamper verification against `split_operation_log` is unconditional (save refused if table is absent); candidate DDL 0013 defines `split_operation_log.source_material_id` with `ON DELETE SET NULL` on nullable source ID, retaining operational history and reconciliation status when source handbook is deleted. SL-R13: Removed `cancelBatch` legacy 3-argument signature; strictly `cancelBatch(db, operationId)` unlinks only files recorded in that operation's receipt plan; deleted `round2CompatAdapter.mjs` and loader source-rewrite hook, using single resolve-only redirect loader; honest recording of retired cases without editing diagnostics (frozen round 2 has 4 pass / 2 retired receipt-less controls; round 2 reviewer has 8 pass / 3 retired controls 1–2 & case 11; round 3 reviewer has 10 pass / 2 retired case 11 DDL path & case 12 cancel signature; each mapped to permanent proof assertion); mutation runner pinned to `--test-reporter=tap`, matches test name and assertion message, exits 1 on miss, writes receipts only to output directory, killing 14/14 mutants identically across two independent runs (exit 0). Verbatim reviewer diagnostic `lineage-round4-review.test.mjs` passes 8/8 (exit 0); proof suite passes 18/18 (exit 0); frozen round 1 passes 7/7 (exit 0). [Corrected scope](docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-five evidence pack](docs/evidence/m2-split-lineage-scope-round5-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October M2 split-source lineage scope SL-R10–SL-R11 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 4 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R10: Removed receipt-less save path entirely (`expectedParentSha256`, `currentParentBytes`, caller `parts` alongside receipt, caller operation ID, `parts[0].sourceTotalPages`, and 1,000-page fallback removed; missing or unreadable source file strictly refuses with verdict `missing`); typed `SplitSourceReceipt` is the sole authority; receipts are made tamper-evident and bound to the database via `split_operation_log` as `pending` with canonical JSON and hash; nested parent snapshot re-verification inside `BEGIN IMMEDIATE` matches lineage row and file path before writing (double-read check removed); page total is explicitly documented as engine page count at split time (production contract from `pdf.rs`, never webview). SL-R11: Moved `split_operation_log` into `candidate_migration_0013.sql` with `operation_id` PK, `source_material_id` FK (ON DELETE CASCADE), canonical JSON/hash, status CHECK (`pending | committed | cancelled`), and timestamps; omitted from test helper so 0001–0012 baseline strictly reflects shipped schema; operation IDs derived strictly from receipt; replay of committed receipt returns persisted rows; conflicting reuse of output IDs throws named `OutputMaterialAlreadyExistsError` before any write; reconciliation reads by operation ID; real `cancelBatch(db, operationId)` marks uncommitted operation `cancelled` and unlinks recorded staged files (no-op after commit; subsequent save of cancelled receipt refused). All 12/12 mutants killed by named assertions in sandboxed mutation runner (exit 0). Verbatim reviewer diagnostic `lineage-round3-review.test.mjs` passes 12/12 (exit 0); proof suite passes 18/18 (exit 0); frozen round-one diagnostic passes 7/7 (exit 0); frozen round-two diagnostic passes 6/6 (exit 0); superseded round-two reviewer diagnostic records 8 passed / 3 failed (exit 1) with controls 1–2 and case 11 disclosed as expected retirements under mandatory receipt enforcement. [Corrected scope](docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-four evidence pack](docs/evidence/m2-split-lineage-scope-round4-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October M2 split-source lineage scope SL-R7–SL-R9 corrected, pending independent scope review; SL-D1–D8 proposed:** Round 3 corrections completed in isolated worktree `Flight-training-split-lineage-scope` on branch `codex/m2-split-lineage-scope` (base `11fb3ad`). SL-R7: Defined typed `SplitSourceReceipt` as the sole accepted provenance input to save; parts carry only selection, title, and output identity with caller hash/root overrides rejected; file-read verification sits honestly outside SQLite transaction; in-transaction re-checks inside `BEGIN IMMEDIATE` verify source material exists, file path is unchanged, and nested parent lineage snapshot is unchanged before writing; bounds derived and bounded by receipt total; historical root snapshot preserved on root deletion (immediate parent never recorded as root). SL-R8: Tier classification is strictly structural (`nested_level = 1` AND `parent_page_start IS NULL` for direct; `nested_level > 1` for nested) and validated via candidate DDL CHECK constraints; two-tier verdicts return `parentStatus = 'unknown'` when parent content hash is NULL regardless of root match; sibling grouping strictly matches effective identity (root ID + root hash for direct, parent ID + parent hash for nested; unknown never matches anything). SL-R9: Cleanup runs exactly once per failed operation and only touches files owned by that operation (concurrent staged operations preserved); deterministic operation ID provides idempotency on resubmission without row/file duplication, and reconciliation reads by operation ID; rebuilt Contract 14 lifecycle seeds parent/child history in shipped 0001–0012, applies candidate 0013, saves split child with distinct file, adds retained-child histories, verifies changed verdict on source byte replacement, deletes parent, and verifies all history rows survive `foreign_keys` export/reopen; isolated mutation runner kills 8/8 mutants with named assertions (exit 0). Proof test passes 18/18 (exit 0); reviewer round-three verbatim diagnostic passes 11/11 (exit 0); frozen round-one diagnostic passes 7/7 (exit 0); frozen round-two diagnostic passes 6/6 (exit 0). [Corrected scope](docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md); [round-three evidence pack](docs/evidence/m2-split-lineage-scope-round3-2026-10-08/README.md). Defaults SL-D1–SL-D8 remain proposed; no production migration, schema change, application implementation, packaging, or release work activated.

**8 October split-lineage scope re-review — SL-R4–SL-R6 corrections required:** Six document hashes and 9/20/18 evidence checksums verify. Independent corrected proof 15 pass; frozen diagnostic 7 pass; 4 actual mutations caught. New diagnostics: 2 controls pass / 4 failures. Direct-source tier verification/sibling editions (R4), mandatory source-context/nested save validation (R5), and lifecycle/rollback/mutation evidence (R6) require one bounded planning correction. [Specific re-review](docs/M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md); [active model-neutral round-two assignment](docs/M2_SPLIT_LINEAGE_SCOPE_ROUND2_PROMPT_2026-10-08.md). C2 remains accepted; SL-D1–D8 proposed; no production/installed/release activation. Earlier pending rows are historical.

**8 October split-lineage scope review — corrections required:** Six submitted hashes/nine evidence checksums verify. Submitted proof: 13 pass; independent frozen diagnostics: two controls pass/five assertion failures. SL-R1 requires explicit root/immediate-parent source versions, correct navigation coordinates and atomic save/stale-source contract; SL-R2 requires bounded mapping and real schema identity/type constraints; SL-R3 requires actual shipped-schema/history/restore evidence and real mutation sensitivity. [Review](docs/M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md); [one model-neutral correction assignment](docs/M2_SPLIT_LINEAGE_SCOPE_CORRECTIONS_PROMPT_2026-10-08.md). C2 remains accepted (PR #122); split lineage remains a proposed scope, SL-D1–D8 unapproved. No production/installed/release work activated.

**8 October C2 production source accepted for integration:** C2SRC-R1/R2 closed. All 32 source hashes, 57 original and 30 correction evidence checksums verify. Independent affected/frozen tests: 112 passed / 1 skipped; typecheck/build pass. R2's prior baseline precondition error is corrected in the acceptance; semantic revert independently fails at the real assertion. Submitted final gate: 2,808 frontend pass / 5 skips / zero unhandled; 420 Rust pass / 6 ignored. [Source acceptance](docs/M2_CARD_REVIEW_C2_SOURCE_ACCEPTANCE_2026-10-08.md); containing source PR supplies exact-head CI and merge. Library-wide views are complete; split lineage and installed/platform M2 acceptance remain. [Next model-neutral split-lineage scope/proof assignment](docs/M2_SPLIT_LINEAGE_SCOPE_PROMPT_2026-10-08.md). Earlier pending C2 rows are historical after merge. No signing/release activation.

**8 October C2SRC-R1/R2 corrected, pending independent re-review:** Both source-review findings are corrected, uncommitted and unpushed, in the same isolated worktree and branch (base/HEAD `cc84964`). R1: AppData now publishes a monotonic `dataRevision` that advances only with the snapshot that wins publication (startup, refresh, every completed mutation); Review due, History and the binder invalidate on it instead of the material/count/timestamp key, so same-count and same-timestamp replacements, state-only reviews and restore-like replacements are all picked up. R2: the history viewer follows its event by ID, shows the stream's current row with the event's own question and answer, and closes for good when the row leaves the list. The frozen reviewer diagnostic fails 3/3 at baseline and passes 3/3 unchanged on the final source; 9 permanent tests were added, and each fix reverted alone in a scratch copy is caught. Schema 12, the migration registry and all earlier evidence are unchanged. Not accepted: source re-review, installed and release gates remain separate. [Correction evidence](docs/evidence/m2-card-review-c2-source-corrections-2026-10-07/README.md).

**7 October M2-4 card reviews C2 implemented, pending independent source review:** The owner approved C2-D1–D9 in the implementing session ("I approve C2-D1 through C2-D9"), recorded before any code in [OWNER_APPROVAL.md](docs/evidence/m2-card-review-c2-implementation-2026-10-07/OWNER_APPROVAL.md). Library-wide Review due, card History and binder indicators are implemented, uncommitted and unpushed, on `codex/m2-card-review-c2-implementation` in the isolated worktree `/Users/rickymac/code/Flight-training-c2-implementation`, base `cc84964`. It includes bounded read-only native and browser readers that give identical results (a 35-call shared fixture), an owned stream controller with snapshot Retry, URL-synced tabs, a focused C1 session from Review due, and read-only history inspection. Schema 12 and all earlier C2 evidence packs are unchanged; no dependency, migration, provider, installed, signing or release work. [Evidence and gate results](docs/evidence/m2-card-review-c2-implementation-2026-10-07/README.md); [requirement map](docs/evidence/m2-card-review-c2-implementation-2026-10-07/REQUIREMENTS.md). The dirty planning clone is preserved. Source acceptance and installed/release gates remain separate.

**7 October C2 scope-proof accepted:** C2-E1–E3 closed. Independent eight frozen diagnostics 84/84, submitted proof 71/71 and final end-to-end controls 4/4 pass; mutation controls work. All 39 source hashes/35 evidence checksums and nine submitted packs verify. Actual audit: due 175/150/177; history 22/22/22; enrichment-only 3; combined 24. [Acceptance/defaults](docs/M2_CARD_REVIEW_C2_ACCEPTANCE_2026-10-07.md); [next conditional model-neutral source assignment](docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_START_PROMPT_2026-10-07.md). C2-D1–D9 remain proposed pending owner approval; production C2 not yet activated. C1 and prior waiver persist. Dirty planning clone preserved. No installed/release acceptance claimed; previous correction rows historical.

**7 October C2 state-publication independent re-review — corrections required:** 39 submitted source hashes and 35 evidence checksums verify. Seven frozen diagnostics 74/74 and submitted proof 57/57 pass; prior six demonstrated failures fixed. New diagnostic: one control pass/nine failures across bounded filter-owned enrichment (C2-E1), complete provenance/action publication (E2) and latest-failed-read Retry ownership (E3). [Review](docs/M2_CARD_REVIEW_C2_STATE_PUBLICATION_REREVIEW_2026-10-07.md); [one active model-neutral enrichment assignment](docs/M2_CARD_REVIEW_C2_ENRICHMENT_CORRECTIONS_PROMPT_2026-10-07.md). All eight submitted packs and original dirty clone preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated; earlier review rows historical.

**7 October C2 contract-finish review — corrections required:** 45 submitted hashes and 41 evidence checksums verify. Six frozen diagnostics 67/67 and submitted proof 46/46 pass; mutation controls work. Six new assertion failures remain: failed-parse work reservation, controller issue publication, inspection route, priority-key domain, cross-page enrichment and untargeted provenance regression. Actual SQL calls due 175/150/177; history 22/22/22. [Review](docs/M2_CARD_REVIEW_C2_CONTRACT_REVIEW_2026-10-07.md); [one active model-neutral state-publication assignment](docs/M2_CARD_REVIEW_C2_STATE_PUBLICATION_PROMPT_2026-10-07.md). Dirty implementation clone and all seven submitted packs preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated. Earlier review rows are historical.

**7 October C2 bounded-read corrections re-review — corrections required:** 40 submitted source hashes and 36 evidence checksums verify. Five frozen diagnostics 56/56 and submitted proof 40/40 pass; mutation baseline/four kills/survival control work. Preserve prior progress. New frozen diagnostic: one supported-state control pass / ten failures across silent oversize loss, history absolute bound and mixed-size work admission (R4), incomplete/duplicate/noncanonical cursor fields (R8), and unsupported/invalid inspection state (R10). [Review](docs/M2_CARD_REVIEW_C2_BOUNDS_REREVIEW_2026-10-07.md); [one active model-neutral contract-finish assignment](docs/M2_CARD_REVIEW_C2_CONTRACT_FINISH_PROMPT_2026-10-07.md). Original dirty clone and all six submitted evidence packs preserved. C2 scope unaccepted, D1–D9 proposed; C1 accepted. No production/installed/release work activated. Earlier review rows are historical.

**7 October C2 read-pipeline independent review — corrections required:** 38 submitted hashes and 34 evidence checksums verify. All 48 prior frozen cases and submitted 32-case proof pass; held-A/B mutation and survival controls work. New focused diagnostic: one control pass / seven assertion failures across actual work/byte accounting and history bounds (R4), generated cursor overflow/version/key shape (R8). Preserve authoritative refresh and operation ownership (R9), prior fixes and all five immutable submitted packs. [Review](docs/M2_CARD_REVIEW_C2_PIPELINE_REVIEW_2026-10-07.md); [one active model-neutral bounded-read assignment](docs/M2_CARD_REVIEW_C2_BOUNDED_READ_CORRECTIONS_PROMPT_2026-10-07.md). C2 remains unaccepted and D1–D9 proposed; C1 accepted. Original dirty planning clone unchanged; no production/installed/release work activated. Earlier review rows are historical.

**7 October C2 final-corrections re-review:** 34 submitted hashes verify; all 37 frozen cases and 24 submitted proof cases pass. Preserve filters, current-content revalidation, event identity, basic Retry, history/upgrade proof, actual batching and mutation survival enforcement. Focused follow-up: two controls pass / nine assertions fail across pending consumption/history cursor ownership (R8), authoritative reset/order and synchronous ownership (R9), and unenforced card/raw-byte caps (R4). Owner mutation still fails with its injected mutation removed. [Specific review](docs/M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md); [one focused read-pipeline assignment](docs/M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 remains accepted. The original dirty clone and all prior evidence are preserved. No production/installed/release work authorized.

**7 October C2 completion review — corrections required:** 32 delivery hashes verify; prior frozen diagnostics 9/9 and 12/12 and submitted proof 21/21 pass. Production parity, shipped-schema baseline and actual 3/2 SQL batching are verified. New focused diagnostic: two controls pass / 14 assertion failures across unapplied filters (R7), stale cached cursors (R8), controller event identity/retry/reconciliation (R9), and historical context (R10). Mutation verifier still reports success when expected failures are removed (R11); bounded performance/accounting claims need correction. [Review](docs/M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md); [one active model-neutral correction assignment](docs/M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope remains unaccepted and D1–D9 proposed; C1 acceptance persists. Original dirty planning clone is preserved. No production/installed/release work activated.

**7 October C2 planning correction re-review — bounded completion required:** Independent corrected proof 15 pass and prior frozen cases 9 pass. R2/R3 version/count/provenance behaviors are fixed; remaining R1/R4/R5 plus new R6 need completion. New production-parity/schema/rank/cap/controller diagnostics: one pass/eleven assertion failures. [Specific re-review](docs/M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md) and [one focused model-neutral completion prompt](docs/M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md). Reviewed 25-path dirty clone and both prior evidence packs remain untouched. C1 accepted; C2 scope/defaults not accepted or activated.

**7 October C2 planning independently reviewed — corrections required:** Submitted 18-path planning snapshot is preserved; four document hashes/thirteen evidence checksums verify. Original proof: 15 passes; independent frozen diagnostic: 2 passes/seven failures. C2-R1–R5 cover bounded discovery/paging, exact-version state, history provenance, unsupported performance claims and missing lifecycle/restore contracts. [Review](docs/M2_CARD_REVIEW_C2_SCOPE_REVIEW_2026-10-07.md) and [active model-neutral correction assignment](docs/M2_CARD_REVIEW_C2_SCOPE_CORRECTIONS_PROMPT_2026-10-07.md). C2-D1–D9 remain proposed; C1 acceptance persists. Dirty planning clone remains untouched. No production or installed/release work.

**7 October C1 source review accepted for integration:** C1-R1/R2 closed; 37 corrected source hashes, 14 correction and 45 original evidence checksums verify. Independent frozen/panel/dialog tests: 65 passes; integration typecheck/build pass. Submitted full frontend: 2,695 passes/four skips, zero unhandled; unchanged native Xcode evidence reused (415 passes/six ignores). [Acceptance](docs/M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md); containing source PR requires exact-head CI and merge. C1 provides material-level durable card reviews with migration 0012 and no new dependency. [Next model-neutral C2 scope/query-proof assignment](docs/M2_CARD_REVIEW_C2_SCOPE_PROMPT_2026-10-07.md) is planning only, with new product defaults pending later approval. Earlier C1 correction rows become historical after source merge. Installed/signing/release gates remain separate.

**7 October C1 source reviewed; two UI corrections required:** 37 submitted source hashes and 45 evidence checksums verify. Independent affected frontend: 105 passes. New deterministic hook diagnostic: two controls pass/four failures across C1-R1 session-start ownership and C1-R2 history-page ownership (including erased entries resurfacing in UI after reset; database stays erased). [Specific review/Xcode verification](docs/M2_CARD_REVIEW_C1_REVIEW_2026-10-07.md); [one active model-neutral correction assignment](docs/M2_CARD_REVIEW_C1_CORRECTIONS_PROMPT_2026-10-07.md). Xcode 27/SDK 27 native verification: 415 passes/six ignores; desktop debug compile/link, Clippy and fmt pass; arm64 binary declares macOS 12 minimum. C1 remains uncommitted/unaccepted in the Mac implementation clone; approved C-D1–C-D8 persist. No app launch, installed/signing/release verification. Earlier implementation/assignment rows are historical where superseded.

**6 October M2 card C1 authorized:** The owner [approved all eight defaults C-D1–C-D8](docs/M2_CARD_REVIEW_OWNER_APPROVAL_2026-10-06.md) after independent corrected-scope acceptance (PR #108). [Active complete model-neutral C1 assignment](docs/M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md): implement material-level card reviews with `simple-v1`, durable version-owned scheduling and generation-protected reset, the next migration and disposable native/browser/UI verification. No repeat scope approval or real-user check-in is required. No new production dependency; implementer leaves changes uncommitted/unpushed for independent review. Prior accepted evidence is unchanged; source acceptance and installed/signing/release gates remain separate. Earlier pending-approval entries are historical.

**6 October M2 card scope accepted for planning:** CRS-R1/R2 closed; independent corrected proof passes 48/48, and all four proposal hashes, 18 correction-evidence checksums and 10 current-proof checksums verify. [Acceptance/defaults](docs/M2_CARD_REVIEW_SCOPE_ACCEPTANCE_2026-10-06.md); [complete conditional model-neutral C1 assignment](docs/M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md). All eight product defaults remain pending explicit owner approval; no production dependency/schema/source implementation is activated by planning acceptance. The submitted Q1 mutation receipt had a binding error; independent correctly bound timing mutation proves assertion sensitivity. Prior correction prompts are completed/historical. PR2 acceptance and the check-in waiver persist; installed/signing/release gates remain unresolved.

**6 October M2 card scope reviewed — contract corrections required:** All four proposal hashes and 16 evidence checksums verify; independent submitted scheduler/research proof passes 27/27. Five new targeted planning diagnostics fail: queue timing/current-version filtering (CRS-R1), reset stale-request protection and repeated erase (CRS-R2). [Specific review](docs/M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md); [one active model-neutral correction assignment](docs/M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md). Draft scope/conditional C1 prompt are published for review, not accepted production scope. Scheduler/research work and PR2 acceptance are preserved; owner approval follows corrected scope acceptance. No production source/dependency/schema or installed/release work. Earlier rows are historical.

**6 October M2 PR2 source accepted:** Durable practice, completed-history navigation and explicit atomic erasure are independently reviewed, including R14 read recovery. All 32 submitted path hashes and 34 latest evidence checksums verify. Independent focused checks: 208 passes plus 21 actual import passes, zero unhandled errors; current-main full gate: 2,568 frontend passes/four skips, 391 Rust passes/six ignores, all source checks clean. [Acceptance](docs/M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md) and the containing exact-head-green source PR supersede prior pending-correction entries. [Next model-neutral assignment](docs/M2_CARD_REVIEW_SCOPE_PROMPT_2026-10-06.md): prepare card-review scope and an isolated open-source scheduler evaluation; new production scope/dependency approval remains separate. Installed/signing/release gates remain unresolved; no app launch or release work. Earlier rows are historical.

# Her Flight Deck — current project status

M2 PR2 read recovery review, 6 October 2026: R11–R13 independently closed (160affected tests pass,zero unhandled). One remaining PR2 defect R14: MaterialDetail metadata reads have no rejection handlers; deterministic2failures/2unhandled errors. Those reads are new in PR2, not wholly accepted PR1. Scoped subprocess test timeout allowance approved; global/performance budgets unchanged. All29source/28completion evidence hashes verify. Source remains uncommitted/unaccepted as full PR2. See [review](docs/M2_PRACTICE_SESSION_PR2_READ_RECOVERY_REVIEW_2026-10-06.md) and [active focused model-neutral assignment](docs/M2_PRACTICE_SESSION_PR2_READ_RECOVERY_FIX_PROMPT_2026-10-06.md). Existing approval and controller fixes persist; older entries are historical.

M2 PR2 controller review, 6 October 2026: preserve verified R5–R10 work; StrictMode lifecycle and replacement-content read recovery remain blockers (R11/R12), with one supplementary direct-material lock defect (R13). Independent146frontend passes/3failures/1induced unhandled read rejection;5native erasure passes. All29source/35submitted evidence hashes verify. Answer-click start with acknowledged ordering accepted. Source remains uncommitted/unaccepted. See [review](docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_REVIEW_2026-10-06.md) and [active specific model-neutral correction](docs/M2_PRACTICE_SESSION_PR2_CONTROLLER_FIX_PROMPT_2026-10-06.md). Existing approval/accepted PR1 persist; older review entries are historical.

M2 PR2 correction re-review, 5 October 2026: all ten original diagnostics pass; five remaining UI groups (R5–R9, eight failing assertions) and invalid full-gate claim (R10) require one bounded correction. Independent focused results: 84pass/8fail, zero runtime errors; isolated import21pass. Submitted full log contains two unhandled errors. Source remains uncommitted/unaccepted. See [specific review](docs/M2_PRACTICE_SESSION_PR2_REREVIEW_2026-10-05.md) and [active model-neutral finishing assignment](docs/M2_PRACTICE_SESSION_PR2_FINISH_CORRECTIONS_PROMPT_2026-10-05.md). Existing approval/accepted PR1 persist; older review rows below are historical.

M2 PR2 review, 5 October 2026: application source remains uncommitted; four confirmed UI confirmation/refresh/history-route/erasure-identity blockers remain. Independent focused results: 46 frontend passes, 9 new failures and 4 native erasure passes. See [review](docs/M2_PRACTICE_SESSION_PR2_REVIEW_2026-10-05.md) and [correction assignment](docs/M2_PRACTICE_SESSION_PR2_CORRECTIONS_PROMPT_2026-10-05.md). Existing approval and accepted PR1 remain effective.

M2 PR1 source review completed on 5 October 2026: R1–R4 and remaining startup/FK/rollback corrections verified; 2,498 frontend and 386 Rust tests pass. Integration is conditional on required CI before merge. See [completion review](docs/M2_PRACTICE_SESSION_PR1_COMPLETION_REVIEW_2026-10-05.md) and [PR2 assignment](docs/M2_PRACTICE_SESSION_PR2_PROMPT_2026-10-05.md). Installed/release gates remain separate.

**4 October M2 PR 1 initialization re-review — R3 still open:** [Review](docs/M2_PRACTICE_SESSION_PR1_READINESS_REVIEW_2026-10-04.md) verifies all previous boundary fixes, 29 frontend passes and171 existing native passes. Three additional failures remain: browser invalid-state reopen, missing schema FK definition and conversion committed before semantic failure. [One focused model-neutral assignment](docs/M2_PRACTICE_SESSION_PR1_READINESS_CORRECTIONS_PROMPT_2026-10-04.md) completes actual browser validation, FK metadata and atomic initialization while preserving closed fixes. Source stays uncommitted/unaccepted; PR2 and installed/signing/release work deferred.

**4 October M2 PR 1 R3 boundary review — source still pending correction:** [Review](docs/M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_REVIEW_2026-10-04.md) verifies 29 frontend passes and all 166 backup/recovery/practice tests. Five boundary assertions still fail: wrong-key unique index, no-op ownership trigger, wrong receipt version, false unfinished totals and missing production validation/readiness. Keep verified R1/R2/R4 and earlier R3 fixes. [One concrete model-neutral assignment](docs/M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_CORRECTIONS_PROMPT_2026-10-04.md) finishes already-approved R3 semantics/integration. Source stays uncommitted/unaccepted; PR2 and installed/signing/release work deferred.

**4 October M2 PR 1 corrections re-reviewed — R3 remains open:** [Independent re-review](docs/M2_PRACTICE_SESSION_PR1_REREVIEW_2026-10-04.md) verifies original R1/R2/R4 correction behaviors and all 13 original diagnostics. Focused runs: 26 frontend passes; 27 native passes/six remaining archive-semantic failures. Source is uncommitted/unaccepted. [One focused model-neutral assignment](docs/M2_PRACTICE_SESSION_PR1_VALIDATION_CORRECTIONS_PROMPT_2026-10-04.md) finishes the already-approved R3 contract while preserving closed fixes. PR2 and installed/signing/release work remain deferred.

**4 October M2 PR 1 independently reviewed — corrections required:** [Review](docs/M2_PRACTICE_SESSION_PR1_REVIEW_2026-10-04.md) confirms M2P1-R1–R4: startup reconciliation/readiness, score/no-op timestamp accuracy, schema-11 archive validation and unsupported atomic-writer refusal. Independent disposable diagnostics: seven frontend failures; five native failures and one valid-schema control pass. All 26 submitted hashes still match. [One model-neutral correction assignment](docs/M2_PRACTICE_SESSION_PR1_CORRECTIONS_PROMPT_2026-10-04.md) preserves owner-approved scope. Source remains uncommitted/unaccepted in the Mac integration checkout; PR 2 deferred. No installed/signing/release work. Older planning entries below are historical.

**4 October M2 practice-session proposal reviewed — scope corrections required:** [Independent planning review](docs/M2_PRACTICE_SESSION_SCOPE_REVIEW_2026-10-04.md) keeps the user outcome/two-PR split and requests M2S-R1–R3: truthful retention, complete atomic replay/state contracts, and actual migration/version-writer/restore integration. The draft SQL was exercised only in a disposable in-memory diagnostic; no M2 production defect or implementation is claimed. [One model-neutral correction prompt](docs/M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md) finishes the concrete proposal before owner approval. Original draft stays local/uncommitted; accepted Slice B and installed/signing/release status are unchanged.

**4 October Slice B source accepted:** [Independent acceptance](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md) closes SB-R1/SB-R2 after verifying the 64-file correction receipt, 124 focused frontend and 65 native tests, and a full sequential integration gate (2,460 frontend pass/four skips; 336 Rust pass/six ignores; build/types/Clippy/fmt/lock/diff clean). The existing production Unicode library is pinned exactly to 0.1.25; no newly resolved package/version. The containing source PR supplies the final CI/merge record. [Next model-neutral assignment](docs/M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) prepares a bounded resumable-practice-test scope for owner approval; no further implementation or migration is authorized yet. MAC-23 / TB-INST-01–04 remain UNVERIFIED. No installed/account/provider/signing/packaging/release work. Older pending-review snapshots below are historical.

**4 October Slice B SB-R1/SB-R2 corrected, pending Codex re-review:** The confirmation preview now displays full inspectable content (guide summary/sections/notes, flashcards front/back, structured questions, choices, answers, explanations) and per-item unverified source references; choice IDs are disclosed in discard reporting and counts include choices and references; explicit absence wording handles guide-only and test-only packets; upload and answers disclaimer states nothing is uploaded and answers come from the packet. SB-R2 promotes the already-locked `unicode-normalization` 0.1.25 crate to a direct dependency in `src-tauri/Cargo.toml` without any new resolved package/version, enforcing full NFC in native line/block normalizers before bounds, title comparison, duplicate choice detection, and idempotent retries. Shared contract fixtures extended to 49 cases. Permanent regressions added for both findings with demonstrated fail-before/pass-after. Full sequential local gate passed (typecheck, 2,460 npm tests pass / 4 skips, build, 336 cargo tests pass / 6 ignored, clippy -D warnings, cargo fmt --check, test:cargo-lock, git diff --check). Implementation remains uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on `codex/structured-study-import-slice-b`. Four installed observations (TB-INST-01–04, MAC-23) remain UNVERIFIED. No release, signing, packaging, account or migration work.

**4 October Slice B implementation review — two corrections required:** [Independent review](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_REVIEW_2026-10-04.md) verifies all 48 submitted hashes, 110 focused frontend tests and 60 native tests. SB-R1 omits inspectable content and per-item references from the confirmation preview; SB-R2 omits native NFC (two failed diagnostics each, with passing TypeScript controls). [One active model-neutral correction assignment](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md) supersedes the initial assignment for remaining work. It permits only promoting the already-locked unicode-normalization 0.1.25 crate for SB-R2; no new resolved package/version. Implementation remains local, uncommitted and unaccepted. Owner D1–D9 approval, A2 acceptance and check-in waiver persist. Four installed observations remain UNVERIFIED; no account, signing, packaging or release work. Earlier implementation/gate snapshots below are historical where superseded.

**4 October Slice B authorized:** The owner [approved scoped study-packet import and all D1–D9 defaults](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_OWNER_APPROVAL_2026-10-04.md), including the older-version limitation. A2 acceptance and the M2 check-in waiver remain in force. [Active model-neutral implementation assignment](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) implements preview, create-new atomic save, offline reopening and provenance using accepted Zod. No new dependency/migration/replacement/Markdown or release work. The 65 source/development requirements are in scope; four installed observations remain unverified. Earlier pending-scope entries are historical.

**4 October Mac release preparation accepted:** [Final independent acceptance](docs/MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md) closes RELPREP-R1–R3, including cleanup resilience. All 41 assertions pass independently (32 executable synthetic cases, 9 structural checks); the original diagnostic confirms credential cleanup proceeds and reports failure correctly. [Preparation package](docs/MAC_RELEASE_PREPARATION_2026-10-04.md) and the inactive signing proposal are integrated. Signing credentials/lane, version decision, actual packaging and installed verification remain release prerequisites. [Conditional model-neutral continuation](docs/MAC_RELEASE_CONTINUATION_PROMPT_2026-10-04.md). No signing workflow activation, testing-account work or release publication occurred. Older pending-review entries are historical.

**Mac release cleanup re-review (4 October 2026):** [Independent result](docs/MAC_RELEASE_PREPARATION_CLEANUP_REVIEW_2026-10-04.md): R2b and the main R2a state-transfer corrections accepted; state-file removal failure can abort credential cleanup under GitHub Bash options. All submitted checks pass (37 printed assertions, not the claimed 35). [Focused model-neutral correction](docs/MAC_RELEASE_PREPARATION_CLEANUP_FIX_PROMPT_2026-10-04.md). Proposal remains inactive; no testing-account work or release publication.

**4 October release-proposal re-review:** [Independent checks](docs/MAC_RELEASE_PREPARATION_REREVIEW_2026-10-04.md) accept RELPREP-R1/R3 and pass all 24 submitted synthetic cases. RELPREP-R2 remains for multiline keychain-state/cleanup handling and a manual/main guard before credentials are supplied. [Focused model-neutral assignment](docs/MAC_RELEASE_PREPARATION_WORKFLOW_FIX_PROMPT_2026-10-04.md) covers only those fixes. The proposal remains inactive; implementation/source are preserved; no package rebuild or account work is assigned. Installed/signing/release approval remains unresolved.

**4 October Mac release preparation review — corrections required:** [Independent review](docs/MAC_RELEASE_PREPARATION_REVIEW_2026-10-04.md) verifies the local DMG bytes/hash but finds a corrupt non-active signing patch, incomplete identity/validation guards and incorrect source/observation claims. [Implementation correction assignment](docs/MAC_RELEASE_PREPARATION_CORRECTIONS_PROMPT_2026-10-04.md) targets one bounded proposal/evidence pass without rebuilding or launching the app. Implementer work and active workflows are preserved. Owner has deferred test-account work; installed/signing/release gates remain unverified. A2 source acceptance remains intact.

**4 October final Mac A2 review accepted:** [Independent acceptance](docs/MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md) closes MVER-R1–R3 and publishes the native regression plus corrected evidence. Production source is unchanged. The owner has deferred test-account work and will wait for a release; no installed testing is authorized by that decision. Apple Developer membership is not available. Installed/signing/release checks remain unverified. [Next Claude assignment](docs/CLAUDE_MAC_RELEASE_PREPARATION_PROMPT_2026-10-04.md) prepares a reviewable release path without launching the app or publishing a release. Older pending-review entries below are historical.

**Mac A2 correction re-review (4 October):** [Independent re-review](docs/MAC_A2_VERIFICATION_REREVIEW_2026-10-04.md) accepts the native Mac case-alias regression behavior (21 independent host harness passes: 20 exercised plus one early return). All 29 handoff hashes and 15 log mirrors match. One [final evidence-only correction pass](docs/CLAUDE_MAC_A2_VERIFICATION_FINAL_EVIDENCE_PROMPT_2026-10-04.md) remains for three incorrect hash values, snapshot/timing labels and six new receipt EOF whitespace diagnostics. Implementer files preserved; production acceptance unchanged. Installed/signing/release gates remain separate. Earlier review entries are historical where superseded.

**Mac A2 verification re-review requests bounded corrections (4 October):** [Independent review](docs/MAC_A2_VERIFICATION_REVIEW_2026-10-04.md) confirms 24 accepted source blobs and inspects successful Mac logs, but requests MVER-R1–R3: missing Mac case-insensitive delete/trash regression, contradictory preflight/byte-hash/timing/exit claims, and 15 ignored evidence logs. [Claude correction prompt](docs/CLAUDE_MAC_A2_VERIFICATION_CORRECTIONS_PROMPT_2026-10-04.md); [review evidence](docs/evidence/mac-a2-verification-review-2026-10-04/README.md). A2 production acceptance is unchanged; submitted Mac report remains local/uncommitted/unaccepted. No full matrix is reassigned. Check-in waiver stays effective; installed and release status is unchanged.

**Owner check-in waiver and next Mac verification (4 October):** The owner [waived the M2 real-user check-in](docs/M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md). A2 is published and accepted via [PR #78](https://github.com/rickydeleon49-ui/Flight-training-/pull/78), merge `5587251`, with required CI green on `8a69fa2`. Use the [updated Claude Mac verification prompt](docs/CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md). Verification has not been executed by this documentation update. Separate Slice B scoped approval/D1–D9, dedicated-account/signing, installed and release requirements remain open; older check-in requirements are superseded.

**A2 integrated source accepted (4 October):** Codex reviewed Gemini’s latest-main candidate, completed R14 fixture integration, strengthened exact rollback/reopen coverage, and fixed Windows checkout/SDK-path test failures. [Acceptance](docs/A2_INTEGRATION_ACCEPTANCE_2026-10-04.md) and [evidence](docs/evidence/a2-integration-acceptance-2026-10-04/README.md): 2,348 frontend pass/four skips, 302 Rust pass/six ignores, build/fmt/Clippy/locks/version pass; all 29 unchanged Unix helper checks pass in WSL. The containing source PR supplies exact-head CI/publication. [Next Mac assignment](docs/CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md) verifies that published source; installed/APFS/older-macOS, M2/D1–D9/Slice B and release holds remain open. Previous review blocker entries below are historical.

**Windows A2 tenth review — R13 passes; latest-main fixture compatibility blocks integration (4 October):** [Review](docs/A2_TENTH_REVIEW_2026-10-04.md) independently passes all 2,085 focused cases/all 57 shared seams, including prior write-loss reproductions. Actual implementer full-gate logs supplied (old-owner frontend 1,998/Rust 283 pass). Main 37ec9a1 plus A2 fails five of eight Study Library scenario tests: the newer fixture still calls public BEGIN, which A2 correctly refuses. All 24 owner hashes match; 311 git-listed owner files unchanged. [Current integration prompt](docs/GEMINI_A2_LATEST_MAIN_INTEGRATION_PROMPT_2026-10-04.md), [evidence](docs/evidence/a2-tenth-review-2026-10-04/README.md). No app source committed/integrated; owner untouched; Mac/Slice B/release holds unchanged. Earlier entries are historical.

**Windows A2 ninth review — R11/R12 pass; R13 line-comment boundary blocks source integration (4 October):** [Review](docs/A2_NINTH_REVIEW_2026-10-04.md) independently verifies all 1,227 accumulated focused cases / all 57 prepared seams. CR inside a line comment is wrongly treated as comment end: 64 refusal failures, four valid-SQL false rejections, two actual acknowledged-write losses in browser/test drivers (combined 1,235 pass/70 fail). All 24 supplied hashes match; 307 owner files unchanged. No native/installed loss demonstrated. [Current prompt](docs/GEMINI_A2_LINE_COMMENT_CORRECTION_PROMPT_2026-10-04.md), [evidence](docs/evidence/a2-ninth-review-2026-10-04/README.md). Source remains uncommitted/unaccepted; raw current full-gate logs absent; Mac/Slice B/release holds persist. Earlier entries are historical.

**Windows A2 eighth review — 1,035 focused checks pass; trigger boundary corrections remain (4 October):** [Review](docs/A2_EIGHTH_REVIEW_2026-10-04.md) confirms previous leading-BOM/parameter and actual write-preservation regressions pass. R12 decimal punctuation leaks header table expectation; R11 BOM before trigger body BEGIN leaves header open. Eight real-engine/public controls pass; 64 refusal combinations fail (1,043 pass/64 fail combined). Computed 24 observed hashes, 307 owner files unchanged; no new expected-hash manifest/raw full-gate logs supplied. No new/native data loss demonstrated. [Current prompt](docs/GEMINI_A2_TRIGGER_TOKEN_ROLE_CORRECTION_PROMPT_2026-10-04.md), [evidence](docs/evidence/a2-eighth-review-2026-10-04/README.md). A2 remains local/uncommitted/unaccepted; Mac/Slice B/release holds persist. Older review entries are historical.

**Windows A2 seventh review — 873 focused checks pass; BOM/variable blockers remain (4 October):** [Independent review](docs/A2_SEVENTH_REVIEW_2026-10-04.md) verifies all 24 hashes and 307 owner files unchanged. Prior identifier correction passes. R11: leading BOM permits real public transactions and loses an acknowledged synthetic row in browser/Node drivers. R10 still fragments Tcl-style parameter interiors. Combined 891 pass/50 fail; no native desktop loss demonstrated. Use the [bounded correction prompt](docs/GEMINI_A2_BOM_PARAMETER_CORRECTION_PROMPT_2026-10-04.md) and [evidence](docs/evidence/a2-seventh-review-2026-10-04/README.md). Source remains local/uncommitted/unaccepted; Mac, Slice B and release holds remain. Older review entries below are historical.

**Windows A2 sixth review — submitted correction passes, R10 token boundary remains (4 October):** [Independent review](docs/A2_SIXTH_REVIEW_2026-10-04.md) confirms 24/24 hashes, 307 owner files unchanged and all 557 submitted focused checks pass, including all 98 historical reviewer cases and 181 prepared diagnostics. Scanner ASCII fragments of valid dollar/non-ASCII identifiers falsely change CASE depth and suppress later transaction refusal, including ordinary SELECT. New 16 legality controls pass; 136 combinations of one defect fail (573 pass/136 fail combined). Use the [whole-token correction prompt](docs/GEMINI_A2_WHOLE_TOKEN_CORRECTION_PROMPT_2026-10-04.md) and [shared evidence](docs/evidence/a2-sixth-review-2026-10-04/README.md). Prior R8 header and R9 corrections pass; source remains local/uncommitted/unaccepted. Mac, Slice B and release gates remain held; older review rows below are historical.

**Windows A2 fifth review — one R8 variant remains (4 October):** [Independent review](docs/A2_FIFTH_REVIEW_2026-10-04.md) confirms 24/24 hashes and 307 owner files unchanged, 140 maintained focused tests, all 26 prior reviewer cases and all 181 prepared diagnostics pass. R9 title preservation passes. A trigger on unquoted `end` or SQLite single-quoted table spelling leaves header context active, so trailing transaction controls are not refused. Eight engine/public legality controls pass; 64 combinations of one defect fail (355 pass/64 fail overall). Use the [single-issue correction prompt](docs/GEMINI_A2_TRIGGER_HEADER_CORRECTION_PROMPT_2026-10-04.md) and [shared receipts](docs/evidence/a2-fifth-review-2026-10-04/README.md). Source stays local/uncommitted/unaccepted; this supersedes the correction state of prior reviews below without clearing Mac, Slice B or release gates.

**Owner roadmap addition (3 October):** [Planned aviation weather and FAA reference integrations](ROADMAP.md#17-aviation-weather-and-faa-reference-data-3-october-2026) cover lesson-airport METAR/TAF, airport/frequency data and ACS/knowledge-test references for grounded Gemini practice. Planning only. The owner reports A2 fixes are in progress and will notify Codex when ready; independent acceptance and existing implementation/installed/release gates remain pending.

**Windows A2 fourth review — two bounded variants remain (3 October):** [Independent review](docs/A2_FOURTH_REVIEW_2026-10-03.md) confirms 24/24 submitted hashes, 92 maintained focused tests, all 12 previous reviewer cases and all 181 shared diagnostics pass on Windows. New positive engine controls expose remaining R8 END-identifier over-refusal; notes-only saves expose R9 omitted-title trimming. Combined result: 291 pass/eight new failures; 307 owner files unchanged. Use the [narrow Windows correction prompt](docs/GEMINI_A2_FINAL_EDGE_CORRECTIONS_PROMPT_2026-10-03.md) and [shared receipts](docs/evidence/a2-fourth-review-2026-10-03/README.md). Source remains local/uncommitted/unaccepted; Mac execution, Slice B and release gates stay held. The third-review findings below retain their historical evidence; this review supersedes their current correction status.

**Windows A2 third review requests corrections (3 October):** [Independent review](docs/A2_THIRD_REVIEW_2026-10-03.md) confirms all 24 submitted hashes, 84 maintained focused tests and the original five reviewer diagnostics pass. Two P2 blockers remain: R8 rejects legal CASE expressions in triggers; R9 normalizes omitted stored values during a partial update. The shared 181-case package was executed on Windows: 179 pass/two AR-02 failures; additional reviewer cases reproduce both defects. [Windows correction prompt](docs/GEMINI_A2_R8_R9_CORRECTION_PROMPT_2026-10-03.md) and [sanitized evidence](docs/evidence/a2-third-review-2026-10-03/README.md) are shared. The owner implementation stays local/uncommitted and unaccepted; this documentation does not unblock Mac execution, Slice B or release gates.

**Slice B prerequisite check reviewed (3 October):** [Independent gate review](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_GATE_REVIEW_2026-10-03.md) confirms Gemini correctly stopped. Clean Mac main and Slice A are verified; accepted A2/R6–R7 source, M2 check-in/scoped approval or explicit narrowing, and D1–D9 remain missing. No new source work or duplicate preparation is assigned.

**Slice B preparation accepted (3 October):** [Independent acceptance](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_ACCEPTANCE_2026-10-03.md) closes BPREP-R1–R4 as preparation/specification findings after bounded evidence corrections. [Accepted report](docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) restores complete native invariants, valid summary-only/notes content and eight RFC UUID v4 fixtures; 69 test rows remain planned (65 source/dev + four installed). [Gemini's reviewed conditional implementation prompt](docs/GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-03.md) begins with one gate check. No B save/UI code exists; published accepted A2, M2 check-in/scoped approval and D1–D9 including D3 remain prerequisites. Source, installed and release gates remain unchanged.

**Structured study-import Slice A independently source-accepted (3 October):** [Acceptance](docs/STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md) closes SA1/SA2 under the recorded [owner exception](docs/STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md). The Mac source now includes exactly `zod@4.6.5`, pure packet validation/preview and import DTOs, a read-only native picker/wrapper, tests and the Zod notice. Source integration requires the containing PR's exact-head required check and merge; the PR supplies that receipt. There is no import screen or save operation yet.

- **Independent review:** 95/95 submitted hashes matched across 96 files. Gemini changed only five expected documents; production/runner/tests/fixtures/manifests/notice bytes stayed unchanged. Three original snapshots are preserved. Codex corrected a broken evidence citation and made the archived report's old links inert. [Corrected implementation report](docs/STRUCTURED_STUDY_IMPORT_SLICE_A_IMPLEMENTATION_2026-10-03.md), [implementation evidence](docs/evidence/structured-study-import-slice-a-2026-10-03/README.md), [acceptance evidence](docs/evidence/structured-study-import-slice-a-acceptance-2026-10-03/README.md).
- **Codex-measured source checks:** prior 241 focused frontend tests, typecheck and 16 native reader tests; clean mutation control 231/exit 0 and 22 expected outcomes (19 caught, three neutralized, zero infrastructure errors); actual mismatched CLI exit 1. This documentation re-review repeated hashes, source/report comparison, links and whitespace only.
- **Gemini-reported full local gate:** 941 frontend tests passed/four skipped, build/typecheck passed, 266 Rust tests passed/six ignored, fmt/Clippy/lockfile/whitespace green. Codex did not repeat that unchanged matrix. Required source CI uses the full Ubuntu job.
- **Open-source adoption:** exact Zod pin and MIT notice included; source and built notices match. The Function-constructor check is a Node simulation with zero calls under jitless; actual WKWebView/CSP and macOS 12 remain UNVERIFIED.
- **Next assignment:** [Reviewed conditional Gemini Slice B prompt](docs/GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-03.md). Preparation is accepted; begin implementation only after published accepted A2, the M2 check-in/scoped approval and D1–D9 are recorded and main is clean/synchronized. The Slice A exception covers A only.
- **Remaining gates:** Slice B and optional Slice C have not started. Dedicated standard test account, signing decision, installed Mac/Windows evidence and existing release holds remain open. No migration, provider flow, real user data or release identity changed.

**Mac installed-readiness preparation accepted (3 October):** [Independent acceptance](docs/MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md) closes R1–R4. After CI/merge and clean synchronization, [Claude prepares the structured study-import contract](docs/CLAUDE_STRUCTURED_STUDY_IMPORT_CONTRACT_PROMPT_2026-10-03.md). This task adds a [read-only preflight](docs/MAC_READINESS_PREFLIGHT.md) (`scripts/mac-readiness-preflight.mjs`, no dependency, 34 focused tests) and an [isolated installed-test and signing runbook](docs/MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md).

- **Host receipt today:** macOS 27.0.1, Apple M5, arm64; Node 22 and Rust 1.99; explicit SDK 26.5 present. The result is 9 PASS, 0 FAIL, 3 UNVERIFIED and 3 USER_ACTION, which is not ready.
- **Nothing was run on the app.** No build, install, launch, signing or notarization; installed checklist outcomes are unchanged.
- **Owner actions still needed:**
  - a dedicated standard test account
  - the signing/notarization decision and owner-provisioned credentials in an eligible protected CI environment or the reviewed local/manual alternative
  - a version and identity decision for any signed candidate, which cannot inherit approval from the frozen v0.5.3 draft
- **Corrections:**
  - **R1:** a signature passes only after strict `codesign --verify`. App and disk-image signatures are reported separately, and failed commands never pass.
  - **R2:** an SDK passes only on its readable evidenced version, 26.5; 27.0 fails.
  - **R3:** receipts use fixed categories and contain no raw certificate holders, sources or paths.
  - **R4:** the runbook separates the normal first-open confirmation from Gatekeeper refusals.
  - **Signing:** private-repository environment reviewers may need a plan the owner has not confirmed, so the recommendation is conditional, with a local/manual alternative.
- **Results:** 34 tests pass. The reviewed script fails 23 of them, including every new regression. The corrected host receipt is again 9/0/3/3.
- A2 production source is still pending its Windows owner.

**Mac A2 preparation accepted (3 October):** [Independent acceptance](docs/MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md) closes PREP-R1–R3 and confirms 36 controls passed. The shared package and Windows-owner handoff are accepted for reviewed publication; A2 production source is still pending. After CI/merge, [Claude prepares a read-only Mac readiness checker and isolated installation/signing runbook](docs/CLAUDE_MAC_INSTALLED_READINESS_PREPARATION_PROMPT_2026-10-03.md). Installed results and release readiness remain unverified.

_Updated 3 October 2026 · Latest release: `v0.5.1` · Version `0.5.2` permanently retired · **Windows distribution on hold on v0.5.1; Mac candidate draft prepared at v0.5.3, release approval held after independent audit**_

## Shared Windows/Mac handoff — 2 October 2026

**A5 evidence accepted (3 October):** [Independent acceptance](docs/MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md) confirms source and receipt hashes, inspected fixture/archive/PDFKit evidence and passing focused checklist checks. Documentation and evidence are prepared for required CI/merge; installed checks remain open. After publication, [Claude prepares Mac A2 verification](docs/CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md), completing the readiness package while preserving the Windows source owner.

**A6 merged (PR #50):** [Independent acceptance](docs/MAC_A6_RETRY_WORDING_ACCEPTANCE_2026-10-02.md), native correction and receipts are on main `b5bf8e0`; required CI passed on reviewed head `e25d940`. Live/installed behavior remains unverified.

**A4 merged (PR #49):** [Independent acceptance](docs/MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md), source and evidence are on main `db15394`; required checks passed on reviewed head `c4bed81`. Installed offline use remains open.

**A3 merged (PR #48):** [Independent R1–R4 acceptance](docs/MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md), source and review history are on main `1ae6986`; required checks passed on reviewed head `fc5c391`. Installed Mac/VoiceOver verification remains open.

**Mac baseline merged (PR #46):** [Independent baseline R1–R3 acceptance](docs/MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md) and sanitized evidence are on main. The A3 implementation assigned by its subsequent prompt is now accepted as described above. Installed Mac verification and release holds remain open.

**Mac is primary:** the main user will run the app on this Mac. [Owner decision and readiness order](docs/MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) prioritizes source consolidation, A2/compatibility/offline corrections, signing and installed synthetic-profile verification before everyday use. The corrected baseline and prior review history are shared with this publication. [Sanitized source receipts](docs/evidence/mac-source-evaluation-2026-10-02/VERIFICATION_RECEIPT.md) now accompany the Mac report; Windows-local A2 source remains unavailable on GitHub.

**Completed baseline assignment (R1–R3 accepted):** [The copy-ready continuation prompt](docs/CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md) assigns a bounded Study Library baseline and open-source go/no-go recommendation. [Mac report review](docs/MAC_REPORT_REVIEW_2026-10-02.md) reconciles the observed evidence and identifies benchmark coverage limits. A2 remains with its Windows implementer; no new library, production optimization or M2 migration is assigned by this measurement task.

[PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md) is the common starting point for both machines. Research, plans, correction prompts and sanitized review evidence are tracked in GitHub; future handoffs must be linked there rather than depend on a local drive or chat attachment. The [open-source continuation handoff](docs/OPEN_SOURCE_MAC_HANDOFF.md) includes the historical research, 170-repository evidence snapshot, adoption sequence, test gates and Mac prompt. No new production library was installed or copied.

The [Mac report](docs/MAC_SMOKE_RESULTS_2026-10-02.md), originally shared in [draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44), is incorporated with this baseline publication. It records source checks and an Apple Silicon evaluation DMG, with signing assessment and installed-test limitations. PR #44 becomes redundant once this publication merges; installed smoke tests remain unverified. A2 remains local and pending the [R6/R7 correction prompt](docs/A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md). All release holds remain unchanged.

## Mac GitHub handoff — 2 October 2026

**Physical Mac source checks (2 October):** [Local evidence](docs/MAC_SMOKE_RESULTS_2026-10-02.md) records a MacBook Air / Apple M5 / 32 GB / macOS 26.6, testing clean main `5e388bf4169c7f968b1581292d6e1a24aa0493da`. Node 22 frontend checks pass (594 tests, 4 skipped); native formatting, strict Clippy, tests (246 passed, 6 ignored), and lock synchronization pass using the installed macOS 26.5 SDK. The default macOS 27 SDK fails with the installed linker; the report retains that finding. Local Apple Silicon evaluation DMG build passed; its packaged app has an ad hoc signature, fails command-line Gatekeeper assessment, and has no stapled ticket. Installed-app testing is blocked pending a dedicated standard test account. This is source evaluation, not frozen-candidate verification or release approval.

The physical Mac hardware, OS, source checks and local evaluation artifact are now recorded above; installed-app results remain pending. The [self-contained Mac handoff](docs/MAC_GITHUB_HANDOFF_2026-10-02.md), [Mac session prompt](docs/MAC_SESSION_PROMPT.md) and [results template](docs/templates/MAC_SMOKE_RESULTS_TEMPLATE.md) are tracked in Git so the Mac requires no Windows-local attachments, logs or generated files. Use current `main` for source evaluation and record its exact commit. This documentation update does not close any physical-test or release gate.

**A2 remains local and unaccepted:** the [second-review summary](docs/A2_SECOND_REVIEW_2026-10-02.md) records the verified native corrections and two remaining browser/test-driver defects. Do not assume that cloning `main` includes those uncommitted fixes. A3/A4 are source-merged and A6 source-accepted for publication; installed-platform and release holds remain open. Preserve the frozen v0.5.3 artifact identity; distinguish a local source evaluation build from that private candidate.

## Current A1 status — shared source and regression repair accepted (1 October 2026)

**A1 is accepted in independent shared-source and regression review; merge requires passing required CI on the exact PR head.** [Final acceptance and evidence](docs/RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md) confirms functional corrections, original WAL/document return cases, prior canonical bytes and the corrected real-prefix temporary-sibling detector. Codex independently reran all 18 task-four cases, including the seeded-file negative control. Inspected final logs show 594 frontend and 262 Rust tests passing (144 backup tests); the unchanged debrief suite passed 12 tests independently. This does not close A2–A6, installed-platform testing or release holds:

1. **H1: Safe deletion ordering and enumeration propagation (`remove_pending_directory_safely`):** `remove_pending_directory_safely` uses fallible no-follow inspection (`symlink_metadata` and `is_symlink_or_reparse`) on the pending root and each entry. Directory enumeration (`read_dir`) and individual entry inspection errors are propagated immediately before `RESTORE_PLAN` is touched. The ownership plan is unlinked only after every non-plan payload deletion has succeeded. Callers in `backup.rs` use fallible `inspect_storage_root`. Verified by:
   - `round6_cleanup_enumeration_error_must_preserve_ownership_plan`: native Windows listing denial (`PermissionDenied` via .NET directory ACL), asserting plan and payload preservation.
   - `round6_cleanup_entry_read_fault_preserves_plan_and_recovers_on_restart`: private entry-read fault seam (`InjectedFault::PendingEntryRead`) proves plan survival and successful cleanup upon fault clearance.
   - `round6_cleanup_obstruction_during_startup_preserves_plan_and_clears_on_restart`: full startup recovery asserting `BlockedUnresolved` while obstructed, `RestoreCompleted` on cleared retry, and `ProceedNormally` on third launch with zero restore replay and conserved original data.
2. **H2: Calendar-independent debrief test fixture (`debriefLinks.test.ts`):** `beforeEach` configures scoped Date-only fake timers frozen at `2026-10-01T12:00:00Z`, with real-timer restoration in `afterEach`. UI promises and event dispatch remain real. All 12 tests pass independently; the scoped clock removes host-calendar dependence. No separate post-fix 6 October host simulation is claimed.
3. **H3: Critical transition evidence & durable contracts:**
   - **C1 (WAL return failure):** `task4_wal_original_return_failure_preserves_committed_wal_and_recovers` creates genuine SQLite WAL with committed rows absent from the main database, injects `ReturnDbRename(1)`, verifies `fired_count() >= 1`, asserts `BlockedUnresolved` on first startup, `RolledBackRecovered` on second startup, and `ProceedNormally` on third startup with the committed WAL row intact.
   - **C1 (Document return failure):** `task4_documents_original_return_failure_preserves_documents_and_recovers` tests two distinct original documents under `ReturnDocsRename`, verifying `fired_count() >= 1`, `BlockedUnresolved` on first launch, `RolledBackRecovered` on second launch, and `ProceedNormally` on third launch with exact SHA-256 and size preservation.
   - **C2 (Accurate WAL classification):** `task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original` updated with genuine SQLite WAL header and transaction bytes, covering install-move failure where `InstallDbRename(1)` fires before selected WAL movement. (The distinct boundary where an already-installed selected WAL is uninstalled and prevented from mixing with returned original data is covered separately by `round2_legacy_restore_wal_is_not_mixed_with_returned_original`.)
   - **C3 (Prior canonical bytes at write boundary & correct temporary-sibling detection):** `task4_prior_canonical_journal_preserved_on_write_sync_rename_failures` independently passes byte-identical prior canonical bytes/hash and successful replacement across `JournalTempCreate`, `JournalWrite`, `JournalSync` and `JournalRename`. The no-temporary-siblings check uses the actual `format!("{RESTORE_JOURNAL_FILE}.tmp-")` prefix, and dedicated negative-control test `task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control` verifies that seeded actual-prefix leftovers are caught and cleared upon removal.
   - **C4 (Exact file identities & real outcomes):** `task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers` uses exact SQLite file identities and asserts actual `RolledBackRecovered` and `ProceedNormally` startup decisions.
   - **C5 (Documented Unix directory-sync semantics):** `write_journal` documents best-effort parent directory sync: atomic rename already committed canonical replacement on disk; directory fsync is performed where supported, but does not invalidate committed state if directory file descriptors cannot be synced on the host OS/sandbox.
4. **Passing local suite:** 144 tests in `backup::tests::` pass; all 12 `debriefLinks.test.ts` pass; `cargo clippy --locked --all-targets -- -D warnings` and `cargo fmt --check` exit 0.

**Platform limits and release status:** A1 shared source/regression acceptance is complete; A2–A6 remain open. Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, early macOS 12, installed Windows and live Gemini remain UNVERIFIED. The frozen v0.5.3 DMG cannot certify newly changed source.

[Exact-head CI follow-up](docs/RESTORE_RETENTION_CI_FOLLOWUP_2026-10-01.md): Linux checks exposed an unused captured row in a Unix-only test, then a cleanup-retention expectation whose blocking handle existed only on Windows. Focused test-only corrections add the intended row assertion and verify successful cleanup on every platform while preserving the Windows locked-file recovery case. Production behavior is unchanged. Passing corrected exact-head CI remains the merge gate.

## A2 Mac verification preparation — 3 October 2026 (accepted for publication)

**Corrected and independently accepted (3 October):** the [review](docs/MAC_A2_PREPARATION_REVIEW_2026-10-03.md) found three prepared-observation defects (PREP-R1 to R3). All three are fixed:

- **PREP-R1:** QT-02 now reads with a single SQL statement. A barrier variant tests a read requested while the save holds ownership; it is conditional on the driver's statement route.
- **PREP-R2:** snapshots keep the complete stored state: tag ids, raw links, dangling references and the unrelated-table status. A rejected insert now counts as foreign-key enforcement only if the connection is still usable and SQLite raises its foreign-key error.
- **PREP-R3:** QT-11 checks the complete expected update outcome, and is split into an ordinary-refusal case and a conditional while-held case.

Codex independently confirms 36 task-local oracle controls pass on real engines without any A2 API. Four weakened helper variants are rejected; one equivalent variant passes. The diagnostic collects 181 tests (57 conditional); the reviewed version collected 93. This validates the prepared tests only. A2 is still unavailable and unvalidated. [Correction receipt](docs/evidence/mac-a2-preparation-2026-10-03/correction-receipt-2026-10-03.txt).

[Preparation report](docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md) with [evidence](docs/evidence/mac-a2-preparation-2026-10-03/README.md). The expanded prompt from PR #52 is incorporated. **Preparation is complete; A2 validation has not started.** A2 remains unaccepted and is not on main.

- **Publication state:** [Accepted preparation](docs/MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md) and handoff are prepared for reviewed Git/CI/merge. Application source is unchanged. [Claude's next assignment](docs/CLAUDE_MAC_INSTALLED_READINESS_PREPARATION_PROMPT_2026-10-03.md) prepares a read-only readiness tool and isolated installation/signing runbook.
- **Source availability (checked 2026-10-03T16:36Z): unavailable.**
  - There is no `fix/atomic-study-material-saves` branch.
  - None of the 52 PR heads, and no branch, touches the A2-only files.
  - Main lacks `saveMaterialAtomically` and `MaterialSaveOperation`. That is a prerequisite mismatch, so the five reviewer diagnostics were deliberately not run.
- **Prepared:**
  - an acceptance matrix with stable IDs across atomic records/tags, attachment/native conservation, queue/transaction ownership, browser durability and installed requirements
  - the historical 21 + 4 native and 67 frontend Windows results mapped to case IDs
  - the five diagnostics plus prepared cases, outside test discovery and statically validated only
  - fault seams, datasets and copy-ready worktree commands
  - an unsent handoff for the Windows owner
- **Run on this Mac (not A2):**
  - The engine probe shows that both real engines accept every transaction-control form through the driver routes, including `SAVEPOINT`, ending forms, and sql.js `exec` multi-statement strings.
  - Legitimate comments, parameters, quoted keywords, read PRAGMAs and trigger bodies stay safe.
  - sql.js `export()` drops an open transaction's rows and resets `PRAGMA foreign_keys` to 0.
  - Main's existing references pass: 53 frontend tests and 44 native `documents::tests`.
- **Blocked on:**
  - the Windows owner's corrected source, independently accepted by Codex and published with the requested receipt
  - installed checks, which still need the dedicated test account and a signing decision

## A5 fixture and verification-kit evidence reconciliation — 2 October evidence, accepted 3 October 2026

[Reconciliation report](docs/MAC_A5_EVIDENCE_RECONCILIATION_2026-10-02.md) with [sanitized receipts](docs/evidence/mac-a5-reconciliation-2026-10-02/README.md).

- **Code state:** ACCEPTED DOCUMENTATION/EVIDENCE on `codex/mac-a5-evidence-reconciliation`, base main `b5bf8e0` (after PR #50). No tooling, test or production change; no A5 requirement failed.
- **Verified on this Mac (macOS 27.0.1):**
  - Fixtures regenerate with the recorded hashes.
  - Fixture C has 60 distinct, deflate-incompressible images and ordered page IDs.
  - Release-safety suite: 51 passed, 1 deliberate skip.
  - Credential inspector returns 0 / 1 / 2 across 9 synthetic cases (including a real unreadable file) with no disclosure.
  - Native PDF tests pass, as does the opt-in 54 MB split (2 parts, ordered IDs, source unchanged; test-process peak RSS ~573 MB in a debug build, not app memory).
  - Apple PDFKit independently confirms pages, IDs and images of sources and split outputs and detects tampering.
- **Reconciled:** the tracker now labels the earlier pdfjs-dist / pdf-lib check and Fixture C part sizes as Windows-host results, and adds the Mac's deterministic split sizes (52,229,815 / 1,801,351 bytes against Windows' 51,731,349 / 1,784,008; same pages and limits; cause not established).
- **Still open:** installed splitting, memory and credential checks; A2 with its Windows owner; account and signing prerequisites.

[Codex acceptance and review limits](docs/MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md). After required CI/merge, use [Claude's A2 verification-preparation prompt](docs/CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md); A2 dependent tests require its matching shared source.

## A6 truthful Gemini retry wording — 2 October 2026 (source merged in PR #50)

[Implementation report](docs/MAC_A6_RETRY_WORDING_IMPLEMENTATION_2026-10-02.md) with [sanitized evidence](docs/evidence/mac-a6-retry-wording-2026-10-02/README.md).

- **Code state:** merged in PR #50 as main `b5bf8e0`, after required CI passed on reviewed head `e25d940`. [Codex acceptance](docs/MAC_A6_RETRY_WORDING_ACCEPTANCE_2026-10-02.md) is separate from the implementer report; historical source commit `32539bd`, base `db15394`.
- **Correction (`src-tauri/src/gemini.rs` only):**
  - The final "Google is busy" message no longer claims how long the attempts took. The old "over about 11 seconds" summed nominal pauses only, ignoring request time (up to 300 s per request), jitter and the backup request. The obsolete helper is removed.
  - A connection check that ends on 429 or 5xx no longer claims a backup model or generation retries. It never uses the backup.
  - Single-refusal wording is generic. Exhausted generation still says what it tried.
  - Retry policy, timeouts, backup selection, progress, payloads, models and key handling are unchanged.
- **Tests:** 4 Rust message-contract regressions. The negative control against the original code gives 3 failed / 1 guard passed.
- **Local gate (now on macOS 27.0.1 with SDK 26.5):** 666 frontend passed (4 skipped), build passed, 250 Rust passed (6 ignored), fmt/clippy/lock/diff checks passed.
- **Foundation checkpoint:** A1/A3/A4 merged; A6 source accepted for publication; A2 remains with its Windows owner. A5 tooling corrections already exist on main; [Claude's next task reconciles remaining current-Mac evidence](docs/CLAUDE_MAC_A5_EVIDENCE_RECONCILIATION_PROMPT_2026-10-02.md), changing only proven gaps. Current `sw_vers` confirms macOS 27.0.1 (26A434); earlier reports recorded 26.6 without an established upgrade history. Installed readiness remains blocked on the test account/signing prerequisites.

## A4 saved study content offline — 2 October 2026 (source merged in PR #49)

[Implementation report](docs/MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md) with [sanitized evidence](docs/evidence/mac-a4-offline-study-2026-10-02/README.md).

- **Code state:** merged in PR #49 as main `db15394`, after required CI passed on reviewed head `c4bed81`. [Codex acceptance](docs/MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md) is separate from the implementer report; historical source commit `c77dab9`, base `1ae6986`.
- **Correction:**
  - Saved guides, flashcards and practice tests now stay readable and usable when Gemini is disconnected, its status is loading or failed, the source file is missing, replaced, unsupported or oversized, or no file is attached.
  - A single notice explains why creating or regenerating is unavailable, without hiding saved content.
  - Explicit "Send to Gemini" submission, the generation lock, stale-result ownership and failed-regeneration retention are unchanged. Saved content now also stays visible while regenerating.
  - Reading, revealing and answering saved content make no Gemini or network calls. Attempts stay transient.
- **Tests:** 11 regressions in `MaterialDetailOffline.test.ts`. The negative control against the original page gives 9 failed / 2 passed (connected guards).
- **Local gate:** 666 frontend passed (4 skipped), build passed, 246 Rust passed (6 ignored), fmt/clippy/lock/diff checks passed.
- **Still open:** installed offline use (MAC-19), VoiceOver and Windows. A6 retry wording follows separately. No dependency, migration or release change.

## A3 WebKit compatibility — 2 October 2026 (R1–R4 source merged in PR #48)

[Implementation report](docs/MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md) with [sanitized evidence](docs/evidence/mac-a3-compat-2026-10-02/negative-control-summary.txt).

- **Code state:** merged in PR #48 as main `1ae6986`, after passing required CI on reviewed head `fc5c391`. [Codex acceptance](docs/MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md) is separate from the implementer report; historical source commit `66e8178`, base main `8b61d87`.
- **Corrections:**
  - **Toolkit:** defaults and normalization no longer need `structuredClone` (Safari 15.4 / macOS 12.3). Every returned toolkit now owns its nested data; previously, normalized readiness items aliased the shared defaults.
  - **Dialog and Quick Find:** keep the native modal `<dialog>` where `showModal`/`close` exist. Otherwise a shared accessible fallback provides role, `aria-modal`, initial focus, Tab containment, Escape/backdrop as owner requests, focus return, background exclusion and layering.
  - **New ids:** a version 4 UUID built from `crypto.getRandomValues` when `crypto.randomUUID` is missing (WebKit bug 229240 landed after Safari 15.0); fails clearly without secure randomness.
- **Codex review A3-R1–R3 (modal stack), accepted:**
  - Exclusion is recomputed from the current top modal, so lower sibling dialogs are hidden.
  - A new top modal is layered above every surviving one, regardless of DOM order.
  - Focus restoration follows a validated chain and never lands in a closed, hidden or removed region.
  - 8 maintained regressions, including Codex's three diagnostics (7 fail on the reviewed hook; Codex's diagnostic file passes verbatim).
- **Codex re-review A3-R4 (nested lifetime), accepted:**
  - Fallback dialogs now render through a React portal at `<body>` level, so a nested dialog stays visible, viewport-wide and modal when its parent closes first.
  - Owner-controlled dismissal is unchanged; server rendering stays inline.
  - 8 regressions, including Codex's diagnostic (5 fail on the reviewed sources).
- **Tests:** 37 new capability-removal and native-path tests, including fresh provider startup and a real dialog save with all four APIs removed. The negative control against the original source gives 34 failed / 3 passed (the native-path tests).
- **Local gate on the corrected diff:** 655 frontend passed (4 skipped), build passed, 246 Rust passed (6 ignored), fmt/clippy/lock/diff checks passed.
- **Still required:** installed macOS 12.0–12.2 and current-macOS WKWebView/VoiceOver checks. MAC-03 remains UNVERIFIED. No minimum-OS, dependency, migration or release change.

## Mac Study Library baseline — 2 October 2026 (R1–R3 accepted; exact-head CI merge gate)

[Baseline report](docs/MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md) with [sanitized evidence](docs/evidence/mac-study-baseline-2026-10-02/README.md).

- **Code state:** Codex accepted and committed the corrected source on `codex/mac-study-library-baseline`, original base main `a4339fc`, incorporating PR #44's Mac documentation. [Independent acceptance](docs/MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md) distinguishes Codex-run checks from inspected implementer results. Required exact-head GitHub checks gate merge.
- **Benchmark:** Deterministic synthetic fixture over 100/1,000/5,000 materials plus a 10,000 stress tier. Every measured step is verified against an independent answer key before its sample is kept (R1). Results are per step, with compute for the same view (R3). Expanded displays up to 1,000 cards are measured (R2). The always-on scenario test includes final-state and intermediate-step negative controls.
- **Results (Node/jsdom on Apple M5, not WKWebView paint):**
  - Search compute is 0.14–1.54 ms per measured state at 5,000.
  - Interactions at 100 shown cost about 9–20 ms, independent of library size.
  - Show more grows with displayed cards: 16 ms at 200, about 97 ms per click at 1,000. A query from a 1,000-card display costs about 35 ms.
  - Edit plus full refresh: 20 ms at 5,000 and 35 ms at 10,000.
- **Decision:**
  - MiniSearch: no-go.
  - TanStack Virtual: no adoption justified for the initial 100- and 200-card displays.
  - Expanded displays exceed the proposed Node targets and remain an open, measured question for installed WKWebView evidence and a fair comparison, including a dependency-free alternative. They do not justify adoption on their own.
- **Local gate on the corrected diff:** 602 frontend tests passed (4 skipped), build passed, 246 Rust tests passed (6 ignored), fmt/clippy/lock/diff checks passed.
- **Unchanged:** No production code, package, migration or release state changed. Installed testing has not started.

## Independent full audit — 29 September 2026

[The current audit and implementation update](docs/FULL_REPOSITORY_AUDIT_2026-09-29.md) reviews current `main` at `c241c4a` and preserves the four pending release/test-kit files. **Release approval is held:** new independent reproductions found failed-restore rollback deleting its protected database, ordinary material/tag saves partially committing on duplicate tags, and a fresh-start compatibility failure when early macOS 12 lacks `structuredClone`. Native dialogs also assume APIs newer than the declared minimum. Saved local guides and practice tests become hidden when Gemini is disconnected. These findings apply to the existing candidate source, which has unchanged product files.

The existing suites passed: **575 frontend tests** (3 skipped), **158 Rust tests** (5 ignored), production build, Rust formatting/strict lint, and lock/version checks. npm reported zero advisories; current RustSec scanning reported zero unsuppressed vulnerabilities with the existing RSA exception and upstream informational warnings. Additional audit preservation/visibility assertions failed and are documented as new regression requirements. Temporary audit test edits were restored byte-for-byte; no product fixes, migration/version changes, commits, pushes, installer builds, or publication occurred.

Implementation priority: restore retention and restart safety → atomic material/tag/file ownership → macOS minimum compatibility → offline saved-study visibility → fixture/status accuracy. Run focused tests for each correction and one final local matrix before Codex's commit/PR/merge review. Keep the draft private and unchanged; source fixes do not update already-built assets. Physical Mac, installed Windows, live Gemini, and exact future-candidate smoke tests remain unverified. M2 schema/UI and new saved-guide-to-test work follow their existing scope/check-in gates.

### Mac test-kit review corrections (29 September 2026)

Following Codex's independent reviews of the test-kit slice (`MAC_TEST_KIT_REVIEW_2026-09-29.md` and `MAC_TEST_KIT_SECOND_REVIEW_2026-09-29.md`), test-kit and verification gaps were resolved locally:
1. **Archive inspection parser hardening (R1):** `scripts/inspect-backup-credentials.mjs` strictly verifies complete central-directory byte consumption (`pos === cdOffset + cdSize`), local file header name and signature consistency, EOCD bounds and comment length, and rejects underreported entry counts, zero counts, multi-disk archives, and ZIP64 with status 2 (`INSPECTION ERROR`), preventing false PASS results.
2. **Documented shell check fail-closed contract & observable cleanup (R2 / V2):** `docs/MAC_PARITY_CHECKLIST.md` step 4 checks `$GREP_STATUS` distinguishing match (0 -> FAIL 1), no-match (1 -> PASS 0), and search error/missing command (anything else -> INSPECTION ERROR 2), with trap cleanup of `$TMP_LIST` on all exit paths. In `src/logic/releaseSafety.test.ts`, an availability seam (`findBashExecutable`) replaces silent returns with an explicit test skip (`ctx.skip()`) when Bash is absent, and tests observe cleanup across normal success, credential failure, unzip failure, and grep failure.
3. **Decoded page ID coverage, actual-source metrics, and generator deduplication (R3 / V1):** Added helpers in `src-tauri/src/pdf.rs` decoding each page's content stream via `lopdf` to assert full ordered `P0001`-style ID sequences (`1..=1000` + `1001..=1050` for long manual; `1..=58` + `59..=60` for byte-heavy charts; exact 101–300 and 10–20 for manual ranges), distinguishing verified content coverage from bare page counts. Added a negative regression proving the oracle rejects wrong, duplicate, and reordered page IDs. Removed the inline duplicate generator from `docs/MAC_PARITY_CHECKLIST.md` in favor of `node scripts/generate-pdf-fixtures.mjs`, and updated checklist split tables with actual-source Rust extraction measurements. Visual pixel rendering remains pending physical Mac checks; all physical Mac runtime items remain UNVERIFIED. Candidate v0.5.3 DMG remains a frozen historical evaluation artifact; release approval remains held pending separate product repairs.

Codex's [final independent test-kit review](docs/MAC_TEST_KIT_FINAL_REVIEW_2026-09-29.md) approves this tools/tests/documentation slice for PR review. Fresh final local verification passed: **594 frontend tests** (4 skipped), **161 Rust tests** (6 ignored), the explicit byte-heavy page-content test, dependency installation, production build/typecheck, strict Rust lint/formatting, and lock/version checks. The separate product and physical-Mac release gates remain open; no candidate/version change is authorized by these results.

### Second restore-retention review — 30 September 2026

**A1 remains OPEN; commit and merge are blocked.** [The second independent review](docs/RESTORE_RETENTION_SECOND_REVIEW_2026-09-30.md) independently passes all seven regressions from the first review but reproduces five additional failures: a valid legacy backup's WAL is attached to the returned original DB after document-install failure; unidentified active database bytes are deleted without ownership proof; recovery moves a Windows document junction into active storage; failed old-journal deletion allows a newly accepted restore to be silently discarded; and a dangling journal junction is treated as no journal. Native test evidence and exact source references are recorded in the note. Application source was restored byte-for-byte after temporary tests. No commit, push, CI or release action was made; Mac and installed-app checks remain UNVERIFIED.

### Proposed restore-retention corrections — implementer handoff, 30 September 2026

The implementer reports the following corrections to [the first review](docs/RESTORE_RETENTION_REVIEW_2026-09-30.md). The seven original regressions now pass independently, but **the broader safety claims below were not accepted**; the second review identified remaining identity, sidecar, cleanup and path-inspection defects.

1. **Unrecorded WAL/SHM protection (R1):** Pre-records protection intent before moving files. `execute_rollback` inspects the rollback folder for all `DB_FILES` (not just recorded files) and returns them to root. Rollback strictly verifies that no unaccounted or leftover files remain before completing.
2. **Stale rollback journal deleting returned original (R2):** `execute_rollback` uninstalls active files only if the original file still exists in rollback. If absent from rollback, it is the returned original and is never deleted.
3. **Atomic journal replacement & fail-closed startup (R3):** Journal replacement flushes to a temporary file (`restore-journal.json.tmp`) and renames over `restore-journal.json` without unlinking first, preserving the prior valid journal on write/sync failure. `handle_startup_restore_in` fails closed on directories, non-regular files, or corrupted journals. If the canonical journal is missing but recovery evidence (`.recovery-pending`, `.tmp` journals, or `before-restore` safety copies without an active DB) exists, startup halts with `BlockedUnresolved`.
4. **Persistent terminal decisions across cleanup failure (R4):** Added `RestorePhase::RolledBack`. Both `Committed` and `RolledBack` are durably recorded before attempting staging cleanup. Cleanup failure leaves the terminal journal intact; subsequent launches retry cleanup without replaying or re-rolling back.
5. **Strict path constraint & identity (R5):** Path validation enforces `backups/<child>` only, rejecting traversal, drive letters, reparse points, symlinks, and the `backups` directory itself. Operation ID matching between staging plan and journal prevents cross-request interference.
6. **Repaired test oracles & permanent reviewer regressions (R6):**
   - Ported all 7 independent reproduction test scenarios into permanent repository tests:
     - `reviewer_unrecorded_wal_move_preserves_committed_rows` (verifies committed rows only in WAL survive move/exit)
     - `reviewer_stale_rollback_journal_cannot_delete_returned_original` (verifies returned original DB is not deleted on restart)
     - `reviewer_missing_journal_with_recovery_marker_blocks_startup` (verifies fail-closed on missing journal with marker)
     - `reviewer_non_regular_journal_is_not_equivalent_to_absent` (verifies non-regular journal blocks launch)
     - `reviewer_committed_cleanup_failure_must_not_replay` (verifies cleanup failure preserves committed state across launches)
     - `reviewer_backups_parent_is_not_a_valid_recovery_folder` (verifies `backups` folder cannot be wiped as a recovery folder)
     - `reviewer_recovered_restore_cleanup_failure_must_not_replay` (verifies rollback survives cleanup failure without replay)
   - Fixed ineffective test oracle: `audit_failed_rollback_must_retain_original_database` verifies exact byte hashes of retained database and documents before cleanup (no bogus fallback).
   - Real uncheckpointed WAL snapshots: `audit_document_return_obstruction_retains_document_and_db_wal` uses an active WAL snapshot with `wal_autocheckpoint = 0` and verifies exact original WAL hashes.
   - Removed obstruction recovery: `audit_recovery_completes_after_obstruction_removed` verifies that once an obstruction is removed, relaunching automatically completes rollback to `RolledBack` without resurrecting terminal restores.

**Prior handoff count note:** The previous handoff reported 180 passed, 0 failed, 6 ignored (186 total tests).

### Second review follow-up: S1–S5 protocol implementation (30 September 2026)

Following Codex's second independent review (`docs/RESTORE_RETENTION_SECOND_REVIEW_2026-09-30.md`), the five remaining defect classes (S1–S5) and missing transition matrix coverage have been implemented and verified locally:

1. **S1 — Verified dataset identity & WAL/SHM separation:** `RestoreJournal` records `original_db_artifacts` and `staged_db_artifacts` (with exact SHA-256 digests and byte sizes) before moving files. When rollback executes, an active WAL is only preserved if its hash matches an original WAL recorded before restore; a staged WAL absent from the original is deleted/uninstalled. Stale SHM files in active storage are unlinked prior to returning DB/WAL so SQLite safely regenerates shared memory on first open without data mixing. Covered by `round2_legacy_restore_wal_is_not_mixed_with_returned_original`.
2. **S2 — Unidentified regular destination preservation:** Active DB and document destinations are only uninstalled if their cryptographic identity matches known staged artifacts. If an active file matches neither staged nor original data, it is preserved, rollback halts with an actionable error, records `UnresolvedRecovery`, and startup blocks with `BlockedUnresolved`. Covered by `round2_unidentified_regular_destination_is_not_deleted` and `unidentified_document_and_sidecar_are_not_deleted`.
3. **S3 — Linked original artifact rejection:** `RestoreJournal::validate` and `inventory_directory_artifacts` recursively inspect rollback and active directories using `is_symlink_or_reparse` (checking `FILE_ATTRIBUTE_REPARSE_POINT` on Windows alongside `is_symlink()`). Any linked recovery files, junctions, or unexpected file types are rejected fail-closed before any files or directories enter active storage. Covered by `round2_linked_recovery_documents_do_not_enter_active_storage` and `round2_linked_recovery_database_directory_does_not_enter_active_storage`.
4. **S4 — Terminal journal removal & operation ownership:** `fresh_staging` fallibly validates and removes existing terminal journals before clearing staging/pending. If removing an old journal fails (e.g. held lock), staging is refused with `Err`. On startup, `handle_startup_restore_in` enforces operation ownership: `pending` is cleaned only if its `operation_id` matches the terminal journal, preventing an old record from silently discarding a newly accepted restore. Covered by `round2_failed_terminal_journal_removal_cannot_discard_new_restore`.
5. **S5 — Dangling metadata fail-closed inspection:** `handle_startup_restore_in` and `read_journal` inspect metadata via `std::fs::symlink_metadata` rather than `exists()`. Only genuine `NotFound` is treated as absent; dangling junctions, broken symlinks, non-regular files, and unreadable state halt startup with `BlockedUnresolved`. Covered by `round2_dangling_journal_is_not_treated_as_absent`.
6. **Failure transition matrix:** Verified conservation and idempotency across interrupted rollback return (`matrix_interrupted_original_return_preserves_already_returned_files`), altered/mismatched rollback files (`matrix_missing_original_artifact_blocks_recovery_even_if_same_named_file_exists`), and corrupted/unrecognized journal phases (`matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively`).

**Verification status:**
- Full Rust test suite: **190 passed, 0 failed, 6 ignored** (72 in `backup::tests::`, including all 7 round 1 reviewer tests and all 6 round 2 reviewer tests).
- All changes remain uncommitted and unpushed for independent review.
- **A1 is marked pending independent acceptance; it is NOT declared release-ready.** Findings A2–A6 remain open.
- The Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, installed Windows, and live Gemini testing remain UNVERIFIED.


### Third review follow-up: T1–T5 protocol implementation (30 September 2026)

The implementer reports the following corrections after the third review. Codex independently passes the five round-three cases and all 107 existing backup tests, but the fourth review finds F1–F4 and incomplete failure coverage. This proposal is not independent acceptance:

1. **T1 — Original document identity and completeness:** `RestoreJournal` records `original_document_artifacts` and `staged_document_artifacts` before file moves. Recovery rollback strictly verifies complete relative path names, byte sizes, and SHA-256 digests against recorded manifests using fallible no-follow reads. Mismatched hashes, altered bytes, missing files, or unexpected files halt recovery and mark `UnresolvedRecovery`, preserving original files without loss. Covered by `round3_changed_original_document_cannot_be_reported_recovered`, `round3_missing_original_document_cannot_be_reported_recovered`, `task1_missing_single_document_in_populated_dir_blocks`, `task1_changed_same_size_document_bytes_blocks`, `task1_missing_entire_document_directory_blocks`, `task1_nested_document_paths_verified`, `task1_interrupted_return_after_directory_rename_resumes_cleanly`, and `task1_repeated_startup_after_clearing_obstruction_succeeds`.
2. **T2 — Original document absence without dataset mixing:** Distinctly represents original document absence, empty directory, and populated directory states. When rolling back an operation where the original profile had no documents, only positively identified selected staged documents are uninstalled, preserving unrelated user files and returning to original absence without leaving selected documents behind. Covered by `round3_original_document_absence_must_not_leave_selected_documents`, `task2_original_document_absence_uninstalls_selected_documents`, `task2_original_empty_document_dir_restored`, `task2_original_populated_document_dir_restored`, `task2_unrelated_active_document_preserved_and_blocks`, and `task2_overlapping_document_content_survives`.
3. **T3 — Fallible no-follow inspection across active/recovery roots:** `inventory_directory_artifacts` and directory helpers inspect the root directory itself before enumeration using `std::fs::symlink_metadata` and `is_symlink_or_reparse`. Junctions, reparse points, symlinks, and non-regular files in active, staged, or recovery roots/children are rejected fail-closed. Validates all inventory artifact paths against path traversal, absolute/drive/UNC paths, Windows streams, and duplicate entries. Safe active `.db-shm` unlinking occurs before returning DB/WAL. Covered by `round3_active_document_junction_cannot_be_accepted_as_returned_original`, `task3_linked_inventory_root_rejected`, `task3_linked_nested_child_rejected`, `task3_active_db_link_rejected`, and `task3_journal_invalid_inventory_names_rejected`.
4. **T4 — Strict pending deletion ownership:** Separated application kind reading (`read_restore_plan`) from deletion authorization (`read_restore_plan_for_ownership`). Unreadable, corrupted, symlinked, or mismatched plans strictly do not authorize removal of pending data; ambiguous staging is preserved and startup halts with `BlockedUnresolved`. For modern state, proven matching nonempty operation IDs are required before removing pending directories. Genuinely legacy state (empty operation IDs without plan) and unversioned leftovers from committed/rolled-back operations are cleaned up cleanly. Covered by `round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup`, `task4_terminal_cleanup_matching_id_committed`, `task4_terminal_cleanup_matching_id_rolled_back`, `task4_terminal_cleanup_mismatched_id_refuses_deletion`, `task4_terminal_cleanup_corrupted_plan_refuses_deletion`, `task4_terminal_cleanup_empty_id_refuses_deletion`, and `task4_terminal_cleanup_genuine_legacy_state`.
5. **T5 — Deterministic filesystem failure matrix:** Added a private, scoped thread-local fault-injection boundary (`InjectedFault`, `ScopedFault`, `check_injected_fault`) active under test configurations. Verified fault occurrence and dataset conservation across journal temporary file creation, writing, syncing (`sync_all` plus Unix directory entry sync), atomic rename, and journal deletion faults, as well as protect move, install move, return move, and unreadable journal faults. Covered by `task5_matrix_journal_temp_create_fault`, `task5_matrix_journal_write_fault`, `task5_matrix_journal_sync_fault`, `task5_matrix_journal_rename_fault`, `task5_matrix_journal_delete_fault`, `task5_matrix_unreadable_journal_file_blocks_startup`, `task5_matrix_protect_move_fault_conserves_original_data`, `task5_matrix_install_move_fault_triggers_clean_rollback`, and `task5_matrix_return_move_fault_conserves_all_files`.

**Verification status:**
- Full `backup::tests::` suite: **107 passed, 0 failed, 0 ignored** (including all 5 round 3 reviewer regressions, 7 round 1 reviewer tests, and 6 round 2 reviewer tests).
- All changes remain uncommitted and unpushed for independent review.
- **A1 is marked pending independent acceptance; it is NOT declared release-ready.** Findings A2–A6 remain open.
- The Windows distribution hold on v0.5.1 and Mac candidate hold on v0.5.3 remain in effect. Physical Apple Silicon Mac, installed Windows, and live Gemini testing remain UNVERIFIED.

## Existing candidate record

The five candidate version records are synchronized to `0.5.3`. A private, unpublished Mac-only GitHub Release draft exists from workflow run `36515016063` (target commit `41464607ff85d0a4cf0b837c19b400d8392dfec4`).

**Release candidate draft & tag status:**
- **Tag status:** The private draft carries the tag name `v0.5.3` and targets fixed commit `4146460`, but `refs/tags/v0.5.3` does not currently exist in the Git repository. Under GitHub's release model, the Git tag ref is created only upon draft publication. No Git tag was pushed or created prematurely.
- **Initial checksum mismatch:** The draft contains the compiled Apple Silicon DMG (`Her.Flight.Deck_0.5.3_aarch64.dmg`, 4,511,142 bytes, SHA-256 `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`). Tauri initially produced a filename with spaces; GitHub normalized those spaces to dots on upload, leaving the original manifest and notes with the wrong filename. That manifest and note line have since been corrected.
- **Workflow fix:** Added `scripts/normalize-installer-filenames.mjs` and updated `.github/workflows/release.yml` to normalize installer filenames on disk to stable downloadable names prior to checksum generation and upload, and embedded `installers/SHA256SUMS.txt` directly into release notes.
- **Draft correction verified:** After PR #39 passed CI and merged, Codex replaced only the private draft's `SHA256SUMS.txt` and corrected the release-note checksum line to reference `Her.Flight.Deck_0.5.3_aarch64.dmg`. The original DMG asset ID, size, SHA-256, and target commit remain unchanged; the draft remains unpublished.
- **Physical Mac gate:** The draft remains strictly **unpublished**. A CI build is packaging evidence only; publication is blocked until physical Apple Silicon smoke testing is complete per `docs/MAC_PARITY_CHECKLIST.md`.
- **No-retag rule:** Under no circumstances will tag `v0.5.3` be repointed or reused. If physical device testing fails on this draft, the draft will be discarded, version `0.5.3` permanently retired in `scripts/release-policy.json`, and the source bumped to `0.5.4`.

## M2 Study Library design (planning only)

[M2_STUDY_LIBRARY_DESIGN_2026-09-27.md](docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md) maps current generated-content storage to staged content versions, resumable practice attempts, card reviews and bounded history. No M2 schema or app change has started. The roadmap's check-in with the real user after M1 remains the gate before migration 11; her use of the Daily Flight Plan and quick debrief should set M2 scope. The Windows release hold and Mac installed-app checks are unchanged.

## Performance and usability polish (27 September 2026)

Measured on the same branch as D6/D7 before the final Codex review, with synthetic data in three realistic tiers:
- **Questions** now opens quickly with a long history. It mounts 100 rows at a time with "Show more", and filters still cover every question.
  - Large tier (800 questions): 531 → 63 ms in the jsdom benchmark.
  - Chromium browser-mode check: 595 → 62 ms, with the DOM reduced from about 15,000 to about 2,000 nodes.
- **Complete-backup restore:** staging now hashes each file while writing it, instead of reopening it afterwards. The same size and SHA-256 checks and `sync_all` apply. Restoring 5,000 records and 300 files went from 6,856 ms to 1,142 ms (release build, this Windows machine).
- **Compact windows (≤ 900 px):** no longer scroll sideways. A screen-reader-only nav label had widened the page from 470 to 824 px.
- **Review corrections to the Questions paging and answer-save race:**
  - Unsaved answers are kept by question id, so a new question, a filter change or paging no longer loses what she typed. Nothing is autosaved.
  - Every real filter change resets to 100 rows; switching Everything → Answered → Everything had returned 200.
  - Answer-save race resolved with per-question save ownership: drafts carry a monotonic revision counter so completing an in-flight save clears only the revision it submitted; newer edits or newly opened editing sessions survive.
  - Synchronous in-flight guard (`savingQuestionIdsRef`) blocks duplicate submissions from rapid clicks within a single React render batch; conflicting controls disable during save (Save shows "Saving…", Cancel, TextArea, status Select, and Delete).
  - Pending ownership is tracked at page level (`savingQuestionIds`), surviving filter changes and pagination unmount/remount cycles.
  - Cancel is disabled during an in-flight save, honestly reflecting that an in-flight database write cannot be aborted mid-flight. Failed saves preserve the draft for retry and release the guard.
  - All 14 tests in `Questions.drafts.test.ts` pass, including controlled-promise batch regression tests. Full suite: 59 files passed, 3 skipped; 550 passed, 3 skipped. Build entry is unchanged at 381.14 kB (118.56 kB gzip).
  - Rendering stays bounded (1,930 nodes). The large-tier benchmark reads 77 ms against 63 ms before; that is one ~15 ms polling step of the method, and still about 7× faster than the original 531 ms.
- **Mac tracker:** [the Mac parity tracker](docs/MAC_PARITY_CHECKLIST.md) now lists these changes against MAC-08, MAC-17, MAC-20, MAC-21, MAC-22 (Questions delayed-save smoke test) and PERF-MAC-01…05. All Mac behaviour and Mac speedups remain UNVERIFIED.

Measured and left alone (no verified bottleneck): PDF splitting, Gemini local preparation, Study Library search and sort, Flight Deck.

The D7 source check (`listed_modules_do_not_reference_reqwest_directly_outside_gemini`) now normalizes CRLF correctly, with LF/CRLF fixture tests. That is a separate correction, not performance work.

Not measured: PDF import timing, first navigation with lazy route loading, packaged-app startup, WebView paint, native memory and Gemini network/model latency. Windows installed-app and Apple Silicon checks are unverified. No migration, version or release change. See [the performance note](docs/PERFORMANCE_POLISH_2026-09-27.md).

## M1 D7 — Acceptance of the Daily Flight Plan and debrief workflow (27 September 2026)

D6, D7 acceptance, and the performance polish merged through PR #35 (`1d86d57`). The automated checks passed on exact PR head `a2b8a92`. This is not installed-app or release evidence.

D7 adds acceptance evidence and changes no product code or migration:
- **Whole workflow (UI integration, synthetic data):**
  - plan budget, Why this, Skip and Start;
  - quick debrief with an action linked to a material and an edited question carried to a lesson;
  - the action on the material page and the question in lesson preparation;
  - the flight log intact in the full editor;
  - action completed and question answered through the UI;
  - the original operation retried with nothing undone;
  - restart by reopening the database file;
  - linked sources deleted, with honest "unavailable" labels;
  - cancel and failed-save behaviour.
- **Upgrade:** a realistic v9 dataset upgraded to migration 10, with nothing lost, nothing invented, migrations run once, and fresh install still working. Tested in TypeScript and against the registered Rust migration list.
- **Complete backup:** the real native pipeline, including a managed PDF, the daily plan, progress, provenance and the ledger; retrying after restore changes nothing.
- **Offline evidence (frontend only):** the tested workflow made zero `fetch` or `XMLHttpRequest` calls.
- **Native offline behaviour: UNVERIFIED.** It has not been exercised with networking disabled or blocked. The structural test `listed_modules_do_not_reference_reqwest_directly_outside_gemini` only confirms that the production code of the listed Rust modules doesn't reference `reqwest` directly (and `gemini.rs` does). It can't show that those paths never use the network another way.

No product defects were found.

**Independent review (Codex), separate from the implementation results:**
- `npx vitest run src/acceptance/`: 2 files, 4 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml debrief`: 15 passed.
- `git diff --check`: clean.
- Local NSIS artifact SHA-256 matches the documented checksum. This is not malware clearance or installation evidence, and that retired-`0.5.2` artifact must not be distributed.

No product-code blocker was found. See [the D7 acceptance note](docs/M1_D7_ACCEPTANCE_2026-09-27.md).

**Not verified:**
- **Windows desktop smoke:** the app was not launched, because this machine holds a real Her Flight Deck profile and no isolated profile could be verified.
- **Apple Silicon installed app:** no Mac available.
- **Live offline run of the desktop app:** not performed.

The Windows release hold and the retired `0.5.2` policy are unchanged.

## M1 D6 — Connect improvement → action → study material → instructor question (26–27 September 2026)

The debrief form can turn "What was difficult?" or "Instructor feedback" into an action she edits and accepts. It can link that action to a Study Library material. It can also save the debrief question with a material and carry it to an upcoming lesson, where it appears in lesson preparation. Nothing is accepted without her ticking the box.

After the first independent review:
- **One save contract.** The form, TypeScript, the Tauri adapter, Rust (which rejects unknown fields) and the browser transaction all use the same shape. Fixtures captured from the real form are replayed by both implementations, and both must produce the same rows.
- **Retries are safe.** A retry of an operation that already committed changes nothing, so it can't undo a completed action or an answered question. A deliberate edit writes only the action title and material, and the question text and links.
- **Deletion is honest.** Deleting a material, lesson or debrief keeps the action and question, and remembers the deleted source (migration 0010, unshipped), so the UI can say "Source … unavailable" instead of acting as if it was never linked.
- **Evidence.** The real complete-backup round trip is tested in Rust. A driver without atomic support can no longer report a successful save.

Implementation checks (Windows x64, not independent review):
- `npm test`: 528 passed, 2 skipped;
- `npm run build`: clean;
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: clean;
- `cargo test`: 153 passed, 2 ignored.

Status: Merged through PR #35 (`1d86d57`) alongside D7 acceptance and performance polish. No installed-app verification has been performed on Windows or a Mac. See [the D6 note](docs/M1_D6_DEBRIEF_LINKS_2026-09-26.md).

## M1 D5 — Quick debrief mode in existing journal flow (26 September 2026)

Added a clearly labeled **Quick debrief** mode to the existing Flight Journal flow:
- **Fast reflection entry:** Quick mode exposes only the essential post-flight reflection fields: date, scheduled lesson link, title, "What went well?", "What was difficult?", instructor feedback, confidence rating (1–5), and "Questions for next time". Flight-time categories, aircraft details, routes, and landings remain hidden so she can record impressions immediately after landing while fresh.
- **Entry points:** Available from the Flight Journal header ("Quick debrief"), the "Lessons without a debrief" awaiting list ("Quick debrief"), the Schedule event detail view ("Quick debrief"), and the Journal Entry detail view ("Quick debrief").
- **Seamless round trip:** A toggle chip ("Quick debrief" vs. "Full flight log & debrief") at the top of the form switches modes in place without losing any typed reflections or inputs. Entries saved in quick mode can be reopened in the full log editor at any time to add flight times and aircraft details.
- **Strict preservation of hidden fields & intentional mode switch edits:** When saving edits in quick debrief mode on an existing entry, fields unexposed by quick mode are preserved from the existing record. If the pilot switches to full mode during the editing session to intentionally update, change, or clear any numeric, text, or relationship fields (e.g. updating `totalTime` to 2.5, changing `aircraftId`, clearing `mission`, or clearing `goalId`), and then switches back to quick mode, those intentional edits survive and are saved to SQLite. Untouched hidden fields remain strictly preserved from existing records.
- **Explicit acceptance & ownership of derived records:** Both `addToPlan` and `saveQuestion` start unchecked (`false`). Reflection text alone never creates a separate instructor question or action. When opted in, the review card displays the exact editable text that will be saved; clearing the review field creates nothing (no invisible fallback to reflection text). Recovered drafts from interrupted sessions never silently accept derived records.
- **Explicit ownership over broad linked-record reconciliation:** The form strictly updates or deletes only records demonstrably created by this specific draft attempt (`draft.createdActionId` and `draft.createdQuestionId`). A shared journal ID or absence from a mount-time snapshot is not proof of ownership. Independently created actions and questions linked to the same journal are never overwritten or deleted by ordinary reflection edits. When approval is explicitly withdrawn by unchecking or clearing, only the owned record is removed; if ownership cannot be established, the record is preserved rather than guessed.
- **Complete user-authored next-step text recovery:** User-entered next-action titles, separately edited question review text, and question edit status (`questionEdited`) are saved and recovered alongside the journal draft. Intentional blank edits are preserved across unmount/reopen cycles without snapping back to reflection text. Legacy drafts without next-step fields remain fully compatible, and "Start fresh" consistently clears all recovery state.
- **Durable pre-write save identity & idempotency:** Pre-assigns stable IDs (`targetId`, `targetActionId`, `targetQuestionId`) and persists them to draft storage (`writeDraft`) *before* executing database mutations. Interruption at any commit boundary (after journal, after action, or after question write) recovers identical IDs, turning retries into idempotent updates without duplicate records. If draft storage write fails, saving halts immediately before touching the database.
- **Save-time control disabling & edit preservation:** Accessible disabled controls (`disabled={isSaving}` and `<fieldset disabled={isSaving} aria-busy={isSaving}>`) prevent mid-save editing. Error catch blocks no longer overwrite active user state with stale closure snapshots. If deferred writes succeed while newer edits are pending, unsaved edits are preserved without discarding or prematurely navigating away.
- **Duplicate submission prevention & safe retry:** Buttons and controls disable during save, showing "Saving…" and ignoring rapid clicks. Save errors preserve entered draft text and display an error alert.
- **Persistence & cancellation:** Cancellation leaves SQLite completely unmodified (0 writes). Data persists across database close and restart with complete foreign key and relational integrity. No database migrations required (uses existing schema).

Status: Merged through PR #34 (`0ad0a578eca73e43dc48438bd4ed3278053433bc`). All 52 test files passed (508 tests passed, 2 benchmarks skipped), including 21 focused integration and regression tests in `src/pages/FlightJournal/quickDebrief.test.ts`. `npm run build` completed with 0 errors. Physical installed-app verification on Mac hardware has not been performed. See [the D5 implementation note](docs/M1_D5_QUICK_DEBRIEF_2026-09-26.md).

## M1 D3–D4 — Daily Flight Plan and saved daily decisions (26 September 2026)

Flight Deck now opens with a **Daily Flight Plan** card. She can:
- choose a 10-, 20- or 30-minute (or untimed) plan;
- read why each suggestion is there;
- press **Start**, **Skip today** or **Move to tomorrow** on each item.

Unfinished work stays under "Remaining unfinished work".

How it behaves:
- **Stable sessions.** The day's session keeps its saved order. New or higher-priority work waits until **Refresh**, a budget change or the next local day. A completed, deleted, skipped or deferred item's slot is the only one refilled.
- **Skip and defer are planner-only** and never change a due date. Both expire at local midnight, which the card notices while open and after sleep or backgrounding.
- **Saving.** Decisions are stored in the existing `app_metadata` table (no migration). Each change is computed from the stored plan inside the serialized write queue, so quick clicks can't overwrite each other, and a failed save leaves the previous plan untouched.
- **Start safety.** Start never lands on a deleted record, and it focuses a Flight Deck action's own control.

Status: Merged through PR #33 (`4e2651c`). All 62 focused tests independently rerun and verified. D1–D2 merged through PR #32 at `e938f84`. Installed-app behaviour has not been verified on Windows or a Mac. See [the D3–D4 behaviour and evidence note](docs/M1_D3_D4_DAILY_PLAN_2026-09-26.md).

## M1 D1–D2 — Daily Flight Plan recommendations and debrief characterization (25 September 2026)

Debrief persistence across normal user edits, SQLite disk reloads, and parent deletion has been characterized against real SQLite persistence in `src/logic/debriefCharacterization.test.ts` (D1). When a debrief journal entry is deleted, SQLite's foreign key `ON DELETE SET NULL` clears `question.journal_id`, whereas `next_actions.related_id` survives as a dangling reference without foreign key cascade. Debrief-created questions omit `eventId` (`null`), so `lessonPreparation` excludes them from upcoming lesson prep lines until explicitly linked (identified for future D6 work). Debrief actions lack direct associations with Study Library materials (future D6).

The pure recommendation selector has been implemented in `src/logic/recommendations.ts` with tests in `src/logic/recommendations.test.ts` (D2). It enforces strict deterministic priority tiers: 1. User-pinned work -> 2. Due actions (overdue oldest first, then due today) -> 3. Next-lesson prep -> 4. Study -> 5. Open actions. Tie-breaking is deterministic down to title and unique ID. When a time budget (10, 20, 30 min) is requested, tasks with unknown durations are kept visibly unknown without fabricated durations or zero-minute representation and remain reachable in priority order without falsely claiming the entire session fits the budget. When any suggested item has an unknown duration, timed items disclose known allocations explicitly as estimates without claiming guaranteed session fits or remaining time. Deleted/archived debrief parents fall back safely to unlinked action/question explanations to prevent dangling links. The selector is 100% pure (zero database writes, zero silent action acceptance, zero skill proficiency mutations, zero clock dependency).

Status: Merged through PR #32 at `e938f84`. D3–D4 are described above. See [the D1–D2 implementation and validation note](docs/M1_D1_D2_RECOMMENDATIONS_2026-09-25.md).

## M1 D0 — Study Library file check (25 September 2026)

Merged through PR #31 at `193d3e1`. Settings now has a **Check library** action that compares Study Library file references with files in app-owned storage. It lists missing files for re-attachment and unlinked files for import as new materials or an explicit move to private trash. Re-attachment retains the existing material and its notes, guide, flashcards, and practice history. Native repair commands recheck the file and database state inside bounded SQLite transactions and refuse to move referenced files to trash. The scan fails visibly on unreadable database or trash metadata rather than presenting an incomplete report as healthy. The scan and repair commands run off the UI thread, and the Settings list renders 50 results at a time.

The private-trash Undo action lasts until app restart. Startup cleanup purges unreferenced staged files by existing design; this is a reversible short undo, not a permanent recycle bin. The UI says so. A complete backup excludes unlinked files, so any needed file should be imported or re-attached before relying on a new backup. See [the implementation and validation note](docs/M1_D0_LIBRARY_CHECK_2026-09-25.md). Installed-app behavior on Apple Silicon remains unverified, and the release hold is unchanged.

## Release status

Version `0.5.2` was prepared on 14 September 2026 and withdrawn the same day following an unresolved Windows Defender detection (`Trojan:Win32/Wacatac.B!ml`). Per repository release policy (`scripts/release-policy.json`) and automated validation checks, version `0.5.2` is **permanently retired and must never be reused, re-tagged, or published**. The latest distributable Windows release remains `v0.5.1` (held pending separate Microsoft Defender review). Under the revised release policy, the unresolved Windows Defender review blocks **Windows distribution only**; an independent **Mac-only release pathway** is active for candidate `v0.5.3`. A Mac candidate may be released once its independent Apple Silicon hardware smoke test and draft verification pass per [the release review process](docs/RELEASE_REVIEW_PROCESS.md), without waiting for Microsoft Defender resolution. Windows distribution remains held on `v0.5.1` until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved. Paid code signing is the long-term path, but is not mandatory if Microsoft clears the exact binary.

## Release-safety hardening update (24 September 2026)

Following release-safety corrections for data protection, deletion recovery, and workflow efficiency:

- **Complete backup consistency across SQLite and managed documents:**
  - Format-v3 backup export handles pre-existing database and document inconsistencies cleanly: referenced documents missing from disk are allowed and recorded in `manifest.missing_at_export` (reported in `missing_documents`); unreferenced orphan files on disk are excluded from the archive (preventing backup drift) and reported in `unreferenced_documents`. In the UI, Settings displays a plain-language summary naming any omitted missing files (by material title or file name) and advising she can re-attach them in the Study Library, notes any unreferenced files excluded, and both Settings and DataRecovery restore preview dialogs call out any files that were already missing when the backup was made.
  - If recording the backup reminder in app settings fails after an archive is finalized and verified, Settings retains and displays the full missing-document and unreferenced-file warnings alongside the reminder update notice.
  - Preserves restore compatibility with existing format-v2 archives: older v2 exports that included unreferenced documents or omitted files already missing from storage continue to inspect and restore with those differences disclosed. SHA-256 integrity for archived files, path safety, and size limits remain enforced; strict two-way document completeness applies to format v3.
  - Differentiates pre-existing missing files from mid-export deletions by scanning documents before and after taking the database snapshot: a referenced file is treated as pre-existing missing only if absent from both scans; a referenced file present before the snapshot and gone after, or currently staged in `documents/.trash`, triggers a transient retry. Mid-export document mutations or unexpected file appearances are likewise refused with bounded retry (`COMPLETE_BACKUP_RETRIES = 3`, 200 ms interval) executing safely off the UI thread via `spawn_blocking`.
  - Atomic `.part` file finalization protects existing valid backups, ensuring the original is restored untouched if an export fails.
  - Deterministic Rust regression tests verify in-flight disappearing documents (pre-collection and mid-collection), staged deletions in progress, corrupt staged metadata, in-flight appearing files, in-flight mutation, bounded retry exhaustion, format-v3 completeness enforcement, old-style v2 restore, missing-document export/restore, and orphan exclusion.
- **Recoverable Study Library deletion:**
  - Two-phase staged deletion: managed files are moved to private trash (`documents/.trash`) before SQLite database records are deleted.
  - Traversal defense: `validate_staged_id` rejects path separators, `..`, colons, and NUL bytes on commit/rollback; metadata `original_relative_path` is validated against directory traversal before restoration.
  - Safe against destination path collisions: explicit rollback (`rollback_delete_document_in`) and startup recovery (`cleanup_staged_deletions_in`) use an atomic no-replace operation (`renamex_np` with `RENAME_EXCL` on macOS; `renameat2` with `RENAME_NOREPLACE` on Linux; `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows) to eliminate TOCTOU overwrite windows. If the destination path already exists, neither replaces the existing file, both the destination and staged copy in `.trash` (including `.meta`) are preserved intact and recoverable, and the conflict is reported.
  - Schema safety on startup: `cleanup_staged_deletions` refuses to purge staged files if the database is readable but the expected `study_materials` table or `file_path` column is missing or invalid, keeping staged copies safe until a valid schema is present.
  - Frontend lifecycle extracted to `removeMaterialWithFile`: staging failure leaves the database record untouched with an actionable retry message; database deletion failure rolls back the staged file; successful database deletion commits/purges trash; materials without files or with already-missing files proceed safely. Undo cancels the pending delete, and only the commit path calls `removeMaterialWithFile`.
  - Deleting a material whose file is locked (e.g. open in a PDF viewer on Windows) fails safely by design: staging fails, the record and file are kept, and she is prompted to close the file and try again.
  - Startup recovery hook `cleanup_staged_deletions` reconciles `.trash` with the active database, restoring documents if the database record still exists (crash before DB update) or purging staged files if the record is gone (crash after DB update). If restore rename fails or the database is missing, unreadable, or corrupted, it logs and safely leaves staged files untouched.
  - Preserves 7-second undo behavior without premature file deletion.
  - Added unit tests in `documents.rs` and frontend lifecycle tests in `documents.test.ts` verifying all failure and recovery branches.
- **GitHub Actions release gate & concurrency:**
  - Release workflow (`.github/workflows/release.yml`) configures `cancel-in-progress: false` grouped by workflow and version/ref so in-progress release builds and packaging jobs are never cancelled by subsequent runs.
  - Added a full Rust validation gate on Linux CI before packaging: installs required Linux desktop development libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `libxdo-dev`) and runs `cargo test` as an authoritative pre-packaging gate.
  - Streamlined `checks.yml` with a lightweight verification path for documentation-only pull requests while strictly preserving the single required check status (`Tests, types, and the data-safety guards`). The docs filter is strictly scoped to actual documentation paths (`LICENSE(\.txt)?$`, `docs/`, etc.) so arbitrary text changes (config or test fixtures) cannot skip required CI checks.
  - Eliminated redundant frontend and Rust test suite executions on macOS and Windows packaging runners in `build-desktop.yml` and `release.yml`, refocusing runner minutes on platform packaging and metadata verification (including Windows NSIS installer verification).
- **Dependency findings confirmation:**
  - Confirmed `glib 0.18.5` is absent on Windows/macOS and present solely in the Linux GTK development/CI graph.
  - Confirmed `rsa 0.9.10` (RUSTSEC-2023-0071) is absent from the resolved dependency graph for all release targets (`cargo tree --target all -i rsa` produces no paths). `.cargo/audit.toml` ignores this finding so `cargo audit` runs cleanly.
  - Confirmed `ttf-parser 0.25.1` is transitive exclusively through `lopdf`.
  - Confirmed `keyring` is restricted solely to legacy secret migration in `gemini.rs`. No speculative replacements.
- **Validation evidence:** On Windows x64: `npm test` passed 405 tests across 45 test files (2 benchmarks skipped); `npm run build` completed with 0 errors; `cargo test` passed 128 tests (2 benchmarks ignored); `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed cleanly with 0 warnings.
- **Mac-only uncertainty:** The desktop app is **not declared ready for Mac** without an installed Apple Silicon smoke test. In particular, native file dialogs, Finder reveal, local backup creation and restore, and PDF/Study Library viewer interactions require hands-on physical verification on Apple Silicon hardware.

## Pre-release audit update (24 September 2026)

A full pre-release readiness audit was completed following the Study Library file-lifecycle fixes (PR #27) and Gemini workflow hardening (PR #28). See [the comprehensive audit report](docs/PRE_RELEASE_AUDIT_2026-09-24.md) for full architectural reviews, security boundaries, and validation evidence.

- **Dependency audit status:**
  - `rustls 0.23.43` was upgraded to `0.23.45` via `cargo update -p rustls`. `cargo audit` confirms RUSTSEC-2026-0285 (TLS 1.3 handshake acceptance across encryption level boundaries) no longer appears in the advisory scan. The full test and build matrix provides evidence that no regressions were introduced.
  - Current `cargo audit` is not fully clean: it exits with one vulnerability finding for `rsa 0.9.10` (RUSTSEC-2023-0071, Marvin timing sidechannel), for which no patched stable release exists upstream.
  - Shipped-build exposure to `rsa` is absent: both `cargo tree -i rsa` and `cargo tree --target all -i rsa` print no path. The package remains in `Cargo.lock` through optional SQLx/MySQL dependency metadata, but is not present in the resolved dependency graph for the project's current SQLite-only feature set (`tauri-plugin-sql = { features = ["sqlite"] }`).
  - Informational maintenance warnings in `cargo audit` (not exploitable security vulnerabilities): `ttf-parser 0.25.1` is unmaintained and present through `lopdf` (tracked for future `lopdf` updates); `glib 0.18.5` has an unsoundness advisory in the Linux GTK dependency graph (tracked for Linux development/CI, though Linux is not a release artifact); and `proc-macro-error 1.0.4` and the `unic-* 0.9.0` crates are unmaintained transitive/build dependencies (tracked through upstream Tauri updates).
- **Workflow & Lifecycle verification:** Confirmed app-owned storage (`DOCUMENTS_DIR`), capability-scoped Open/Reveal (`opener:allow-open-path`), automatic/manual splitting limits and SQLite single-connection transactions (`save_split_materials`), v2 backup SHA-256 integrity inventory, and full component-wide Gemini lock mutual exclusion with stale result rejection.
- **Accessibility & UX:** Verified practice-test WAI-ARIA roving tabIndex radio group keyboard navigation, focus management, scoring, and retake behavior.
- **Validation evidence:** On Windows x64: `npm ci` passed (0 vulnerabilities); `npm test` passed 388 tests across 45 test files (2 benchmarks skipped); `npm run build` completed in 2.09s with 0 errors; `cargo fmt --check` passed cleanly; `cargo clippy --all-targets -- -D warnings` passed with 0 warnings; `cargo test` passed 100 tests (2 benchmarks ignored); Windows NSIS installer packaged successfully (`src-tauri/target/release/bundle/nsis/Her Flight Deck_0.5.2_x64-setup.exe`).
- **Release posture:** The Windows hold remains in effect due to the unresolved detection until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved; Mac builds require physical Apple Silicon hardware smoke testing before distribution. No release or tag was created.

## Release safety & accessibility update (23 September 2026)

Following a comprehensive release safety audit:
- **Retired version rejection:** Version `0.5.2` is registered as permanently retired in `scripts/release-policy.json`. A dependency-free validator `scripts/check-release-version.mjs` enforces this policy across `.github/workflows/release.yml` and `scripts/release.sh`. Seven automated regression tests in `src/logic/releaseSafety.test.ts` verify that `0.5.2` is rejected, malformed versions are rejected, valid non-retired versions (such as `0.5.3`) are accepted, and both entry points call the validator.
- **Security bypass instructions removed:** `README.md` and `STATUS.md` no longer instruct users to bypass macOS quarantine via `xattr -dr`, click past SmartScreen, or lower browser Safe Browsing settings. The policy mandates that flagged installers remain private drafts for vendor submission and analysis.
- **Documentation corrections:** `docs/RELEASE_PREP_0.5.2.md` and `docs/releases/v0.5.2.md` are marked as withdrawn historical records with actionable release/tag commands disabled. `docs/PROJECT_AUDIT_2026-09-14.md` accurately documents the Gemini credential lifecycle (webview input and React state, transmission via Tauri IPC, storage in restricted OS app data, and never returned to the webview).
- **Pilot Toolkit accessibility repair:** Implemented the full WAI-ARIA tabs specification in `src/pages/PilotToolkit/PilotToolkit.tsx`: stable tab/panel IDs, `role="tabpanel"`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, ArrowLeft/ArrowRight navigation with wrap-around, Home/End keys, and focus synchronization. Six unit tests in `src/pages/PilotToolkit/PilotToolkit.test.ts` verify all ARIA relationships and keyboard behaviors.
- **Validation evidence:** On Windows x64, `npm ci` passed with 0 vulnerabilities; `npm test` passed 350 tests across 42 test files (2 manual benchmarks skipped); `npm run build` passed with 0 errors; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` passed 88 Rust tests (2 intentionally ignored benchmarks).

## Windows release on hold: Defender flags the installer as Wacatac.B!ml

`v0.5.2`'s Windows installer (`Her Flight Deck_0.5.2_x64-setup.exe`,
`sha256:12f6cd530b0301e67bce952bd20fff27b1fa4fb8760cfe4579721e940e7f8a8b`) was
flagged by Windows Defender as `Trojan:Win32/Wacatac.B!ml` on download,
including a direct download from the GitHub Release — reported by hand,
without the file being run. The release and its tag were withdrawn the same
day; nothing currently published carries this build.

The installer was flagged with detection `Trojan:Win32/Wacatac.B!ml`. Under the
repository release policy, an unresolved security detection is treated as a release
blocker rather than assumed clean. The Windows installer remains unpublished until one of these closes it:

- Microsoft's file-submission review authoritatively clears the specific binary
  (https://www.microsoft.com/wdsi/filesubmission, "Software developer"
  dispute) — the usual path, typically resolved in a few days, or
- the Windows installer is code-signed, which removes the dominant trigger
  for this class of detection outright.

Paid code signing is the long-term path, but is not mandatory if Microsoft
clears the exact binary. Physical installed-application validation on both
Windows and Apple Silicon hardware remains mandatory before distribution.

Per the engineering rules, `v0.5.2`'s tag cannot be reused once it existed —
a Windows-fit release after this is cleared ships as `0.5.3` or later, built
fresh, checksummed again, and re-verified before publishing. The macOS
`.dmg` was not flagged and is not affected by this hold.

## Performance polish update

The 13 September pass bounds Study Library rendering to 100 cards at a time while still searching, filtering, and sorting the whole library. A synthetic 5,000-material server-render benchmark on Windows fell from 437 ms to 8 ms median; this does not measure a painted desktop window. The PDF splitter now batches page-reference removal; a synthetic 3,000-page window plus five candidates fell from 26.74 s to 0.085 s, with byte-equivalent output tests for simple, nested, and image-bearing PDFs. Import and backup disk work now run outside Tauri's UI thread. See [the detailed measurement and validation note](docs/PERFORMANCE_POLISH_2026-09-13.md). The installed Mac app still requires hands-on testing, and no release was published.

## App polish update

The current polish pass reduces the first-screen JavaScript bundle by loading other sections when opened, keeps Settings and Search visible in compact windows, prevents long-running PDF work from being dismissed mid-operation, and cleans up file imports abandoned before a material is saved. The manual page-range form now rejects fractional input, and a backup that was finalized successfully no longer reports itself as failed solely because the separate reminder write failed. See [the polish note](docs/APP_POLISH_2026-09-12.md) for checks and remaining device verification. No release tag was changed.

## macOS audit update

See [the 12 September audit](docs/MAC_AUDIT_2026-09-12.md) for test evidence and the required Mac installation checklist. The audit found that schema 9 (practice tests) made complete backups reject the app's own database, and that automatic split records used a transaction across pooled SQL connections. Both are fixed. Manual split records now use the same atomic write, and manual safety copies use SQLite's online snapshot. An Apple Silicon runner built and inspected the DMG, and Windows produced an installer. The Mac app is **not yet declared ready**: hands-on installation/open/Finder/backup/restore checks remain necessary.

## Current position

Her Flight Deck is a private Tauri 2 desktop application with Windows and Apple Silicon installers. Release `v0.5.1` is published. It organizes flight training plans, lessons, study material, notes, questions, flight records, finances, reminders, and career preparation in one local application. The Apple Silicon package builds, but its installed behavior has not been verified on a Mac.

Uploaded files and generated PDF parts are copied into app-owned storage. Large PDFs can be split automatically into labeled parts within Gemini's 50 MiB and 1,000-page limits, with an independent study guide for every part. Automatic splitting now windows each part before its size candidates are tried, instead of re-cloning and re-writing the whole remaining book per candidate — a synthetic 3,000-page benchmark measured roughly 4.4x less wall time for the same output (`cargo test ... -- --ignored --nocapture` on `windowing_is_substantially_faster_than_reprocessing_the_whole_book_per_candidate`), and the app now shows which part/page range is being read or written while it runs. The Study Library **Open** capability is scoped to app-owned documents, but opening a PDF from the packaged app in Preview still needs a real Mac smoke test.

Gemini can also generate an optional multiple-choice practice test from the selected study document, saved locally beside its study guide and flashcards, with malformed or out-of-range answers filtered out before they ever reach the quiz screen.

Complete `.hfdbackup` exports contain the SQLite library and managed documents. Format version 3 adds two-way reference completeness and declared missing documents on top of format version 2's SHA-256 inventory, online SQLite snapshot, staged database integrity/schema checks, and strict hostile-archive limits. Versions 1 and 2 remain supported for restore.

## Desktop release

- Latest release: `v0.5.1`
- Release commit: `2dbf6df3f66b18e087b5842fc554f8e733255a0e`
- Windows installer: published
- Apple silicon macOS DMG: published
- Installers: unsigned
- Automatic updater: not implemented

### Release safety hold

The attempted `v0.5.2` Windows installer was withdrawn after Microsoft
Defender detected it as `Trojan:Win32/Wacatac.B!ml`. It was not executed.
Microsoft Security Intelligence submission `9656710a-e9d3-4c15-83dc-9b9f3451be8b`
is pending analysis. In accordance with `scripts/release-policy.json`, version
`0.5.2` is permanently retired and will never be published or reused. A Mac-only
candidate may advance at `0.5.3` after the exact draft DMG passes physical Apple
Silicon validation. Windows distribution remains held on `v0.5.1` until the
exact future Windows installer receives authoritative Microsoft clearance or
trusted code signing and passes installed-app testing. Paid Windows signing is
the long-term path, but is not mandatory if Microsoft clears the exact binary.
By default, browser workflow runs produce private CI artifacts. Selecting
`create_draft: true` creates a private release draft targeting that commit with
checksums; review and test those exact assets using
[the release review process](docs/RELEASE_REVIEW_PROCESS.md) before publishing.

Installing a newer version over an existing installation preserves app data and creates an automatic database safety copy before migrations run. A complete backup should still be saved separately before an update or computer transfer.

## iOS project

The iOS effort is active and documented in `docs/ios/`, `docs/backup-format.md`, and `docs/BACKUP_MERGE_DESIGN.md`. Milestones 1 and 2 cover architecture, compatibility, platform boundaries, and desktop backup hardening. An iOS-readiness preparation pass established isolated `CredentialStore` trait and desktop adapter scaffolding in `platform.rs`, while active credential operations remain on desktop `secrets` and Keychain implementation is deferred until real Mac/Xcode/device validation. There is no runnable iOS app yet.

Milestone 3 requires a Mac with Xcode to initialize and validate Tauri's Apple project, implement Files/AirDrop import, Keychain, Quick Look, sharing, and the iOS restore lifecycle. Milestone 4 covers iPhone/iPad layout, device memory testing, CI, signing, TestFlight, and App Store preparation.

## Engineering rules

- Do not change `com.herflightdeck.app` without a deliberate data migration.
- Never edit a shipped migration; add the next numbered migration, register it in Rust and TypeScript, and record its checksum.
- Increase all application-version sources before publishing a new release.
- Never move an existing release tag or rebuild a published version number.
- Never embed, log, back up, or return the Gemini key to the webview.
- Keep monetary values as integer cents.
- Keep Gemini submission explicit and limited to the selected study file.
- Keep aviation safety guidance visible around generated material.
- Do not expose backup Merge until its conflict and rollback behavior is fully implemented and tested.
- Do not claim iOS, TestFlight, or App Store readiness without real Apple build and device evidence.

## Remaining hands-on checks

- Install the current desktop build over populated prior-version data.
- Import, reopen, split, back up, and restore non-sensitive test documents using native Windows and macOS dialogs.
- Verify the Study Library **Open** button and **Show in Finder or File Explorer** on a real macOS build — the capability-scope fix is covered by a test that reads `capabilities/default.json` itself, but has not run inside an actual signed or unsigned `.app`.
- Connect a real Gemini key and generate one study aid and one practice test from a public test PDF.
- Confirm unsigned first-launch instructions on both desktop platforms.
- Complete the Apple-only checklist before distributing an iOS build.
- Time automatic splitting against a real large or image-heavy handbook, not only the synthetic benchmark used during development — the windowing fix is measured, but only against a page-count-only synthetic PDF (see "Known limitation" below).

## SQLite lock reliability

Earlier work addressed SQLite contention and opener scopes. The 12 September
audit found two further data-safety gaps; see the audit note for reproduction.

- The live database was left in SQLite's default rollback-journal mode, so
  any write held a lock that blocked *every* reader too, not only other
  writers. It now runs in WAL mode (set once at startup, a property of the
  database file itself, so it applies pool-wide and to every future launch).
- The Rust side's own `rusqlite` connections — used to verify a database and
  to take a backup's online snapshot — opened with no busy timeout at all,
  unlike the app's main connection pool, which already gets one from its own
  driver by default. A lock briefly held by an ordinary write failed these
  instantly instead of just waiting the moment out. They now get an explicit
  five-second timeout, and `create_complete_backup`'s snapshot step retries
  up to three more times, with a short backoff, if it is still a lock
  (never for any other kind of failure, and never unboundedly — a
  regression test holds a lock that never clears and confirms the export
  still gives up, with a plain message, within forty seconds).

Saving a split's parts now uses a single native SQLite transaction instead of
pooled SQL statements, with bounded retries if another write holds a lock.
Manual splits use that same transaction and take an online safety snapshot.
A backup export now also reads its own
finished `.hfdbackup` back and runs it through the same validation a restore
would — readable archive, manifest, integrity inventory — before renaming it
into place or reporting success; a failure there leaves any backup already
at that destination untouched.

Settings' **Open folder** button was refused by the same capability-scope
gap the Study Library **Open** button was fixed for earlier in this pass, for
the whole data directory rather than a file inside it — `opener:allow-open-path`
is now scoped to `$APPCONFIG` as well as `$APPCONFIG/documents/**`, and the
button now shows a real error if the OS still refuses the request instead of
failing silently.

## Manual chapter extraction

Alongside automatic splitting, **Take out a chapter** takes one exact page
range by hand — first page, last page, an optional title. The existing
`split_pdf` command already refused a range past 1,000 pages; it now also
measures the actual result and refuses one over 50 MiB (illustrated pages
can land over the byte limit well before the page limit does), naming the
size and suggesting a smaller range, and removes the oversized file rather
than leaving it stored. A safety copy of the database is taken before
anything else changes — no file is written and no record is touched until
one exists — and if saving the new material's record fails after the file
is written, the file is removed the same way automatic splitting's own
rollback already works. The extracted chapter is an ordinary Study Library
item: its own study guide, its own practice test, its page range recorded
in its notes, the source handbook untouched.

## Known limitation: browser reputation and unsigned binaries

Neither installer is currently code-signed, so fresh unsigned binaries lack
reputation history and can trigger browser Safe Browsing or Windows
SmartScreen warnings. Under the release review policy, flagged or blocked
installers must never be bypassed by instructing users to force-keep files or
lower security protection settings. Draft installers remain private during
review. The Windows hold may be resolved by authoritative Microsoft clearance of
the exact installer or by trusted code signing (the long-term path, though not
mandatory if Microsoft clears the exact binary). Physical installed-app validation
on Windows and Apple Silicon hardware remains mandatory before distribution.
Published SHA-256 checksums confirm transfer integrity, but do not substitute for
platform clearance.

## Still requiring a Mac

The installed-app checklist and the transient Gemini-key webview issue are
recorded in `docs/MAC_AUDIT_2026-09-12.md`. No Mac readiness claim is made.

## Known limitation: automatic splitting's remaining bottleneck

Automatic splitting in `pdf.rs` uses `delete_pages_batch`, which batches page-tree count decrements and removes unwanted page references in a single traversal, eliminating `lopdf::delete_pages`'s quadratic per-page object-graph sweep. Windowing further bounds the working document to ≤1,000 pages per part with in-memory candidate evaluation rather than writing size trials to disk. The remaining cost for very large books is `lopdf`'s clone-and-prune approach (cloning the document tree and deleting excluded objects) rather than constructing each part by copying forward only the objects reachable from its kept pages — a larger, separately risky architecture not attempted in this pass.

## Living macOS parity tracker

Track Mac implementation follow-ups, feature parity, installed-app checks, and performance evidence in [MAC_PARITY_CHECKLIST.md](docs/MAC_PARITY_CHECKLIST.md). Update it when shared or Windows work affects Mac behavior. Unverified Mac checks remain open; shared tests and package builds do not establish installed-app readiness.


## 2026-10-07 — C2 production source review

C2-D1–D9 approval is recorded; source remains uncommitted in the isolated implementation checkout. Independent review requests C2SRC-R1 (same-count/timestamp content invalidation) and C2SRC-R2 (open history inspection provenance). Existing affected frontend tests: 100 passed / 1 skipped; typecheck clean; five focused native tests passed. Three frozen UI diagnostics fail by assertion. Source is not accepted. See [source review](docs/M2_CARD_REVIEW_C2_SOURCE_REVIEW_2026-10-07.md) and [correction prompt](docs/M2_CARD_REVIEW_C2_SOURCE_CORRECTIONS_PROMPT_2026-10-07.md).
