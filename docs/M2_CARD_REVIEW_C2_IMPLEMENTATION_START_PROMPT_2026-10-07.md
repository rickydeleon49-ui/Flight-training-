# M2 Card Reviews C2 — Conditional production implementation start (7 October 2026)

You are the owner's selected implementation model. Read [C2 scope-proof acceptance](M2_CARD_REVIEW_C2_ACCEPTANCE_2026-10-07.md), [the complete scope/defaults](M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md), and [the complete conditional implementation assignment](M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md). Earlier proof-correction prompts are historical. The accepted proof requires no further correction round.

## Activation and starting state

Independent scope-proof acceptance is recorded. Production work still requires the owner to approve C2-D1–D9. Look for direct owner authorization in the current session or a trusted recorded approval; do not infer approval from proof acceptance or a model's claim. If authorization is absent, present the nine defaults from the acceptance document and stop before production edits. Do not run more preparation audits or test suites while waiting.

After approval, record the exact owner decision in the work package before code. Do not ask for the same approval again. Preserve C1 acceptance and the real-user check-in waiver; new signing/release work is outside this assignment.

The old dirty planning clone is `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Do not pull/reset/stash/switch/rebase or write implementation over that submitted work.

Use a suitable clean isolated worktree from current `origin/main`, branch `codex/m2-card-review-c2-implementation`, after checking for competing implementation work. Record exact base SHA and changed paths. The accepted proof and all nine immutable submitted packs are now in GitHub; preserve them. Follow repository workflow/AGENTS instructions and keep credentials/real account data out of the work.

## Complete the approved C2 source package

Follow the full conditional assignment for library Review due, History and binder indicators. Implement the complete bounded reader/controller/UI flow, not only a prototype or static screen:

- Share existing production card identity, C1 validation, scheduler and local-day helpers. Reads remain read-only. Discover valid unmaterialized current cards as well as reviewed materials; do not trust cached active-version flags.
- Due filters/ranking are evaluated against current content and exact captured clock. Bound candidate discovery and pending continuation; validate complete owned cursor shape before database work. Preserve eligible candidates through page-size changes and discard deleted/empty/ineligible ones without duplicates or skips.
- Apply byte preflight before transfer and conservative work reservations before raw parsing. Failed attempts remain charged; successful valid sets reconcile to actual card count. Share history targets/page-member accounting, avoid duplicate raw reads, preserve unread work, and retain the absolute 8 MiB ceiling and terminating single-set exception. No new migration/index/dependency, cache table, persistent backfill or provider request.
- History keeps unique event IDs, genuine version provenance, raw audit data and nullable validated scheduler fields. Filters precede event LIMIT. Enrichment targets remain filter-owned, bounded and independent of page membership. Enrichment-only issues no event paging, preserves cursor/order, and provides fair pending progress even after pagination ends.
- Build generation/operation-owned page and enrichment actions with synchronous duplicate exclusion and a single discriminated failed-read descriptor. Capture immutable dispatch options and retry that exact failed read; authoritative invalidation clears obsolete state. Old completions must not publish or clear a newer lock.
- Unknown pending identity stays unknown; readable current identity compares against each event version. Publish complete status/reason/inspection actions, clear obsolete blockers on resolution, and exclude permanent oversize from automatic Retry. Preserve resolved untargeted fields within the live generation.
- Use existing encoded `/study/<id>` inspection destinations and an actual read-only historical card viewer. History inspection must not start a mutation/provider call. Keep card ratings and practice scores separate.
- Finish URL-synchronized Library / Review due / History navigation and compatibility behavior. Provide honest loading, bounded-scan progress, pending/blocked and error states. Only show caught-up when traversal is exhausted, actionable results empty and no blocked issues remain.

## Precise documentary handoff requirements

The accepted proof exposes history `rawReads` and `rawBytesTransferred`; `rawAttempts`/`cumulativeRawBytes` are internal variables. Use coherent exported types and names across frontend/native/browser readers.

Its controller `summary` holds the latest page only. Production UI must expose enrichment-call progress separately or explicitly publish the latest owned read summary, and distinguish it from cumulative loaded-view counts. Never label page counters whole-library totals. Filter/content/reset/delete/restore/clock invalidation clears obsolete provenance and issues.

The proof stores failure options but Retry currently uses live options. Implement true request-snapshot retry in production, preserving the supported filter/reset ownership behavior; do not copy that incomplete documentary behavior mechanically.

Accepted SQL fixture counts are due 175/150/177, history 22/22/22, enrichment-only 3 and combined 24. These are measured fixture receipts, not required production query counts or a three-statement promise. Preserve performance bounds and report actual production executions. Existing component twins are approximate; desktop IPC/WebKit is unmeasured until actually tested.

## Verification and delivery

Plan and implement meaningful production regressions for real native/browser read adapters, typed services, controller and affected UI. Carry forward all accepted boundary behaviors, including failed reservations, oversize metadata, cursor validation/filter matrices, current-version drift, mixed-size admission, previous-page/terminal-page enrichment, raw-call deduplication, pending progress, held stale requests, Retry operation transitions, genuine React StrictMode and navigation/unmount ownership.

Run focused checks while implementing, then one appropriate sequential final gate: typecheck, frontend tests with zero unhandled errors, build, affected native tests and required Rust formatting/lint/lockfile checks. Reuse unchanged evidence only when its source identity is applicable. Keep schema 0001–0012 and registry unchanged. Use the reviewed scoped Mac/Xcode toolchain; a synthetic test is not installed/VoiceOver/Gatekeeper verification. No real user profile or app installation/signing/release work.

Create a new source implementation report/evidence pack with exact scope/finding/test mapping, command/cwd/toolchain/output/exits, limitations, four updated live delivery-document snapshots where applicable, source hashes and SHA256SUMS. Preserve all nine planning packs unchanged. Update STATUS/handoff to “implemented, pending independent source review,” not released or accepted.

Complete all approved C2 work in the package, leave source changes uncommitted/unpushed for the independent reviewer, report exact branch/base/HEAD/staging state, and stop for review. Do not start a new roadmap item, publish a release, or rerun completed proof preparation merely to fill the session.
