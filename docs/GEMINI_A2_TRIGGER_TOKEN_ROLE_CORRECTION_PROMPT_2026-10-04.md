# Windows A2 follow-up — correct trigger token boundaries and grammatical roles

You are the Windows implementer; Codex is independent reviewer/Git coordinator. The latest correction passes all 1,035 independently rerun focused cases, including the previous real acknowledged-write preservation regression. Fix the two remaining bounded trigger-header issues and prove them, without restarting A2 or adding features.

## 1. Preflight, identity and preservation

Remote: https://github.com/rickydeleon49-ui/Flight-training-. Owner checkout: H:\Ai Repo clones\Flight-training-. Dirty branch `fix/atomic-study-material-saves`; base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`. Main inspected `e203a039ec449121f6b8e6677578197c25369a90`; fetch/record current full SHA, do not switch/reset/stash/rebase this dirty checkout. Newer main contains Mac/Slice A changes and CLAUDE.md/setup helpers; preserve them during eventual integration. Read applicable instructions, current shared STATUS/PROJECT_HANDOFF, eighth review/evidence and handoff template.

Record tools, source hashes, dirty paths, one active implementer and no running test matrix. Current review observed 307 files; only scanner, maintained tests, STATUS and implementation note changed since seventh review. Native and R9 remain unchanged. Codex owns commit/push/PR/CI/merge after acceptance. Do not commit/push/tag, change versions, create migrations/dependencies, build installers or publish a release.

## 2. Reproduce both exact blockers before editing

Copy `docs/evidence/a2-eighth-review-2026-10-04/a2EighthReview.regression.test.ts` unchanged into an isolated matching-source snapshot. Retain actual sanitized stdout and exit. Expected 72 cases: eight passing real-engine/public trigger firing controls and 64 refusal failures.

- R12: trigger `WHEN .5 BEGIN ... END;` is legal. The dot branch globally sets expectingTableName in any header expression; the number does not consume that expectation; actual body BEGIN is swallowed as a table token. 32 appended-control refusal cases fail.
- R11: U+FEFF before the trigger body BEGIN is legal token-boundary whitespace in both engines. The current BOM branch only skips it at statement start, so the header remains open. 32 appended-control refusal cases fail.

Retain all raw/public legality and side-effect assertions. These failures establish improperly accepted trigger creation, not execution of trailing commands or new desktop data loss. Direct-BOM data-preservation tests now pass; do not undo that correction.

## 3. Make bounded scanner corrections and prove each task

Correct lexical recognition independently of grammatical statement-start state. A BOM at the beginning of a supported engine token and a BOM already inside an identifier/quoted value are different cases. Match installed engines at accepted positions; preserve valid non-ASCII identifiers and non-ASCII spaces. Apply consistent rules in normal scanning and CREATE/TRIGGER lookahead. Do not globally strip BOM or return to JavaScript whitespace predicates. Retain unsupported `BEGIN + BOM` cases and Emscripten output-decoding limits.

Give dot/table-name handling the actual header role: qualification of the ON target is distinct from a decimal point or expression/member access in WHEN. Do not let arbitrary expression punctuation re-enable an already-consumed table expectation. Preserve unquoted/single-quoted target names, `main.end`, schema-qualified names, update-of columns, NEW/OLD member accesses, aliases and nested CASE. Do not special-case .5, ban decimals, clear state at arbitrary keywords or introduce a general parser dependency.

For each substantive fix, first run its focused tests and keep failure/pass logs. Use a small deterministic differential table against both real engines and both public drivers, including legal leading decimal/scientific/signed/parenthesized forms, NEW/OLD qualification and true nested CASE expressions where supported. Place BOM at selected token boundaries before trigger/body structural words, separated from embedded-token/string forms; record genuinely unsupported forms honestly. Pair each relevant positive control with the eight established transaction suffixes (BEGIN, BEGIN TRANSACTION, COMMIT, END, SAVEPOINT, ROLLBACK, ROLLBACK TO, RELEASE), both routes and engines. Refusal must occur before trigger creation; prior records/tags survive, sql.js reopened state agrees and a subsequent atomic save works.

Retain complete identifiers, Tcl-style variables, quotes/comments and actual outer END handling. Do not execute later statements, disable refusal, expose raw handles/globals, weaken ownership/recovery or require valid callers to quote names. Add regression tests that prove real engine behavior, not just equality with a scanner helper.

## 4. Cumulative focused verification, then one sequential full gate

After narrow tests pass, rerun unchanged eighth(72), seventh(68), sixth(152), fifth(72), fourth(14), third(12), and shared prepared(181) diagnostics with the observation helper, plus maintained driver/contract/repository/form/integration/editor-safety suites. All 57 shared conditional seams must be reached; unavailable APIs/skips are not passes. Keep every previous assertion. Baseline maintained counts:485 / 1 / 25 / 12 / 3 / 10 = 536; historical diagnostics 318; shared 181; total1,035 before new maintained cases.

Only after focused checks pass, run one sequential final gate:

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

Capture actual stdout per step with exact source hashes, command, exit, counts and elapsed time. No overlapping matrices, unnecessary repeated builds, PostgreSQL job or speculative CI. Keep diagnostics isolated or remove only task-owned copies and record test exit before cleanup.

## 5. Return a verifiable handoff, uncommitted

Update local A2 status/implementation note while preserving historical failures and acceptance pending. Provide sanitized actual failure/pass/full-gate logs as files suitable for docs publication; prose-only counts remain reported evidence. No raw current full-gate logs were supplied in this review. Derive counts from results and distinguish observed/current source hashes from an expected supplied manifest. Compare specifically to eighth-review observed-source-hashes.json and include all source/test/fixture sizes and SHA-256 values, full SHAs, exact dirty paths and task-to-test mappings. Record unsupported/platform limits and all intentional skips.

Preserve native atomic save/reference-safe cleanup, R1–R10 and passing direct R11 cases, backup v2/v1 guarantees, shipped migrations, Windows behavior, bundle ID, current main's Mac/Slice A and Claude setup changes. These browser/test-driver failures do not prove native desktop loss. No installed Mac/APFS/WKWebView/live Gemini, Slice B or release gate is cleared. Leave source uncommitted and stop for independent review; Codex integrates only after acceptance and verifies the resulting latest-main tree.
