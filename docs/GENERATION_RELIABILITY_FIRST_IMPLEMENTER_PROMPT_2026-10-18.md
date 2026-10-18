# Implement GEN-REL-01 only: smaller selected sources and reusable PDF preparation

The owner approved prioritizing four generation-reliability improvements and asked for them **one at a time**. You are the implementer. Complete the first feature thoroughly, with a reviewable source package and evidence, then stop. Do not spend remaining usage on GEN-REL-02/03/04 or the paused scheduler work.

The owner subsequently requested more flashcards. That is queued as GEN-REL-05 after the reliability series, with proposed40-card default and20/40/60 choices in bounded batches. It is **not part of your active first-feature scope**: do not increase the existing combined response size or implement count selection now. Source preparation should remain reusable by later bounded generation jobs.

## Start safely and read the authority

Repository: `/Users/rickymac/code/Flight-training-`, remote `rickydeleon49-ui/Flight-training-`. Fetch first. Read `CLAUDE.md`, `PRODUCT_SPEC.md`, the current top of STATUS/ROADMAP/handoff and `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`. This instruction authorizes the first bounded implementation; routine choices within its defaults need no repeated owner questionnaire.

If these new planning documents are not on main, read them with `git show origin/codex/generation-reliability-roadmap-20261018:docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md` and the equivalent prompt path. Do not pull/reset/stash over a dirty checkout or copy another agent's in-flight source. Check PRs/worktrees for a competing GEN-REL implementation. Use an isolated implementation worktree from current accepted main; preserve the dirty primary settings and every other active tree. Record branch/base/starting source identity before edits.

The friend's exact error/build/page count is pending. Do not invent a root cause or wait for that information before fixing confirmed redundant whole-document submission. Baseline main at planning time is2e3f7fee6f84dd094c23ac0dfd7cd1053d2ccc4d; use live main rather than assuming that identity still holds. PR210/FSRS is paused, not accepted; do not repair or extend it in this task.

## Source to inspect

- `src-tauri/src/gemini.rs`: file validation, prompts, inline request bodies, HTTP client, retries/fallback, progress and tests.
- `src/services/gemini.ts`: native wrappers and progress transport.
- `src/pages/StudyLibrary/MaterialDetail.tsx`, Gemini/model test files: synchronous operation lock, source/session guards, confirmations, result validation/saving and existing notices.
- `ManualSplitDialog.tsx`, `SplitPdfDialog.tsx`, `splitSave.ts`, `SplitLineage.test.ts`, native `pdf.rs`/managed-document code: existing child source identity and page provenance.

Read official Google Files/GenerateContent REST documentation and current model support from primary sources. The suggested transport must actually work with the application's endpoint/model; don't blindly copy an Interactions SDK example into this REST client. Reuse the installed native HTTP/dependency stack and source-selection logic.

## Deliver the complete first feature

Follow GEN-REL-01's defaults and acceptance matrix in the plan. Make chapter/page-first generation understandable by reusing managed split children and explicit Send confirmation. Keep whole-source choice and text/image behavior intact. Do not auto-upload after selection, silently omit figures/pages, or remap a child's AI source pages onto the original twice.

Implement the reusable PDF submission path, with bounded native session-local metadata cache, content/credential/scope identity, coalesced preparation, state/expiry validation and stale-completion protection. Guide and practice-test generation must reference the same valid prepared source without re-embedding/re-uploading all its bytes. Existing format/page limits still apply. Use no migration or new SDK/library for this first slice. Cache expiry, content/key changes, disconnect and failed/deleted uploads need meaningful recovery, not an unbounded re-upload loop.

The Send text must explain temporary Google storage and exactly which selected material leaves the Mac. Keep provider locators and credentials out of saved study records, backups, logs and evidence. Cleanup only this operation's own uploaded files, with bounded best effort and honest expiry behavior. Never delete unrelated project files or silently fall back to repeatedly sending the full document.

Preserve existing guide/test content, historical attempts, source freshness, the shared synchronous generation lock and request/session-owned result guards. A cache optimization is not permission to save into a changed material or weaken generation validation. Future durable jobs are GEN-REL-02, broader retry policy is03, new cancellation/progress UX is04; implement only lifecycle handling necessary for the new upload/cache path now.

## Tests and evidence

Use only synthetic files, mock/loopback HTTP, controlled futures and a fake clock where appropriate. No app launch, owner profile/key access, real provider call, private upload, signing or release. Clearly leave live-provider and installed-Mac behavior UNVERIFIED.

Prove via request bodies and byte counters: selected managed child only; one source upload for guide then test; no second inline PDF body; changed same-path/same-size bytes cannot hit cache; different keys/sources cannot share it; concurrent same-key work coalesces; late old work cannot repopulate a new context. Include processing/failed/expired provider states, bounded polling/re-preparation, source disappearance/replacement, throttled/interrupted upload, cancelled selection, page boundaries and malformed/HTTP error responses. Prove previous saved content/history survives failure. Preserve every meaningful pre-fix failure separately.

Run focused tests while editing, then one final appropriate gate: frontend tests, typecheck/build, native relevant/full tests as needed, strict Clippy, fmt, Cargo-lock, migration/checksum preservation, helper26 and diff hygiene. Reuse unchanged-source evidence; don't rerun a full matrix repeatedly for report edits. Existing Mac lane uses Node22 and rustup stable; SDK26.5 was the verified native lane—inspect availability and scope PATH/SDKROOT rather than mutating global toolchains. Retain raw logs/exits/counts, fixture identities, baseline/final source hashes, captured payload measurements and limitations. Redact secrets/source content from diagnostics; synthetic fixture text may be inventoried.

## Submission and stopping point

Write `docs/GEN_REL_01_IMPLEMENTATION_REPORT_2026-10-18.md` (use the actual completion date if later), an evidence directory and an exact independent reviewer assignment. Map every acceptance row to named tests/receipts. Update ROADMAP/STATUS/handoff without deleting history; refresh only affected current helper bindings/inventory and preserve historical receipts. Mark implemented pending review, never self-accepted.

Leave changes uncommitted/unpushed for the Git coordinator's independent review, with exact cwd/branch/base, changed paths/hashes, test commands/exits/counts, failures, measurements and open limits. Do not merge, enable auto-merge, move to the next GEN-REL item, start a scheduler migration or prepare a release. If another agent changes the targeted source or a genuine contract blocker appears, preserve work and return one precise bounded handoff rather than starting a second implementation.
