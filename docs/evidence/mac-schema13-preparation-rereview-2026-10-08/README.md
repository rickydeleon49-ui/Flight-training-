# Mac schema-13 preparation independent re-review

MACV-R3 closed; R4–R6 corrections required. G1–G3 remain unverified.

`submitted/` freezes all 28 dirty input paths. The helper remains here as an unaccepted submission; this PR does not add it to shipping scripts. `submitted-hashes.json` binds exact bytes. The 22-entry original correction manifest is retained unchanged, including both ignored rebundle logs.

`diagnostics.mjs` extracts the real helper into a scratch module by adding exports/removing CLI dispatch only. It uses controlled child-process inspection results and a task-owned scratch DB. No app process is spawned or real profile used. Node22.23.3: three positive controls pass, seven assertions fail, exit1. `receipts/diagnostics.json` retains assertions; `checks.json` records commands/cwd/exits. Self-check eight cases passes exit0 despite process-inspection errors in stderr, establishing the missing fail-closed coverage. The diagnostic's purpose hints describe intended gate contracts and are ignored by the submitted comparator.

`receipts/packages/` holds independent read-only mount/signature/architecture/identifier checks and matching hashes for both corrected candidates; every strict check exits0, mounts detached. `inspect-adhoc-packages.py` records that exact procedure. No install, launch, signature repair, rebundle or application matrix rerun occurred in this review.

Current review and active assignment are in `docs/MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md` and `docs/MAC_SCHEMA13_HELPER_CORRECTIONS_PROMPT_2026-10-08.md`. Raw input and command-output whitespace is narrowly exempted only for the relevant receipts. Production/source acceptance is preserved.
