# M2 split lineage scope re-review — 8 October 2026

**Changes requested: SL-R4–SL-R6. Planning/proof only; no production activation.**

Reviewed the uncommitted submission in `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. GitHub base was `920ff2387c8933b143cc64758c21ac050fb744ee`. The six correction document hashes and 9 original / 20 prior-review / 18 correction evidence checksums all match. Original packs and implementation checkout were preserved. Exact submitted document bytes are retained in the new review evidence rather than mistaken for accepted scope.

## What is verified and retained

The canonical persisted nested example maps A pages 20–40 to root pages 120–140 and child length 21. The candidate DDL rejects fractional positions, NULL child identities and self-root references. The corrected disposable model executes shipped migrations 0001–0012; actual attempt/state tables exist. All seven frozen diagnostic assertions pass with only the submitted import-forwarding loader. The numeric older-binary check is now labeled a simulation. Four mutations of the actual exported model/DDL cause assertion failures and exact restoration. These improvements stand; do not restart the audit, C2, or schema research.

Independent runs on an isolated submission copy, Node 22:

| Check | Result | Raw receipt |
| --- | --- | --- |
| Corrected proof | 15 pass, exit 0 | `receipts/proof.txt` |
| Original frozen diagnostic via submitted adapter | 7 pass, exit 0 | `receipts/frozen.txt` |
| Actual exported model/DDL mutations | 4/4 caught, driver exit 0 | `receipts/mutations.txt` |
| New review diagnostic | 2 controls pass / 4 assertions fail, exit 1 | `receipts/review.txt` |

Receipts are under `docs/evidence/m2-split-lineage-rereview-2026-10-08/`. The new passing rollback control injects failure during the second lineage insert after material/tag writes, and confirms every new row is rolled back. No app/native full matrix or installed verification was rerun for this planning review.

## SL-R4 — P1: direct splits bypass the correct version tier

References in `docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/lineageContract.mjs`: lines 455–470 (`getMaterialWithLineage`), 510–566 (`listSiblings`). Scope §3 explicitly declares parent-tier metadata NULL for direct splits.

**Trigger:** Directly split root R. Store its exact hash in `source_content_sha256`, as the scope requires; leave `parent_content_sha256` NULL. Supply matching current R bytes to `getMaterialWithLineage`. The result is `parentStatus: unknown`, because only the NULL parent-tier hash is consulted. Create parts from two editions of the same R material ID; both have NULL parent-tier hashes and `listSiblings` mixes them, despite different root hashes. The two `[SL-R4]` diagnostics fail deterministically.

**Impact:** The normal first-level split cannot verify its source, and related-parts navigation violates edition isolation.

**Fix:** Define and use an effective immediate-source identity: direct splits use their root snapshot/hash/range, nested splits use their distinct parent snapshot/hash/range. Alternatively consistently populate the duplicate direct parent fields and revise the NULL contract; choose one coherent representation. Unknown hashes must never certify two editions as equal. For nested lineage, separately expose root availability/version when showing root navigation; parent equality cannot certify root bytes. Keep independently imported material IDs separate even when content is identical. Cover direct matching/changed/missing/deleted/unknown, direct edition siblings, nested differing hashes and independent imports. Preserve known canonical nested coordinates.

## SL-R5 — P1: save validation is optional and accepts forged nested provenance

References: corrected `lineageContract.mjs` lines 607–647 and 666–688 (`validateAndSaveSplitBatch`).

**Trigger 1:** Provide `expectedParentSha256`, omit current bytes, and submit a valid part. The helper commits instead of refusing unverifiable source identity. `[SL-R5] expected source identity without current bytes refuses all writes` fails.

**Trigger 2:** Persist A as root R pages 101–300. Save B with A range 20–40 but root range 1–21. Counts and individual bounds are valid, so the helper persists the false provenance. The correct R range is 120–140. `[SL-R5] nested save refuses root range inconsistent with persisted parent` fails. Root ID, root hash, total, level and per-part parent hash are also accepted from caller input without deriving or comparing them to a validated source context.

**Impact:** A source replacement/read failure can silently bypass the identity gate; nested parts can falsely identify which pages and edition produced them. An owner should not approve a supposedly verified provenance contract with this bypass.

**Fix:** Specify a typed split-time source receipt and validated save context, and exercise them at the exported boundary. Require verified current source identity for new splits; a missing/unreadable verification input refuses save rather than implying equality. Derive or validate immediate parent, root snapshot, hashes, counts, level and composed ranges from the accepted context; reject contradictions before commit. Parent/root material reads and database writes must use the proposed transaction ownership boundary. Define the source replacement/deletion policy between split and save, including the honest handling of an already-deleted historical root; immutable root metadata must never be re-stamped as a newer edition. Supply an explicit read-only reconciliation/retry policy for acknowledged saves followed by failed refresh. Do not weaken legacy NULL-lineage behavior to solve new-save validation.

## SL-R6 — P2: proof claims exceed the operations exercised

References: corrected `proof/proof.test.mjs` lines 535–565 (Contract 11), 695–803 (Contract 14); `proof/mutationChecks.mjs` lines 9–12 and 92–119; correction README receipt table.

Contract 11's purported rollback batch has a reversed third range. Prevalidation throws before `BEGIN IMMEDIATE`, so it proves refusal/cleanup invocation, not rollback after partial writes. The actual implementation passed the reviewer's injected mid-transaction failure control; promote that meaningful proof instead of rewriting working rollback code.

Contract 14 says it seeds attempts and card state, but seeds only a practice version/attempt. Card state exists in a separate disposable test that is closed before migration/export/deletion. No responses or card events are exercised through migration/export/reopen. The synthetic parent and child also point to the same single file. This does not support the claimed preservation of populated child card/attempt history and distinct split output files through that lifecycle.

The mutation driver creates a `scratch` directory but mutates `__dirname/lineageContract.mjs` and the sibling DDL directly; it does not execute isolated scratch copies as claimed. Independent verification ran this driver only on an isolated copy, preserving submitted evidence. Also the same `diagnostics-final.txt` is cited for two different commands; it records the adapted diagnostic, not a separate frozen-adapter run. Our independent `frozen.txt` confirms the frozen run passes; the missing distinct submitted receipt is an evidence-label correction, not a behavioral failure.

**Fix:** Promote the injected rollback control, use a disposable populated schema lifecycle with real response/card state/event constraints and separate synthetic parent/child files, compare retained child histories before and after migration, save, parent replacement/deletion and export/reopen. Assert allowed source-reference changes separately from immutable history. Execute actual mutants in fresh isolated scratch copies and preserve raw semantic failures, exits and baseline hashes. Use separate receipts per command; retain old receipts byte-for-byte and narrow inaccurate historical claims.

## Bounded follow-up and status

The active next assignment is `docs/M2_SPLIT_LINEAGE_SCOPE_ROUND2_PROMPT_2026-10-08.md`. All SL-D1–D8 choices remain proposed. No production migration, schema bump, application dependency/source change, signing, packaging, real-account test or release work is authorized by this review. Accepted C2 and previous platform/release holds remain unchanged.

Nonblocking API clarification: the page helper infers whether its third argument is an end or a count from its value and permits omission. Before production porting, use an explicit bounded representation (for example `{start,end}` or named count) rather than numerical guessing, and retain all valid endpoint/frozen assertions. SQLite's INTEGER storage check is distinct from JavaScript safe-integer/native PDF limits; document where those limits are enforced rather than claiming identical engine bounds.
