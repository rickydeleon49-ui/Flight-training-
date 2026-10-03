# Claude Mac continuation — prepare A2 verification

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-` on this Mac. Claude owns the verification preparation and report; Codex owns independent review and reviewed Git/CI/merge.

Begin after the A5 documentation publication merges with passing checks. Fetch GitHub, confirm `docs/MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md` is on main, inspect current tasks and clean/dirty state, and update a clean main by fast-forward only. Create `codex/mac-a2-verification-preparation` from that exact main, inspecting any existing branch before reuse. Record base SHA and ownership. Preserve other tasks' changes.

Read STATUS, `docs/PROJECT_HANDOFF.md`, `docs/A2_SECOND_REVIEW_2026-10-02.md`, its detailed findings and diagnostics, `docs/A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md`, and the shared A2 evidence. A2's corrected implementation was last recorded as uncommitted on Windows `fix/atomic-study-material-saves`, base `533a8f5`. Its R6/R7 diagnostics rely on that implementation; absent APIs on main are not new defects.

First check current GitHub branches and PRs for that exact implementation and a review/acceptance record. Record concrete source identity and availability. Preserve the Windows implementer's ownership; do not reconstruct its patch or edit material-save, SQL-driver or attachment production boundaries.

Complete useful preparation even if the source is unavailable:

1. Write a Mac acceptance matrix mapping every A2 requirement to an existing test or a precisely specified missing case: create/update/tag failure atomicity; save/replace/Cancel file conservation; acknowledged unrelated writes; queued reads/writes; public transaction control through execute/select with comments and supported statement forms; legitimate query/trigger controls; sql.js export/encoding/storage failure recovery, live/reopened equality, exact-once retry and later writes.
2. Inspect the shared diagnostic source and adapt only machine-specific paths/toolchain assumptions into copy-ready Mac commands and fixtures. Identify required APIs and their source prerequisite explicitly. Keep prepared diagnostics outside normal test discovery while their required implementation is unavailable. Do not run R6/R7 against main merely to produce missing-API failures.
3. Specify disposable real SQLite/sql.js datasets, fault seams, expected before/after rows/tags, cleanup and restoration checks. Preserve native save tests already accepted in the earlier review. Label driver-level results separately from installed UI/file-system behavior.
4. Prepare a copy-ready Windows-owner handoff identifying the required corrected-source hash/branch, passing receipts and independent publication gate. Include it in the report; sending it to another task or person requires the user's authorization. Do not push failing implementation just to transfer it.

If matching reviewed A2 source is now shared, inspect its status and conflicts with current Mac main before running its focused verification. Use a separate checkout/branch appropriate to that source; preserve the preparation branch and existing work. Run the relevant real-driver and native cases with scoped Node 22/Rust PATH and SDK 26.5, recording exact commands/counts. A source change still requires its complete sequential gate and independent review. A documentation-only preparation does not require another unchanged full matrix.

Write `docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md`, with source availability, the executable test plan, prepared diagnostics/commands, coverage gaps, owner publication handoff and remaining prerequisites. Save concise synthetic evidence under `docs/evidence/mac-a2-preparation-2026-10-03/`; update STATUS and the shared handoff truthfully. If source is absent, finish the preparation and clearly identify the dependent verification that cannot run yet.

Installed testing still needs the dedicated standard test account and an acceptable signing state. Use no owner's profile, real database, private document, live Gemini request or installer; do not alter signing/accounts or bypass Gatekeeper. Preserve macOS 12/Windows support, migrations, backups, release holds and the frozen candidate. Open-source adoption and M2/import/viewer/iOS work remain behind their existing roadmap gates.

Leave all changes **uncommitted and unpushed**, report the result and stop for Codex review.
