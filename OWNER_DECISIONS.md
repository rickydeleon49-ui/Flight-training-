# Split lineage: decisions for you (SL-D1–D8)

"Split lineage" means that when a big PDF (an FAA handbook, say) is split into parts, each part remembers where it came from: which document, which pages, and which edition. She can then jump back to the source, see the other parts, and be told if the original has since changed.

These are the recommended defaults. Reply **"I approve SL-D1 through SL-D8"** to accept them all, or name any you want changed.

| # | Decision | Recommended default, in plain words |
| --- | --- | --- |
| SL-D1 | How a part knows its exact source | When a PDF is split, the app takes a fingerprint (SHA-256) of the exact file, in the background so nothing slows down. If it can't check, it says "unknown" rather than guessing. |
| SL-D2 | Where this is stored | Two new database tables: one for each part's origin and one for a record of each split. Nothing is added to existing material records. Deleting a source keeps the split record, just without the link. |
| SL-D3 | Page numbers | Each part stores both its pages in the original handbook and its pages in the piece it was split from. For example, pages 20–40 of a part that covered pages 101–300 are pages 120–140 of the handbook. |
| SL-D4 | Parts split before this feature existed | They show no origin. The app won't guess from titles like "Part 1 of 5". |
| SL-D5 | Deleting the original | The parts are never deleted with it. They keep their notes, flashcards, tests and history, plus a record of the original's title and pages. |
| SL-D6 | Database upgrade | One new database version (13). An older copy of the app will refuse a newer backup with a clear message, rather than open it incorrectly. |
| SL-D7 | What she sees on a part | The source title and pages, a link to the original or the piece it came from, the other parts from the same edition, and a "copy page number" button. The note reads "matches / changed / missing / deleted / unknown". It opens in the normal Mac PDF viewer, with no built-in viewer. |
| SL-D8 | Not included | A built-in PDF viewer, highlighting or annotation, OCR or text extraction, and whole-library text search. |

**One thing to weigh with the Mac release:** approving these and building split lineage moves the app to database version 13, which adds upgrade testing before that release. If you'd rather ship sooner, release the current work first and add split lineage in the following version. Approving now doesn't force either order.

## 2026-10-21 — 0.5.9 scope and the PDF page

- **Gemini first, on-Mac backup at the bottom.** "The gemini generation is the main way we work but having the pdf reader available is a good back up that needs to work… AI generation should remain at the top then the back up at the bottom, whole page with tips." The PDF page leads with the Gemini guide; "On this Mac (backup)" (read text, study kit) sits at the bottom; every section has a short tip.
- **0.5.8 retired.** Its CI build was only linker-signed and macOS called it damaged; 0.5.9 supersedes it.
- **0.5.9 waits for real-file testing.** "Before we release 5.9 let's get all these fixed and run some more real testing." Card quality and the Preview-edited PDF fix were both held in ("Fix in 0.5.9", "Fix before release").
- **Oversized single pages** are left out of a split and named, never shrunk (no image dependency).
- **Simple PDF page, Gemini does the work.** "Study guide flash card and practice test all have their own section and the file splitter at the top"; keep "Start here"; "the make your own isn't a good system, let Gemini do the work". No hand-written guide or practice-question entry points; editing what Gemini made (and anything already saved) stays.
