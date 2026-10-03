# Claude Mac continuation — detailed A2 verification preparation

Expanded 3 October 2026 at the owner's request. This replaces the shorter preparation prompt at this path. If you already started this assignment, continue from your current work and incorporate the missing details; do not restart, discard changes, or create a competing implementation.

## Assignment and ownership

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-`. The main user will use the Mac, so the next outcome must make the remaining atomic-save verification concrete and reviewable here.

You own the preparation, diagnostics, relevant local verification, and completion report. Codex owns independent review and the reviewed commit/push/PR/CI/merge sequence. Leave your changes uncommitted and unpushed. Complete the useful preparation without asking Codex to write the test plan or resolve routine implementation choices for you.

This assignment is A2 verification preparation. The Windows implementer still owns the unpublished A2 production corrections unless the project owner explicitly transfers that ownership. Do not reconstruct that patch from the review narrative or change the material-save, SQL-driver, or attachment production boundaries in this preparation task.

## Current context

- A1 and the Mac baseline are merged. A3 compatibility, A4 offline saved-study visibility, and A6 Gemini error wording are merged through PRs #48, #49, and #50.
- A5 evidence reconciliation is accepted and merged through PR #51. Its main commit is `54b82b3b59667b2ff9847c14fd6e44bcb3399e02`. That acceptance covers source-tooling evidence; installed behavior remains unverified.
- The A2 implementation was last reviewed as uncommitted Windows work on `fix/atomic-study-material-saves`, base `533a8f50c2d0de74a75f5542022da3182f376ee9`. The shared review documents do not contain its complete production patch.
- The second review confirmed earlier native corrections but reproduced R6 public transaction-ownership bypasses and R7 browser export-failure divergence. A2 remains unaccepted until corrected source and its independent review are available.
- No open A2 publication was found at the prompt expansion check. Recheck current availability; distinguish this observation from proof that no unpublished source exists.
- A dedicated standard synthetic test account is not available. Installed launch, minimum-macOS WKWebView, VoiceOver, and release readiness remain open.

## 1. Establish the working state

Record the repository path, current branch, HEAD, upstream, and exact dirty-file list before editing. Inspect repository instructions and existing preparation work.

The agreed preparation branch is `codex/mac-a2-verification-preparation`. If it already contains this task, preserve it and continue. If starting fresh, update a clean main by fast-forward only and create the branch from that exact main. Do not switch or reset a dirty checkout, overwrite another agent's changes, or create a new checkout without a concrete source-verification reason.

If a newer GitHub prompt has merged while your branch is active, read it from GitHub or an appropriate read-only reference and incorporate its contract. Codex can reconcile the branch with main during review. Do not mix a prompt publication into unfinished implementation work merely to make your branch look current.

Read these files before preparing diagnostics:

1. `STATUS.md`, `ROADMAP.md`, and `docs/PROJECT_HANDOFF.md`.
2. `docs/MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md` and `docs/MAC_PARITY_CHECKLIST.md`.
3. `docs/A2_SECOND_REVIEW_2026-10-02.md`.
4. `docs/A2_SECOND_REVIEW_DETAILS_2026-10-02.md`.
5. `docs/A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md`.
6. `docs/A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md`.
7. `docs/evidence/a2-second-review-2026-10-02/README.md` and its source hashes and focused receipts.
8. `docs/MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md`.
9. `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md` and the accepted Mac baseline decision.

Use the newest explicit acceptance records for current status. Preserve historical observations rather than silently rewriting their dates, counts, or platforms.

## 2. Resolve source availability before dependent execution

Inspect current GitHub branches and pull requests, then identify whether the matching A2 source and a correction/review record are accessible. Record the check time, repository, ref, full commit SHA if present, acceptance status, and concrete evidence.

Distinguish these outcomes:

- **Unavailable:** only review documents are shared. Finish every preparation deliverable below and mark dependent execution blocked by the missing source.
- **Available but unaccepted:** identify the source and remaining review requirement. Prepare commands against its API, but do not transplant it into Mac main, claim acceptance, or take over its corrections.
- **Available and independently accepted:** compare its API and source identity with the accepted record, inspect compatibility with current Mac main, and perform the focused verification in section 6 using an appropriate isolated checkout if necessary.

The five reviewer diagnostics require `MaterialSaveOperation`, `saveMaterialAtomically`, and the reviewed ownership/durability implementation. Main's existing plural `saveMaterialsAtomically` is a different contract. Missing symbols on main are a prerequisite mismatch, not a newly reproduced defect.

Do not run R6/R7 on a mismatched source to generate missing-API failures. Do not push known-failing source just to transfer it. Do not message the Windows owner or another task unless the human user has explicitly authorized that message; provide a copy-ready handoff in your report instead.

## 3. Build a requirement-to-evidence acceptance matrix

Create a matrix with stable case IDs. Each row must include the requirement, concrete setup/action, expected result, driver or platform, existing test reference, prepared test reference where needed, execution status, and remaining prerequisite. Use verified file/test names; if a test is unavailable, say so.

Cover at least these groups:

**Atomic records and tags**

- Create with fields and tags succeeds as one operation.
- Update replaces the intended metadata and tag links while preserving fields outside the update contract.
- Clearing tags removes the intended links.
- A failure after an intermediate write leaves the complete prior records and links intact.
- Retry after a rejected attempt produces one intended saved result, without duplicate rows or links.
- Post-commit refresh failure follows the established contract and does not delete a committed attachment or misreport storage state.

**Attachment and native-file conservation**

- New attachment, replacement attachment, failed save, retry, and Cancel preserve the correct old/new file ownership.
- Cleanup refuses aliases, traversal, and referenced-file deletion according to the accepted native contract.
- Capture original and staged file paths, hashes, reference counts, and expected existence before and after.
- Retain the four earlier reviewer cases and the 21 native save-test behaviors identified in the shared evidence. Do not claim those exact test counts on this Mac without running the matching tests.
- Case-insensitive, symlink, and case-sensitive volume results must have explicit platform status; an early return is not a passing case-sensitive exercise.

**Queue and transaction ownership**

- An acknowledged unrelated write survives a later rejected material save.
- Queued reads, writes, debrief saves, batches, and persistence cannot enter another operation's partially written state.
- FIFO/ownership and poisoned-owner recovery cases keep their established guarantees.
- Public execute and select cannot leave BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE ownership across calls, including supported variants, leading comments, whitespace, or statement forms.
- Legitimate commented queries, quoted keyword text, parameters, required read PRAGMAs, and CREATE TRIGGER BEGIN/END bodies remain usable. Distinguish forms each engine actually accepts.

**Browser durability and recovery**

- Create/update faults at export, encoding, connection-setting restoration, and storage preserve the last durable snapshot or produce bounded fail-closed behavior.
- Compare complete affected rows and tag links live and after reopening; checking only that a promise rejects is insufficient.
- A retry saves exactly once. A subsequent unrelated write or persist cannot make a prior rejected change durable.
- Foreign-key enforcement remains active after recovery.
- Recovery failure rejects later unsafe operations and does not silently continue with an unknown or closed handle.
- Preserve quota/private-mode, plain-write, debrief, batch, and mid-save persistence coverage.

Separate current source results, historical Windows receipts, prepared-but-unrun cases, and installed-app requirements. Avoid one overall “passed” label that hides these different evidence levels.

## 4. Prepare reproducible Mac diagnostics and fixtures

Adapt the five shared reviewer cases into a clearly labeled diagnostic artifact under `docs/evidence/mac-a2-preparation-2026-10-03/`. Keep it outside ordinary test discovery while the matching implementation is unavailable. Include instructions for placing a temporary test in the correct source-relative location, running it, and removing it without touching maintained tests.

Preserve these exact behavioral checks:

1. node:sqlite commented execute transaction control followed by an acknowledged unrelated insert and a later material save.
2. node:sqlite select transaction control with the same conservation assertion.
3. sql.js select transaction control with live and reopened acknowledged-row assertions.
4. sql.js one-shot export failure on create, comparing prior/live/reopened state.
5. sql.js one-shot export failure on update, comparing prior/live/reopened state.

Retain the original cases' meaning when adapting paths. Additional stronger assertions can be separate cases. Resolve the WASM path from the actual Mac checkout rather than copying a Windows absolute path.

Specify disposable real node:sqlite and sql.js datasets using the project's actual migrations. Provide synthetic deterministic IDs, metadata, tags, and unrelated rows. For each fault case, identify the failure seam, injection timing, expected error/state, retry action, and cleanup. Restore one-shot spies and global storage stubs even when assertions fail. Close database handles and remove only task-owned temporary files.

Use existing test seams. Do not expose raw database handles, add mutable browser globals, or introduce production test backdoors. If a required fault cannot be injected through the existing design, document the precise gap and proposed seam for the source owner instead of modifying production ownership.

Provide copy-ready commands and prerequisites for each group. Commands with unknown source-dependent filenames must be labeled templates until resolved. Validate artifact syntax and relative paths where possible without executing mismatched diagnostics. State clearly that parsing a diagnostic is not a behavioral test pass.

## 5. Prepare the Windows-owner publication handoff

Include a reusable handoff requesting:

- The corrected branch/ref, base and final full SHAs, and exact dirty-file list.
- An R6/R7 issue-to-fix map with maintained regression names.
- Passing focused real-engine receipts, final sequential matrix receipts, command exit codes, counts, and skips.
- Final source/test/document hashes matching the tested snapshot.
- Independent Codex acceptance and the reviewed GitHub publication identity.
- Any expected integration conflict with Mac main, source prerequisites, and remaining native/platform limits.

Explain that the Mac package is ready to consume the matching accepted source. This handoff requests publication through the existing review workflow; it does not authorize pushing a failing snapshot or changing ownership.

## 6. Run verification only when its source prerequisite is satisfied

If accepted matching source is available, inspect it before execution and record its relationship to current main. Preserve the preparation branch and other work. Use the real drivers and disposable filesystem roots.

Scope the known Mac toolchain to the task process:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
node --version
npm --version
rustc --version
cargo --version
sw_vers
```

Verify those paths exist. The explicit SDK previously avoids a default-SDK/TAPI incompatibility; if unavailable, report the environment prerequisite instead of changing system developer settings. Record the current OS rather than assuming earlier 26.6 or 27.0.1 reports apply today.

Discover and run the relevant maintained frontend/native suites and the prepared reviewer cases. Record actual command lines, exit codes, passed/failed/skipped counts, durations, source hashes, and log paths. A diagnostic failure becomes a focused finding for the existing source owner; do not silently repair production source within this task.

Documentation-only preparation requires link/path checks, artifact validation where feasible, and `git diff --check`. Do not rerun the unchanged full application matrix, regenerate the heavy A5 fixtures, rebuild installers, or use CI as an exploratory test environment.

If separately authorized production changes become necessary, use a distinct correction handoff and complete the required sequential matrix after focused fixes pass:

```sh
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
node scripts/check-release-version.mjs 0.5.3
git diff --check
```

Do not overlap matrices or duplicate background jobs. Inspect each result before advancing. This SQLite preparation does not require a new PostgreSQL/container service.

## 7. Produce the review package

Create `docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md` containing:

- Working identity and source-availability outcome.
- The acceptance matrix and precise unresolved coverage.
- Diagnostic/fixture inventory and executable commands.
- Results you actually obtained, separately from inspected historical receipts.
- The copy-ready owner handoff and the next prerequisite.
- Remaining installed/platform limits and release holds.

Place concise sanitized evidence and diagnostic artifacts in `docs/evidence/mac-a2-preparation-2026-10-03/`, with a README explaining provenance, prerequisites, intended invocation, and execution status. Keep large/generated datasets and raw bulky logs in task-owned ignored temporary locations; retain useful log paths in the report.

Update the current status section of `STATUS.md` and the A2 row/follow-up in `docs/PROJECT_HANDOFF.md`. Update the relevant checklist row only when new evidence warrants it. Preserve historical evidence and distinguish completed preparation from completed A2 validation. Do not leave a current statement claiming accepted A2 or installed readiness when only this package is complete.

## Scope and roadmap gates

Use synthetic data only. Do not launch against the owner's application profile, real database, private PDFs, or credentials. Do not make live Gemini requests, install a DMG, create accounts, change signing, or bypass Gatekeeper. Preserve macOS 12 and Windows support, migrations/schema snapshots, backup/restore guarantees, bounded retry behavior, bundle identity, and release/version holds.

The selected open-source plan remains in force: MiniSearch was rejected by the accepted baseline; virtualization needs justified installed expanded-display evidence; M2 implementation needs the real-user check-in; Zod/react-markdown require an approved bounded import contract; embedded PDF reading follows its license/worker/WebKit gates. Do not install these dependencies or begin those features as a way around the A2 prerequisite. List the next eligible roadmap step and its gate in the report.

## Completion criteria and final handoff

Finish all preparation items even if dependent execution is blocked by missing source. A useful completed package must let the next agent run the intended checks without reconstructing your reasoning.

Before stopping, provide:

1. Branch, HEAD, exact changed/untracked file list, and confirmation that nothing was committed, pushed, tagged, installed, or released.
2. Requirement-to-evidence summary with each case's execution status.
3. Exact commands/results and paths for new evidence.
4. SHA-256 hashes for all changed artifacts, tests, and documents; distinguish inherited source hashes from changed-file hashes.
5. The source-publication prerequisite or verified source identity, any confirmed failures, and remaining platform limits.
6. A concise list of decisions or approvals genuinely needed from the owner, if any.

Then stop for Codex review. Do not start the next roadmap implementation, repeat unchanged full matrices, or wait indefinitely for source before delivering the completed preparation.
