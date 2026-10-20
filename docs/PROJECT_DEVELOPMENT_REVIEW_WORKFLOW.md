# Project Development and Review Workflow

## Roles

- **Owner assignment — 20 October 2026:** from this date, **Codex implements** every project change; **Qwen Flash is backup only when Codex is out of usage**. **Claude assigns precise rounds, reviews, independently tests with mutation checks, and merges** after GREEN review and green exact-head CI, using `--match-head-commit` and verifying inclusion on main. UI rounds also require a browser-mode walkthrough with Playwright and the `run` skill. Claude may implement directly only from 2:00 to 3:00 AM on 20 October before the weekly usage reset. This assignment replaces the earlier arrangements retained below as history.

- **Claude** implements roadmap features in the agreed local clone or worktree. Claude leaves changes uncommitted and unpushed for review.
- **Gemini** handles security hardening or a focused security audit only when explicitly assigned. Gemini does not independently start roadmap features.
- **Codex** is the senior software developer and final independent reviewer. Codex owns technical direction, review quality, scope control and delivery pace within the owner's priorities, and gives the assigned implementation model clear, complete tasks. When the work is ready, Codex commits, pushes, opens the pull request, watches required checks, and merges.
- **The project owner** chooses roadmap priorities and can override this division of work.

## Precision and delivery pace

Work must be precise, and the project must make steady progress. Codex uses senior engineering judgment to balance correctness, risk and delivery speed.

- Define the acceptance criteria and required verification before implementation. Keep each task focused on a useful project outcome.
- Give substantial implementation work to the assigned model. Keep independent review focused on the actual changes and their relevant effects; avoid duplicating implementation work.
- Consolidate confirmed defects into one clear correction handoff whenever possible. Each blocking finding must have concrete evidence, a triggering scenario and meaningful impact. Record nonblocking observations separately so they do not delay acceptance.
- Preserve accepted work. Re-review corrected areas and relevant consequences instead of reopening settled decisions without new evidence.
- Run checks proportional to the change. Reuse valid evidence for unchanged areas; repeat or broaden tests only when changes, failures or unresolved concerns justify it. Keep every applicable security, data-integrity, compatibility and release gate.
- When acceptance criteria and required checks pass, accept, integrate and move to the next authorized roadmap task. Avoid speculative polishing, duplicate reports and unnecessary approval requests that delay delivery.
- Provide model-neutral, copy-ready prompts in chat or direct the selected model to the detailed GitHub assignment. Make the scope, expected result and stopping point clear so any owner-selected model can continue efficiently.

## Start each task

1. Confirm the exact repository path, branch, base commit, and working-tree status.
2. Reuse the agreed clone or worktree. Do not create another checkout without a reason.
3. Read the relevant roadmap, design notes, repository instructions, and existing implementation.
4. Define a small release with clear acceptance criteria. Keep unrelated work out of the branch.
5. Preserve existing changes made by another person or agent.

## Implement locally

Claude builds the feature and adds tests for meaningful behavior, failure cases, and permissions. Database changes must include safe migrations and consistent schema snapshots. Desktop and hosted modes must each be considered where applicable.

While developing, run focused checks first. Fix known failures locally before running the complete verification matrix. Do not push speculative changes just to learn what CI reports.

## Independent review

Codex reviews the actual diff and current code, not just the implementation summary. The review checks:

- Whether the feature meets its acceptance criteria
- Authentication, authorization, and cross-workspace isolation
- Data integrity, migrations, rollback, concurrency, and idempotency
- Desktop behavior, including offline use and test-data isolation
- Error handling, limits, accessibility, and documentation
- Whether tests prove the important behavior rather than merely exercising code

Codex reports confirmed defects with exact file references, a triggering scenario, impact, and a focused fix request. Plausible risks are labeled separately. If corrections are needed, Claude fixes them locally and Codex reviews the changed areas again.

After each review, Codex provides a precise, copy-ready prompt for the next assigned task or correction.

## Local verification gate

Run the checks relevant to the change: typecheck, lint, focused unit tests, SQLite repository and migration tests, browser or desktop checks, production builds, and `git diff --check` where applicable. Desktop data lives in SQLite; browser mode uses sql.js. This project does not require a PostgreSQL service or a PostgreSQL CI job.

Reuse valid receipts for unchanged source and run focused regressions for corrections. Run the applicable full local gate once when the implementation is ready; repeat or broaden it only for changed behavior, a failure or an unresolved concern. Required exact-head CI remains the final merge gate. Do not start duplicate services or overlapping full test matrices. Record exact commands, exit codes, and test counts. Distinguish tests actually run from results reported by another agent.

Tests must use disposable databases and profiles. Never let a test write to the owner's real application data. Do not delete suspected test data from a real profile without the owner's explicit direction.

## GitHub Actions efficiency

GitHub Actions is the final confirmation gate, not the debugging environment.

- Aim for one reviewed push and one CI run.
- Cancel superseded runs.
- Skip expensive jobs for documentation-only changes when safe.
- Use one supported Node version for normal pull requests.
- Keep SQLite repository, migration and backup/restore coverage in the existing checks workflow; do not provision an unrelated database service.
- Keep Windows jobs focused on genuinely Windows-specific behavior.
- Do not weaken security, migration, database, desktop, or tenant-isolation coverage to save minutes.
- If CI fails, inspect the failed step, reproduce it locally where possible, make the smallest justified correction, and push that correction once.
- Rerun a transient infrastructure failure only after confirming why it is transient.

## Release and merge gate

Codex may commit and open a pull request only when:

- The branch contains only intended changes.
- The independent review has no release blockers.
- The required local verification is green.
- Migrations, snapshots, lockfiles, and build configuration are consistent.
- No tests have modified real user data.

Codex merges only after required GitHub checks pass and the pull request is current with the default branch. After merging, Codex confirms the PR is marked merged, the default branch contains the change, and the local checkout is clean and synchronized. The completed feature branch or worktree can then be removed when safe.

Start the next roadmap release from the updated default branch.
