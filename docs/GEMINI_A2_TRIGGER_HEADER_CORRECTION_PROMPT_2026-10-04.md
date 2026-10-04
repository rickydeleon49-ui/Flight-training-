# Windows A2 prompt — consume trigger-header table names and restore trailing refusal

Continue the existing Windows A2 task as implementer. Codex remains independent reviewer and Git coordinator. There is one remaining observed R8 defect; R9 passed. Implement only this bounded correction and its meaningful tests, then return uncommitted.

## Preflight and ownership

- Repository: `https://github.com/rickydeleon49-ui/Flight-training-`.
- Owner checkout: `H:\Ai Repo clones\Flight-training-`.
- Existing dirty branch/base: `fix/atomic-study-material-saves`, HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`.
- Submitted source: all 24 handoff hashes matched; 307 owner files were snapshotted without source edits.
- Shared main inspected for review: `b6951310d31b1f763b7116572c9f46857f08c800`. Fetch and record the actual current full SHA.

Read current main's STATUS, PROJECT_HANDOFF, applicable instructions, fifth-review note and diagnostic evidence. Record branch/head/dirty paths/tool versions and active owner. Read newer main work without switching/resetting/stashing/rebasing the dirty owner branch. Confirm prior test processes exited. Do not change another machine's files. Do not commit, push, open/merge a PR, rebuild an installer, change a version/tag or publish a release.

## Reproduce before editing

Read `docs/evidence/a2-fifth-review-2026-10-04/a2FifthReview.regression.test.ts`. Copy that exact diagnostic into an isolated matching-source snapshot or promote its cases into maintained tests. Keep assertions intact.

On both actual node:sqlite and sql.js engines, create fresh tables `end(value TEXT)` and `observed(value TEXT)`. Both these triggers are legal and must fire:

```sql
CREATE TRIGGER ordinary AFTER INSERT ON end
BEGIN INSERT INTO observed VALUES ('kept'); END;

CREATE TRIGGER ordinary AFTER INSERT ON 'end'
BEGIN INSERT INTO observed VALUES ('kept'); END;
```

After each completed definition, append each of BEGIN, BEGIN TRANSACTION, COMMIT, END, SAVEPOINT, ROLLBACK, ROLLBACK TO and RELEASE with valid statement spelling from the diagnostic. Both public execute/select routes must refuse the full input before any trigger is created. Currently all 64 combinations resolve: two table spellings × eight suffixes × two routes × two engines. Eight raw/public positive controls pass. This is one context-state defect, not 64 separate issues.

Do not claim actual execution of appended controls or native data loss: current prepared routes generally execute the first statement only. The requirement is the existing guard's refusal contract.

## Bounded correction

In `connectionOwner.ts`, `ON` sets `expectingTableName`. The unquoted END branch is evaluated before the expected-table-name branch, so `end` is not consumed as the table token. The single-quoted-token branch also does not consume it. The following body BEGIN is swallowed as that expected name; the scanner stays in header through the true outer END and never checks appended controls.

Consume header name tokens according to grammatical role before interpreting their spelling as structural keywords. Support the engine-proven SQLite single-quoted identifier in this exact role while keeping ordinary literals opaque elsewhere. Retain schema-qualified table handling, quoted/bracket/backtick names, comments, CASE expressions and true body/terminator boundaries. Do not hard-code table/trigger names, rely on quote workarounds, skip the rest of CREATE TRIGGER inputs, expose a raw database handle or add a parser dependency.

Add maintained regression tests that combine **every accepted trigger form with the negative suffix matrix**, rather than testing positives independently and negatives only against a trigger named end on ordinary source. Retain raw-engine legality controls and public creation/firing checks. Check schema-qualified forms and comments around the relevant boundary; show genuine trailing controls refused and ordinary trailing statements accepted by the scanner under the existing driver execution contract. Do not assert that a prepared single-statement call executes all statements.

Prove refusal precedes any side effect: the synthetic trigger must not exist following rejection, acknowledged rows/tags remain intact, and a subsequent atomic save still succeeds. For sql.js, check live/reopened state where relevant. Retain existing BEGIN/SAVEPOINT opening and ending tests, ownership barriers and failure recovery.

## Tests for this task, then the final gate

1. Run the narrow new reproduction first and retain its original failing receipt.
2. After the fix, run `src/data/singleConnectionDrivers.test.ts` and the promoted new cases. Record exact command, exit, counts, duration and tested-source hashes.
3. Run the 72-case fifth-review diagnostic unchanged: eight positive controls plus 64 refusal cases must all pass.
4. Run all 14 fourth-review and 12 third-review diagnostics and all 181 shared prepared cases, with their helper prerequisite. All 57 conditional seams must be reached; missing seams/skips are not passes.
5. Run focused repository/material-contract/form/integration/editor-safety tests. R9's successful fix and all earlier corrections must stay unchanged.

Temporary diagnostics belong in an isolated snapshot or must be deliberately promoted. Remove only exact task-owned copies; record test exit before cleanup so cleanup cannot conceal failure. No duplicate matrix, unrelated PostgreSQL job or speculative CI run.

Once focused corrections pass, run one sequential required local gate:

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

Update the implementation note and local A2 status, retaining independent acceptance pending. Use `docs/templates/TASK_HANDOFF_TEMPLATE.md`. Include real full SHAs, exact dirty paths, source/test/fixture SHA-256 hashes, issue→fix→test mapping and exact receipts. Provide actual sanitized test stdout/receipt files suitable for GitHub publication, including the failed reproduction and passing correction; a prose table alone is reported evidence. Preserve earlier review packages rather than overwrite their failures.

Preserve main's newer Mac/roadmap/Slice A work, accepted Mac preparation, backup v2/v1 guarantees, shipped migrations, bundle identifier and release holds. No installed Mac/APFS/WKWebView certification follows from Windows tests. No R9 rewrite, new feature or broad refactor is assigned. Leave source uncommitted for Codex review and later current-main integration.
