# Prepare the first durable practice-session scope — model-neutral assignment, 4 October 2026

**Initial draft submitted; use the active correction assignment:** [M2S-R1–R3 review](M2_PRACTICE_SESSION_SCOPE_REVIEW_2026-10-04.md) and [one correction prompt](M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md). Do not restart the broad proposal or begin implementation.

Any implementation model selected by the owner may complete this assignment. Use one active implementer. Codex is the senior reviewer and Git coordinator.

## Outcome

Produce **one concrete, owner-reviewable scope for saved and resumable practice tests**, building on accepted Slice B. This is the next M2 planning increment, not permission to implement migrations, attempt history or a new dependency. Avoid another broad architecture report: reconcile the existing M2 design with the source now on main, then make the minimum useful next implementation ready for approval.

The owner has waived the real-user check-in; do not ask for it again or invent test observations. The owner approved Slice B/D1–D9, not the remaining M2 retention/migration decisions. Installed/signing/release gates remain separate and do not prevent this source-level scope preparation.

## Start and preserve work

1. Confirm the current repository, branch, status and published main once. Read `docs/STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md`; confirm its source PR is merged before relying on it as main.
2. The implementer checkout at `/Users/rickymac/code/Flight-training-pr70-integration` retains the reviewed uncommitted Slice B handoff. Do not reset, clean, pull, switch branches or overwrite it. Codex will coordinate cleanup; if it is still dirty, create the planning documents separately under a task-specific temporary directory and return their exact paths for review. Do not create another worktree merely for a proposal.
3. Read current main through read-only Git commands or GitHub when local files are stale. Preserve the dirty primary Mac checkout. Do not edit existing source, lockfiles, migrations or release configuration.

## Read only the relevant existing foundation

- `ROADMAP.md`, M2 section.
- `docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md`: proposed content identity, attempts, retention and staged delivery.
- `docs/M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md`.
- Slice B acceptance and owner approval; A2 persistence interfaces.
- Current `PracticeTestPanel.tsx`, MaterialDetail, document repository, domain types, migrations 7/9/10, database adapters and backup validation/restore contracts.
- `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md`: durable identity/history precede scheduling. No FSRS, Markdown, search or viewer dependency adoption is assigned.

Do not repeat completed import or release-preparation audits and do not reread every historical review.

## Proposed first user outcome

Use existing saved tests from both Gemini and imported packets. Start one material’s practice test, answer some questions, close/reopen, resume without losing responses, finish once and see a trustworthy practice result. Retake creates a separate attempt. Preserve the exact tested content when the active test is later regenerated. Treat “I don’t know”, unanswered and wrong answers distinctly.

Decide whether this fits one safe source increment or requires two tightly connected PRs (identity/migration, then attempt UI). Explain the concrete tradeoff; avoid an open-ended multi-month plan. Keep flashcard scheduling, multi-material sessions, voice coaching, proficiency claims, source navigation and replacement import deferred.

## Make the proposal implementable

Write `M2_PRACTICE_SESSION_SCOPE_2026-10-04.md` with:

1. A short before/after example and explicit included/deferred behavior.
2. A compact owner decision table with recommended defaults and consequences. Cover deletion/retention, regenerated test history, one-material sessions, legacy corrupt content handling and practice-result wording. Do not silently approve the defaults.
3. The smallest proposed additive schema and identity model, reconciling the actual latest schema rather than assuming a migration number. Preserve shipped migrations. Explain content-version/question identity for both import and Gemini, restart/restore stability and legacy conversion failure behavior.
4. Native/browser atomic contracts for start, save response, resume, completion and retake: operation identity, strict validation, bounded contention, rollback/durability, exactly-once completion and immutable result snapshots. Reuse A2 patterns; avoid unrelated persistence refactoring or trusting a client score/hash alone.
5. A minimal accessible UI flow in the existing material page, including honest incomplete states, retries and safe navigation. Keep the current import/Gemini behavior intact.
6. Backup/restore and deletion behavior: authoritative new tables, validation, FK policy, old archive handling and unsupported downgrade disclosure. Do not invent compatibility with older binaries.
7. A requirement-to-test table covering interrupted resume, duplicate clicks/retries, partial-write rollback, regeneration/version isolation, deletion policy, corrupt legacy data, imports and Gemini, offline/no-key use, backup round trips and keyboard access. Distinguish source fixtures from installed observations.
8. A short first implementation assignment with exact expected files/interfaces, acceptance criteria, verification gate and stopping point, conditional on explicit owner scope approval.
9. Only genuine unresolved decisions. Each question must identify why the answer affects data or behavior; make routine implementation choices yourself.

Keep the main proposal readable in roughly two pages; use a technical appendix only for schema/contracts and test mappings. Suggested schema/SQL is documentation, not a shipped migration. Synthetic example payloads may be included in the appendix; no app launch, user profile or production writes.

## Verification and handoff

This task changes documentation only. Verify links, agreement with current source and plain-language decision consequences. No full frontend/Rust matrix or application rebuild is needed. Do not make unsupported library/API claims; consult official documentation only if the proposal depends on an uncertain external fact.

Return the proposal path, main source identity used, a brief owner decision summary and the conditional first implementation scope. Leave documents uncommitted/unpushed for Codex review. Do not start the conditional implementation, publish a release or send another agent a task.
