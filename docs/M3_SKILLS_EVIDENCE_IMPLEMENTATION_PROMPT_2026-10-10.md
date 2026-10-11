# M3 skills and feedback evidence: production implementation (CONDITIONAL)

**Do not start until both are true:**
1. A senior reviewer has accepted [`M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md`](M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md) and its evidence pack.
2. The owner has approved M3-D1–D9 as written, or with recorded changes.

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
| M3-D1 catalog | **Migration:** `src-tauri/migrations/0014_skills_evidence.sql`, **byte-identical** to `docs/evidence/m3-skills-evidence-scope-2026-10-10/candidate/0014_skills_evidence.sql`. It seeds the 15 built-in skills.<br>**Custom-skill actions:** create, edit, retire, restore.<br>**Rules:** built-ins are read-only to her; active-name uniqueness via `labelKey`; 200-skill cap. | Shared contract cases; `DUPLICATE_LABEL` / `BUILTIN_READ_ONLY` / `LIMIT_EXCEEDED` tests on both TS engines and native; the validator rejects unknown or missing built-ins. |
| M3-D2 status | `set_status`, with an expected sequence; NULL clears. No code path derives status. | Stale-sequence test. A test that completing actions, practice and card ratings leaves status NULL. |
| M3-D3 attribution | Two values only, in the decoders (TS and serde `deny_unknown_fields`), the table CHECK and the validator. The interface wording comes from the scope document §4. | Boundary refusal, table refusal and validator refusal of a widened CHECK. A UI text test finds no verified/proficient/ready/sign-off wording. |
| M3-D4 creation | `create_observation`:<br>• existing debrief required (`SOURCE_MISSING`);<br>• optional `sourceField` fingerprint;<br>• limits 2,000 characters / 8,000 bytes / 50 per debrief;<br>• no backfill or extraction. | Limit tests at the exact boundaries. The upgrade test proves existing debriefs gain no rows. |
| M3-D5 history | Every change appends a `skill_observation_revisions` row in the same transaction. Skill and source are immutable. Edits are conditional on `expectedRevision`. | History test. A stale double-edit test. The append-only triggers refuse direct UPDATE/DELETE. |
| M3-D6 sources | FK `SET NULL` with snapshots; no relink (null-safe `IS` CHECK); skills `RESTRICT`. Retire and restore. | Tests for a deleted, renamed or replaced debrief, a deleted or completed action, and a retired skill. All are validated after the change. |
| M3-D7 erasure | `erase_observation` (confirm `"erase"`): earlier receipts for the subject become tombstones, then the observation is deleted with its history by cascade. Later replays and id reuse → `ERASED`. The confirm dialog names what is erased and says earlier backups still contain it. | A scan of every table for unique wording after an erase finds nothing. A resurrection test. The validator rejects a tombstone whose subject is present. |
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
  - `save_skill_evidence_action` running the §6 contract inside `BEGIN IMMEDIATE` on one pinned connection, following the debrief/card-review pattern, with the same error codes;
  - read commands `read_skill_evidence_page`, `read_skill_summary`, `list_skills` and `read_observation_history`, with the bounded inputs of scope §7.
- `src-tauri/src/backup.rs`:
  - add `verify_schema_14_skill_evidence_semantics`, ported from `docs/evidence/.../native/src/lib.rs`;
  - call it from `verify_application_connection` for `newest_migration >= 14`.
- Native tests:
  - replay `src-tauri/fixtures/skill-evidence/{validation-cases.json, constraint-cases.json, operation-cases.json}`. Move the two existing fixtures from the evidence pack. Add operation cases covering create, retry, conflict, stale, link, addressed, erase and resurrection, with expected outcomes and rows.
  - add a populated schema-13 → 14 upgrade test.
  - add a backup/restore round trip, a tampered-backup refusal, and a test that a mid-transaction failure leaves nothing behind.

**TypeScript (browser/test twins and app wiring):**
- `src/data/migrations.ts` and `src/data/migration-checksums.json`: add 14. Update the existing "latest"/"latest+1" ceiling tests only as migration 13 did.
- `src/data/skillEvidenceTransaction.ts`, `src/data/skillEvidenceReader.ts`: from the prototype modules.
- `src/data/practiceStateValidation.ts`: add `validateSkillEvidenceState` and call it at ≥ 14.
- `src/data/db.ts`: optional methods `saveSkillEvidenceAtomically`, `readSkillEvidencePage`, `readSkillSummary`, `listSkills`, `readObservationHistory`.
- `src/data/tauriDb.ts`: invoke adapters with strict result shape checks, like `splitLineageShapes.ts`.
- `src/data/sqlJsDb.ts`, `src/data/testing/nodeSqliteDb.ts`: owned wiring.
- `src/data/repositories/skillEvidenceRepository.ts`: added to `createRepositories`. Drivers without the methods refuse writes with a clear error.
- `src/domain/types.ts`: the contract types from `prototype/types.ts`.
- `src/logic/skillEvidence.ts`: wording, thresholds and presentation helpers, with tests.
- `src/state/useSkillEvidence.ts`: the controller rules of scope §8 (generation, draft identity, check-before-resend, read-only refresh, dispose). It also re-reads when `dataRevision` advances. **Not** loaded through `AppDataContext`.

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
  - a lost answer followed by changed content reads before sending;
  - an acknowledged write is never resent;
  - a failed refresh shows "Saved" with a read-only refresh.
- **Publication:** route A→B→A, unmount and late pages never publish obsolete data.
- **Restore:** refuses a corrupted schema-14 database (any validation case) without replacing the current library. Older binaries refuse 14 with the existing message.

## Verification and evidence

1. **Focused tests first:** new TS tests on node:sqlite and sql.js, native tests, UI tests (jsdom), and the shared fixtures on all engines.
2. **Then the full local matrix once:**
   - `npm test`, `npm run typecheck`, `npm run build`
   - `cargo test --locked`, Clippy `-D warnings`, `cargo fmt --check`
   - `npm run test:cargo-lock`, `git diff --check`
3. **Write an evidence pack** `docs/evidence/m3-skills-evidence-implementation-<date>/` containing:
   - exact commands, cwd, output and exits;
   - targeted reversions for the idempotency conflict check, tombstoning, attribution decoding, transaction control, history append and validator triggers, each failing its named test;
   - benchmark reruns at 100 / 2,500 / 5,000 / 10,000 observations, reported as source-level only;
   - `source-hashes.json` and `SHA256SUMS`.
4. **Update docs:** STATUS, handoff and ROADMAP §8, adding history and keeping earlier entries.
5. **Claims:** do not claim installed or WKWebView behaviour. G1–G3 stay DEFERRED/UNEXECUTED/UNVERIFIED.

**Report** the checkout, branch, base, decisions as implemented, results, deviations and limitations. Then stop.
