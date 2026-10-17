# P54-05 part A: lesson brief: implementation report

**IMPLEMENTED, PENDING INDEPENDENT REVIEW; NO SELF-MERGE.** Claude implemented part A of the [approved scope](P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md) ([approval](P54_05_SCOPE_APPROVAL_2026-10-17.md)), following the [continuation assignment](P54_05_NEXT_IMPLEMENTER_PROMPT_2026-10-17.md).
- **Branch and base:** `claude/p54-05-lesson-brief`, from main 32582f2. PR193 is on main and its save API is present.
- **Not included:** no calendar writer (that is part B), no dependency, no migration, no stored preference, no provider call.

## What she gets

A **Lesson brief** button on every schedule item's page opens a dialog with:
- the follow-up choices, all unticked;
- a live preview of one printable page.

In the desktop app, **Save…** writes that page through the shared native save path, as a new `brief` export kind (`.html`, 1 MiB cap, refused before the save dialog opens). She opens the saved file in a browser to print it or save it as PDF. Browser mode cannot save files, so it says so and offers **Print…** for the preview instead.

The page contains:
1. **The lesson's stored details:** type, date (the year always printed), time, location and instructor, plus the status when it is not "Scheduled".
2. **Get ready:** `lessonPreparation()`'s own lines and done state, with "X of Y ready". There is no percentage.
3. **Read before:** attached materials' title, type and topic, in attachment order. Deleted materials are skipped.
4. **Follow-ups:** only the candidates she ticks. With none ticked, the section is absent.

## Defined rules (the scope left these to the implementer)

- **Journal follow-ups.** They come from the newest journal entry dated **before** the lesson; ties go to the entry written later, then by ID. The lesson's own entry and later entries are excluded. Each non-blank line of "questions for next time" is one candidate, trimmed but otherwise in her wording.
- **Goal questions.** Questions with status *To ask* or *Revisit* that are saved with another lesson **or a material** belonging to the lesson's goal, oldest first. A lesson without a goal gets none. Questions already on this lesson stay in Get ready.
- **Duplicates.** Wording is compared after NFC normalization, whitespace collapsing and case-folding. Each wording is offered once, at its first position. A candidate that repeats one of this lesson's own questions is not offered.
- **Where it came from.** Each candidate shows its source, for example "Journal, Saturday, October 17, 2026" or "Question saved for “Slow flight”". The same label is printed.
- **Exact page.** The preview and the saved file are the same string, built once per choice from a creation date fixed when the dialog opens. Choices reset each time it opens.

## Privacy and safety

- **Never on the page:** lesson notes, journal reflections and feedback, finances, medical and toolkit data, material notes and paths, other lessons' details, and unticked follow-ups. Tests assert this with unique sentinel strings.
- **Escaping and policy.** All text is escaped with the P54-04 `escapeHtml`. The page carries the handout's Content-Security-Policy (`default-src 'none'; style-src 'unsafe-inline'`) and its now-shared print styles (`PRINT_STYLE`). A hostile-markup test checks that every tag in the body comes from the page's own small set.
- **Preview frame.** The preview iframe is sandboxed to `allow-same-origin allow-modals`: same-origin only so that Print can reach it, and no scripts.
- **Save lock.** Saving reuses P54-04's synchronous lock: two clicks in the same render open one save dialog, and the choices and Save button are locked while a save is pending, so they always match the bytes dispatched. Cancel, refusal and retry behave as in P54-04.

## Changed files

| File | Change |
| --- | --- |
| `src/logic/lessonBrief.ts` | New: content, follow-up candidates, page builder, file name |
| `src/pages/Schedule/LessonBriefDialog.tsx` | New: dialog, preview, save/print |
| `src/pages/Schedule/EventDetail.tsx` | "Lesson brief" button and dialog |
| `src/pages/Schedule/schedule.css` | Dialog styles |
| `src/logic/studyHandout.ts` | Exports its print styles as `PRINT_STYLE`; handout output is unchanged |
| `src/services/studyExport.ts` | `StudyExportKind` gains `"brief"` |
| `src-tauri/src/study_export.rs` | `ExportKind::Brief`: html, "Save lesson brief", `MAX_BRIEF_BYTES` = 1 MiB, compile-time checked below the handout cap |

Source identities are in [`source-hashes.json`](evidence/p54-05-lesson-brief-2026-10-17/source-hashes.json).

## Tests and gate (Node 22.23.3, rustc 1.99.0; [receipts](evidence/p54-05-lesson-brief-2026-10-17/README.md))

- **`lessonBrief.test.ts`, 12 cases:**
  - details and the status rule;
  - exact readiness parity with `lessonPreparation()`;
  - reading order and exclusions;
  - empty states;
  - journal selection, ties and exclusions;
  - goal questions via lessons and materials, open statuses only;
  - de-duplication;
  - no goal;
  - sentinels for every excluded field;
  - hostile markup and Unicode;
  - the file name.
- **`LessonBriefDialog.test.ts`, 9 cases:**
  - choices start unticked and the preview follows them;
  - the saved bytes equal the preview;
  - a double click dispatches once;
  - choices are locked while pending, with the preview equal to the dispatched bytes;
  - cancel is silent;
  - a refusal is explained and a retry works;
  - choices reset on reopen;
  - browser mode prints instead of saving;
  - the sandboxed preview carries the CSP.
- **Mutation checks:** removing the save lock fails exactly the double-dispatch test, and removing the pending lock fails exactly the locked-choices test.
- **Native:** `a_lesson_brief_is_its_own_bounded_html_kind` checks the serde name, extension, title, limit, file name, and that a 1 MiB + 1 byte write is refused with nothing written.

| Gate | Result |
| --- | --- |
| Focused (brief + P54-04 export suites) | 42/42 |
| Full frontend | **3,584 pass / 6 skipped**, exit 0 |
| Native `cargo test --locked` | **532 pass / 6 ignored**, exit 0 |
| Typecheck, Vite build, strict Clippy, fmt, Cargo lock sync | All exit 0 |
| Schema-14 helper | 26/26 |
| `git diff --check` | Clean |

**First-attempt failures, retained in `first-attempt/`:**
- **Typecheck** found two possibly-undefined indexes in the new tests.
- **Clippy** rejected a runtime `assert!` on constants.

The fixes were test typing and a compile-time `const` assertion; no behavior was weakened. Both full suites were rerun on the final source. During development, two of my own test assertions were too naive: a `%` search hit CSS, and an `href=` search hit escaped text. They were replaced with stricter checks (body-only text, and an allow-list of tags) before the receipts were taken.

## Deferred and unverified

- **Source-page labels from navigation (P54-01).** These are not shown. Navigation state is read asynchronously per material and is not in the app data the brief uses, so adding it would mean a new loading path. The scope makes it conditional; it is a separate follow-up.
- **Not verified by these source tests:** WebKit printing, PDF output and the native save dialog in the installed app. No app launch, profile/key, provider, installer, signing or release operation occurred.

**Next:** independent review of part A. Part B, the calendar file, follows its acceptance under the recorded decisions: floating times, a one-hour default, a single snapshot, and no SEQUENCE or METHOD.
