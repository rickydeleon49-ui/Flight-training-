# M2 split lineage — scope corrections SL-R10–SL-R11

You are the implementation model. Complete one bounded correction round in the existing Mac scope checkout, then stop for independent senior review. This is planning/proof work; it does not authorize production lineage. Work precisely and keep pace.

## 1. Starting state

Use `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. The index is clean and the work is uncommitted. Do not create another checkout, reset, stash or pull over the tree. Do not `git checkout` or stage reviewer files. Read new reviewer documents with `git show origin/main:<path>`, or from the folder the owner gives you.

Before editing:
1. Verify all six packs' `SHA256SUMS`: scope 9, first review 20, round-1 corrections 18, re-review 19, round-2 22, round-3 38. Verify the round-3 `source-hashes.json` too.
   - **Do not run the round-3 mutation driver inside that pack.** It rewrites its own receipts and breaks the checksums. If you need to rerun it, do so in an isolated copy.
2. **Baseline,** with exits captured from `$?` and never typed by hand:
   - round-3 proof: 18 pass
   - round-2 reviewer diagnostic via the round-3 adapter: 11 pass
   - frozen rounds 1 and 2: 7 and 6 pass
   - the new reviewer diagnostic `lineage-round3-review.test.mjs`, copied verbatim into a new pack's `diagnostics/`: **5 pass / 7 fail, exit 1**

Keep everything the round-3 review retained:
- structural tiers and their DDL CHECK
- two-tier verdicts from real files
- effective-identity siblings
- receipt creation from the stored file
- the disk-versus-receipt stale check
- cleanup exactly once
- receipt-derived replay
- the rebuilt Contract 14
- all eight named mutants
- legacy-NULL-is-unknown
- child-retaining deletion

## 2. SL-R10: the receipt is the only authority

1. **Remove the receipt-less save path entirely.** That means:
   - no `expectedParentSha256` or `currentParentBytes` save inputs
   - no caller `parts` alongside a receipt
   - no caller operation ID
   - no `parts[0].sourceTotalPages`
   - no 1,000-page fallback

   A save takes a receipt (plus tags and cleanup); anything else is refused before any write.
2. **Make receipts tamper-evident and bound to the database.** At split time, persist the receipt in the operation log as `pending`, with its canonical JSON and the hash of that JSON. The save accepts only a receipt whose canonical hash matches a pending row for the same source. Any edit to total, plan, hash or snapshot is refused. Specify this as the production contract: in production the native split worker issues the receipt, and the webview can't mint one.
3. **A missing or unreadable source file refuses** both receipt creation and save, and the verdict is `missing`. Caller bytes are never a substitute. A material with no stored file can't be split.
4. **Compare the nested snapshot with the receipt inside `BEGIN IMMEDIATE`.** That covers the parent's lineage row (root ID, root hash, root range, total, level) and the parent's file path. Any difference refuses and cleans only this operation's staging. Delete the meaningless double-read check.
5. **The page total.** The receipt's total is the engine's page count at split time. State plainly that the JS model takes it as input from the split engine, and that production must take it from `pdf.rs`, never from the webview.

## 3. SL-R11: idempotency, cancellation and evidence integrity

1. **Move `split_operation_log` into `candidate_migration_0013.sql`** with a full design:
   - operation ID primary key
   - source material ID, with a declared delete policy
   - receipt canonical JSON and hash
   - a status CHECK (`pending | committed | cancelled`)
   - timestamps

   Remove it from the test helper, so the 0001–0012 baseline is exactly the shipped schema. Contract 13 must assert this. Update scope §3 and §8.
2. **Operation IDs come only from the receipt.**
   - A replay of a committed receipt returns the **persisted** rows.
   - A *different* receipt whose parts reuse output identities from a committed operation is refused before any write, with a named error, not a primary-key failure.
   - Reconciliation reads by operation ID.
3. **`cancelBatch(db, operationId)` is real.**
   - Before commit, it marks the operation `cancelled` and deletes only the staged files that operation recorded.
   - After commit, it changes nothing.
   - A later save of a cancelled receipt is refused.

   Prove it with real files and two operations.
4. **The mutation driver** takes an explicit output directory and never writes into a sealed pack. The final receipts come from one run into the new pack before sealing it. Add mutants for:
   - receipt-less save restored
   - receipt hash check skipped
   - snapshot comparison removed
   - operation log back in the helper

   Each must be killed by a named assertion.
5. **The previous reviewer diagnostic** (`lineage-round2-review.test.mjs`) is superseded. Once the receipt is mandatory, its controls 1–2 and case 11 are expected to fail. Run it, record the result, and disclose the expected retirements. Don't modify it. All of its other cases must still pass.

## 4. Delivery and stop

Write a new pack, `docs/evidence/m2-split-lineage-scope-round4-2026-10-08/` (use the actual date), containing:
- one authoritative candidate DDL, the model and the tests
- the adapter, if any
- a requirement-to-test map (controls, guards and reproductions)
- baseline and final receipts with captured exits
- the mutation receipts
- `source-hashes.json` and `SHA256SUMS`

**Final runs, each in its own receipt:**
- the new reviewer diagnostic verbatim: 12 pass
- frozen rounds 1 and 2: 7 and 6 pass
- the round-2 reviewer diagnostic, with its disclosed expected retirements
- the new proof
- the mutations

Earlier packs stay byte-identical. Nothing in `src/` or `src-tauri/` changes, so don't run native or frontend matrices.

Update the scope (body and §8), STATUS and the handoff from origin/main's text, keeping accepted C2 and prior gates, and add: "SL-R10–SL-R11 corrected, pending independent scope review; SL-D1–D8 proposed." Don't claim acceptance. Report only what the code and receipts show.

**Report:**
- branch, HEAD and staging state
- every changed or untracked path
- exact counts and captured exits
- mutation results
- remaining limitations

Leave everything uncommitted and unpushed, then stop. Out of scope:
- production code, migration registration or a schema bump
- provider or real-account tests
- packaging, signing, release or new features
