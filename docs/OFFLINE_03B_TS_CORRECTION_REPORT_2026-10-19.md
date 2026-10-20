# OFFLINE-03b TS correction report — r4 (2026-10-19)

Round 4 scope: five maintained regression tests for version numbering and
ownership across pruning. Receipts: `docs/evidence/offline-03b-2026-10-19/ts-correction-r4/`.
Model used: `qwen/qwen3.8-flash`. Reviewer (Claude) will independently retest.

## Source SHA256 (shasum -a 256, after this round)

- `7671be5892b2078b8e3f9864790b4fe865959f6e4ba572f992d6f25f7dc0a216`  src/data/practiceAuthoring.ts
- `1b760c2f8bd67f6edd7ea86046cd4f9437623818b651e2eb4274e51071b9251a`  src/data/practiceAuthoring.test.ts
- `49d671dba18e5caa63e5141afba0fd76ae2f617295e58ea3a77fb2a6877b3237`  src/data/practiceStateValidation.ts
- `d1937542e48016c1d024c800080709910436c54ef57f0f0a795898c51cf4973c`  src/data/repositories/documentRepository.ts

## Files changed this round

- `src/data/practiceAuthoring.test.ts`: added `describe("version numbering and ownership survive pruning", …)`
  with exactly five tests. The three helpers `snapshotOfMaterial`, `addMaterial`, `seedStoredVersion`
  are now used; none deleted or renamed.
- No production change: `practiceAuthoring.ts` hash is identical to the reviewer's stopped-tree hash
  (`7671be58…`). Step 3 (case-(b) fix) was not needed — all five tests passed as written.

## Five tests (all passed)

1. version numbers keep rising across repeated remove and recreate (1 → 2 regenerate → prune to 0 rows → 3 → 4)
2. a completed-attempt survivor still counts toward the next version number (survivor `version_number` = 1 via `f.db.select`; next = 2)
3. history-only ownership blocks another living material, with no partial writes (five table counts unchanged; refusal `INVALID_ARGUMENT`; positive control: after deleting the owning material the same claim succeeds)
4. a legacy row's own id is owned by its living material (fallback identity) (both refusals `INVALID_ARGUMENT`; the `replaces` case is refused by `enforceStoredLineage`, which runs before `enforceForeignOwnership` — commented in the test)
5. same-material recreate of a pruned identity stays allowed (saves at versionNumber 2)

No (a)/(b) diagnosis was required: no test misuse found, no production defect found.

## Verification receipts (real exit codes)

| # | Command (via receipt.py) | Log | Result | Exit |
|---|---|---|---|---|
| 1 | npx vitest run practiceAuthoring + practiceSessionContract | authoring-session.log | 2 files passed; **52 passed (52)** | 0 |
| 2 | npx vitest run data batch (8 files) | data-batch.log | 8 files passed; **166 passed (166)** | 0 |
| 3 | npx vitest run StudyLibrary batch (8 files) | studylibrary-batch.log | 8 files passed; **97 passed (97)** | 0 |
| 4 | npm run typecheck | typecheck.log | clean; the three prior TS6133 (unused-helper) errors are gone | 0 |
| 5 | node /private/tmp/hfd-03b-review-r1/diagnostic.mjs | diag-diagnostic.log | — | 0 |
| 5 | node /private/tmp/hfd-03b-review-r1/history-ordering.mjs | diag-history-ordering.log | — | 0 |
| 5 | node /private/tmp/hfd-03b-review-r1/lifecycle-ownership.mjs | diag-lifecycle-ownership.log | — | 0 |

All commands run with `PATH=/opt/homebrew/opt/node@22/bin:$PATH` (v22.23.3, injected by the runner).
Queued r5 blockers (`receipt-validation.mjs`, `current-reader.mjs`, `restore-removed.mjs`) were not
run and their code paths were not touched, per round-4 instructions.

## Not done

- Receipt-validator strictness (round 5).
- current-reader origin (round 5).
- Restore after removal (round 5).
- Native `save_practice_authoring_atomically` (Rust side).
- The schema-17 backup twin.
- UI.

This report records round-4 test additions and receipts only. It is **not** feature acceptance.
Everything remains uncommitted on `qwen/offline-03b` (base `6d909c5`).

## r5 (2026-10-19) — B1 receipt decode, B2 reader origin, B3 restore-after-removal

Receipts: `docs/evidence/offline-03b-2026-10-19/ts-correction-r5/`. All r4 work kept untouched.

Files changed (full SHA256 also in `SHA256-source.txt`):

- `5c139c89e78bc256d66c2c1c42917cc76268275e1469cb0919c3bba3ebd2f8ba`  src/data/practiceStateValidation.ts (B1)
- `be4586c166f36e1c10a825bed4f01a8efc274d96198aac125a2a822479ee6014`  src/data/practiceAuthoring.ts (B3)
- `f865a12a457e4897215bd77f94f5445b45c50ac56b253952ff671f86046de2c8`  src/domain/types.ts (B2)
- `3262b26cd69d174859c077da3834ab6a720ed3df0371d02c74a9c10f16ee79a5`  src/data/repositories/documentRepository.ts (B2)
- `fe815cabb6b8cc1c37ee8bd8076a90fffb72d4941938462a17c40689288a4c70`  src/data/practiceStartupValidation.test.ts (B1 tests)
- `cdd5b8d915d8669fe86ac22bed136d298dec56859fe8e82fba8e798c1d410c1c`  src/data/practiceAuthoring.test.ts (B3 tests)
- `65e04753df3e10298efb19bb2e5dfd63c6930beda0b3e837fefdc33eed3a412d`  src/data/repositories/documentRepository.test.ts (B2 tests)

| Verification (via receipt.py; logs in receipts dir) | Result | EXIT |
|---|---|---|
| 1. vitest practiceAuthoring + practiceSessionContract (authoring-session.log) | 2 files; 56 passed (56) | 0 |
| 2. vitest data batch, r4's 8 files (data-batch.log) | 8 files; 177 passed (177) | 0 |
| 3. vitest StudyLibrary batch, r4's 8 files (studylibrary-batch.log) | 8 files; 97 passed (97) | 0 |
| 4. vitest studyExport + studyPackets + structuredImport (packet.log) | 3 files; 101 passed (101) | 0 |
| 5. npm run typecheck (typecheck.log) | clean | 0 |
| 6. six diagnostics, diag-diagnostic / -history-ordering / -lifecycle-ownership / -receipt-validation / -current-reader / -restore-removed .log | every case bug:false | 0 each |

New tests (11):

- B1, describe "authoring receipt validation decodes the whole operation" (no existing file covered `validatePracticeAuthoringState`; used the prescribed fallback): "accepts a real receipt holding its complete canonical operation"; "refuses a receipt whose payload drops operationId, expected and next, even with a recomputed digest"; "refuses a complete receipt payload naming a different operation id than its row key, with the digest recomputed"; "accepts a real receipt whose result version was later pruned by remove".
- B2: "reads back an instructor correction with its real origin"; "omits the origin key entirely for a question with no stored origin"; "keeps packet v1 export unchanged: exported questions carry no origin key".
- B3, inside the r4 "version numbering and ownership survive pruning" block: "restores a removed test with the selected snapshot's content, ledger and a higher version number"; "restoring without a retirement the preserved history holds is refused with no new version"; "restoring with no expected state while a current test exists is stale"; "restoring a removed instructor question relabelled as user is refused".

Design choices:

- B1: the loop reuses the writer's exported strict `decodePracticeOperation` (no second decoder); a throw refuses "does not hold a complete authoring operation"; decoded operationId/material/action bind to the row key; canonical bytes, digest and typed-result checks unchanged; a receipt never requires its version row, so remove-pruned receipts stay valid.
- B2: origins come only from `readCurrentSnapshot` (the `practice_item_origins` join) — no new store; an origin is copied only when ordinal, length and all five content fields agree with the active version; no origin → key absent, `origin: undefined` never written, legacy/quarantined rows read exactly as before.
- B2: `buildExportPacket` already serialized questions from explicit fields, so packet v1 is byte-identical (the new test pins the exact exported key set); the five-field mirror and content hashing were not touched.
- B3: decoder — `restore` accepts `expected === null` or a snapshot but always requires `next !== null`; create/edit/correct/regenerate/remove rules unchanged; staleness untouched, so `expected: null` against a live current still refuses `STALE_CONTENT`.
- B3: restore onto an absent test must carry the exact union (`entryJson`) of every retirement record in the material's decodable preserved history snapshots (`snapshotFromHistoryRow`; undecodable rows skipped); `next.retired` may grow, bounded by the existing decoder limit; the check runs before any write, so refusals leave zero new rows or receipts.
- B3: restore keeps every existing path — `enforceStoredLineage`, `enforceForeignOwnership`, `nextVersionNumber`, receipt write, exact-retry `already_saved`; no history row is written for the absent previous state (nothing was current to preserve — commented in the transaction); `remove` pruning untouched.

Not done: native `save_practice_authoring_atomically` and native receipt/reader parity; the schema-17 backup twin; legacy restore parity; UI.

This records round-5 corrections and receipts; it is **not** feature acceptance. Everything remains uncommitted on `qwen/offline-03b` (base `6d909c5`).

## r6a parity fixture (2026-10-19, section B only)

Scope: the shared fixture plus its TypeScript parity runner. No Rust written; `lib.rs`/`src-tauri` untouched; `src/data/practiceAuthoring.ts` unchanged (reference contract). Model used: `qwen/qwen3.8-flash`.

Files created (full SHA256):

- `f958c4ac501cb388057fbaf6f0cb2fcb207b9e5c09b661f197f3f958b2d957ae`  src/testing/practiceAuthoringVectors.json
- `8fecd7a02f6dd47485d6cd8db8bb9614ebf4a7ef91bed1b41a428d1013211b82`  src/data/practiceAuthoringParity.test.ts

Fixture: **8 hashVectors** (two legacy five-field sets proven byte-identical to `computeCanonicalHash` over the five-field projection, user/instructor/mixed origin sets, an identity+`replaces` pair whose stored hash equals the same set with them removed, one é/emoji/CJK set) and **15 scenarios / 40 steps**, covering every mandated outcome once: create; exact retry `already_saved`; reused id `CONFLICT` (then a clean retry still `already_saved`); stale expected `STALE_CONTENT`; edit with the exact retirement record; wrong retirement digest; instructor relabelled to user (refused) then the honest correction (saved); plain regenerate; remove→recreate with versionNumber rising 1→2→3; mat-a's pruned identity claimed by mat-b (refused); restore with the union ledger (saved, v3); restore missing a retirement; restore with `expected:null` while a current exists; fabricated `replaces` target.

Generation: a one-off vite-node script outside the project ran every scenario through `executePracticeAuthoring` on `createNodeSqliteDatabase()` (fresh database + pre-inserted mat-a/mat-b per scenario) and wrote the JSON; all 40 recorded outcomes are that engine's real outputs (40/40 matched the design forecast; internal hash invariants asserted at generation time). The script was deleted after this single run; the committed test only asserts, never regenerates.

Conventions both runners share: `expected` `"$current"` (or `"$current:mat-b"`) is substituted with the live `readCurrentSnapshot` result before sending (a null snapshot substitutes null); `current` = versionNumber, `practiceContentHash(questions)`, questionCount, origins aligned to ordinal with `null` where a question carries no origin, retiredCount; server-owned ids/timestamps are never asserted; `ATTEMPT_ACTIVE` is deliberately absent (native unit tests, section C).

Verification (receipt.py; logs in `docs/evidence/offline-03b-2026-10-19/native-r6a/`):

| Step | Result | EXIT |
|---|---|---|
| 1. vitest practiceAuthoringParity + practiceAuthoring (ts-parity.log) | 2 files; 48 passed (48) — 17 new parity tests | 0 |
| 2. r4's eight-file data batch (data-batch.log) | 8 files; 177 passed (177) | 0 |
| 3. npm run typecheck (typecheck.log) | clean; first run EXIT 2 was TS2722 in my test (optional driver method — fixed with the same `!` call style as the existing tests), rerun clean | 0 |
| 9. six diagnostics diag-diagnostic / -history-ordering / -lifecycle-ownership / -receipt-validation / -current-reader / -restore-removed .log | all pass | 0 each |

No TS↔Rust difference found this round (no Rust read; steps 4–8 and 10 not run per r6a scope). Not done here: section A native module, section C native tests, the schema-17 startup/backup validators and backup twin, schema-16→17 round-trip, import-path parity, round-2 UI (r7). Everything left uncommitted.

## r6b native port (2026-10-19, sections A + C1 + C2; C3 deferred to r6c)

Model: Flash. `src-tauri/src/practice_authoring.rs` ports `practiceAuthoring.ts` function-for-function (decoders → hashing → readers → guards → transaction), study_sets-style command; the JSON fixture and the TS runner were untouched.

Files (full SHA256): `5c31e892f1627aa787001b2ef8b8a49cf02f3853f626190599bafb54965b4c5e` practice_authoring.rs (new) · `991bc24f23686c2058e78fbfde84e859b4529ac2cc1ba5903c482e958eadf677` practice_authoring_tests.rs (new) · `b195fc07dde5a063c3989f34b22a25bff71a39e256e48064cc3a1811f1d0220b` lib.rs · `53539070165da17e24dc005f85afaf50cafe5a23f59b502de1960e05e005d3b9` practice_sessions.rs

Unregistered/deleted: `practice_sessions::save_practice_test_atomically` and `remove_practice_test_atomically` removed from `invoke_handler` and their `#[tauri::command]` wrappers deleted; `practice_authoring::save_practice_authoring_atomically` registered. `save_practice_test_at`/`remove_practice_test_at` kept (rg: only `practice_session_tests.rs`, `card_reviews_tests.rs` and `backup.rs` tests call them) and gated `#[cfg(test)]` — that keeps `clippy --all-targets -D warnings` honest without an `#[allow]`. Same gate on `append_practice_retirements`: no native production caller before the r7 backup twin; a direct unit test covers retain/dedupe/2,000-cap. `npm run build` ran once first (dist/ was missing).

Verification (receipt.py; `$E=docs/evidence/offline-03b-2026-10-19/native-r6b`):

| Step | Result | EXIT |
|---|---|---|
| 1. vitest parity+contract (ts-parity.log) | 2 files, 48 passed | 0 |
| 4. cargo test practice_authoring | 4 passed: 8 hash vectors (incl. legacy byte-identity via `compute_canonical_content_hash_from_parsed`) + all 15 scenarios / 40 steps + 7 messages + ledger append | 0 |
| 5. cargo full suite | 805 passed / 15 failed / 11 ignored — all 15 are the pre-existing old-schema validator tests (below) | 101 |
| 6. cargo fmt --check | clean | 0 |
| 7. clippy -D warnings | first run 101 (redundant closure + 4 needless `as_deref`), fixed, rerun clean | 0 |
| 8. npm run test:cargo-lock | pass | 0 |
| 9. six diagnostics (diag-*.log) | all pass | 0 each |
| 10. SHA256-source.txt | four files hashed | 0 |

Change in failures vs the 844/11 baseline: 15 failures, none authored this round. Every one panics with `Table practice_test_items missing required column: logical_id` from `verify_schema_11_semantics`-style checks that compare an old-schema archive against `get_reference_schema_connection()` — the reference now includes 0017 because the schema-17 bump (`CURRENT_SCHEMA_VERSION=17` + migration-17 registration in lib.rs) was already in the worktree at session start (my first read of lib.rs, before any r6b edit). These are exactly the r6a-listed r7 items (schema-17 validators/backup twin, schema-16→17 round-trip). Cargo fail-fast stops after the lib target; bin/integration targets did not run.

TS↔Rust differences hit — all representation-level; Rust agreed with the fixture everywhere (parity green on the first run): JS `\s`/`trim` ≠ Rust `char::is_whitespace`, so `normalized_study_text` implements the exact JS set (U+FEFF in, U+0085 out); word runs use L/N + combining class for M (Mn/Me — an Mc spacing mark after a letter would split a word; no fixture text exercises it); retirement-term ordering ports JS `<` as UTF-16 code-unit order, while `retirementTerms` sorts by scalar order like the TS twin; `Number.isInteger` maps to serde `as_i64` (refuses fractions); stored `retired_json`/`questions_json` key order differs (serde_json sorts) but nothing byte-compares those across engines — everything the contract byte-compares (`payload_json`, `previous_json`) goes through the key-sorted `canonical_json`, reused from `practice_sessions.rs` since it matches TS `canonicalJson`; the TS unreachable `operation.next!` crash maps to `STORAGE_ERROR`, same as its catch does.

Not done (r6c/r7): C3 native-only tests a–d; schema-17 validators and backup twin; schema-16→17 round-trip; import-path parity; round-2 UI. Everything left uncommitted.

## r6c native zero failures + native-only tests (2026-10-19; Flash; reviewer retests)

Files changed this round, full SHA256: `e42bed249d9f52b841fb88d29ed0e7e8efffb76097d344290a3f0ace7744edae` `src-tauri/src/backup.rs` · `db29e91567ed0583562cf22aee8258a287ef34371aa75cb2efd7ab74179c69f8` `src-tauri/src/practice_authoring_tests.rs`. `practice_authoring.rs` behaviour untouched; none of the 15 failing tests edited — they pass as written.

backup.rs: `verify_schema_11_semantics` now skips `logical_id`/`replaces_id` on `practice_test_items` (one-line comment: "added by 0017; required by verify_schema_17_practice_authoring_semantics"), every other check exactly as strict; new `pub(crate) fn verify_schema_17_practice_authoring_semantics` called from `verify_application_connection` under `if newest_migration >= 17` in the existing ladder — asserts `practice_save_operations` exists and the three 0017 columns (`practice_tests.retired_json` TEXT notnull=1, `practice_test_items.logical_id`/`replaces_id` TEXT notnull=0) with type+notnull mirroring the TS column loop in `validatePracticeAuthoringState`, using the neighbouring checks' message strings; its doc comment lists the r7 remainder (strict receipt decode, origins, identities, mirror agreement).

Six new tests. 1(d): `a_fully_migrated_schema_17_library_passes_application_verification` (real create+edit → whole ladder Ok) · `a_schema_17_library_without_logical_id_is_refused` — rebuilds `practice_test_items` without the column (rows, compound UNIQUE, secondary index and both response-version triggers preserved from 0011's text) and asserts the exact refusal `Table practice_test_items missing required column: logical_id`. C3: `attempt_active_refuses_editing_and_regeneration_abandons_the_attempt` (a) — attempt started via native `save_practice_session_at` start_or_resume, edit → ATTEMPT_ACTIVE with the TS message byte-for-byte, regenerate → saved, attempt abandoned, versionNumber 2, one active version · `an_injected_trigger_failure_mid_transaction_rolls_everything_back` (b) — RAISE(ABORT) trigger on the `practice_item_origins` insert → STORAGE_ERROR; versions/history/receipts/items counts and the stored wording+empty ledger unchanged · `a_legacy_fallback_identity_owned_by_another_material_refuses_a_create` (c) — mat-a create claiming mat-b's logical_id-NULL row id → INVALID_ARGUMENT, zero writes · `a_foreign_owned_replacement_target_that_passes_lineage_is_refused` (d) — X legitimately in mat-a's preserved history and ledger (lineage guard passes) while mat-b holds the seeded living row → INVALID_ARGUMENT, mat-a unmoved at v2 with two receipts.

Verification ($E=docs/evidence/offline-03b-2026-10-19/native-r6c, receipt.py, one command per shell call):

| Step | Result | EXIT |
|---|---|---|
| 1 cargo-full.log `cargo test --locked --no-fail-fast` | lib 826 passed / 0 failed / 11 ignored (was 805/15 failed/11); bin 0; extraction_service 13; extraction_worker 15; doc 0 — 0 failed in every target | 0 |
| 2 fmt.log | first `--check` EXIT 1 (my new code), `cargo fmt` once, rerun clean; full suite rerun after fmt so the receipt matches the final bytes | 0 |
| 3 clippy.log `--all-targets -- -D warnings` | clean | 0 |
| 4 cargo-lock.log `npm run test:cargo-lock` | sync verified | 0 |
| 5 ts.log vitest Parity+Authoring+StartupValidation | 3 files / 62 passed | 0 |
| 6 typecheck.log `npm run typecheck` | clean | 0 |
| 7 SHA256-source.txt | the two files above | 0 |

Bug found by (d): none — the Rust engine refuses at the same logical point as the TS reference, so no `practice_authoring.rs` fix and no TS-test scenario were needed. Not done (r7): the full semantic schema-17 twin, schema-16→17 backup round-trip, import-path parity, round-2 UI. Everything left uncommitted.

## r7 shared schema-17 validation contract, backup twin, round-trips, import parity (2026-10-19; reviewer retests and mutation-tests both engines)

Model: this Qwen Code agent; the runtime did not surface a model id to me this round, so I cannot name one honestly.

`practiceAuthoring.ts`, `practiceStateValidation.ts` and `practice_authoring.rs` behaviour are untouched: the TypeScript is still the reference contract and the Rust agreed with it everywhere. **No TS↔Rust difference was found this round** — the shared fixture passed on both engines on the first run of each, and the import parity did too, so r7 §7's "decide which side is wrong" never triggered and no scenario was appended to `src/data/practiceAuthoring.test.ts`.

### Files touched (full SHA256, in `$E/SHA256-source.txt`)

| SHA256 | File |
|---|---|
| `f9bbd4f7e8bc7d048560797ec3819680ecc66e6c20503b5f5cbcc0a761466367` | `src-tauri/fixtures/practice-authoring-validation/cases.json` (new, 43 cases) |
| `f426b0f9d85aa571aa9a5d15eda544e5315d2d8dc73d972b868c69ad39c8705c` | `src/data/practiceAuthoringValidationParity.test.ts` (new TS runner) |
| `6d5d7b813264d41dffec540152929def06fb80d10efac70168b8765f0b7bc911` | `src-tauri/src/backup.rs` (the full twin + 2 round-trip tests) |
| `99cf3e7ba5dbfb8bd441489f155edd6b3b71bc6eaefc89a1c317982a4e578c47` | `src-tauri/src/practice_authoring_tests.rs` (native runner) |
| `ad1707ce0612977be7af213453b9829e79f9b2f000c9a4bb008972a9bfa51993` | `src-tauri/src/study_packet_save_tests.rs` (native import parity) |
| `f694dfa2feac3f520c743efa05e65d5fb1f830600515f6382822c42da1f4f531` | `src/data/repositories/importStudyPacket.test.ts` (TS import parity) |
| `eeaa1c3f3864bda42ad078cf262ec5510f52eabaf0d76dc6f349d7a5fb2cb237` | `src/data/testing/skillEvidenceEngines.ts` (disclosed below) |
| `747d0099c9ca657b08bfc66a5381efa780a661f84db4aff360e55961a48b5a8b` | `src/data/navigationUpgrade.test.ts` (disclosed below) |
| `f9dc1edf4fc5a257738436be08f9c904e2a62511ab263f73ff13d2113bec874f` | `src/data/skillEvidenceUpgrade.test.ts` (disclosed below) |

### 1. The case list — 43 cases, 5 accept, 38 refuse

`src-tauri/fixtures/practice-authoring-validation/cases.json`, categories exactly as r7 requires:

| Category | accept | refuse | what it pins |
|---|---|---|---|
| `control` | 4 | 0 | baseline as-is; mat-b's receipt whose saved version the removal pruned; a legacy item with NULL `logical_id`/`replaces_id`; an identity whose other owner was `DELETE FROM study_materials`-ed (its detached version survives through a completed attempt) |
| `schema` | 1 | 2 | equivalent receipt-table formatting accepted; `DROP TABLE practice_save_operations` and an `ADD COLUMN note TEXT` refused |
| `schema-fk` | 0 | 3 | material FK removed; `ON DELETE CASCADE` → `SET NULL`; a receipt row pointing at `mat-gone` (`PRAGMA foreign_keys = OFF` + update) |
| `schema-check` | 0 | 2 | the action CHECK weakened with `'erase_everything'`; the CHECK removed (both via `writable_schema`) |
| `schema-index` | 0 | 2 | `idx_practice_save_ops_material` dropped; same-name index rebuilt on `applied_at` |
| `schema-column` | 0 | 3 | `retired_json` made nullable; `ALTER TABLE practice_test_items DROP COLUMN logical_id`; `logical_id TEXT` → `INTEGER` |
| `receipts` | 0 | 11 | non-JSON payload; non-canonical bytes (one inserted space); plain digest mismatch; **the r5 tamper** — payload stripped to `{"reason","sourceMaterialId"}` with the digest honestly recomputed (`b8644cfd…`), so only the strict decode catches it; `operationId` ≠ row key with the digest recomputed (`c625d76e…`); material mismatch; action mismatch; non-JSON result; a `remove` result carrying `versionId`; a saved result with `{"status":"saved"}` only; a saved result naming `version-1` |
| `identity` | 0 | 6 | malformed `logical_id`; malformed `replaces_id`; an **uppercase** UUID (the pattern is lowercase, no `i` flag); one version repeating an identity; two living materials sharing one; `replaces_id` with no origin row |
| `ledger` | 0 | 2 | `retired_json = 'not json'`; a record whose reason is `erased` |
| `history` | 0 | 1 | `previous_json = '{}'` on a `kind='practice'` row |
| `mirror` | 0 | 6 | active version with no mirror row; migrated mirror with `is_active = 0`; title disagrees; provider disagrees; `questions_json` not JSON; `questions_json` disagrees |

**Skipped, and why (recorded in the fixture's own `description`):** the receipts loop's "A practice save receipt names an unknown action" branch cannot be reached from a case. Migration 0017 declares `action TEXT NOT NULL CHECK (action IN ('create','edit','correct','regenerate','restore','remove'))`, so SQLite refuses such a row before the validator runs; rewriting that CHECK through `writable_schema` is itself refused earlier by the CHECK-contract comparison, and `PRAGMA ignore_check_constraints` is not a guarantee of these engines. No case can isolate that branch, so it is covered by code inspection only (the action set is checked first in both engines and is provably redundant against the schema today).

Cases are one-line statements that mostly *rewrite* the shipped baseline rows (`UPDATE … SET payload_json = replace(payload_json, …)`), so the tamper bytes stay honest and each case isolates one refusal. `writable_schema` cases are three statements (`ON`, the `UPDATE sqlite_master`, `OFF`) and every runner closes and reopens the database before validating, so the edit takes effect as it would on the next launch.

**The baseline** was generated once by a scratch script outside the project (`/private/tmp/qwen-r7-scratch/dump.mjs`, since deleted): Vite's SSR loader ran the real TypeScript engine — `executePracticeAuthoring` through `createNodeSqliteDatabase()` — with `crypto.randomUUID` pinned to readable `f0000000-…`/`a0000000-…`/`b0000000-…` literals, then dumped every affected row of `practice_test_versions`, `practice_test_items`, `practice_item_origins`, `practice_tests`, `study_set_history` and `practice_save_operations` as INSERTs. The script replayed the dump into a fresh engine and printed `BASELINE_OUTCOME accept` before I pasted it. Contents: `mat-a` create → edit carrying the exact `corrected` retirement record (2 receipts, 1 `practice` history row, 2 instructor origins, 2 versions, 1 mirror row whose `retired_json` holds one record); `mat-b` create → remove (2 receipts and the `delete` history row remain, its version is pruned, its mirror row is gone). A second scratch probe (`probe.mjs`, also deleted) printed the stored `sqlite_master` text so every `replace(...)` targets real bytes.

### 2. The native twin

`crate::backup::verify_schema_17_practice_authoring_semantics` is now the full twin of `validatePracticeAuthoringState`, same six sections in the same order: receipt-table contract (existence, `m3_columns`, `foreign_key_shapes`, `check_constraints`, `m3_key_indexes`, `pragma_foreign_key_check`), the `idx_practice_save_ops_material` shape, the three 0017 columns, the receipts loop, identities, ledger + history, then the mirror. It reuses `m3_columns`/`m3_key_indexes`/`m3_index_shape`/`foreign_key_shapes`/`table_sql`/`check_constraints`, and — as r7 demands — the authoring module's own `decode_practice_operation` for the strict receipt decode, plus `decode_practice_retirements`, `decode_practice_snapshot`, `read_current_snapshot`, `practice_sessions::canonical_json` and `card_reviews::sha256_hex`. Inlined, because the Rust equivalents exist only inside `read_current_snapshot`: the mirror's five-field projection of the snapshot for the `questions_json` comparison, and the `Object.keys(result).sort().join(",")` key-set for the typed result. Its r6c column-registration body is kept verbatim (including the three message strings the existing r6c test asserts), and the two new constants `PRACTICE_AUTHORING_TABLES` / `PRACTICE_AUTHORING_ACTIONS` sit above it.

### 3. Runners

`src/data/practiceAuthoringValidationParity.test.ts` (45 tests: surface, one sql.js sweep, 43 per-case `node:sqlite` tests) is `cardValidationParity.test.ts`'s shape copied, calling `validatePracticeAuthoringState` with the all-migrations reference. `practice_authoring_tests::shared_practice_authoring_validation_contract_native_outcomes` builds each case in a temp file, closes, reopens, and calls the native twin; it asserts `cases.len() >= 26` and prints every mismatch with the refusal text.

### 4. Backup round trips (`backup.rs` tests)

`schema_16_archive_restores_and_upgrades_to_17` — a schema-16 library (`crate::migrations()` filtered to `version <= 16`, `_sqlx_migrations` at 16) holding a Gemini test written by `save_practice_test_at`, a completed attempt written through `save_practice_session_at`, a regeneration, and one instructor origin on the superseded version's item; verify at 16 → backup → stage → apply → verify → then **the app's own upgrade step**: read `MAX(version)` from `_sqlx_migrations` and run every `crate::migrations()` above it in order, recording each. Found with `rg -n "fn migrations\(\)|apply.*migration" src-tauri/src/lib.rs src-tauri/src/backup.rs` → `lib.rs:185 .add_migrations(DB_URL, migrations())`, i.e. tauri-plugin-sql/sqlx applies pending versions and records them in `_sqlx_migrations`; the test uses this repo's minimal one-column table convention, as `setup_db` in `study_packet_save_tests.rs` and the schema-10 round trip already do. Then `verify_application_database` is Ok; `read_current_snapshot` gives v2 with `practice_content_hash(questions)` equal to the hash the version row carried before the archive, the completed attempt survives, one origin survives, `retired` is empty.

`schema_17_authored_archive_round_trip` — create, edit (carrying the exact retirement record) and an instructor `correct` through `save_practice_authoring_at`; the source snapshot is captured with `read_current_snapshot` before the archive; after restore + verify, `assert_eq!(restored, source)` field for field (Snapshot derives `PartialEq`), receipts = 3 and `practice` history rows = 2 on both sides, and replaying the exact edit operation into the restored library returns `already_saved` with the receipts count and snapshot unchanged.

### 5. Import-path parity (§4)

`importStudyPacket.test.ts` IP-17-01 and `study_packet_save_tests::imported_packet_satisfies_the_schema_17_authoring_contract`: `retired_json` is the `'[]'` default, imported items keep NULL `logical_id`/`replaces_id`, the stored `content_hash` is exactly today's five-field `computeCanonicalHash` (TS) / is reproduced unchanged by `practice_content_hash` (native), `verify_schema_17_practice_authoring_semantics` / `validatePracticeAuthoringState` accept what the importer wrote, an authoring `edit` of the imported test succeeds with the fallback identities (the row ids) travelling into the new version, and provider stays `import` in both the version and the mirror. Neither writer needed a change — both already satisfy the contract; the tests are the guard.

### 6. Two pre-existing TypeScript failures I fixed, and one `cargo fmt` (disclosure)

The first full `npm test` was `188 passed | 2 failed | 4 skipped (194 files)`. Both failures were **not** mine and not native: `navigationUpgrade.test.ts` and `skillEvidenceUpgrade.test.ts` compare a pre-upgrade row dump with a post-upgrade one, and migration 0017 (already in the worktree at session start) adds `practice_tests.retired_json`, `practice_test_items.logical_id` and `replaces_id`, plus the `practice_save_operations` table. Their shared helper `withoutSchema16Columns` stripped only the 0016 additions, so the dumps differed by three default-valued columns and the "tables added by later migrations" list was one short. This is the exact TypeScript analogue of what r6c fixed natively (schema-11 skipping the two 0017 columns), so I fixed it the same way: the helper is now `withoutSchema16And17Columns`, it strips `practice_tests.retired_json = '[]'` and `practice_test_items.logical_id/replaces_id = NULL` **after asserting each holds its upgrade default**, and a new `PRACTICE_AUTHORING_NEW_TABLES = ["practice_save_operations"]` joins the expected added-table list in both tests. Test-side only; no production file changed, and this rename is the only edit outside my own new tests. `grep` confirms the old name has no remaining users.

`cargo fmt --all --check` failed first (`fmt-check-before.log`, EXIT 1, my new Rust only), so I ran `cargo fmt --all` once (`fmt.log`, EXIT 0) and `--check` again clean (`fmt-check.log`, EXIT 0); every Rust receipt after that runs on the final bytes. `npm run typecheck` failed first too (EXIT 2, eleven `TS18048: possibly undefined` in my new test's destructured row reads — fixed with the `!` style the neighbouring tests use), then clean.

### 7. Verification ($E=docs/evidence/offline-03b-2026-10-19/r7, receipt.py, one command per shell call, no `&&`)

| Log | Exact command | Result | EXIT |
|---|---|---|---|
| `fmt-check-before.log` | `env SDKROOT=… CARGO_TARGET_DIR=… cargo fmt --all --check` (in `src-tauri`) | my new Rust unformatted | 1 |
| `fmt.log` | `env … cargo fmt --all` | reformatted once | 0 |
| `fmt-check.log` | `env … cargo fmt --all --check` | clean | 0 |
| `ts.log` | `npm test` | 190 passed / 4 skipped (194 files); **4034 passed / 6 skipped (4040 tests)**, 70.8s | 0 |
| `ts-typecheck.log` | `npm run typecheck` | first run EXIT 2 (11 TS18048 in my new test), rerun clean | 0 |
| `build.log` | `npm run build` | `✓ built in 967ms`; the standing `(!) Some chunks are larger than 500 kB` advisory only | 0 |
| `cargo.log` | `env … cargo test --locked --no-fail-fast --manifest-path src-tauri/Cargo.toml` | lib **830 passed / 0 failed / 11 ignored** (826 → 830: +1 contract runner, +2 round trips, +1 import parity); bin 0; extraction_service 13; extraction_worker 15; doc-tests 0. No `warning` line in the log | 0 |
| `clippy.log` | `env … cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | clean on the first run; no `#[allow]` added | 0 |
| `cargo-lock.log` | `npm run test:cargo-lock` | lockfile sync verified | 0 |
| `diag-diagnostic.log` | `node /private/tmp/hfd-03b-review-r1/diagnostic.mjs` | 4 checks, every `bug:false` | 0 |
| `diag-history-ordering.log` | `node …/history-ordering.mjs` | pass | 0 |
| `diag-lifecycle-ownership.log` | `node …/lifecycle-ownership.mjs` | pass | 0 |
| `diag-receipt-validation.log` | `node …/receipt-validation.mjs` | pass | 0 |
| `diag-current-reader.log` | `node …/current-reader.mjs` | pass | 0 |
| `diag-restore-removed.log` | `node …/restore-removed.mjs` | pass | 0 |
| `SHA256-source.txt` | `shasum -a 256 <the nine files above>` | nine hashes | 0 |

`grep` over all six diag logs finds no `bug: true`. Every log carries the same pre-existing `ExperimentalWarning: SQLite is an experimental feature` that node emits for `node:sqlite` (present in r6c's own `ts.log` too) — not a test warning. The focused iteration runs (the new contract on both engines, the two round trips, the import parity on both engines) were logged to `/private/tmp/qwen-r7-scratch/`, not into `$E`; `$E` holds only the final receipts. The scratch scripts `dump.mjs`, `probe.mjs` and their logs are deleted.

Contents of `$E` (`ls -la`): `SHA256-source.txt`, `build.log`, `cargo-lock.log`, `cargo.log`, `clippy.log`, `diag-current-reader.log`, `diag-diagnostic.log`, `diag-history-ordering.log`, `diag-lifecycle-ownership.log`, `diag-receipt-validation.log`, `diag-restore-removed.log`, `fmt-check-before.log`, `fmt-check.log`, `fmt.log`, `ts-typecheck.log`, `ts.log` — sixteen files.

**Numbers I did not reconcile:** r7 §0 quotes a TypeScript baseline of 192 passed / 4 skipped / 196 files, 4041 tests. This tree has 194 files matching `src/**/*.test.ts` on disk and the suite collects 194, so nothing was silently dropped by the runner — the quoted baseline does not describe the worktree I inherited (my very first full `npm test` here, before any edit of mine could affect those files, was already 194 files / 4040 tests). I did not investigate further: that would have meant touching other people's test files, and `git stash` is forbidden. The reviewer's own `npm test` will show the same 194.

### 8. TS↔Rust representation differences hit this round

None changed behaviour. Three are worth recording because they are where a future edit could break parity: `serde_json::from_str::<Value>("null")` succeeds and my `Ok(Value::Object(_))` arm refuses it, whereas TypeScript's `Object.keys(JSON.parse("null"))` throws a raw `TypeError` out of `validatePracticeAuthoringState` — no fixture case reaches it, and any `Err` is a refusal natively (see the follow-up below); `is_valid_uuid_v4` in `backup.rs` accepts uppercase `A`–`F` while `AUTHORING_UUID_V4` in TypeScript does not, so the twin wraps it with `!value.bytes().any(|b| b.is_ascii_uppercase())`, exactly as `verify_schema_12_card_semantics` already does, and the identity list pins it with an uppercase `logical_id`; and the column/type/notnull messages in section 2 keep the neighbouring native validators' wording (`"Table t missing required column: c"`, `"type mismatch: expected X, found Y"`) rather than the TypeScript twin's shorter `"is missing required column"` / `"type mismatch."` — messages are not part of the shared accept/refuse contract and the r6c test asserts the native strings.

### 9. What a reviewer must retest, and where mutation tests should bite

Retest: `npm test`, `npm run typecheck`, `env SDKROOT=… CARGO_TARGET_DIR=… cargo test --locked --no-fail-fast --manifest-path src-tauri/Cargo.toml`, `cargo clippy --all-targets -- -D warnings`, and `shasum -a 256` on the nine files against `$E/SHA256-source.txt`.

Mutation candidates, each with the case that must go red (the fixture's check order is the same in both engines, so a mutation that moves or deletes a check is caught by whichever case is scheduled behind it):

- delete the `canonical_json(&operation) != payload` branch → "a receipt payload that is not the exact canonical bytes is refused": only one space differs, so everything downstream still decodes and hashes correctly and nothing else catches it.
- drop the strict decode, or weaken it to `payload_json.contains("operationId")` → the r5 tamper case. The stripped payload is canonical and its recomputed digest matches, so the decode is the *only* guard. That is the exact hole the r5 reviewer found in the earlier validator.
- remove the `decoded.operation_id != row.operation_id` binding → the `operationId` ≠ row-key case (its digest is recomputed, so the digest check passes).
- drop `!is_ascii_uppercase()` from the twin's UUID guard → the uppercase `logical_id` case fails while the `version-1` case still passes, which is why both are in the list.
- weaken the identity SQL: drop `GROUP BY version_id, logical_id`, or drop `AND v.source_material_id IS NOT NULL` → the "one version repeating" and "two living materials sharing" cases; deleting the `NOT NULL` qualifier is caught *from the other side* by the `control` case where the other owner was deleted, which must stay `accept`.
- replace the ledger loop's `decode_practice_retirements` with a plain array check → the "unknown reason `erased`" case.
- delete the `pragma_foreign_key_check('practice_save_operations')` step → the `mat-gone` receipt case; delete `m3_index_shape` → both `schema-index` cases; delete `check_constraints` → both `schema-check` cases; delete `foreign_key_shapes` → both `schema-fk` DDL cases (the third uses rows, not DDL).
- reorder the mirror checks or drop the `legacy_migrated_at IS NOT NULL` guard → "a migrated current test with no active version", which only refuses because the mirror row is marked migrated; the "active version with no current test row" case catches a dropped existence query.
- drop the five-field projection and compare `questions_json` against `snapshot_value(...)` instead → the "questions disagree" case must still refuse while the baseline must still accept, because a snapshot carries `identity`/`origin`/`versionId`/`savedAt` that the mirror never holds. This is the mutation most likely to slip through a sloppy test.
- in the new backup tests: change `filter(|m| m.version <= 16)` to `<= 17`, or drop the `_sqlx_migrations` insert, and test (a) stops proving the upgrade path at all; in (b), replaying a *modified* edit instead of the byte-identical one would make `already_saved` pass for the wrong reason.

### 10. Suggestion [follow-up]

- Suggestion [follow-up]: `validatePracticeAuthoringState`'s result-shape check calls `Object.keys(JSON.parse("null"))`, which throws a raw `TypeError` instead of refusing; the native twin refuses it. Align the TypeScript to the native behaviour (and add the case once it does), so a `result_json` of `null` can never crash whole-database validation.
- Suggestion [follow-up]: the "A practice save receipt names an unknown action" branch is unreachable through any row, because migration 0017's CHECK is narrower than the validator's action set. Either delete it in both engines or drop the CHECK and let the validator own the set — today the two lists must be edited together with nothing enforcing that.
- Suggestion [follow-up]: `PRACTICE_AUTHORING_ACTIONS` and `PRACTICE_AUTHORING_TABLES` duplicate strings from 0017 and from `practiceStateValidation.ts`; a shared const (or a compile-time assertion against the migration text) would keep the three from drifting.
- Suggestion [follow-up]: the mirror loop calls `read_current_snapshot` once per `practice_tests` row (N+1). Fine at current library sizes and it keeps the twin line-for-line, but one keyed batch query would scale better if she ever imports hundreds of authored tests.
- Suggestion [follow-up]: the `control` case proving a pruned result version is accepted uses a content-preserving `UPDATE … SET applied_at = applied_at`. Once the shared runner tolerates a read-only statement, a `SELECT` would assert the fact without touching a row.
- Suggestion [follow-up]: re-measure the loop's TypeScript baseline (quoted as 196 files / 4041 tests) against the merged branch — this worktree is 194 / 4040 before my additions.

### 11. Commit message draft (do not run it)

```
Validate schema 17 as a contract, not as a column list

OFFLINE-03b r7 makes the startup/backup validator check what the authoring
writer actually guarantees — exact canonical receipt bytes, a digest that
recomputes, the whole operation re-decoded by the writer's own decoder,
identities owned by one living material, and a current mirror that agrees
with its active version — and puts 43 accept/refuse cases in one fixture
that sql.js, node:sqlite and rusqlite must each reproduce from their own
code path. Two archive round trips carry her pre-authoring and authored
libraries through backup, restore and the 16→17 upgrade, and the create-new
import path is pinned to the same contract from both engines.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 12. What is left for r8

Round-2 UI (the plan's remaining scope): nothing in `src/pages` or `src/state` was touched this round, and `src/state/GeminiJobs.tsx` is still the pre-existing modification from earlier rounds. Also still open: the `result_json: "null"` alignment named above, and the unreachable unknown-action branch. Sections 1–4 of r7 plus verification and this report are done; nothing here is committed and nothing was pushed.


## r8 authoring UI

- Implemented by Codex under the 2026-10-20 owner override; Claude owns independent review, mutation testing, browser walkthrough and merge. Everything remains uncommitted.
- Sections 1–4: pure builder + transaction tests; repository save passthrough (snapshot/history readers already existed); manual/edit/history dialogs; live attempt gate; MaterialDetail integration. Only the seven source files below were edited this round; earlier dirty work was retained.
- No-op decision 1(g): the real transaction accepts a no-op; saving again with the resulting snapshot succeeds, and exact retry of an earlier operation returns already_saved. Save remains available for no-op drafts.
- Protection: unchanged questions retain exact origins/identities/replaces; instructor provenance stays sticky. validateProtection also requires exact retirements for rewritten/deleted generated questions, so the builder records them. savePracticeTest/removePracticeTest, the authoring contract, validators and Rust were not edited this round.
- Browser readiness: shared repository/atomic writer path; Dialog/useModalDialog, accessible controls, wrapping textareas and opener focus return (including after first creation). routes.mjs contains no route inventory to extend. Browser/desktop UI behavior awaits Claude's independent Playwright review.
- Receipts: every gate used receipt.py and PATH=/opt/homebrew/opt/node@22/bin:$PATH. Vitest adds --configLoader runner --no-cache; build adds --configLoader runner because the existing shared node_modules symlink cannot receive the bundled-config temporary write. No installations.
- builder.log EXIT 1: Vite bundled-config startup EPERM, no tests ran. builder-runner.log EXIT 0: 1 file / 9 tests passed.
- focused-initial.log EXIT 1: 9 passed, 14 failed, 14 errors (attempt-state variable in wrapper rather than MaterialDetailPage; corrected). focused-retry1.log EXIT 1: 22 passed, 1 failed (test assumed timestamp ordering identified the oldest version; changed to exact snapshot identity).
- focused-retry2.log EXIT 0: 2 files / 23 passed. focused-final.log EXIT 0: 2 files / 24 passed after adding the committed-first-save/lost-ack regression. focused.log EXIT 0: 2 files / 24 passed after opener focus-return coverage.
- vitest-full-before-create-retry.log EXIT 0: 192 files passed, 4 skipped; 4,057 tests passed, 6 skipped, 0 failed. vitest-full.log EXIT 0: 192 files passed, 4 skipped; 4,058 tests passed, 6 skipped, 0 failed.
- typecheck-before-create-retry.log and typecheck.log: EXIT 0 each. build.log EXIT 0 (Vite reports the existing >500 kB chunk advisory).
- diff-check.log EXIT 2: six pre-existing trailing-whitespace lines in documentRepository.test.ts (160, 202, 208, 224, 241) and importStudyPacket.test.ts (127); left untouched. diff-check-r8.log EXIT 0 for the seven r8 source paths. New source files were also inspected for trailing whitespace: none.
- SHA256-source.txt EXIT 0: seven source hashes (whole-file hashes include any earlier edits already present in documentRepository.ts):
- `src/data/practiceAuthoringDraft.ts` — `f8e6045e33b60030146aed4b1af5d095b6631afa7e135a99e0288cc63135a8ab`
- `src/data/practiceAuthoringDraft.test.ts` — `b2353d7bc7c6d7475117fb1e744af5f20aa96d61a7f445fc0e717497d55248b4`
- `src/data/repositories/documentRepository.ts` — `930311d54e05ab5d4a731426e8fad999b9c684be4cab11b7d264af3f69f04747`
- `src/pages/StudyLibrary/PracticeTestEditing.tsx` — `143d5e913e8f9b98582760eff34aaf8746c89e9b9fe8f8870f33a1a89a173770`
- `src/pages/StudyLibrary/PracticeTestEditing.test.ts` — `8cf74d8dc8324a37723f777f5880caf3c0a83c82cb424bfe3ca6040a9f584197`
- `src/pages/StudyLibrary/MaterialDetail.tsx` — `eedc4a11ffc74543c98760abdcab9344a567fe6397163ac8055765adffed8fea`
- `src/pages/StudyLibrary/PracticeTestPanel.tsx` — `c9c40bed9d6ea8714b667ccfb605e7b6611342e12e55f94d367d5ed03e7a1a9b`
- New/reused control strings: “Write your own practice questions”; “Edit questions”; “Practice test title”; “Question {n}”; “Question {n} wording”; “Question {n}, option {m}”; “Question {n} answer options”; “Correct answer: option {m}”; “Remove question {n} option {m}”; “Remove option”; “Add answer option”.
- More controls: “Question {n} explanation (optional)”; “{count} / 5,000 characters”; “Question {n} page (optional)”; “My instructor corrected this”; “Delete question {n}”; “Delete question”; “Add a question”; “Save”; “Saving…”; “Cancel”; “Opening…”. AuthorBadge reuses “Written by you” / “Instructor correction”.
- Validation strings: “Write a question first.”; “Keep the question within 10,000 characters.”; “Write an answer option first.”; “Keep each option within 1,000 characters.”; “Use 2 to 8 answer options.”; “Choose the correct answer.”; “Keep the explanation within 5,000 characters.”; “Use a page from 1 to 1,000, or leave it empty.”; “Keep the title within 500 characters.”; “Add at least one question.”; “Keep this test within 200 questions.”
- Deletion/reload strings: “Delete this question?”; “The question is removed when you save. Its earlier wording stays in Previous versions.”; “Load the latest version”; “Load the latest version?”; “This replaces your unsaved draft with the latest saved questions.”; “Load latest”.
- History labels: “Previous practice versions”; “Previous versions”; “Before an edit”; “Before a correction”; “Before a deletion”; “Before regenerating”; “Before an import”; “Before restoring an earlier version”; “Unknown date”; “{n} questions”; “This version is damaged”.
- History actions/messages: “Bring this version back”; “Bring this version back?”; “Restoring…”; “Your current questions are kept in Previous versions before this version comes back.”; “Previous versions couldn't be read. Try again later.”
- Attempt line: “Finish your current attempt, or use Abandon attempt below, before editing questions.” Manual disclaimer: “Practice questions you wrote. Check them against your source and your instructor's guidance.” Failures reuse PRACTICE_AUTHORING_ERROR_MESSAGES verbatim; unknown failures use STORAGE_ERROR.

## r9 regeneration review
- Implemented by Codex over r8; r8 authoring/transaction/validator code was not rewritten. No Rust, exports, reserved files, commits, pushes, installs or cleanup actions. Evidence: `docs/evidence/offline-03b-2026-10-19/r9/`.
- Source SHA256 (whole current files, including preserved earlier edits where present):
  - `src/state/GeminiJobs.tsx` — `9b3c1fc77fda7dc75251a50004a813443fec513d4a0a8ba3e1a60161f923fc3c`
  - `src/state/reviewedSaveCheckpoint.ts` — `68540b68e02b42043fbbd69caeaf6cd8c8cd8a9b089bf56beb14f897b13a3263`
  - `src/state/reviewedSaveCheckpoint.test.ts` — `246c9c18fbed2e6096a8e93fc1395e40e07a1c41398160f8a71b9a45429f0bb8`
  - `src/logic/practiceRegeneration.ts` — `d8abb8a13c953be7c989c9d96c2bbbc01f5c00290bd60edde58c42d8ba660d2f`
  - `src/logic/practiceRegeneration.test.ts` — `e67ad1336cb25a1be30aa51f6343382be96344ed107c5f06f8516408c7435e49`
  - `src/pages/StudyLibrary/PracticeRegenerationReviewDialog.tsx` — `7d2aee7ef4dcbb53501f7da36ff2946c8d87ca81275f4bb7ed848e5e1f7c8c87`
  - `src/pages/StudyLibrary/PracticeRegenerationReview.test.ts` — `8cc7a6cf6d75704330ed8812b854cd28c54cdd3346d46ad9dddc1a876311fc1d`
  - `src/pages/StudyLibrary/RegenerationReviewDialog.tsx` — `a26d37d0bd296dd8ff51544dac54695ed3aecfcd7a49bab96998d2688d3dc199`
  - `src/pages/StudyLibrary/MaterialDetail.tsx` — `74158afecd81f1d57f5ceff4637ca8fc8adc4211b881a0b8e2542cbafa68d1a5`
  - `src/pages/StudyLibrary/GeminiJobNotice.tsx` — `630782b50a04a158d327ed200846062ad30c01910c6ee5db37764f1f4fedc83c`
- `focused-startup.log`: EXIT 1, 0 tests (Vite tried to write through the read-only node_modules link). Switched tests/build to `--configLoader runner`; no dependency writes or installation.
- `focused-initial.log`: EXIT 1, 66 passed / 6 failed. Fixed synthetic fixture construction (retirements cannot be present on create; absent origins must be omitted) and explicit dialog initial focus. Next focused run: EXIT 0, 72 passed; after the additional Replace restart case, `focused.log`: EXIT 0, 73 passed / 0 failed, 6 files.
- `vitest-full.log`: EXIT 0, 4078 passed / 6 skipped / 0 failed; 194 files passed / 4 skipped. All study-set and r8 editor regressions pass. Only a test-fixture type annotation changed after this run; no runtime code changed.
- `typecheck-initial.log`: EXIT 2, two TS2322 fixture diagnostics; annotated GENERATED as GeneratedPracticeTest. `typecheck.log`: EXIT 0, 0 diagnostics.
- `build.log`: EXIT 0 via `npm run build -- --configLoader runner`; existing large-chunk advisory only.
- `diff-check.log`: EXIT 2: six pre-existing trailing spaces in untouched `src/data/repositories/documentRepository.test.ts` (160,202,208,224,241) and `src/data/repositories/importStudyPacket.test.ts` (127). Left under the existing review; no out-of-scope edits.
- `diff-check-r9.log`: EXIT 0 for r9 tracked paths; `new-file-whitespace.log`: EXIT 0, 4 new source files / 0 trailing-whitespace lines; `SHA256-source.txt`: EXIT 0, 10 source hashes.
- Coverage: manual/origin/retired truth table; exact hold; near matches above, at and below 0.6; verbatim user/instructor retention; replace retirements; explicit bring-back with retained record; real-transaction 2000 overflow with caller choices retained; Cancel; synchronous Save lock; transport retry; both Keep/Replace restart settlement; true journal acknowledgement; generated-only abandon-on-replace.
- Strings: “Review the new practice test”; “Your practice test has questions you wrote, corrected or deleted. Choose what to keep; nothing is saved until you do.”; “Save the reviewed practice test”; “Saving…”; “Choose for {n} more”; “Cancel”.
- Strings: “Your own questions”; “Keep my questions”; “Replace everything”; “{n} of your questions will be removed.”; “Either way, what you have now is kept in Previous versions.”; “Correct answer: {option}”; “Explanation: {explanation}”.
- Strings: “Checking whether your reviewed practice test was saved…”; “Comparing with your practice test…”; “Your saved practice test couldn't be read. Nothing has been changed; try again.”; failures reuse PRACTICE_AUTHORING_ERROR_MESSAGES verbatim.
- Strings: “Questions worded differently from something you deleted or corrected can't always be recognised. Check the new questions.”; “Needs your choice”; “Left out: matches something you deleted or corrected”; “New”; “Bring it back: {stem}”.
- Strings: “It looks like something you deleted:” / “It looks like something you corrected or rewrote:”; “That earlier wording is no longer in Previous versions.”; “Keep this similar question?”; “Leave it out”; “Keep it”; “Choose whether to keep or leave out each similar question before saving.”
- Strings: “Finish or abandon your current practice attempt before reviewing these questions.”; “Your practice test has questions you wrote, corrected or deleted, so you choose what to keep before anything is saved.”
- Practice differences: native question fields and fresh UUID identities, never study-card coercion; full-content retirement fingerprints use practiceRetirementRecord; near status corresponds to study unresolved. Replace appends exact deleted records for every dropped origin-bearing question because the practice transaction enforces them; bring-back retains the ledger.
- Practice differences: the 4-argument builder receives sourceMaterialId in the answer frame because PracticeSnapshot deliberately has no material id. Checkpoint stores the exact PracticeSaveOperation rather than a study-set expected/next pair. Recovery routes any pending practice checkpoint through its receipt even when Replace equals the whole provider answer; study-set behavior remains unchanged.
- Practice differences: current-attempt checks gate entry, open and Save; the plain provider path still abandons on regeneration. Matching a pending checkpoint compares content hash plus retired list (also title/provider/model); earlier wording requires both retirement itemId and textKey. Browser interaction uses the existing labelled native Dialog with initial focus on Cancel. Real browser/packaged-app review remains for Claude.


## r10 exports and search

- Implemented by Codex (GPT-6) under the owner's explicit implementer override; Claude reviews/tests/merges. All changes remain uncommitted. No r9-owned files were edited; MaterialDetail.tsx was not needed.
- Instructor practice questions are filtered before packet/handout serialization by default; an all-correction test becomes null. Helpers and dialog consider both study sets and tests, show the filtered question count, and select an instructor-only question part when she deliberately includes corrections.
- Handouts label included practice stems with the existing authorRef labels; answer-key rendering adds no labels and sees only the same filtered questions. Packet v1 remains strict: imported questions have only the five content fields, and the serialized JSON key scan excludes origin/identity/replaces.
- Gemini/import tests with exported authored questions receive the existing handwritten supplement once, even when the set also needs it; manual-test wording is preserved. Excluded questions do not trigger the supplement.
- Search needed no fix: saved.rs already indexes question_text only, with no options, correct_index, explanation, logical_id or replaces_id. The new real-schema save_practice_authoring_at regression searches distinct stem/option/explanation words and checks snippets: only the stem is found.
- Evidence: `docs/evidence/offline-03b-2026-10-19/r10/`. Node uses the requested Node 22 PATH; Vitest uses --configLoader runner --no-cache; build uses --configLoader runner. Cargo uses the requested SDKROOT and separate target-r10 directory.
- focused-initial.log EXIT 1: 3 files, 45 passed / 2 failed (new test variable shadowed its fixture function; fixed). focused.log EXIT 0: 3 files / 47 passed.
- vitest-full.log EXIT 0: 194 files passed / 4 skipped; 4,088 tests passed / 6 skipped / 0 failed. No r9 failures observed.
- typecheck.log EXIT 0; build.log EXIT 0 (existing >500 kB chunk advisory).
- cargo-saved.log EXIT 0: 1 passed / 841 filtered out. cargo-full.log includes both this receipt and full --locked --no-fail-fast receipt, EXIT 101: library 721 passed / 110 failed / 11 ignored; integration suites 13 and 15 passed; total 749 passed / 110 failed / 11 ignored; zero main/doc tests.
- All 110 native failures are the same sandbox socket restriction at fake_gemini.rs:176:57, TcpListener::bind("127.0.0.1:0") -> PermissionDenied / Operation not permitted. No production or fake-server code was changed to bypass the sandbox; full native green remains unverified here.
- fmt-initial.log EXIT 1: one wrapping difference in the new native test; fmt-write.log EXIT 0; fmt.log EXIT 0. clippy.log EXIT 0 with --all-targets -- -D warnings. cargo-lock.log EXIT 0.
- diff-check.log EXIT 2: six existing trailing-whitespace lines in documentRepository.test.ts (160, 202, 208, 224, 241) and importStudyPacket.test.ts (127), outside r10; left untouched. diff-check-r10.log EXIT 0 for all seven r10 source files. SHA256-source.txt EXIT 0.
- User-facing strings reused for practice: “Include my instructor's corrections”; “Left out unless you include them”; “Study packets don't record who wrote each item. When imported, everything shows as imported.”; “Some items were written or corrected by hand in Her Flight Deck, not generated.”; “(written by hand)”; “(instructor correction)”; filtered “1 question” / “{n} questions”. Manual wording remains “written by hand in Her Flight Deck; not checked by the app”. No new literal wording.
- Browser packet/print walkthrough and installed-app behavior remain for Claude's independent review. No transaction/validator behavior, packet v2, commits, pushes or installations.
- Source files and SHA256 (whole files):
- `src/logic/studyExport.ts` — `2c6f4115fae80dc59d401594217aa8d7a9a90bd7fe29accdadfa2fe36f832ab4`
- `src/logic/studyExport.test.ts` — `db3b756f35aac885e9ba6f1c1c5913d02d9733ce147fccf6f61f569d770cb217`
- `src/logic/studyHandout.ts` — `7089c7a44bc21297bc92127c40cf4e0df7a467fb9021c1380316e5b480f6677d`
- `src/logic/studyHandout.test.ts` — `2c7f51bf5c68fbb2dc307c9e11056b85829688186407237b702d5764672c2655`
- `src/pages/StudyLibrary/ExportStudyDialog.tsx` — `1a6cfcd843eafd3d2784c45e9dcbd599816a726bbd1fce4ab343268627b5496d`
- `src/pages/StudyLibrary/ExportStudyDialog.test.ts` — `269ec1fa5183ff13b03f00a2519c2b71cede4d4f8bcb43f32ea5eed4842aac47`
- `src-tauri/src/extraction/search/saved/tests.rs` — `bf724f77b4cc592db85929635b5951394a7c623f0a6a5d7a5bcdddeb3c5c4e55`
