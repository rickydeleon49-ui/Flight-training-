# M2 split lineage — independent production source review

You are the independent senior reviewer for Her Flight Deck, a Tauri 2 Mac app with a React/TypeScript frontend and SQLite/Rust storage. Review the uncommitted split-lineage implementation, decide whether it can be integrated, and either accept it or specify bounded corrections. You review; you do not fix production code. Work precisely and keep pace.

## 1. What to review, and what must stay untouched

- **Worktree:** `/Users/rickymac/code/Flight-training-split-lineage-implementation`, branch `codex/m2-split-lineage-implementation`, base and HEAD `2a6a41536b676559db94b476c71dd645af03fbab`. Nothing is staged.
- **Don't modify the worktree.** No editing, staging, resetting, stashing or pulling. Run everything on an isolated copy.
- **Read-only references:**
  - the accepted scope, `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md` (round-5 text, SHA-256 `6352f009…acd9b`), and the round-5 pack, both in the uncommitted scope checkout `/Users/rickymac/code/Flight-training-split-lineage-scope`
  - the acceptance, owner approval and implementation prompt in `/Users/rickymac/code/split-lineage-round5-review/`
  - none of these are on main yet
- **Read first:**
  - `docs/evidence/m2-split-lineage-implementation-2026-10-08/README.md`
  - its `REQUIREMENTS.md`
  - `OWNER_APPROVAL.md`. The owner approved SL-D1–D8; don't ask again.

Before reviewing:
1. Verify all 35 entries in the pack's `source-hashes.json` (`files` object) against the worktree, and the pack's 32 `SHA256SUMS` entries. Report any difference before going further.
2. Confirm the worktree is at its recorded base with nothing staged. Confirm migrations 0001–0012 are byte-identical to base, and that the registry adds only 0013.
3. Confirm `src-tauri/migrations/0013_split_source_lineage.sql` is byte-identical in its table definitions to the round-5 `candidate_migration_0013.sql`.

## 2. Reproduce

On the isolated copy, with dependencies linked only if the lockfiles are byte-identical:
- Node 22
- rustup Rust
- `SDKROOT=$(xcrun --sdk macosx --show-sdk-path)`

**Reproduce:**
- the focused suites from the pack's `run_gate.sh`: 110 frontend and 41 native
- `npm run typecheck`
- the 15-case shared validator contract on all three engines
- the five sensitivity variants (`run_sensitivity.py`), each caught by its named test

Keep raw output and captured exits. Rerun the full matrices (2,862 / 5 frontend, 444 / 6 Rust) only if a finding or a source difference justifies it.

## 3. What to examine

Read the source, not only the tests. At minimum:

1. **Receipt authority** (`src-tauri/src/lineage.rs`, `pdf.rs`):
   - The splitter reads the source once and hashes exactly the bytes it splits.
   - The receipt is bound to the material that owns the file.
   - The webview cannot mint, edit or extend a receipt: serde `deny_unknown_fields`, the hash recomputed and matched to the recorded row, and the TS shape guard.
   - Re-issue never alters a committed or cancelled record.
   - A missing root never becomes the parent.
2. **Save transaction:**
   - Every check needed for safety happens before any write: pending status, source row and path, nested snapshot, output-id collisions, all inside `BEGIN IMMEDIATE`.
   - The status update is conditional.
   - A failure leaves nothing behind and the record `pending`.
   - Parts inherit type, topic, priority, goal, event and tags from the source; only the title and notes come from the interface.
3. **Cancel and read-back:**
   - Cancel removes only the plan's own files, never a saved split's, and never a file a material uses.
   - The dialogs read an unacknowledged save back before cancelling (`splitSave.ts`).
   - Check races between cancel and save.
4. **Read model and UI** (`src/logic/splitLineage.ts`, `SplitLineageDetails.tsx`):
   - structural tiers
   - each tier judged against its own file
   - unknown never vouched for or grouped
   - related parts limited to the same known edition
   - correct coordinates for links and the copy-page text
   - fingerprinting off the render path, bounded, safe paths only
   - plain, warm wording that is honest about "unknown"
   - accessible controls
5. **Restore safety:**
   - `verify_schema_13_lineage_semantics` and `validateSplitLineageState` are true twins.
   - Older binaries refuse schema 13.
   - A populated schema-12 library upgrades with its practice and card history intact.
   - Consider whether the contract misses an important corruption case.
6. **Regressions:**
   - The generic `save_split_materials` / `createMany` path is unchanged.
   - The three updated ceiling tests changed only what migration 13 requires.
   - Check other users of the split commands, the AppData revision and existing Study Library behaviour.
7. **The replaced partial work** (`implementer-partial/`): judge whether every defect the README lists was real, and whether anything sound was dropped.
8. **Disclosed decisions** (README "Deliberate decisions") and **limitations**: are they acceptable against the accepted scope? This matters most for decision 1 (browser drivers read but don't write lineage, while scope §7 says "native and browser drivers") and decision 2 (refused saves stay `pending` until the interface cancels).

## 4. Findings and evidence

For each finding, give:
- a severity
- the exact file and line
- a concrete trigger
- the impact
- a bounded fix

Prove each one with a **new reviewer diagnostic** that fails on this source and passes once corrected, with controls that pass now. Use only real files and disposable databases. Never call the old receipt-less API. The diagnostic must import through stable module paths so a later round needs at most a resolve-only redirect.

Write a review pack, `docs/evidence/m2-split-lineage-source-review-<date>/`, containing:
- the verified hash results
- raw receipts with captured exits
- the diagnostic
- a SHA256SUMS

Write `docs/M2_SPLIT_LINEAGE_SOURCE_REVIEW_<date>.md`. Then do one of two things:
- **If accepted:** write `docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_<date>.md`. List what must be published together: the scope documents, the scope review and acceptance, the owner approval and this implementation, in one PR. State the remaining Mac release gates: installed Apple Silicon smoke test, upgrade over populated data, restore of an older backup.
- **If not:** write one bounded, model-neutral correction prompt that keeps every verified behaviour.

Update STATUS and the handoff from the latest origin/main text, keeping every prior entry.

## 5. Scope

**Out of scope:**
- editing production code
- installing, launching against real data, signing, packaging or a version bump
- provider or account tests
- new features or dependencies

**Report:** the decision, verified counts, reproduced results, findings, and the exact paths you wrote. Leave your documents uncommitted for the owner or Codex to publish, then stop.
