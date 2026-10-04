# Windows A2 follow-up — integrate with latest main without losing the Mac baseline

You are the owner-selected Windows implementer (the supplied R13 handoff identifies Claude; Gemini may take over only when the owner assigns it). Keep one active implementer. Codex independently reviews and coordinates commit/push/PR/exact-head-CI/merge. R13 is fixed: Codex independently reran **2,085 focused cases**, all passing. Do not reopen the scanner or redesign native A2. Correct the current-main fixture incompatibility below and validate the actual combined tree, then stop uncommitted.

## 1. Preflight and preserve both development tracks

Repository: https://github.com/rickydeleon49-ui/Flight-training-. Existing dirty Windows owner: H:\Ai Repo clones\Flight-training-, branch `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`. Reviewed current main: `37ec9a1f99af61dc0ce89b672bb0a4b63d69ac51`; fetch and record the latest full SHA, read current shared STATUS/PROJECT_HANDOFF, CLAUDE.md, tenth review/evidence and task handoff template. Do not switch/reset/stash/rebase the dirty owner checkout or overwrite current main with old whole files.

Record tools, dirty paths, task owner, no running validation process and the original 24-file hash match to the [submitted R13 manifest](evidence/a2-r13-line-comment-2026-10-04/submitted-source-hashes.json). Native/R9 did not change in R13. Keep the existing owner's complete uncommitted work/evidence intact. Work in a separate local checkout/worktree rooted at fetched main. Do not use GitHub CI to debug the merge.

Windows-only optional starting evidence: Codex preserved a non-Git source snapshot at `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs\a2-tenth-review-2026-10-04\latest-main-integration`, with hashes and intended patches alongside it. It reflects main 37ec9a1 plus reviewed A2 and two mechanical conflict resolutions; it still has the five known failing scenario tests. This local path is not available to the Mac and is not the canonical source. Reconstruct against current main rather than claiming the preserved snapshot is already accepted.

## 2. Task A — produce the precise current-main integration candidate

Apply only intended A2 source/test/fixture changes from the owner to the new candidate, using a reviewed three-way patch for tracked source and exact copies for the eight A2 files absent from main. Do not copy stale STATUS, Mac tracker, audit documents or whole older benchmark/native files over newer main. Copy the reviewed implementation report and sanitized task evidence separately with historical/pending status intact.

Expected conflicts on reviewed main:

- `src-tauri/src/lib.rs`: preserve both the existing `study_packet::pick_study_packet` and new `documents::save_material_operation` registrations. Preserve module declarations, migrations, schema version, capability and command boundaries.
- `src/perf/appResponsiveness.bench.test.ts`: retain main's deterministic richer fixture, answer keys, real-page harness, current scales/counts, instrumentation and measurement caveats. Apply the intended removal of public transaction wrapping for action/journal/question seed setup. Do not replace main's file with the older owner benchmark, remove fixture assertions or weaken the driver guard.

Check the complete diff for unintended drops, dependencies, lockfiles, migrations, bundle/version or security changes. Read every collision; do not blindly prefer ours/theirs. Run the narrow imported A2 suites once the candidate loads. Keep task-level output. No new dependency/migration/permission/API surface is authorized.

## 3. Task B — reproduce and correct R14 fixture compatibility

On the combined candidate before fixing the helper, run `npx --no-install vitest run src/perf/studyLibraryScenarios.test.ts --reporter=verbose`. Ninth-main candidate result: **eight tests, three pass/five fail**, all five caused by `seedFixtureMaterials` calling public BEGIN in `src/perf/studyLibraryFixture.ts:120`. Preserve raw failure output and exact source identities.

The fixture's comment already anticipated A2: move it to the driver's supported atomic fixture path. Use the existing `saveMaterialsAtomically` operation with a complete deterministic material mapping if appropriate; the Node implementation owns its transaction and uses the same schema. Do not add a raw handle, test hook, public transaction escape, special SQL string bypass or new production command. Do not loosen `refuseTransactionControl`. Keep all prior atomicity/durability/queue tests unchanged.

Preserve fixture IDs, titles, enums, notes, file metadata, created/updated times and tag names/links required by the answer key. If internal synthetic tag IDs change under the supported batch API, establish whether any observation depends on them before making that routine choice; record it honestly. Benchmark file-status paths are synthetic mocked data, not real uploads. Preserve timing boundaries: seeding is preparation, not the measured UI work. Keep data generation and fixture hashes stable where the exported logical fixture is unchanged.

Inspect all `seedFixtureMaterials` callers and benchmark public BEGIN/COMMIT/ROLLBACK wrappers; update only incompatible setup. Avoid scalar per-record writes if the existing owned batch path preserves linear preparation, but do not claim a performance speedup without measurements.

Add meaningful tests of the new seed path on real Node SQLite: exact stored material fields/dates/tags match a small deterministic fixture, the normal Study Library scenarios still match their answer keys, and a deliberately failing batch leaves no partial rows/links or stuck transaction. Confirm a later valid seed/save works after failure. Keep public BEGIN/COMMIT refusal tests. Do not write an assertion that merely confirms the implementation called a particular method.

Run this task's focused tests immediately. All eight existing `studyLibraryScenarios` cases must pass without weakening their sensitivity controls. Check the opt-in benchmark entry point's compatible preparation on a bounded synthetic size where supported; do not launch the whole multi-size timing matrix merely to debug a fixture. Label anything not exercised accurately.

## 4. Focused cumulative check, then one full gate on the combined main tree

Retain all 780 R13 maintained cases and unchanged diagnostics ninth 78/eighth 72/seventh 68/sixth 152/fifth 72/fourth 14/third 12, shared 181 plus observation helper. Owner-source independent baseline: 14 files/2,085 pass, all 57 conditional seams reached. Run these against the combined candidate along with the repaired main fixture/scenario tests. Shared missing APIs or conditional skips are not passes. Keep diagnostics isolated or remove only task-owned copies before default discovery; preserve exits before cleanup.

Only after focused failures are resolved, install exactly the combined candidate's committed dependencies and run one sequential full local matrix on that **same current-main integration tree**, not the older owner branch:

```text
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
node scripts/check-release-version.mjs 0.5.3
node --test .claude/tests/setup-helpers.test.mjs
git diff --check
```

Use focused tests during development; one matrix after corrections. No concurrent matrices, speculative push, installer build or full unrelated benchmark run. Node version and dependency lock must support current main, including exact Zod 4.6.5 adoption; do not change approved dependencies. Preserve .claude helpers and their tests. Do not rerun passing expensive steps unless relevant source changes.

## 5. Return a complete uncommitted integration handoff

Provide actual sanitized failure/pass/cumulative/full-gate logs with command/cwd, runtime, exit, counts, duration and exact tree hashes, as the R13 handoff now does. Distinguish old-owner evidence from latest-main evidence; do not cite old 1,998 frontend/283 Rust results as the integrated tree's matrix. Include all changed source/test/fixture hashes/sizes, exact dirty paths, base/HEAD/current-main SHAs, conflict resolutions and differences from the reviewed owner. Record logical fixture preservation, rollback/negative-control results and any unchanged development-only TEMP limitation. Scan ignored logs explicitly and share only the reviewed task evidence folder; do not change general privacy ignore rules.

Update the candidate implementation note/status and Mac handoff with owner/source acceptance still pending. Keep prior failed evidence. Do not claim the dirty candidate is clean. Keep the old owner untouched; state the new candidate path/branch clearly so Codex reviews the right tree. Leave source/evidence uncommitted/unpushed and stop.

Preserve R1–R13 native/browser guarantees, reference-safe cleanup, backup v2/v1, shipped migrations, Windows behavior, bundle ID, versions, Mac/Slice A and Claude setup. No installed Windows/Mac/APFS/WKWebView/live Gemini, signing, Slice B or release gate is cleared. After acceptance Codex alone commits/pushes and uses one exact-head CI gate before merging. Following accepted source publication, the next Mac assignment verifies that exact source; do not preempt M2/D1–D9 owner decisions or publish a release.
