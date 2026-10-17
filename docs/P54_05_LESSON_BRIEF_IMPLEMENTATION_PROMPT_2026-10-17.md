# Implement P54-05 PartA: the approved lesson brief

You are the implementer. The export review prerequisite is complete; proceed directly to **PartA** after confirming the integration is on origin/main. Do not repeat Phase1 of the old continuation or start calendar export yet. Codex independently reviews and merges your final work.

## Start and preserve

Fetch first. Confirm PR193's combined navigation/export integration and PR189's commits are on origin/main; verify `save_study_export`, the ExportKind and printable-handout conventions are actually present. Read `NAV_EXPORT_INTEGRATION_ACCEPTANCE_2026-10-17.md`, `P54_04_SAVE_ACCEPTANCE_2026-10-17.md`, `P54_05_SCOPE_APPROVAL_2026-10-17.md`, the approved scope, current ROADMAP/STATUS/handoff and project workflow.

Reuse an agreed clean checkout and branch from current accepted main. Inspect all tracked/untracked changes first. Preserve the primary `.claude/settings.json`, active worktrees and dirty historical schema14 package; do not reset, stash, clean or overwrite someone else's work. Do not create another clone without a concrete need. Read missing documents through origin/main rather than pulling over dirty work.

The owner approved both brief and calendar directions with the recorded defaults. Do not ask those same scope questions again. P54-02 production search, memory isolation and engine choices remain separate and are not part of this task.

## Deliver the complete useful brief

On a lesson's EventDetail, add a Lesson brief action and preview with save/print capability appropriate to the platform. The exported document contains:

1. The stored lesson title/type/date/time/location/instructor, with non-scheduled status visible.
2. `lessonPreparation()` checklist and Ask lines, preserving its named done/outstanding semantics and empty-state behavior; no invented readiness percentage.
3. Attached reading titles/types/topics, without material notes or paths. Accepted page labels may appear as plain text where the scope permits; exporting never opens a reader.
4. Optional individually chosen follow-ups from the most recent earlier journal's questionsForNextTime and eligible open questions for the lesson's goal. Nothing is selected automatically. Define deterministic eligibility, tie-break and duplicate rules; preserve source wording and show the origin clearly in the picker. Do not infer or generate new questions.

Selection state is dialog-only and resets when closed or the lesson context changes. The preview must show precisely what will be exported. Never include lesson notes, journal reflections/feedback, finance/medical/toolkit fields, file paths, material notes, settings, IDs or unselected follow-ups. Do not use an AI/provider or broad object serialization to construct the document.

## Reuse the accepted export contracts

Use P54-04's escaped, self-contained printable HTML/CSP conventions and the shared native save API with a bounded brief ExportKind. Reuse existing styling/helpers where that preserves the contract, without a large unrelated formatter refactor. No scripts, hyperlinks, remote assets or images in output. No new dependency, schema, persisted preference or background service.

Desktop saving goes through the existing native chooser and atomic writer. The frontend never chooses a filesystem path. Enforce extension/size/name/error contracts for the new kind. Freeze dispatched choices and take a synchronous lock before constructing output or opening a native dialog. Cover cancel, validation refusal, rejection and deliberate retry without duplicate writes or stale content. Keep a pending dialog nondismissible and do not let a late operation update a newly opened lesson/dialog context.

Browser mode offers only the preview/print capability it can really provide and clearly states unavailable desktop save. Printing/importing in a real installed app is not proved by source tests; do not launch it for this task.

## Meaningful acceptance tests

- Fixture sections, empty lists and done/outstanding labels match lessonPreparation exactly.
- Default selections are empty; only explicitly selected eligible follow-ups appear. Changing/closing the lesson dialog cannot carry another lesson's picks or late notifications into the new one.
- Unique excluded-field sentinels are absent from the HTML, including unticked questions, lesson/material notes, journal reflections, financial/medical fields and paths.
- Hostile markup, quotes, Unicode and long text are escaped/bounded, with the expected CSP and no external links/assets. Do not silently discard selected content to meet a limit.
- Save receives exactly the previewed content. Same-render duplicate dispatch, edits/close while pending, cancel, rejection/retry and oversized refusal have deterministic tests with held promises, not timing sleeps.
- Native brief-kind chooser metadata, filename/extension and limits reuse the accepted writer; previous packet/handout and failure-path tests remain valid.

Run focused checks first. Once ready, run the applicable sequential frontend/typecheck/build/native/strict-Clippy/fmt/lock/helper/hygiene gate once; broaden or repeat only for a real change/failure. Use Node22 and scoped SDK26.5 on this Mac if needed, without global toolchain changes. Test only synthetic/disposable data. Preserve all failed receipts separately and do not suppress errors or weaken assertions.

## Delivery and stopping point

Leave a source-review package: report with requirement-to-test mapping, exact commands/counts/exits, important choices/limitations, source identities and complete raw evidence. Verify manifest members from staged/committed Git blobs if publishing; force-add ignored logs and preserve their exact bytes. Update ROADMAP/STATUS/handoff without deleting prior history. Refresh only the current helper tracker bindings and their manifest checksum where necessary, then verify the helper.

Leave work reviewable for Codex; do not self-accept or merge. No calendar writer, search engine, migration, provider, profile/key, native launch, installer, signing or release work. PartB follows independent PartA acceptance under the already approved calendar choices.
