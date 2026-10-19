# Implement owner-approved manual offline study — OFFLINE-03a, then 03b

## Objective and authority

Implement writing and editing study guides, flashcards and practice questions without Gemini. Complete one coherent slice at a time. The owner approved all five defaults on 19 October 2026; see `docs/OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md` §4 and `docs/OFFLINE_03_COMPLETION_HANDOFF_2026-10-19.md`.

Read the full proposal, the offline-study/homework/export roadmap, current ROADMAP, STATUS and PROJECT_HANDOFF first. The proposal is the detailed contract, including revision 4’s retirement overflow policy. Claude’s revision-3 GREEN review is preserved with its original scope; do not describe it as acceptance of later implementation.

The proposal-completion branch is `codex/offline-03-handoff-completion`, worktree `/Users/rickymac/code/Flight-training-offline-03-completion`. Fetch, inspect its PR/review state and verify the completion source manifest. The new search-link correction still needs independent review and exact-head CI. Integrate through the normal reviewer workflow before starting a feature branch based on it; do not copy unmerged fixes or overwrite another agent’s checkout. If already integrated, start a new `codex/` or model-specific feature branch from current accepted main in an isolated worktree.

This assignment authorizes implementation, not self-acceptance, merging or releasing. Do not launch desktop builds, access real profiles or keys, invoke Gemini, enable extraction/search, or change a release workflow. Native/source tests may run in disposable synthetic databases.

## 03a: creation, editing, history and provenance

1. Inventory every guide/card save, mapper, display, export, regeneration and snapshot reader before changing the contract. Use the actual source. Primary areas include `src/domain/types.ts`, `src/data/repositories/documentRepository.ts`, `src/logic/cardIdentity.ts`, `src/data/cardReviewTransaction.ts`, `src-tauri/src/card_reviews.rs`, `src-tauri/src/backup.rs`, material-page components and study-export helpers. Locate provenance/import paths by symbol, not guessed filenames.
2. Add migration **0016 once**, after checking no competing migration has landed. Include the proposal’s history/origin tables, two study-set columns and nullable bookmark quote column reserved for later use. Keep migrations 0001–0015 and their checksums byte-identical. Register 0016 in native and frontend migration/checksum/restore validators. If 0016 has been allocated meanwhile, reconcile numbering before editing.
3. Support creating a wholly manual set on a material with no generated set, and editing existing summary/sections/cards. Retain base provenance of untouched generated/imported items. Give manually created/edited items truthful user/instructor origins; never fall through to Gemini wording. Summary identity is scoped to its material and stored separately from its plain text.
4. Use atomic repository operations: retain the previous full set plus origins and retirement metadata before any overwrite in the same transaction. Preserve every intermediate version whether or not cards were reviewed. Include explicit “Previous versions” restore behavior; restoring an old version must first preserve the current one and retain provenance. No history is silently lost by delete, correction, regeneration, import or restore.
5. Stable item identities support correction/replacement and deletion records. At 2,000 retirement records, deduplicate exact records and reject overflow atomically without eviction or draft loss; unrelated edits that do not grow that list remain possible. Keep retirement normalization/term selection deterministic and shared across any implementations. Preserve the original text in history, not only its digest.
6. Regeneration/import replacement must run through a plain preview and the preservation contract. Keep her items by default. Hold exact retired-text repeats back; block unresolved near-matches pending her choice; disclose that heavier paraphrases can escape matching. Provide keep/replace/cancel choices without saving before confirmation. Do not send personal edits/history to a provider as a side effect of reconciliation.
7. Preserve existing review snapshot hashes for legacy cards. Origin-bearing canonical fingerprints must agree in TypeScript, Rust and backup validation. Keep content-derived snapshot identities unchanged as an algorithm. Use side-table origins for truthful manual/mixed labels; the legacy provider CHECK must remain intact. Audit every reader so the compatibility placeholder is never presented as the true author of a manual item.
8. Exclude instructor corrections from exports by default; a deliberate inclusion switch applies before serialization. Handouts label origins. Packet v1 strips unsupported metadata and discloses label loss before export; do not weaken its strict validator or introduce v2.
9. Drafts survive failed saves, buttons block duplicate writes synchronously, cancel writes nothing, and retry never duplicates an acknowledged mutation. Use existing error codes/transaction patterns. Do not add dependencies, rich text, OCR or offline models.

## 03b: manual practice questions

Only start after 03a has been reviewed and integrated; do not stack an unreviewed implementation by copying its source.

Extend the frontend/native IPC, validators, atomic saves, content hashes, origin side table, mappers and history/export readers together. Allow creating and editing questions without Gemini. Practice edits create new immutable versions; existing attempts keep their original questions, options, answers and provenance. Regeneration/replacement must preserve manual questions and recorded corrections under the same deliberate-choice/history rules; do not silently fall back to a hard-coded Gemini provider. Confirm the exact representation and validation against the already merged 0016 schema before writing code.

## Required acceptance matrix

- Fresh manual set; edit a generated/imported summary, section or card; mixed user/instructor origins; old data unchanged before first edit.
- Every visible/exported origin truthful, including review snapshots and historical attempts.
- Full previous state recoverable before edit/delete/correct/regenerate/import/restore; injected transaction failure rolls back both active data and history.
- Retirement counts 1,999→2,000; duplicate at 2,000; overflow refusal; cancel/failure no partial history; no automatic truncation.
- Exact repeat, near repeat, unrelated candidate, explicit bring-back, keep/replace/cancel, and restart after a failed save.
- Shared independent golden vectors for legacy and origin-bearing fingerprints; native/browser agreement; tampered side-table origin rejected on restore.
- Populated schema15→16 migration; backup/restore preserves new data; earlier supported backups migrate; existing migration/ledger validation remains strict. Preserve the schema14 helper’s historical scope rather than rewriting its evidence to claim schema16 coverage.
- Instructor corrections excluded by default, included only deliberately, and packet v1 round-trips without unknown fields while visibly losing author labels.
- 03b: old attempts remain unchanged after editing; source/current-test deletion and history erasure retain their established behavior; rejected saves never advance versions.
- Native extraction/search flags and release workflows remain off; reserved quote column does not enable 03c.

## Verification and delivery per slice

Use Node22, and the repository’s scoped Rust toolchain/SDK26.5 precedent for native checks. Run meaningful focused regressions first; demonstrate that each defect regression fails on its actual pre-fix source. Then run sequentially: typecheck, full frontend tests (zero unhandled errors), frontend build, native tests, strict Clippy, fmt, cargo-lock consistency, migration immutability/checksum checks and diff hygiene. Inspect scripts/workflows for the current exact commands. Do not run competing full suites or repeatedly rerun a known unrelated flake until it passes. Record it and establish its baseline separately.

Reuse valid 02a/02c measurements if the index/search implementation is unchanged. No new performance-budget relaxation. Keep the recorded 02c common-word p50 miss and FLAKE-CR-01 open unless independently resolved in a separate bounded change.

Preserve raw logs with exit codes, failed attempts and exact source hashes. Publish a report and reviewer prompt with file/behavior mapping, migration details, test results and explicit installed/unverified limits. Update roadmap/status/handoff by adding a current entry while retaining history. Commit only owned paths; inspect the staged diff for secrets, synthetic fixtures and accidental generated files. Open a PR and attach it to the chat when tooling supports that. Do not self-merge. The reviewer must inspect actual source and green CI for the exact submitted head. A new pushed head requires current CI.

Stop each slice with a precise handoff: branch/head/base, changed paths, test counts/exits, open defects, review status and the next authorized slice. If usage runs low, save a checkpoint with the unfinished failing command and exact resume steps; do not claim completion or acceptance.
