# GEN-01c-2 implementation report — 20 October 2026

Codex started the round (implemented items 1–7 and all 14 tests); Gemini finished the round (verified typecheck, gates, wording, gemini.ts wiring, and completed verification).
Uncommitted implementation on branch `codex/offline-gen`. Claude reviews, tests and merges.
No new dependencies, migrations, Cargo.toml or package*.json modifications.

## Screens, states, and exact user-facing strings
- Entry button (`MaterialDetail`): "Make a study kit from this PDF" (disabled in browser: "Making a PDF study kit works in the desktop app.")
- Progress state: "Pulling study ideas from your PDF…" with working "Cancel" ("Stopped. Your saved work is still here.")
- CACHE_MISSING: "Your PDF’s text needs reading first. Read it on this Mac, then try again." ("Read this PDF’s text" / "Try making the kit again")
- SOURCE_CHANGED: "The PDF or page choice changed since this kit was made. Rebuild it when you’re ready." ("Rebuild study kit")
- Empty / no text found: "This PDF didn’t have text the kit could use."
- Storage failure on save: "Your kit couldn’t be saved. Your draft is still here; try saving again." (Retrying idempotent; "already_saved" is success)
- Provenance label: "Pulled from your PDF on this Mac" (never "AI-generated", "verified", "official", or "accurate")
- Edit labels: "Edited by you", "Corrected by your instructor"
- Reminder: "Compare this kit with your PDF, current FAA guidance and your instructor."
- 03b question editor: "Review draft questions" (opens unsaved, never autosaves, respects active attempt / staleness gates)
- Restart: "Continue reviewing your study kit" (recovers draft from journal, never autosaves)
- gemini.ts: Filtered pdf-kit from listGeminiJobs(); no Gemini user-facing wording changed.

## Tests and verification
- Cargo test run 1: cargo-test-1.log EXIT 0 (973 passed, 0 failed, 11 ignored)
- Cargo test run 2: cargo test -m src-tauri/Cargo.toml EXIT 0 (973 passed, 0 failed, 11 ignored)
- Cargo fmt check: cargo-fmt.log EXIT 0; cargo clippy: clippy.log EXIT 0; cargo lock sync: cargo-lock.log EXIT 0
- Vitest run 1: npm-test-1.log EXIT 0 (203 files passed, 4 skipped; 4239 passed, 6 skipped)
- Vitest run 2: npm test EXIT 0 (203 files passed, 4 skipped; 4239 passed, 6 skipped)
- Focused suites: MaterialDetailPdfKit.test.ts (18 passed), pdfStudyKitDraft.test.ts (3 passed), pdfStudyKit.test.ts (1 passed)
- TypeScript typecheck: typecheck.log EXIT 0; npm run build: build.log EXIT 0
- Schema-14 helper: schema14.log EXIT 1 (25 passed, 1 failed solely due to sandbox pgrep; reviewer reruns outside sandbox)
- git diff --check: diff-check.log EXIT 0

## SHA256 of changed and new files
5fe24a75ada658d172a82003b2702632901a1ad4530701650663fc54621c52ff  src/data/pdfKitSources.ts
b3e5fc42e75949ce672adc549f08144fa36bfeacadde77d20fd2fe4c38638305  src/data/pdfStudyKitDraft.test.ts
f93e42df5c0e62e791580cd32a75e80eb023dfa4e06e01be41e8143a5145c0e7  src/data/pdfStudyKitDraft.ts
fe8e4e80f4ed05ff4e1e9f350e23f0e598ce9357771f7d59ef6420459b0aabc7  src/data/practiceAuthoringDraft.ts
3f09c9c8505173f438ed4a17c77441f199879405bbcfcf86ed8b8ba827a753ac  src/data/repositories/documentRepository.ts
ac8129cd8e6eeb8c9f406dd7b46267a18220a91e8b276cabadc2e32d18c4244a  src/data/repositories/practiceSessionRepository.ts
bae38e7286b8c2851e0012431098b7998d89715c39c9865a1f6fe8f235673b2a  src/domain/types.ts
a7f7efd7247c72e02aab81aba92b6f9340466c2ac58ae0bde7f27263a0a4baa8  src/logic/pdfKitLabels.ts
742f37f20cf9ea8a0017f74fad3b54636634603183d64d6b571738dcc5639f67  src/logic/studyContentProvenance.ts
0f3d564460079711859b11c75fc8e0d62e58396900c7ea61de258f45724b930b  src/logic/studyExport.ts
c6696e40cd48108c734ec41fec04ff2dc4d5d89cb4795121b7b235a90c7fdf34  src/logic/studyHandout.ts
5c5c110e493a0527699093505e1ae428a361f0a7cb3a8d4c1d8633037e618d22  src/pages/StudyLibrary/ExportStudyDialog.tsx
10e273b0fd42184aaab463d1358981a0bb5c0b13e5ce152bf72e8ee6c55bdd58  src/pages/StudyLibrary/MaterialDetail.tsx
7cb546bc620491f860dcde50f46b206736a057cf9db52862ac230aabeb538184  src/pages/StudyLibrary/MaterialDetailPdfKit.test.ts
6698f68dd77496ba42c9eda8ab0021aa81178262bfd05ddb97237fbfa559b9ba  src/pages/StudyLibrary/PdfItemLabel.tsx
c52bb38d70c473d8f9fd9065374408dd238600e73e0d1971faa141748e788c15  src/pages/StudyLibrary/PdfStudyKitPanel.tsx
b92a41d4c99abdb91ecb2913f185e5b2d8b1199df2859a76a249a45362eeaec4  src/pages/StudyLibrary/PracticeHistory.tsx
08b201228dd7ecfc47abb129cfc7b2988a9d06f1c6b6ca13b6794d0b44b2e608  src/pages/StudyLibrary/PracticeTestEditing.tsx
1fe70210195cc82033517b03191164f60dba6bfda8516ff02f0e86ad80f92f66  src/pages/StudyLibrary/PracticeTestPanel.tsx
72881370bd09531df5a53ade1970b5c12a6ce215bb235b2e6c0c213049b8856b  src/pages/StudyLibrary/StudySetEditor.tsx
3f70bd9494aab82be7562bc0c76611fb2cf7e94e37929c1c1612d4879984665e  src/services/documents.ts
ed162fc77f193f51ed2841a86ca2fcf94cc2e6b62e28dc4d5c6c0378fe5e9de9  src/services/gemini.ts
38c96d2254af4fee513521ec79b2efe31bbceccd1ff59bfdcacf8d198df55537  src/services/pdfStudyKit.test.ts

## Correction r1
- P1: Kit release on complete save/leave-out, discard action, confirmed rebuild, plain full-journal message, and retry flush implemented in `PdfStudyKitPanel.tsx`.
- P2: Set header shows PDF label only when all items are valid PDF; mixed sets retain provider/model/date and note PDF items; invalid items affect only their labels.
- Tests (11 + 2 mutants): all 13 verified failing before fix/mutant, then passing. Native journal unblocks Gemini after kit acknowledgement (974 tests passed).
- Mutants: removing `|| changed` in `save()` and replacing `if (outcome.cancelled)` with `true` in `cancel()` both failed their tests before exact restoration.
- Gate receipts in `docs/evidence/offline-gen-01c2-2026-10-20/correction-r1/`:
  - `cargo-test-1.log`, `cargo-test-2.log`: EXIT 0 (974 passed, 0 failed, 11 ignored)
  - `cargo-fmt.log`, `clippy.log` (-D warnings), `cargo-lock.log`: EXIT 0
  - `npm-test-1.log`, `npm-test-2.log`: EXIT 0 (203 passed / 4 skipped; 4251 passed / 6 skipped)
  - `typecheck.log`, `build.log`, `schema14.log` (26 passed), `diff-check.log`: all EXIT 0
- No new dependencies, migrations, network calls, or git commits. Everything left uncommitted.

## Correction r2

- P2: Discard retains the draft, mirrors and review/discard offers with “Your study kit couldn’t be discarded. Try again.” until acknowledgement or journal absence confirms removal; failed cancellation never acknowledges.
- P3: Manual sets containing only PDF items retain “Pulled from your PDF on this Mac” and add “Some source details are unavailable” for invalid sources; item labels and Gemini/import headers are preserved.
- Tests: all 9 requested regression cases failed before the fix; 56 focused tests now pass. Full npm test passed twice (4,265 passed, 6 skipped each); typecheck and build passed through the receipt runner with Node 22.
- Receipts: `docs/evidence/offline-gen-01c2-2026-10-20/correction-r2/`. Default Vite config writes hit sandbox EPERM; permitted `--configLoader runner` fallback passed. `git diff --check` omitted under the owner's no-Git instruction; no Git operations, everything uncommitted.
