# GEN-02a native-core implementation — 20 October 2026
Implemented on `codex/offline-gen`, base `1097a4b`; uncommitted, pending Claude review.
No UI, queue, persisted upload descriptor, dependency or migration changes. Loopback/synthetic fixtures only.

`gemini-jobs.json` retains schema 1. New draft: `kind: guide-sections-v1`, `version: 1`.
Identity freezes material/path, original/selected SHA256, ordered pages, planner/manifest, model/prompt/schema and base revision.
Results map IDs to pending/in-flight/complete plus validated body, original source pages, actual model and content digest.
Activations retain per-section reservation counts and submissions; timing uses GEN-FIX-2 stage-v1.
Admission keeps every prior job; 8 jobs / 16 MiB journal / 2 MiB draft or result remain hard refusal limits.
Journal writes use temp → file sync_all → rename → Unix directory sync_all before completion is returned.
Corruption, including a failed quarantine rename, blocks dispatch; unknown drafts remain recoverable.

Planner uses lopdf bookmark starts as heading ranges, otherwise consecutive 5-page ranges; split headings at 10 pages.
Maximum 40 sections (typed TOO_MANY_SECTIONS); each answer ≤16,000 Unicode characters; invalid pages/content refused.
`resume_study_guide(request, jobId?)` rehashes and compares immutable identity before network and before assembly.
Only explicit activation resumes uncertain in-flight sections; complete IDs never dispatch again.
Each unfinished activation gets fresh ≤900 s stage-v1 time, ≤3 attempts/section and ≤M+2 durable submissions (≤2 extras).
Reservations precede send; validated content and Complete share one durable checkpoint; checkpoint failure stops the worker.
One journal activation owner prevents duplicate workers, including cancellation races. No launch/reopen replay.
One selected-PDF preparation per activation; a recreated app cache may upload once again (02b remains deferred).
`restart_study_guide(jobId, consent, request)` requires true consent, links the new job and keeps the old partial draft.
Assembly is local manifest-order concatenation. No final provider request. Legacy generation paths stay separate.
Native `save_study_set_atomically` accepts optional `guideJobId`; section callers must supply it.
That guarded save rehashes identity (typed SOURCE_CHANGED), checks base revision, then uses the existing full-row save/review contract.
Exact save retry is idempotent; acknowledgement stays separate. Existing calls without guideJobId retain their wire behavior.
P3: all four processing-boundary uses now share PROCESSING_SECONDS=120, with unchanged behavior.

Crash coverage: before reservation, after durable reservation, after durable section commit, after ready/assembly,
after actual SQLite final-save commit, and after acknowledgement; reopen does no network until explicit retry.
Fault tests inject panic/drop or I/O failure and reconstruct journal/cache; these are not physical power-cut/installed-app tests.
Four-section fixture asserts exact bodies/IDs; reopen sends only section 4, with only the new upload URI changing.
Also covered: overnight expiry, zero-network complete/save retry, source/pages/selection mismatch, consent, failed checkpoints,
cancel before dispatch/after commit, two real workers, corrupt quarantine, stale edits, ledger/size bounds and legacy retention.

## Receipts (all raw output and real EXITs under `docs/evidence/offline-gen-02a-2026-10-20/`)
Failing-first API/save fixtures fail compilation before implementation; quarantine/legacy regressions fail assertions before fixes.
Counts below sum test suites in each receipt; compiler-only/startup/check receipts have no test count.
Receipt .log files are ignored by existing Git rules and retained locally for review; report and source files are uncommitted.
- `batches-focused.log`: EXIT 0; 18 passed / 0 failed / 0 ignored; `build.log`: EXIT 0.
- `cargo-lock.log`: EXIT 0; `cargo-test-final-tree.log`: EXIT 101; 915 passed / 1 failed / 11 ignored.
- `cargo-test-final.log`: EXIT 101; 913 passed / 2 failed / 11 ignored; `cargo-test-serial-final-tree.log`: EXIT 0; 916 passed / 0 failed / 11 ignored.
- `cargo-test.log`: EXIT 0; 913 passed / 0 failed / 11 ignored; `clippy-final-tree.log`: EXIT 0.
- `clippy-final.log`: EXIT 0; `clippy.log`: EXIT 101.
- `diff-check.log`: EXIT 0; `fmt-final-tree.log`: EXIT 0.
- `fmt-final.log`: EXIT 0; `fmt.log`: EXIT 0.
- `focused-1.log`: EXIT 101; `focused-2.log`: EXIT 0; 11 passed / 0 failed / 0 ignored.
- `focused-before.log`: EXIT 101; `focused-compatibility.log`: EXIT 0; 20 passed / 0 failed / 0 ignored.
- `focused-final-tree.log`: EXIT 0; 20 passed / 0 failed / 0 ignored; `focused-final.log`: EXIT 0; 17 passed / 0 failed / 0 ignored.
- `focused-verified.log`: EXIT 0; 19 passed / 0 failed / 0 ignored; `legacy-before.log`: EXIT 101; 0 passed / 1 failed / 0 ignored.
- `npm-test-runner.log`: EXIT 0; 194 files passed / 4 skipped; 4089 tests passed / 6 skipped; `npm-test.log`: EXIT 1.
- `quarantine-before.log`: EXIT 101; 0 passed / 1 failed / 0 ignored; `sandbox-process-observation.log`: EXIT 1.
- `save-before.log`: EXIT 101; `typecheck.log`: EXIT 0.
Default-parallel reruns failed existing card-batch gate-wait assertions (two, then one); all 18 isolated batch tests passed. Final serial gate is recorded above.

## SHA256 (changed source files; report excluded from its own hash)
- `src-tauri/src/gemini.rs`: `605d455328cbf8f7d5fdd299887ffe29cb375dae9f436a65cf5303f26f51db02`
- `src-tauri/src/gemini_budget.rs`: `16ef943af3e496e1d696864fea6a60a30648a879a391384d78a81b7d2d786b3f`
- `src-tauri/src/gemini_jobs.rs`: `302883c6f649dd4a38c5c1d069c5fe81d67a9f95159d0cc49cdb771ac9920430`
- `src-tauri/src/gemini_sections.rs`: `ea94ae8a9ef02377185fbcd7b4aa3e81c6468318449e368a8a6075e47994c081`
- `src-tauri/src/gemini_sections_tests.rs`: `a0d85850ba14940460e807e633fa9e476631f9a04286ca2663fb5754e4ddcbdd`
- `src-tauri/src/lib.rs`: `495d91693c1862b0a776e99a29a4a94daf468bb84feec085f50ae4a085163b93`
- `src-tauri/src/pdf.rs`: `99e8dcd260eac2fb743d955644fbbff9eeb96f47b8ca407fc7d22ed7377263cc`
- `src-tauri/src/study_sets.rs`: `2fcaa1d1a2d118b4cd6cf1a14ad0c4a65ec346c31de0eef3e0d49dfaa393e26e`

## Correction r1
Author revalidation: test-only shared 30 s / 5 ms readiness helper; all GEN-02a work retained; `gemini_jobs.rs` unchanged.
Sites: batch waits (4), file-cache helper (21 callers), recovery gate (1), extraction search (6), saved-search (2), service (2), search-API helper (3 callers); [every site and preserved timing assertions](evidence/offline-gen-02a-2026-10-20/correction-r1/wait-sites.md).
Default-parallel consecutive full suites: run 1: EXIT 0, 916 passed / 0 failed / 11 ignored; run 2: EXIT 0, 916 passed / 0 failed / 11 ignored; run 3: EXIT 0, 916 passed / 0 failed / 11 ignored.
Receipts in `docs/evidence/offline-gen-02a-2026-10-20/correction-r1/`: fmt EXIT 0; clippy `-D warnings` EXIT 0; whitespace gate in `diff-check.log`; sandbox process observation EXIT 127 (recorded; no escalation).
SHA256 of correction source files (report excluded from its own hash):
- `src-tauri/src/test_wait.rs`: `7cd561fa3e9496351e3cccc2bc360a8a757b5dc3bdd26851d6c60042fd53fb30`
- `src-tauri/src/lib.rs`: `fe3ba8b00108e9a8ebfc862a892cd26ed85aacafcc8295699b95b1001ecde522`
- `src-tauri/src/gemini_batches.rs`: `13885f5109fc850f35d2ac35561176a2aea7a977abba72af58a4393724d686c6`
- `src-tauri/src/gemini_files_tests.rs`: `636788141aa3fb5681135eee93cb6ce74d6329ccf8121f7fd52ab0e56f5bfdef`
- `src-tauri/src/gemini_recovery_tests.rs`: `1a6ff72ce4614f6d32bec3be8bfd4d05ccd51ca890209393177161aaa6361d1c`
- `src-tauri/src/extraction/search.rs`: `c46dafff089511944caad4c90922049a4c1a7021fd44c16623d90a341ca258ef`
- `src-tauri/src/extraction/search/saved/tests.rs`: `e704cd458e48b41439af2e4ac921d8858aa0ed19ccd7d87fdd0b50b4bc4703fe`
- `src-tauri/src/extraction/service.rs`: `7b1c2549e31924bd347b69e3ab8bdc84992a21fc3d60932d16373af2edc24053`
- `src-tauri/src/extraction/search_api/tests.rs`: `9ec2a28905c7e59fa395d54a669cb46eea599f702be612832ff17123fbca3df0`

## Correction r2
Test-only: `pdf_changed_between_sections_stops_before_next_request` rewrites the same 20-page PDF after section 2's durable commit; asserts typed SOURCE_CHANGED, exactly 2 generation requests / 1 upload, and retained complete content after journal reopen.
`correction-r2/pdf-changed-mutant.log`: EXIT 101 (expected); 0 passed / 1 failed; disabling the per-section recheck sent 4 generation requests instead of 2. Production source restored byte-for-byte.
`correction-r2/sections.log`: EXIT 0; 21 passed / 0 failed / 0 ignored.
`correction-r2/cargo-test.log`: EXIT 0; 917 passed / 0 failed / 11 ignored; `cargo test --locked --no-fail-fast`, default parallel mode, one run.
`correction-r2/fmt.log`, `clippy.log` (`-D warnings`), `diff-check.log`: EXIT 0 each. Receipts under `docs/evidence/offline-gen-02a-2026-10-20/correction-r2/`.
SHA256 `src-tauri/src/gemini_sections_tests.rs`: `90390aa036222e7b125c4ff735cb33659c5e821f5282acc2ce58c1497c127daa`. All changes uncommitted; GEN-02a and correction r1 retained.

## Correction r3
Test-only race; production unchanged. No local natural reproduction: `repro.log` EXIT 0, 200 attempts / 200 passed / 0 failures under overlapping default-parallel suites.
Baseline `stress-before.log` and `stress-before-2.log`: EXIT 0 each; each 917 passed / 0 failed / 11 ignored.
Root cause: original `b258f51` batch test lines 864-865 unlock after journal cancel before signalling the token; budget polling can finish first with inner `Err(CANCELLED)`, so the wrapper returns `Ok(Err(CANCELLED))` (`gemini_budget.rs:726`, `gemini.rs:1795`, `gemini_cancel.rs:65,81`).
The held request is the first card batch, not the guide: synchronous progress installs the gate after the guide checkpoint and before dispatch (`gemini_batches.rs:279,855`; fake gate snapshot `fake_gemini.rs:352`); no late gate installation.
GEN-02a added durable syncs (`gemini_jobs.rs:810,820`), increasing shared-lock work; legacy admission/cancel ordering is unchanged. The test now installs the production-style read-only probe and signals under the journal lock before a probe can observe cancellation (`gemini_batches.rs:849,884`).
Original token-driven test still requires outer `Err(Cancelled)` (`gemini_batches.rs:895`); no assertion weakened. Both orderings check unchanged journal bytes, no new dispatch, no publishable result, and preserved restart/resume ledger and unique cards.
Regression: `journal_cancel_before_token_wake_preserves_draft_without_post_cancel_write` forces journal-first completion before token signalling and requires inner cancellation; `ordering-proof.log` EXIT 101 expected, 0 passed / 1 failed with the old outer-Err assertion, printing `Ok(Err(CANCELLED))`.
`batches.log`: EXIT 0; 19 passed / 0 failed / 0 ignored. `repro-after.log`: EXIT 0; 200 attempts / 200 passed / 0 failures; each attempt EXIT 0.
Default-parallel `cargo test --locked --no-fail-fast`, `cargo-test-1.log`, `cargo-test-2.log`, `cargo-test-3.log`: EXIT 0 each; each 918 passed / 0 failed / 11 ignored.
`fmt-before-format.log`: EXIT 1 (one required line wrap); `format.log`: EXIT 0; final `fmt.log`: EXIT 0; `clippy.log` (`--all-targets -- -D warnings`): EXIT 0; final `diff-check.log`: EXIT 0.
Sandbox process observation: `pgrep` EXIT 3 recorded; exploratory `ps` EXIT 127 recorded in the root-cause note; continued without escalation. No socket failures. Cargo used the supplied SDKROOT/target and offline environment; HTTP fixtures were loopback only.
Full explanation and proof replay: [root-cause.md](evidence/offline-gen-02a-2026-10-20/correction-r3/root-cause.md); receipts and drivers are in the same evidence directory.
SHA256 `src-tauri/src/gemini_batches.rs`: `52bdbe33b7be01c4e7209166ac37fea6bf4a167663de67cb82859ca6dde4f9a7`. SHA256 of the report and every correction artifact is in `correction-r3/SHA256SUMS` (manifest excludes itself).
All work remains uncommitted; pre-existing `node_modules` preserved; HEAD remains `b258f5103ce43301a2f2fcdab386e0199da43659`.
