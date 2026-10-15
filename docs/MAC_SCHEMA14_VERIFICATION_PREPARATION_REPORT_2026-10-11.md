# Schema-14 Mac verification preparation — report

11–12 October 2026, revised after the third review (round 4). **Ready for independent re-review.** Every required check passes on Node 22.23.3, including `npm run test:cargo-lock` (exit 0; the owner installed Rust/Cargo and the locked dependency fetch succeeded) and the proof runner (12/12 stages). No Rust or Cargo file changed. The package is uncommitted and unpushed. It is source-only: no installer was built, no app was launched and no real profile was read.

Assignment: [MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md](MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md). Evidence: [evidence pack](evidence/mac-schema14-verification-preparation-2026-10-11/README.md). Future operator steps: [RUNBOOK.md](evidence/mac-schema14-verification-preparation-2026-10-11/RUNBOOK.md).

## Round 4: what the third review found and what changed

The third review did not approve the package. Its controller results (Vitest 117/117, helper tests 16/16, proof 12/12, Cargo lock exit 0, typecheck exit 0, `git diff --check` exit 0, 10/10 manifest and 4/4 checksum entries matching) stand as recorded in `verification-receipts.json` → `reviewHistory.round3Review`. The round-3 receipt, manifest and `SHA256SUMS` are embedded there unchanged.

| Finding | Controller result | Change in round 4 | Covered by |
| --- | --- | --- | --- |
| The schema-object inventory used `name NOT LIKE 'sqlite_%'`. In `LIKE`, `_` matches any character, so a user table such as `sqlitex_user_evidence` (and any index or trigger named like it) was left out of the inventory and could escape the contract check. | independent SQLite probe | Both inventory queries (capture and pin derivation) now use one filter, `substr(name, 1, 7) <> 'sqlite_'`, which excludes only SQLite's own objects with the literal prefix. | Self-check `schema: a sqlitex_ user table is inventoried, not hidden by a LIKE wildcard` and `schema: sqlite-like index and trigger names are inventoried`; `node --test` "inventory and runtime-root boundaries"; proof reversion `literal sqlite_ prefix exclusion` (with `LIKE` restored, the table is not captured and `unchanged` passes, so the named regression fails) |
| `backups/`, `.restore-staging/` and `.restore-pending/` were listed with `readdirSync` without inspecting the roots first, so a symlinked root let the helper hash files outside the approved profile. | code review | Each runtime root is now `lstat`ed before listing. A symlinked root is refused (`<root>/ is a symlink — refusing to follow it outside the profile`), as is a root that is not a directory; an absent root is skipped. Nothing is written on refusal. Entries inside a real root keep their existing per-entry `lstat` handling. | Self-check `guard: a symlinked <root>/ runtime root is refused before listing it` (all three roots); `node --test` (three refusals and one real `backups/` control); proof reversion `symlinked runtime-root refusal` (with a link-following `stat` restored, the snapshot is written and `backups/private.txt` from outside the profile is hashed, so the named regression fails) |
| Regenerate receipts, manifest and checksums in order. | — | Sources and documents were finalized first; the receipt was consolidated next, then the manifest, then `SHA256SUMS`, and every entry was re-verified against the final bytes. | `source-manifest.json`, `SHA256SUMS` |

Not changed, and disclosed: the historical schema-13 helper uses the same `LIKE 'sqlite_%'` filter. This round's scope for that helper is the own-key fix only; its replay of PR #142 depends on its inventory staying as reviewed. A schema-13 inventory taken with it can omit any user object whose name is `sqlite` followed by at least one more character (for example `sqlitex_…` or `sqlite1…`).

## Round 3 (history): what the second review found and what changed

The second review did not approve the package. Its controller results stand as recorded and are kept as data in `verification-receipts.json` → `reviewHistory.round2Review`.

| Finding | Controller result | Change in round 3 | Covered by |
| --- | --- | --- | --- |
| Proof stages `source-identity` and `protected-sources-unchanged` failed. | exit 1, 9/11 stages | Cause, reproduced here before any change: once Cargo ran, its gitignored, untracked build output (`src-tauri/target/`, `src-tauri/gen/schemas/`, 4 130 files) was reported as files outside the allowed paths. Head, pinned index tree, migration hashes and ceiling all still matched. The walker now sets aside exactly two paths, and only when each is recognized narrowly. Each must be a real directory with its exact `.gitignore` rule and no tracked path inside. `src-tauri/target` must also carry Cargo's `CACHEDIR.TAG` signature (a single-linked regular file) and hold only Cargo's top-level entries; it is not descended. `src-tauri/gen` must hold only `schemas/` with Tauri's generated schema JSON names, each a regular, single-linked, bounded, parseable file. Unrecognized build output is walked, and every file in it is reported. Tracked-file checks are unchanged: pinned tree digest, blob ids, modes and deletions. The receipt lists what was set aside (`buildOutputSetAside`). | New proof stage `source-walker-sensitivity` (11 cases on disposable trees); `node --test` "proof source walker" (2 tests); proof stages `source-identity`, `protected-sources-unchanged` |
| 9/10 source-manifest and 3/4 `SHA256SUMS` entries did not match current bytes. | read-only verification | Files had changed after the inventories were generated. In round 3 every source and document was finalized first. The receipt was consolidated next, then the manifest, then `SHA256SUMS`, and every entry was re-verified against the final bytes. | `source-manifest.json` and `SHA256SUMS`, re-verified against the final bytes after generation (this report is itself hashed there, so it cannot carry that result) |
| Report, handoff, README and receipts kept obsolete Cargo-unavailable claims and omitted the latest proof failure. | — | Current conclusions now report the measured Cargo PASS and proof PASS. The round-2 Cargo block and both earlier proof failures are kept below as history. | This report; `verification-receipts.json` → `reviewHistory` |

The pre-fix failure was reproduced in this worktree before the walker changed (Node 26.10.0, the machine default: 9/11 stages, the same two stages, 4 130 paths, all under `src-tauri/gen` and `src-tauri/target`). That receipt is embedded in `verification-receipts.json` → `reviewHistory.round3PreFixReproduction`.

## Round 2 (history): what the first review found and what changed

The first review did not approve the package. Its controller results stand as recorded; this run does not overwrite them. They are also kept as data in `verification-receipts.json` → `previousReview`.

| Finding | Controller result | Change in round 2 | Covered by |
| --- | --- | --- | --- |
| The distributed schema-14 helper had a `testContext` route that swapped process inspection and skipped operator isolation. | — | Removed. `snapshot()` always calls `operatorLane()`, which returns only the approved lane (`hfdtest`, uid 502, real `pgrep`, `guardOperatorIsolation`). The scratch lane, the adapter export and the self-check entry exist only in disposable copies written by `writeDisposableHelper()` in the proof runner. The distributed CLI refuses `self-check`. | Proof stage `distributed-helper-lane`; `node --test` "distributed helper" |
| Vitest restore/tamper case failed: a synthetic managed document had two hard links. | exit 1, 7 passed, 1 failed | The failure did not reproduce here, so its exact cause is unconfirmed. Fixtures no longer depend on a platform copy primitive: `cloneScratchProfile` rewrites every file into a new inode instead of using `fs.cpSync`, and refuses a clone that is not single-linked. The Vitest case asserts every document is single-linked before each capture. The hard-link refusal is unchanged. | Focused Vitest; `node --test` "clones are independent single-linked files"; self-check `guard: a hard-linked managed document is refused` |
| Proof stages `source-identity` and `protected-sources-unchanged` were blocked because the sandbox denied `/dev/null` (every `git` process opens it at startup). | exit 1, 8/10 stages | The proof runner no longer starts `git`. It reads HEAD, refs and the index from `.git`, hashes worktree bytes as git blobs, and checks tracked paths outside the allowed list against a pinned digest of the pinned commit's tree (4 198 entries). | Proof stages `source-identity`, `protected-sources-unchanged` |
| `npm run test:cargo-lock` blocked by the missing Cargo toolchain. | exit 1 | Nothing could change in round 2. *Superseded in round 3:* the owner installed Rust/Cargo, and the check now passes (exit 0). | Round 3: cargo lock sync |
| No observed pre-edit receipt. | — | Kept as a stated limitation, below. | — |

In round 2 the `/dev/null` change had not been re-run inside the controller's sandbox. The round-2 review then ran it there: those two stages no longer failed on `/dev/null`, but they did fail on the Cargo build output (round 3 above).

## Starting state

- Isolated clone `runs/20261011-231314-695918/isolated-repo`, remote removed after cloning, at `8a260c0b32bc213850ed85bf9488d6ef571354a9`. Worktree branch `agents/task-20261011-231314-695918` is at the same commit. That commit contains accepted M3 schema 14 (migration 0014) and merged PR #143 (`b178066`).
- **Limitation: there is no observed pre-edit receipt.** No receipt of the clone's clean state was saved before editing began, so this package does not establish the observed clean pre-edit state. What it does show is a reconstruction: the hash each allowed path had at the immutable pinned HEAD, and current proof that no tracked path outside the allowed list differs from HEAD.
- Ownership: the original checkout's worktree list (read-only) shows no schema-14 helper branch or worktree, in the first capture and in a round-2 capture. The pinned commit has no `scripts/mac-schema14-*`. Gemini's M4 worktrees and the primary checkout were not touched.

## Deliverables

| Path | Role |
| --- | --- |
| `scripts/mac-schema13-profile-snapshot.mjs` | Historical helper. `metadataKeyDigests()` now uses a prototype-free map (PR143-N1). Seven special-key self-check regressions were added; they record a refused comparison as that check's own failure. The ceiling stays 13. |
| `scripts/mac-schema14-profile-snapshot.mjs` | New current-schema helper with the contract `hfd-schema14-contract/1`, pinned to the commit above. It exports nothing, has one operator entry and one fixed operator lane, and has no test route. |
| `scripts/mac-schema14-profile-snapshot.test.mjs` | `node --test` regressions: the shipped CLI as distributed, plus capture/compare through a disposable copy. |
| `scripts/mac-schema14-verification-proof.mjs` | Runnable disposable proof package with 12 stages, and the only home of the scratch lane (`writeDisposableHelper()`). `self-check` runs the schema-14 helper's self-check in a disposable copy. Its receipt goes to a fresh temporary directory, never into the repository. |
| `src/logic/currentSchemaVerification.test.ts` | Permanent Vitest regressions that check the helper against the production M3 writer, `validateApplicationDatabase` and the registered migrations. |
| `docs/evidence/mac-schema14-verification-preparation-2026-10-11/` | README, RUNBOOK, consolidated `verification-receipts.json`, `source-manifest.json` and `SHA256SUMS`. |

## The schema-14 contract

- **Source binding:** commit `8a260c0b…`, ceiling 14, and the registered migrations 0001–0014. Each migration is pinned by description, file SHA-256 (as in `migration-checksums.json`) and SQLx SHA-384 of its exact bytes. Migration 14's SHA-384 is `d034e5ae…b7fc0e`. A self-check anchor re-derives every pin from the shipped source.
- **Complete inventory:** 41 known tables (33 retained schema-12 tables, 2 split tables and the 6 M3 tables) plus SQLx's own ledger table. Every table is digested with framed, type-aware row digests in real primary-key order.
- **Schema objects:** 97 objects (41 tables, 42 indexes, 14 triggers) plus the ledger. Each is pinned by the SHA-256 of the exact definition SQLite stores and by the migration that creates it. The objects expected at version *v* are exactly those created at or before *v*.
- **Each snapshot is checked against the pin:** a missing, unsuccessful or wrong-checksum migration, a gap, an unregistered or newer version, or a missing, unexpected or altered object is a named FAIL.
- **Snapshot validation:** a snapshot without complete inventory, definitions, ledger rows, permission facts or file anchors is refused. So is one with an inconsistent digest, a mismatched key-digest count, or a binding to another commit or ceiling. Historical snapshot/1–3 receipts are refused as legacy and never reinterpreted.
- **Seed versus user evidence:** after an upgrade or restore, the two catalog tables must equal the exact migration-14 seed: 15 entries and 15 revisions, matched by framed digest, so editing seed content cannot pass by keeping the count. The four evidence tables must be empty. Retained user evidence (observations, revisions, status and confidence, links, custom skills, operations and erased-operation tombstones) is compared row for row whenever the baseline already holds it.
- **Ledger rules:** `unchanged` and `history` require identical ledger rows. `upgrade` (13→14) and `restore` (12, 13 or 14 → 14) require every retained ledger row to be unchanged in every column, and require exactly the expected later migrations. A no-op upgrade fails.
- **Receipt exclusion:** only `restore` sets aside `last_complete_backup_at`, `last_complete_backup_path` and `last_complete_backup_version`, by exact name. Every restore result discloses this in `receiptExclusion`, in `sections.backupReceipt` and in a note. All other metadata keys, including `__proto__`, `constructor`, `toString` and Unicode keys, stay protected under every purpose.
- **Operational safeguards:** the reviewed fail-closed checks carry over. The app must be confirmed stopped before any database byte is read. The approved account and profile are `hfdtest`, uid 502, standard account, canonical root, with no `--profile` and no retargeting. Outputs must be fresh absolute paths that alias nothing, with symlink and hard-link refusal. New in this helper:
  - receipts are opened without following links and limited to 64 MiB;
  - inputs are bounded to 100 000 files, 1 000 ledger rows and 100 000 metadata keys;
  - managed documents with more than one hard link are refused;
  - the runtime roots `backups/`, `.restore-staging/` and `.restore-pending/` are refused if they are symlinks or not directories, before anything inside them is listed;
  - the schema-object inventory excludes only the literal `sqlite_` prefix, so `sqlitex_…`-style user objects are always inventoried;
  - permission facts are recorded read-only, and `unchanged` fails if an operation's write block was not recovered.

  The distributed file has no `process.env` access, no exports and no test route of any kind. Scratch capture happens only in disposable copies whose marked lane region is replaced; the copy's scratch lane accepts only task-owned roots under the real temporary directory and never an application-data location.

## Measured results, round 4 (Node 22.23.3, cwd = worktree root)

Raw argv, cwd, start time, duration, exit, full stdout/stderr and parsed counts are in `verification-receipts.json`.

| Command | Exit | Result |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache` on the five required files | 0 | 5 files, 117/117 tests |
| `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | 0 | 21/21 |
| `node scripts/mac-schema14-verification-proof.mjs` | 0 | 12/12 stages |
| `node scripts/mac-schema14-verification-proof.mjs self-check` (schema-14 self-check in a disposable copy) | 0 | 102/102 |
| `node scripts/mac-schema14-profile-snapshot.mjs self-check` (distributed file) | 2 (expected) | refused: no test route |
| `node scripts/mac-schema13-profile-snapshot.mjs self-check` | 1 (expected) | 105/106; the only failure is the intentional ceiling alarm |
| `npm run typecheck` | 0 | clean |
| `npm run test:cargo-lock` | 0 | Cargo.lock in sync |
| `git diff --check`, a whitespace check of every new file, and a git-free scan of every changed or new file | 0 | clean |

`npm run build` was not run: no app-shared runtime code changed, and typecheck covers the new test file.

## Requirement → evidence map

| Requirement | Evidence |
| --- | --- |
| Special keys in both helpers, on real SQLite: own digests, counts, unchanged/restore pass, changed/added/removed fail, never excluded | Schema-13 self-check: 7 special-key checks. Schema-14 self-check: `metadata:*` and `receipt: a changed/removed/added/changed-unicode protected metadata key fails restore`. `node --test`: `special metadata keys on real SQLite`. Vitest: upgrade test and restore tamper case. |
| Historical helper stays schema-13, ceiling alarm reported separately | Proof stage `historical-schema13-self-check`: exit 1, and the failure list is exactly the alarm. |
| Original installed evidence byte-identical; PR #142 replay keeps the original restore FAIL and exact diffs | Proof stages `pr142-replay` (all six original comparisons: same verdicts, same diffs; schema-14 helper refuses them as legacy) and `protected-sources-unchanged` (PR #142 JSON, frozen kit `final-helper.mjs`, SHA256SUMS, migrations and fixtures re-hashed). |
| Pins equal genuine installed facts | Proof stage `installed-schema-anchors`: definitions and SQLx ledger rows in PR #142's installed schema-12 and schema-13 snapshots equal the pins. |
| Missing, unsuccessful or wrong-checksum migration, newer version, gaps, ledger-prefix edits, extra or missing or altered objects, and no-op upgrade cannot PASS | Schema-14 self-check `ledger:*`, `schema:*` and `contract upgrade: a no-op upgrade…`; proof reversions `missing-ledger guard`, `ledger-prefix row guard`, `definition-pin guard`. |
| Incomplete inventory or definitions, partial or unknown snapshots refused | Self-check `validation:*`; proof reversions `inventory completeness guard` and `definition completeness guard`; `history` is always PARTIAL. |
| Populated 13→14 upgrade, 12/13/14 archive-state restore into 14, populated schema-14 invariance | Vitest (production writer and validator on both sides); proof stage `fixture-proofs`; self-check `contract upgrade/restore/unchanged`. |
| Writer-created observations, revisions, status/confidence, links and tombstones protected | Vitest `writer-created schema-14 evidence` and `M3-R9` (removing each of the 11 history-owning receipts is refused by the production validator and fails `unchanged`); proof `fixture-proofs.writerPopulated14.tampers`; self-check `m3:*`. |
| Unchanged, cancel and failure invariance | Vitest: a refused (stale) write and an injected mid-transaction storage failure leave every fact unchanged. Self-check permissions case. |
| Only the three receipt keys excluded, restore only, disclosed | Self-check `receipt:*`; `node --test` `sets aside exactly the three receipt keys, only for restore`; proof reversions `exclusion scope (exact three keys)` and `exclusion scope (restore only)`. |
| Operational safeguards fail closed | Self-check `guard:*`, `output:*`, `operator:*`, `input:*`, `copy:*`, `wal:*`; `node --test` `operator CLI refusals/compare` and `the disposable copy's scratch lane`. |
| No test bypass in distributed code; adapters only in disposable copies | Proof stage `distributed-helper-lane` (no forbidden tokens, the lane region is exactly the approved lane, one `operatorLane()` call, distributed CLI snapshot and self-check refuse and write nothing); `node --test` `distributed helper`. |
| Proof walker: gitignored Cargo/Tauri output set aside only when exactly recognized; unexpected source and changed protected files still reported | Proof stage `source-walker-sensitivity`, 11 named cases. Accepted: a genuine Cargo target (including Cargo's own hard links, not descended) and Tauri gen schemas. Reported: source beside the output; source inside `gen`; an unknown entry in `target`; `target` without its cache tag; `target` as a symlink; a hard-linked `gen` schema; output without its `.gitignore` rule; a tracked path inside the output; a changed migration; a deleted migration. `node --test` "proof source walker". |
| Inventory excludes only SQLite's own `sqlite_` objects | Self-check `schema: a sqlitex_ user table…` and `schema: sqlite-like index and trigger names…`; `node --test` "inventories sqlite-like user objects…"; proof reversion `literal sqlite_ prefix exclusion`. |
| Runtime roots are never followed outside the profile | Self-check `guard: a symlinked backups/ | .restore-staging/ | .restore-pending/ runtime root is refused before listing it`; `node --test` three refusals plus a real-`backups/` control; proof reversion `symlinked runtime-root refusal`. |
| Guard sensitivity: named regression fails, not a startup error | Proof stage `guard-reversions`: 13 schema-14 guards, each removed from a disposable copy, make the named regression fail while a control upgrade on the same copy passes. Stage `historical-special-key-reversion`: the schema-13 map reverted fails exactly its 6 special-key checks, and the run completes. |
| Existing production validation stays authoritative | The Vitest file calls `validateApplicationDatabase` and the production M3 store unmodified. The helper's M3 lists are tested against `SKILL_EVIDENCE_TABLES`, `SKILL_EVIDENCE_INDEXES` and `SKILL_EVIDENCE_TRIGGERS`. |

## Limitations

- **Synthetic SQLx ledger.** Scratch ledgers are written by the helper's scratch builder, using SQLx's exact table definition, the shipped descriptions and SHA-384 checksums. They are not written by SQLx itself. The `installed-schema-anchors` stage compares the pins with genuine installed ledgers from PR #142, but only for schemas 12 and 13.
- **Closed database copies, not native backups.** Restores put closed database copies back in place and migrate them. No native backup archive was created and no native restore path ran, so this is not native application backup compatibility proof. The Rust validator and SQLx migrator were not run; the TypeScript production writer and validator were, on `node:sqlite`.
- **Permission recovery tied to a run and operation** is enforced by an operator tool, as in the frozen schema-13 kit's `hfd-operator.sh`. That tool is bound to the schema-13 kit and candidates and was not retargeted. This helper only detects an unrecovered block through `unchanged`. A schema-14 operator kit is a missing input for the future run.
- **No observed pre-edit receipt**, as stated under Starting state.
- **The historical schema-13 helper keeps its reviewed internal test context and its `LIKE 'sqlite_%'` inventory filter.** It is unchanged from the pinned commit apart from the own-key fix and its regressions; this task does not redesign it. Its inventory can omit a user object whose name is `sqlite` followed by at least one more character (round-4 note above).
- **No schema-14 installer exists.** Installer, DMG and binary hashes, version and lane are **unavailable**. Nothing was constructed.
- **Cargo build output is set aside without being descended.** `src-tauri/target` is accepted on its path, its ignore rule, Cargo's cache tag and its top-level shape. Files deep inside it are not hashed. It is gitignored and never submitted, and every tracked file is still checked byte for byte.
- **Proof on Node 22 only.** The required runs used Node 22.23.3. The round-3 pre-fix reproduction used the machine-default Node 26.10.0 and is labelled as such.

## Proposed handoff entry

Proposed for `docs/PROJECT_HANDOFF.md` (also present in this package's diff):

> **Schema-14 verification preparation — round 4, ready for re-review (11–12 October 2026).** Source-only package at pinned `8a260c0`, uncommitted. (1) *Historical installed evidence:* PR #142's administrator-account schema-12→13 results stay as recorded, including the strict restore FAIL; the replay is unchanged. (2) *Accepted source fixes:* PR #143's practice-date fix (`b178066`), and PR143-N1 fixed in the historical helper (own-key metadata map), with its schema-13 ceiling alarm kept. (3) *New source proof:* `mac-schema14-profile-snapshot.mjs`, pinned to migrations 1–14, 97 objects and the catalog seed, proved on disposable SQLite with the production M3 writer and validator. The distributed helper has no test route; scratch capture runs only in disposable copies. The inventory excludes only the literal `sqlite_` prefix, and symlinked runtime roots are refused before listing. The proof runner passes 12/12 stages: 13 schema-14 guard reversions, the schema-13 special-key reversion, and a source-walker sensitivity stage that sets aside only recognized Cargo/Tauri build output. The Cargo lock check passes. Earlier failures stay recorded: round 1 (hard-link fixture, `/dev/null`, Cargo missing) round 2 (proof 9/11 on unrecognized build output) and round 3 (two review findings: the `LIKE` wildcard and symlinked runtime roots). (4) *Unresolved installed gates:* there is no schema-14 installer; the standard-account (`hfdtest`) run, mid-save fault injection, signing/notarization and release remain open. M4 is unaffected.

## Future human steps

1. Independent review of this package, then commit and integration by the coordinator.
2. When the owner authorizes a schema-14 candidate, follow [RUNBOOK.md](evidence/mac-schema14-verification-preparation-2026-10-11/RUNBOOK.md). It lists the inputs that do not exist yet.
