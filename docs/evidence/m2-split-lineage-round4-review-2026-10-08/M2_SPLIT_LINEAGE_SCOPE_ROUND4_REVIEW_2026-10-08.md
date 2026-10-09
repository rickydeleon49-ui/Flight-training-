# M2 split lineage scope: round-4 review (8 October 2026)

**Decision: changes requested, SL-R12–SL-R13.** This is a small round. The core contract is now right: the receipt is mandatory, tamper-evident and bound to the operation log; missing files are refused; the nested snapshot is compared inside `BEGIN IMMEDIATE`; and the baseline is exactly the shipped schema. What remains is three model defects and some evidence that is weaker than reported. SL-D1–D8 remain proposed.

## What was reviewed

- **Checkout:** `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad`, uncommitted.
- **Index:** clean.
- **origin/main:** `2a6a415`.
- **How it was run:** every run used an isolated copy. The submitted checkout wasn't edited.
- **Checksums:** all seven packs verify, including the round-4 pack (49 entries).

| Check | Submitted claim | Independent result | Receipt |
| --- | --- | --- | --- |
| Round-4 proof | 18 pass | 18 pass, exit 0 | `proof.txt` |
| Round-3 reviewer diagnostic | 12 pass | 12 pass with the submitted loader. **11 pass with an import-only redirect**: case 11 reads round-3's DDL by path; it passes against round-4's DDL when checked directly. | `review3-submitted.txt`, `review3-importonly.txt` |
| Frozen round 1 | 7 pass | 7 pass, both submitted and import-only | `frozen1-*.txt` |
| Frozen round 2 | 6 pass | 6 with the submitted compat adapter; **4 pass / 2 fail import-only**. The two failures are legacy receipt-less controls. | `frozen2-*.txt` |
| Mutations | 12/12, exit 0 | **exit 1.** Mutants 9–11 kill Contract 11, but not on their named assertions. The driver still prints "12/12 … caught and verified". | `mutations.txt`, `mutations-rerun/` |
| **Round-4 reviewer diagnostic** | — | 4 controls pass / **4 fail**, exit 1, all assertion failures | `review4.txt` |

**These stand and should not be redone:**
- the receipt-only save
- refusal of legacy inputs
- the canonical-hash check against `split_operation_log`
- missing and unreadable file refusal
- the full nested snapshot comparison inside the transaction
- the output-collision refusal
- the real `cancelBatch(db, operationId)`
- the operation log in the candidate DDL with a faithful 0001–0012 baseline
- replay of a committed receipt
- the rebuilt Contract 14
- the structural tiers and siblings

## Responsibility for the adapter issues

Two adapter issues below trace back to the reviewer:
- The round-4 prompt required frozen round 2 to give 6/6, which isn't achievable honestly once receipts are mandatory.
- The round-3 diagnostic read DDL by a hard-coded path and called the old three-argument `cancelBatch`.

The implementer worked around these rather than flagging them. The workarounds still have to go, but the cause is acknowledged.

## SL-R12 (P2): model defects

1. **The nested parent tier records the root.** `validateAndSaveSplitBatch` writes `parent_title`/`parent_file_name` from `receipt.rootTitle`/`rootFileName`, which are the *root's* for a nested receipt (lines 829–830). A part B of A gets `parent_title = 'Root'` and `parent_file_name = 'root.pdf'`. Diagnostic case 5 fails.
2. **Re-issuing a receipt resets the operation.** `createSplitSourceReceipt` uses `INSERT OR REPLACE` (line 466), so issuing an identical receipt resets a **committed** operation to `pending`. Reconciliation then reports not committed, and replay turns into a collision error. Case 6 fails.
3. **Cancellation can be revived.** Re-issuing after **cancellation** also resets the operation to `pending`, so the cancelled split then saves, pointing at the staged file that was already deleted. Case 7 fails.

Re-issuing a receipt must never change an existing committed or cancelled row.

## SL-R13 (P2): evidence and helper integrity

1. **`round2CompatAdapter.mjs` is not an import adapter.** It reimplements the old refusals itself, writes caller bytes to a temp file and points the parent's `file_path` at it. That is the caller-bytes path, rebuilt in the test layer, so its "6/6" is mainly adapter behaviour. Delete it. Record frozen round 2 through an import-only redirect: 4 pass, with 2 disclosed retirements of receipt-less controls.
2. **The forwarding loader rewrites test source.** Its `load` hook rewrites the reviewer diagnostic's text. Replace it with resolve-only redirects. The new reviewer diagnostic needs no file paths.
3. **`cancelBatch` keeps a compatibility form.** `cancelBatch(operationId, files, isAcknowledged)` deletes any caller-listed paths without checking ownership. Case 8 fails. Remove it; only `cancelBatch(db, operationId)` remains.
4. **The mutation driver isn't reliable.**
   - Its summary line is unconditional (`${n}/${n}`).
   - Its name matching depends on the test reporter's output format; the independent rerun exited 1.
   - Fix: pin `--test-reporter=tap` (or parse structured output), match the failing test name plus assertion message, and print the real count.
   - Two original mutants (optional gate, caller-hash precedence) were replaced or renumbered. Map them explicitly; caller-hash precedence is now structurally impossible, so say so.
5. **Smaller items:**
   - Tamper verification runs only `if (hasOpLog)`. Make it unconditional: with no operation log, refuse.
   - `split_operation_log.source_material_id ON DELETE CASCADE` erases committed operation history when the source is deleted, so reconciliation for that operation then reports unknown. Choose and justify a policy, for example keeping committed rows with a NULL source. Add it to SL-D proposals if it is a product choice.

## Reviewer diagnostic

`evidence/diagnostics/lineage-round4-review.test.mjs` uses receipt-API calls and imports only, with no file paths. It has 4 controls (the nested receipt save with the parent hash; edited receipt and snapshot drift refused; replay with reconcile; real cancel) and 4 reproductions.

It imports `../../m2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs`; a resolve-only redirect such as `evidence/reviewer-adapter/` may point it at a newer model. **It supersedes the round-3 reviewer diagnostic.** Under the corrected model, round 3's case 12 (the old `cancelBatch` signature) is expected to fail and may be retired with disclosure; its other 11 cases should still pass.

## Status and next step

After this round the scope should be ready to accept, followed by your SL-D1–D8 decisions. Next prompt: [round 5](M2_SPLIT_LINEAGE_SCOPE_ROUND5_PROMPT_2026-10-08.md).

Not authorized:
- production code, migrations or a schema bump
- packaging, signing or release
