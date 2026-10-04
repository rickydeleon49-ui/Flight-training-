# Windows A2 prompt — recognize complete SQLite tokens (R10)

You remain the Windows implementer; Codex remains independent reviewer and Git coordinator. The latest R8 header-token correction and all 557 submitted focused checks pass independently. One lexical scanner defect remains. Implement a bounded whole-token correction and meaningful tests, then return uncommitted.

## Identity and preflight

- Remote: `https://github.com/rickydeleon49-ui/Flight-training-`.
- Owner checkout: `H:\Ai Repo clones\Flight-training-`.
- Existing dirty branch/base: `fix/atomic-study-material-saves`, HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`.
- Main inspected: `9fa9b277363ef3d1f2f52fd256cb4afe4ad456c3`. Fetch and record actual current main without switching/resetting/stashing/rebasing the dirty branch.
- All 24 submitted hashes match. Native source and R9 are unchanged; only four owner files changed since the fifth review.

Read applicable instructions, current main's STATUS/PROJECT_HANDOFF, sixth-review note and evidence. Record full SHAs, dirty paths, owner, tools and active processes. Preserve the Mac's newer work and confirm no other test matrix is running. Do not commit/push/open or merge PRs, change versions/tags, rebuild installers or publish a release.

## Reproduce R10 exactly

Read `docs/evidence/a2-sixth-review-2026-10-04/a2SixthReview.regression.test.ts`. Copy unchanged into an isolated matching-source snapshot or promote the cases into maintained tests. It contains 152 cases:

- 16 passing raw/public legality and firing controls on actual node:sqlite and sql.js.
- 128 failing trailing-refusal combinations: four valid identifiers × eight prohibited suffixes × execute/select × two engines.
- Eight failing ordinary-SELECT cases, independent of trigger context.

The identifiers are `case$bucket`, `écase`, `caseé` and `✈case`. Both actual engines accept their unquoted names. A valid trigger INSERT into one of these tables fires; adding a transaction-control suffix must be refused before the trigger is created. A plain SELECT from the table succeeds; adding `; BEGIN;` must be refused. Keep all assertions and positive controls intact.

Root cause: `[a-zA-Z0-9_]` splits a valid SQLite identifier into pieces. A piece becomes `CASE`, incrementing caseDepth despite no CASE expression. Inside a trigger, the real END is consumed as a CASE close; outside a trigger, the phantom depth suppresses a subsequent transaction keyword. Fix the shared lexical boundary, not only those four strings or the trigger branch.

## Bounded implementation and differential coverage

Consume the complete identifier before deciding whether a token is a structural keyword. Consult the [SQLite draft tokenizer requirements](https://www.sqlite.org/draft/tokenreq.html) as guidance, especially longest token, identifier characters and variable tokens; actual installed engine controls decide supported syntax. The draft is not a substitute for executing controls.

Preserve the role-aware header fix, single/double/backtick/bracket quoting, comments, schema qualification, true CASE nesting and outer trigger END. Review normal word scanning and CREATE/TRIGGER lookahead together so they use consistent boundaries. Compare keywords with SQLite-compatible ASCII behavior: non-ASCII characters that uppercase to ASCII must not turn an identifier into CASE/BEGIN/etc. Do not treat SQLite-accepted non-ASCII identifier characters as separators just because JavaScript considers one whitespace. Do not assume Unicode-letter-only predicates cover every name SQLite accepts.

Use a small deterministic, engine-based test table rather than unbounded fuzzing:

1. Cover the four reviewer names and related keyword prefix/suffix forms containing dollar signs, accented letters and non-letter non-ASCII characters. Include non-ASCII whitespace and case-folding controls if accepted by both engines; record unsupported forms honestly instead of inventing legality.
2. Place supported names in trigger-name/table-name/body-target/column roles and in ordinary SELECT/INSERT/UPDATE statements. Prove raw/public legality and effects before negative tests. A keyword-like name must stay one identifier, including adjacent qualification/comments where supported.
3. Pair accepted forms with the existing eight prohibited suffixes on execute/select. Refusal must precede side effects; prior rows/tags and sql.js reopened state remain intact, and a following atomic save succeeds.
4. Retain real nested CASE expressions and true transaction keywords, with positive and negative trailing statements. Do not forbid all SQL that happens to contain keyword text.
5. Check legal bound-parameter token forms containing keyword text under the drivers' existing binding contract. Only claim forms the real routes support; do not introduce a new binding API. Ensure token interiors cannot change CASE/trigger state. Add targeted regressions for any reproduced form, using engine controls.

No parser dependency, new global handle, broad refactor, permission change or migration. Do not disable refusal, skip all text after a trigger, require callers to quote valid names, hard-code the sample identifiers or change the driver's single-statement execution contract. Do not fix this by eliminating CASE tracking or weakening previously passing assertions. This is one lexical-contract defect, not a request to implement a general SQL parser.

## Per-task checks and final local gate

Run the reviewer reproduction first and preserve the failure log. Implement the correction and run narrow maintained scanner/driver tests; store exact command, source hashes, exit/count/duration. Then run the 152-case sixth-review diagnostic unchanged, all 72 fifth-review, 14 fourth-review, 12 third-review and 181 shared prepared cases with their observation helper. All 57 conditional seams must be reached; missing/conditional skips are not passes. Run focused contract/repository/form/integration/editor-safety tests and verify R9 remains unchanged.

Once focused checks pass, run one sequential final gate:

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

Do not repeat passing expensive suites without a relevant change, run duplicate matrices or use CI to debug. Keep diagnostic copies isolated; remove only exact task-owned copies and preserve test exit separately from cleanup. No unrelated PostgreSQL job is needed.

## Handoff and limits

Update the implementation note and local A2 status with R10's reproduction, root cause, bounded correction and proving tests. Retain independent acceptance pending and historical failure receipts. Use current `docs/templates/TASK_HANDOFF_TEMPLATE.md`. Return actual full SHAs, exact dirty files, all source/test/fixture hashes and source→test→result mappings.

Provide actual sanitized stdout/receipt files for the reproduced failure and passing correction and final local gate, suitable for publication under docs; an excerpt/prose table alone remains reported evidence. State exact coverage and conditional/unavailable seams. The prior handoff's four-file delta is relative to the fifth review, not the fourth; record comparisons precisely.

Preserve native atomic-save/reference-safe cleanup, connection ownership and fail-closed recovery, backup v2/v1 guarantees, shipped migrations, R9 raw-field preservation, Windows behavior, bundle identifier and current Mac/Slice A work. Source stays local/uncommitted until Codex accepts and integrates with main. Prepared routes generally execute only the first statement: do not claim appended-control execution, actual data loss or installed/native exposure from these refusals. No actual Mac/APFS/WKWebView, signing or release gate is cleared by Windows tests.
