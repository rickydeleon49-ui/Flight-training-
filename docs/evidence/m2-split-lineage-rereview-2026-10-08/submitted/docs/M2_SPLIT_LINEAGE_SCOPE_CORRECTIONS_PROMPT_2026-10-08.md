# M2 split-source lineage scope corrections — model-neutral assignment

Finish one focused planning/proof correction round for SL-R1–SL-R3. Preserve the useful split-flow audit, basic one-based composition, child-preserving deletion and legacy-unknown policy. Do not restart C2 or implement production lineage yet.

## Start from the exact submitted work

Use `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD/base `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. It is intentionally uncommitted. Verify the six hashes in the original evidence `source-hashes.json` and its nine SHA256SUMS entries before editing. Report competing changes and preserve them; no reset/stash/pull over the dirty tree. Fetch/read reviewer documents from origin/main without applying them over the checkout.

Read `docs/M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md` and this prompt. Run the original 13-case proof and the frozen `docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs`. Baseline: original proof 13 pass; frozen reviewer 2 pass / 5 fail. Preserve receipts. Original evidence stays immutable; author the corrected model/DDL/tests in a new correction pack. If its API changes, add a small forwarding adapter for frozen diagnostics and disclose only that adapter; preserve their behavioral assertions. The old frozen diagnostic imports the old pack, so explicitly direct it to the corrected exported model for final verification.

## SL-R1: exact source/version and transaction contract

Separate immutable original-root identity/version from the immediate-parent identity/version. Decide which snapshots survive parent/root deletion and how repeated identical imports remain distinct. Define every title, hash, page-total and range field unambiguously; hash matching alone does not merge independently imported materials.

Persist/prove this example: root R=400 pages; parent A covers R 101–300 (200 pages); child B takes A 20–40 (21 pages), therefore B covers R 120–140. Opening A uses page 20; opening R uses page 120. Do not call 21 the root total or use A's content hash to certify R's bytes. A legacy parent with unknown lineage cannot magically gain an earlier root.

Provide a proposed read-only availability/version verdict with matching, changed, missing and unknown states. Current source bytes/version must actually be compared by the model boundary, not two hashes in a test. Specify when current hashes are read/cached and when equality is unknown; keep all hashing outside render. Group sibling parts by the appropriate parent/source version or split group so replacement editions do not mix.

Define typed proposed split-result/save inputs and atomic material/tag/lineage writes, tied to the exact source bytes that were split. Specify stale-parent/root validation, deletion/replacement between split and commit, cancellation, failure rollback/output-file cleanup, acknowledged save followed by failed refresh, retry/idempotency and nested lineage validation. Reuse accepted transaction ownership patterns; this task only prepares/contracts/proves them in disposable SQLite. Do not modify the real splitter or save APIs.

Remove unsupported hashing timing and material-percentage claims, or clearly mark estimates as unmeasured. No benchmark campaign is needed for this correction.

## SL-R2: enforce real bounds and relational identities

Make page mapping receive the recorded source end or child length. Reject child page 201 for a 200-page child, plus zero/fractional/non-finite/unsafe positions. Preserve valid endpoint mappings and nested arithmetic without overflow.

Use one authoritative candidate migration file in the correction pack. Execute that actual DDL in the proof. Enforce NOT NULL child identity, INTEGER storage for physical page fields/level, valid order/totals, no self-parent/self-root and the chosen nested identity consistency. Define bounded integer limits consistent with the native PDF API. Preserve legitimate nullable live references and legacy unknown states. Where checks belong in a validated save helper rather than SQL, state that and exercise the helper; don't claim SQLite enforces what it doesn't. Add meaningful insert/update refusal controls and prove failed batch save cannot leave materials without required lineage.

## SL-R3: faithful schema and honest evidence

Initialize disposable SQLite by executing the actual shipped migrations 0001–0012 from accepted main. Do not hand-write replacement tables or merely seed migration numbers. Apply the candidate DDL as an additive proposal. Seed representative accepted practice_attempts/responses and card_review_state/events with their actual version/item constraints, using existing fixture helpers where feasible.

Verify relevant populated rows before/after candidate migration, split save, parent deletion/replacement and disposable export/reopen. Use temporary synthetic PDF files if making byte-preservation claims; hashing an untouched constant Buffer is not a file-operation proof. Keep accepted immutable histories unchanged where the retention policy requires it.

For restore/version compatibility, distinguish a numeric simulation, a disposable migrated-database reopen and an actual native backup validator. Cite existing accepted native refusal/restore evidence for unchanged behavior; don't claim the not-yet-built schema-13 binary was tested. Do not run the entire app/native matrix or alter backup production code during this planning round.

Replace the disconnected negative-controls script with a few real mutations of the exported model/candidate DDL in isolated scratch copies. Run the relevant actual tests, require an expected semantic assertion failure, then restore/hash-check exactly. A surviving mutant or unrelated startup exception must fail the verifier, not count as caught. Keep old receipts and describe their limits honestly.

## Deliver, verify, stop

Write a new `docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/` (use actual later date if needed) with corrected exported model, authoritative candidate DDL, focused tests, baseline/final frozen receipts, real sensitivity results, commands/raw exits, requirement map and checksums. Capture the corrected source/scope/document hashes. Preserve the original scope pack and reviewer pack byte-for-byte.

Update the live scope/defaults and conditional production prompt to the coherent corrected contract. Keep SL-D1–D8 proposed; add or consolidate a decision only when necessary, explaining its user-visible effect. Update STATUS/handoff to “SL-R1–SL-R3 corrected, pending independent scope re-review; owner defaults not approved.” Preserve accepted C2 rows and read latest main tracking text before reconciling updates.

Leave uncommitted/unpushed for the senior reviewer. Report branch/base, changed paths, actual proof counts, hash counts, remaining limitations and recommended owner choices. Stop. No shipped migration, schema version bump, application source/dependency change, provider call, real profile/account test, signing, packaging or release publication is authorized.
