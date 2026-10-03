# Structured study-import Slice A: interruption review, 3 October 2026

**Incomplete source implementation; not accepted for source integration. Gemini is assigned to finish the existing Mac changes.** Codex reviewed where Claude stopped and independently checked the focused suites. The production work stays uncommitted/unpushed in the primary Mac clone; this publication contains only review/handoff documentation, the recorded owner decision and diagnostic evidence.

## Exact resume state

- Primary checkout: `/Users/rickymac/code/Flight-training-`.
- Branch: `codex/structured-study-import-slice-a`.
- HEAD/base: `696b07021f74104b800bc4a37c9ccb4c437a1abb` (accepted contract, PR #59).
- 81 submitted paths: three tracked modifications and 78 untracked files. [Starting hashes](evidence/structured-study-import-slice-a-resume-2026-10-03/starting-hashes.txt) cover all 81. Receipt SHA-256: `4fc0cccc759615021d92837d4d6a00dd725c88e6273ec7b5bca6abe00f101d63`.
- The [owner exception](STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md) records the owner's explicit source-only approval in Claude's Mac session. The owner has now explicitly assigned Gemini to finish that same scope. A2/M2, installed, signing and release gates remain open.
- Review documents may advance `origin/main` while the source branch remains at this base. Gemini must fetch/read the new documents without switching, resetting, stashing or discarding the dirty source checkout. Codex reconciles documentation at final integration.

## What already exists

Exactly `zod@4.6.5` is added to package.json and package-lock.json; the lockfile adds only the intended package/root entry. New TypeScript modules implement bounded scanning, normalization/Zod schema, semantic rules, private diagnostics, preview/persistence separation and canonical persistence JSON. The port retains R1–R5. Fixtures and expectations are copied with a byte-drift guard.

`src-tauri/src/study_packet.rs` defines the native picker and bounded read helpers, original-byte SHA-256, strict UTF-8/BOM handling, fixed failures and 16 tests. `src-tauri/src/lib.rs` registers that command. The desktop-only service wrapper and ten simulated invoke tests are present. No UI wiring, database operation, domain-provider widening or capability change was found in this submission.

`public/THIRD_PARTY_NOTICES.txt` includes Zod's package license. Its two tests pass against the installed license and lockfile. Actual built-output notice verification, the implementation report, status reconciliation and final receipt remain unfinished. The notice currently refers to an implementation report that does not yet exist.

## Independent checks actually run by Codex

| Command / observation | Result |
| --- | --- |
| Node 22: `npm test -- src/logic/studyPacket src/services/studyPackets.test.ts` | exit 0; seven files, 241 tests passed |
| Node 22: `npm run typecheck` | exit 0 |
| Rust 1.99: `cargo test --locked --manifest-path src-tauri/Cargo.toml study_packet::tests`, with installed SDK 26.5 | exit 0; 16 passed, 256 filtered out |
| `git diff --check` | exit 0; covers tracked changes only |
| Source scope and manifest diff | intended Slice A additions; no new Rust dependency or capability change |

Scoped toolchain PATH: `/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`. Correct SDKROOT: `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.

Codex's first native command incorrectly named a nonexistent Xcode SDK path. That attempt exited 101 while the linker fell back to SDK 27.0 and hit the known TAPI architecture mismatch. Correcting the per-command SDKROOT produced the 16 passing tests; no source or global SDK change was needed. This intermediate failure is not a source regression.

Full frontend/build and Rust format/clippy/test/lockfile gates were not run by Codex in this interruption review. No app profile, real database, picker UI, installed application, Windows app or live provider was accessed.

## Confirmed mutation-runner defect: SA1 (P2)

Claude's scratch [runner](evidence/structured-study-import-slice-a-resume-2026-10-03/claude-run-slice-a-mutations.mjs.txt), lines 49–51, copies src, package.json, TypeScript/Vite config and contract evidence, but omits package-lock.json and public/THIRD_PARTY_NOTICES.txt. It runs all studyPacket tests, including the notice tests that read both omitted files. There is no unmodified control run.

The saved [22-row result](evidence/structured-study-import-slice-a-resume-2026-10-03/claude-mutation-results.json) shows two unrelated notice-test failures in every row. M10, M12a and M12b each fail only those notice tests and are incorrectly marked caught, contrary to their expected neutralization. Nineteen rows are labelled as expected and three are not, but the run is contaminated and does not establish a valid mutation gate. Its classification also treats any non-passed assertion as a catch rather than verifying a relevant assertion failure and successful test infrastructure.

Gemini should repair the runner, not weaken the validator or license checks: copy the necessary files, prove zero failures on an unmodified scratch control, apply mutations only to owned scratch copies, distinguish setup/load/process errors from behavioral catches, preserve useful failing assertion names, and rerun all 22. The required outcome remains 19 caught and three neutralized. Preserve this failed run as dated evidence alongside the corrected run.

## Finish before final review

1. Fix SA1; commit a reproducible runner/evidence in the eventual source submission and prove its failure propagation.
2. Complete the full sequential local matrix, fix any real failures and record exact counts/exits. Avoid packaging or installed tests.
3. Prove dist/THIRD_PARTY_NOTICES.txt matches the source notice after the normal build; describe Tauri's configured frontend inclusion accurately without claiming an installer check.
4. Write the missing implementation report, reconcile STATUS/project handoff with the exception and pending acceptance, and produce exact hashes for all intended files. Do not claim this interruption review accepts the source.
5. Leave the dirty source branch uncommitted/unpushed for Codex's final review. Do not start Slice B/C.

[Detailed Gemini continuation prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_A_FINISH_PROMPT_2026-10-03.md) supplies the executable assignment. Prior contract acceptance remains valid; source acceptance and platform/release evidence do not yet exist.
