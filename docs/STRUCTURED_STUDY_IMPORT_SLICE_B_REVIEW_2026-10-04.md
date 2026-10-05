# Structured study import Slice B — independent review, 4 October 2026

**Decision: corrections required before source integration.** Two P2 findings, SB-R1 and SB-R2, are consolidated into the [active model-neutral correction assignment](STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md). Owner approval of Slice B and D1–D9 remains effective. The accepted A2 and Slice A work is preserved.

## Reviewed submission

- Mac checkout: `/Users/rickymac/code/Flight-training-pr70-integration`.
- Branch: `codex/structured-study-import-slice-b`.
- HEAD/base: `6b418ee3c92f0ba64952d35278aa7c9999f9c824`, also origin/main at review preflight.
- Source, tests and implementation evidence are local, uncommitted and unpushed. The source is not accepted by this documentation PR.
- All 48 entries in the submitted manifest verified before review and after the temporary diagnostics. Manifest SHA-256: `e3652df6c83649ece09414428b0ea750efb35b5d6ff80ebb693359985d4cf16c`.
- [Frozen implementer report and receipt](evidence/structured-study-import-slice-b-review-2026-10-04/README.md) distinguish submitted results from independent results.

Review covered the actual diff, native validation/transaction/idempotency, browser durability/connection lifecycle, repository refusal, provenance mapping and regeneration, import dialog/refresh flow, tests and requirement mapping. No application was launched. All executed tests used synthetic fixtures and disposable test databases.

## SB-R1 — complete the promised confirmation preview (P2)

**Location:** `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx:226–285`, particularly the counts at 245–256 and discard statement at 282–284.

**Trigger:** choose accepted fixture `02-flashcards-and-test.json` and inspect the confirmation dialog before saving.

The preview displays title, aggregate card/question counts and top-level source claims, but no guide summary/sections, card faces, question/choice/answer/explanation content or individual reference labels/pages. It says references “are shown in this preview” and “Shown here but not saved” while omitting them. Choices and reference totals are also missing; the choice-ID discard category is omitted.

**Impact:** the owner cannot inspect what will be imported or review references before those references are permanently discarded. This violates approved D5 and contract §3.1, not an optional design enhancement.

**Independent reproduction:** two temporary real-library jsdom diagnostics fail, exit 1, while verifying zero save calls and zero imported rows. The summary “Cards and an explicit structured test.” and reference “Invented chart” are absent. Diagnostic source and full output are shared in the evidence directory.

**Correction:** implement a bounded read-only preview using the normalized `packet.data`, sharing the saved-view content rendering where practical. Let the owner inspect content and per-item references, labelled unverified and still associated with their items. Include the approved counts, creation/absence messages and accurate discard categories. State that nothing is uploaded and the answers originate in the packet. Plain text only; references do not become verified citations or saved data. Include regression tests proving inspection and cancellation write nothing and saving still excludes preview-only information.

## SB-R2 — normalize Unicode natively before semantic checks (P2)

**Location:** `src-tauri/src/study_packet.rs:408–459`, including both normalizers and code-point limits; option/title/idempotency comparisons consume their output.

The native normalizers omit NFC, although preparation §4.3 explicitly requires NFC before code-point counts and semantic validation. The implementation report discloses this as V1. The normal UI builder already normalizes text, which limits current user-facing exposure; the native command still promises independent validation and must enforce its own contract.

**Independent reproduction:** two native diagnostic assertions fail, exit 101; TypeScript controls for the same inputs both pass, exit 0:

1. Options `["Café", "Cafe\u0301"]` are canonically the same choice. TypeScript rejects `INVALID_ARGUMENT`; native validation accepts them.
2. A title composed of 200 repetitions of `e\u0301` normalizes to 200 code points. TypeScript accepts it; native validation rejects the raw 400-code-point form.

These are input-validation differences, not a demonstrated installed data-loss incident. They disprove general native/browser normalization equivalence. The existing 45 shared cases do not cover this gap.

**Correction:** apply full Unicode NFC in both native normalizers before bounds, duplicate choices, title equality, persistence and retry comparison. Add these cases to the shared contract and native tests, plus stored canonical text and an equivalent retry.

**Existing-production-library direction:** `unicode-normalization = 0.1.25` already ships as a normal production dependency through `lopdf -> stringprep`, and is present in the accepted Cargo.lock with checksum `5fd4f6878c9cb28d874b009da9e8d183b5abc80117c40bbd187a1fde336be6e8`. Codex permits promoting that exact existing resolved crate to a direct Rust dependency solely for SB-R2. No new package/version, resolution upgrade, npm change or broader dependency adoption is authorized. Check licensing/notice needs; report the exact lockfile changes. This adds a direct declaration for an existing production library; it does not authorize adopting a new production package or reopen the owner's feature decisions. Do not implement a partial hand-written Unicode table.

## Independent verification

| Check | Observed result |
| --- | --- |
| Submitted SHA256SUMS | 48/48 match before and after diagnostics |
| Five focused frontend files: service, structured import, repository, import dialog, material detail | exit 0; 110 tests pass |
| Native `study_packet::` | exit 0; 60 pass, zero failures/ignores |
| SB-R1 preview diagnostics | exit 1; two expected failures |
| SB-R2 native diagnostics | exit 101; two expected failures |
| SB-R2 TypeScript controls | exit 0; two pass |

Temporary diagnostic files were removed; the modified native test file was restored byte-for-byte. An initial native diagnostic invocation used the repository root without a manifest and exited 101 before running tests; it was corrected with an explicit manifest. That setup error is not counted as a defect reproduction.

The implementer supplied full-gate logs reporting 2,448 frontend passes/four skips, 331 Rust passes/six ignores, and successful final typecheck/build/Clippy/fmt/lock/diff checks. Those are **implementer observations**, not independently rerun full-gate results. Their initial test typing failure and shell retry are disclosed in the frozen report. A duplicate full matrix was not run while confirmed corrections remain.

## Other implementation decisions

V2 (AppHandle resolving app_root), V4 (regeneration names the individual aid), V5 (generated lowercase UUIDs), V6 (reject present-but-empty aid), V7 (bounded busy timeout/manual safe retry), V8 (refresh callback options), V9 (desktop-only picker) and V10 (actual /study route) are reasonable reconciliations with the existing code. V3 reuses A2's last durable snapshot and serialized write path; the focused recovery/foreign-key tests pass. No further blocker is raised for those choices. V1 is not accepted and is covered by SB-R2.

Four installed observations remain UNVERIFIED (MAC-23): macOS 12.0–12.2/current WKWebView, VoiceOver, offline installed launch, and installed backup/restore. Source tests do not certify them. No account work, real data, provider calls, packaging, signing, release publication, Slice C, replacement flow or migration is assigned.

## Next action

One implementer completes SB-R1 and SB-R2 in the existing checkout under the [correction prompt](STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md), then stops for independent re-review. Preserve original evidence and publish a new correction receipt. Codex owns source acceptance and Git integration after the findings and applicable gates pass.
