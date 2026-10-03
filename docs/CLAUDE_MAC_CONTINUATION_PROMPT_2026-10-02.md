# Claude continuation prompt — Mac Study Library baseline

Current follow-up: [R1–R3 baseline corrections accepted](MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md). This document preserves the earlier assignment/review snapshot; [the next Claude prompt is A3 compatibility](CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md), after the publication PR merges.

Owner assignment: Claude implements locally on this Mac; Codex independently reviews and coordinates Git. Gemini handles security work only if separately assigned. The owner confirmed the Mac clone as the next task's location on 2 October 2026.

Copy the following prompt into Claude:

---

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-`, repository `https://github.com/rickydeleon49-ui/Flight-training-`. Your task is to produce a trustworthy Study Library performance baseline and a concrete next implementation recommendation under our agreed open-source adoption plan. Complete this bounded task, leave changes uncommitted for Codex, and stop for independent review.

## Establish the current state

The owner subsequently confirmed the main user will run the app on the Mac. Read `docs/MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md`. Complete this already-assigned bounded baseline without expanding its implementation scope. Your next-task recommendation must prioritize bringing accepted A2 source here, A3/A4/A6 and installed Mac readiness before optional production dependencies. Preserve other agents' work and the review gates.

1. Record the repository path, machine, branch, exact HEAD/base, dirty-file list and current PRs. Fetch GitHub; inspect before switching branches. Preserve any other agent's work. Reuse this clone; do not reset, stash, force-push, create another checkout, or edit an occupied branch to make it match yours.
2. Latest main observed when this prompt was prepared was `a4339fc`, merging PR #45's shared research/handoffs. Recheck current main rather than treating this historical SHA as fixed. The Mac report and this prompt are on `codex/mac-source-evaluation-report`, draft PR #44; if not merged, read them there before starting your implementation branch from updated `origin/main`. Do not implement on the report branch. Use a scoped branch such as `codex/mac-study-library-baseline` only after confirming the checkout is clean and the branch is unoccupied.
3. Read `docs/PROJECT_HANDOFF.md`, `STATUS.md`, `ROADMAP.md`, `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md`, `docs/OPEN_SOURCE_REUSE_RESEARCH_2026-10-01.md`, `docs/OPEN_SOURCE_MAC_HANDOFF.md`, `docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md`, `docs/FULL_REPOSITORY_AUDIT_2026-09-29.md`, `docs/MAC_SMOKE_RESULTS_2026-10-02.md`, and `docs/templates/TASK_HANDOFF_TEMPLATE.md`.
4. A1 is merged. A2 R6/R7 belongs to the existing Windows implementer and remains uncommitted there; its code is absent from main. Do not reproduce, port or replace that work from its review summary. Recheck acceptance/ownership before proceeding if it has since landed. Safe synthetic source measurements may proceed while its owner finishes corrections; production dependency adoption must wait for A2 acceptance and the relevant foundation gates.

## Implement only the measurement task

Inspect `src/perf/appResponsiveness.bench.test.ts` and the actual Study Library search, filters, sort and progressive rendering. Reuse the existing benchmark and database migrations where they are suitable. Keep changes confined to benchmark/fixture code and documentation; do not optimize production components, change database drivers, or install a package in this task.

The existing benchmark has 100/1,000/5,000-material tiers and five repeats. It runs the real React pages and provider over Node SQLite in jsdom. It measures JavaScript/React/SQLite work, not WKWebView paint, Tauri IPC or packaged startup. Its current `airspa` search matches none of the seeded titles/notes; it seeds no material tags or file-status cases. It reports process heap at the end of a tier, not peak app memory. Correct these coverage gaps before using the results to recommend a dependency.

Build deterministic synthetic scenarios covering empty, matching, narrowing and no-match queries; Unicode; duplicate titles; varied tags/notes; filters and sort together; and missing-file records. Verify expected result IDs/counts and ordering independently so faster incorrect results cannot pass. Keep file-status mocks labeled and separate from actual filesystem evidence. Retain existing tiers and identify an additional 10,000-material stress tier explicitly. Avoid quadratic or unrelated seed work that dominates the operation being measured.

The current seed issues public `BEGIN`/`COMMIT`. Accepted A2 drivers are expected to reject public transaction-control SQL. If A2 lands before your run, use its supported fixture/transaction contract; do not weaken the ownership guard, expose raw production handles, or change the production driver merely to seed a benchmark.

Record five fixed repeats with raw samples, median, min/max and sample count. State warm-up, reset/cache conditions and workload. Separate database load, index-free search/filter/sort, React work, mutation/refresh and navigation. Capture query/write counts, source and fixture identity, Node process heap/RSS with the sampling method, and production JS/gzip size from the existing build. Do not call Node RSS packaged-app memory or call React timings painted-frame latency. Inspect whether sort iterations really change the selected sort option.

Use only disposable SQLite fixtures and temporary synthetic files. Close databases, unmount components and restore mocks/timers even on failure. Do not touch the owner's app profile. No dedicated standard test account is available yet, and the evaluation DMG's command-line Gatekeeper assessment failed; installed WKWebView typing, focus, scrolling, launch and peak memory remain unavailable. Do not launch the app in the owner's account, bypass Gatekeeper, clear quarantine, alter signing, or fabricate installed evidence.

## Toolchain and execution

This Mac was recorded as Apple M5 / 32 GB / macOS 26.6. Recheck identity. Use Node 22 through a scoped PATH; do not alter the global Node or shell configuration. Installed Rust tools are under `/opt/homebrew/opt/rustup/bin`. For native checks, the default SDK 27 failed with the installed linker; explicit `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` passed. Confirm that directory still exists before using it.

After inspecting/fixing the harness, run its opt-in workload once with the fixed repeats, saving evidence outside tracked artifacts:

```bash
mkdir -p .smoke/mac-study-baseline
PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH HFD_BENCH=1 HFD_BENCH_OUT=.smoke/mac-study-baseline/results.json npx --no-install vitest run src/perf/appResponsiveness.bench.test.ts
```

Run focused correctness checks while developing. Diagnose failures locally; do not overlap full matrices or rerun unchanged suites to conceal a failure. If maintained harness code changes, complete one sequential final local gate after focused corrections: `npm ci`; `npm test`; `npm run build`; `cargo fmt --manifest-path src-tauri/Cargo.toml --check`; `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`; `cargo test --locked --manifest-path src-tauri/Cargo.toml`; `npm run test:cargo-lock`; `git diff --check`. Use the scoped combined PATH and compatible SDK as needed. A documentation-only result needs appropriate documentation checks rather than another complete unchanged matrix. No PostgreSQL service or container is needed for this SQLite application. No new DMG build is needed for this baseline.

## Open-source decision and roadmap continuation

Compare measurements with explicit acceptance targets agreed before any future prototype. Make a go/no-go recommendation for one bottleneck, with tradeoffs and missing evidence. If the baseline is satisfactory or installed evidence is insufficient, recommend no adoption yet. Never claim a speedup without an equivalent-workload before/after comparison.

Preserve the agreed sequence:

- Complete/review A2 and remaining foundation corrections, including A3 minimum-macOS compatibility, A4 saved-study visibility offline, and A6 truthful retry messaging. Reconcile dated A5/test-kit findings against fixes already merged rather than reopening resolved work.
- Consider MiniSearch only for measured search cost, or TanStack Virtual only for measured rendering cost; choose one focused pilot per review. These are conditional candidates, not instructions to install both.
- M2 durable content identities, attempts and review history require the real-user M1 check-in and a scoped implementation decision before migrations/UI. Start with the documented versioned interval scheduler; FSRS/Obsidian are later references after stable history, licensing and equivalence review.
- Outside-assistant structured import may evaluate Zod/react-markdown once its contract is approved. Require explicit selection, validation, preview, confirmation, provenance, bounded inputs and safe rollback. Keep raw HTML/MDX execution disabled. Imported guide prose alone is not an offline question/answer dataset. This differs from the separate saved-guide-to-Gemini-test brief.
- EmbedPDF SDK is a later M4 candidate after exact SDK/worker/WASM licenses, offline assets and actual macOS 12 WebKit review; retain native PDF Open and the Rust splitter. No iOS work here.

Before a later task copies upstream code or adopts a package, verify the exact release/commit, source-file and dependency licenses, maintenance/advisories, React 19 compatibility, notices/provenance and oldest supported WebKit. Treat October 1 star/license/peer observations as historical. Keep SQLite, current backup v3 integrity plus v1/v2 restore compatibility, shipped migrations, app-owned files, bundle identifier, macOS 12 support policy and explicit Gemini submission intact.

## Deliver and stop for review

Save `docs/MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md` (use the actual run date if different) with the task template's identity/ownership fields, changes, per-scenario results, correctness checks, measurements, candidate decision, exact commands/exit codes/counts, sanitized evidence and remaining limits. Share sufficient sanitized samples/receipts for another machine to review; do not leave the conclusion dependent only on inaccessible local logs. Update the shared handoff, STATUS and Mac tracker accurately. Preserve the original Mac report's tested source/artifact identity.

Provide a copy-ready prompt for the next bounded source correction or measured prototype, stating its prerequisites and acceptance criteria. Include exact dirty files and final hashes so Codex can match tested code. Leave implementation and documentation uncommitted and unpushed. Codex owns independent review, reviewed commit/push/PR/CI/merge. Do not publish releases, replace frozen candidate assets, bump versions or close installed/M2 gates. Do not start the recommended next task until this handoff has been reviewed.
