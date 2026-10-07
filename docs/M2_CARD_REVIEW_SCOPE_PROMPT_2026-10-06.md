# M2 card review queue and open-source scheduler evaluation — model-neutral assignment

Date: 6 October 2026. Role: owner-selected implementer. Deliver a concrete, reviewable next increment at a good pace. Any model can execute this prompt. Codex remains senior reviewer and Git coordinator.

## Outcome and authority

Saved/resumable single-material practice and explicit history erasure are now independently source-reviewed in [PR2 acceptance](M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md). The containing source PR must be merged with its exact-head checks green before you start. This assignment replaces the finishing-correction prompts for the next task; do not reopen R1–R14 or continue an old controller branch.

Prepare the next **M2-3 card review scope**, with an executable disposable scheduler proof and focused open-source evaluation. Finish the proposal and recommended defaults before asking the owner to approve production scope. Existing M2 practice-test approval does not approve new card persistence, scheduling defaults, migration or a new dependency. This task authorizes planning and an isolated proof, not changes to shipped application code or dependencies.

The existing accepted open-source Zod integration already powers study-packet validation. Evaluate a maintained FSRS implementation as a potential next library without claiming it is installed or approved. ROADMAP section 7B and the M2 design require deterministic, versioned simple scheduling first; explain whether the evidence supports staying with that default or requesting a separately reviewed FSRS exception. Neither option may claim measured mastery, official FAA results, flight readiness or a prediction of test success.

## Start once, preserve other work

Use `/Users/rickymac/code/Flight-training-pr70-integration`, the Mac implementation checkout. Inspect status, branch and current main. Codex may have preserved the old submission in a recoverable stash/ref and synchronized the checkout after integration. Do not apply that stash, reset dirty work, delete evidence, or modify the separate primary clone. Fetch and confirm merged PR2 by its acceptance report, `usePracticeMetadata.ts`, permanent read-recovery tests, durable panel/history and atomic erasure support. Do not assume an old short hash is current.

If the checkout is clean, create/reuse `codex/m2-card-review-scope` from current main. Stop only before overwriting unexpected competing work on affected paths. Report what conflicts, continue independent research, and do not wait for a new check-in: the owner waiver still applies. Do not start a second implementation task in parallel.

Read relevant repository instructions plus only the current ROADMAP section 7, `M2_STUDY_LIBRARY_DESIGN_2026-09-27.md`, practice scope/approval and PR2 acceptance. Inspect actual flashcard storage in `ai_study_sets`, imported and generated card shapes, generation replacement, document deletion, backup validators and repository/native transaction conventions. Migration 11 belongs to practice sessions; the old design's references to a future migration 11 are historical. Identify the next available migration from current main without writing it.

## 1. Specify the user's smallest useful card-review flow

Work inside the existing Study Library. Describe first exposure, flipping a saved card, selecting Again/Hard/Good/Easy, returning later to Review due, reviewing history, suspension/resumption and flagging questionable content. Keep saved guides/cards/practice offline without credentials and without a Gemini call. Make the before/after example concrete using a synthetic imported material with three cards.

Keep this increment about single-material saved cards and a bounded due queue. Decide whether a minimal Library/Review due/History navigation is essential now or belongs to M2-4. Avoid a separate study application, multi-material quiz generation, provider work, FAA/weather APIs, source viewer, mobile or release scope. Existing practice attempts/results remain independent from card ratings.

Define review outcomes honestly: a rating schedules another review; it is not an objective correctness result. Distinguish new, due, suspended, flagged and malformed cards. State what users see when there is no content, all work is suspended, reads fail, a write is unconfirmed or the clock has moved backwards.

## 2. Ground identity, persistence and retention in accepted code

Propose versioned card/item identity so array indexes or `updatedAt` cannot attach old reviews to new text. Define the exact source mapping for existing generated/imported flashcards, malformed legacy handling, collision rules, and regeneration or edit behavior. Never manufacture past ratings from quiz totals or assume practice question IDs are card IDs.

Sketch the minimum schema, typed read/write payloads and result/error shapes. A rating needs a UUID operation ID and exact retained payload. The immutable event and current scheduling projection must commit atomically on a dedicated native connection and the existing browser transaction owner. A retry of the same request applies once; changed-input ID reuse conflicts. A stale expected revision requires read/refresh and a new deliberate action. Unsupported drivers refuse before writes.

Describe lost acknowledgement, refresh failure after acknowledged write, restart without pending in-memory IDs, duplicate clicks, queued writes and route/unmount ownership. Reuse the accepted operation and recovery principles; do not copy the large practice controller into a new component without justification.

Specify card deletion, material deletion, regeneration, explicit erasure and old-backup boundaries. Recommend coherent defaults but do not silently extend practice Policy A to all card content. State which historical text would remain, how disconnected source links work, and what tombstones are needed to prevent late replay from restoring erased content. Explain compatibility with existing archive/startup validation and old backups. Shipped migrations/checksums stay immutable.

Provide paged reads and indexes for due cards/history. Do not load every review event into AppDataContext. Identify the narrow production files that the later approved implementation would touch.

## 3. Evaluate scheduler behavior and open-source fit

Use current **primary sources**: official project repository, published package metadata/tarball, license and upstream documentation. Record retrieval date, exact candidate version, license text/attribution obligation, direct/transitive dependencies, supported runtime/bundle behavior and published integrity. Verify facts rather than repeating a model's package/version guess. Use the existing toolchain and avoid adding broad new tooling.

Compare the roadmap's small deterministic scheduler with one credible maintained FSRS candidate (for example, examine `ts-fsrs` if it is still appropriate). Cover Again/Hard/Good/Easy mapping, first exposure, minimum/maximum intervals, overdue work, learning steps, scheduler parameter/version serialization, deterministic operation under injected time, and upgrading older scheduled state. Document any randomization and whether it can be disabled/reproduced. No automatic parameter optimization or personal history upload in the initial scope.

Discuss Apple Silicon/Tauri webview and browser-test compatibility, offline behavior, network effects, package size evidence and distribution notices. Inspect license and implementation for network access instead of assuming a small library has none. Do not present a scheduling formula as a validated aviation training method.

Conclude with a recommended choice and the reasons. An FSRS choice requires an explicit owner/reviewer decision replacing the deterministic-first default. If licensing/behavior cannot be verified, say precisely what is missing and retain the deterministic default; do not block the rest of the scope.

## 4. Build one bounded disposable proof

Keep executable proof under a new evidence directory or `/private/tmp`; production `package.json`, locks, application code, migrations, workflows and capabilities remain untouched. If installing the candidate is necessary, use an isolated pinned scratch package with its own lockfile. Preserve the small lockfile and meaningful runner/fixtures as evidence; do not commit node_modules, caches, copied upstream source trees or build output.

Use injected timestamps and synthetic cards to prove first use, all four ratings, a repeat failure, overdue review, suspension/resumption, local midnight, timezone change and clock rollback. Separate stored absolute due instants from local calendar display. Specify nonzero minimum and bounded maximum intervals. Check identical input/clock/config produces the same output and exact same-ID replay semantics at the proposed contract boundary. Clearly label pure simulations versus real persistence guarantees: an isolated scheduler proof does not establish native atomic writes or installed behavior.

Add only tests that distinguish a real design choice or failure mode. No stress matrix, mutation quota, whole-app regression rerun or packaging. Run the proof once after meaningful changes settle, record actual command/exit/counts and preserve any failed attempt. Do not suppress errors or tune timeouts simply to create green evidence.

## 5. Deliver one approval-ready package

Write `docs/M2_CARD_REVIEW_SCOPE_2026-10-06.md` with the user flow, exact contracts/schema sketch, recommended defaults, exclusions, compatibility, library evidence, acceptance cases and proposed implementation slices. Include a compact owner decision table with a recommended default for every material choice: card retention/erasure, content version replacement, scheduler/simple-versus-FSRS, initial intervals/configuration, due ordering/timezone, and suspended/flagged behavior. Explain whether approval of all defaults is enough to start the first source slice. Do not scatter questions across the report.

Write evidence in `docs/evidence/m2-card-review-scope-2026-10-06/`: README, primary-source URLs/date/version/license summary, proof runner/fixtures, raw command receipts, result summary, source/proposal hashes and a separate evidence manifest. Keep raw-log whitespace allowances local. A package lock is an isolated research artifact, not a production dependency adoption.

Prepare a full **model-neutral conditional implementation prompt** for the first practical source slice. Make its activation depend on explicit approval of the reviewed scope/defaults; include exact target files/contracts, migration allocation, native/browser ownership, recovery cases, test expectations and stop conditions. Aim for a useful end-to-end increment, not empty abstractions or a migration-only branch with no user path. If two source slices are necessary, explain the dependency and use one active branch at a time.

Update STATUS and PROJECT_HANDOFF to say **scope/proof prepared, pending review and owner production approval**. PR2 acceptance remains intact; M2 as a whole is not finished. Four installed Mac observations, signing credentials/lane/version decisions and release gates remain unresolved. Leave work uncommitted/unpushed for Codex; no app launch against owner data, profile/account test, provider calls, signing, packaging or release. Return the recommended defaults, actual proof results and precise next action.
