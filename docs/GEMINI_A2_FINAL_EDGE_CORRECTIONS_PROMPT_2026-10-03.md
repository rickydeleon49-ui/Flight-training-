# Windows A2 implementer prompt — two final observed edge corrections

Continue as the existing Windows A2 implementer. Codex remains independent reviewer and Git coordinator. Fix only the two reproduced variants below, test each task and return all work uncommitted. Do not begin new features or expand into general SQL-parser work.

## Identity and preflight

- Exact repository: `https://github.com/rickydeleon49-ui/Flight-training-`.
- Owner checkout: `H:\Ai Repo clones\Flight-training-`.
- Existing dirty branch: `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`.
- Reviewed source: all 24 hashes in your last handoff matched. Codex preserved all 307 owner files.
- Actual shared main inspected: `fb506ce2fbf4dc64a930aa70e356902812fdf781`. Your reported full SHA beginning `fb506ce9...` differs; record real command output next time, not a reconstructed SHA.

Record branch/full head/dirty paths/toolchain/owner before editing. Fetch and read current main without switching, resetting, stashing, rebasing or overwriting this dirty branch. Check that prior test processes have exited. Read applicable repo instructions, current `STATUS.md` and `docs/PROJECT_HANDOFF.md`, the fourth-review note/evidence and accepted Mac A2 matrix. Preserve another machine's work. Do not commit, push, open a PR, merge, change versions/tags, rebuild installers or publish a release in this implementation task.

## What already passed independently

Codex's one focused run confirms 92 maintained frontend tests, all 12 third-review diagnostics, all 181 shared diagnostics and their 57 conditional seams. Do not undo those passing R1–R9 corrections. Six raw-engine controls prove the new trigger SQL is legal; the six public-trigger cases and two omitted-title cases fail. Exact source and assertions are shared in `docs/evidence/a2-fourth-review-2026-10-03/`.

### Task 1 — R8: distinguish END identifiers from trigger termination

Current root cause: while `inTrigger`, any `END` with `caseDepth===0` clears trigger context. Valid unquoted identifiers are mistaken for the definition's terminator. Reproduce the reviewer cases on both actual engines:

1. Trigger named `end`.
2. Trigger attached to a table named `end`.
3. A body INSERT targeting table `end`.

Copy the diagnostic into an isolated matching-source snapshot or promote its cases into maintained tests. Prove creation and firing; retain raw-engine positive controls. Do not merely assert a scanner result.

Make the smallest bounded scanner correction that handles trigger header/body boundaries and recognizes a real outer END in its proper position. Preserve nested CASE, comments and quoted identifiers/literals. Cover ordinary identifier use in the header and inside an expression/body statement, multiple body statements, TEMP/TEMPORARY/IF NOT EXISTS as applicable, and multiple completed definitions/trailing ordinary SQL where supported. Do not hard-code the three example strings or require quoting valid identifiers.

Retain negative tests for genuine BEGIN, SAVEPOINT, COMMIT/END, ROLLBACK/ROLLBACK TO and RELEASE after a completed trigger, on both execute/select routes. Retain the 181-case opening/ending/barrier tests. Do not disable transaction protection, indiscriminately skip all SQL after CREATE TRIGGER, expose a raw handle or add a parser dependency.

Run the focused scanner/driver tests after this task and record command/exit/counts/duration/hash. A legal SQL fixture must be accepted and fire; a prohibited boundary must be refused without damaging acknowledged writes or ownership.

### Task 2 — R9: preserve title exactly when omitted

Current root cause: `handleUpdate` selects `fields.title` or `existingRow.title`, then calls `.trim()` and validates either one. The latest correction regresses the omitted-title behavior: a notes-only save turns `"  Stored title  "` into `"Stored title"`.

Follow the native distinction: trim/validate only an explicitly supplied new title; otherwise preserve raw `cur_title`. This is a preservation rule for a schema-permitted preexisting row, not a request to start accepting blank newly submitted titles.

Add meaningful maintained tests on both node:sqlite and sql.js:

- Notes-only, review-status-only and tag-only updates retain a padded existing title byte-for-byte.
- An omitted title is not subjected to newly submitted-title validation; preserve native parity for schema-permitted legacy values, including whitespace-only title if testing that boundary.
- An explicitly supplied padded title is trimmed normally.
- Explicit empty/whitespace-only title still rejects and rolls back with the original row/tags intact.
- Unfamiliar stored enums, empty optional text, omission versus explicit null, omitted tags versus `[]`, created_at and unrelated rows remain preserved.

Use full raw stored-column/tag/link assertions, excluding only explicitly supplied fields and permitted updated_at. Verify sql.js live/reopened equality. Do not modify the padded-title fixture or weaken the assertion. Do not globally normalize old data or add a migration. Do not regress attachment validation, reference-safe cleanup, failure recovery or queue ownership.

Run focused material/repository/driver tests immediately after the change. Then run the shared 14-case fourth-review diagnostic, the 12-case third-review diagnostic and all 181 prepared diagnostics against matching corrected source, with assertions unchanged. All conditional cases must reach their seams; a skip/missing seam is not a pass. These runs remain Windows source evidence, not Mac validation.

## Evidence and documentation

Update the local implementation note and A2 status with each reproduced variant, root cause, bounded fix and maintained proving test. Keep independent acceptance pending. Correct the inaccurate full remote SHA and preserve earlier failed attempts rather than replacing them with favorable results. Use actual stable Mac IDs from the accepted matrix; keep Windows/Mac/native/installed evidence separate. Retain current main's newer A3–A6, Slice A/B and readiness work.

Store GitHub-publishable sanitized logs/receipts and hashes, linked from the handoff. Do not include credentials, user databases/PDFs, installers, dependencies or build output. State source is still local/uncommitted. Do not claim complete cross-driver parity from recognized-value fixtures alone.

## Final local gate — once, sequentially, after focused fixes pass

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

Run every substantive task's focused tests first. Do not start duplicate matrices, use GitHub CI to debug, run unrelated PostgreSQL tests or repeat passing expensive suites without a relevant change. Keep temporary diagnostic copies isolated; remove only exact files you copied or promote them deliberately. A failed cleanup command must not conceal the preceding test exit.

Use `docs/templates/TASK_HANDOFF_TEMPLATE.md` for completion: real full SHAs, exact dirty file list, source/test/fixture hashes, two issue→fix→test mappings, accurate command counts/exits/durations, shared sanitized receipts, conditional/unavailable seams and integration conflicts. Leave all source uncommitted. Codex reviews and, only after acceptance, integrates with current main and publishes via exact-head CI.

Preserve backup v2/v1 guarantees, shipped migrations, Windows behavior, bundle identifier and release holds. No actual Mac/APFS/WKWebView/installed/signing result or release permission is granted by this task.
