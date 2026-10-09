# M2 split-source lineage — independent production source review (8 October 2026)

**Decision: ACCEPT — the implementation can be integrated.** It is a faithful, proven port
of the accepted round-5 split-lineage contract. I found **no defect in the feature code**.
One **non-blocking, pre-existing** native-test-hygiene finding is recorded (F-1); it is
byte-identical to `origin/main` and not part of this delivery.

## How it was run

- Reviewed the uncommitted delivery at
  `/Users/rickymac/code/Flight-training-split-lineage-implementation`
  (branch `codex/m2-split-lineage-implementation`, base = HEAD = `2a6a415`, nothing staged)
  **without touching it**.
- All reproduction ran on an isolated APFS clone
  (`/Users/rickymac/code/.qwen/tmp/split-lineage-review-2026-10-08/copy`) with `node_modules`
  symlinked from a byte-identical-lockfile sibling; toolchain Node 22.23.3 / npm 10.9.9 /
  rustc & cargo 1.99.0 / `SDKROOT=MacOSX27.0.sdk`.
- Read the source, not only the tests: `lineage.rs`, `pdf.rs`, `backup.rs`,
  `practiceStateValidation.ts`, `splitLineageShapes.ts`, `splitLineage.ts`, `splitSave.ts`,
  `SplitLineageDetails.tsx`, `documentRepository.ts`, `tauriDb.ts`, `db.ts`, `types.ts`,
  `migrations.ts` + both split dialogs, and the two test suites.

## Integrity (see `docs/evidence/m2-split-lineage-source-review-2026-10-08/hash-verification.txt`)

- 35/35 `source-hashes.json` entries match the worktree; 32/32 pack `SHA256SUMS` verify; the
  manifest set equals the git changed set exactly (20 modified + 15 new), nothing extra or missing.
- Migrations 0001–0012 byte-identical to base; the registry adds **only** 0013
  (checksum `4118a789…b106`); `CURRENT_SCHEMA_VERSION = 13`.
- `src-tauri/migrations/0013_split_source_lineage.sql` is **byte-identical** to the round-5
  `candidate_migration_0013.sql`, which is stronger than the required "table definitions match."
- Scope document hash `6352f009…acd9b` verified.

## Reproduced results

| Check | This review | Pack claim |
| --- | --- | --- |
| Focused Vitest (7 files) | 110 passed, exit 0 | 110, exit 0 |
| Focused native (single-threaded) | 41 passed (lineage 21 / split 19 +2 ignored / newer_database 1), exit 0 | 41, exit 0 |
| `npm run typecheck` | exit 0 | exit 0 |
| Validator contract node:sqlite + sql.js | 17 passed (15 cases + coverage), exit 0 | 3 engines |
| Validator contract native | passes (asserts ≥15), exit 0 | 3 engines |
| Sensitivity S1–S5 | all caught, all files restored, driver exit 0 | all caught |
| Full `npm test` (rerun) | 2,862 passed / 5 skipped, exit 0 | 2,862 / 5 |
| Full `cargo test --all-targets` (single-threaded, rerun) | 444 passed / 6 ignored, exit 0 | 444 / 6 |

I reran the full matrices because F-1 makes the native gate non-deterministic at default
parallelism; both are clean when that pre-existing timing collision is removed.

## Contract verification (source-level)

- **Receipt is the only authority.** The splitter reads the source once and hashes exactly the
  bytes it splits; `issue_receipt` binds the receipt to the material that owns the file and
  records `pending` with an `INSERT … WHERE NOT EXISTS`, so re-issue never mutates a settled
  record and a missing root stays `NULL` (never promoted to parent). Save recomputes
  `sha256(canonical_json(core))` and matches it to `receipt.receipt_hash`, `receipt.operation_id`
  and the recorded row's `receipt_hash` + `source_material_id` before any write; `deny_unknown_fields`
  plus the strict TS `isSplitSourceReceipt` guard (keys exactly, `operationId === receiptHash`)
  stop a webview minting, editing or extending a receipt. Sensitivity S1 and S5 fail when either
  layer is loosened.
- **Save transaction.** Every safety check runs before any write and the file read sits honestly
  outside the transaction: pending-status, source row + `file_path`, the nine-field nested
  snapshot and output-id collisions are re-checked inside `BEGIN IMMEDIATE`; parts inherit
  type/topic/priority/goal/event/tags from the source and take only title+notes from the
  interface (length-bounded, id-matched); commit is conditional on `status = 'pending'`;
  a mid-save failure rolls back to zero rows with the record still `pending`.
- **Cancel & read-back.** Cancel touches only a `pending` record, removes only that plan's own
  files and only when no material owns them, and returns a committed split untouched.
  `splitSave` reconciles by operation id before cancelling, and `mutate` distinguishes a
  committed-but-lost-ack save (kept) from a genuine failure (cancelled) — the cancel/save race
  is closed by the conditional updates on both sides.
- **Read model & UI.** Structural tiers, per-tier verdicts against each tier's own file,
  unknown never vouched or grouped, same-edition siblings only, correct two-tier coordinates
  (A20–40 of R101–300 ⇒ R120–140) validated on a shared fixture in native and TS; fingerprinting
  is off the render path, bounded to ≤20 files, safe paths only; copy is warm and honest about
  "unknown"; controls are labelled and use live-region status.
- **Restore safety.** `verify_schema_13_lineage_semantics` and `validateSplitLineageState` are
  true twins over a reference built from the registered migrations; older binaries refuse schema
  13; a populated schema-12 library upgrades with practice and card history byte-for-byte; the
  two new tables' row-level FK integrity is enforced by schema-11's unqualified
  `PRAGMA foreign_key_check`, so the contract misses no important corruption case.
- **Regressions.** The generic `save_split_materials` / `createMany` / `executeMaterialsBatch`
  path is unchanged; the three ceiling tests changed only what schema 13 requires; no dangling
  `PdfPart` references remain; typecheck and build pass.

## Disclosed decisions

- **Decision 1 — ACCEPTABLE.** Browser mode cannot perform PDF file I/O, so there is no browser
  split-save to secure; leaving `executeMaterialsBatch` intact is required to avoid regressing
  every `createMany`. The native command is the sole writer; TS drivers are tested for read,
  refusal and restore across three engines. This matches assignment §3.3 "where applicable."
  The acceptance records this explicitly.
- **Decision 2 — ACCEPTABLE.** Refused saves staying `pending` until the interface reconciles
  then cancels preserves the at-most-once, owner-scoped cleanup guarantee and makes the lost-ack
  race safe. Residual: no automatic startup sweep for a crash between split and save (disclosed;
  the library's unlinked-file report already surfaces it).

The replaced partial work is judged correctly: each listed partial defect is real, and the sound
parts (migration, registration, checksum, schema 13, the receipt concept) were kept.

## Findings

- **F-1 (LOW, pre-existing, non-blocking).** `documents.rs:1979` `split_test_root()` names temp
  dirs `{pid}-{nanos}`; concurrent documents tests collide and `documents.rs:2003` `unwrap()`
  panics "table study_materials already exists," intermittently reding the native gate. It is
  unchanged from base (`git diff` on `documents.rs` has only two non-test hunks) and the delivered
  lineage/pdf tests are deterministic (6/6). Proven: fails on this source (`diag-documents-flake.txt`,
  `flake-parallel-split.txt`), passes once corrected with a bounded per-process sequence
  (`diag-flake-corrected.txt`, 15/15), controls pass now (`diag-control-lineage.txt`). Bounded fix:
  unique temp-dir name, or run native gate `--test-threads=1`. Owner decides PR vs follow-up; does
  not block integration.

See `docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md` for what to publish together and the
remaining Mac release gates.
