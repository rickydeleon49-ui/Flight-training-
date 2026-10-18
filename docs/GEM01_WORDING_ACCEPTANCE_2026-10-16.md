# GEM-01 Settings fallback wording — accepted 16 October 2026

**Accepted and merged:** [PR #184](https://github.com/rickydeleon49-ui/Flight-training-/pull/184), commit `4a8a92feb3c09558cdddeafd8cf1cbaa71383762`. No defects found in the two-file wording/test change.

The Settings note now matches the actual `generate_with_retries`, `moves_straight_to_fallback` and `describe_refusal` paths in `src-tauri/src/gemini.rs`: Argon429 moves to Flash, exhausted transient capacity failures can try Flash, and403 returns an access/billing message pointing to Standard. This closes the wording observation from the bounded retrospective review. It changes no request routing, retry policy, model choice, storage, dependency or version.

**Independent local verification:** Settings model tests3/3, typecheck, frontend build and diff hygiene all exit0 on Node22.23.3. The existing test now asserts both fallback and access-refusal wording. No new mirrored test suite was added.

**Exact-head CI:** [38954548743](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38954548743) succeeded on reviewed head `dbb85893a06339118402aabd8862d4b546a17e38`. Its checkout log identifies tested merge `22eedff714408db2d366038902698d34671104a9`, whose parents are then-current main `671c9f47f5c9f7799466750dd7aa00f26a287096` and the reviewed head. Thus CI already tested this change with current main; updating the branch and rerunning the same full matrix was unnecessary. Merge used the normal protected workflow with exact head matching, no administrative bypass.

CI results:3,252 frontend passed /6 skipped;474 Rust passed /6 ignored on Linux;26 schema-helper tests; build/typecheck, formatting, strict Clippy and lock synchronization successful. These full-matrix results are CI evidence, not additional reviewer-local Rust or installed tests.

**Reviewed and merged source SHA-256:**

- `src/pages/Settings/Settings.tsx`: `aadcf2f08f65d51a70c50c7cc4f5889c8fffd65c7587dea1210e14bbfb044f60`
- `src/pages/Settings/SettingsGeminiModel.test.ts`: `c63d44a3941b84cf14cf99b71bc956f3b88252e45d4ba70c7ee251e889dec08a`

[GitHub review comment](https://github.com/rickydeleon49-ui/Flight-training-/pull/184#issuecomment-6223322139).

**Scope remaining:** the separate model-budget/timeout evaluation remains open; this text correction does not claim paid-provider testing or address those settings. M4 R37–R39 stays under `M4_ROUND5_CORRECTIONS_PROMPT_2026-10-16.md`; OPENFOLDER-01 remains separate. The eight-item post-release roadmap order is unchanged. No desktop launch, native installer build, profile/key access, provider call, signing or release publication occurred during this review.
