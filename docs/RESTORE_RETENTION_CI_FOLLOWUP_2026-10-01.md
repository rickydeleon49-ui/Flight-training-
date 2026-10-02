# A1 exact-head CI follow-up

Date: 1 October 2026. PR: #42. Reviewer/Git coordinator: Codex.

The initial reviewed commit `61860b0167c71f0773611ce145a6d56d86c5e1c4` passed the complete local Windows gate and focused independent review. Its first Linux CI run, `36963891667`, passed frontend tests/build and Rust formatting, then failed strict Rust lint with one error:

```text
src/backup.rs:8625:13: unused variable: active_row
```

The variable is inside the Unix-only `round4_linked_pending_root_must_not_move_external_data_unix` regression. Windows does not compile that function, so a green Windows lint result did not cover this branch. The test captured the active database row but did not use it in its preservation assertion or diagnostic.

## Focused correction

The assertion now requires `active_row.as_deref() == Some("original active row")` alongside original/external artifact preservation and a blocked startup decision. Its failure message includes the captured row. This consumes the variable and strengthens the regression; no warning is suppressed, test skipped or coverage weakened. No production behavior, migration, dependency, version, capability or release asset changes.

Corrected `src-tauri/src/backup.rs` SHA-256: `9788533DFD44FFDA8E1FEDE056C2774B22A82BF4F25FC8F78E017D6F78ACF1B7`. The acceptance note's EB4F hash remains the initial reviewed source; this test-only correction extends that review.

## Local verification and limits

- Rust formatting passes.
- Windows `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` exits 0; 28.85 s. Log: `restore-review-round8-ci-correction-clippy.log`.
- The analogous Windows linked-pending-root test passes: `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::round4_linked_pending_root_must_not_move_external_data -- --exact --nocapture`, exit 0; 1 passed, 0 failed; 0.56 s tests (3m compilation). Log: `restore-review-round8-ci-correction-linked-root-test.log`. This is Windows counterpart coverage, not execution of the corrected Unix-only function.
- The existing Ubuntu WSL distribution was inspected without installing software or starting test services. It lacks Cargo, rustc and pkg-config/desktop libraries. Full native Unix validation cannot be run locally in this environment; the corrected exact-head Linux CI gate remains required.

Evidence files are in `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`. The exact original failed-step log is saved as `restore-review-round8-linux-ci-failure.log`. No complete unchanged frontend matrix was repeated for this Unix-only test correction.

This is a justified runner-specific correction after inspecting the precise failure, not a speculative workflow rerun. One focused correction commit/push is allowed by the project's CI efficiency procedure. Merge still requires all required checks green on the new exact PR head and current `main`. Git/check outcome is recorded separately after that gate.

A1 shared-source acceptance does not establish installed Mac/Windows, live Gemini or native Unix power-loss behavior. A2–A6 and all release holds remain open.
