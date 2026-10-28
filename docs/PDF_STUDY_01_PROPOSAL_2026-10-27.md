# PDF-STUDY-01a — Phase A proposal

27 October 2026. Plan only at `624956951cd70420eb4d0607d26da5d90c88014c`, branch `roadmap/pdf-study-01`.

## Recommendation and boundary

Ship three small steps: clearer existing source references (01b), page note → card
(01c), then page note → practice question (01d). Each step is useful when released;
01c/01d include failure handling; 01d reuses 01c's storage. No implementation this round.

Follows row 11 (`ROADMAP.md:134`), DIFF-05 Phase A
(`docs/OFFLINE_TRAINING_ROADMAP_2026-10-21.md:107–124`) and COMP-03
(`docs/COMPETITIVE_APP_RESEARCH_2026-10-21.md:124`). A source does not verify an
answer. Follow `PRODUCT_SPEC.md` §§15, 36, 41 and 46 for wording and privacy.

No renderer, selection, highlights, geometry, OCR, dependency, network or AI.
Phase B/C stay gated. Preserve macOS 12, Windows fallback, originals and scheduling.
No real data/PDF, app-data access, commit, push, release or version change.

## What the code actually has

- **Page notes are bookmarks.** `NavigationBookmark` contains material ID, physical
  page, printed label, originating SHA-256, title, notes and status
  (`src/domain/types.ts:1639–1649`). SQLite already stores all of these;
  despite its name, `page_index` is **1-based**
  (`src-tauri/migrations/0015_document_navigation.sql:11–18`, `:54–68`).
- **Where she uses them:** material detail mounts `DocumentPagesPanel` in the
  document area (`src/pages/StudyLibrary/MaterialDetail.tsx:1506`). Find your place
  offers Check pages and Add bookmark; its dialog saves title/notes/page/label,
  bound to the file identity captured when opened
  (`src/pages/StudyLibrary/navigation/DocumentPagesPanel.tsx:148–155`, `:245–305`).
  Rows list title, page, printed label, status and notes, with Open and Remove.
  There is **no edit action**, nor an update-bookmark operation in the current
  transaction decoder (`src/data/navigationTransaction.ts:173–188`). Do not imply
  existing editable page notes. Editing is a real gap, but not needed for conversion.
- **Missing/replaced:** missing files keep saved places visible and offer restore
  (`src/pages/StudyLibrary/navigation/DocumentPagesPanel.tsx:230–235`). Inspection
  reconciles bookmark status against hash and page range
  (`src-tauri/src/navigation.rs:894–913`). The bookmark insert checks expected
  identity and bounds (`src-tauri/src/navigation.rs:797–815`). Navigation rows
  cascade on explicit material deletion; missing bytes are different from deleting
  the material (`src-tauri/migrations/0015_document_navigation.sql:9–10`).
- **Cards:** material detail exposes `StudySetEditor` for a saved set
  (`src/pages/StudyLibrary/MaterialDetail.tsx:920–924`); exported `StartManualStudySet`
  can create a first manual guide (`src/pages/StudyLibrary/StudySetEditor.tsx:596–627`),
  but has no current UI caller. First-set creation needs wiring, not just prefill.
  The editor supports add/edit/instructor correction/delete/history; compact mode
  already opens a blank add-card dialog, used by Mistakes
  (`src/pages/StudyLibrary/StudySetEditor.tsx:118–180`, `:220–277`;
  `src/pages/StudyLibrary/PracticeMistakeFollowupPanel.tsx:390`).
  Saving checks the opened set, preserves the whole previous set and uses
  `saveStudySet` (`src/pages/StudyLibrary/StudySetEditor.tsx:183–217`;
  `src/data/studySetTransaction.ts:414–461`). Edits retain logical identity;
  corrections replace it and retire earlier wording; deletion retires too
  (`src/logic/studyAuthoring.ts:242–270`). Adding a card starts fresh set reviews;
  the compact editor already discloses this (`src/pages/StudyLibrary/StudySetEditor.tsx:242–244`).
- **Practice questions:** `StartManualPracticeTest`, `PracticeTestEditor` and
  `PdfPracticeQuestions` share one editor (`src/pages/StudyLibrary/PracticeTestEditing.tsx:229–237`).
  `StartManualPracticeTest` also has no current UI caller; material detail mounts
  the existing-test editor (`src/pages/StudyLibrary/MaterialDetail.tsx:1260`).
  Existing PDF-kit seeding appends drafts without replacing current questions
  (`:85–111`); Save uses `buildPracticeEditOperation` and `savePracticeAuthoring`
  (`:121–153`). Questions need 2–8 options and a chosen correct answer (`:13–34`).
  The draft builder retains instructor origin and exact retirement records for
  changed/deleted questions (`src/data/practiceAuthoringDraft.ts:31–63`). Saves
  have operation receipts, frozen versions and preserved prior snapshots; ordinary
  edits refuse active attempts (`src/data/practiceAuthoring.ts:795–863`). Removal
  preserves completed-attempt versions (`:801–827`). These are practice questions,
  distinct from the Questions screen's things to ask an instructor.
- **Source fields today:** cards/questions hold `sourcePage`; their containing set
  has `sourceMaterialId` (`src/domain/types.ts:375–450`). Neither numeric field
  is a durable bookmark source envelope. `SourcePageBadge` accepts only page and
  material ID; it treats numbering as unknown, opens with reader guidance and
  saves no position (`src/pages/StudyLibrary/navigation/SourcePageBadge.tsx:1–30`,
  `:48–74`). It does not show the material title or printed label.
- **Existing richer evidence is different:** PDF-kit provenance requires a run,
  extractor/algorithm versions, byte offsets and an extracted quote
  (`src/data/pdfKitSources.ts:8–24`, `:31–53`). A typed bookmark note proves none
  of that. Never fabricate a kit run, quote offset or “Pulled from your PDF” label.
- **Where sources/questions appear:** active practice shows its source beside the
  question (`src/pages/StudyLibrary/PracticeTestPanel.tsx:1296`); full attempt
  review uses frozen items (`src/pages/StudyLibrary/PracticeHistory.tsx:536–547`,
  `:705`); Short saved review currently shows the source after answer reveal
  (`src/pages/StudyLibrary/PracticeMistakeFollowupPanel.tsx:339–349`). Card study
  and review use the same badge (`src/pages/StudyLibrary/MaterialDetail.tsx:1125`,
  `:1583`; `src/pages/StudyLibrary/CardReviewPanel.tsx:454`).
- **Privacy/transfer:** exports already exclude instructor corrections by default
  (`src/logic/studyExport.ts:79–99`). Packet import deliberately discards machine
  source claims (`src/logic/studyPacket/payload.ts:1–8`, `:80–95`). Preserve both.

## PDF-STUDY-01b — clearer sources, no storage change

1. Show `From: <material title>, source page N` at existing question/card source
   locations. In historical review use the saved attempt/version title, including
   when the material was removed. An absent page says “Check source.”
2. Retain unknown-numbering guidance for legacy items. Say “Open source”; never
   “Jump to page.” Keep the question, answers and saved state in place when the
   reader opens. Source visibility must not reveal a hidden answer.

Files: `navigation/SourcePageBadge.tsx` and its lifecycle tests; `MaterialDetail.tsx`,
`PracticeTestPanel.tsx`, `PracticeHistory.tsx`, `PracticeMistakeFollowupPanel.tsx`,
`CardReviewPanel.tsx` and their source/render tests (all under `src/pages/StudyLibrary/`).
Storage: none; never infer a SHA or physical-page meaning for old references.
Tests: missing title/page/material/file, removed-material historical title,
replacement/unmount during inspect, keyboard open/return and no attempt/review writes.
Acceptance: COMP-03 presentation; preserves DIFF05-A/C safeguards for legacy
guidance. It does not complete DIFF05-D or certify old source positions.

## PDF-STUDY-01c — make a card from a page note

1. Add “Make a card” to a bookmark row. Open the existing editor with title →
   Question, notes → Answer, plus its separate physical page and printed label.
   All study wording is editable. Empty fields require her input; do not truncate
   oversized notes silently. Add to the current set; if none exists, create a
   card-only manual set through the existing authoring transaction on Save.
   Retain the fresh-review disclosure. Cancel/Escape writes no content, source
   row, history or receipt; a preview is memory-only, not a PDF-kit journal.
2. Save a source snapshot atomically with the card through existing authoring.
   Keep the bookmark unchanged. Default origin is user, with the existing explicit
   instructor-origin choice. Retain provenance through ordinary edits/corrections
   using proven lineage; a changed source page detaches the trusted reference.
3. Show `From: <saved material title>, PDF page N (printed page <label>)` on the
   saved card and in review. Offer Copy page / Open source with explicit reader
   guidance. Check the original hash and bounds before opening; do not open a
   replacement as if it were the old source. Show “Position unverified” when the
   file is missing, changed, unchecked or the binding is ambiguous; keep text.

Files: the 01b source component/callers; `DocumentPagesPanel.tsx`, `StudySetEditor.tsx`
and scoped CSS; `src/domain/types.ts`, `src/logic/studySetEditing.ts`,
`src/data/studySetTransaction.ts`, `src/data/repositories/documentRepository.ts`,
`src/data/cardReviewTransaction.ts`, `src-tauri/src/study_sets.rs`,
`src-tauri/src/card_reviews.rs`; new paired source-reference helpers/tests;
`src/state/navigation/controller.ts` and repository/service adapters for a
hash-checked guidance-only open. Add schema/backup files listed below.
Storage: additive source tables below; no second bookmark table.
Tests: create-first/append, exact prefill, validation limits, Cancel/Escape,
double Save/uncertain retry, stale set/note, failed source write rolling back the
card, source changed during preview/open, source removal/restore, history restore,
duplicate cards and unchanged retirement/review behavior. Check original PDF SHA
before/after successful, cancelled and failed operations on synthetic files.
Acceptance: DIFF05-A, Phase A page/label portion of B, C and card portion of D;
Phase A accessibility evidence under F. No highlight/renderer acceptance claim.

## PDF-STUDY-01d — make a practice question from a page note

1. Add “Make a question.” Reuse the practice editor with a distinct bookmark seed:
   title → question, notes → optional explanation, physical page → source page;
   two blank options and **no selected correct answer**. She supplies options and
   chooses the answer before Save. Append to the current test, preserving its
   other drafts and questions; create a manual test only if none exists.
2. Use existing expected-snapshot checks, operation receipts, retirement/history
   and active-attempt block. Store the same source envelope atomically; show it
   in practice, full history and Short saved review against that frozen item.
   Keep source access beside the prompt without prematurely revealing answers.

Files: `DocumentPagesPanel.tsx`, `PracticeTestEditing.tsx`, the three practice/review
source callers above; `src/data/practiceAuthoringDraft.ts`,
`src/data/practiceAuthoring.ts`, `src/data/repositories/documentRepository.ts`,
`src-tauri/src/practice_authoring.rs`, `src-tauri/src/practice_sessions.rs`,
`src/data/repositories/practiceSessionRepository.ts` and domain
types; shared source helpers and corresponding UI/parity/native tests.
Storage: reuse 01c tables and receipts, no further migration anticipated.
Tests: blank answer cannot save, existing questions untouched, active attempt,
stale snapshot, double Save/retry, correction/delete/restore/regeneration,
completed historical attempt after edits/material deletion, no answer/score writes
from reveal/open/navigation, and source/backup/failure cases from 01c.
Acceptance: completes Phase A DIFF05-D for questions; A/B/C/F within stated scope.

## Storage proposal for owner review before 01c

01b needs no storage. Durable references do: numeric pages omit SHA/label,
bookmark deletion must not destroy study provenance,
and kit provenance requires evidence a bookmark cannot provide. Do not hide a
machine reference inside answer text or the set-wide `sourceNotes` string.

Recommend one new additive migration, number chosen against then-current main:

- `study_page_sources`: UUID primary key; nullable `source_material_id` FK with
  SET NULL; saved material title; nullable originating SHA-256; 1-based physical
  page; nullable printed label; nullable bookmark ID FK with SET NULL; created time.
  Validate bounded titles/labels, integer pages and lowercase 64-hex SHA when known.
  No note-body duplicate, external path, extractor version or invented quote.
- `study_page_source_bindings`: source UUID FK, owner history key, binding kind
  (`authored_card`, `authored_question`, `frozen_card`, `frozen_question`), item key
  and canonical content fingerprint; composite primary key over these fields.
  Authored keys are logical IDs; frozen keys are existing immutable item IDs.
  Insert bindings in the authoring/snapshot transaction, not on render. Multiple
  conflicting sources for a frozen key resolve as ambiguous, never “latest wins.”

Do not change existing canonical version hashes or move ratings across versions.
Card versions currently hash wording/page/origin and derive item IDs by ordinal
(`src/logic/cardIdentity.ts:143–155`); they omit authoring IDs. Materialization must
match the exact ordered saved cards to authored bindings, never front text alone.
Identical content with conflicting origins must lose trusted positioning rather
than rewrite historical provenance. Practice versions already freeze item rows
(`src-tauri/migrations/0011_practice_sessions.sql:27–38`). Copy bindings for exact
unchanged items; carry corrected lineage deliberately; never borrow today's source
for an old attempt. Keep bindings needed by saved history and history restore.

Use existing source-aware save receipts with the full source payload bound to the
operation ID; extend their validators, not just writes. Ordinary card saves only
record durable receipts for PDF-kit payloads today
(`src/data/studySetTransaction.ts:399–413`, `:459`), so bookmark saves need that
same explicit retry protection. Validate bookmark ownership/snapshot and current
managed bytes at the native boundary; cached identities alone are insufficient.
Preview inspection records whether the old source is matching, missing or changed;
an already-disclosed mismatch can save only as unverified. A further change during
Save refuses the whole save and keeps the editable draft.
Already-saved cards/questions remain usable offline even if their PDF disappears.

Register the migration in `src/data/migrations.ts`, `src-tauri/src/lib.rs` and
`src/data/migration-checksums.json`; update native/browser source readers and
`src-tauri/src/backup.rs` schema/semantic checks (current dispatch at `:630–659`).
Full backup must retain tables/bindings and managed documents, validate references,
restore missing-file states honestly and refuse newer unsupported schemas. Old
backups migrate to empty source tables; do not manufacture anchors. Preserve
rollback, migration checksums and compatible v1/v2 restore. Exercise corrupt FK,
binding/hash, interrupted restore and populated-current/older backup cases.
Material deletion keeps practice sources only while retained attempts need them;
erase card sources with card/history erasure and collect unused source rows.
Erase-all covers both tables. No extra content retention policy.
Packet v1 stays unchanged: machine anchors do not travel. Shared exports continue
to exclude instructor corrections by default and do not start exporting bookmark
notes or internal source IDs. Regression-test packet, print and CSV boundaries.

## Owner choices and risks

- **Approve the additive source schema?** Recommend yes for 01c; otherwise ship
  only 01b and stop short of claiming durable page-note provenance. This proposal
  does not reserve a migration or authorize schema implementation.
- **Allow conversion from missing/changed sources?** Recommend yes as an editable
  draft, with the saved old reference visibly unverified; no relinking. A source
  that changes during Save requires reopening/reviewing the draft, not silent rebinding.

Risks: note text can exceed editor limits; titles may contain private text;
identical card snapshots can have ambiguous bindings; late async work can open the
wrong file or steal focus. Test each. Keep missing-byte recovery distinct from
material deletion. Bookmark editing can follow separately if requested.
DIFF05-B tests cover combining marks/emoji in text and labels, repeated wording,
first/last/out-of-range physical pages, rotated/cropped synthetic pages and nested
split children. Keep the child's own material/hash/page; any parent/root translation
must use existing verified lineage or refuse. Phase A has no 0-based renderer index
or text anchor; explicitly test that no minus-one conversion is introduced.
Extraction-version changes cannot invalidate these page-only anchors by themselves;
they must invalidate any extraction-derived claim, never reinterpret it as a bookmark.
DIFF05-E renderer budgets remain gated; preserve default-reader fallback and no
unrequested uploads. For F, independently check keyboard, focus return, large text,
VoiceOver and performance on each promised installed Mac/Windows runtime; browser
tests alone are insufficient. Follow AGENTS gates, receipts, independent mutations
and review for implementation. This plan has no runtime/test evidence.
