# Review OFFLINE-03a: manual study sets, history, origins and regeneration review

**What to review:**
- **Branch:** `claude/offline-03a-core-fixes`.
- **Location:** `/Users/rickymac/code/Flight-training-offline-03a-fixes` (local), or the PR once it's opened.
- **Base:** `750c90c`, PR #236's authoring core.
- **Start with:** `docs/OFFLINE_03A_REPORT_2026-10-19.md`.
- **The contract:** `docs/OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md`, revision 5, owner-approved. Don't ask for the five approved defaults or the revision-5 choice again.

**What this is:** Claude-authored work. Review it independently. Don't self-merge, and don't mark OFFLINE-03a accepted without green exact-head CI.

Focus on whether her content can be lost, mislabelled, leaked or duplicated:

1. **Atomic save** (`src-tauri/src/study_sets.rs`, `src/data/studySetTransaction.ts`):
   - TS/native parity of acceptance, refusal codes and messages;
   - history written before the overwrite, in one transaction;
   - the column-exact staleness check;
   - idempotent retry by operation id: create, edit and remove;
   - rollback on an injected failure;
   - the 2,000-entry retirement limit, with no eviction.
2. **Migration 0016:**
   - strictly add-only; 0001–0015 and checksums untouched;
   - `'restore'` added to the history reason CHECK (a recorded deviation);
   - schema-16 restore verification in both validators;
   - a schema-15 backup still restores.
3. **Card fingerprints:**
   - origin enters the canonical JSON only when present;
   - legacy hashes unchanged (independent vectors in `src/testing/cardOriginVectors.json`);
   - snapshot side tables written and verified;
   - tampering refused;
   - no reader of `card_versions.provider`.
4. **Editing interface** (`StudySetEditor.tsx`, `MaterialDetail.tsx`):
   - drafts survive failures;
   - synchronous locks;
   - stale refusal when the set changed after a dialog opened;
   - instructor corrections never relabelled;
   - legacy items get ids exactly once;
   - restore preserves the current set and joins retirement lists.
5. **Regeneration** (`GeminiJobs.tsx`, `RegenerationReviewDialog.tsx`, `studySetEditing.ts`):
   - a set holding her items is never replaced without review, including by a direct `saveAiStudySet` call;
   - exact repeats are held, near repeats block, and bring-back works;
   - Keep my items is the default;
   - Cancel writes nothing;
   - a retry after an uncertain save can't apply twice.
6. **Exports:**
   - instructor corrections excluded by default and filtered before serialization;
   - packet v1 carries no unknown fields and discloses label loss;
   - a manual set is never called AI-generated.
7. **Behaviour changes listed in the report:**
   - strict validation of Gemini saves;
   - out-of-range Gemini pages stored as no page;
   - unused `removeAiStudySet` now keeps history.

**Checks to run:**
- Use Node 22 and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.
- Reuse the receipts in `docs/evidence/offline-03a-2026-10-19/` for unchanged source.
- Rerun the focused suites named in the report, plus any diagnostic a concrete concern justifies.

**Not authorized:** provider calls, real profiles, keys, installers or release work.

**Your answer:** return one precise correction report, or accept with `VERDICT: GREEN`.
