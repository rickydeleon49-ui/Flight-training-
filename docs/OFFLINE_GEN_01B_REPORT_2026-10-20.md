# GEN-01b implementation — 20 October 2026
Base `23c8378`, branch `codex/offline-gen`; no fast-forward needed. Uncommitted; Claude owns independent review, mutation checks and merge.
0018 is the next migration after shipped 0017. Only adjustment to the assigned SQL: `IF NOT EXISTS`, matching 0016/0017. Existing migrations and dependencies unchanged.
Validators compare table/column/FK/CHECK/key/index shapes with registered references, verify material joins, lowercase UUID-v4 run ids and 64-hex hashes, canonical sorted unique integer pages 1–1000, integer versions/offsets, ordered nonnegative offsets and 1–2000 Unicode-character quotes. Empty page arrays satisfy this storage contract; no preparation command exists here.
Shared contract: 48 cases (7 accept, 41 refuse) asserted after reopen in sql.js, node:sqlite and native; native also checks application-ladder agreement. Includes astral quotes and adjacent large i64 offsets. New tables are required only at schema >=18; older validation checks remain intact.
Backups: `schema_17_archive_restores_and_upgrades_to_18`, `schema_18_pdf_kit_archive_round_trip` (all run/source columns exact, cascades checked), `tampered_schema_18_pdf_kit_archive_refused` (5 corruptions; archive integrity recomputed, direct native semantics and restore refusal asserted). TS 17→18 driver upgrades preserve all older rows and reopen. No UI, save-receipt binding, draft kind, kit preparation or provider change.
```sql
-- Migration 0018: authoritative source evidence for locally extracted PDF kits.
CREATE TABLE IF NOT EXISTS pdf_kit_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL,
  selected_pages_json TEXT NOT NULL,
  extractor_version INTEGER NOT NULL,
  algorithm_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pdf_kit_item_sources (
  run_id TEXT NOT NULL REFERENCES pdf_kit_runs(run_id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('summary','section','card','question')),
  logical_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page BETWEEN 1 AND 1000),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
  quote TEXT NOT NULL CHECK (length(quote) BETWEEN 1 AND 2000),
  PRIMARY KEY (run_id, item_kind, logical_id, content_hash, page, start_offset)
);
CREATE INDEX IF NOT EXISTS idx_pdf_kit_runs_material ON pdf_kit_runs(material_id);
```
All raw receipts below are in [evidence](evidence/offline-gen-01b-2026-10-20/); `--configLoader runner` was used only after recorded Vite EPERM. Node v22.23.3; Cargo offline, default parallelism/timeouts.
Counts: P=passed, F=failed, I=ignored/skipped. Zero-test compile/setup failures are explicitly labelled. Earlier attempts remain evidence, not final acceptance.
`build-final.txt` EXIT 0; `build.txt` EXIT 0; `cargo-lock.txt` EXIT 0; `cargo-test-1.txt` EXIT 0 (933P/0F/11I, 13P/0F/0I, 15P/0F/0I).
`cargo-test-2.txt` EXIT 101 (933P/0F/11I, 12P/1F/0I, 15P/0F/0I); `cargo-test-3.txt` EXIT 0 (933P/0F/11I, 13P/0F/0I, 15P/0F/0I); `cargo-test-4.txt` EXIT 0 (933P/0F/11I, 13P/0F/0I, 15P/0F/0I); `clippy.txt` EXIT 0.
`diff-check-final.txt` EXIT 0; `diff-check.txt` EXIT 0; `extraction-artifact-recheck.txt` EXIT 0 (1P/0F/0I); `fmt-check.txt` EXIT 0.
`fmt-write-final-2.txt` EXIT 0; `fmt-write-final-3.txt` EXIT 0; `fmt-write-final.txt` EXIT 0; `fmt-write.txt` EXIT 0.
`green-focused-native-1.txt` EXIT 101 (2P/2F/0I); `green-focused-native-2.txt` EXIT 0 (4P/0F/0I); `green-focused-ts-1.txt` EXIT 1 (2 failed | 61 passed (63)); `green-focused-ts-2.txt` EXIT 0 (65 passed (65)).
`green-focused-ts-final.txt` EXIT 0 (65 passed (65)); `helper-real-output.txt` EXIT 1 (98P/4 intentional later-schema alarms (102)); `node-version.txt` EXIT 0; `npm-test-1.txt` EXIT 1 (1 failed | 4201 passed | 6 skipped (4208)).
`npm-test-2.txt` EXIT 0 (4202 passed | 6 skipped (4208)); `npm-test-3.txt` EXIT 1 (1 failed | 4201 passed | 6 skipped (4208)); `npm-test-4.txt` EXIT 0 (4202 passed | 6 skipped (4208)); `perf-recheck.txt` EXIT 0 (31 passed (31)).
`red-native-backups.txt` EXIT 101 (0P/2F/0I); `red-native-contract.txt` EXIT 101 (0P/1F/0I); `red-native-upgrade-replay-2.txt` EXIT 101 (0 tests; scratch include_str fixtures missing); `red-native-upgrade-replay.txt` EXIT 101 (0 tests; scratch include_str fixtures missing).
`red-native-upgrade.txt` EXIT 101 (0P/1F/0I); `red-ts-runner.txt` EXIT 1 (49 failed | 2 passed (51)); `red-ts.txt` EXIT 1 (0 tests; Vite EPERM); `schema14-checksums.txt` EXIT 0.
`schema14-helper-final.txt` EXIT 1 (25P/1F (sandbox pgrep)); `schema14-helper.txt` EXIT 1 (25P/1F (sandbox pgrep)); `split-lineage-upgrade.txt` EXIT 0 (3 passed (3)); `typecheck-final.txt` EXIT 0.
`typecheck.txt` EXIT 0.
Failures: initial fixture setup errors were corrected (migration-ledger columns and external backup directory); schema-12 upgrade ceiling updated 17→18. Initial native 17→18 RED failed in setup, not its missing-migration assertion; optional scratch replay stopped after two compile-preparation failures. `artifact-collision.md` explains cargo-test-2 and its repaired subprocess check. The concurrent npm-test-3 run timed out only the unchanged 1,000-card benchmark (60 s); perf-recheck passed all 31 tests at defaults with native jobs stopped. Final native passes are cargo-test-3/4; final frontend passes are npm-test-2/4. Helper stays 25/26 solely because sandbox pgrep writes stderr; reviewer must rerun outside sandbox. Real helper output confirms exactly the four intended later-schema alarms; schema-14 manifest/checksum inventory rebound and verified.
SHA-256 of changed source/manifest files (full report and receipt hashes are in [SHA256SUMS](evidence/offline-gen-01b-2026-10-20/SHA256SUMS); the checksum index excludes itself):
`docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS` `762b96b8534da4df764196984a76aee241b2d93a898f0b3b33c714eeea94eaf2`; `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json` `be5e0b9cdc297dcd616a177c0cce6abcf539e37aa2b7b2c4a71773a543e39580`
`scripts/mac-schema14-profile-snapshot.test.mjs` `91cbbbbd7e25ecee76492d8f05731e1066de95d83e5851a5a447a0158d198c20`; `src-tauri/fixtures/pdf-kit-validation/cases.json` `121d8f089f3f8bee842dc4c2bf0a3f8141667164a8a661f594e6a9049f49dccf`
`src-tauri/migrations/0018_pdf_kit_provenance.sql` `ee2b9bdb47c777b16d61bb9581c94551d7c7d8da7741741b00a0b2ca9a30443f`; `src-tauri/src/backup.rs` `5f6d25c47e64d9a54d83d2e6904ff17d33a98b51739f137f86bfd8862ae06b32`
`src-tauri/src/lib.rs` `8f7432f825ad8179ccf6ecbdcb81ee038c2a7cc639510518946f0716db7d0bbb`; `src/data/migration-checksums.json` `da4a5cc4ed7d0b4101bc10ea48a35341b6f3a1d55da35c1e7282b9b4857c9ea8`
`src/data/migrations.ts` `c6aee465b60efecdbdaaf84c151ad9545c7325c8e370c156a9a933546ea8dece`; `src/data/navigationUpgrade.test.ts` `0e0a712576a3d8ffb37939ccdb7a98d6ddaffcd1441e078b1292aeb3047ff860`
`src/data/pdfKitUpgrade.test.ts` `afcf990c6ecbc444a2c50626d72c9f79147cf93b611f38556ba690f84ce382df`; `src/data/pdfKitValidationParity.test.ts` `6a57e9f04cbb0104a5e63fbceccb5f8b35ef8817ae6830882599ca690fa2a5e4`
`src/data/practiceStateValidation.ts` `25fe2fda92975dd077d4ff9d30498d863ed77154444b7562e896a1101b476f12`; `src/data/skillEvidenceUpgrade.test.ts` `4852f2ec41a7289ba7fe7e75e5b04e309248780dd20412bd62f5b8703ef1ba0a`
`src/data/splitLineageStorage.test.ts` `0aee58fee1bd6ac07a463e34c4667a96354648608b12b40325c10353b5565fd5`; `src/data/testing/skillEvidenceEngines.ts` `f19b06a56c889853bc58be7c95238d66d022f0ea1d3f860d0a6909a85dfb2f45`
