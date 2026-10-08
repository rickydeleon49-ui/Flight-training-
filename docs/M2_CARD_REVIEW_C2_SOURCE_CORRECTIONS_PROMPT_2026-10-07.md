# C2 production source corrections — model-neutral continuation

You are implementing a bounded correction round for Her Flight Deck, a Tauri desktop app with a React/TypeScript frontend and SQLite/Rust storage. Work precisely and keep pace. The owner approved C2-D1 through C2-D9. C2 planning proof is accepted; production source is pending independent review. Correct C2SRC-R1 and C2SRC-R2, prove the fixes, then stop for review.

## 1. Preserve the reviewed start

Use `/Users/rickymac/code/Flight-training-c2-implementation`, branch `codex/m2-card-review-c2-implementation`, HEAD/base `cc84964737067cfa5fa5ed20ddf125a74b10b003`. The implementation is intentionally uncommitted. Do not reset, stash, pull over it, recreate it from main or copy unrelated dirty clones. Before editing, verify all 30 files against `docs/evidence/m2-card-review-c2-implementation-2026-10-07/source-hashes.json` (structured `files` object), plus its SHA256SUMS. If a file differs, report the exact competing changes before touching it; preserve other agents' work.

Fetch origin to read the latest reviewer documents without applying them over the dirty tree. Read these from origin/main if absent locally:
- `docs/M2_CARD_REVIEW_C2_SOURCE_REVIEW_2026-10-07.md`
- `docs/M2_CARD_REVIEW_C2_SOURCE_CORRECTIONS_PROMPT_2026-10-07.md`
- `docs/evidence/m2-card-review-c2-source-review-2026-10-07/diagnostics/C2SourceReviewDiagnostic.test.ts`
- The submitted REQUIREMENTS.md and README.md.

The reviewer pack contains the exact 30-file source snapshot if recovery is needed; do not overwrite changed work with it. Leave all earlier evidence immutable. Borrow existing dependencies only if lockfiles match and disclose/remove any temporary symlink before handoff. Use the already working Mac toolchain/SDK configuration; no global toolchain or account changes.

## 2. Reproduce all three frozen cases before editing

Copy the frozen diagnostic byte-for-byte into `src/pages/StudyLibrary/C2SourceReviewDiagnostic.test.ts` and run it. Expected baseline: three assertion failures, exit 1, no unhandled errors. Two cases reproduce R1; one reproduces R2 through visible user controls. Keep the baseline output and raw exit. Do not weaken, rename or rewrite the frozen diagnostic to fit the implementation. Remove its temporary source copy after final verification; retain the frozen evidence copy.

## 3. C2SRC-R1: reliable invalidation, without expensive render work

At `StudyLibrary.tsx:78–84`, count plus timestamp is not content identity. The concrete baseline changes two old cards into two different cards with unchanged count and clock using `AppData.mutate`/`saveAiStudySet`. The reader returns 2 new cards while the mounted due UI remains 1 due / 1 new; the history list fails to mark the old rating as earlier-version.

Provide a reliable signal for a newly published authoritative data snapshot. A monotonic AppData publication revision is an acceptable approach; justify its read scope if it invalidates on unrelated mutations. Advance it only with the snapshot that actually wins publication, so obsolete loads cannot roll current data backward. Thread it through due, history and binder invalidation. Alternatively use a content-sensitive revision with the same guarantees. Do not stringify/hash full card payloads repeatedly during render, change the bounded reader budgets, depend on timestamp uniqueness or add a timeout/delay.

Cover a same-count/same-timestamp replacement, a successful state-only review mutation followed by AppData publication, and an authoritative refresh/restore-like replacement retaining saved metadata. Include a held old read completing after the new signal: it must not republish stale rows, provenance, badges or clear the new operation's ownership. Reuse the existing stream generation/operation-token mechanism; do not invent a second competing controller.

## 4. C2SRC-R2: reconcile the selected history record

`StudyLibraryHistory.tsx:85` stores a copied row that outlives changes to stream rows. The natural repro begins Check versions, opens View card while that read is held, then completes it. The list resolves the version but the dialog retains the pending label.

Use event-ID selection and derive the displayed row from current stream state, or an equally explicit reconciliation policy. Keep historical question/answer text exactly as reviewed; current card text must never replace it. If the selected event is absent after an authoritative invalidation, filter change, deletion or refresh, dismiss the viewer. A stale completion must not reopen a dismissed viewer. Closing on invalidation/enrichment instead of retaining the viewer is acceptable if behavior is consistent and covered. Preserve dialog focus/accessibility behavior and read-only operation.

Add permanent tests for the frozen pending-to-resolved flow and a disappearing selected row with a held read. Keep both controls in the repro visible/enabled; do not click a hidden background control behind an open modal to claim a real UI flow.

## 5. Evidence and gates

First show all three frozen diagnostics pass verbatim against final source. Promote the behaviors into permanent tests and include the extensions above. Where practical, demonstrate a focused permanent case fails when its essential fix is reverted in an isolated scratch copy; do not add another large mutation campaign.

Run focused affected frontend suites and typecheck during development. After source settles, run one complete sequential gate: typecheck, frontend tests with zero unhandled errors, build, Rust tests, Clippy with warnings denied, fmt, cargo-lock, whitespace/scope checks and unchanged migrations 0001–0012/checksum registry. Keep raw output and exit files. Do not rerun unchanged planning-proof diagnostics; verify their immutability/checksums instead. Rerun only when a source change or failure justifies it.

Write a new evidence pack `docs/evidence/m2-card-review-c2-source-corrections-2026-10-07/` with baseline/final frozen diagnostic receipts, requirement-to-test mapping, final gate receipts, exact changed-path explanation, a new source-hashes.json and SHA256SUMS. Retain the original implementation and reviewer evidence byte-for-byte. Explain whether the chosen publication signal causes additional bounded reads and why that is acceptable. Update STATUS.md and PROJECT_HANDOFF.md to “C2SRC-R1/R2 corrected, pending independent re-review,” never accepted.

## 6. Handoff and scope

Leave changes uncommitted and unpushed for independent re-review. Report actual HEAD, branch, all changed/untracked paths, source/evidence hash counts, test totals and any limitations. Do not start another feature, redo planning, add dependencies or migrations, alter native budgets/semantics, use real personal data, run an installed app, sign or publish a release. No new owner approval is needed for this bounded correction round. Stop once the evidence is complete and reviewable.
