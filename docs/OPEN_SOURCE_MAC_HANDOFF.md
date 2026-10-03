# Open-source continuation handoff for the Mac

Prepared 2 October 2026. Planning and research only; no new package or upstream code has been adopted. All material needed to continue is in GitHub, without Windows-local files.

## Shared research and decisions

- [Research report](OPEN_SOURCE_REUSE_RESEARCH_2026-10-01.md): ranked/conditional candidates, primary repository/license links, fit and rejection reasons.
- [Historical evidence snapshot](research/OPEN_SOURCE_SNAPSHOT_2026-10-01.json): eight queries, 170 screened repositories, 21 shortlist threshold receipts, inspected peer ranges/license paths and original evidence hashes.
- [Adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md): sequence, integration boundaries and required tests.
- [Saved guide → test brief](STUDY_GUIDE_TO_TEST_FEATURE_BRIEF_2026-09-29.md): the separate Gemini-from-saved-guide proposal. Offline outside-assistant JSON import has different data requirements.
- [Project handoff](PROJECT_HANDOFF.md): task ownership, current blockers and cross-machine workflow.

All shortlisted repos met the user's **at least 1,000-star** requirement at the October 1 snapshot. The larger metadata inventory is not a source or security audit. Stars do not prove correctness or license compatibility. Do not treat a default-branch package version as the selected published release.

| Candidate / upstream | Intended use | Gate before implementation |
| --- | --- | --- |
| [MiniSearch](https://github.com/lucaong/minisearch) — MIT | Optional derived offline search index | Demonstrate current search bottleneck; test updates/delete/restore, Unicode and index memory. |
| [TanStack Virtual](https://github.com/TanStack/virtual) — MIT | Optional Study Library row windowing | Demonstrate rendering bottleneck over existing 100-card display; test focus, variable heights, selection and accessibility. |
| [Zod](https://github.com/colinhacks/zod) and [react-markdown](https://github.com/remarkjs/react-markdown) — MIT | Bounded structured study import / guide display | Approved import contract; explicit preview/confirmation, answer-key validation, rollback and malicious-content tests. Preserve Gemini. |
| [FSRS4Anki](https://github.com/open-spaced-repetition/fsrs4anki) / [Obsidian Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) — MIT | Isolated algorithm/parser/UX references | M2 user check-in, durable content/history and tested versioned scheduling contracts first. Respect M2's simpler initial scheduler proposal. |
| [qpdf](https://github.com/qpdf/qpdf) — Apache-2.0 | Independent developer PDF QA | Use as a comparison/check tool first; no bundled C++ sidecar without separate justification. |
| [lopdf](https://github.com/J-F-Liu/lopdf) — MIT | Existing Rust PDF engine | Already used; measure and preserve equivalent pages/resources before changing it. |
| [EmbedPDF SDK](https://github.com/embedpdf/embed-pdf-viewer) — checked Apache-2.0 SDK boundary | Later optional embedded viewer | Review exact package/WASM/worker licenses and macOS 12 WebKit. Exclude its separately licensed server stack. Keep native Open. |
| [Radix Primitives](https://github.com/radix-ui/primitives) — MIT | Small accessibility repair | Reproduce a specific focus/keyboard defect; avoid replacing every dialog. |
| [GRDB.swift](https://github.com/groue/GRDB.swift) — MIT | Possible separate Swift iOS client | Separate architecture decision; do not replace desktop storage or start iOS here. |

FlexSearch/react-window are alternatives, not extra dependencies to install alongside the chosen search/windowing tool. Readest/Joplin and other mixed or reciprocal-license apps are references with component-level license obligations; do not copy their application wholesale. Exact licensing/provenance must be reviewed before copying any file.

## What the Mac can do next

Finish the existing source/installed evidence gaps and foundation corrections before production adoption. The report in [draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44) records source tests and a local arm64 build, not an installed smoke-test pass. Its SDK and signing findings must remain visible. A2 R6/R7 is still local on Windows; follow its assigned owner and acceptance gate. A3 early macOS 12 compatibility remains relevant even though the reported Mac runs a newer OS.

The first reuse task is **measurement and a go/no-go decision**, using non-sensitive data. Existing benchmark `src/perf/appResponsiveness.bench.test.ts` has 100/1,000/5,000-material tiers and five repeats; it measures React/Node SQLite work in jsdom, **not WKWebView paint, Tauri IPC or installed startup**. Reuse it where appropriate and identify a 10,000-item stress fixture separately if required; do not silently claim the existing suite includes that tier.

Run the existing opt-in benchmark from the repo root only after checking the current driver/seed implementation and prerequisites:

```bash
HFD_BENCH=1 HFD_BENCH_OUT=mac-study-baseline.json npx vitest run src/perf/appResponsiveness.bench.test.ts
```

Record source SHA, hardware/OS/toolchain, dataset, build mode, repeats/distribution, database reads/writes, memory and bundle size. Keep benchmark timing domains separate. Actual installed WKWebView search/typing/focus/scroll measurements require the isolated-account launch gate; report them unavailable rather than using jsdom timings as a substitute.

If no significant bottleneck is found, adopt no performance dependency. If one is verified, select one narrow candidate and agree measurable acceptance limits before comparing it. Do not mix search, virtualization, scheduler and PDF replacement into one PR.

## Copyable prompt for the Mac agent

Continue Her Flight Deck's open-source preparation using https://github.com/rickydeleon49-ui/Flight-training-. Work from updated main in this Mac's own clone; there is no required Windows drive path. Read `docs/PROJECT_HANDOFF.md`, STATUS, ROADMAP, the research report, evidence snapshot, adoption plan, M2 design and current Mac report/PR before editing.

Your first task is a bounded Study Library baseline and next-implementation recommendation, not installing libraries. Confirm A2/foundation status and ownership. If the existing Mac installed-test/account/signing gate is not satisfied, complete only safe source-level measurements and state that installed WebKit/UI coverage is unavailable. Do not repeat already passing unchanged full matrices just because a new machine is being used.

Inspect the existing 100/1,000/5,000-material benchmark and its measurement domain. Generate only synthetic data. Use a documented 10,000-item stress tier if justified, without rewriting the app's production data flow. Measure search/filter/sort, list/render work, DB calls, navigation, bundle size and memory. Establish baseline variability and acceptance limits before a prototype. Label Node/jsdom results separately from real packaged WKWebView responsiveness and startup.

Compare existing progressive rendering and search with one candidate only if a concrete bottleneck is demonstrated. Do not change the framework, SQLite driver, backup format, Rust document engine, Gemini provider/key boundary, identifiers or minimum supported OS. No M2 migration/scheduler product UI before the required real-user check-in and scoped approval. Keep outside-assistant import separate from saved-guide Gemini generation and from arbitrary prose-to-test assumptions.

For any future prototype, inspect/pin its exact upstream version/commit, license and transitive dependencies; preserve required notices and provenance. Keep raw HTML/MDX execution disabled, submission explicit and limited to the selected file. Preserve native PDF Open and app-owned storage. Current React-PDF/PDF.js browser requirements from the research do not prove macOS 12 support; re-check the selected version and test actual WKWebView.

Test every substantive change: meaningful focused regressions during development; equivalent-output/failure/rollback tests for persistence or PDF changes; stable benchmark comparisons for any speed claim; keyboard and accessibility tests for UI changes. Once all corrections pass, run one sequential complete required local matrix, record exact commands/results, review final diff and leave source uncommitted for the independent reviewer. Do not push failing source to explore CI.

Save the baseline report, candidate go/no-go decision and next detailed implementation prompt under docs using `docs/templates/TASK_HANDOFF_TEMPLATE.md`. Include source/machine identity, whether code is actually on GitHub or local, sanitized evidence/receipt paths, limits and current owner. Link them from STATUS and the shared handoff. Do not upload real data, secrets, installers, dependency trees or generated large PDFs. Do not publish, retag or replace a release candidate.
