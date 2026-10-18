# File-bar layout evidence

Synthetic, isolated browser-layout checks of production file-bar JSX/CSS. `before-layout.json` and `after-layout.json` preserve all36 measurements; PNGs show the baseline and corrected640px view plus corrected320px/200% text. No application database/profile or document was accessed.

`layout-probe.cjs` uses the repository's existing React/esbuild and an externally available Playwright module/Chrome executable. From repository root, set OUTPUT_DIR to a **new disposable directory**, optionally PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE, then run `node docs/evidence/study-file-row-layout-2026-10-17/layout-probe.cjs after`. It extracts the actual production file-bar JSX at execution time. The `before` phase records the baseline even when checks fail; `after` exits nonzero on any layout failure. Baseline source is accepted main2fc27b9; a separate disposable checkout is needed to reproduce it.

The original developer run used the same probe from task-recovery with a fixed external output path; the checked-in copy changes only output/module/executable configuration for safe reproduction. `build.txt`/`build.exit` are raw production-web-build output/status. The focused component/typecheck results in the report are observed summaries, not additional raw logs. See SHA256SUMS and source-hashes.json for identities.
