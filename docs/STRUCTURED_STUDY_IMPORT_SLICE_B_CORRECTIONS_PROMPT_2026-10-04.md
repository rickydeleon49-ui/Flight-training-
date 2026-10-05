# Finish Slice B: confirmation preview and native NFC — model-neutral assignment, 4 October 2026

**Completed and historical:** [Source acceptance](STRUCTURED_STUDY_IMPORT_SLICE_B_ACCEPTANCE_2026-10-04.md) closes implementation and SB-R1/SB-R2. Do not restart this assignment. Use the [next practice-session scope assignment](M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md); implementation of that proposed next scope needs owner approval.

Any owner-selected implementation model may execute this task. Use one active implementer. Codex remains the senior reviewer and Git coordinator.

## Objective and stopping point

Finish the existing structured study import Slice B implementation by correcting **SB-R1 and SB-R2** from the [independent review](STRUCTURED_STUDY_IMPORT_SLICE_B_REVIEW_2026-10-04.md). Preserve the atomic persistence, provenance, safe retry and accessibility behavior that already passed focused review. This assignment supersedes the initial implementation prompt for remaining work; do not restart five phases or switch to release preparation.

Work in `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/structured-study-import-slice-b`, with uncommitted implementation based on `6b418ee3c92f0ba64952d35278aa7c9999f9c824`. Leave the corrected implementation **uncommitted and unpushed**, ready for Codex re-review. Do not create a competing branch or touch the dirty primary checkout.

The owner already approved Slice B and all D1–D9, including the older-version limitation; A2 acceptance and the check-in waiver remain valid. Do not request those decisions again. Installed/signing/release gates stay separate.

## 1. Establish the starting state once

1. Confirm the path, branch, HEAD and status. Verify all 48 files against `docs/evidence/structured-study-import-slice-b-2026-10-04/SHA256SUMS`; its reviewed SHA-256 is `e3652df6c83649ece09414428b0ea750efb35b5d6ff80ebb693359985d4cf16c`.
2. If files changed unexpectedly, inspect and preserve the competing work before editing. Do not reset, clean, stash blindly, rebase or merge over uncommitted files.
3. Read the review and diagnostic sources/receipts in `docs/evidence/structured-study-import-slice-b-review-2026-10-04/`. If new review docs are not in this older checkout, fetch origin and read them with `git show origin/main:<path>`, or open their GitHub versions. Do not pull over the working tree.
4. Read contract §3.1/§2.8/§2.9 and preparation §4.3. Reuse accepted Slice A validation/mapping. No new design/preparation audit is needed.

## 2. SB-R1: make the confirmation truthful and useful

Current `PreviewView` in `ImportStudyPacketDialog.tsx` shows metadata but omits the content and references it claims to show.

Build a bounded, read-only preview from normalized `packet.data`:

- Guide summary, section headings/body, source notes; card fronts/backs; structured questions, choice text, the packet's answer key and explanations. It may use paging, disclosure or sampling for the short content preview, with clear indications of what is shown and access to inspect remaining items. Avoid rendering the maximum packet into one unbounded wall of text.
- Reuse or extract the saved-view text rendering where practical. Keep rendering plain text; no Markdown, HTML injection, URL fetching or provider calls.
- Per-item source reference labels and optional pages remain associated with their actual guide section/card/question. Mark them unverified. Ensure the owner can inspect every reference before it is discarded; do not silently truncate the reference inventory with no way to reveal it.
- Counts for sections, flashcards, questions, choices and references. Clearly state whether a guide and/or test will be created, including the no-practice-test case.
- Every accepted validator warning and the imported-content disclaimer.
- Accurate discard disclosure for source claims, references, packet item IDs and choice IDs when present. Remove misleading “shown here” claims if the relevant information is not actually shown.
- Preserve filename and original-byte hash identity. A compact hash display is fine if the full value is accessible.
- Confirmation must state that nothing is uploaded and that answers come from the packet, rather than Her Flight Deck or Gemini.

Keep the save payload unchanged: reference labels/pages, source claims, export IDs and choice IDs stay preview-only. Keep `sourcePage: null`, fixed import provenance and minted preview identity. Preserve synchronous double-click prevention, safe same-identity retry, refresh-failure handling, both modal paths and cancellation.

Add permanent tests that fail on the reviewed implementation and pass on the correction. Adapt the shared reviewer diagnostics, then cover at least guide/section/card/question preview, associated reference labels/pages, counts/discard disclosure, guide-only/test-only absence wording, and plain-text rendering. Verify preview expansion/navigation and cancellation cause zero save calls and zero imported rows. Verify the subsequent save continues to discard preview-only fields and retains the same operation identity across retries. Prefer meaningful scenarios to an exhaustive layout assertion matrix.

## 3. SB-R2: enforce native NFC before validation and saving

The native line/block normalizers currently normalize newlines and whitespace but skip NFC. TypeScript already applies NFC. Implement full NFC before all relevant length and semantic checks.

A narrowly permitted implementation path is to promote the **already-resolved** `unicode-normalization` crate at **exact version 0.1.25** to a direct dependency in `src-tauri/Cargo.toml`. It already ships as a normal production dependency via `lopdf -> stringprep` and exists in the accepted lockfile. Preserve its current checksum and all resolved package versions. This permits only a direct declaration for an existing production library, not adoption of a new production package. Document any root dependency/lock synchronization change and satisfy existing licensing/notice requirements. Do not add a different library/version, upgrade or add resolved packages or change npm dependencies. Do not hand-code an incomplete Unicode composition table.

Apply composition consistently to line and block fields so bounds, title equality, duplicate choice detection, stored content and idempotent retries all consume canonical text. Keep JavaScript-compatible whitespace behavior (including NBSP/FEFF and excluding U+0085) and existing error order/codes/redaction.

Add permanent shared/native regressions:

1. `["Café", "Cafe\u0301"]` is rejected as `INVALID_ARGUMENT` by both validators after canonicalization.
2. A title containing 200 repetitions of `e\u0301` is accepted and becomes 200 NFC code points on both sides.
3. Canonically equivalent material/aid titles match.
4. Stored line/block content is canonical; a canonically equivalent retry returns `already_saved` without row/timestamp changes.
5. Retain real combining sequences that do not compose. Check full Unicode behavior rather than fixing only the accented Latin examples.

Extend the compact shared contract fixtures so the native/browser equivalence claim includes the new NFC boundaries. Run the reviewer diagnostic assertions unchanged in meaning. Preserve unknown-key rejection, strict provenance, transaction rollback, stored-content comparison, bounded lock wait and fixed sanitized errors.

## 4. Verification with good pace

Use the documented Mac toolchain: scoped Node 22 and rustup stable paths, `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Tests use synthetic fixtures and disposable databases only.

Run the new regression cases first and show fail-before/pass-after. Then run the affected frontend files, existing dialog fallback tests if rendering was shared/changed, shared-contract cases and native `study_packet::` tests. Do not repeat all eleven historical mutations: their unchanged results remain evidence; repeat only a mutation whose protected implementation changed, if needed.

Once the corrections are stable, run **one sequential final local gate** because both frontend and Rust changed:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `cargo test --locked --all-targets` in src-tauri
- `cargo clippy --locked --all-targets -- -D warnings`
- `cargo fmt --check`
- `npm run test:cargo-lock`
- `git diff --check`

Do not run overlapping full matrices. Do not rerun dependency installation without a reason. Record exact commands, exit codes and final counts; disclose failures and rerun only affected checks after fixing them. Full-suite successes are implementation evidence until Codex independently reviews them.

No installed app launch, test-account creation/use, owner data, Gemini calls, packaging, signing, notarization or release. Keep all four installed observations UNVERIFIED.

## 5. Evidence, documentation and handoff

Preserve the original receipt, report, mutation results and logs. Add correction logs and a correction report with SB-R1/SB-R2-to-test mappings, fail-before/pass-after, dependency/license reconciliation, final gate results and a fresh manifest covering all changed and submitted files. Use tracked `.txt` log names rather than ignored `.log` files.

Update STATUS, PROJECT_HANDOFF and MAC_PARITY_CHECKLIST to “SB-R1/SB-R2 corrected, pending Codex re-review”; incorporate the latest review status without replacing newer main documentation with an older snapshot. Do not claim acceptance, installed verification, source publication or release readiness. MAC-23 remains unverified.

Finish with the exact checkout/branch/base, changed-file list, old/new hashes, meaningful test names/counts/exit codes, evidence paths and any actual remaining limitation. Stop for Codex re-review with everything uncommitted and unpushed. No Slice C, migration, replacement flow, second preparation package or release task.
