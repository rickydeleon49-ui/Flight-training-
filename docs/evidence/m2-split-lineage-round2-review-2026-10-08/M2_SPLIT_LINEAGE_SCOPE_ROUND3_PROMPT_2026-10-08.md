# M2 split lineage — scope corrections SL-R7–SL-R9

You are the implementation model. Complete one bounded correction round in the existing Mac scope checkout, then stop for independent senior review. This is planning/proof work; it does not authorize production lineage. Work precisely and keep pace.

## 1. Starting state

Use `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. Work is uncommitted. Do not create another checkout, reset, stash, pull over the tree, or edit the primary, C2 or integration clones.

Fetch origin and read the new review, this prompt and the reviewer pack with `git show origin/main:<path>`; do not `git checkout` them into the tree. Wherever they are published, the reviewer pack contains `diagnostics/lineage-round2-review.test.mjs` and raw receipts.

Before editing:
1. The previous round staged 22 reviewer files with `git checkout origin/main -- …`. Confirm each is byte-identical to `origin/main`, then unstage exactly those paths with `git restore --staged -- <paths>`, keeping them on disk. Record the before/after `git status`. Touch nothing else in the index.
2. Verify the round-2 pack's 22 checksums and its `source-hashes.json` (6 paths), plus the preserved packs: scope 9, first review 20, round-1 corrections 18, re-review 19. If anything differs, report it before editing affected files.
3. Baseline, each with raw output and exit:
   - round-2 proof: 16 pass
   - frozen round-1 and round-2 diagnostics via the round-2 adapter: 7 and 6 pass
   - the new reviewer diagnostic, copied verbatim into a new pack's `diagnostics/`: **3 pass / 8 fail, exit 1**

Never edit a frozen diagnostic's assertions. A disclosed import-only adapter may redirect imports to the corrected model.

Keep everything the review retained:
- direct verification against the root tier
- direct-edition sibling isolation
- canonical nested derivation (A101–300 + A20–40 ⇒ R120–140, length 21) and contradiction refusals
- stale and missing-bytes refusal
- the real mid-transaction rollback
- the isolated mutation workspace
- shipped migrations 0001–0012
- legacy-NULL-is-unknown
- child-retaining deletion
- the labeled restore simulation

## 2. SL-R7: a mandatory, authoritative source receipt

1. **Define one typed `SplitSourceReceipt`,** produced by the split step and the only accepted provenance input to the save. It contains:
   - the source material ID
   - the source file path and size
   - the SHA-256 of the exact bytes split
   - the authoritative page total
   - for a nested source, its persisted lineage snapshot: root ID/title/file/hash/total and A's root range
   - a deterministic plan of selections and output identities

   Remove caller-supplied hash, root, total and level fields from parts. Parts carry only their selection, title and output identity. Every persisted hash, range, total and level is derived from the receipt and the persisted rows; anything contradictory is refused.
2. **A new split without a valid receipt refuses all writes.** The model reads the current source file itself and compares it with the receipt hash; a caller Buffer is not proof. Specify whether the comparison is a full rehash or a cheap size/mtime precheck followed by a rehash, and state the file-read boundary honestly: a file read cannot sit inside the SQLite transaction.
3. **Re-check inside `BEGIN IMMEDIATE` before any write:**
   - the source material row still exists and still points at the receipt's file
   - the nested parent's lineage snapshot is unchanged

   If the source was deleted or replaced between the split and the commit, refuse and clean only this operation's staged outputs. Document this as the pinned-transaction-owner contract for production.
4. **Bound ranges by the receipt's total,** for direct and nested splits alike. Keep the existing derivation for nested ranges.
5. **Keep the passing guard:** after root deletion, the immediate parent is never recorded as root. Specify what is preserved instead (the historical root snapshot, with a NULL ID) and prove it.

## 3. SL-R8: tier classification is structural; unknown stays unknown

1. **Classify direct versus nested only by structure:** `nested_level` and the presence of the parent range. Never use hash nullness.
   - **Direct:** the effective immediate identity is the root tier.
   - **Nested:** the immediate identity is the parent tier only. A NULL parent hash means `parentStatus: unknown`, even when root bytes match.

   Add DDL CHECKs tying `nested_level = 1` to NULL parent fields and `nested_level > 1` to a present parent range and parent total. Validate them through the actual candidate DDL.
2. **Group siblings on the same effective identity.** The parent ID must match, and so must the effective hash: the root hash for direct parts, the parent hash for nested parts. Unknown never matches anything, including another unknown.
3. **Cover all of these in persisted data, through the exported boundary:**
   - direct, nested and level-3 parts
   - matching, changed, missing, deleted and unknown sources, for both parent and root verdicts
   - two editions of A under the same ID
   - unknown parent tiers
   - independently imported identical bytes

## 4. SL-R9: evidence that matches the claims

1. **Cleanup runs exactly once per failed operation,** and only touches files that operation owns. Prove it with two concurrent staged operations and one failure.
2. **Model the acknowledged save, refresh failure and retry properly.**
   - **Idempotency:** give each batch an operation ID derived from the receipt and plan. Resubmitting an acknowledged batch returns the existing parts without new rows or files. A conflicting resubmission is refused.
   - **Reconciliation:** reconciliation reads by operation ID, not by IDs the caller remembers.
   - **Cancellation:** cancellation before commit removes only staging; after acknowledgement it keeps everything.
   - **The failure itself:** exercise a failed refresh at the model boundary, not a standalone thrown error.
   - **The report:** remove any claim that the code doesn't support. The previous claim of `maxAttempts = 3` was false.
3. **Rebuild the lifecycle (Contract 14):**
   - start from the shipped 0001–0012 schema and seed parent and child histories *before* the migration
   - apply candidate 0013, then perform the split through the **validated save with a receipt**, creating distinct output files
   - add retained-child practice and card histories
   - replace the source bytes in place and show the verdict becomes `changed`
   - delete the parent, then export and reopen with `foreign_keys` on

   Compare complete before/after records for every seeded history row, including responses, card events and state. Allow only the declared reference transitions.
4. **Mutations:** keep the four existing ones and add at least four aimed at the new logic:
   - the verification gate becomes optional again
   - caller hash precedence is restored
   - the hash-nullness tier heuristic is restored
   - sibling `COALESCE` grouping is restored

   Each must be killed by a named assertion (not just "Missing expected exception"), with per-mutant raw output, exit and baseline/restored hashes saved as separate receipts. Never modify evidence in place.
5. **Page mapping:** make the main API `{start, end}` or a named count. Move positional magnitude-guessing into a narrow, named compatibility adapter used only by the frozen calls, and test both.
6. **Update scope §8** (the conditional production prompt) so it requires the receipt, the in-transaction re-checks, structural tiers, operation-ID idempotency and the stated file-read boundary. Update the scope body to match.

## 5. Delivery and stop

Write a new pack, `docs/evidence/m2-split-lineage-scope-round3-2026-10-08/` (use the actual date), containing:
- one authoritative candidate DDL, the model and the tests
- the adapter, if any
- a requirement-to-test map distinguishing controls, guards and reproductions
- baseline and final receipts, each with its exit
- the mutation receipts
- `source-hashes.json` and `SHA256SUMS`

**Final runs, each in its own receipt:**
- the new reviewer diagnostic verbatim: 11 pass
- frozen rounds 1 and 2 via the adapter: 7 and 6 pass
- the new proof
- the mutations

Leave all earlier packs byte-identical. Do not rerun native or frontend matrices; nothing in `src/` or `src-tauri/` changes.

Update STATUS and the handoff from origin/main's text, keeping accepted C2 and prior gates, and add: "SL-R7–SL-R9 corrected, pending independent scope review; SL-D1–D8 proposed." Don't claim acceptance or approval.

**Report:**
- branch, HEAD and staging state
- every changed or untracked path
- exact counts and exits
- mutation results
- remaining limitations

Leave everything uncommitted and unpushed, then stop. Out of scope:
- production code, migration registration or a schema bump
- provider or real-account tests
- packaging, signing, release or new features
