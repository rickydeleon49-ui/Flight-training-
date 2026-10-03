# Gemini: prepare Slice B from the accepted Mac Slice A source

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-`. Complete a bounded **Slice B decision and implementation-preparation package**, using the production validator and reader now accepted in Slice A. Leave your changes uncommitted and unpushed for Codex's independent review. This assignment permits preparation; it does not extend the owner exception to database writes, an import UI or another dependency.

## 1. Establish the shared starting point

Fetch GitHub and inspect branch, full HEAD/origin-main SHAs, working-tree status and active PRs. Confirm the Slice A source PR is merged, its exact-head required check passed, and the clean Mac main contains the acceptance, validator, read-only picker and service. Read `STATUS.md`, `docs/PROJECT_HANDOFF.md`, `docs/STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md` and the containing PR. If publication is still pending, read the branch and prepare notes without changing its active checkout. Preserve any intervening agent changes; never reset, stash, clean or force-push to obtain the expected starting point.

Once clean synchronized main is confirmed, create `codex/structured-study-import-slice-b-preparation` from it. Record the actual full base SHA, not the old Slice A implementation base. Follow repository instructions and the established implementer/Codex-review workflow.

Read the accepted contract, implementation handoff, owner exception, open-source adoption plan, M2 design, ROADMAP, A2 second review and Mac A2 verification preparation/acceptance. Treat proposals as proposals. The Slice A exception ends with A; a clean build or this prompt does not approve B/C, a migration or an installed release.

## 2. Produce a current gate and owner-decision table

Check whether the Windows A2 owner has actually published the matching reviewed source and whether an independent acceptance exists. Identify exact branches, PRs and commits when available. A2 preparation and oracle controls are not A2 implementation evidence. Do not recreate or edit the Windows owner's private branch, message another agent, or claim the R6/R7 fixes exist merely because a document describes them.

For each Slice B prerequisite, record required evidence, observed state, source/link and next responsible action: A merged; A2 published and accepted; M2 real-user check-in; scoped owner approval; D1–D9 decisions. If a gate is missing, continue the preparation deliverables and state precisely what implementation must await. Do not request the same Slice A approval again or substitute elapsed time for an owner decision.

Translate D1–D9 into a short owner-facing table with the accepted contract's proposed default and practical consequence. Give D3 particular attention: storing `provider: "import"` without a migration means older restored binaries can display imported content as Gemini-labelled. Compare that tradeoff with waiting for M2; do not silently approve either. D2's proposed first scope is create-new only. Replacement of existing content remains deferred. Keep D10–D12 separate; Markdown and links are not prerequisites for a plain-text import flow.

## 3. Map the actual source to a reviewable Slice B design

Read `src/logic/studyPacket/index.ts`, `types.ts`, `validate.ts`, `payload.ts`, `src/services/studyPackets.ts`, `src-tauri/src/study_packet.rs`, existing domain types, database interfaces/adapters, document repository, Study Library/detail pages, shared Dialog/A3 fallback, backup/restore and native transaction precedents. Cite real file/function anchors for every proposed integration point.

Document pick → validate → preview → confirm → save → refresh. The desktop wrapper returns null or raw metadata/text and never validates automatically. The pure validator returns preview plus a persistence DTO. Keep original-byte SHA-256 separate from canonical-content SHA-256: Rust hashes original disk bytes; the caller hashes the compact fixed-order array JSON. Explain where a preview's new material ID is minted once and how retry preserves that operation identity.

Specify a create-only atomic adapter API and native command contract without implementing either. Include fixed material defaults, the existing schema's constraints, study-set/test presence, provider/model rules, sourcePage-null enforcement, native revalidation, typed public failures and idempotency/conflict handling. Missing atomic-adapter support must refuse the save; no sequence of ordinary repository writes is an acceptable fallback.

Work through a pinned native connection and sql.js transaction/export conventions. An export/storage failure after an in-memory SQL commit is a distinct durability case; describe restoration/retry semantics and relate them to A2-R6/R7. Identify mismatches between the old proposed handoff and current source rather than copying stale line numbers. Do not call `BEGIN IMMEDIATE` on a pooled connection and assume later statements use the same connection.

Document concurrent saves, bounded busy retries, cancellation before commit, commit-outcome uncertainty, same-ID/same-content retry, same-ID/different-content conflict, and success followed by refresh failure. Persisted identity must be proved by real data in future integration tests, not a client-supplied digest alone. Keep private packet content and file paths out of errors, logs and evidence.

## 4. Specify the tests that will decide acceptance

Produce a stable-ID matrix naming engine, setup, trigger, observable assertion and cleanup. Mark each row **planned, not run** unless it is supported by a measured result. Cover real temporary rusqlite and real sql.js separately; fake-adapter contract cases are useful references but cannot certify either engine.

Include failures at each material/study-set/test statement, rollback with prior rows preserved, SQL commit and export/storage failures, writer contention/retry limits, duplicate operation/conflict behavior, cancel-before-save, save-success/refresh-failure, and unavailable atomic adapter. Include source-note retention, questions-only and guide/cards-only payloads, original/canonical hash distinctions, unverified preview claims/ref/ID disclosure, provider labels, Gemini regeneration behavior and backup/restore provenance. Existing Gemini, PDF, split, debrief, backup and restore guarantees must remain explicit acceptance criteria.

Plan accessible modal tests with the accepted A3 stack/portal behavior: keyboard focus, Tab, Escape, file-dialog cancellation, nested lifetime and error announcement. Specify future installed checks separately for current WKWebView, macOS 12.0–12.2 and VoiceOver. No Node simulation may be labelled installed evidence.

Use only synthetic examples. No owner profile/database, launch/install, live provider, credential, signing, account or release work. Do not add production source or scratch mutation fixtures to make the plan appear implemented. Run static/type checks only if a document's concrete example needs them; do not repeat unchanged full matrices for this preparation task.

## 5. Deliver a useful bounded package

Create `docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md` containing the verified starting point, gate/decision table, source/API map, transaction and durability design, accessible plain-text flow, stable-ID acceptance matrix, scope boundaries and unresolved questions. If the work occurs on another date, use that measured date consistently and explain the reference to this prompt.

Add `docs/GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-03.md` as a conditional copy-ready implementation assignment. It must enumerate the precise gate evidence needed before code, divide B into small reviewable changes, name relevant files/APIs/tests, and keep replacement, M2 migration, Markdown, other dependencies and installed release work out of scope. Unmet gates mean finish the preparation and hand it back; do not stop halfway through useful documentation or begin gated implementation.

Update STATUS, PROJECT_HANDOFF and the Mac tracker narrowly, labelling this preparation as pending Codex review and preserving Slice A acceptance and every installed/release UNVERIFIED state. Save a concise receipt with exact files, measured checks/exits, synthetic example scope and SHA-256 hashes. Validate relative links against the repository and distinguish current documentation from inert historical snapshots. Preserve failed/intermediate evidence if any.

Your final handoff must give branch/base, changed-file inventory and receipt hash; concrete gate evidence; proposed owner decisions; verified current APIs; future real-engine test coverage; checks actually run versus planned; and remaining blockers. Leave everything uncommitted/unpushed. Codex owns independent review, publication, exact-head CI and merge. Do not start Slice B/C source implementation after delivering this package.
