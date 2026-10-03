# Slice A interruption review evidence

Supports the [interruption review](../../STRUCTURED_STUDY_IMPORT_SLICE_A_INTERRUPTION_REVIEW_2026-10-03.md).

- [Starting hashes](starting-hashes.txt): all 81 local source-submission files before Codex's read-only review; SHA-256 `4fc0cccc759615021d92837d4d6a00dd725c88e6273ec7b5bca6abe00f101d63`.
- [Claude scratch mutation runner](claude-run-slice-a-mutations.mjs.txt): copied verbatim, inert extension; setup omits the lockfile and notice required by selected tests. Not an accepted runner.
- [Claude failed mutation results](claude-mutation-results.json): copied verbatim; all 22 rows contain two unrelated notice failures, with three unexpected classifications. Not Codex-run mutation evidence.
- [Codex focused-check receipt](codex-focused-checks.txt): 241 frontend and 16 Rust tests passed; typecheck passed. Full gates remain delegated to Gemini.

The source remains local/uncommitted. This evidence publication contains no source implementation or source acceptance. No real app profile, database, installed app or live provider check was performed.
