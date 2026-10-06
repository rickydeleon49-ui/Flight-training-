# Independent M2 PR2 correction review evidence

Review date: 5 October 2026 (Mac client date). Implementation base61031d4; dirty source preserved.

- `codex-pr2-rereview.test.ts`: executable source, placed temporarily at `src/pages/StudyLibrary/codex-pr2-rereview.test.ts` in the implementation clone, then removed. Original ten diagnostics plus eight new negative assertions; uses synthetic real disposable Node SQLite and deferred events.
- `frontend.txt`, `results.json`: final exact command and observed exit1; 84passed/8failed, zero unhandled errors. Ten original diagnostics and ten promoted copies pass; 64 existing UI/offline/persistence/startup cases pass. Eight new behavioral assertions fail. Earlier runs were diagnostic development with equivalent failures; final source/receipt is the authoritative run.
- `import-tests.txt`, `import-tests.exit`: separately implicated import tests, 21pass, exit0, zero unhandled errors. This does not repair the prior invalid full-run receipt or establish its cause.
- `source-hashes.json`: 26 reviewed repository-relative paths, checked against the submitted manifest before and after; `results.json` records source_unchanged=true. Root is the implementation clone, not this evidence directory.
- `submitted-diff.patch`, `submitted-new-source/`: tracked diff relative to base61031d4 plus three untracked source files. Snapshot only; do not apply over the working source. Existing modified panel/offline test files are in the tracked patch.
- `submitted-corrections/`: byte-preserved submitted report, README, source manifest and eight gate logs. Full npm log includes two unhandled DatabaseDisabledError rejections despite its report claiming success. Native390pass/6ignore and other submitted gates are reported receipts, not independently rerun native/full gates.
- `SHA256SUMS`: evidence-file hashes relative to this directory, excludes itself; separate from source hashes.

Run command and exit are in results.json/frontend.txt. Scoped PATH uses `/opt/homebrew/opt/node@22/bin` and Rust stable; SDKROOT points to MacOSX26.5.sdk. Temporary tests never access real profiles, provider APIs or installed application data.

Independent results are distinct from submitted logs. Accepted PR1 and previously verified backend erasure behavior are preserved. Source remains uncommitted/unpushed; review documents alone are being published. See the accompanying review and model-neutral finishing prompt for exact correction work.

Scoped evidence attributes preserve original raw logs, patch context blank lines and submitted Markdown hard breaks byte-for-byte. Source and authored documentation whitespace checks remain enabled.
