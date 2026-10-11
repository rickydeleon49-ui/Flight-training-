# M3 skills and feedback evidence — scope, prototype and implementation handoff

## Assignment and intended outcome

Continue Her Flight Deck on the Mac. The owner requested continuing the roadmap after deferring hfdtest installed verification. Prepare one substantial M3 scope/proof package for skills and feedback evidence: a lesson debrief can deliberately contribute an observation to a skill, preserve what was said and who reported it, link an existing follow-up action, and show an understandable evidence history. Completing a quiz/action must never silently mark a flight skill proficient or instructor-approved.

This is a scope plus runnable disposable prototype assignment, not another general audit. Deliver the concrete data contract, candidate schema, UI flow, meaningful proofs, proposed owner defaults and a complete conditional implementation prompt together. Do not apply a production migration until scope review and owner approval of the new defaults. No new dependency is needed; reuse existing local SQLite, React/TypeScript, Rust conventions and adopted validation tools where useful.

## Start safely and read only relevant context

Repository: `/Users/rickymac/code/Flight-training-`. Fetch, inspect branch/HEAD/status and read from current origin/main. The primary may contain a separate dirty read-only Mac preflight report: preserve it without staging, editing or mixing it into this work. Do not reset, stash, clean or pull over dirty changes. Reuse a suitable clean checkout; if none is available, create one justified isolated worktree from origin/main with a codex/ branch and record its path. Inspect applicable AGENTS/CLAUDE instructions before editing. One implementation owner; do not start competing agents.

Read:
- `docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md`
- `ROADMAP.md` sections7–8,12,14,17 and latest dated entries
- `PRODUCT_SPEC.md` evidence-based progress section
- `docs/MAC_INSTALLED_VERIFICATION_OWNER_DEFERRAL_2026-10-10.md`
- latest STATUS/handoff; accepted practice/card/split-lineage source summaries as needed

Inspect actual integration points: `src/domain/types.ts`, `src/logic/feedback.ts`, `src/pages/FlightJournal/JournalForm.tsx`, `JournalEntryDetail.tsx`, `src/data/repositories/journalRepository.ts`, `src/data/debriefTransaction.ts`, `src-tauri/src/debrief.rs`, existing action/question links, and native/browser migration/backup/restore validators. Migrations0001–0013 and schema13 are shipped at this handoff; recheck main before allocating a candidate number. Candidate SQL stays under the new evidence directory, never in the production migration registry.

Time-box current-state reconciliation: identify what M1/M2 already supplies and residual source-level requirements. Do not reopen accepted implementations or claim every M2 UX/physical exit check completed. M3 must remain usable with existing debriefs and offline saved study. Preserve simple-v1 scheduling, accepted retention, provider/key boundaries and split lineage.

## Define the product and storage contract

1. **Skill catalog:** small local versioned catalog with immutable stable IDs; existing broad Topic values remain intact. Custom skills have separate identities. Preserve historical labels/catalog revision when a skill is renamed, retired or edited. Explain duplicate labels and archived/custom behavior. V1 may omit ACS mappings rather than inventing official codes. If proposing a mapping, verify exact official FAA source/revision and cite it; leave unverified mappings absent. Weather, FAA dataset imports, FSRS adoption and PDF viewer changes are separate tasks.
2. **Observations:** explicit user-selected debrief/source plus skill, original wording, observed date and attribution. Distinguish self-report from student-transcribed instructor feedback. The local app has no verified instructor identity mechanism: do not expose a trusted verified-instructor state merely because a user selects a label. Define IDs, timestamp units/local-date display, text/byte limits, nullability, source snapshot and current/missing-source presentation. No automatic backfill or AI extraction.
3. **Status and confidence:** Learning / Practicing / Needs review are explainable, deliberately controlled labels; confidence remains a separate optional self-rating. Define precedence and empty/insufficient-evidence states. Practice score, card rating, action completion and observation count do not confer proficiency, readiness, endorsement or sign-off.
4. **Edits and history:** specify append-only revisions or an equivalent intelligible audit history; idempotent creation/edit retries and stale-revision conflict behavior. Preserve old wording/date/attribution under edits. Do not silently relink an observation when source content changes. Handle journal/material/skill/action deletion and missing links explicitly. Define a bounded explicit erase operation separately from archival/deleting the source; proposed retention defaults need owner approval.
5. **Follow-up actions:** reuse existing next_actions/question relationships. An observation may link to an existing action and be marked addressed explicitly. Completing an action alone does not imply the skill was demonstrated or the feedback resolved in flight. Specify repeated acceptance, conflict and source-deletion behavior; no second action system.
6. **Queries and writes:** design native transaction ownership for multi-record writes with equivalent browser/test semantics, bounded idempotency payloads, indexes and keyset pagination. History must not load globally through AppDataContext. Define operation/revision ownership under double clicks, late callbacks, route A→B→A, unmount/replay and failed refresh after an acknowledged write. A read retry must not resend an acknowledged mutation.
7. **Migration and backup:** draft the next additive candidate migration, FK/index/uniqueness constraints, exact semantic validation and registration changes required later. Demonstrate populated schema13→candidate upgrade and backup/restore using existing contracts, including older-binary refusal for a genuinely newer schema. Preserve all existing rows/files/history; test rollback and corrupt semantic state, not only SQL syntax. Keep copies/cache versus authoritative observations distinct.

Prepare one table of M3-D1–D9 proposed owner defaults covering catalog, status, attribution, creation, revisions, source deletion, erasure, action addressing and confidence/mapping boundaries. Give a concise recommended choice and impact for each; label them PROPOSED. Do not convert general roadmap continuation into approval of new retention semantics. Ordinary implementation details are your judgment and do not need extra permission questions.

## Build and prove a disposable prototype

Deliver executable modules/tests and a small UI specimen under a new evidence/prototype directory; keep production source, dependencies and registered schema unchanged. Reuse the real shipped0001–0013 baseline, actual SQLite adapters and current backup validation boundaries wherever practicable. Disclose any isolated adapter; mocks cannot certify native persistence or installed UI.

Cover these contracts in meaningful named tests:
- create/reopen/retry one observation without duplicates; concurrent distinct operations preserve both;
- edited wording/attribution/date retains intelligible revisions; stale updates refuse;
- source deletion/rename/replacement and skill retirement preserve honest historical context;
- no trusted instructor label, mastery or addressed state manufactured by quiz/action completion;
- explicit action link/mark-addressed stays atomic and idempotent;
- explicit erasure affects only selected history and follows documented retention/tombstone rules;
- native/browser parity for candidate constraints and populated upgrade;
- roundtrip preservation and corruption rejection, including wrong ownership/FK definitions where relevant;
- failed multi-record writes roll back everything; post-write read failure is recoverable without duplicate writes;
- pagination under tied timestamps, filtering and changes; limits enforced at the actual read/write boundary;
- UI loading/empty/missing-source/error states, keyboard labels, duplicate events and obsolete request publication.

Use synthetic data only. Benchmark representative100/2,500/5,000 skills/observations as appropriate and10,000 observations, documenting exact counts and query bounds. Report source/query/Node/browser timings honestly; no WKWebView or installed-performance claim. Add a few targeted reversions proving important assertions fail when idempotency, retention, attribution or transaction protections are removed. Do not build a mutation framework or manufacture large test counts.

Run focused checks proportional to the prototype; do not rerun an unchanged complete app matrix. Capture exact command/cwd/stdout/stderr/exits, actual engines/toolchains and final hashes. Preserve failures and limitations. Fix confirmed problems before handoff; do not push speculative code to discover CI failures.

## Deliver together, then stop

Create:
- `docs/M3_SKILLS_EVIDENCE_SCOPE_<actual-date>.md`: exact contracts, UI flow, candidate schema, decisions, limitations and issue-sized implementation order;
- `docs/evidence/m3-skills-evidence-scope-<actual-date>/`: runnable prototype, candidate SQL, focused tests/fixtures, receipts, README and SHA256 manifest;
- `docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_<actual-date>.md`: complete model-neutral CONDITIONAL production assignment, tying each proposed default to implementation and verification; production starts only after scope acceptance and owner approval.

The conditional implementation should deliver a useful first vertical slice: catalog + durable debrief observation + evidence history + explicit action linkage, before later readiness/AI features. Specify actual files, operations, failure behavior and migration/restore obligations from your investigation. Keep one cohesive reviewable change rather than tiny disconnected tasks.

Update ROADMAP/STATUS/handoff by adding history, with scope/prototype pending review and defaults proposed. Physical G1–G3 stay DEFERRED/UNEXECUTED/UNVERIFIED; post-receipt recovery BLOCKED/source-covered. No hfdtest login requests, everyday profile writes, provider calls, package adoption, app launch, installer rebuild, signing or public release.

Leave all work uncommitted/unpushed for senior review. Report checkout/branch/base, source/evidence manifests, focused results and the nine proposed decisions, then stop. Do not begin production M3 on your own or send messages to another task.
