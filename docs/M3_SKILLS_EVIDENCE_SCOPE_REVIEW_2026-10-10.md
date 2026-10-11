# M3 skills evidence scope — independent source review, 2026-10-10

**Decision: CORRECTIONS REQUIRED (M3-R1–R7).** Publish this package for collaboration; this is not scope acceptance, owner approval of M3-D1–D9, or authorization for production migration 0014. The corrections assignment is [here](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md).

## Reviewed identity and verification

- Submission: `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, HEAD/base `48fa47d9d035b2636b72fd6692930d85f4992bb9`; uncommitted at review time.
- Frozen submission: **57 paths** in [submitted-hashes.json](evidence/m3-skills-evidence-scope-review-2026-10-10/submitted-hashes.json). All **51/51** submitted evidence entries and **30/30** production anchors independently verified; the anchors also equal the base commit. The subject was not edited. Primary checkout's pending Mac preflight documents were not edited.
- Tests ran against a disposable copy of that base plus the exact submitted files, reusing the primary clone's installed dependencies. No installed profile, live library or provider was used. The publication preserves the submitted candidate and receipts; current ROADMAP/STATUS/handoff prepend this review, with their original submitted bytes preserved in `submitted-documents/`.

| Independent check | Result | Exit |
| --- | --- | --- |
| Submitted Vitest suite, unchanged | 102 passed / 2 opt-in skipped | 0 |
| Submitted strict prototype typecheck | clean | 0 |
| Submitted native crate, unchanged | 7 passed | 0 |
| Frozen reviewer TypeScript + UI diagnostics | **17 failed / 4 valid controls passed**, 21 cases | 1 |
| Frozen reviewer native diagnostics | **3 failed / 2 valid controls passed**, 5 cases | 101 |

The failing checks assert required behavior; they deliberately expose defects in the submitted reference. They are not passing product regressions yet. Receipt commands, exits, raw output and diagnostic sources are in the [review pack](evidence/m3-skills-evidence-scope-review-2026-10-10/README.md). A first native setup invocation failed with exit 127 because cargo was absent from its scoped PATH; the corrected invocation uses `/opt/homebrew/opt/rustup/bin` and passed the submitted suite. That setup error is retained, not attributed to the implementation.

The implementer's original 103 production migration guards, existing native future-schema test, benchmarks and sensitivity results were inspected as submitted evidence, not independently rerun. No full unchanged application matrix was run. The native writer remains specified, not built; jsdom is not installed WebKit evidence. Existing schemas 1–13, application source, dependencies, identifiers and installers remain unchanged.

## Confirmed findings and exact correction requests

Paths below are relative to `docs/evidence/m3-skills-evidence-scope-2026-10-10/` unless stated otherwise. Each finding blocks accepting this reference for production implementation; none changes the proposed owner defaults.

### M3-R1 — Save and refresh ownership ends too early (P1)

**References:** `prototype/evidenceController.ts:145`, `:197`, `:201`, `:206`.

Three controlled timing diagnostics fail:

- **R1a:** hold the read after a successful save, then submit the still-visible same draft. The controller deletes its identity and clears saving before the first submission settles. A new operation and observation are allocated: two writes instead of one. The form clears only when the first Promise resolves, so the gap is reachable in the specimen.
- **R1b:** begin A's save, open B, begin B's save, then resolve A. A clears B's saving flag and publishes A's Saved notice onto B; it also starts a read for whichever skill is currently displayed. Read generations alone do not own mutation continuations.
- **R1c:** start Show older, perform a first-page refresh, then resolve the obsolete older-page request. Its response is dropped but `loadingMore` remains true; all subsequent Show older requests are suppressed.

**Fix:** retain a settled/acknowledged draft identity through refresh and until the form explicitly transitions to a new draft. Track mutation ownership separately from read ownership (draft, skill/view generation and operation identity); every success, error and cleanup must respect that ownership. A late callback may settle its own durable draft result, but cannot clear a different operation's lock, announce success on another skill, or refresh that skill. Reset/invalidate pagination locks when first-page generation changes. Refresh retries remain read-only. Include both late success and late refusal, A→B→A, same-render duplicate events and refresh failure tests.

### M3-R2 — Observation history is not authoritative reconciliation; edited text is lost (P1)

**References:** `prototype/evidenceController.ts:168–176`; `prototype/SkillEvidenceSpecimen.tsx:167`.

- **R2a:** commit a create but lose its acknowledgment; erase that observation; change the uncertain draft and submit again. History is empty after erasure, so the controller allocates fresh ids and recreates an observation, bypassing the old tombstone.
- **R2b:** transport stops waiting while an earlier write may still execute. An empty history read lets the changed draft create a new observation; when the original write completes, there are two. An empty row set does not prove an unknown request was refused.
- **R2c (rendered UI):** the first save committed but its acknowledgment was lost. Enter different wording and retry. The controller discovers the first save, returns `true`, and the form clears the different, **unsaved** wording. Only the old wording is in storage.

**Fix:** retain the exact original decoded request, ids and fingerprint. Reconcile by replaying that exact idempotent request through the serialized writer, or by an equally authoritative operation-status protocol that resolves pending/committed/erased states. A mere history absence is never permission to allocate new ids. Tombstone/ERASED and OPERATION_CONFLICT must not silently become a new create. Resolve the earlier intent before offering an explicit fresh intent or edit. Return a discriminated result that distinguishes this exact draft saved from earlier draft saved, refused, erased and still unknown. Clear only the acknowledged submitted fingerprint; preserve changed/new wording and explain what actually saved. Preserve draft bytes when reconciliation fails. Do not suppress the issue by disabling recovery or weakening erasure tests.

### M3-R3 — StrictMode replay permanently disposes the live controller (P2)

**Reference:** `prototype/SkillEvidenceSpecimen.tsx:56–63`; actual app root uses `React.StrictMode` in `src/main.tsx`.

The first effect cleanup calls `dispose()` on the memoized controller. StrictMode setup replay reuses it, but `disposed` never returns to false. The real StrictMode wrapper stays at Loading your evidence indefinitely. The submitted UI tests omit that wrapper.

**Fix:** give mount setup and cleanup symmetric ownership. Restore a live lifecycle before the load effect runs, invalidate first-generation requests, and keep actual unmount callbacks obsolete. Do not remove StrictMode, remove cleanup, or recreate a controller on every render. Add actual StrictMode immediate and held replay reads plus real unmount and client-change tests.

### M3-R4 — The earliest retained wording becomes unreachable (P2)

**Reference:** `prototype/skillEvidenceReader.ts:245–249`; scope §3 D5 versus §4/§7.

Both engines accept an original observation and 100 edits: 101 revisions exist. `history(id)` always returns the newest 100 with no cursor or offset, so revision 1 is inaccessible. D5 says earlier versions are always visible; the screen contract separately says up to 100, without a way to reach older ones.

**Fix:** make 100 a maximum **page size**, not a lifetime visibility limit. Specify and prove bounded descending revision pagination (strict observation-bound cursor, no gaps/duplicates, stale/erased ownership) and Show older. Update the types, reader/store/client/UI contract and conditional production prompt consistently. Preserve every revision; do not impose a new lifetime edit cap or drop old rows. The frozen diagnostic records the submitted legacy API defect. If the corrected paged API intentionally changes the return shape, preserve the frozen file unchanged, document that incompatibility, and promote an equivalent regression that follows pages to revision 1. The meaningful assertion must remain earliest-wording reachability with bounded reads.

### M3-R5 — Backup validation accepts a receipt for another subject (P1)

**References:** `prototype/skillEvidenceValidation.ts:185–196`; `native/src/lib.rs:447–457`; replay cast in `prototype/skillEvidenceTransaction.ts:307–312`.

Starting from the accepted populated shared baseline, change only the create-observation receipt's result observation id to a different id. Its stored action still matches. Both TS engines and native accept it. Idempotent replay trusts that JSON and can return another observation's identity. Matching only `result.action` does not establish a valid result or ownership.

**Fix:** decode exact result shapes for every action, reject unknown/missing keys and invalid value types/ranges, bind result subject to receipt `subject_id`, and bind the result revision/sequence to its actual operation-owned history. Support valid earlier receipts after later edits, cleared status/confidence, source/action deletion, and erased subjects. Validate erase receipts separately; tombstones must be legal observation actions with no result content. Reject wrong subject, missing result fields, invalid revision/sequence and orphan/mismatched operation-history ownership consistently in both validators. Use shared positive and negative fixtures on all three engines. Replay must not trust an unchecked type assertion as validation.

### M3-R6 — Catalog rules hold on writes but not after restore (P2)

**References:** `prototype/skillEvidenceValidation.ts:144–163`; `native/src/lib.rs:376–409`.

Both TS engines and native accept:

- an unchanged built-in revision 1 followed by a fabricated revision 2 and matching head with a replacement label; built-ins are supposed to retain catalog wording;
- an active custom label `  NORMAL   approach and landing  ` colliding with active built-in `Normal approach and landing` under the write path's normalization.

The valid controls, including built-in retirement preserving wording, still pass. The issue is semantic restore validation, not missing SQL syntax guards.

**Fix:** validate pinned built-in label/description/topic/catalog version for every revision and head, while allowing legitimate retire/restore status history. Validate origin/version consistency and active normalized-label uniqueness across built-ins and custom skills using the same normalization contract as writes. Retired-name reuse remains allowed; restore into an active collision remains refused. Preserve NFC, whitespace and case rules across TS/native; SQLite NOCASE alone is insufficient. Add shared controls and tampered cases. No arbitrary new built-in names or owner policy changes.

### M3-R7 — Editable dates make the pagination cursor unstable (P2)

**References:** `prototype/skillEvidenceReader.ts:5–7`, `:76–108`; `prototype/skillEvidenceTransaction.ts:474`.

Both engines: record dates October 3, 2 and 1; read October 3 as a one-item page; edit that same observation to September 30; read the next page using the old cursor. The already-shown observation appears again. Moving an unseen record above the cursor conversely risks omission. Stable tie-breakers do not stabilize an editable primary sort key.

**Fix:** define a bounded, deterministic contract for edits during a paging session. Preserve chronological presentation by detecting a relevant change and explicitly rejecting/resetting stale cursors, or use a proved snapshot/version strategy; justify any alternative ordering before changing the scope. Bind cursors to normalized filters and validate all components. The controller must restart coherently rather than append stale pages. Deduplicating ids alone is insufficient because it cannot recover unseen omissions. Test edits crossing both directions, same-date ties, insert/erase, filter changes and late page responses; recheck affected query plans and benchmarks only.

## Handoff and integration limits

The publication is a **documentation/evidence review package**, not accepted product code. Original receipts remain intact; the failures above supersede the submission's readiness claims. Correct all seven groups together in the scope/prototype worktree and leave corrections uncommitted/unpushed for independent re-review. The conditional production assignment remains inactive until technical acceptance and recorded owner approval of M3-D1–D9.

Installed G1–G3 remain **DEFERRED / UNEXECUTED / UNVERIFIED**; post-receipt recovery remains **BLOCKED / source-covered**. No account login, install, real data operation, application rebuild, signing, provider use or release publication is part of this review or the correction task.
