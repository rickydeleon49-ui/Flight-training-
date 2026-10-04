# Mac A2 verification after Windows source integration — 4 October 2026

You are Claude, the Mac verification implementer for rickydeleon49-ui/Flight-training- (https://github.com/rickydeleon49-ui/Flight-training-). Codex is the independent reviewer and Git coordinator. The user asked Codex to finish Gemini's A2 work; the source acceptance is in docs/A2_INTEGRATION_ACCEPTANCE_2026-10-04.md. First confirm its containing PR is merged and fetch origin/main. Do not begin from an old candidate, local Windows files, or the frozen v0.5.3 DMG. No new release is authorized.

## Current publication and owner instruction

A2 is merged through PR #78 at `558725158cd93d49f8f9114693f61b08a00ffe2f`; required CI passed on head `8a69fa2d24c1919cdd05d5370381ef9ead83c45c`. Fetch and verify this accepted commit is an ancestor of your actual main. The older preparation report's “source unavailable” observations are historical, not the current gate state.

The owner has [waived the M2 real-user check-in](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md). Do not request that check-in again or hold this Mac verification for it. Other product decisions and installed/release prerequisites remain separate.

Preferred clean Mac checkout: `/Users/rickymac/code/Flight-training-pr70-integration`. Confirm current status and create a verification branch from synchronized main. The earlier `/Users/rickymac/code/Flight-training-` has preserved dirty work; do not switch, reset, stash or overwrite it. Do not create a duplicate checkout when the agreed clean one is suitable.

## Preflight and scope

Read the top of STATUS.md, docs/PROJECT_HANDOFF.md, CLAUDE.md, docs/MAC_PARITY_CHECKLIST.md, the acceptance note, docs/MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md, and docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md. Record clone, branch, clean/dirty state, actual HEAD and origin/main SHA, roles, hardware, OS, Node/npm/Rust and SQLite/sql.js versions. Protect another task's dirty files. Create a separate verification worktree from the accepted source SHA if needed. Scope Node 22 and Rust to the process; use the evidenced MacOSX26.5 SDK, without changing system developer settings. If a prerequisite is missing, report it precisely and continue independent checks.

Confirm saveMaterialAtomically, MaterialSaveOperation, connectionOwner.ts, materialTransaction.ts, documents_save_tests.rs and both native picker/save command registrations exist. Hash the accepted source files against the acceptance manifest, allowing Git checkout line endings only where documented; compare Git blob identities for cross-platform source matching. No renamed or skipped assertion may turn a prerequisite gap into a pass.

## Execute the prepared checks

Use the existing 181-case diagnostic and observation helper from docs/evidence/mac-a2-preparation-2026-10-03. Copy only those task-owned files into src/data in the isolated worktree; check destination absence first. Run with an exit-preserving pipeline and save sanitized raw results. Every one of the 57 conditional seams must actually fire. Remove only your temporary copies afterwards and verify status. Missing seams are gaps, not passes. Retain the earlier failed receipts.

Run maintained connection-owner/driver, material contract, repository, form, integration, editor and Study Library fixture/scenario tests. Verify atomic create/update and tags, omitted-field preservation, duplicate rejection, exact rollback, post-commit refresh failure, reference-safe attachment cleanup, import cancellation, browser export/encoding/storage refusal, durable reopen, foreign-key enforcement and failure recovery. Do not add production hooks or raw handles for tests.

Run native documents_save_tests and reference-safe document tests on actual APFS, including contention and bounded permanent-lock failure. Inspect actual test discovery and cfg/early-return skips. Verify case-insensitive alias protection on the host volume, then the existing case-sensitive-volume procedure with a disposable task-owned APFS image for distinct Case.pdf/case.pdf behavior. Record filesystem type, identities, original/staged bytes and conservation after failure. Safely detach and remove only the disposable image; never modify a real profile. A Windows early-return case is not Mac evidence.

Run the complete local matrix once after any focused corrections: npm ci, npm test, npm run build, cargo fmt --manifest-path src-tauri/Cargo.toml --check, cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings, cargo test --locked --manifest-path src-tauri/Cargo.toml, npm run test:cargo-lock, node scripts/check-release-version.mjs 0.5.3, node --test .claude/tests/setup-helpers.test.mjs, git diff --check. Avoid duplicate background matrices or repeating unchanged successful expensive steps. Keep evidence for failures and runner-specific fixes.

## Installed checks remain separately gated

Source/APFS tests do not prove packaged WKWebView, Finder, Preview or installed backup behavior. Follow docs/MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md for the owner-selected artifact, dedicated standard test account and acceptable signing state. If those are not available, leave installed phases UNVERIFIED and provide the precise remaining checklist. Do not bypass Gatekeeper, remove quarantine or reuse the frozen draft's identity for a rebuilt binary. A new DMG requires its own source/artifact/signature/hash receipt and authorization under the existing runbook.

When eligible, observe import/Open/Reveal, automatic/manual split and original preservation, progress/cancel/failure recovery, per-part guides, explicit Gemini submission, complete backup to Downloads and restore/update round-trip under concurrent autosave. Keep real API keys and user documents out of tests/logs/backups. Never contact Gemini without the user's applicable authorization.

## Deliverable and boundaries

Write docs/MAC_A2_VERIFICATION_2026-10-04.md (use the actual execution date if later) and a dedicated sanitized evidence folder. Give exact commands, exits, counts, timings, versions, source Git SHA/tree, hashes and explicit skips. Separate source tests, browser simulations, native APFS, packaging/signing and installed observations. Update STATUS.md, PROJECT_HANDOFF.md and MAC_PARITY_CHECKLIST.md only with observed evidence. Preserve historical reports as history.

Leave source corrections and notes uncommitted for Codex review; no speculative push/PR/merge/tag/release. Stop on a reproduced data-safety blocker after preserving evidence and propose the smallest correction. Preserve migrations, backup v2 integrity/v1 restore, reference-safe cleanup, bundle identifier, Windows behavior, versions and approved dependency pins. The M2 real-user check-in is waived by the linked owner decision. Slice B/C still require their separate scoped approval and applicable owner decisions, including D1–D9 for B; neither A2 acceptance nor the check-in waiver supplies those decisions. Do not start another feature or rewrite already accepted preparation.
