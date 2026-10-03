# Gemini: finish interrupted structured study-import Slice A on the Mac

The owner explicitly assigns Gemini to finish Claude's interrupted Slice A implementation. This is a task-specific handover of implementation duties; preserve the agreed workflow in which Codex independently reviews, commits, publishes and merges after checks.

Continue in `/Users/rickymac/code/Flight-training-`, on the existing dirty branch `codex/structured-study-import-slice-a`, HEAD/base `696b07021f74104b800bc4a37c9ccb4c437a1abb`. Finish the existing work, tests, licensing evidence and handoff. Leave everything uncommitted and unpushed for Codex review.

## 1. Resume safely and preserve authorization

Do not restart from clean main, create a new implementation checkout, switch branches, reset, stash, clean or overwrite existing changes. Claude's source is local and not on GitHub. Confirm the branch/base/status and compare all 81 files with Codex's interruption starting-hashes receipt before editing. Receipt SHA-256 is `4fc0cccc759615021d92837d4d6a00dd725c88e6273ec7b5bca6abe00f101d63`. If any file differs, inspect and preserve it; do not assume it belongs to this handoff.

Fetch origin to read the published interruption review and this prompt without merging or switching the dirty source branch. Use `git show origin/main:<repository-relative-document-path>` or the GitHub versions. The review publication may have advanced main; that is expected and does not mean the source was merged. Record both the source base and documentation revision used.

Read current/local STATUS, the owner-exception note, accepted contract, implementation handoff, independent acceptance, Codex interruption review and prior Claude Slice A prompt. The exception records explicit owner approval for this source-only scope, and the owner has authorized you to complete it. Do not ask again for the same approval or broaden its scope. A2, M2 and installed/signing/release gates remain unresolved; the exception covers only Slice A.

## 2. Inventory the existing implementation

The submission already contains:

- package.json/package-lock.json pinning only `zod@4.6.5`;
- TypeScript modules in `src/logic/studyPacket/` for limits, private diagnostics, strict scan, normalization/schema, semantics, types, payloads, canonical persistence JSON and public entry points;
- seven focused frontend test files including the service-wrapper tests, totaling 241 passing cases in Codex's interruption check;
- synthetic fixtures/expectations in `src/testing/fixtures/study-packets/` with a byte-drift check and generated boundary support in `src/testing/studyPackets.ts`;
- read-only `src-tauri/src/study_packet.rs`, registered in lib.rs, with 16 independently passing reader tests;
- desktop-only `src/services/studyPackets.ts` and its simulated invoke tests;
- `public/THIRD_PARTY_NOTICES.txt` and the owner decision note.

These paths are relative to `/Users/rickymac/code/Flight-training-`. Inspect the code and relevant tests before changing it. Preserve the existing R1–R5 behavior and useful tests. Do not rewrite working modules merely to match your style.

## 3. Fix the interrupted mutation experiment first

The original scratch runner and failed results are preserved in the review evidence under `docs/evidence/structured-study-import-slice-a-resume-2026-10-03/` on origin/main. They are diagnostic records, not an accepted test gate.

Its scratch copies omit package-lock.json and public/THIRD_PARTY_NOTICES.txt, although the selected suite includes notice tests that need them. All 22 rows therefore include two unrelated notice-test failures. M10, M12a and M12b fail only those tests and are falsely counted as caught. The runner has no clean unmodified control.

Create a reproducible corrected runner using the production TypeScript and real Vitest assertions. Keep it in an appropriate repository testing/script location; use an inert copy in evidence if helpful. Do not place executable artifacts where they are presented only as accepted documentation.

Use one consistent scratch-copy function for the unmodified control and every mutant. Include package.json, package-lock.json, required public notice, source/tests, configs and accepted fixture evidence. Reuse the installed dependency tree read-only where appropriate. Apply mutations only in owned temporary folders and clean up only folders the runner created.

First prove that the unmodified scratch control runs the selected suites with zero failures and exit 0. Then apply each mutation with unique-anchor checks. Record expected classification, exact exit, assertion counts and complete relevant failing names.

A missing file, transform/import error, crashed process, missing JSON report or unrelated assertion failure must be an infrastructure failure, not a behavioral catch. Count actual failed assertions rather than skipped/pending assertions. Validate the test report and process status consistently. Exit nonzero on any infrastructure failure or unexpected outcome.

Prove the runner's aggregate failure propagation with a deliberately incorrect expectation or equivalent owned scratch self-test. Preserve the old failed run and corrected results side by side with dates and explanation.

Required normal result: 22 expected outcomes, 19 caught and three neutralized (M10, M12a, M12b). Keep the two privacy layers intact. Do not change those three to “caught,” remove notice tests, disable the diagnostic boundary or weaken expectations to make the run appear green. If a behavior differs from the reference for a legitimate reason, demonstrate it and report it for Codex rather than relabelling it silently.

## 4. Finish checks and licensing evidence

Codex independently ran 241 focused frontend tests, the type check and 16 focused native tests successfully. Preserve those counts as interruption evidence, and distinguish them from your own final results. Re-run focused checks after any relevant changes.

After corrections, run the complete appropriate local gate sequentially: frontend tests, normal build/typecheck, Rust formatting, clippy with warnings denied, full locked Rust tests, Cargo lockfile synchronization and whitespace checks including new files. Use existing package scripts and repository conventions. Record exact commands, exit codes, passed/skipped/ignored counts and any intermediate failure. Do not overlap full matrices or repeat successful unchanged gates without a reason.

Use scoped PATH `/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`. Node is 22.23.3, npm 10.9.9, Rust/cargo 1.99.0. For native checks set SDKROOT to the existing `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Verify that path exists. Do not use a nonexistent Xcode path or change global developer/SDK settings. Codex's first native attempt used an incorrect path and hit the known SDK27 TAPI mismatch; the correct path passed without source changes.

Check that the intended dependency/lockfile delta remains only Zod and that its provenance/integrity agrees with the reviewed exact version. Keep jitless configured before schemas and no zod/compile import. Preserve the real Function-constructor counter and its positive control.

After the normal build, prove that dist/THIRD_PARTY_NOTICES.txt is byte-identical to public/THIRD_PARTY_NOTICES.txt and contains the installed Zod copyright and permission text. Inspect Tauri's configured frontend inclusion and describe the distribution path. This is source/build inclusion evidence, not an installer or installed-app claim. Do not build or launch installers just for this task.

## 5. Complete documentation and the review receipt

Write the missing Slice A implementation report; the notice currently refers to that nonexistent report. Explain final behavior, authorization, scope, original-byte versus canonical-content hashes, native bounds, Zod provenance, license handling, reference-port deviations and actual test evidence. If mentioning the pre-existing incomplete notices for earlier dependencies, identify that remaining gap without expanding this task into an unrelated license overhaul.

Reconcile STATUS and docs/PROJECT_HANDOFF.md so they accurately show that the owner exception exists, implementation is local and pending final Codex review, and Slice B/C plus installed/release gates remain pending. Preserve the newly published interruption report/prompt when Codex later reconciles main. Do not claim acceptance, merge or platform testing that has not happened.

Store reproducible commands, relevant logs/results, control and mutation/self-test receipts, and the final file inventory with SHA-256 hashes. Hash all intended tracked modifications and untracked files, and state clearly how the receipt excludes its own hash. Check relative links and whitespace in new files as well as tracked differences.

## 6. Keep the same boundaries and stop

No UI wiring, database save/replace command, schema migration, provider-label/domain widening, Markdown dependency, other library, live provider request, owner app-profile access, installation, signing, account provisioning, release or Windows-owner message. Preserve Gemini requests and keys, ordinary-file import, backup/restore, capabilities, minimum macOS12, app identity and release holds.

Use disposable files/profiles only. Do not interpret simulated wrapper, picker-cancellation representation or helper tests as real picker/installed/older-WebKit evidence. No Slice B or C work.

Final response: exact branch/base and documentation revision; preserved starting hashes; complete changed-file inventory; authorization note; SA1 issue-to-fix map; R1–R5 preservation; focused/full checks and exits; corrected mutation outcomes with a zero-failure control and negative self-test; license/build evidence; intermediate failures; final hashes; remaining gates.

Leave everything uncommitted and unpushed in the primary Mac checkout. Stop for Codex independent final review. Codex handles publication and merge after source acceptance and required exact-head CI.
