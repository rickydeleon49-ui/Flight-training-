# M2 split lineage — scope corrections SL-R12–SL-R13

You are the implementation model. Complete one small, bounded correction round in the existing Mac scope checkout, then stop for independent senior review. This is planning/proof work; it does not authorize production lineage. Work precisely and keep pace.

## 1. Starting state

Use `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. The index is clean and the work is uncommitted. Do not create another checkout, reset, stash, pull, or stage or check out reviewer files.

Read the round-4 review and reviewer pack from origin/main with `git show`, or from the folder the owner gives you.

Before editing:
1. Verify all seven packs' `SHA256SUMS`: 9, 20, 18, 19, 22, 38 and 49.
2. **Baseline,** each with output and an exit captured from `$?`:
   - round-4 proof: 18 pass
   - the new reviewer diagnostic `lineage-round4-review.test.mjs`, copied verbatim into a new pack's `diagnostics/`: **4 pass / 4 fail, exit 1**

Keep everything the round-4 review retained:
- the receipt-only save and refusal of legacy inputs
- the canonical-hash check against the operation log
- missing-file refusal and the full in-transaction nested snapshot comparison
- the output-collision refusal
- the real `cancelBatch(db, operationId)`
- the operation log in the candidate DDL, with a faithful 0001–0012 baseline
- replay, Contract 14, structural tiers and siblings

## 2. SL-R12: model defects

1. **Nested parent tier:** a nested part's `parent_title`/`parent_file_name` come from the immediate parent (A's title and stored file name). `source_*` keeps the root snapshot. Add a proof assertion, and include the fields in the receipt's parent snapshot.
2. **Receipt re-issue:** re-issuing an identical receipt never alters an existing row.
   - **Committed:** stays committed; replay and reconcile still work.
   - **Cancelled:** stays cancelled, and a save of that receipt is refused.
   - **Pending:** may be returned unchanged.

   Use a plain `INSERT` with an explicit existing-row policy, not `INSERT OR REPLACE`.
3. **Tamper verification is unconditional.** With no operation log, the save is refused.
4. **Operation-log delete policy:** choose one deliberately. One option is `ON DELETE SET NULL` on a nullable source ID, keeping committed history. State it in scope §3 and §8. If it is a product choice, add it to the SL-D proposals rather than deciding it silently.

## 3. SL-R13: evidence and helper integrity

1. **Remove `cancelBatch`'s compatibility signature.** Only `cancelBatch(db, operationId)` remains, and it deletes only files recorded in that operation's receipt.
2. **Delete `round2CompatAdapter.mjs`** and the loader's `load`/source-rewrite hook. Use one resolve-only loader that redirects earlier `lineageContract.mjs` imports to the round-5 model, and nothing else.
3. **Record every superseded or legacy case honestly through that loader, without editing any diagnostic.** These are the expected results:

   | Diagnostic | Expected | Retired cases |
   | --- | --- | --- |
   | Frozen round 1 | 7 pass | — |
   | Frozen round 2 | 4 pass / 2 retired | the two receipt-less controls |
   | Round-2 reviewer diagnostic | 8 pass / 3 retired | as before |
   | Round-3 reviewer diagnostic | 10 pass / 2 retired | case 11 (DDL read from the round-3 path; show it separately against the round-5 DDL) and case 12 (the old `cancelBatch` signature) |
   | Round-4 reviewer diagnostic | **8 pass**, verbatim | — |

   Map each retired case to the permanent proof assertion that now covers its intent.
4. **The mutation driver:**
   - pin the test reporter (for example `--test-reporter=tap`, or a structured reporter) so matching doesn't depend on the environment
   - match on the failing test's name plus the expected assertion message
   - print the actual killed count
   - exit 1 on any miss
   - write receipts only to the explicit output directory

   Keep all twelve mutants. Add mutants for the parent-tier mislabel and for `INSERT OR REPLACE` re-issue. Map the two original mutants that were replaced (optional gate, caller-hash precedence) to their successors, stating that caller-hash precedence is structurally impossible now. Run it twice, from two different working directories, and keep both receipts; the results must be identical.
5. **Update the scope** (body and §8), STATUS and the handoff from origin/main's text, keeping accepted C2, the Mac-only release pathway and prior gates, and add: "SL-R12–SL-R13 corrected, pending independent scope review; SL-D1–D8 proposed."

## 4. Delivery and stop

Write a new pack, `docs/evidence/m2-split-lineage-scope-round5-2026-10-08/` (use the actual date), containing:
- the DDL, model, proof and loader
- the requirement map, including the retirements
- baseline and final receipts with captured exits
- both mutation runs
- `source-hashes.json` and `SHA256SUMS`

Earlier packs stay byte-identical. Nothing in `src/` or `src-tauri/` changes; don't run native or frontend matrices.

**Report:**
- branch, HEAD and staging state
- changed and untracked paths
- exact counts with captured exits
- the retirements and their mappings
- mutation results from both runs
- remaining limitations

Report only what the code and receipts show. Leave everything uncommitted and unpushed, then stop. Out of scope:
- production code, migration registration or a schema bump
- provider or account tests
- packaging, signing, release or new features
