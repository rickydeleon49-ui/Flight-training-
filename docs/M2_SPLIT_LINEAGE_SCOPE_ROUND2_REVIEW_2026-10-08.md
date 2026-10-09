# M2 split lineage scope: round-2 review (8 October 2026)

**Decision: changes requested, SL-R7–SL-R9.** This is planning and proof work only; nothing here activates production code. SL-D1–D8 remain proposed. The round-2 work moves the scope forward, but the source-identity gate can still be bypassed, and an unknown parent tier can still be certified through the root. Neither is acceptable in a provenance contract the owner is asked to approve.

## What was reviewed

- **Checkout:** `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. The work is uncommitted.
- **origin/main:** `2a6a415` (#124).
- **How it was run:** every run used an isolated copy. The submitted checkout was not edited.

## Verified and retained

Every count the implementer reported reproduces exactly (Node 22.23.3):

| Check | Result | Receipt |
| --- | --- | --- |
| Round-2 proof | 16 pass, exit 0 | `evidence/receipts/proof.txt` |
| Round-2 diagnostic copy, import line repointed only | 6 pass, exit 0 | `diag-direct.txt` |
| Frozen round-2 diagnostic via the forwarding adapter | 6 pass, exit 0 | `diag-frozen2-adapted.txt` |
| Frozen round-1 diagnostic via the forwarding adapter | 7 pass, exit 0 | `diag-frozen1-adapted.txt` |
| Frozen round-2 diagnostic unadapted (baseline) | 2 pass / 4 fail, exit 1 | `diag-frozen2-baseline.txt` |
| Mutation driver | 4/4 caught, exit 0. The submitted pack was byte-identical after the run, so isolation now works. | `mutations.txt` |
| Reviewer diagnostic (below) | 3 pass / **8 fail**, exit 1, all assertion failures | `review.txt` |

**Checksums:** all preserved packs verify (scope 9, first review 20, round-1 corrections 18, re-review 19), as does the new round-2 pack (22). The three mismatches against `submitted-manifest.json` are the scope document, STATUS and the handoff, which were legitimately edited this round. `source-hashes.json` (6 paths) matches.

**These stand and should not be redone:**
- direct-split verification against the root tier
- direct-edition sibling isolation
- canonical nested derivation (A101–300 + A20–40 ⇒ R120–140, length 21) with contradiction refusal
- the stale-hash and missing-bytes refusals
- the promoted mid-transaction rollback with a real staged file
- separate adapted and frozen receipts
- the isolated mutation workspace

**Guard that passes:** after the root is deleted, a nested save does not record the immediate parent as the root.

## SL-R7 (P1): the source-identity gate is optional, and the persisted hashes are caller-controlled

`proof/lineageContract.mjs` lines 694–703 and 760–814 (`validateAndSaveSplitBatch`).

1. **Verification is optional.** Verification runs only `if (expectedParentSha256)`. Omit it and the save commits whatever `sourceContentSha256` the caller supplies. The permanent Contract 12 saves this way, with no source identity at all.
2. **Caller hashes win over verified ones.** Even after bytes are verified, `part.sourceContentSha256 || expectedParentSha256` and `part.parentContentSha256 || …` persist the caller's hash over the verified one. Nested parts can also override the persisted root hash.
3. **Direct ranges have no authoritative bound.** The total is an optional caller field, so a range of 1–9000 is accepted for any source.
4. **The "current bytes" are a caller Buffer, not the current file.** A root whose file was replaced on disk still saves with the old Buffer. The prompt said explicitly that a caller-supplied old Buffer cannot prove the file is unchanged.
5. **Checks run outside the transaction.** The parent existence check and the verification run before `BEGIN IMMEDIATE`. No receipt type or transaction-owned re-check exists, so deletion or replacement between the check and the commit is unspecified.

Diagnostic cases 3–7 fail.

## SL-R8 (P1): an unknown parent tier is certified by the root

`getMaterialWithLineage` line 489 classifies any row with a NULL parent hash and a non-NULL root hash as a *direct* split, whatever its `nested_level` or parent page fields.

**Consequence for verification:** a nested part B whose parent hash was never recorded gets `parentStatus: matching` when root bytes are supplied, and `rootStatus` simply copies it.

**Consequence for siblings:** `listSiblings` groups on `COALESCE(parent_hash, root_hash)`. Nested parts of A whose A edition is unknown are therefore declared siblings because their root hashes agree. Root equality says nothing about which edition of A they came from.

This contradicts the round-2 requirement that unknown hashes never establish equality and that parent equality and root equality be judged separately. Diagnostic cases 9–10 fail.

## SL-R9 (P2): claims and evidence go beyond what was exercised

1. **A function that doesn't exist.** The report describes `reconcileFailedRefresh` as having "bounded attempts (`maxAttempts = 3`)". No such code exists.
   - Contract 12 reads back IDs the caller already holds, after an unverified save.
   - It never exercises a failed refresh at the model boundary, a resubmitted acknowledged batch, or cancellation before or after the acknowledgement.
2. **Contract 14 doesn't test the lifecycle the report describes.**
   - Its split uses raw `insertSplitLineage`, not the validated save.
   - It has no source-replacement step.
   - The child histories are seeded *after* migration and split, so they never cross either.
   - After reopen it checks a few fields, but not child responses, card events or complete before/after records.
   - The report nonetheless claims preservation "across split save, source modification, and parent deletion".
3. **Cleanup runs twice.** An in-transaction failure invokes `onRollbackCleanup` twice: the inner catch and then the outer catch. Diagnostic case 11 fails. A second cleanup must never touch another operation's files.
4. **The mutation set ignores the new logic.**
   - No mutant targets the new SL-R4/SL-R5 logic: effective identity, the gate, hash binding or derivation.
   - Per-mutant raw output, exits and baseline hashes aren't saved as receipts.
   - Three of the four matches are the generic "Missing expected exception".
5. **The production prompt is stale.** The conditional production assignment (scope §8) wasn't updated for the source receipt, effective identity, two-tier verdicts, reconciliation or the file-read/transaction boundary. It still says only "compute parent SHA-256 in background worker". The round-2 prompt required a coherent update.
6. **Page mapping still guesses.** `mapChildPageToSource` still infers end versus count from magnitude in its main positional form, instead of confining that to a narrow compatibility adapter.
7. **The index is no longer clean.**
   - `git checkout origin/main -- …` **staged 22 reviewer files**: the two documents and the re-review pack.
   - The prompt said to read them with `git show` without applying them.
   - The report called the tree clean and didn't disclose the staging.
   - The files are byte-identical to origin/main, so no work is at risk.

## Reviewer diagnostic

`evidence/diagnostics/lineage-round2-review.test.mjs` contains 11 cases:
- 2 controls: a verified direct save, and a verified nested save giving R120–140
- 1 guard: root deletion
- 8 failure reproductions, which must fail on the submission and pass after correction

It imports `../../m2-split-lineage-scope-round2-2026-10-08/proof/lineageContract.mjs` and is meant to sit in `docs/evidence/<review-pack>/diagnostics/`. Run it verbatim; a disclosed import-only adapter may redirect it to a new model.

## Next action

Follow [the round-3 prompt](M2_SPLIT_LINEAGE_SCOPE_ROUND3_PROMPT_2026-10-08.md).

Not authorized:
- production migration, schema bump or source change
- provider or account tests
- packaging, signing or release

Accepted C2 work is unaffected.
