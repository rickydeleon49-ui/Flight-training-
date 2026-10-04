# Windows A2 follow-up — align SQL line comments with the actual engines

You are the Windows implementer. Codex independently reviews and coordinates Git. The submitted R11/R12 fixes pass all 1,227 accumulated focused checks. Make the single bounded R13 correction below, prove it per task, and leave source uncommitted for review. Do not restart A2 or implement the next feature.

## 1. Preflight and exact source identity

Remote: https://github.com/rickydeleon49-ui/Flight-training-. Owner checkout: H:\Ai Repo clones\Flight-training-. Dirty branch `fix/atomic-study-material-saves`; base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`. Ninth review inspected main `f4c4b53f3e71907ee9f46cb2640de46eec90db5d`; fetch/record its current full SHA without switching/resetting/stashing/rebasing this dirty branch. Preserve current main's newer Mac/Slice A and CLAUDE.md/setup changes for eventual reviewed integration.

Read applicable instructions, shared STATUS/PROJECT_HANDOFF, ninth review/evidence and task handoff template. Record branch/base, dirty paths, tool versions, one active implementer and no running test matrix. Match all 24 files to the ninth-review matched-source-hashes.json before editing. Review snapshot has 307 files; only scanner, maintained tests, STATUS and local implementation note changed since eighth review. Native/R9 remains unchanged. Codex owns commit/push/PR/CI/merge; do not commit, push, tag, change versions, build installers or publish a release.

## 2. Reproduce R13 before editing; retain actual output

Copy `docs/evidence/a2-ninth-review-2026-10-04/a2NinthReview.regression.test.ts` unchanged into an isolated matching-source snapshot. Run its focused file first. Expected **78 cases: eight pass / 70 fail**. Record stdout, exact command, exit, elapsed time and source hashes; preserve the baseline file. The SQL strings use real CR/LF, not backslash text.

In `src/data/connectionOwner.ts`, normal line-comment scanning (lines 123–128 at reviewed hash) and CREATE/TRIGGER lookahead (lines 445–450) stop on CR or LF. Actual node:sqlite/SQLite 3.53.0 and sql.js 1.14.2 keep CR inside the comment until LF/input end. This mismatch is the root cause:

- `--\rignored\nBEGIN;` executes BEGIN through both public routes because the scanner treats ignored comment text as the first token and misses the later transaction command.
- `--\rCASE\nBEGIN;` creates phantom CASE depth from comment contents.
- Guard failures: two prefixes × eight suffixes × execute/select × two engines = 64 cases. A SQLite error is not successful pre-execution refusal.
- Four false rejections: valid comment-contained BEGIN before SELECT, and valid CR-containing comment between CREATE and TRIGGER, on both drivers.
- Two real write-loss regressions: public select opens the missed transaction, a public insert acknowledges success, an unrelated read fails, and the acknowledged row is absent. For sql.js, export/reopen already rolls back the inserted row.

This is development/browser-driver data loss, not demonstrated native desktop or installed-Mac loss. Retain the raw legality/firing controls. Do not weaken tests to accept the buggy results or skip an engine.

## 3. Task A — one consistent line-comment boundary correction

Make the smallest justified fix so normal token scanning and CREATE/TRIGGER lookahead agree with the actual SQLite line-comment rule. Both must ignore CR-containing comment text up to LF or input end; CR outside a comment remains SQLite whitespace. Consider a small module-private shared helper if it prevents drift, but do not replace the scanner with a general parser or new dependency.

Keep previous fixes intact: token-boundary vs embedded BOM, ASCII identifier/keyword boundaries, complete namespace/parenthesized variables, ON-target qualification state, decimal/member-access roles, quoted strings/identifiers, block comments, nested CASE, actual outer END, connection serialization and fail-closed recovery. Do not strip or normalize SQL, return to JavaScript whitespace predicates, reject valid comments/SQL, execute extra statements, expose raw handles/globals or change binding APIs/native behavior.

Run focused maintained R13 tests immediately after this task. Then rerun the unchanged 78-case ninth diagnostic. Capture failure-to-pass evidence before starting anything else; all 70 failures must be resolved while all eight original controls still pass.

## 4. Task B — meaningful regression and lexical boundary coverage

Add maintained tests using both real raw engines as the oracle and both public driver APIs. Establish legal controls before asserting guard behavior. Cover a finite deterministic table:

- LF, ordinary CRLF, one or multiple embedded CR followed by comment text then LF, and CR with no subsequent LF/input end.
- Comment contents containing ordinary words, CASE/END, transaction keywords, semicolons, quotes and block-comment-looking text; none should mutate scanner grammatical state while still commented.
- Direct transaction commands after a true LF boundary and trailing commands after a valid preceding statement/complete trigger, using all eight established suffixes and both public routes.
- Line comments in CREATE [TEMP/TEMPORARY] TRIGGER lookahead and body/header positions; a valid trigger must still create and fire. Unsupported engine syntax is recorded separately, never counted as a positive control.
- Block comments and quoted tokens containing CR/LF remain opaque; ASCII CR whitespace outside comments remains supported.
- Refusal before side effects preserves prior material fields/tags, unrelated rows, sql.js reloaded storage, and a subsequent atomic save. Keep the actual acknowledged-write-loss tests rather than testing only the scanner boolean.

Use deterministic assertions, not sleeps/retries or expanded arbitrary fuzzing. Run this task's focused file and keep actual output. Do not add migrations, dependencies, broad permissions or unrelated cleanup.

## 5. Cumulative focused gate, then one sequential full gate

Rerun maintained driver/contract/repository/form/integration/editor-safety tests and unchanged diagnostics ninth 78, eighth 72, seventh 68, sixth 152, fifth 72, fourth 14, third 12, shared 181 with its observation helper. All 57 conditional seams must be reached; API absence/skips are not passes. Independent baseline before ninth diagnostic: maintained 656 + historic 390 + shared 181 = 1,227. Additions change totals honestly; do not replace prior assertions or misassign counts to file names.

Only after all focused checks pass, run one complete sequential gate with no overlapping processes:

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

Archive task-owned diagnostic copies outside default discovery, or run the gate in a suitable isolated snapshot; never delete unrelated files. Record the test exit before cleanup. Use focused checks during development and one final matrix, with no speculative CI push or duplicate native/build work. Do not rerun a passing expensive check unless relevant code changes.

## 6. Deliver reviewable evidence and stop

**Provide actual sanitized log files for the pre-fix reproduction, each task's focused checks, cumulative checks and each full-gate step.** The last handoff gave successful counts but no current full-gate logs; an inspected scratch baseline log is from older material-save failures. A narrative claiming success is reported evidence, not a raw receipt. Save stdout/stderr, exact command/cwd/runtime, exit, test counts, duration and final source hash identity. No secrets, private documents/databases or installers in Git.

Update local STATUS/implementation note and preserve historical failures. Return exact 24-file hashes/sizes, full SHAs, dirty paths, delta from ninth-review manifest, task-to-test mapping, test-output paths and platform/skip limits. Derive file counts from logs; ninth independent maintained counts are 605 / 1 / 25 / 12 / 3 / 10, not the swapped names in the previous handoff. Do not describe the intentionally dirty tree as clean.

Preserve native atomic saves/reference-safe cleanup, R1–R12, backup v2/v1, shipped migrations, Windows behavior, bundle ID, newer Mac/Slice A and Claude setup. No installed Windows, actual Mac/APFS/WKWebView/live Gemini, Slice B or release gate is cleared by this work. Leave everything uncommitted/unpushed and stop for Codex review. Once accepted, Codex will integrate the intended changes on latest main and validate that resulting tree; do not copy stale whole files over newer main.
