# P54-03 clearer formatted study guides — implementation report — 16 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW. No self-merge.** Branch `claude/p54-03-formatted-guides` from main `d97e1a9`.

## Why this item now

The approved queue is P54-01 → P54-03 → P54-04 → P54-02 → P54-05 → P54-06 → P54-07 → P54-08. P54-01's first slice (M4 Slice 1) is complete as PR #189 and waiting for Codex review. Its later substeps (persistent imported references, embedded reader evaluation) build on that slice, so they are blocked until it is accepted. P54-03 is the next unblocked item; the queue order is unchanged.

## Owner decision

The owner chose an **in-house formatter instead of react-markdown + GFM** (16 October 2026). No package, lockfile or dependency changes.

## What changed

| Path | Change |
| --- | --- |
| `src/logic/guideFormat.ts` | New pure parser: guide text → headings, paragraphs, bulleted/numbered lists (with nesting), quotes and pipe tables; inline bold, italic and code. |
| `src/pages/StudyLibrary/GuideBody.tsx` | Renders those blocks with ordinary elements only. |
| `src/pages/StudyLibrary/MaterialDetail.tsx` | Saved study-guide section bodies use `GuideBody`. |
| `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx` | The import preview's section bodies use `GuideBody`, so the preview matches what is saved. |
| `src/pages/StudyLibrary/studyLibrary.css` | `.guide-body` styles from existing tokens; tables scroll horizontally inside their own region. |
| `src-tauri/src/gemini.rs` | The study-aid prompt says section bodies may use simple Markdown (lists, bold, italic, quotes, pipe tables) and no links, images or HTML. The JSON schema is unchanged. |

## Guarantees

- **Nothing is loaded or run.** No element the formatter emits can be `<a>`, `<img>`, `<script>`, `<iframe>` or raw HTML. A link shows its text and its address as plain words; an image shows only its description; HTML shows as the characters typed (React escapes it).
- **Saved data is unchanged.** Stored guide text, packets, backups and the database are untouched; this changes only display. No migration or contract change.
- **Plain guides read as before.** Unmarked text becomes the same paragraphs with line breaks kept (`white-space: pre-wrap`). Ordinary punctuation is left alone: `snake_case`, `V_X`, `2 * 3`, `61.109`, a lone `|`, and a dash inside a sentence.
- **Bounded work.** Bodies over 20,000 characters are shown as plain paragraphs without parsing; nesting stops at depth 4; a stress test of long mark runs finishes well under a second.
- **Accessibility.** Tables have `th scope="col"` headers inside a focusable, labelled scroll region; lists and quotes use native elements.
- **Not covered:** guide summaries, source notes, flashcards and practice questions are still plain text. Formatting does not check an answer's correctness; the existing study-aid and imported-content disclaimers stay.

## Tests

- `src/logic/guideFormat.test.ts`: 28 cases covering plain-text fidelity, lists (bullets, numbering with a start number, nesting, loose lists, boundaries), quotes, headings, rules, tables (alignment row, ragged rows, escaped pipes, required separator), inline marks, escapes, no links/images/HTML, the size limit, the depth limit and a timing bound.
- `src/pages/StudyLibrary/GuideBody.test.ts`: 4 rendered cases: real list/strong/em/blockquote/table elements and roles; plain text unchanged; no `a`/`img`/`script`/`iframe` from hostile text; ordered-list start.

## Checks on the finished source (Node 22, local Mac)

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | 3,284 passed / 6 skipped (148 files passed, 4 skipped) |
| `npm run build` | pass |
| `cargo test --locked` | 477 passed / 6 ignored |
| `cargo clippy --locked --all-targets -D warnings` | pass |
| `cargo fmt --check` | pass |
| `npm run test:cargo-lock` | pass |
| `git diff --check` | pass |
| `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | 25 pass / 1 fail locally: `src-tauri/target: unexpected top-level entries: flycheck0`. That folder is written by the local rust-analyzer language server, not by this change, and does not exist in CI. |

**Visual check:** the real `GuideBody` with the app's real stylesheets was rendered in a temporary browser page (Playwright, Chromium) and screenshotted; lists, nested bullets, numbered steps, quote, table and inline code display correctly, with no console errors. The temporary page was deleted. This is not WKWebView evidence.

## Unverified

- Installed app rendering in WKWebView on macOS 12–15, VoiceOver reading of tables and lists.
- A live Gemini call with the new prompt line: no provider request was made. Whether Gemini follows the formatting hint is unobserved; older guides and any output are displayed safely either way.

## Next

Codex review of this branch. Then P54-04 (selective study export and printable handouts), unless P54-01's later substeps are unblocked first.
