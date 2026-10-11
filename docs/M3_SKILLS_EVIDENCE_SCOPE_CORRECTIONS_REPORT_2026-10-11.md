# M3 skills evidence: scope/prototype corrections M3-R1–R7 (11 October 2026)

**State: corrected, pending independent re-review.** This is not scope acceptance. **M3-D1–D9 remain PROPOSED**, pending owner approval; these technical corrections do not grant it. Candidate migration 0014 stays unregistered and byte-identical to the submission. Production M3 is not started. Installed G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED; post-receipt recovery remains BLOCKED / source-covered.

- **Assignment:** [corrections prompt](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md).
- **Review:** [independent review](M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md).
- **Corrected documents:** [scope](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and [conditional implementation prompt](M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md).
- **New receipts and manifests:** [`docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/`](evidence/m3-skills-evidence-scope-corrections-2026-10-11/README.md).

## Where this was done

| | |
| --- | --- |
| Checkout | `/Users/rickymac/code/Flight-training-m3-skills-scope` (the original submission worktree) |
| Branch | `codex/m3-skills-evidence-scope` |
| Base / HEAD | `48fa47d9d035b2636b72fd6692930d85f4992bb9` |
| `origin/main` | `db668dd` (#133, the review). Fetched, not pulled; the review documents were read from `origin/main` |
| State | Uncommitted and unpushed; no PR |

The primary clone `/Users/rickymac/code/Flight-training-` was not edited: it is still at `42c2df5`, with its separate pending Mac preflight files.

## Before editing

All verified **before any edit**, on the original dirty worktree:
- **57/57** frozen submitted hashes (`submitted-hashes.json`).
- **51/51** entries of the original `SHA256SUMS`.
- **30/30** production anchors, identical in the worktree, at `48fa47d` and on `origin/main`.

No competing change existed: the only commit after the base is #133, which touches no affected file. Receipt `00` re-verifies the same from git objects, reproducibly. It also lists which submitted paths the corrections changed.

The frozen state was reproduced on a disposable copy (base archive + the 57 submitted files + the review pack, with the review's diagnostics copied in as its README says):

| Frozen check | Result | Receipt |
| --- | --- | --- |
| Submitted Vitest | 102 passed / 2 skipped, exit 0 | `03a` |
| Submitted strict typecheck | clean, exit 0 | `03b` |
| Submitted native | 7 passed, exit 0 | `03c` |
| Review TS/UI diagnostics | **17 failed / 4 passed**, exit 1 | `04a` |
| Review native diagnostics | **3 failed / 2 passed**, exit 101 | `04b` |

## Issue to fix

Paths are relative to `docs/evidence/m3-skills-evidence-scope-2026-10-10/`. Each named test runs on node:sqlite and sql.js where marked ×2. Fixture cases run on node:sqlite, sql.js **and** rusqlite.

### M3-R1: save and request ownership

**Fix (`prototype/evidenceController.ts`).** There is one ownership record per draft key. It holds:
- the skill it belongs to;
- the controller lifetime;
- the exact pending request;
- the acknowledged fingerprint and revision;
- a blocked state;
- the flight and the fingerprint that started it.

How it behaves:
- **Draft identity survives acknowledgment and refresh.** The same content joins the flight, or returns the settled result. Only `startNewDraft(key)` resets a draft; the form calls it when it clears the wording it saved.
- **Ownership by skill.** Notices, errors, the follow-up refresh and the saving lock are published only while the record's skill is on screen (`owns`). "Saving" means a write for the skill on screen (`savingFor`), not one global flag.
- **Paging lock.** Every first-page generation change (open, refresh, refresh after a save, restart) releases the older-page lock (`newFirstPageGeneration`), and the late older page is dropped.

**Tests (`tests/corrections-controller.test.ts`):**
- `[M3-R1a] an acknowledged save keeps its draft identity while its refresh is held: a repeat submit writes nothing`
- `[M3-R1a] only an explicit new draft starts a fresh observation under the same key`
- `[M3-R1b] a late A acknowledgment cannot clear B's saving lock, announce on B, or refresh B`
- `[M3-R1b] a late A refusal cannot put an error or unlock on B`
- `[M3-R1b] A -> B -> A: A's late save lands on A again and announces there, never on B`
- `[M3-R1b] two draft keys on one skill keep the lock until both settle`
- `[M3-R1] the same submit fired twice in one event turn joins one request`
- `[M3-R1] a failed refresh after an acknowledged save stays 'saved'; recovery only reads`
- `[M3-R1c] a refresh that supersedes a held older page releases its lock; Show older works again`
- `[M3-R1c] a save's refresh also releases the older-page lock`

**Before → after:** the frozen R1a/R1b/R1c diagnostics fail before and pass after (`04a` → `10`). Reversions C1–C4 are caught.

### M3-R2: uncertain-save recovery and draft retention

**Fix (`prototype/evidenceController.ts`, `prototype/SkillEvidenceSpecimen.tsx`, `prototype/skillEvidenceReader.ts`).**
- **Same content after an unknown outcome:** the exact original request is resent, and the store replays it.
- **Changed content:** the earlier observation id is read with `history({observationId, limit: 1})`, which is now a status protocol:
  - *present* means the earlier create landed (the id was minted for that request and can never be reused);
  - *`ERASED`* means it landed and was erased (the reader checks for a tombstone). The record is blocked, so nothing is recreated until she explicitly starts a new observation;
  - *`NOT_FOUND`* is **not** proof. The exact original request is replayed as a fence through the serialized writer, so a still-pending original then only replays.
- **No duplicate create while the original is pending:** a changed submit waits for the in-flight request, then is decided.
- **Explicit outcomes (`SaveOutcome`):** `saved`, `earlier_saved` (with `justNow`), `unknown`, `erased` and `refused`. A definitive refusal frees new ids. `OPERATION_CONFLICT` stays blocked with a plain message and an explicit way forward.
- **The form** clears only acknowledged, unchanged wording. Otherwise it keeps her words and offers **Replace the saved wording with this** (`reviseSaved`, an edit with the saved revision) or **Save it as a new observation** (`startNewDraft`).
- `submitObservation` stays as a boolean view that is true only when the submitted draft itself is stored. The frozen diagnostics use it; screens use the outcome.

**Tests:**
- `tests/corrections-controller.test.ts`:
  - `[M3-R2a] a changed draft after an unknown outcome and an erase cannot recreate the erased save`
  - `[M3-R2a] the same content after an unknown outcome and an erase is refused as ERASED by the store`
  - `[M3-R2b] empty history is not proof: a still-pending original is fenced by replay, so there is one observation`
  - `[M3-R2] a held pending commit: a changed submit waits for it, then reports the earlier save without a second create`
  - `[M3-R2] a failed reconciliation keeps the draft and the original request; nothing is sent`
  - `[M3-R2] an earlier save is never reported as saving the new words; the explicit edit replaces them`
  - `[M3-R2] an ordinary validation refusal writes nothing and lets the next submission go out under new ids`
  - `[M3-R2] an id clash is an intelligible refusal with an explicit way forward`
  - `[M3-R2] Try again with the same content replays the exact original request`
- `tests/corrections-ui.test.tsx`:
  - `[M3-R2c] discovering an earlier save keeps the newly edited unsaved wording and says what saved`
  - `[M3-R2c] 'Replace the saved wording with this' edits the saved observation, then the form clears`
  - `[M3-R2c] 'Save it as a new observation' is an explicit fresh observation`
  - `[M3-R2] wording changed while a save is in flight is kept, not cleared`

**Before → after:** frozen R2b and R2c fail before and pass after. Reversions C5–C7 are caught.

**Frozen R2a has a setup defect.** It erases with `{…, expectedRevision: 1}`, but `erase_observation` takes exactly `action, operationId, observationId, confirm`. The submitted decoder refused that erase too (review receipt line 81), so as written the case never reached the resurrection it targets. The frozen file is unchanged. [`diagnostic-equivalents/review-diagnostics-valid-erase.test.ts`](evidence/m3-skills-evidence-scope-corrections-2026-10-11/diagnostic-equivalents/review-diagnostics-valid-erase.test.ts) changes only that argument (`confirm: 'erase'`):
- on the frozen code R2a then fails for the real reason, *expected 1 to be +0*: the erased observation was recreated (`11a`);
- on the corrected code it passes (`11b`).

**Superseded existing test.** `tests/controller.test.ts`, "edited content after an unknown outcome checks first…", asserted the R2c defect: it expected `true` for an earlier save. It now asserts `earlier_saved`.

### M3-R3: StrictMode lifecycle

**Fix.** The controller has symmetric `activate()` and `deactivate()`; `dispose()` is `deactivate()`.
- `deactivate` ends a lifetime: read, history and write callbacks from before it are obsolete.
- `activate` restores publication.
- The specimen declares the lifecycle effect **before** the load effect. A StrictMode replay (setup → cleanup → setup on one instance) therefore restores publication before loading, the replayed first read is dropped, and the live one publishes.
- StrictMode and meaningful cleanup are kept. The controller is still memoized per client.

**Tests (`tests/corrections-ui.test.tsx`, real `React.StrictMode`):**
- `[M3-R3] under real StrictMode the live replay generation finishes loading`
- `[M3-R3] held reads: the obsolete replay read is dropped and the live one publishes, in either order`
- `[M3-R3] after a real unmount, late answers publish nothing`
- `[M3-R3] a new client gets a new live controller; the old one's late answers are dropped`
- `[M3-R3] under StrictMode a save works end to end and the form clears only the saved wording`

**Before → after:** the frozen R3 diagnostic fails before and passes after. Reversion C8 is caught.

### M3-R4: complete revision access

**Fix (`prototype/skillEvidenceReader.ts`, `types.ts`, `candidateEngine.ts`, controller, specimen).**
- **Contract:** `readObservationHistory({ observationId, cursor?, limit })` returns `{ observationId, currentRevision, items, nextCursor }`. It holds 1–100 per page (`LIMITS.revisionPageMax`), default 20.
- **Cursor:** `["history", observationId, beforeRevision]`, bound to the observation and validated (2…current).
- **Absence:** `ERASED` and `NOT_FOUND` are distinguished.
- **Retention:** every revision is kept, with no edit cap; `LIMITS.revisionsMax` (a lifetime cap) is gone.
- **Specimen:** **View earlier versions** and **Show older versions**.
- **Native:** the command contract is in the implementation prompt.

**Deliberate API change.** The legacy `history(id) → ObservationRevision[]` is replaced. The frozen R4 diagnostic still calls it and now fails with *"observationId must be a UUID v4."* (`10`); it is retained unchanged. The equivalent permanent tests follow bounded pages to revision 1:
- `tests/corrections-reader.test.ts` (×2):
  - `[M3-R4] the earliest wording is reachable through bounded pages after 100 later revisions` (101 revisions: 2 pages at 100, and 15 pages at 7, with no gap or repeat);
  - `[M3-R4] a page holds 1-100 versions; the default is 20`;
  - `[M3-R4] a history cursor is bound to its observation and validated`;
  - `[M3-R4] newer revisions never move older pages; an erased observation is ERASED, an unknown one NOT_FOUND`.
- `tests/corrections-ui.test.tsx`: `[M3-R4] Show older versions reaches the earliest wording after more than 100 revisions` (102 versions).

**Before → after:** reversions C9–C10 are caught.

### M3-R5: receipt validation

**Fix.** `prototype/skillEvidenceResult.ts` (new) is the exact result decoder: exact keys per action, value types, safe positive integers, and the receipt's own subject. A create is revision 1; later changes are revision 2 or more. An erase result is `erased: true`. Its native twin is `decode_result` in `native/src/lib.rs`, with the same number bounds (an integral JSON number, 1 to 2⁵³−1).

**Replay** (`prototype/skillEvidenceTransaction.ts`) checks the receipt's action and subject and decodes the result. A damaged receipt is `STORAGE_FAILURE`; the unchecked cast is gone.

**Both validators** (`prototype/skillEvidenceValidation.ts` and native `verify_schema_14_skill_evidence_semantics`) require each live receipt to point at the history row that this same operation wrote, of the kind its action writes:
- catalog revision: `changed_by` user, with the edit/retire/restore status step;
- observation revision: the matching `change_kind`;
- self-assessment: the row whose `id` and `operation_id` are the operation.

Earlier receipts stay valid after later edits, a cleared status, or deleted sources and actions. Erasure rules:
- tombstones must be observation actions whose subject is gone;
- a live erase receipt needs its subject gone and no live receipt left for that subject;
- an orphan live receipt is refused.

**Ownership is enforced forward** (receipt → owned row). The review's own valid control has a built-in retirement revision without a receipt. To keep that control valid, a history row without a receipt is not refused.

**Tests:**
- Shared fixtures (`fixtures/validation-cases.json`): categories `receipt-shape` (11 cases, including the review case) and `receipt-ownership` (11 cases), plus controls:
  - `[M3-R5] earlier receipts stay valid after a later edit, a cleared status and a deleted debrief and action`
  - `[M3-R5] two links by different operations each own their own revision`
  - `[M3-R5] a complete erase: non-content tombstones and the erase receipt`
  - `[M3-R5] custom edit, retire and restore receipts own their history`
- `tests/corrections-reader.test.ts` (×2):
  - `[M3-R5] replaying a receipt whose result names another observation is STORAGE_FAILURE, not that identity`
  - `[M3-R5] earlier receipts still replay after later edits, a cleared status and a deleted debrief`

**Before → after:**
- frozen R5 fails before and passes after, in TS and natively (`04a`/`04b` → `10`/`12`);
- reversions C11–C13 and N1–N2 are caught.

### M3-R6: catalog restore semantics

**Fix.** Both validators now apply these rules:
- **Built-ins:** label, description, topic and catalog version pinned against the shipped revision 1 in **every** revision and the head.
- **Heads:** the head's catalog version must equal its latest revision.
- **Custom revisions:** no catalog version, and every revision is the learner's.
- **Legal steps only:** active→active must change wording (an edit); active↔retired must keep it; retired→retired is refused.
- **Active-name uniqueness** under the write path's `labelKey`. Retired names may repeat; a restore into an active name is refused.

**Native parity:** `label_key` uses the app's existing `unicode-normalization =0.1.25` for NFC (MIT OR Apache-2.0; already pinned in `src-tauri/Cargo.toml`, so it is not new to the app). It uses an explicit JavaScript `\s`/`trim` whitespace set, not `char::is_whitespace`, which differs at U+0085 and U+FEFF. The candidate crate's lockfile gained exactly the app's `unicode-normalization 0.1.25`, `tinyvec 1.13.2` and `tinyvec_macros 0.1.1`, with matching checksums.

**Tests (shared fixtures):**
- `catalog-pinned` (10 cases, including the review case).
- `catalog-names` (6 cases): the review case, NFD + upper case, no-break and ideographic spaces, byte-order marks, Greek final sigma, and a built-in restored into an active name.
- Controls:
  - `[M3-R6] a built-in retired and restored keeps its catalog wording`
  - `[M3-R6] a retired skill's name may be reused by an active skill`
  - `[M3-R6] two retired skills may share a name`
  - `[M3-R6] names that differ after normalization stay distinct (Straße / STRASSE)`
  - `[M3-R6] U+0085 is not whitespace to labelKey, so it does not collide`

**Before → after:**
- frozen R6a/R6b fail before and pass after, in TS and natively;
- reversions C14–C15 and N3–N5 are caught. N4 removes NFC; N5 switches to Rust's whitespace set.

### M3-R7: pagination during edits

**Fix (`prototype/skillEvidenceReader.ts`, controller, specimen).** The evidence order stays chronological (unchanged).

**Cursor.** It is now `[2, skillId, journalId, attribution, observed_on, created_at, id, fence]`:
- it is bound to the **normalized filters**; other filters → `INVALID_ARGUMENT`;
- every component is validated, and a fence beyond the current one → `INVALID_ARGUMENT`;
- the fence is the receipts table's maximum rowid, read with the page. Receipts are never deleted, so rowids only grow.

**Stale check.** Before a next page, each `edit_observation` committed after the fence places its observation *seen*, *unseen* or *out* of the filters, before and after the edit. A still-matching row that changed side → **`STALE_CURSOR`** (a new error code). Leaving the filters, wording-only edits, other lists, new rows and erasures are harmless.

**Controller.** On `STALE_CURSOR` it restarts from the first page with a notice ("Your evidence changed while you were looking through it…"); it never appends. Deduplication was rejected because it cannot recover an omission.

**Query plans:** the edits-after-fence query is `SEARCH skill_evidence_operations USING INTEGER PRIMARY KEY (rowid>?)`, and the fence is a maximum-rowid search. The existing page plans are unchanged, and there is no new index or SQL change.

**Tests (`tests/corrections-reader.test.ts`, ×2 unless noted):**
- `[M3-R7] a seen observation moved below the cursor is refused as STALE_CURSOR, never repeated`
- `[M3-R7] an unseen observation moved above the cursor is refused, never silently skipped`
- `[M3-R7] same-date ties: moving a seen row of a tied date below the cursor is detected`
- `[M3-R7] wording-only edits, edits that stay on their side, inserts and erasures keep the cursor valid, with no repeat or gap`
- `[M3-R7] an edit in another skill's list does not disturb this list's cursor`
- `[M3-R7] with an attribution filter, an attribution edit that brings a seen row back below the cursor is detected`
- `[M3-R7] a cursor is bound to its normalized filters and validated`
- `[M3-R7] restarting after STALE_CURSOR walks every observation exactly once`
- ×1:
  - `[M3-R7] Show older after a crossing edit restarts the list from the newest, with no repeat`
  - `[M3-R7] a late older page from before a restart is dropped`
  - `node:sqlite: the fence and edits-after-fence lookups are rowid searches, not scans`

**Before → after:** frozen R7 fails before and passes after (it explicitly accepts a typed `STALE_CURSOR`). Reversions C16–C18 are caught.

## API and schema choices

| Choice | Detail |
| --- | --- |
| Candidate SQL | **Unchanged**, byte-identical to the submission (receipt `02`). No migration, table, index or trigger was needed. |
| New error code | `STALE_CURSOR` |
| History API | `readObservationHistory({observationId, cursor, limit})` → page. Replaces `history(id)` (documented; frozen R4 retained) |
| Evidence cursor | Version 2 tuple with filters and fence; the legacy triple is now refused as forged |
| Controller | `saveObservation` → `SaveOutcome`; `reviseSaved`, `startNewDraft`, `openHistory`/`loadOlderHistory`/`closeHistory`, `activate`/`deactivate`. `submitObservation` is kept as a boolean view |
| Native dependency | `unicode-normalization =0.1.25` in the candidate crate only, the app's own pinned version |

## Existing tests and fixtures

- **Changed tests:**
  - `controller.test.ts`: the R2c expectation, and fake clients' history shape;
  - `writes.test.ts`: two history calls moved to the paged API;
  - `pagination.test.ts`: the plan test builds a version-2 cursor;
  - `contract.test.ts`: four new categories;
  - `bench.test.ts`: writes to the corrections pack and times the changed paths;
  - `scripts/generate_fixtures.py`: adds the cases.
- **Original 25 validation and 29 constraint cases:** unchanged. `validation-cases.json` grew to 72 (9 controls and 38 negatives added); the constraint file is identical.
- **Original receipts and the original `SHA256SUMS`:** preserved byte for byte. The original `run_sensitivity.py` is unchanged and is reused by the new script.

## Verification on the corrected code

| Check | Result | Receipt |
| --- | --- | --- |
| Prototype Vitest, 10 files | **162 passed / 2 opt-in skipped**, exit 0 (was 102) | `07` |
| Strict typecheck | clean, exit 0 | `08` |
| Native crate | **7 passed**, exit 0. 72 + 29 shared cases identical on three engines | `09` |
| Review TS/UI diagnostics | **18 passed / 3 failed** (R4 ×2 legacy API; R2a setup defect) | `10` |
| R2a valid-erase equivalent | frozen: fails for the real reason (`11a`); corrected: passes; only R4 ×2 fail (`11b`) | `11a`, `11b` |
| Review native diagnostics | **5 passed**, exit 0 | `12` |
| New regressions on the frozen code | TS: **53 failed / 12 passed** (the passes are positive controls). Native: 37 of the 38 new negatives wrongly accepted | `05`, `06` |
| Fixtures regenerate byte-identically | exit 0 | `13` |
| Hygiene | exit 0 | `14` |
| Sensitivity | **32 variants**: S1–S8 rechecked (8 caught; S4a masked, as before, by `ConnectionOwner`'s rollback). **23 new variants (18 TS, 5 native) all caught**; every file restored to its original hash | `sensitivity/` |
| Benchmarks | Pages flat; stale check about 0.012 ms per edit since the last page; validation about 45% slower and linear; history walk of 1,000 revisions in 10 pages | `bench.txt`, `bench-results.json` |

**Upgrade, rollback, erasure, replay and restore guarantees stay green** in the suite above:
- genuine populated schema 13 → 14 with retained rows identical;
- failed-upgrade rollback;
- erase leaves no wording;
- resurrection refused;
- cross-engine restore round trips;
- tampered backup refused;
- older binary refuses 14;
- native backup API copy.

The unchanged production guards and the shipped native ceiling test were not re-run: production is byte-identical (30/30 anchors), and the assignment says not to repeat an unchanged matrix.

**Found and fixed while verifying:**
- The first sensitivity run caught 30 of 33 variants, with S4a masked as expected. C10, C12 and N2 were *not* caught, because other guards also refused their test cases. Fixes: the history-cursor test gives the other observation enough revisions, and a same-kind ownership fixture plus its control were added. All are caught in the final run.
- The sensitivity script first matched no tests (vitest's `-t` is a regex) and later reused a stale cargo target. Both were fixed; the control step caught both before any variant ran.
- Loading the original variant list once wrote a `__pycache__/*.pyc` into the original pack's `scripts/`. The hygiene receipt caught it; it was removed, the script now disables bytecode writing, and the final sensitivity receipts come from that exact script.
- A tightening during development: a row re-entering a filtered list below the cursor is treated as stale.

## Reproduce (from the repository root; Node 22, rustup Rust, Xcode SDK)

```bash
python3 -I docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/verify_submission_identity.py
```

```bash
npx vitest run --config docs/evidence/m3-skills-evidence-scope-2026-10-10/vitest.config.ts
```

```bash
npx tsc --noEmit -p docs/evidence/m3-skills-evidence-scope-2026-10-10/tsconfig.json
```

```bash
cd docs/evidence/m3-skills-evidence-scope-2026-10-10/native && SDKROOT=$(xcrun --sdk macosx --show-sdk-path) cargo test --offline --locked
```

```bash
python3 -I docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/run_correction_sensitivity.py "$(mktemp -d)/copy"
```

```bash
M3_BENCH=1 npx vitest run --config docs/evidence/m3-skills-evidence-scope-2026-10-10/vitest.config.ts tests/bench
```

The frozen diagnostics run on a disposable copy, as in the review pack README. The corrections pack README lists the exact copy commands used for receipts `03`–`06` and `10`–`12`.

## Manifests

In the corrections pack:
- `SHA256SUMS`: every corrections-pack file except itself;
- `scope-pack-SHA256SUMS`: every current file of the scope pack;
- `changes-from-submission.json`: the 57 submitted paths with submitted and current hashes, plus every added file;
- `document-hashes.json`: the corrected scope, prompt, this report and the tracking documents.

The original pack's `SHA256SUMS` and `base-anchors.json` are unchanged. The anchor set is still complete, because the new prototype module imports no further production file.

## Remaining limits

- **Not built:** the native writer and the native readers (paged history, fenced cursors) are specified only.
- **UI evidence:** jsdom only, with no WKWebView or installed-app claim.
- **Benchmarks:** source-level Node timings.
- **The stale check is conservative**, and cursors are session-local.
- **Unicode case mapping** follows each runtime's tables.
- **Not touched:** no account login, app launch, production change, installer rebuild, signing, provider call or release.

Stop for senior review.
