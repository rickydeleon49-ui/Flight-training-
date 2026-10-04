# Windows A2 correction prompt — leading BOM and whole variable tokens

You are the Windows implementer (Gemini; Claude only if Ricky switches ownership). Codex is the independent reviewer/Git coordinator. The previous correction passes all 873 focused checks, including all historical cases. Do not restart or rewrite A2. Two bounded scanner gaps and inaccurate/missing test evidence remain.

## Preflight and ownership

Remote: https://github.com/rickydeleon49-ui/Flight-training-. Owner: H:\Ai Repo clones\Flight-training-. Dirty branch `fix/atomic-study-material-saves`, HEAD/base `533a8f50c2d0de74a75f5542022da3182f376ee9`. Main inspected at review: `4772f8b3d52697f94d7dd6f58db2a1f4d690134b`; fetch/record actual current SHA without switching/resetting/stashing/rebasing the owner. Read applicable instructions and current main's STATUS, PROJECT_HANDOFF, seventh review, evidence and task-handoff template. Confirm one owner and no background test matrix. Record branch/full SHAs/tools/dirty files. Do not edit another machine's changes, commit, push, create/merge PRs, tag, change versions/dependencies/migrations, build installers or publish.

24 submitted hashes matched; only scanner/tests/STATUS/implementation note changed since sixth review. Native, fixtures and R9 remain unchanged. Preserve every passing prior correction and assertion.

## Task 1 — reproduce both exact defects before editing

Copy `docs/evidence/a2-seventh-review-2026-10-04/a2SeventhReview.regression.test.ts` unchanged into an isolated matching-source snapshot. Run it and retain actual sanitized stdout and exit. Expected: 68 cases, 18 pass/50 fail.

- R11: both real engines treat a leading U+FEFF BOM as a prefix before actual BEGIN. Public execute/select accepts direct leading-BOM BEGIN/SAVEPOINT instead of refusing. Eight refusal tests fail. Two deterministic sequences show an acknowledged inserted row disappearing afterward in the browser/test drivers. This is actual transaction execution, unlike old appended-only examples.
- R10: `$value(case)` and `$value::ns(case)` are complete SQLite variable tokens. Eight raw/public legality controls pass. Parenthesis interior CASE corrupts scanner depth: 40 combinations of five suffixes/two names/two routes/two engines fail; eight END suffix cases pass. No appended-command execution is demonstrated for this defect.

Keep all assertions and legality controls. Publish no sensitive data and preserve owner hashes. Per-task tests are mandatory; a prose table without logs is not a sufficient receipt.

## Task 2 — bounded lexical correction with focused tests

Inspect leading-BOM behavior on both actual engines. Correct recognition at engine-supported positions before interpreting identifiers/keywords; do not globally strip BOM from arbitrary SQL or quoted strings. Preserve SQLite-accepted non-ASCII whitespace inside identifiers, ASCII keyword folding, comments and role-aware trigger headers. Do not restore broad JavaScript whitespace matching. Test ordinary/CREATE lookahead consistently where engines accept BOM. Record unsupported positions honestly; `BEGIN + BOM` is not automatically equivalent to a leading BOM.

Consume complete SQLite variable tokens, including supported namespace separators and parenthesized suffixes, as opaque units. See SQLite's [parameter documentation](https://www.sqlite.org/lang_expr.html#varparam), then verify both installed engines and existing public binding contracts. Protect CASE text, semicolons/comment/quote-looking text inside legal parameter suffixes without swallowing actual outside statements. Unsupported/malformed syntax must not be mislabeled as a legal positive control. No new public binding API, parser dependency, global handle or broad SQL refactor.

For each correction: run its narrow focused tests, retain actual failure/pass logs, and verify:

1. Direct transaction commands cannot open state through either public route (BOM-prefixed BEGIN, BEGIN TRANSACTION, SAVEPOINT, other legal controls).
2. Refusal precedes side effects; existing records/tags survive; subsequent atomic save succeeds; sql.js live/reopened state matches; the new acknowledged-write regression passes.
3. Complete variable controls succeed through the real engines and public routes. Pair with all eight prior control suffixes on both routes/engines; variable interior text does not alter CASE/trigger state. Keep true CASE/nested CASE and actual trigger END coverage.
4. Quoted/string BOM and ordinary non-ASCII identifiers retain legal behavior. Do not forbid valid names, require quoting, suppress all SQL after a trigger, execute trailing statements, or weaken ownership/recovery.

## Task 3 — correct previously overstated test coverage

A bounded deterministic table is enough; no random fuzzing or general parser project. Use original names in trigger-name, target-table and column roles; current `replace(/[^a-zA-Z0-9]/g, '_')` sanitized names do not prove those original lexical forms. Add engine/public controls for `caſe` if supported, plus genuine named-parameter positive results (including dollar forms), within existing API. Pair relevant controls with trailing refusal and preserved data. Do not add tests that merely assert the helper agrees with itself.

Correct per-file receipts: actual maintained counts are drivers391, contract1, repository25, form12, integration3, editorSafety10 =442. Diagnostics12+14+72+152=250; shared181; total873. Do not copy stale counts9/17/10/8/7. Derive new counts from logs after adding tests. Say task-owned temporary diagnostic files were removed; the implementation working tree remains dirty/uncommitted.

## Task 4 — cumulative focused check, then one sequential full gate

After narrow checks pass, run the seventh diagnostic unchanged (68), sixth (152), fifth (72), fourth (14), third (12) and shared prepared package (181) with its observation helper, plus maintained driver/contract/repository/form/integration/editor-safety suites. All 57 conditional seams must be reached, no missing APIs/skips counted as passes. R9/native unchanged should stay unchanged. Save stdout, counts, durations and exit separately from cleanup.

Only after those are green, run one sequential final gate and capture a log/receipt per step:

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

Do not run overlapping matrices, rerun a passing expensive suite without relevant source change, or push to probe CI. Keep temporary diagnostics isolated or remove only exact task-owned copies. No PostgreSQL job is relevant here. No installer/physical Mac/live Gemini execution is assigned.

## Task 5 — evidence and handoff, uncommitted

Update only the local A2 status/implementation note; preserve historical failures and independent acceptance pending. Return actual raw sanitized reproduction and pass logs and full-gate stdout files (not only prose), exact commands/exits/counts/durations, full SHAs, changed-file list, source/test/fixture sizes and SHA-256 manifest. Compare the delta specifically to seventh-review submitted hashes. Map each requested task to actual proving tests/results. Report unsupported/unavailable coverage, not inferred passes.

Preserve native atomic saves, reference-safe cleanup, browser fail-closed durability, R1–R9, backup v2 integrity/v1 compatibility, shipped migrations, Windows behavior, bundle ID and newer main/Mac/Slice A work. Plain-browser/Node acknowledged-write loss does not demonstrate native desktop loss; parameter suffix failures do not demonstrate executed trailing controls. No release, Mac/APFS/WKWebView, Windows distribution or Slice B gate is cleared. Codex integrates with newer main and reruns the resulting tree only after independent acceptance. Leave source uncommitted and stop for review.
