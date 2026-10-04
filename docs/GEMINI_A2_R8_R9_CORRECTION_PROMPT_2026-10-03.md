# Windows implementer prompt — finish A2 R8/R9 precisely

You are the Windows A2 implementer for Her Flight Deck. Codex is the independent reviewer and Git coordinator. Make the bounded corrections below, test every substantive task, and leave everything uncommitted for review.

## Repository and ownership

- Exact remote: `https://github.com/rickydeleon49-ui/Flight-training-`.
- Existing implementation checkout: `H:\Ai Repo clones\Flight-training-`.
- Existing branch: `fix/atomic-study-material-saves`.
- Submitted base/HEAD: `533a8f50c2d0de74a75f5542022da3182f376ee9` with local A2 changes. All 24 submitted hashes matched the third review; all 307 snapshotted files stayed unchanged.
- Shared main inspected by the reviewer: `30a67faab3db89d15f2a92b1e5a5ff534fa9e09c`; fetch and inspect current main before work.

Do not switch/reset/stash/rebase this dirty branch, overwrite newer Mac changes, touch another owner's branch or start a second matrix. Record current identity and relevant background processes first. If source changed since review, identify the differences before relying on its receipts. Keep the work under the existing Windows owner. No commit, push, PR, merge, tag, version change, installer rebuild or release publication in this implementation task.

## Read the shared contract

Fetch without changing the working tree. Read current main's `docs/PROJECT_HANDOFF.md`, `STATUS.md`, `docs/MAC_PARITY_CHECKLIST.md`, applicable repository instructions, and:

- `docs/A2_THIRD_REVIEW_2026-10-03.md` and `docs/evidence/a2-third-review-2026-10-03/README.md`.
- `docs/A2_SECOND_REVIEW_DETAILS_2026-10-02.md` and the original five diagnostics.
- `docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md` and its acceptance note.
- Local `docs/ATOMIC_STUDY_MATERIAL_SAVES_2026-10-02.md`.

The review diagnostic file is shared under docs, outside automatic test discovery. Copy it only into an isolated task snapshot or promote the relevant cases deliberately into maintained tests. The complete 181-case package and helper already live in `docs/evidence/mac-a2-preparation-2026-10-03/`. Matching A2 APIs exist locally but not on main; do not mistake a main-only missing-API error for a regression. Do not change its assertions to fit the implementation.

## Task 1 — R8: preserve valid triggers with CASE expressions

Root cause: `hasTransactionControl` clears `inTrigger` at any unquoted `END`, including the end of a CASE expression. The final trigger terminator is then refused as a public transaction statement.

Reproduce both cases on real node:sqlite and sql.js:

1. `CREATE TRIGGER ... BEGIN INSERT ... VALUES (CASE ... END); END;`.
2. `CREATE TRIGGER ... WHEN CASE ... END = 1 BEGIN INSERT ...; END;`.

The reviewer has four passing raw-engine legality/firing controls and four failing public-driver cases. Promote meaningful tests into `singleConnectionDrivers.test.ts` or a suitable focused maintained file. Test actual trigger creation and firing, not only the guard's boolean result.

Implement the smallest bounded scanner correction that distinguishes trigger/header/body grammar from nested CASE expressions. Cover nested CASE, comments, quoted values/identifiers, TEMP/TEMPORARY/IF NOT EXISTS as applicable, and more than one statement within a trigger. Test multiple triggers or a trailing query if permitted. Add negative controls: a genuine BEGIN/SAVEPOINT/COMMIT/ROLLBACK/RELEASE after the completed trigger must remain refused on both public routes. Do not simply skip the remainder after CREATE TRIGGER, delete transaction protection or introduce a general parser package.

Preserve FIFO ownership and all existing R6 opening/ending/mid-save behavior. Run the focused guard/driver tests immediately after this task. Record the exact command, counts, failures, duration and source identity.

## Task 2 — R9: preserve every omitted raw column on partial updates

Root cause: `handleUpdate` calls `mapRow` before building its full-row UPDATE. `toEnum` changes unknown stored enum strings to display defaults, and `toNullableText` changes empty text to null. An operation containing only title/tags writes those normalized values back to unmentioned columns.

Reproduce the shared AR-02 failures on both engines and the review's extra cases:

- Stored `topic='synthetic-topic'` must remain exactly that after title/tag-only update. Also cover other unfamiliar stored material type/status/priority values allowed by the unchanged schema.
- A material created through the existing API with `originalFileName:''` and `lastReviewedAt:''` must retain those raw empty strings when the update omits them. This is an accepted-input case, not only a synthetic unknown enum case.

Compare all raw material columns, raw tag rows and raw links before/after, excluding only explicitly changed columns and permitted `updated_at`. Assert unrelated materials/links survive, no dangling or stray tag appears, and sql.js reopened state equals live state. Also test recognized values, omitted tags, explicit `[]`, and explicit nullable-field clearing/replacement.

Use a narrow supplied-column update or raw-value merge to preserve omitted values; normalize only at the presentation/return boundary. Keep the typed public API sound. Preserve title validation, missing-row refusal, created_at, transactions, omitted-vs-null semantics, rollback and retry. Do not turn AR-02's fixture into a known enum, weaken byte-preservation assertions, add a migration or silently standardize legacy data. The native path already reads raw stored strings; review parity and add native regression coverage if needed, without rewriting its passing attachment checks.

Run the focused material-contract/repository/driver tests immediately after this task. Re-execute the four reviewer cases and the complete 181-case package with assertions unchanged. A conditional case only counts as passed if its fault/barrier fired. Record actual counts; do not relabel Windows execution as Mac execution.

## Task 3 — fix the handoff evidence without undoing accepted work

Retain the successful R1–R7 behavior, including reference-safe document cleanup, replacement-file validation, browser export/encoding/FK/storage recovery, fail-closed connection handling, per-operation ownership and post-commit refresh attachment retention.

Correct the literal `-t "reviewer regression"` receipt: it runs zero tests and skips 33 in the submitted file. Use actual maintained test names or the unchanged five diagnostic cases; do not report a green exit with zero tests as a pass.

Correct the Mac ID mapping from the accepted matrix:

- PREP-R1: coherent single-statement observations and ownership barrier.
- PREP-R2: all columns/raw links/integrity plus precise foreign-key enforcement versus fail-closed refusal.
- PREP-R3: complete expected/prior update outcomes.
- QT-08/09/10: execute/select/multi-statement opening controls; QT-11a/b: ending calls outside/inside ownership; QT-12: legitimate SQL.
- BD-01/02: create/update export failure; BD-11: recovery failure.

Do not substitute native attachment R1–R3 for PREP-R1–R3. Distinguish tests run, conditional seams reached, skipped, unavailable and planned. Do not describe OPFS/IndexedDB as this driver's backing storage; it uses localStorage. Do not conflate SQLite writer locks with OS file-lock behavior.

Update the local implementation note and A2 status to include R8/R9 reproduction, fix and maintained proof, with independent acceptance still pending. Inspect newer main first: A3/A4/A6 have advanced and must not be overwritten by the old "A3–A6 open" paragraph. Prepare a precise integration conflict note. Codex will reconcile the accepted source with current main. Important sanitized evidence, hashes and prompts must be GitHub-publishable; no reliance on private scratch files.

## Final verification — one sequential matrix after focused tests pass

Confirm previous background test processes exited. Run this matrix once after all implementation and test corrections are finished:

```text
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
node scripts/check-release-version.mjs 0.5.3
git diff --check
```

Also run the reviewed 181-case diagnostic package on the corrected source and the eight failing third-review behavior cases. Four raw-engine trigger legality controls must continue to pass. Keep temporary diagnostic copies isolated, or remove only your exact copied files after they are promoted; no recursive wildcard cleanup. Record all failed attempts and seam limitations. Do not run unrelated PostgreSQL tests or introduce duplicate services. No speculative CI runs.

If integration with newer main later changes relevant source, its resulting matrix belongs to Codex's integration gate; this stale-base result alone cannot certify the eventual PR head.

## Completion report

Use current main's `docs/templates/TASK_HANDOFF_TEMPLATE.md`. Include repository/branch/full base SHA, owner and role, exact dirty file list, source/test/fixture hashes, R8/R9 issue-to-fix-to-test map, correct Mac IDs, actual per-task/full-gate commands/counts/durations, shared sanitized receipts, relevant conflicts and unavailable installed-platform checks. Preserve Windows behavior, existing migrations, backup v2 integrity and v1 restore, and bundle identifier `com.herflightdeck.app`.

Leave all source uncommitted for Codex's independent review. Do not claim perfect readiness or Mac acceptance. Windows distribution remains held on v0.5.1, v0.5.2 retired and frozen v0.5.3 held; release, signing, installer and Slice B gates remain unchanged.
