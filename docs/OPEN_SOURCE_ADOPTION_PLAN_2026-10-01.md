# Her Flight Deck: cautious open-source adoption plan

Prepared October 1, 2026. Repository: <https://github.com/rickydeleon49-ui/Flight-training->.

## User decision and scope

Finish the current task before adding selected components from the open-source research. Preserve the existing app, data, and workflows. Every adopted component must have a concrete purpose and meaningful verification.

Adding a feature requires some code to connect it to the app. Interpret "won't change our current code" as small, isolated additions with minimal integration, rather than a promise of zero edits. Do not replace the database, backup format, Rust document service, framework, existing Gemini workflow, or desktop architecture merely to adopt a library. Do not install every candidate from the research.

The companion [research report](OPEN_SOURCE_REUSE_RESEARCH_2026-10-01.md) records qualifying repositories, star snapshots, licenses, compatibility constraints, and primary-source evidence. Those findings are research, not proof that a component works inside this app.

Shared handoff update (2 October): see [the project handoff](PROJECT_HANDOFF.md), [A2 second-review corrections](A2_SECOND_REVIEW_2026-10-02.md) and [Mac continuation prompt](OPEN_SOURCE_MAC_HANDOFF.md). The [physical Mac report in draft PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44) records source/packaging evidence, with installed-app checks still pending. No proposed library has been adopted by this plan.

## First gate: finish A2

At the October 1 planning snapshot, the observed branch was `fix/atomic-study-material-saves`. It has uncommitted changes and an implementation report at `docs/ATOMIC_STUDY_MATERIAL_SAVES_2026-10-02.md`. Reported passing tests still require independent review; this plan does not accept or commit that implementation.

1. Obtain a stable implementation handoff. Avoid concurrent edits to the implementer's branch.
2. Independently review atomic metadata/tag saves, partial-update semantics, imported-file ownership, Cancel, post-commit refresh failures, reference-safe native cleanup, and compatibility across the database drivers.
3. Verify meaningful rollback and concurrency tests against real SQLite; preserve restore-retention and splitting behavior. Resolve review findings before pushing.
4. Follow the project's local-first verification and Git workflow. Complete the local gate, push reviewed work once, wait for required checks on the exact PR head, and merge only when accepted.
5. Start the next scoped branch from updated `main`. Carry remaining audit blockers forward explicitly; do not treat a green A2 suite as completion of the whole release audit.

No new package adoption should be mixed into A2. Current release holds and existing versions/tags remain unchanged.

## Adoption sequence

### 1. Measure the Study Library before selecting a performance dependency

Use synthetic libraries of 100, 1,000, and 10,000 materials with realistic titles, tags, notes, and missing-file cases. The current progressive display already limits initially shown items; establish whether search, filtering, database reads, or rendering is actually slow.

Record hardware, OS, exact commit, dataset sizes, build mode, repeated timings, memory, and production bundle size. Separate time to load records, search/filter/sort time, time to a usable view, and typing responsiveness. Define the acceptance target before comparing a candidate. No code-inspection-only speedup claims.

This task can produce fixtures and benchmarks without adopting a production dependency. If the baseline is satisfactory, leave that area alone.

### 2. Pilot MiniSearch only if search is a measured bottleneck

Candidate: <https://github.com/lucaong/minisearch> (MIT).

Keep the index derived from existing records. It must not become an authoritative database or a required backup artifact. Put indexing behind a small adapter and preserve the current search semantics unless an intentional product change is separately agreed. Account for index construction and memory, not only query speed.

Required tests: exact/prefix/fuzzy behavior as selected; tags and Unicode; empty queries; filter and sort interaction; edits, deletes and duplicate titles; restore-triggered index rebuild; stale asynchronous results; missing-file records; keyboard use. Compare the same baseline fixtures and include cold-start cost. Reject the adoption if latency, memory, or bundle tradeoffs do not justify it.

Do not install FlexSearch alongside MiniSearch without a separate demonstrated need.

### 3. Pilot TanStack Virtual only if list rendering is a separate bottleneck

Candidate: <https://github.com/TanStack/virtual> (MIT).

Preserve browsing, filters, current progressive-loading behavior, selection, focus, keyboard navigation, and usable scrolling. Keep integration inside the list component. Dynamic row sizes, expanded content, and screen-reader behavior need deliberate handling.

Required tests: filter/sort changes while scrolled; selection after rows leave the viewport; focus restoration; variable row heights; empty results; resize; and large-library scrolling/typing measurements. Verify the actual desktop webviews. Use one virtualization library, and adopt none if the existing approach meets the target.

### 4. Follow M2's durable study-history work before adding scheduling

Keep stable question/content identities, attempt history, and backup round trips ahead of FSRS integration. Candidate algorithm reference: <https://github.com/open-spaced-repetition/fsrs4anki> (MIT); it is Anki-oriented, not a drop-in TypeScript package.

Scheduling is a later feature with explicit data requirements, not a harmless dependency installation. Review the exact algorithm/version and its license, isolate pure scheduling logic, and use deterministic reference cases. Test time boundaries, overdue reviews, repeated submissions, undo, content regeneration, failed persistence, and backup/restore without overwriting older attempts.

### 5. Add the planned outside-AI study import as an isolated flow

Candidates: <https://github.com/colinhacks/zod> (MIT) for new structured-input validation and <https://github.com/remarkjs/react-markdown> (MIT) for guide display. Use either only if it simplifies the accepted implementation plan; do not rewrite all existing validation or rendering.

Let the user explicitly select a local exported study file, validate it, preview it, and confirm the import. Keep Gemini generation available. Plain study-guide prose alone does not automatically supply a reliable offline practice test: require validated structured questions/answers for that flow, or a separate explicit generation action.

Required tests: supported/unsupported schema versions; malformed JSON; bounded size and nesting; Unicode; duplicate or missing question IDs; invalid answer keys; malicious HTML, URLs and script payloads; cancellation; failed save and rollback; preservation of previous study content; reopening; and backup/restore. No imported JavaScript or MDX execution, automatic provider upload, or credential capture. Do not add raw HTML rendering by default.

### 6. Evaluate embedded PDF reading after the foundation and M2 work

Candidate: <https://github.com/embedpdf/embed-pdf-viewer>. Select only its Apache-2.0 SDK components after inspecting the exact chosen version and dependencies. The repository includes differently licensed server components; its cloud/server stack is outside this plan.

Keep the existing native Open action available. Bundle needed worker/WASM/assets locally. Test offline loading, app-owned file access, text and image-heavy PDFs, large files, malformed PDFs, page order, rotation, search, memory, cancellation, and worker cleanup. Do not replace the Rust splitter as a side effect of adding a reader.

Actual installed Apple Silicon testing at the declared minimum OS is a prerequisite for a Mac compatibility claim. A browser demo, Windows success, or macOS CI package is insufficient.

## Safari 18: installation versus runtime compatibility

Users do not need to launch Safari or download through Safari to install Her Flight Deck. The Mac desktop app uses macOS's built-in WKWebView/WebKit inside its own window, according to [Tauri's documentation](https://v2.tauri.app/reference/webview-versions/).

The inspected [React-PDF README](https://github.com/wojtekmaj/react-pdf#compatibility) lists Safari 18 as a supported-browser minimum. This is a constraint of a proposed reader, not a newly introduced requirement for the existing Her Flight Deck installer. The exact published version selected later must be inspected separately from the upstream default branch.

[Apple's Safari 18 release information](https://support.apple.com/en-us/121241) lists Ventura and Sonoma for that update, rather than Monterey/macOS 12. Therefore a Safari-18-dependent reader cannot be assumed compatible with our macOS 12 promise. The app uses the installed system WebKit, and actual WKWebView testing remains necessary even on a newer Mac. Opening Chrome does not change the desktop app's embedded engine.

Preserve the declared macOS minimum unless the user deliberately changes the support policy. Prefer a compatible component or retain the native-viewer path if a new reader cannot meet it. Do not assume that switching to a legacy PDF.js worker or adding polyfills proves older-WebKit support.

## Rules for every implementation task

- Adopt one justified change at a time in a scoped branch after the current work is accepted. Keep existing behavior covered by regression tests and make rollback of the feature practical.
- Inspect the exact package/files and transitive dependencies. Pin through the normal lockfiles and preserve required licenses, copyright, NOTICE material, upstream version/commit, and provenance for adapted code.
- Run focused tests during development. Test real persistence and failure paths where the change touches user data. Use deterministic fixtures, not retries that conceal failures.
- After corrections, run the complete required local matrix once: `npm ci`, `npm test`, `npm run build`, `npm run test:cargo-lock`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, and `git diff --check`. Include additional current project-required checks and platform-specific checks for the touched area.
- Do not run concurrent full verification matrices or duplicate background test processes. Record exact commands, exit results, counts, commit/diff identity, and log locations for review.
- Preserve backup v2 integrity, v1 restore compatibility, shipped migrations, document ownership, bounded database retries, Windows behavior, `com.herflightdeck.app`, and explicit Gemini submission. Keep keys out of webview responses, logs, and archives.
- Update `STATUS.md`, the task implementation note, and `docs/MAC_PARITY_CHECKLIST.md` for relevant Mac effects once working in the repository. Clearly separate proven results from pending installed-app or live-provider checks.
- Follow Codex's independent review and Git ownership workflow; use CI as the final confirmation gate. Do not publish or retag a release as part of adoption.

## Status of this plan

Planning only, now tracked in the shared GitHub repository so either machine can continue without the original Windows workspace. No production library has been installed or copied by this plan, and no performance or compatibility improvement is claimed. Adopt only after the foundation gates, independent review, and relevant M2 user check-in; reconcile with [ROADMAP.md](../ROADMAP.md), [M2 design](M2_STUDY_LIBRARY_DESIGN_2026-09-27.md) and the [saved-guide feature brief](STUDY_GUIDE_TO_TEST_FEATURE_BRIEF_2026-09-29.md).
