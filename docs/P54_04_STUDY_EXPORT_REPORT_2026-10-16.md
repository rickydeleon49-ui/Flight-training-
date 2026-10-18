# P54-04 selective study export and printable handouts — implementation report — 16 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW. No self-merge.** Branch `claude/p54-04-study-export`, **stacked on `claude/p54-03-formatted-guides` (PR #191)** because the handout reuses P54-03's guide formatter. Review #191 first; this PR's own diff is the commit(s) after `5f06d97`.

## Queue position

P54-01 → **P54-03 (PR #191, in review)** → **P54-04 (this)** → P54-02 → P54-05 → P54-06 → P54-07 → P54-08. P54-01's first slice (#189) is in review and its later substeps depend on it. Order unchanged.

## What she can do

On a material with a study aid, **Share or print** opens one dialog:

- **Include:** study guide, flashcards and/or practice questions (whichever the material has).
- **Save as:**
  - **Printable handout (.html):** one self-contained page to open in any browser and print or save as PDF. The guide keeps its formatting; flashcards print as a two-column sheet; questions are lettered; an optional **answer key** starts on its own page.
  - **Study packet (.json):** the existing `hfd-study-packet` version 1 format, importable as a new material by any copy of the app. A packet always carries answers, so it can be practised after import.
- The native save dialog chooses the location. Nothing in her library changes.

## What changed

| Path | Change |
| --- | --- |
| `src/logic/studyExport.ts` | Builds the packet for the chosen parts, runs it through the **import's own validator**, and checks that what an import would save equals what she chose (after the format's documented whitespace normalization). Refuses an empty choice, credential-like text, over-limit content and anything else the format can't hold, with plain messages. |
| `src/logic/studyHandout.ts` | Builds the handout HTML. Every text value is escaped; the guide uses P54-03's formatter; CSP `default-src 'none'; style-src 'unsafe-inline'`; print styles with page margins and an answer-key page break. |
| `src-tauri/src/study_export.rs` | New `save_study_export` command: size bound (packet 4 MiB = import limit; handout 8 MiB) checked before any dialog; native save dialog with a cleaned suggested name; **all-or-nothing write** (temporary file in the same folder, `sync_all`, rename, best-effort directory sync; the temporary file is removed on any failure); refuses a folder or symlink at the chosen name; fixed error codes with no path. |
| `src-tauri/src/lib.rs` | Registers the command. Capabilities unchanged (the dialog is opened natively, like `pick_study_packet`). |
| `src/services/studyExport.ts` | Webview wrapper: desktop-only, `null` on cancel, fixed error mapping; sends kind, suggested name and text, never a path. |
| `src/pages/StudyLibrary/ExportStudyDialog.tsx`, `MaterialDetail.tsx`, `studyLibrary.css` | The dialog and its **Share or print** button in the study-aid card header. |

## Guarantees and limits

- **Only the chosen study content is written.** No material id, file path, notes, timestamps, practice history, settings or key. Tests assert those values are absent from the packet and the handout.
- **Import equivalence.** For every successful export, the import validator's payload equals the chosen content. A mismatch refuses the export and writes nothing.
- **Provenance travels with the file.** `source.note` (packet) and the handout's notice say whether content was AI-generated (with model) or previously imported and unchecked, plus the verify-against-FAA/instructor reminder. Same-origin parts are described once.
- **New identity on import.** Import is unchanged and create-new only; the packet carries no app identity, so importing makes a new material and never touches the original or its practice history (existing Slice B behaviour and Rust tests).
- **Known lossiness, all from the existing v1 format:** the import uses the packet title (the material title) for the material, study set and practice test; page numbers travel only as unverified `sourceRefs` claims, which an import previews and then discards; choice text is single-line in the format, so line breaks inside a choice become spaces.
- **Granularity:** whole parts per material (guide / all flashcards / all questions). Picking individual cards or exporting several materials at once is not included.
- **No new dependency, schema, migration, capability or version change.** No P54-01 reference contract exists yet to reuse.

## Tests

| File | Cases |
| --- | --- |
| `src/logic/studyExport.test.ts` | 15: validator acceptance; exact payload equivalence; stable content hash across export dates; answer mapping; part selection; empty choice; no private fields; provenance (Gemini, imported, mixed); page refs as unverified; credential refusal; over-limit refusal; other format refusal; whitespace tidying; helpers. |
| `src/logic/studyHandout.test.ts` | 6: CSP and no script/link/image/form; formatted guide, cards and questions; answer key on/off; chosen parts only and nothing private; hostile text (including in the title) stays text; escaping. |
| `src/pages/StudyLibrary/ExportStudyDialog.test.ts` | 7: handout save with answer key; packet save accepted by the import; cancel says nothing; failed save; desktop-only; nothing chosen; packet refusal before any dialog. |
| `src/services/studyExport.test.ts` | 4: desktop-only; arguments without a path; cancel; error mapping with no path leakage. |
| `src-tauri/src/study_export.rs` | 9: exact bytes and no temporary file; replacement only with complete bytes; folder and symlink refusal; missing folder; failed rename keeps the old file and removes the temporary one; size limit; suggested names; no path in errors. |

## Checks on the finished source (Node 22, local Mac)

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | 3,316 passed / 6 skipped (152 files, 4 skipped) |
| `npm run build` | pass |
| `cargo test --locked` | 486 passed / 6 ignored |
| `cargo clippy --locked --all-targets -D warnings` | pass |
| `cargo fmt --check` | pass |
| `npm run test:cargo-lock` | pass |
| `git diff --check` | pass |

**Visual check (Chromium via Playwright, not WKWebView):** the real dialog with the app's stylesheets, the generated handout page, and the handout printed to Letter PDF. The answer key starts on page 3, no question splits across pages, and no console errors. Temporary preview files were deleted.

## Unverified

- The native save dialog, the write to a real user folder, and **Share or print** inside the installed app (no desktop launch was made).
- Importing an exported packet through the installed app's native save (covered at the validator and payload level here and by the existing Rust import tests, but not end to end).
- Printing from Safari/WebKit on macOS 12–15, and VoiceOver.

## Next

Codex review of #191 and then this PR. The next queue item is P54-02 (search inside local PDFs and saved study content), which begins with measurement before choosing an engine.
