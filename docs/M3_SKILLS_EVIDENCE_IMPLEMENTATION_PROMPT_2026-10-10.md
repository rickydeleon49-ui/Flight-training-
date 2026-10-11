# M3 skills and feedback evidence: production implementation (CONDITIONAL)

**Do not start until both are true:**
1. A senior reviewer has accepted [`M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md`](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and its evidence pack, **including the M3-R1–R7 corrections** ([report](M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md)) **and the M3-R8–R10 remaining corrections** ([report](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md)), after independent re-review.
2. The owner has approved M3-D1–D9 as written, or with recorded changes.

*Corrected 11 October 2026 for M3-R1–R7: paged revision history, filter-bound fenced evidence cursors with `STALE_CURSOR`, exact receipt results with operation ownership, restored-catalog semantics with native `labelKey` parity, and the controller's write ownership, uncertain-save reconciliation, explicit outcomes and symmetric lifecycle. Corrected again for M3-R8–R10: whole-draft form acknowledgment and ownership, history → receipt ownership in both validators, and eviction of confirmed-erased content. These corrections remain inactive until both conditions above are met.*

If either is missing, stop and report. This prompt is model-neutral.

## Assignment

Implement the first M3 vertical slice of Her Flight Deck, a Tauri 2 Mac app with a React/TypeScript frontend and SQLite/Rust storage. The slice is:
- a versioned skill catalog with custom skills;
- deliberate debrief observations with honest attribution and append-only history;
- explicit links to existing follow-up actions with a separate "addressed" choice;
- learner-set status and confidence;
- a paged evidence history.

Deliver one cohesive, reviewable change. Leave it uncommitted and unpushed for review.

## Start safely

- **Repository:** `/Users/rickymac/code/Flight-training-`. Fetch, inspect branch/HEAD/status, and read `CLAUDE.md`, the scope document, the owner approval record and the evidence pack README.
- **Working copy:** create one isolated worktree from current `origin/main` with a `codex/` branch. Preserve any dirty primary checkout: no pull, reset, stash or clean over it.
- **Migration number:** recheck main. If anything newer than 0013 has landed, renumber the candidate (content unchanged) and say so.
- **Out of scope:**
  - new dependencies
  - provider calls
  - app launches against real data
  - installer, signing or release work
  - hfdtest requests (installed verification stays deferred)

## Decisions to implement, and how each is verified

| Default | Implementation | Verification |
| --- | --- | --- |
| M3-D1 catalog | **Migration:** `src-tauri/migrations/0014_skills_evidence.sql`, **byte-identical** to `docs/evidence/m3-skills-evidence-scope-2026-10-10/candidate/0014_skills_evidence.sql`. It seeds the 15 built-in skills.<br>**Custom-skill actions:** create, edit, retire, restore.<br>**Rules:** built-ins are read-only to her; active-name uniqueness via `labelKey` (NFC, JavaScript whitespace trimmed and collapsed, lower-cased); 200-skill cap.<br>**Restore validation:** built-in label, description, topic and catalog version pinned in every revision and the head; custom revisions carry no catalog version; only legal steps (edit = active→active with changed wording; retire/restore keep wording); unique active names under the same `labelKey`, natively with the app's existing `unicode-normalization` and the same explicit whitespace set as JavaScript `\s`. | Shared contract cases, including the `catalog-pinned` and `catalog-names` categories (Unicode NFC, no-break/ideographic/BOM whitespace, final sigma, U+0085 control); `DUPLICATE_LABEL` / `BUILTIN_READ_ONLY` / `LIMIT_EXCEEDED` tests on both TS engines and native; the validator rejects unknown or missing built-ins. |
| M3-D2 status | `set_status`, with an expected sequence; NULL clears. No code path derives status. | Stale-sequence test. A test that completing actions, practice and card ratings leaves status NULL. |
| M3-D3 attribution | Two values only, in the decoders (TS and serde `deny_unknown_fields`), the table CHECK and the validator. The interface wording comes from the scope document §4. | Boundary refusal, table refusal and validator refusal of a widened CHECK. A UI text test finds no verified/proficient/ready/sign-off wording. |
| M3-D4 creation | `create_observation`:<br>• existing debrief required (`SOURCE_MISSING`);<br>• optional `sourceField` fingerprint;<br>• limits 2,000 characters / 8,000 bytes / 50 per debrief;<br>• no backfill or extraction. | Limit tests at the exact boundaries. The upgrade test proves existing debriefs gain no rows. |
| M3-D5 history | Every change appends a `skill_observation_revisions` row in the same transaction. Skill and source are immutable. Edits are conditional on `expectedRevision`. Every revision stays reachable through `read_observation_history` pages (at most 100 per page, an observation-bound cursor, down to revision 1). There is no edit cap. | History test. A stale double-edit test. The append-only triggers refuse direct UPDATE/DELETE. A walk of more than 100 revisions reaches the first wording with no gap or repeat, on both TS engines and natively. |
| M3-D6 sources | FK `SET NULL` with snapshots; no relink (null-safe `IS` CHECK); skills `RESTRICT`. Retire and restore. | Tests for a deleted, renamed or replaced debrief, a deleted or completed action, and a retired skill. All are validated after the change. |
| M3-D7 erasure | `erase_observation` (confirm `"erase"`): earlier receipts for the subject become tombstones, then the observation is deleted with its history by cascade. Later replays and id reuse → `ERASED`; its history read is `ERASED`, not `NOT_FOUND`. The confirm dialog names what is erased and says earlier backups still contain it. | A scan of every table for unique wording after an erase finds nothing. A resurrection test, including through the form after an uncertain save. The validator rejects a tombstone whose subject is present, a tombstoned skill action, and an erase that left a live receipt. **Screen (M3-R10):** once any answer says `ERASED`, the observation's loaded revisions, cursor and list entry are gone; the summary is re-read; a held late page cannot restore them; a temporary read failure keeps loaded pages. Proven with rendered and late-page tests. |
| M3-D8 actions | `link_action` / `unlink_action` / `set_addressed`, each idempotent and recorded in history. `next_actions` is never written. Completion is shown separately with the scope document's sentence. | The action row is unchanged after link and mark. A deleted action keeps its name. Completion leaves `addressed_at` NULL. |
| M3-D9 confidence and wording | `set_confidence` 1–5/NULL, separate from status. Evidence sentence thresholds live in `src/logic/skillEvidence.ts` (fewer than 3 observations, or fewer than 2 lessons → limited). The fixed disclaimer is on the skill page. | Logic unit tests for none/limited/recorded. UI tests for the sentences and disclaimer. |

## Files to change or add

**Native (owns writes on the pinned connection):**
- `src-tauri/src/lib.rs`:
  - register migration 14 in `migrations()`;
  - set `CURRENT_SCHEMA_VERSION = 14`;
  - add the commands to `generate_handler!`.
- `src-tauri/src/skill_evidence.rs` (new):
  - serde-decoded `SkillEvidenceAction` with `deny_unknown_fields`, the same limits, and the same canonical JSON and SHA-256 request hash as `canonicalJson`;
  - `save_skill_evidence_action` running the §6 contract inside `BEGIN IMMEDIATE` on one pinned connection, following the debrief/card-review pattern, with the same error codes. A replay decodes the stored result exactly (the prototype's `decode_result`) and checks it names the request's subject; a damaged receipt is `STORAGE_FAILURE`;
  - read commands with the bounded inputs of scope §7:
    - `read_skill_evidence_page({ skillId, journalId, attribution, cursor, limit })`. The cursor is `[2, filters…, key…, fence]`, bound to the normalized filters (`INVALID_ARGUMENT` otherwise). The fence is the receipts table's maximum rowid, read with the page. The next page refuses with `STALE_CURSOR` when an edit after the fence moved a still-matching observation to another side of the cursor;
    - `read_skill_summary`;
    - `list_skills`;
    - `read_observation_history({ observationId, cursor, limit })` returning `{ observationId, currentRevision, items, nextCursor }`, with 1–100 per page (default 20), a `["history", observationId, beforeRevision]` cursor, `ERASED` for an erased observation and `NOT_FOUND` for an unknown one.
- `src-tauri/src/backup.rs`:
  - add `verify_schema_14_skill_evidence_semantics`, ported from `docs/evidence/.../native/src/lib.rs`, including `label_key`, `decode_result`, the catalog step rules and receipt ownership in **both directions** (`unicode-normalization` is already an app dependency at `=0.1.25`). Receipt → history: each live receipt owns the row it names. History → receipt (M3-R9): every user catalog revision, observation revision and self-assessment has its live receipt with the same operation, action family, subject and revision or sequence; catalog seeds need none;
  - call it from `verify_application_connection` for `newest_migration >= 14`.
- Native tests:
  - replay `src-tauri/fixtures/skill-evidence/{validation-cases.json, constraint-cases.json, operation-cases.json}`. Move the existing fixtures (85 validation and 29 constraint cases, and the real-writer library `writer-populated-schema14.sql`) from the evidence pack. Add operation cases covering create, retry, conflict, stale, link, addressed, erase, resurrection and replay of a damaged receipt, with expected outcomes and rows.
  - add a populated schema-13 → 14 upgrade test.
  - add a backup/restore round trip, a tampered-backup refusal, and a test that a mid-transaction failure leaves nothing behind.

**TypeScript (browser/test twins and app wiring):**
- `src/data/migrations.ts` and `src/data/migration-checksums.json`: add 14. Update the existing "latest"/"latest+1" ceiling tests only as migration 13 did.
- `src/data/skillEvidenceTransaction.ts`, `src/data/skillEvidenceReader.ts`, `src/data/skillEvidenceResult.ts`: from the prototype modules.
- `src/data/practiceStateValidation.ts`: add `validateSkillEvidenceState` and call it at ≥ 14.
- `src/data/db.ts`: optional methods `saveSkillEvidenceAtomically`, `readSkillEvidencePage`, `readSkillSummary`, `listSkills`, `readObservationHistory`.
- `src/data/tauriDb.ts`: invoke adapters with strict result shape checks, like `splitLineageShapes.ts`.
- `src/data/sqlJsDb.ts`, `src/data/testing/nodeSqliteDb.ts`: owned wiring.
- `src/data/repositories/skillEvidenceRepository.ts`: added to `createRepositories`. Drivers without the methods refuse writes with a clear error.
- `src/domain/types.ts`: the contract types from `prototype/types.ts`.
- `src/logic/skillEvidence.ts`: wording, thresholds and presentation helpers, with tests.
- `src/state/useSkillEvidence.ts`: the controller rules of scope §8. **Not** loaded through `AppDataContext`. The rules are:
  - read generations, with the older-page lock released on every first-page generation;
  - `STALE_CURSOR` restart;
  - one ownership record per draft key, owned by its skill, keeping the exact request until resolved;
  - uncertain saves resolved by exact replay, or by an observation-id read where present is proof, `ERASED` blocks, and `NOT_FOUND` is followed by the exact-replay fence;
  - explicit `SaveOutcome`s, with `reviseSaved`/`startNewDraft` as the only ways forward;
  - read-only refresh;
  - symmetric `activate`/`deactivate` for StrictMode;
  - eviction of confirmed-erased observations from history, list and summary, with erased ids filtered from later answers (M3-R10).

  It also re-reads when `dataRevision` advances.

**Interface:**
- `src/pages/FlightJournal/JournalEntryDetail.tsx`: a "Skill evidence" card and add-observation `<dialog>` via `useModalDialog`. Keep its fallback.
- `src/pages/FlightPath/`:
  - a Skills section;
  - a skill page at `/flight-path/skills/:skillId`, registered in `src/App.tsx`;
  - history paging, item menu, history view and erase confirmation.
- Wording comes from scope §4: warm and plain, no approval language.

## Failure behaviour that must hold

- **Atomicity:** any refusal or storage error leaves every table unchanged, receipt included. Prove it with a fault seam on both TS engines and natively.
- **Retries:** a retry with the same id and content replays and never re-applies over later edits. A different content under the same id is `OPERATION_CONFLICT`.
- **Lost answers and refreshes:**
  - a lost answer followed by changed content resolves the earlier request first. Present means earlier saved; erased means nothing is recreated; not found means the exact earlier request is replayed as a fence. It is never treated as permission to send new ids;
  - a pending original and a changed create never coexist;
  - the form compares the **complete** draft (wording, date, attribution, instructor name, skill and debrief) with a synchronously updated live draft before clearing, on every submission path. It keeps every changed field, names what is unsaved, scopes its draft key to the form instance, and ignores answers for an earlier draft (M3-R8);
  - an acknowledged write is never resent, and its draft identity survives until an explicit new draft;
  - a failed refresh shows "Saved" with a read-only refresh.
- **Publication:**
  - route A→B→A, unmount and late pages never publish obsolete data;
  - a late write for one skill never clears another skill's lock, announces there or refreshes it;
  - React StrictMode is kept, and the live replay generation loads.
- **Paging:** a date edit crossing a cursor never repeats or skips an observation. The list restarts from the newest.
- **Restore:** refuses a corrupted schema-14 database (any validation case) without replacing the current library. Older binaries refuse 14 with the existing message.

## Verification and evidence

1. **Focused tests first:** new TS tests on node:sqlite and sql.js, native tests, UI tests (jsdom), and the shared fixtures on all engines.
2. **Then the full local matrix once:**
   - `npm test`, `npm run typecheck`, `npm run build`
   - `cargo test --locked`, Clippy `-D warnings`, `cargo fmt --check`
   - `npm run test:cargo-lock`, `git diff --check`
3. **Write an evidence pack** `docs/evidence/m3-skills-evidence-implementation-<date>/` containing:
   - exact commands, cwd, output and exits;
   - targeted reversions for:
     - the idempotency conflict check, tombstoning, attribution decoding, transaction control, history append and validator triggers;
     - receipt subject and ownership binding, pinned built-ins, `labelKey` NFC/whitespace parity, the stale-cursor check and filter binding, history-cursor binding, draft-identity retention and skill ownership;

     each failing its named test;
   - benchmark reruns at 100 / 2,500 / 5,000 / 10,000 observations, reported as source-level only;
   - `source-hashes.json` and `SHA256SUMS`.
4. **Update docs:** STATUS, handoff and ROADMAP §8, adding history and keeping earlier entries.
5. **Claims:** do not claim installed or WKWebView behaviour. G1–G3 stay DEFERRED/UNEXECUTED/UNVERIFIED.

**Report** the checkout, branch, base, decisions as implemented, results, deviations and limitations. Then stop.
