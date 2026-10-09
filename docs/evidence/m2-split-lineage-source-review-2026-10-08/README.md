# M2 split-source lineage — independent production source review (8 October 2026)

**Reviewer:** independent senior source reviewer (Qwen Code).
**Decision: ACCEPT for integration.** The split-lineage implementation is a faithful
port of the accepted round-5 contract. No defect in the feature code was found.
One **non-blocking, pre-existing** test-hygiene finding is recorded (§ Finding 1) with
a proven bounded fix; it is unchanged from `origin/main` and is not part of this delivery.

**Worktree reviewed (left untouched):** `/Users/rickymac/code/Flight-training-split-lineage-implementation`,
branch `codex/m2-split-lineage-implementation`, base and HEAD
`2a6a41536b676559db94b476c71dd645af03fbab`, nothing staged.
All execution ran on an isolated APFS copy-on-write clone under
`/Users/rickymac/code/.qwen/tmp/split-lineage-review-2026-10-08/copy`
with `node_modules` symlinked from `Flight-training-pr70-integration`
(`package-lock.json` byte-identical: `b9e294fd…ac613`).

**Read first (references, all pre-main):** the implementation evidence pack
`…/m2-split-lineage-implementation-2026-10-08/README.md` + `REQUIREMENTS.md` +
`OWNER_APPROVAL.md`; the accepted scope
`docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md` (SHA-256 `6352f009…acd9b`, verified);
the round-5 acceptance, owner approval and implementation prompt in
`/Users/rickymac/code/split-lineage-round5-review/`.

## 1. Integrity — verified against the worktree (see `hash-verification.txt`)

| Check | Result |
| --- | --- |
| `source-hashes.json` `files` object | 35/35 match, 0 mismatch, 0 missing |
| Pack `SHA256SUMS` | 32/32 `OK`, exit 0; every file in the pack except itself is listed |
| Manifest completeness | manifest set == git changed set exactly (20 modified + 15 new), no extras/omissions |
| Migrations 0001–0012 | byte-identical to base (0 differing) |
| Migration registry | adds only `0013_split_source_lineage.sql`; checksum `4118a789…b106`; `CURRENT_SCHEMA_VERSION = 13` |
| `0013` vs round-5 `candidate_migration_0013.sql` | **byte-identical** (hash `4118a789…b106`), exceeds "table definitions" |
| Worktree state | HEAD = base, branch correct, `staged_count = 0` |
| Scope document | SHA-256 `6352f00992be94b4df2836240afe042395809a50811a32ec16d453c0819acd9b` |

## 2. Reproduction (isolated copy; Node 22.23.3 / npm 10.9.9 / rustc & cargo 1.99.0 / MacOSX27.0 SDK)

| Run | Result | Receipt |
| --- | --- | --- |
| Focused Vitest (7 files) | **110 passed**, exit 0 | `receipts/01-focused-vitest.txt` |
| Focused native, single-threaded (lineage 21 + split 19 + 2 ignored + newer_database 1) | **41 passed**, exit 0 | `receipts/02-focused-native.txt` |
| `npm run typecheck` | exit 0 | `receipts/03-typecheck.txt` |
| Shared validator contract — node:sqlite (15) + sql.js + coverage | **17 passed**, exit 0 | `receipts/04-validator-node-sqljs.txt` |
| Shared validator contract — native `shared_lineage_validation_contract_native_outcomes` | **1 passed** (asserts ≥15 cases), exit 0 | `receipts/05-validator-native.txt` |
| Sensitivity S1–S5 (`run_sensitivity.py`) | each variant's named test fails, every file restored & SHA-checked; driver exit 0 | `receipts/sensitivity/` |
| Full `npm test` (rerun — justified by Finding 1) | **2,862 passed / 5 skipped**, 107 files + 3 skipped, exit 0 | `receipts/10-npm-test-full.txt` |
| Full `cargo test --all-targets`, single-threaded (rerun — justified by Finding 1) | **444 passed / 6 ignored**, exit 0 | `receipts/11-cargo-test-all-single.txt` |

The focused-native figure is reported single-threaded because the pack's own
`run_gate.sh` step 02 fails intermittently at default parallelism — Finding 1.

## 3. Source findings

### Finding 1 — pre-existing flaky native-test helper (LOW, not introduced by this work)
- **File/line:** `src-tauri/src/documents.rs:1979` `split_test_root()` (test module),
  temp dir named `hfd-split-{pid}-{nanos}`.
- **Trigger:** two documents tests calling it land in the same clock tick under default
  parallelism; `create_dir_all` then reuses an existing `her-flight-deck.db` and the
  `CREATE TABLE study_materials` `.unwrap()` panics "table study_materials already exists"
  (`documents.rs:2003`), red-ing `run_gate.sh` step 02.
- **Proof it is pre-existing:** `split_test_root` and
  `split_parts_and_tags_commit_together_on_one_connection` exist verbatim at base;
  `git diff 2a6a415 -- src-tauri/src/documents.rs` has only 2 hunks (line 17 `DOCUMENTS_DIR`
  visibility, line 382 `stored_destination_in`), both outside the test module.
- **Reproduced:** `receipts/flake-parallel-split.txt` (trips at attempt 2/12);
  `receipts/diag-documents-flake.txt` (`documents::tests` 11/12 clean at default parallelism).
  **Controls that pass now:** `receipts/diag-control-lineage.txt` — the 21 delivered
  `lineage` tests 6/6 clean and `pdf::tests` 6/6 clean (the feature tests are deterministic;
  `lineage_tests::TempDir` carries a per-test label, so it does not collide).
  **Passes once corrected:** `receipts/diag-flake-corrected.txt` — a bounded fix (add a
  per-process atomic sequence to the dir name, applied on the scratch copy only, then
  restored to the delivered hash `8423f3bc…`) runs `split` clean 15/15 at default parallelism.
- **Impact:** a release run of `cargo test --all-targets` can intermittently fail on
  unrelated generic-path test code; the pack's "41 passed / exit 0" holds only under a
  favourable schedule. No effect on shipping behaviour.
- **Bounded fix:** make `split_test_root()` names unique (atomic counter, or reuse
  `lineage_tests::TempDir::new(label)`'s labelling); alternatively run the native gate
  `--test-threads=1`. Non-blocking; owner's call whether to fold into this PR or a follow-up.

No other findings. The following §3 review targets were verified against source, not only tests.

### Receipt authority (`lineage.rs`, `pdf.rs`)
- Splitter reads the source **once** (`pdf.rs:read_pdf_once` → `Vec<u8>` + `Document::load_mem`)
  and hashes those exact bytes; the split uses the same in-memory document. Fix for partial defect #4.
- `issue_receipt` binds the receipt to the owning material (`source_path != source_file_path` →
  refuse) and records `pending` with `INSERT … WHERE NOT EXISTS`; a missing root keeps
  `root_material_id = NULL`, never the parent (nested branch reads `lineage.root_material_id`).
- Webview cannot mint/edit/extend: `#[serde(deny_unknown_fields)]` on every receipt struct;
  save recomputes `receipt_hash(core)` and requires `computed == receipt.receipt_hash ==
  receipt.operation_id` **and** `recorded_hash == computed` **and** `recorded_source ==
  core.source_material_id`, so any provenance change breaks the hash before any write;
  the TS `isSplitSourceReceipt` guard (shape keys + `operationId === receiptHash`) is the
  second layer. S1 & S5 prove both layers bite.

### Save transaction (`save_split_batch_at`)
- Order: hash recompute → recorded row (committed replays, cancelled refused) → presentation
  check → **outside-txn** source re-hash + part-file size checks → `BEGIN IMMEDIATE` →
  re-check still-`pending`, source row + `file_path`, nested 9-field snapshot, output-id
  collisions → inserts (inherit type/topic/priority/goal/event/tags; title/notes from the
  interface) → conditional `status='committed' WHERE status='pending'` (`marked != 1` rolls
  back). Failure leaves no rows and the record `pending` (mid-save trigger test proves the
  rollback; decision 2 keeps files for the interface to reconcile/cancel).

### Cancel & read-back
- `cancel_split_batch_at` returns `committed` untouched, marks only `pending`→`cancelled`,
  removes only the plan's own files and only when `owned_elsewhere = 0`; a lost race re-reads.
  `splitSave.saveSplitParts` reads back by operation id before cancelling; `mutate` returns
  the result on a committed-but-lost-ack write (kept) and `null` only on genuine failure
  (cancel) — cancel on a committed op is a no-op. UI tests cover all three branches.

### Read model & UI (`logic/splitLineage.ts`, `SplitLineageDetails.tsx`)
- Tiers are structural (`nestedLevel === 1 && parentPageStart === null`), never hash-driven;
  each tier judged against its own file; unknown never vouched (S4) or grouped
  (`relatedParts` needs a known source id + hash); same-edition siblings only. Coordinates:
  `composeNestedRange` A20–40 / R101–300 ⇒ R120–140 (shared `compose.json`, native+TS parity).
  Fingerprinting runs after render in `useEffect`, bounded (`MAX_HASH_REQUEST = 20`, ≤2 files
  per part), `safe_relative_path` only; warm/plain copy, honest "unknown"; `aria-labelledby`
  region, labelled links, `role="status"` copy feedback.

### Restore safety
- `verify_schema_13_lineage_semantics` and `validateSplitLineageState` are true twins
  (both compare column/FK/CHECK/index shapes to a reference built from `crate::migrations()`,
  fingerprints well-formed, and each log row's hash == operation id == sha256(receipt)).
  Older binaries refuse schema 13 (`backup.rs:631` `newest_migration > CURRENT_SCHEMA_VERSION`,
  retested generically at `CURRENT_SCHEMA_VERSION + 1`). Populated schema-12 upgrade keeps
  practice + card history byte-for-byte (storage test). Row-level FK integrity for the two new
  tables is covered by schema-11's unqualified `PRAGMA foreign_key_check` (`backup.rs:783`),
  which runs for every DB at schema ≥ 11 — so the 15-case contract does not miss that corruption.

### Regressions
- Generic `save_split_materials` / `createMany` / `executeMaterialsBatch` unchanged (verified:
  function region byte-identical to base; `materialTransaction.ts` not in the delivery).
- Three ceiling tests changed **only** what schema 13 requires (hard-coded "13 is future" →
  `latest` / `CURRENT+1`; v9-baseline exclude set `{10,11,12}` → `{10,11,12,13}`).
- No dangling `PdfPart` references after removal; typecheck + build pass.

## 4. Disclosed decisions — judged against the accepted scope

- **Decision 1 (browser/test drivers read but do not write lineage): ACCEPTABLE.**
  Splitting needs file I/O + `lopdf`, which browser mode cannot do (`canSplitPdfs = isTauri()`);
  there is no reachable browser split-save path to secure, so `executeMaterialsBatch` is
  correctly left intact (repurposing it is exactly what broke every `createMany` in the
  partial). The native command is the sole writer; TS drivers are exercised for **read,
  refusal (`SplitNeedsDesktopError`) and restore validation across three engines**. This is
  the assignment §3.3's "browser path **where applicable**" — not applicable here. Scope §7
  wording "across native and browser drivers" is satisfied for every operation browser mode can
  perform. Recorded in the acceptance so it is not mistaken for an oversight.
- **Decision 2 (refused/failed saves stay `pending` until the interface cancels): ACCEPTABLE.**
  Preserves the SL-R11/R13 guarantees (cleanup at most once, only this operation's files, never
  a committed/saved split). Reconcile-before-cancel makes the lost-acknowledgment race safe;
  the only residual is the disclosed "no startup sweep" for a crash between split and save, which
  the library's unlinked-file report already surfaces. Owner-acceptable for a desktop release.
- **Replaced partial work:** confirmed the listed defects directly in `implementer-partial/`
  against the delivered fixes — `chrono::Utc::now()` (tracked.diff:378) with `chrono` absent from
  `Cargo.toml` (would not compile), `createMany`/`save_split_materials_at` repurposed to require a
  receipt (tracked.diff:33/62/64 — would refuse every desktop multi-part save), the new save
  hard-coding `'study_guide'`/`'later'`/`NULL` goal+event (tracked.diff:398 — losing inheritance),
  reading the source a second time for the hash (`std::fs::read(&source_clone)` / `(&source)`)
  separate from the split (tracked.diff:654/752), and `import { createHash } from "node:crypto"`
  in the browser bundle (`splitLineage.ts.txt:1`). The delivered `pdf.rs::read_pdf_once` (single
  read + hash), `lineage.rs` source-inheriting INSERT, `None`-root handling, owning-material
  binding, in-transaction pending re-check and browser-safe logic each close the remaining listed
  defects. Nothing sound was dropped — the migration, its registration, checksum, schema 13 and the
  receipt concept were kept.

## 5. Out of scope honoured
No production code edited; no install/sign/package/version bump; no provider/account tests;
no new features or dependencies. Worktree untouched (`staged_count = 0`, HEAD = base,
`documents.rs` restored after the scratch-only fix proof).

## 6. Pack contents
- `README.md` — this index (integrity, reproduction, source findings, decision judgement, out-of-scope).
- `DIAGNOSTIC.md` — reviewer diagnostic for Finding 1 (F-1), with the stable test-name module paths.
- `flake_probe.sh` — the diagnostic runner (self-contained; stable `cargo test` name filters; makes
  and restores a scratch `documents.rs` backup, so it is safe against a clean copy).
- `hash-verification.txt` — reproducible integrity run.
- `receipts/00-env.txt` … `receipts/11-cargo-test-all-single.txt` — raw output + captured exits
  (focused Vitest 110; focused native 41 single-threaded; typecheck; validator contract
  node:sqlite+sql.js 17; validator native; full `npm test` 2,862/5 skipped; full
  `cargo test --all-targets` single-threaded 444/6 ignored).
- `receipts/sensitivity/` — S1–S5 raw logs + `sensitivity-results.json` + `00-run.txt`.
- `receipts/flake-parallel-split.txt`, `receipts/diag-control-lineage.txt`,
  `receipts/diag-documents-flake.txt`, `receipts/diag-flake-corrected.txt` — Finding 1 per-claim
  evidence; `receipts/flake-probe-run.txt` — one integrated `flake_probe.sh` run (12 trials).
- `SHA256SUMS` — this directory, excluding itself.

Companion documents (repo-relative, written alongside this pack in
`/Users/rickymac/code/split-lineage-source-review/`):
`docs/M2_SPLIT_LINEAGE_SOURCE_REVIEW_2026-10-08.md`,
`docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md`,
`STATUS.md`, `docs/PROJECT_HANDOFF.md` (both derived from the reviewed worktree's text, which
already adds exactly one new entry to each origin/main file; no prior entry removed).
