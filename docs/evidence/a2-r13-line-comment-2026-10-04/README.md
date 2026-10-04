# A2 R13 line-comment boundary correction — Windows implementer evidence, 4 October 2026

**LOCAL UNCOMMITTED. Pending independent Codex review.** No commit, push, tag, version change, installer or release. The tree is intentionally dirty.

Responds to the [ninth review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/A2_NINTH_REVIEW_2026-10-04.md). Implementation detail: [implementation note §14](../../ATOMIC_STUDY_MATERIAL_SAVES_2026-10-02.md). Status: [STATUS.md](../../../STATUS.md).

## Identity and ownership

- Task: A2 R13 only (no A2 restart, no next feature). Active implementer: Claude (Windows). Independent reviewer and Git coordinator: Codex. No other test matrix was running at preflight; one implementer.
- Machine: Windows 11 Pro 10.0.26200, Ryzen 7 5800X3D, NTFS. Toolchain ([gate-00-toolchain.txt](gate-00-toolchain.txt)): Node 24.16.0, npm 11.13.0, cargo/rustc 1.98.1, Git 2.55.0. Engines: node:sqlite SQLite 3.53.0, sql.js 1.14.2, Vitest 4.1.11.
- Remote `https://github.com/rickydeleon49-ui/Flight-training-`. Branch `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`.
- Main: the ninth review inspected `f4c4b53f3e71907ee9f46cb2640de46eec90db5d`. Fetched for this task: `37ec9a1f99af61dc0ce89b672bb0a4b63d69ac51`, which merges PR #76, the ninth-review docs. Not switched, reset, stashed or rebased. The review evidence was read through `git archive origin/main` into a scratch folder.
- Preflight: all 24 files matched the ninth review's `matched-source-hashes.json` (24/24 size and SHA-256); the snapshot has 307 files.

## Source identity after this task

The full manifest, with ninth-review values beside each entry, is [submitted-source-hashes.json](submitted-source-hashes.json). **Delta from the ninth manifest: 4 files**. The other 20, including all native/R9 and fixture files, are byte-identical.

| File | Size | SHA-256 |
| --- | --- | --- |
| `src/data/connectionOwner.ts` | 15,969 | `2c985a7c515b434a663e495a902bc8451faaeb3daa5de3dc46b6bd173ad3324a` |
| `src/data/singleConnectionDrivers.test.ts` | 106,951 | `90bc239d5898db07faf23953719223fc1443b5d9a55584a2da04006f51f70f26` |
| `STATUS.md` | 81,260 | `392cbc029d95e1ee7845067649d945e29d008a5a0cf01371ecbe99c40fdfc5d7` |
| `docs/ATOMIC_STUDY_MATERIAL_SAVES_2026-10-02.md` | 55,491 | `209dabf5f96d88d29760341f7ea6b01b18f6ccf5e7e72ec805da0db85c47a597` |

New untracked folder: this `docs/evidence/a2-r13-line-comment-2026-10-04/` (logs, manifests, this README). It contains no diagnostic `.ts` copies. Dirty paths are the same as at preflight, plus `docs/evidence/`.

## Change

`connectionOwner.ts` adds a module-private `lineCommentEnd(sql, start)`, which returns the index of the next LF or the input length. The normal token loop and the CREATE/TRIGGER lookahead both use it, replacing two loops that also stopped on CR. This matches SQLite's tokenizer, where a `--` comment ends only at `\n` or input end. CR outside comments is still whitespace. No other scanner, driver, binding, native or migration change.

## Receipts (task → test → log)

Every log records label, exact command, sanitized cwd, start time, Node version, combined stdout+stderr, exit code and wall time. Paths are shown as `<OWNER_CHECKOUT>`, `<SCRATCH>` and `<HOME>`. Snapshots were scratch copies of `git ls-files -co --exclude-standard`, with a junction to the owner's `node_modules`.

| # | Task | Command (cwd) | Source | Exit / counts | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | Pre-fix reproduction | `npx --no-install vitest run src/data/a2NinthReview.regression.test.ts --reporter=verbose` (`<SCRATCH>/snap-pre`, 307 files + unchanged diagnostic `2b622e1f…`) | ninth-matched source, scanner `09dd97f1…` | **exit 1; 78 = 8 passed / 70 failed**; 1.38 s | [01-prefix-ninth-diagnostic.log](01-prefix-ninth-diagnostic.log) |
| 2 | A focused | `npx --no-install vitest run src/data/singleConnectionDrivers.test.ts` (owner) | fixed scanner, prior 605-case test file | exit 0; 605 passed | [02-taskA-maintained-driver.log](02-taskA-maintained-driver.log) |
| 3 | A failure→pass | same as #1 (`<SCRATCH>/snap-a`) | fixed scanner `2c985a7c…` | **exit 0; 78 passed** (all 70 resolved, 8 controls still pass) | [03-taskA-ninth-diagnostic-postfix.log](03-taskA-ninth-diagnostic-postfix.log) |
| 4 | B negative control | `npx --no-install vitest run src/data/singleConnectionDrivers.test.ts -t R13 --reporter=verbose` (`snap-pre`, new test file over the **unfixed** scanner) | scanner `09dd97f1…` | exit 1; **426 of 780 R13 cases fail**, 354 pass (raw oracles and forms the old scanner already handled) | [04-taskB-sensitivity-new-tests-on-prefix-scanner.log](04-taskB-sensitivity-new-tests-on-prefix-scanner.log) |
| 5 | B focused | `npx --no-install vitest run src/data/singleConnectionDrivers.test.ts` (owner) | final | exit 0; **1,385 passed** (605 + 780) | [05-taskB-maintained-driver-file.log](05-taskB-maintained-driver-file.log) |
| 6 | Cumulative focused | Codex's 14-file command from the ninth receipt (`<SCRATCH>/snap-cum`: 307 files + 9 unchanged copies, hashes in [diagnostic-copies.sha256](diagnostic-copies.sha256)) | final | **exit 0; 14 files, 2,085 passed, 0 failed, 0 skipped**; 22.0 s | [06-cumulative-focused.log](06-cumulative-focused.log) |
| G1 | Full gate | `npm ci` (owner) | final | exit 0 | [gate-01-npm-ci.log](gate-01-npm-ci.log) |
| G2 | | `npm test` | final | exit 0; 65 files (62 passed, 3 skipped); **1,998 passed, 4 skipped** | [gate-02-npm-test.log](gate-02-npm-test.log) |
| G3 | | `npm run build` | final | exit 0 | [gate-03-npm-build.log](gate-03-npm-build.log) |
| G4 | | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | final | exit 0 | [gate-04-cargo-fmt.log](gate-04-cargo-fmt.log) |
| G5 | | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | final | exit 0 | [gate-05-cargo-clippy.log](gate-05-cargo-clippy.log) |
| G6 | | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | final | exit 0; **283 passed, 6 ignored** | [gate-06-cargo-test.log](gate-06-cargo-test.log) |
| G7 | | `npm run test:cargo-lock` | final | exit 0 | [gate-07-test-cargo-lock.log](gate-07-test-cargo-lock.log) |
| G8 | | `node scripts/check-release-version.mjs 0.5.3` | final | exit 0 | [gate-08-release-version.log](gate-08-release-version.log) |
| G9 | | `git diff --check` | final | exit 0 | [gate-09-git-diff-check.log](gate-09-git-diff-check.log) |

The full gate ran once, sequentially, with no overlapping processes, in the owner checkout. Default discovery (`src/**/*.test.ts`) contained no diagnostic copies. Every source file the gate tested matches the manifest above. STATUS and the implementation note were edited while G1–G8 ran, which do not read docs; G9 ran after those edits. This README and `submitted-source-hashes.json` were written after the gate.

### Counts derived from log 6

| File | Passed |
| --- | --- |
| `singleConnectionDrivers.test.ts` | 1,385 (605 prior + 780 R13) |
| `materialSaveContract.test.ts` / `documentRepository.test.ts` / `MaterialFormDialog.test.ts` / `materialSaveIntegration.test.ts` / `editorSafety.test.ts` | 1 / 25 / 12 / 3 / 10 |
| Ninth / eighth / seventh / sixth / fifth / fourth / third diagnostics | 78 / 72 / 68 / 152 / 72 / 14 / 12 |
| Shared `a2ReviewDiagnostics.mac.test.ts` (+ `a2DiagnosticObservations.ts`) | 181; all 57 `CONDITIONAL SEAM` cases passed, and each asserts its barrier fired (none skipped) |

Reconciliation: 1,227 earlier focused + 78 ninth + 780 new = 2,085. Maintained = 656 + 780 = 1,436. Frontend full suite: the handoff's 1,218 + 780 = 1,998. Codex's independent per-file maintained counts were 605 / 1 / 25 / 12 / 3 / 10, and this log reproduces them, except that the driver file grew by 780.

### Task-to-test mapping (new maintained cases, `R13 line-comment boundary — <engine>`, 390 per engine)

- **Comment ends only at LF:** 14 forms × (raw oracle + public accept + 8 suffixes × 2 routes). The forms are LF, CRLF, embedded CR, multiple CRs, and CR followed by CRLF, CASE, END, `BEGIN;`, `; COMMIT`, `'`, `"`, `[`, `` ` `` or `/*`.
- **CR with no LF to input end:** a raw oracle, public acceptance, the 8 suffixes before a trailing comment on both routes, and a comment-only *record* (not a positive control: node `prepare` has no statement).
- **Trailing after a valid SELECT or completed trigger:** 3 contexts × raw oracle, plus 8 suffixes × 2 routes, with trigger absence asserted.
- **CREATE [TEMP/TEMPORARY] TRIGGER lookahead, name, ON target, WHEN, body start and before END:** 8 raw firing oracles, public creation and firing, appended BEGIN refused on both routes, and `CREATE --\rTRIGGER\nTABLE` kept as a table.
- **Opaque block comments, strings and identifiers holding CR/LF/`--`/BEGIN, and CR whitespace outside comments:** accepted, with raw oracles. A BEGIN after any of them is refused.
- **Refusal precedes side effects:** acknowledged-write tests over 4 SQL forms × 2 routes, including sql.js reopen. Prior material fields/tags, unrelated rows and trigger state are preserved, sql.js reloaded storage survives, and the next atomic save succeeds.

## Platform and skip limits

- Frontend skips (4): three opt-in benchmark files (`HFD_BENCH`) and one intentional `releaseSafety` availability skip. Rust ignored (6): manual performance and opt-in fixture tests.
- **sql.js TEMP triggers:** the durable write's `export()` closes and reopens the connection, which drops TEMP schema objects with or without comments. This pre-existing driver property is recorded in two sql.js record tests and is **not** counted as a firing control. Node covers TEMP/TEMPORARY creation and firing.
- R13 loss was development/browser-driver only. Desktop Tauri does not use this scanner. This work clears no native, installed Windows, Mac/APFS/WKWebView, live Gemini, Slice B or release gate. Synthetic data only; no secrets, real databases, documents or installers.

## Continuation

Codex owns review, commit, push, PR, CI and merge. On acceptance, integrate the intended changes onto latest main (`37ec9a1f…` or newer) and validate that tree, keeping main's newer Mac/Slice A and CLAUDE.md/setup work. Do not copy stale whole files over main. Scratch snapshots and diagnostic copies are outside the repository; nothing in default test discovery needs cleanup.
