# Independent reviewer assignment: GEN-REL-03

Review the GEN-REL-03 implementation completed by Codex from Claude's interrupted work. The implementer has **not** independently accepted its own code. Review only this package and interactions with accepted GEN-REL-01/02. Do not start GEN-REL-04, change providers, increase flashcard counts, launch the app or merge.

Worktree: `/Users/rickymac/code/Flight-training-gen-rel-03`.
Branch: `codex/gen-rel-03-completion`; base: `17c80ee` (PR #214).
Report: `docs/GEN_REL_03_IMPLEMENTATION_REPORT_2026-10-18.md`.
Evidence: `docs/evidence/gen-rel-03-completion-2026-10-18/`.
Scope authority: GEN-REL-03 in `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`, plus the R12 carry-forward at the top of ROADMAP.

1. Verify the source/evidence hashes first. If a frozen source differs, report that identity and inspect competing work before editing. Preserve the inherited failure, first focused failure and previous feature evidence. Do not pull/reset/stash a dirty clone.
2. Inspect `src-tauri/src/gemini_budget.rs` and its production call paths in `gemini.rs` and `gemini_files.rs`. Prove the deadline includes upload, readiness, coalesced preparation, headers, body, pauses, fallback and awaits at cleanup. Look specifically for any new 300-second allowance, work started after expiry, a dropped future leaving ownership stuck, or an attempt counter re-created after missing-file recovery.
3. Inspect generation retry policy: at most three generation submissions including fallback; finite transient retry with jitter; Retry-After honored before fallback as well as same-model retry; no retry when the requested delay exceeds the budget. Check HTTP 400/401/402/403/404/408/429/500/502/503/504 and quota structures, including mixed minute/day facts and malformed details. A healthy prepared file must not turn model 404 into a re-upload or a retirement assertion.
4. Reproduce real local HTTP faults through the synthetic fixture: closed connection, premature EOF, delayed headers and held response body. Verify unknown remote outcome/cost language. Confirm upload interruptions never claim protocol resume and do not lead to blind duplicate uploads in the run. Review the outer guard for coalesced awaits, not only per-request timeouts.
5. Check output blocking/truncation and malformed JSON even when candidate text is present. No partial answer may checkpoint/save. Practice-test validation remains mandatory.
6. Check R12: expiration after a slow lookup, and a shared copy at adoption. Preserve credential/source/context/cache ownership guards. Run old concurrency/stale-context/cleanup tests too.
7. Review failure details in the real native job journal: stage/category/attempts/time/status only, no provider body, source path, document content, key or upload locator. Restart must not resend a failed/interrupted job; save-only recovery must still avoid all provider calls. This package deliberately adds no automatic inference-resume endpoint: a user-initiated new generation is a new job; recovery of an old checkpoint remains save-only. Push back if a current path violates that boundary.
8. Reuse valid unchanged-source evidence. Run focused native checks and appropriate final gates; never relabel an earlier red run or change timeouts/skips to get green. All tests must use synthetic data and loopback, without reading credentials or profiles.

Suggested commands, from this worktree (Node 22; rustup stable; SDK 26.5 as recorded in the evidence):

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml gemini -- --nocapture
npm run typecheck
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:cargo-lock
node --test scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check 17c80ee
```

The original feature already changed the retry count from four primary plus one backup to three total. Old tests now receive budget arguments and assert the new count/message policy; verify their request-count, source binding and ownership assertions remain intact rather than treating all assertion edits as benign. The failed focused receipt is included for comparison.

Return either acceptance with exact reviewed identity and evidence scope, or **one consolidated precise correction report**. Each finding should identify file/function, concrete trigger, observed/required behavior and a meaningful reproducer/regression expectation. Separate blocking defects from follow-on improvements. Do not claim installed/live-provider verification. No self-merge, new release, provider call, real profile access or scheduling migration. The next item stays gated on independent review and integration.
