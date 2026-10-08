# M2 split-source lineage scope and disposable proof — model-neutral assignment

Prepare the remaining M2-4 split-lineage increment after C2 source integration. Deliver a concrete contract, recommended owner defaults and a small disposable proof for independent review. This is authorized scope preparation, not production migration or feature activation. Keep pace; do not repeat accepted C2 planning or source audits.

## Start and preserve

Confirm the C2 source acceptance PR is merged and that origin/main contains `docs/M2_CARD_REVIEW_C2_SOURCE_ACCEPTANCE_2026-10-08.md` plus the accepted AppData revision/C2 implementation. Read STATUS, PROJECT_HANDOFF, ROADMAP §7, `docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md`, the source acceptance and the open-source adoption plan. Dated older entries are historical where superseded; the real-user check-in was waived, but installed/release gates were not.

The primary clone `/Users/rickymac/code/Flight-training-`, old integration clone and `/Users/rickymac/code/Flight-training-c2-implementation` contain preserved uncommitted work. Do not reset/stash/pull over them. Inventory available worktrees and reuse a suitable clean checkout. If none exists, create one isolated worktree from updated main with a `codex/` branch; record its actual path, branch and base. Check for competing lineage work before editing. Make no global toolchain, account or credential changes.

## Concrete outcome

Automatic/manual PDF split children currently have their own material records and generated study content. They lack a durable, explicit relationship to the original source and page range. Design the smallest addition that lets a user see where a part came from and navigate between related parts without guessing from titles or filenames.

1. Trace actual current code: domain types, document repository/import orchestration, split service/native splitter, MaterialDetail source display and backup/restore. Cite exact files/functions and identify where each original-source identifier and page range is known. Distinguish native split-result data from what is persisted today. Do not change the accepted splitter.
2. Define parent/source identity, child range, source content identity/version, PDF page index versus printed page label, nested manual splits, repeated imports and missing/deleted/replaced parents. Give concrete examples such as a child covering original PDF pages 101–300 whose own page 1 maps to original page 101. Preserve historical practice/card text and current material IDs.
3. Recommend explicit defaults for: source identity and hashing cost; relationship representation; nested-range mapping; legacy rows with unknown lineage; deletion/replacement retention; backup/restore and older-binary behavior. Label each decision proposed. Do not infer provenance from filenames, invent source hashes/ranges, silently cascade-delete children or rewrite old study history.
4. Allocate any proposed migration number from merged main; migrations currently end at 0012, but verify before naming the next one. Explain additive schema/index/FK choices and how browser and native paths enforce the same contract. Do not modify shipped migrations, CURRENT_SCHEMA_VERSION, production repositories or backup format during this scope task.
5. Define the minimal MaterialDetail UI: parent/source title, validated original range, sibling/parent navigation and honest unavailable/unknown states. Keep native Open/Reveal. A page-jump limitation must show the page number and a fallback. This task does not adopt an embedded viewer, annotations, OCR or a full-library index.

## Small executable proof

Use disposable SQLite fixtures and synthetic metadata only. Export the proposed mapping/validation helper so assertions execute the contract rather than duplicating it. Cover valid one-based/inclusive ranges, out-of-bounds/reversed/unknown ranges, nested composition, compatible restore, parent deletion/replacement, legacy unknown rows and repeated import identity. Where a relationship is proposed to be constrained by SQL, execute those constraints in the disposable schema. Show no original PDF bytes or immutable attempt/review snapshots change.

Keep the proof narrowly targeted. Reuse existing accepted source and backup tests as evidence for unchanged behavior; identify genuinely missing end-to-end acceptance separately. Do not run the complete application gate for docs/proof-only work unless production source changes unexpectedly become necessary; stop and report that scope conflict instead.

No new package is needed by default. Reuse existing helpers/dependencies where suitable. If a package is recommended, inspect its exact version, primary documentation/license, dependencies and offline/macOS-12 implications, and leave adoption proposed. Do not install libraries merely to advance the open-source checklist.

## Deliver and stop

Create `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md` (use actual date if later) with the current-code map, defaults table, storage/transaction contract, examples, failure/retention/restore behavior, minimal UI and implementation acceptance criteria. Include a reviewable production implementation prompt conditional on scope acceptance and owner decisions.

Write a new evidence folder with executable proof, exact commands/raw exits, source/proposal hashes, checksums and a short requirement-to-proof map. Update STATUS and PROJECT_HANDOFF to “split-lineage scope/proof prepared, pending review and owner defaults.” Preserve all accepted C2 evidence.

Leave changes uncommitted/unpushed for the senior reviewer. Return actual branch/base, changed paths, proof counts, recommended defaults and open decisions. Do not begin production migration, source feature implementation, provider calls, real-user data access, installed account testing, signing, packaging or release publication. Do not claim M2 complete.
