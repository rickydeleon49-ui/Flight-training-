# P54-02 phase2: bounded extraction worker proof and search contract

Act as the assigned implementer. Continue the approved local-search evaluation, not production indexing. Work through this complete bounded package; routine implementation choices do not need another approval. Use the current roadmap and preservation rules, and stop for independent review when the package is complete. No dependency or engine is selected by phase1.

## First establish identity and ownership

Fetch and inspect actual current main, branch and dirty state. Read `docs/P54_02_SEARCH_EVALUATION_2026-10-16.md`, its evidence README/runtime/source and corpus hashes, the approved P54 queue in ROADMAP, CLAUDE.md and the development/review workflow. The phase1 source was main3266f193, after accepted formatted-guide PR191. Newer accepted source may exist: reconcile rather than revert.

M4/#189 and its Codex correction#194, and export/#193 and correction#195, remain separate. They require independent review of Codex's implementation before normal exact-head integration. Do not overwrite their work, self-accept it, or copy their unpublished source into this proof. The primary `/Users/rickymac/code/Flight-training-` has a protected `.claude/settings.json` edit. The Codex worktree `/Users/rickymac/code/Flight-training-post-v054-roadmap` may be on another task's branch; inspect first. Use an agreed isolated/reusable checkout, not a competing copy of active source. Never reset, stash or clean another agent's work. Preserve the dirty historical schema14 verification checkout and all earlier evidence.

## What phase1 established, and what it did not

Actual native SQLite has FTS5; committed sql.js WASM does not. They share the app's SQL schema, so adding an FTS5 virtual table to shared migrations would break browser mode. Native rusqlite and the Tauri SQL plugin link the same libsqlite3-sys version; verify again if dependencies changed.

The existing lopdf0.42.0 extracts simple per-physical-page text and returns none for the generated image-only page. However, a3,034-byte PDF yields1,000,023 text bytes before a caller can apply its proposed64KiB page output budget. `extract_text` does not prove pre-allocation bounds or interruption. Phase1 therefore explicitly did not approve in-process unrestricted extraction, an engine, or production search. Node/Cargo debug timings are exploratory, not native painted interaction. The measured MiniSearch whole-run peak includes serialization and a second loaded index; do not quote it as steady-state heap.

## Deliverable A: a disposable worker proof with honest bounds

Implement a standalone extraction-worker prototype using existing locked dependencies, generated fixtures and a task-owned scratch directory. Do not expose a production Tauri command or modify authoritative application storage/migrations. Prefer a worker boundary that can actually be terminated over merely discarding a late Promise. Demonstrate the chosen boundary rather than asserting `spawn_blocking` cancellation stops a running parser.

Define limits before running: input byte ceiling, page/output/total-result byte ceilings, IPC framing/message ceiling, elapsed-time deadline, maximum concurrent workers and maximum retained results. State exactly where each applies. Choose realistic exploratory values and document their rationale; they are not owner-approved production defaults. If a hard process memory cap cannot be reliably enforced on this macOS lane, report that limitation and provide bounded alternatives for review. Never label a post-allocation length check a hard memory bound.

Required behaviors:

- Caller verifies input ownership and content identity in disposable files; worker output identifies the exact bytes/hash and physical page. Printed page labels never become physical coordinates by inference.
- Parse generated text, reordered page objects, empty/image-only content and controlled malformed/truncated inputs. Include a compressed oversized-text control. Add a small licensed/public text-PDF fixture if needed, with exact provenance/hash/license; never read private PDFs/profiles as a convenient corpus. Complex-font/Unicode coverage must be explicit rather than inferred from Helvetica.
- Results distinguish checked text, no extractable text, refused limits, malformed/unreadable and cancelled. Do not claim an empty text result proves an image scan; OCR is outside scope.
- A superseded/cancelled request cannot publish a result or start downstream indexing. Stop and reap task-owned workers, close pipes/handles and remove only owned scratch. Do not claim cancellation reverses work already committed.
- Bound bytes while reading a worker response, including an oversized header/line or a worker emitting invalid UTF-8/malformed JSON. A child that stalls, exits unsuccessfully or emits no result must settle with a bounded failure. Error text must not include private content, credentials or unrelated paths.
- Replace a fixture at the same path while an old worker is held; its old hash/result must not be silently rebound to replacement bytes. Repeat with material/request changes and old success/error completions. Use deterministic gates for lifecycle races; use real timeout observation only for the deadline contract.
- Record real worker process identities and their exit/reaping outcomes for cancellation/deadline cases. No orphaned child, open mount or borrowed profile remains after a failure.

## Deliverable B: search semantics and cache adapter proposal

Write a concrete contract and prototype only where needed to test it, keeping derived indexes disposable. Do not add FTS5 to the shared schema or include derived search data in authoritative backups. Preserve existing title/filter/sort behavior while indexing is pending or unavailable. Define native-only FTS5 plus browser fallback versus a shared in-memory engine as alternatives with evidence; no dependency adoption without the owner's normal agreement.

Resolve these in the proposal and test the chosen prototype settings:

- Literal word/phrase behavior, punctuation and safely compiled queries; raw FTS syntax is not SQL parameterization alone. Explain prefix versus typo/fuzzy options without silently changing old search semantics.
- Accent folding: phase1 proves cafe finds café under default FTS5 but not default MiniSearch. Include Unicode/case examples and document the intentional choice. Assert result ids, not only counts.
- Bound query and result/excerpt sizes. Excerpts are plain text, not executable HTML. Native/page destinations carry the content hash and physical page needed by the accepted navigation contract; if that API is still unmerged, record the prerequisite rather than copying unpublished code.
- Index replacement, deletion, duplicate titles and hash invalidation. A result with an obsolete hash cannot be offered as a current destination. Demonstrate cancellation while an update is pending and replacement after extraction but before publication.
- Reopen/rebuild of a fresh derived cache, disposal on a synthetic restore/replacement and consistent recovery from interrupted index writes. These controls are not an installed backup/restore acceptance claim.

## Deliverable C: measurement plan and evidence

Pre-register phase2 responsiveness/indexing/memory targets and dataset/failure cases before measuring. Reuse the delivered deterministic100/1,000/10,000-material generators and add variation rather than treating repeated words as a realistic handbook corpus. Keep input loading, PDF extraction, cold indexing, persistence/reload, warm query, IPC, native painted interaction and whole-process memory separate.

Run a small validated fixture first, then the full comparison only when correctness/lifecycle cases pass. Do not run overlapping full test matrices or silently extend deadlines to get green results. No production speedup or native UI claim may come from server/Node timing. If actual native interaction needs a new isolation/launch authorization, leave that measurement explicitly pending and complete the independent standalone work; no everyday profile is available as a shortcut.

Phase1's exact MiniSearch7.2.0 MIT archive passed its SHA512, but this is evaluation only. Reuse its frozen metadata; execute no package scripts and change no application dependency/lock. If a different parser/engine/dependency is necessary, present one evidence-backed adoption choice for owner review rather than installing it into production. Keep third-party provenance/licenses and source hashes.

## Verify and hand off

Run meaningful focused worker/IPC/cache cases, check all delivered proof sources reproduce their receipts, and verify cleanup and source identity. If application files changed unexpectedly, stop and reconcile; this proof should not change them. For documentation/probe-only output use the existing lightweight exact-head CI path, and do not call it application feature acceptance. If an explicitly approved production change becomes necessary, use the full relevant type/build/frontend/Rust/strict-Clippy/fmt/lock/helper/migration checks and normal independent review before integration.

Deliver one concise report with the acceptance matrix, actual pass/fail exits, precise unresolved limits, reproduction commands, hashes and a complete evidence manifest. Keep failed receipts distinct; no suppressed rejections, guessed installed results, timeout inflation or OS-protection bypasses. Update ROADMAP/STATUS/handoff preserving history and only affected current helper bindings. Leave a checkpoint with branch/HEAD/current dirty state, current process status, completed gates and exact next action if interrupted.

Stop after the reviewable phase2 package. Do not call P54-02 complete until its production integration, realistic native measurements and approved engine/semantics gates actually pass. No app launch, real profile/key access, provider call, production migration, installer build, version bump, signing or release is part of this proof.
