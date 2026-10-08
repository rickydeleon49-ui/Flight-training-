# M2 card review C2: independent production source review — 2026-10-07

**Decision: changes requested. C2 source is not yet accepted for integration.** The owner approval of C2-D1–D9 is recorded in the submitted implementation evidence; no repeat approval is needed for these corrections.

Reviewed source: `/Users/rickymac/code/Flight-training-c2-implementation`, branch `codex/m2-card-review-c2-implementation`, base/HEAD `cc84964737067cfa5fa5ed20ddf125a74b10b003`; uncommitted source verified against all 30 submitted hashes before and after review. The implementation checkout and both older dirty clones were not edited. Independent execution used an isolated reviewer checkout.

## Confirmed findings

### C2SRC-R1 — P2: metadata-only invalidation misses replacement content

`src/pages/StudyLibrary/StudyLibrary.tsx:78–84` constructs the review key from material metadata plus `[sourceMaterialId, updatedAt, flashcards.length]`. Two different sets with the same count and saved timestamp produce the same key, so the due, history and binder streams keep their prior results even after AppData publishes the replacement.

The frozen real-router/disposable-SQLite diagnostic replaces two cards with two different cards through `AppData.mutate` and the production `saveAiStudySet`, with the clock unchanged. The database reader independently returns **2 new cards**; the mounted due view keeps **1 due / 1 new**. The companion history case keeps a current-version label for a rating now belonging to the earlier card version. Both fail on the submitted source. This also matters when restored data retains timestamps; count and timestamp are not content identity.

Use a reliable published data revision or another content-sensitive invalidation signal. Do not add unbounded JSON serialization/hashing to each render. The signal must invalidate all three C2 consumers after a completed refresh/mutation, including state-only review changes and restore/replacement, and retain the controller's generation/ownership safeguards. A broad monotonic AppData publication revision is acceptable if its scope and extra read cost are disclosed. Promote both regressions and add state-only and held-read coverage for the chosen signal.

### C2SRC-R2 — P2: an open history viewer retains obsolete provenance

`src/pages/StudyLibrary/StudyLibraryHistory.tsx:85` copies the full history row into independent `inspecting` state. Later stream enrichment updates the list's row but cannot update that copy.

The frozen diagnostic uses only visible enabled controls: start **Check versions**, open **View card** on a pending row while the check is held, then release the read. The list correctly resolves the provenance; the dialog still says **Not checked against the current cards yet**. This fails independently of R1. No hidden/inert controls are clicked in the final frozen repro.

Store the selected event ID and resolve its current row from the stream, or explicitly reconcile/dismiss the viewer on stream updates. Preserve its immutable historical front/back text. If its row disappears on invalidation, filter change, deletion or refresh, close it rather than showing an orphaned record. Prevent obsolete completions from reopening it. Promote this regression and cover a selected row disappearing while a newer read is held.

## Independent evidence

| Check | Result |
| --- | --- |
| Submitted source hashes | 30/30 verified, before and after |
| Submitted evidence manifest | 57/57 entries verify |
| Existing affected frontend suites | 100 passed / 1 skipped, exit 0 |
| Typecheck of submitted source | exit 0 |
| Focused native `card_library` tests | 5 passed, exit 0; includes all 35 shared fixture calls and byte-identical DB proof |
| New frozen UI diagnostics | 3 failed / 0 passed, exit 1; assertion failures, no reported unhandled errors |

The initial diagnostic harness used an incorrect due-input field and a detached DOM reference; those were corrected before freezing. A separate intermediate experiment clicked Refresh behind an open dialog and is **not** used as the final R2 proof. Both exploratory receipts are retained and explicitly distinguished from the final diagnostic. No production correction was applied by the reviewer.

The implementer's complete gate reports 2,799 frontend passes / 5 skips / zero unhandled errors and 420 Rust passes / 6 ignored, plus clean build, Clippy, fmt, lockfile, hygiene and migration checks. These are submitted receipts, not a repeated independent full gate. The independent checks above are the bounded reruns performed for this review. Passing full gates do not cover the two newly reproduced UI defects.

The route choice (`/study?tab=history`, preserving practice history), C1-consistent due/new semantics, 2,500-card history budget, UTF-16 code-unit tie order and bounded legacy timestamp cursor handling are reasonable disclosed integration choices and are not findings. Existing planning proof acceptance remains valid. No installed Mac, VoiceOver, signing or release claim is made.

## Publication and next action

This documentation publication includes the exact submitted implementation evidence, the 30-path source snapshot under the reviewer pack, raw independent receipts, and the frozen diagnostic. Production application files remain at the accepted base in this documentation PR. The implementation branch remains uncommitted for correction/re-review; no source acceptance, release or feature continuation is authorized by this review.

Continue with [the focused correction prompt](M2_CARD_REVIEW_C2_SOURCE_CORRECTIONS_PROMPT_2026-10-07.md). Do not restart the accepted planning proof, rewrite the native readers or add unrelated roadmap features.
