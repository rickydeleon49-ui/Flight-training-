# VISUAL-01: a small visual recall proof — 28 October 2026

Plan only, inspected at `f4ea44daeeaaae55bbca81856b8991efe796cbfc`, branch `roadmap/visual-01`.
No feature, migration, dependency, runtime compatibility or performance is approved or proven here.
This is row 12 / COMP-06, following research recommendation 4; it does not reorder the queue.
Read alongside PRODUCT_SPEC.md, the competitive research, offline training roadmap and open-source adoption plan named in the assignment.

## The student experience

From her diagram: **Cover a label → Try to remember → Reveal → Open original**.
One rectangle and one question at a time. She supplies a short question and the label's answer.
Answering can happen in her head; no typed response, confidence record, score or AI is needed.
Use her own chosen image or, later, one page of her own PDF. No bundled course diagrams.
Keep this inside Study Library, with ordinary buttons and no new dashboard or drawing workspace.
No school, instructor, account or connection is required. A recall rating never means flight proficiency.
This follows useful simplicity, privacy and authority rules (`PRODUCT_SPEC.md:1568`, `PRODUCT_SPEC.md:1574`, `PRODUCT_SPEC.md:1576`).

## What the code already provides

| Foundation | Actual source and implication |
| --- | --- |
| Managed image/document intake | `src/services/documents.ts:60` offers PDF, PNG, JPEG and WebP. `src-tauri/src/documents.rs:400` reserves a fresh name; `:440` copies chosen bytes. The picker is not a decoder or an image-size guard: that native copy only checks that it is a file. |
| Opening and deleting files | `src/services/documents.ts:89` opens the managed copy in the default app. `:146` stages deletion, removes metadata, rolls back on failure, then purges. Native reference checks are in `src-tauri/src/documents.rs:135`; interrupted deletion recovery is at `:658`. Reuse these protections. |
| Manual card authoring/history | `src/data/studySetTransaction.ts:1` describes atomic expected-state saves and retry identity; `:63` defines front/back/page/origin. Migration `src-tauri/migrations/0016_manual_study.sql:1` preserves previous sets and private manual/instructor origins. These are text contracts, not image-region storage. |
| Frozen versions and reviews | `src-tauri/migrations/0012_card_reviews.sql:12` creates content-addressed versions, `:29` frozen items, `:59` rating events and `:74` receipts. `src/data/cardReviewTransaction.ts:1` preserves generation and replay barriers. Reuse this history/scheduler rather than create a visual scheduler. |
| Important identity gap | `src/logic/cardIdentity.ts:1` hashes only front/back/sourcePage/origin. Moving a rectangle or changing an image currently cannot create a distinct visual version. `src/data/studySetTransaction.ts:63` has no visual reference. A sidecar alone would be unsafe. |
| PDF-STUDY-01c sources | `src-tauri/migrations/0024_study_page_sources.sql:2` stores material title, original SHA-256, 1-based physical page, printed label and bookmark separately from shared card content. `:12` binds authored/frozen identities; `:20` collects and erases links. `src/data/studyPageSources.ts:35` saves checked bookmark sources and `:68` freezes bindings. |
| Exact original versus page jump | `src-tauri/src/study_page_sources.rs:126` rereads bytes and page count; `src/pages/StudyLibrary/navigation/SourcePageBadge.tsx:43` checks identity, and `:95` asks the navigation controller to open with guidance. The badge says “Go to page”; it does not guarantee an external reader jumps there. Missing/changed bytes cannot be called the exact original. |
| PDF pages are not pixels yet | `src-tauri/src/pdf.rs:115` writes a selected PDF range; `:159` selects PDF bytes. These functions do not rasterize a diagram. The 01c page source is provenance, not a page screenshot, image crop or embedded renderer. |
| Backup/restore | `src-tauri/src/backup.rs:43` writes complete-backup format 3, retaining older readers. `:4588` discovers files through study_materials.file_path; `:5990` selects referenced files and discloses missing ones. `:625` refuses newer schemas. `:728` and `src/data/practiceStateValidation.ts:1933` validate page-source structure and bindings. New visual metadata needs equivalent Rust/TS validation, not just inclusion in SQLite. |
| Accessibility | `src/pages/StudyLibrary/CardReviewPanel.tsx:375` manages focus; `:403` deliberately reveals; `:428` handles keyboard input; `:456` mounts the answer only after reveal. `src/components/ui/useModalDialog.ts:182` feature-detects native modal support, with a focus/exclusion fallback (`:90`, `:147`). Reuse patterns, not a custom SVG-only control. |
| Runtime/security boundary | `src-tauri/tauri.conf.json:25` permits local/data images but not blob images; `:43` sets macOS 12.0. Existing image picker support does not establish a safe managed-image preview service. Add only a bounded, material-ID-based read, never arbitrary file URLs or broader filesystem permissions. |

## Bounded slices (assign separately after review)

### VISUAL-01b — temporary interaction proof

1. Load one synthetic PNG, choose one rectangle, enter question/answer, then try/reveal/open the same synthetic original. Use a disposable harness/profile; the screen says “Try it — this is not saved”. PNG only, at most 10 MiB, 4,000,000 decoded pixels and 4,096 pixels per edge. Reject corrupt/animated/unsupported inputs before full decode; no PDF, SVG, HEIC, GIF or WebP intake in this proof.
2. Prove resize/zoom and quarter-turn view rotation, keyboard-only rectangle placement and review, and actual VoiceOver use. Reopening checks the same bytes, not just the filename. An opaque cover must be present before the first visible image frame.
3. Storage: temporary memory only; no database rows, managed import, ratings or backup payload. Close/Cancel clears question, answer, image bytes and covers; reset reveal on re-entry. Test that backup state is unchanged. Stop for independent review before adding saved visual cards.

### VISUAL-01c — save image cards and restore them safely

1. Reuse normal image materials/files and manual card saves; add the two sidecar tables below. Keep PNG limits; add JPEG only with a bounded orientation/header check. Accept EXIF orientation 1/absent, refuse other orientations with “Save an upright copy first”. Keep original bytes unchanged. View rotation is 0/90/180/270 only; no crop, mirroring, arbitrary angles or automatic downsampling. Up to 20 covers per image, one cover per card, one active card/image decoded at a time.
2. Freeze image identity/geometry with each card version, use existing reveal/ratings, and preserve normal edit/retirement/reset rules. Extend canonical identity only for visual cards; every legacy text-card hash must remain identical. Image, geometry or view-rotation changes start fresh reviews under C-D3; returning to identical retained content recovers its history. No rating on reveal or source open.
3. Storage: existing card JSON/history/origin/review tables plus sidecars; original image remains a study_materials.file_path, with no per-card image copy. Ship full-backup/restore, missing/changed-image handling and deletion checks in this same slice. Do not enable durable visual cards before those pass.

### VISUAL-01d — one page from her PDF, after the PDF feasibility gate

1. Evaluate a local native page-raster adapter under the existing PDF/OSS gate, using synthetic PDFs only. Plain HTML/SVG cannot rasterize arbitrary PDFs itself. Do not install a package, activate an embedded reader or raise the minimum OS. If unavailable, keep image intake usable; a manually added screenshot is not a verified PDF page capture.
2. After separate approval, capture one selected physical page at a bounded raster size using the same image limits. Preserve CropBox/Rotate semantics in the raster; record the exact resulting image dimensions/hash. Reuse the 01c bookmark source for original PDF hash/page/printed label; verify the PDF again at capture/save/open. Refuse source changes during capture. No OCR or content extraction is needed.
3. Storage: no further migration in this proposed shape. Store the generated page PNG as an ordinary, clearly named image material, reused by its cards; keep the cards on the original PDF material and bind their provenance through study_page_sources/bindings. The region's owner is the PDF material, image_material_id points to that PNG. This adds one visible page-image entry, not a hidden file outside existing backup discovery. Persist/retry capture through the existing save patterns; clean failed copies reference-safely. PDF deletion erases its cards/regions but leaves the separately listed page image until explicitly deleted; disclose that before confirmation.

## Coordinates and accessible interaction

Store rectangles in the upright image's intrinsic pixel grid: top-left origin, x/y right/down, integer x,y,w,h.
Require 0 <= x,y, positive w,h, x+w <= W and y+h <= H. Never persist CSS pixels, percentages or device pixels.
For JPEG, “upright” here means accepted orientation 1/absent; other orientations are deliberately unsupported.
An SVG viewBox `0 0 W H` holds both image and opaque rectangle. Fit/zoom transforms the shared group.
Rotate that group with translation into its rotated bounds; for 90 degrees clockwise, (x,y) maps to (H-y,x).
Invert the complete display transform for pointer input; convert all four rectangle corners, then round outward and clamp.
Resize and zoom never rewrite stored geometry; rotating the view never rotates the saved source bytes.
Test letterboxing, all four turns, high device-pixel ratios, browser zoom and 200% text, including edge covers.

Authoring has a small ordinary HTML list: “Covered label 1”, question, answer, Move/Resize, Remove.
Arrow keys move a selected cover one source pixel, Shift+Arrow ten; a labelled Resize mode changes its bounds.
Provide labelled numeric bounds as a keyboard/screen-reader alternative to dragging. Announce updated bounds politely.
Keep a visible focus outline and at least 44px HTML action targets even when a cover is very small.
During review, a real HTML button in normal Tab order says “Covered label 1. [her question]. Reveal label”.
It may sit beside the picture; the matching opaque cover has a visible number/focus indication, not another tab stop.
The image/SVG is hidden from the accessibility tree; the question supplies equivalent non-answer context.
Do not put the answer in alt text, SVG title/description, tooltip, accessible name or offscreen DOM before reveal.
Enter/Space activates the button. After deliberate reveal, mount the answer text and announce it once; keep focus stable.
Next card re-covers before paint and announces its question. Opening the original deliberately exposes all labels.
The author's preview includes checking that her question describes the location without giving away the label.
VoiceOver equivalence depends on that cue and answer text; an image alone cannot teach its spatial context accessibly.
Use useModalDialog for editing; Escape/Cancel restores the launching control and discards unsaved changes.
Never reuse Ask Gemini actions for this flow.

## Proposed add-only storage shape for 01c (owner gate)

No migration number is reserved. Add a new file at assignment time; never edit a shipped migration.
Reuse front/back for question/answer, itemId/origin for authorship and study_set_history for old authored versions.
Extend the strictly decoded card JSON with optional visualRegionId; absent means the legacy text contract.
Region descriptors are immutable (only their nullable image lookup may detach). Their 64-hex id hashes a versioned canonical descriptor containing owner material ID,
image SHA-256, intrinsic dimensions, rectangle and rotation; exclude mutable paths and nullable image lookup ID.
Include this id in visual cards' canonical content and source-binding fingerprints, in both Rust and TS.
Frozen item sidecars make that reference available without changing existing card_items columns.
Proposed SQL (only these new tables/index; no new file-storage root):

```sql
CREATE TABLE visual_card_regions (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
 owner_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 image_material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
 image_sha256 TEXT NOT NULL CHECK(length(image_sha256)=64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),
 image_width INTEGER NOT NULL CHECK(typeof(image_width)='integer' AND image_width BETWEEN 1 AND 4096),
 image_height INTEGER NOT NULL CHECK(typeof(image_height)='integer' AND image_height BETWEEN 1 AND 4096),
 x INTEGER NOT NULL CHECK(typeof(x)='integer' AND x>=0),
 y INTEGER NOT NULL CHECK(typeof(y)='integer' AND y>=0),
 w INTEGER NOT NULL CHECK(typeof(w)='integer' AND w>0),
 h INTEGER NOT NULL CHECK(typeof(h)='integer' AND h>0),
 rotation INTEGER NOT NULL CHECK(typeof(rotation)='integer' AND rotation IN (0,90,180,270)),
 CHECK(image_width*image_height<=4000000),
 CHECK(x+w<=image_width AND y+h<=image_height)
);
CREATE INDEX visual_regions_owner ON visual_card_regions(owner_material_id);
CREATE TABLE card_item_visual_regions (
 item_id TEXT PRIMARY KEY NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
 region_id TEXT NOT NULL REFERENCES visual_card_regions(id) ON DELETE CASCADE
);
```

Atomic author saves insert immutable descriptors and card references together under the existing operation receipt.
Freezing inserts the item sidecar in the same transaction as card_items; no mutable “current image” lookup for history.
Keep descriptors referenced by current cards, study_set_history, retired cards or frozen items; no eager region GC.
Validate descriptor hash, bounds, owner linkage, authored/history references and frozen identity in Rust and TS.
Register new migration/checksum/schema ceiling normally and preserve old-schema restore and text-only vectors.
SQL bounds alone do not validate decoded bytes: the native reader checks length, signature, dimensions and SHA-256.
An image lookup becoming null leaves the descriptor and historical text intact; the visual card becomes unavailable.
Never silently rate a text-only substitute or point it at another same-named image. Relinking requires exact hash/dimensions.
No absolute path, base64 image, private page source or instructor provenance goes into packet v1/CSV/handouts.
Until an export format is separately designed, explicitly report omitted visual cards rather than export misleading text cards.
Audit every card decoder, identity/fingerprint twin, snapshot reader, packet/export boundary and backup validator together; an ignored extra JSON field is not support.

## Backup, deletion and failure acceptance

Complete backup must restore exact original bytes, card JSON, every retained descriptor, frozen bindings and ratings.
Database-only safety copies still depend on the existing managed documents; explain that distinction.
Test restore after edits, page capture and image deletion; missingAtExport must name unavailable images as it does PDFs.
Corrupt descriptors, invalid geometry, swapped images, unsupported newer schema and dangling frozen links must be refused.
Keep v1/v2 archive-reader compatibility; adding schema metadata is not permission for a new archive/packet format.
Removing a card uses current retirement/history semantics; deleting its material erases owned metadata and rating content.
Deleting a separately referenced image sets image_material_id null, disables affected visual cards and retains their history.
Confirmation names affected cards and the remaining page-image copy; ordinary Undo must restore usability before final removal.
Do not auto-purge a shared source. Exercise stage failure, DB failure, restart recovery and purge failure reporting.
An old backup can deliberately restore old content; never claim deletion removed prior exported backups.
Test disk-full, cancellation and uncertain acknowledgement: no duplicate card, orphaned live file or changed original.
Scratch mutations must catch removed hash/bounds/identity/backup guards. Reviewer runs current AGENTS gates for implementation.

## Feasibility and 8 GB Mac budget

Engineering assessment: the image/rectangle/reveal proof can use plain HTML/CSS/inline SVG without a package.
Use basic SVG transforms and HTML controls; avoid dependence on SVG focus behavior, inert or native dialog alone.
Existing CSP allows a bounded data-image response; do not assume blob URLs or unrestricted asset serving work.
This is an implementation hypothesis, not observed macOS 12 WebKit or VoiceOver acceptance. No web research/network used.
PDF page rasterization remains a separate native/renderer feasibility problem; existing PDF splitting does not solve it.
A 4,000,000-pixel RGBA surface is about 15.3 MiB; two surfaces are about 30.6 MiB before decoder/GPU/IPC overhead.
That estimate is not process RSS. Bound headers before allocation, serialize decoding, release old surfaces on Next/close,
avoid thumbnails/full-deck canvases, and hash/read in native bounded work. No background preload of PDFs or entire decks.
Proposed proof targets: cached reveal under 100ms, first image usable under 1s, image-view RSS increase under 100 MiB,
and no continuing memory growth after 100 open/reveal/close cycles. Measure cold/warm timings, peak RSS and pressure
on a physical 8 GB Mac, recording OS/WebKit, build and image dimensions; these targets are not current results.
Also check 600x700, narrow browser layout and 200% text; keep native macOS 12.0–12.2 fallback acceptance separate.
Stop on memory pressure, label leakage or focus failure; reducing image limits is preferable to a new dependency.

## Decisions for the owner, with recommended defaults

| Actual choice | Recommended default and consequence |
| --- | --- |
| Start the temporary proof? | Approve 01b only first: PNG, one cover, no saved response/history. Observe whether she finds it useful before persistence. |
| Save visual cards and add schema? | After proof acceptance, approve 01c's add-only shape and visual identity extension. Existing C-D3 applies; no scheduler transition. Images/history enter complete backups; no new share format. |
| Capture PDF pages? | Keep gated until a no-package local raster trial passes minimum-OS/resource checks. Accept one visible managed page-image entry per selected page. If a dependency, OS or permission change becomes necessary, return with a concrete choice. |

Format/size limits and quarter-turns above are recommended trial limits, not another owner questionnaire.
No new answer retention is proposed. If she later wants typed recall history, scope its privacy/erasure separately.

## Risks and synthetic fixtures

Primary risks are answer leakage, misaligned covers, stale sources, unbounded decode memory and lost visual history.
Use newly authored, non-operational diagrams: a fictional three-part “practice panel” labelled Alpha/Bravo/Charlie;
a portrait flow diagram with edge labels, repeated words and Unicode; a transparent PNG with very small labels.
Make 0/90/180/270 variants, a 4MP boundary image, oversized/header-bomb and truncated files, and orientation-tagged JPEGs.
For 01d create a three-page fictional PDF with differing CropBox/Rotate, printed labels “iv”/“A-1”/“A-2”, and
two editions sharing a filename but different bytes. Include repeated diagrams on different physical pages.
Author fixtures ourselves with existing tooling; no AI image generation, proprietary charts or copied competitor assets/code.
Test original SHA-256 unchanged after cover/edit/reveal/delete/cancel, resize/zoom equivalence, offline restart/restore,
and actual keyboard/VoiceOver behavior. No real profile, real PDF, key, provider, installed real data or external network.
This planning round runs no app tests and claims no installed, release, learning-gain or minimum-spec result.
