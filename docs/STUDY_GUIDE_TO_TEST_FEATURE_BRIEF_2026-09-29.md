# Saved study guide → practice test — implementation plan

Prepared 29 September 2026 against repository commit `c241c4a`; published as a shared historical plan on 2 October 2026. Planning only. Reconcile current main and the [project handoff](PROJECT_HANDOFF.md) before implementation. The private v0.5.3 Mac DMG is a frozen candidate, not a vehicle for this feature.

**Scope distinction:** this plan uses Gemini to create a test from an existing saved guide. It is not the proposed fully offline structured question import from an outside assistant; that separate option is in [the open-source adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md). Neither authorizes an unreviewed M2 migration.

## Outcome and scope

After reviewing a saved in-app study guide, the learner can explicitly create a practice test **from that guide**. The existing option to create a test **from the original file** remains. The saved test displays its actual source after restart and backup/restore. No automatic network request occurs when a guide is opened.

An externally written Claude/Codex guide can already be imported as a separate PDF, `.md`, or `.txt` Study Library material and passed to the existing file-based Gemini action. DOCX is storable but not currently accepted by Gemini; export to PDF, Markdown, or text first. That workflow remains useful and does not require this feature. This plan addresses the extra export/reimport steps for a guide already saved **inside** Her Flight Deck. It does not add a Claude or Codex API integration.

## Verified starting point

- `AiStudySet` is one locally saved guide per material in `ai_study_sets`. It contains title, summary, sections, flashcards, source notes, model, and timestamps. It is not a document file. A regenerated guide replaces the prior row.
- `generate_practice_test` in Rust accepts an app-owned document path, validates that file, and sends it to Gemini. `PracticeTest` is one row per material in `practice_tests`; regeneration upserts over the prior row. It has no source-kind or guide-version field. Practice answers are in React memory, not durable history.
- The Practice test card in `MaterialDetail.tsx` is currently gated on `material.filePath`, Gemini configuration, and file readiness. Merely adding a second button inside that gate would incorrectly hide guide-based generation when the original PDF is missing.
- `MaterialDetail.tsx` has a shared synchronous Gemini-operation lock and navigation/stale-result guards. Reuse that ownership model for both choices. The existing save operation alone does not compare the selected guide with the current database row.
- The M2 design in [M2 design](M2_STUDY_LIBRARY_DESIGN_2026-09-27.md) and [ROADMAP.md](../ROADMAP.md) gates **M2 schema/UI implementation** on the real-user M1 check-in. This is a proposed M2 slice, not authorization to quietly start migration 11 or the full version/attempt system. Record the check-in and confirm the narrowed scope before coding its schema.

## User flow

1. Keep the existing file-based action, labeled **From original file**. Show **From saved study guide** whenever a valid saved guide exists, even if its source file is missing. Hide or disable only the file-based action when that file is unavailable. Show the saved test card independently of either source's current availability.
2. A confirmation names the selected source. For guide-based generation, explain that Gemini receives the guide title, summary, section headings/bodies, and source notes; it does **not** receive the original PDF, flashcards, unrelated materials, journal entries, or credentials. Submission requires a deliberate click. If an existing test will be replaced, say so before submission; no old test is deleted during generation.
3. During generation, show accurate progress and bounded busy/429 messaging. Disable both generation actions through the shared lock. Navigation or cancellation must not save a response onto a different material.
4. After saving, identify the test as **From original file**, **From saved study guide**, or **Source unknown** for legacy rows whose origin cannot be proved. A guide-derived test must not present invented PDF page citations: request `sourcePage: null`, force it to null in native validation, and render “Check source” rather than a page number.
5. Keep the existing warning that AI answers need verification against the original source, current FAA material, aircraft documents, and an instructor. A missing original file does not make a guide-derived test authoritative.

## Data and request contract

**Recommended integration point:** implement this as a small, reviewed M2 content/provenance slice after the M1 check-in. First settle whether M2-1's immutable content versions will ship with it. If they do, reference the immutable guide version ID/hash from the practice-test version. If they are explicitly deferred, add a narrow, additive migration for `practice_tests` source kind (`original_file` / `saved_guide` / `unknown`) and selected-guide content hash. Do not store provenance in the title, model, free text, or transient component state. A legacy row defaults to `unknown`; never infer `original_file` from its date or current file path. Renumber the broader M2 migration plan if this small migration ships first. Never rewrite a shipped migration.

Define a canonical guide payload containing only title, summary, ordered section headings/bodies, and source notes. Trim/validate fields, reject malformed or empty content, and bound total UTF-8 bytes and section count **before** any network call. Exclude flashcards so the test derives from the guide prose, not AI-generated answers on cards. Specify canonicalization and hash fixtures once so Rust and the persistence layer agree; an `updatedAt` timestamp alone is not a version identity. Avoid sending a full PDF or unrelated app state alongside the guide.

Prefer a new Rust command accepting material ID plus expected guide identity. It reads the current guide from local SQLite, validates/builds the bounded payload, and uses the existing configured Gemini key, model/fallback, timeout, retry, response schema, and sanitization. Do not add a free-form text argument that the UI could label as a saved guide without checking the database. The key remains in Rust storage and outside webview responses, logs, and backup archives. Use a guide-specific prompt that asks for questions supported only by the supplied guide, flags ambiguity/outdated claims, and sets `sourcePage` to null. Treat returned page numbers as invalid for this source regardless of the model's output.

Generation is slow and must not hold a SQLite write transaction. Capture a guide identity at request start; after the response, perform the **guide still matches + material still exists + save replacement with provenance** check as one pinned native SQLite transaction (or an equivalent proven single-connection operation). If the guide changed or material was deleted, discard the response with a clear message and preserve the previous test. Do not rely solely on React state or separate pooled `SELECT` and `UPDATE` calls. Retry transient SQLite contention only for a bounded interval. Provide an equivalent browser/test adapter contract. Failed generation, invalid output, cancellation, or failed save leaves the prior guide/test intact.

If the M2 immutable-version migration ships first, bind the result to that immutable guide version instead of re-reading a mutable row. Keep the same stale-material and atomic-save guarantees. Do not start durable attempts/review history or duplicate the M2 data model in this feature slice.

## Implementation sequence

1. Finish and independently review Gemini's current corrections. Branch this feature from the resulting current `main`; leave the v0.5.3 release candidate untouched. Physical Mac acceptance is a separate release gate and need not block planning or isolated development of a later version.
2. Record the M1 user check-in and the explicit scoped M2 go-ahead required by `ROADMAP.md`. Confirm whether M2-1 content versions land first or a minimal provenance migration is warranted. Write the schema, legacy/backups behavior, canonical-guide fixtures, and transaction contract before UI work.
3. Implement the native guide-to-test path and its focused Rust tests. Reuse common Gemini request, retry, output validation, and error handling without changing the existing file-based request body.
4. Implement durable provenance and the atomic conditional save in native and browser/test adapters. Update types, repository reads, backup database validation, migration registration/checksums, and documentation. Test upgrade from old databases and restore of v1/v2/v3 backups without weakening existing integrity or rollback behavior.
5. Add the source-choice UI and confirmation. Preserve the existing file flow and shared Gemini lock. Keep the test card visible when the source file is missing. Review keyboard/screen-reader labels and the currently in-memory attempt reset on replacement.
6. Run focused tests while developing, then one complete local TypeScript/Rust matrix after corrections. Codex independently reviews data-loss, privacy, migration, Windows, and Mac implications before its usual commit/push/PR/exact-head-CI/merge gate. Do not publish or retag a release as part of this slice.

## Required regression evidence

- Original PDF → guide/flashcards and original-file test still work; PDF Open, split, managed-file storage, and backup remain unchanged.
- A saved guide creates a test without opening or uploading its PDF; the guide-based action remains available with a missing source file, while the file-based action is unavailable. A saved test remains visible offline and without a configured key.
- Request-body tests with a local mock server show exactly the selected canonical guide fields and no PDF bytes, flashcards, other material, journal data, or key. No live paid Gemini call in CI.
- Rapid double-click starts one request. Both source actions exclude one another. A guide regenerated or material deleted/replaced mid-request causes no stale write, even when database state changes outside the mounted component. A finishing request never releases a newer request's lock.
- Empty/malformed/oversized guide fails before network use; offline, no key, 429/busy, timeout, malformed response, and bounded SQLite contention produce truthful errors. No request body or credential is logged.
- Legacy test source is conservatively labeled; new source kind/hash survive restart, old-database upgrade, and v1/v2/v3 backup/restore. Failed save or migration does not erase the previous valid test or backup.
- Guide-based questions have `sourcePage: null` despite a model-produced number. File-based tests retain legitimate validated page behavior. Source labels and verification warnings are accessible and understandable.
- Run `npm test`, `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `git diff --check` after the focused suite passes. Record exact results and any Mac installed-app behavior separately; a CI macOS build is packaging evidence, not a smoke test.
