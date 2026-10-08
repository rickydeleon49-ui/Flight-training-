# M2 split lineage — complete scope corrections SL-R4–SL-R6

You are the implementation model. Complete one substantial, bounded correction round in the existing Mac scope checkout. Preserve verified work and leave the result uncommitted/unpushed for independent senior review. This assignment is model-neutral and is planning/proof work, not permission to ship lineage.

## Starting state and authority

Use `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. Do not create a competing checkout, reset, stash, pull over dirty work or edit the primary/C2/integration clones. Fetch/read current main without applying files over this tree. If you see competing changes, identify and preserve them before affected edits.

Read current-main `docs/M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md` and this assignment using `git show origin/main:<path>` if absent locally. Verify the six document hashes in the correction pack and its 18 checksums. The review's `docs/evidence/m2-split-lineage-rereview-2026-10-08/submitted-manifest.json` also freezes all six documents plus the full correction pack. Verify that manifest before editing. The review evidence contains exact submitted snapshots, so hashes refer to the implementation tree, not main's review banner/status. Preserve the original scope pack (9 checksums), first reviewer pack (20), round-one correction pack (18), and this new review pack byte-for-byte.

Baseline runs: corrected proof 15 pass; original frozen diagnostic forwarded by the submitted loader 7 pass; new reviewer diagnostic 2 controls pass / 4 failures. The new file lives at `docs/evidence/m2-split-lineage-rereview-2026-10-08/diagnostics/lineage-round2.test.mjs`. Run it verbatim using a disclosed import adapter or isolated snapshot layout if needed; preserve assertions and separate receipts. The two controls establish valid matching saves and genuine mid-transaction rollback.

Keep the split-flow audit, two-tier canonical nested coordinates, improved integer/identity DDL, actual shipped migration baseline, legacy unknown policy, child-retaining deletion and truthful numeric restore simulation. Do not restart accepted C2 or investigate unrelated release/toolchain work.

## SL-R4: make the normal direct split and nested version tiers coherent

1. Resolve the direct representation deliberately. Current scope stores direct-source identity in root fields and NULLs the duplicate parent fields, but both verification and sibling lookup read only parent hashes. Either add an effective immediate-source accessor or consistently populate direct parent metadata and revise the schema/spec. Apply the choice throughout save/read/navigation/siblings/UI contract.
2. Prove a directly split root with matching live bytes reports matching, changed bytes report changed, unread bytes report unknown, and absent file/material report missing/deleted. Use persisted data and the actual exported boundary.
3. Prove two editions under the same parent material ID never mix in siblings; identical bytes under independently imported IDs remain distinct. Unknown hashes do not establish edition equality. Define a conservative unknown/split-group policy rather than guessing.
4. For nested lineage, expose separate parent and root verdicts wherever root navigation is offered. A matching A hash does not certify R. Preserve the canonical R=400, A=101–300, B=A20–40 => R120–140, child length21; parent navigation20, root navigation120.

## SL-R5: bind saves to authoritative source context

1. Define typed proposed split-result/save context: exact source material identity/path or file receipt, split-time bytes/hash, source total, selection, output identities, and inherited root snapshot for a known nested parent. Make the executable helper validate this context. Do not accept caller-controlled contradictory root IDs/hashes/ranges/levels as valid provenance.
2. An expected hash with unavailable current verification must refuse all writes and clean only this operation's staged outputs. New split hashes must bind to the bytes actually split. Legacy NULL-lineage rows remain unknown; do not infer historical roots from names/notes.
3. Derive or validate nested root range using persisted parent lineage. Reject the review's R1–21/A20–40 contradiction, wrong root identity/hash/total/level, parent range beyond its true length and per-part parent hash contradictions. When historical root metadata survives deletion, preserve it truthfully rather than silently treating the immediate parent as the historical root.
4. Specify and prove deletion/replacement between split and commit, including live parent existence and chosen root policy. Align source-context/database validation with the proposed pinned transaction owner; be explicit about the file-read boundary and stale-check semantics. A caller-supplied old Buffer alone cannot prove the current file stayed unchanged.
5. Define bounded retry behavior: acknowledged save + failed refresh must reconcile by reading existing identities, without resplitting or creating duplicate parts. Cancellation before commit removes only operation-owned staging; cancellation after acknowledgement must retain saved outputs. Exercise the proposed model boundary, not a standalone thrown refresh error.
6. Make page mapping's bounds explicit before production porting; avoid guessing end versus count from numerical magnitude. Keep frozen successful call behavior through a narrow compatibility adapter if necessary. State JS/native page limits separately from SQLite storage constraints.

## SL-R6: complete the relevant evidence, without a whole-app rerun

1. Promote the review's passing mid-transaction rollback control: inject failure after earlier material/tag/lineage writes; assert no batch rows or orphan tags remain. Keep prevalidation refusal as a separate case. Use real temporary staging files when claiming cleanup rather than only setting a Boolean callback.
2. Initialize a disposable DB from exact shipped migrations0001–0012 and seed representative practice versions/items/attempts/responses and card versions/items/state/events under real constraints. Include histories owned by a retained child, so the lifecycle actually tests required child retention.
3. Run additive candidate migration, validated split save, source replacement/deletion and export/reopen in that lifecycle. Compare retained history fields and allowed reference transitions explicitly; verify distinct synthetic parent and child/output files stay intact where required. This is SQLite/file proof, not native backup or installed-app verification.
4. Repair the mutation driver to copy model/DDL/tests into a fresh temporary workspace, use explicit shipped-migration paths, run the actual mutants there, require the intended assertion failures, save raw mutant outputs/exits and baseline hashes, and remove the scratch workspace in finally. Do not mutate any immutable evidence file in place. Keep all four existing meaningful mutations.
5. Separate adapted/frozen diagnostic receipts. Preserve existing logs and qualify unsupported historical claims. Do not rerun native/frontend full matrices for these docs and disposable models; cite accepted unchanged evidence and label restore simulation honestly.

## Deliver and stop

Write the corrected model/DDL/tests and receipts into a new `docs/evidence/m2-split-lineage-scope-round2-2026-10-08/` (use actual later date if applicable). Keep one authoritative candidate DDL there. A minimal import-only adapter may redirect frozen diagnostics to it; never rewrite their expectations to pass. Map each SL-R4–SL-R6 trigger to exact permanent tests, distinguish controls from failure reproductions, and preserve baseline/final exits, source hashes and SHA256SUMS. Verify all preserved and new pack checksums.

Update the live scope and conditional production assignment coherently. Update STATUS/handoff using latest main tracking text, retaining accepted C2 and prior gates. State “SL-R4–SL-R6 corrected, pending independent scope review; SL-D1–D8 proposed.” Do not claim acceptance or owner approval. Report branch/base, changed paths, exact proof/frozen counts, meaningful mutation results, remaining limitations and proposed decisions. Leave everything uncommitted/unpushed and stop for the reviewer. No production code, migration registration/schema bump, provider calls, real-account tests, packaging, signing or publication.
