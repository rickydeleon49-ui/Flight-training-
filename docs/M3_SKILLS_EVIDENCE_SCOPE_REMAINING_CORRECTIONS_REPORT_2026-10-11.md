# M3 skills evidence: remaining corrections M3-R8–R10 (11 October 2026)

**State: corrected, pending independent re-review.** This completes the interrupted R8–R10 package. It is not scope acceptance or owner approval. **M3-D1–D9 remain PROPOSED.** Candidate migration 0014 is unchanged and unregistered. Production M3 is not started. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.

- **Assignments:** [remaining corrections](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md) and [continuation](M3_SKILLS_EVIDENCE_REMAINING_PACKAGE_CONTINUATION_PROMPT_2026-10-11.md).
- **Reviews:** [re-review](M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md) and [interrupted-work completion review](M3_SKILLS_EVIDENCE_INTERRUPTED_WORK_COMPLETION_REVIEW_2026-10-11.md).
- **Corrected documents:** [scope](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and [conditional implementation prompt](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).
- **Evidence:** [`docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/`](evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/README.md).

## Identity

| | |
| --- | --- |
| Checkout | `/Users/rickymac/code/Flight-training-m3-skills-scope` |
| Branch | `codex/m3-skills-evidence-scope` |
| HEAD / base | `48fa47d9d035b2636b72fd6692930d85f4992bb9` |
| `origin/main` | `c28ab84` (#135). Fetched, not pulled; review documents read from `origin/main` |
| State | Uncommitted and unpushed |

The primary clone and its Mac preflight package were not touched.

**Before the R8–R10 edits:**
- the re-review's **127** frozen paths, the corrections pack's **64** checksums, the scope pack's **56**, **6** document hashes and **30** anchors verified (receipt `00`);
- the corrected submission was reproduced: 162 passed, tsc clean, 7 native (`02a`–`02c`);
- the re-review diagnostics were reproduced: **6 failed / 1 outage control passed** (TS/UI) and **1 failed / 1 control passed** (native) (`03a`, `03b`).

**Before the continuation:** the interrupted checkpoint's **145/145** paths matched the worktree, and the 127/64/56/6/30 identities verified against published git objects. No competing changes existed: #135 added review documents only and prepended review entries to STATUS and the handoff.

## Issue to fix

Paths are relative to `docs/evidence/m3-skills-evidence-scope-2026-10-10/`.

### M3-R8: acknowledge the complete draft

**Fix (`prototype/SkillEvidenceSpecimen.tsx`, `prototype/evidenceController.ts`).** The form holds its fields in one live draft:
- **Synchronous updates.** The live draft is updated in each change handler, never in an effect.
- **One rule for every path.** Create, **Replace the saved wording with this** and **Save it as a new observation** each capture the canonical fingerprint of the **complete** `ObservationDraft`: wording, date, attribution, instructor name, skill and debrief.
- **Clearing.** The form clears only when the complete live draft still equals the submitted one, and then only the wording; the date and attribution stay.
- **Otherwise every field is kept,** with *"Not saved yet: your changes to …"* naming exactly the differing fields. The controller's new `savedContent(key)` supplies the acknowledged content for that comparison.
- **Ownership.** Draft keys are scoped to the form instance, and an epoch counter and mounted flag drop answers for an earlier draft or a gone form.
- **Not used:** editing is not disabled while saving.

**Tests (`tests/remaining-ui.test.tsx`).** Each asserts stored rows and retained form values.
- `[M3-R8] a date change during the save keeps the complete draft, stores the original, and Replace applies it`
- `[M3-R8] a attribution change during the save keeps the complete draft, stores the original, and Replace applies it`
- `[M3-R8] a instructor name change during the save keeps the complete draft, stores the original, and Replace applies it`
- `[M3-R8] several changes at once (date, who said it and wording) are all kept and named`
- `[M3-R8] a change made in the same turn as the acknowledgment is still compared (no delayed publication)`
- `[control] an unchanged draft is cleared after its save, and the next note is a new observation`
- `[M3-R8] Replace: a change made while the replacement is saving is kept and offered again`
- `[M3-R8] Save as new: a change made while the new observation is saving is kept, and Replace targets the new one`
- `[M3-R8] a change made while the refresh after an acknowledged save is held is kept`
- `[M3-R8] an answer for a form that was replaced (skill switched away and back) cannot clear the newer form`
- `[M3-R8] a joined duplicate submit's answer cannot raise a follow-up on the form the first answer cleared` (added in the continuation)

**Before → after:** the three frozen R8 diagnostics fail (`03a`) and then pass (`08a`, `17a`).

### M3-R9: history → receipt ownership

**Fix.** Step 8 in `prototype/skillEvidenceValidation.ts` and its twin in `native/src/lib.rs`: every user catalog revision, observation revision and self-assessment must have the live receipt that wrote it, with the same operation, an action of that family, the same subject and the same revision or sequence.
- Combined with the existing receipt → history checks, ownership is one-to-one, so a removed receipt or a reused operation id is refused.
- Catalog seeds (no operation) need no receipt. Erased observations keep only their tombstones.
- No schema or dependency change; the native lockfile is identical.

**Fixtures (`scripts/generate_fixtures.py` → `fixtures/validation-cases.json`).**
- 13 cases added (85 total): **12 `history-ownership`** negatives and one control. The negatives cover a removed receipt for each history family, a later edit, a built-in retirement, a cleared confidence, an operation claiming two observation revisions, an assessment or catalog revision reusing an observation's operation, history owned by a tombstone, and mixed-up subjects.
- **Hand-written controls corrected rather than the guard loosened:** the original `retired custom skill with history` control gains its real `retire_skill` receipt. The catalog helpers now emit the receipts the writer would write, so each R6 negative still fails only for its intended reason.
- **New real-writer library** (`fixtures/writer-populated-schema14.sql`): a deterministic scenario run through the actual candidate writer, covering every history-writing action, an erase with tombstones and a cleared status. It regenerates byte for byte.

**Tests:**
- `tests/remaining-validation.test.ts`:
  - `[M3-R9] the committed writer fixture regenerates byte-identically from the real candidate writer`
  - `[M3-R9] a library written by the real writer validates, and losing any receipt that owns history is refused` (×2)
  - `[M3-R9] receipt removal cannot leave an accepted operation-owned history orphan (review case)` (×2)
  - `[M3-R9] erasure tombstones, catalog seeds and earlier receipts after later edits stay valid` (×2)
- `native/tests/contract.rs`: `writer_library_requires_the_receipt_of_every_history_row`.
- The shared contract on all three engines.

**Before → after:**
- frozen R9 fails, ×2 TS and native (`03a`/`03b`), then passes (`08a`/`08b`, `17a`/`17b`);
- on the corrected submission, the native validator wrongly accepted 11 of the 12 new negatives (`04b`). The twelfth, mixed-up subjects, was already refused by the receipt → history check.

### M3-R10: evict content after confirmed erasure

**Fix (`prototype/evidenceController.ts`).** `evictErased` runs when any answer says `ERASED`: opening history, paging history, or a save whose earlier request was erased.
- It clears that observation's revisions, cursor and current revision, and makes its pending history answers obsolete.
- It removes the observation from the visible list and re-reads the summary (reads only).
- Erased ids stay filtered from later list pages and history answers.
- A temporary failure keeps loaded pages and cursors.
- `HistoryViewState` gains `erased`.

**Tests:**
- `tests/remaining-controller.test.ts`:
  - `[M3-R10] confirmed erased history discards loaded text and cursor (review case), and leaves the list`
  - `[M3-R10] opening the history of an observation erased elsewhere evicts it from the list and the summary`
  - `[M3-R10] unrelated observations, and their history, stay`
  - `[M3-R10] a held older history page that arrives after the erasure is known cannot republish it`
  - `[M3-R10] a held evidence page read before the erasure cannot put the erased observation back in the list`
  - `[M3-R10] an erasure answer that lands after a route change leaves the new skill alone`
  - `[M3-R10] a save whose earlier request turns out erased evicts that observation too`
  - `[control] a temporary older-history read error preserves loaded history for retry (review control)`
  - `[control] a temporary failure opening history keeps the observation listed`
- `tests/remaining-ui.test.tsx`:
  - `[M3-R10] Show older versions after an erasure clears the versions and the list item, and says it was erased`
  - `[M3-R10] a held older page that lands after the erasure is known does not bring the wording back`
  - `[control] a temporary failure loading older versions keeps the loaded versions on screen`

**Before → after:** frozen R10 fails (`03a`) and then passes.

**Disclosure.** The promoted review control fails on the old source only because it also asserts the new `erased` field (`04a`). It is not counted as eviction evidence; the rendered, cache, unrelated-observation and late-page tests are.

## Historical diagnostics and their valid equivalents

| Diagnostic set on current source | Result | Receipt |
| --- | --- | --- |
| Re-review frozen diagnostics, exact files | 7/7 TS/UI, 2/2 native | `08a`, `08b`; final `17a`, `17b` |
| First review's frozen diagnostics, exact files | 16 passed / 5 failed (TS/UI); 4 passed / 1 failed (native) | `09a`, `09b` |
| …with `diagnostic-equivalents/review-validation-cases-with-receipt.json` | semantic restore 10/10 on node:sqlite and sql.js; native 5/5 | `10a`, `10b` |
| Valid-erase R2a equivalent (corrections pack) | R2a passes; only R4 ×2 fail | `11` |

The five first-review failures are all expected:
- **R2a:** its own invalid erase setup, which the re-review acknowledged. The valid-argument equivalent passes.
- **R4 ×2:** calls to the deliberately replaced unpaged `history(id)`. It is not reinstated; the paged equivalents pass.
- **The built-in retirement control (TS ×2 and native):** its hand-written revision has no owning receipt, so R9 now refuses it. The derived copy adds exactly that receipt (one case changed; baseline identical) and passes on all three engines. The frozen file is unchanged, and the malformed original stays refused.

## Sensitivity (receipts `sensitivity/`)

Each variant runs on an isolated scratch copy, with a fresh cargo target per native variant and a hash-checked restore. A control run first proves every named check passes on the final source and selects at least one test. Vitest does not typecheck and no variant changes an interface, so every kill is a failed behaviour assertion. **Exit 0.**

| Variant | Reverts | Result |
| --- | --- | --- |
| R8-1 | the form compares only the wording | caught by the date, attribution and instructor-name tests and the replace path. The "several changes" check also changes the wording, so it still passes, correctly |
| R8-2 | live draft published from an effect | **equivalent, not counted.** React 19 flushes a discrete input's commit and passive effects synchronously, so no rendered test can distinguish it. The form uses the handler update by construction |
| R8-3 | answers for an earlier draft not ignored | caught (joined duplicate submit) |
| R8-4 | draft key shared across form instances | caught (replaced form, then a new save) |
| R9-1/2/3 | TS: no receipt needed for observation revisions / catalog revisions / assessments | caught by the shared contract and the writer library |
| R9-4 | TS: a receipt may own any revision of its subject | caught (operation reuse) |
| R9-N1/N2/N3/N4 | the same four, natively | caught by the native contract and the writer library |
| R10-1 | an `ERASED` older page keeps the loaded versions | caught (rendered and controller) |
| R10-2 | eviction leaves the list item | caught |
| R10-3 | a late older page republished | caught (rendered and controller) |
| R10-4 | later list pages not filtered | caught |
| R10-5 | summary not re-read | caught |
| R10-6 | a temporary failure treated as erasure | caught by the outage controls, which proves they are meaningful |

## Reproducibility, hygiene and timing

- **Fixtures:** `validation-cases.json`, `constraint-cases.json` and `writer-populated-schema14.sql` regenerate byte for byte in a disposable copy (`12`).
- **Benchmark (`13`, `bench-results.json`).** It ran in a disposable copy whose `tests/bench.test.ts` differs only in its output path (redirected here); the earlier corrections-pack benchmark bytes are unchanged.
  - Restore validation is **3–9% slower** with the reverse-ownership checks: node:sqlite 257.9 ms at 10,000 observations (was 244.9); sql.js 394.1 ms (was 380.7).
  - Page reads are unchanged within noise.
  - These are source-level Node timings: no WKWebView, installed app or memory figure.
- **Hygiene:** `18` (whitespace and final newline on every new or changed file, plus `git diff --check`). One disclosed exception is reported in the receipt: the preserved checkpoint receipt `04a` contains trailing spaces in Vitest's raw DOM dumps of failing UI tests. It is kept byte for byte, as the assignment requires.
- **Invariants:** `19` (30/30 anchors; candidate 0014 and the native lockfile identical to published; production unchanged).

## Final gate on the final source

| Check | Result | Receipt |
| --- | --- | --- |
| Prototype Vitest, 13 files | **192 passed / 3 opt-in skipped**, exit 0 | `14` |
| Strict typecheck | clean | `15` |
| Native (fresh target) | **8 passed** | `16` |
| Exact frozen R8–R10 diagnostics | **7/7** and **2/2** | `17a`, `17b` |

One test was added after the checkpoint's 191, the joined-duplicate R8 regression. One comment was corrected in the same-turn test so it does not overclaim. No prototype source changed during the continuation.

Receipts `05`–`07` (191 tests at the checkpoint) are the interrupted model's and are preserved. `08a`–`11` ran on a copy whose prototype, fixtures and native sources are identical to the final ones; only test files changed afterwards, and no diagnostic depends on them.

## Remaining limits

- **Not built:** the native writer and readers are specified only.
- **UI evidence:** jsdom only.
- **R8 timing:** the handler-update guarantee is by construction (see R8-2).
- **Test names:** two R8 test names read "a attribution" and "a instructor name". They are kept so the recorded commands stay exact.
- **Not touched:** no login, live-library operation, provider call, app build, install, signing or release.

Stop for senior review.
