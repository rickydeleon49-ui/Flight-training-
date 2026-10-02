# A2 second review — shared handoff status

Reviewed by Codex on 2 October 2026 against uncommitted Windows work on `fix/atomic-study-material-saves`, based on `533a8f50c2d0de74a75f5542022da3182f376ee9`. **A2 is not accepted, committed or available in main.** This document shares the review outcome without requiring local Windows evidence files.

## Verified corrections in the local implementation

The original native tag replacement, cleanup alias and cleanup-first attachment failures now pass independently: four original reviewer cases plus 21 native save tests. Sixty-seven focused frontend tests also pass, including driver ownership, quota rejection, the shared save fixture, repository behavior, the real Study Library page and editor refresh safety. Native tests use real migrations and files; the frontend file service remains a mock boundary.

The implementer's matching full-matrix logs show 629 frontend tests passed (4 skipped), 283 Rust tests passed (6 ignored), successful build, formatting, lint, lock consistency and diff checks. All ten handoff source/document/fixture hashes matched before and after Codex review. Those passing suites did not cover the following newly reproduced boundaries.

## Remaining corrections

### R6 — P2: public SQL can escape transaction ownership

The new `connectionOwner.ts` guard only checks a whitespace-prefixed keyword, and public select has no transaction-control guard. Actual node:sqlite accepts `/* comment */ BEGIN IMMEDIATE` through execute and `BEGIN IMMEDIATE` through select. A later unrelated insert reports success, then an atomic save fails and rolls it back. Actual sql.js accepts BEGIN through select; its next acknowledged write is rolled back by export, leaving no live or durable row.

Fix the public ownership boundary across both single-connection drivers and applicable SQL entry points. Preserve legitimate read queries, comments and CREATE TRIGGER bodies; do not reject every occurrence of BEGIN in arbitrary SQL. Maintain the queue and fail-closed cleanup policy. Add real-engine regressions for commented control and select control, then prove ordinary writes and atomic saves remain usable after refusal.

### R7 — P2: browser export failure leaves a rejected write in memory

In the reviewed `sqlJsDb.ts`, `durableWrite` calls export outside its recovery catch. One-time faults in the actual sql.js export method after normal initialization reproduce: rejected create still appears live but not after reopen; rejected update has the new title live and the old title after reopen.

Include export/connection-setting/encoding/storage failures in one truthful durability policy. Restore the last stored state before permitting another operation, or fail closed if recovery cannot safely complete. Test full prior rows/tags both live and reopened, exact-once retry, later persist/unrelated writes and recovery failure. Keep the existing quota and foreign-key regressions.

Five independent diagnostic cases fail for these two issues. Scope is the browser development and test drivers; no equivalent desktop-native failure or current UI call issuing unsafe SQL was established. Do not claim the installed desktop loses data based on these diagnostic entry-point tests.

## Coordination

The implementer on Windows has the detailed correction prompt and test evidence. Complete only R6/R7, run focused tests for each correction and the final local matrix once after corrections, then leave work uncommitted for Codex. No speculative push or CI run is authorized by this handoff. The Mac can meanwhile test current main and report its existing known A2 behavior honestly; do not assume a Windows-local patch exists in its checkout.

A1 is merged; A3–A6 remain separate. Physical Apple Silicon, early macOS 12, APFS identity, installed Windows and live Gemini remain unverified until recorded. Release holds and frozen artifact identities are unchanged.
