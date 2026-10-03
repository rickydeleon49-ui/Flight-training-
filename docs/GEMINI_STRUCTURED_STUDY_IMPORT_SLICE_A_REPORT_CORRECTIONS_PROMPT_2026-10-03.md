# Gemini: correct Slice A handoff documentation against the actual source

The owner-assigned Slice A implementation is still local in `/Users/rickymac/code/Flight-training-` on `codex/structured-study-import-slice-a`, HEAD/base `696b07021f74104b800bc4a37c9ccb4c437a1abb`. Continue on this same dirty branch and leave all changes uncommitted/unpushed for Codex review.

Codex independently closes SA1: control 231/exit 0, 22/22 expected mutation outcomes, 19 caught/three neutralized, zero infrastructure errors. A separate real CLI diagnostic with only M10's expected classification inverted exits 1. No further mutation-runner or production-code change is requested. The remaining review finding is **SA2: inaccurate implementation/report evidence**.

## 1. Verify before editing

Fetch/read the new `STRUCTURED_STUDY_IMPORT_SLICE_A_REVIEW_2026-10-03.md` and its evidence from origin/main with git show or GitHub, without switching, resetting, stashing, cleaning or merging this dirty source branch.

All 92 entries in your submitted final-hashes receipt verified before Codex review; its SHA-256 is `ebfc2c7343a43951b396daf0f65280891c7d4ca841a30ba578828829d4642a68`. Codex's separate snapshot covers all 93 files including that receipt. Verify the reviewed state or explain/preserve any intervening change.

The original 81-file snapshot has only one modified file: Rust formatting plus cancellation-test lint correction. Preserve all correct code, dependencies, fixtures and tests. Keep the recorded owner exception and existing source-only scope; no fresh approval is needed for this documentation correction.

## 2. Rewrite the report from actual code

Read the report next to limits.ts, scan.ts, schema.ts, semantic.ts, diagnostics.ts, payload.ts, types.ts, services/studyPackets.ts, study_packet.rs and the accepted contract. These sources are under the primary checkout. Correct every unsupported detail, not just the first size number.

Use these verified facts:

- File cap is 4 MiB / 4,194,304 bytes in TypeScript and Rust. Scanner bounds are depth 8, 32 keys/object, 64 code points/key, nine integer digits and 250,000 values. String caps are field-specific normalized code-point limits. There is no generic 64 KiB string or 10,000-value bound.
- IDs allow upper/lowercase ASCII letters, digits, dot, underscore and hyphen, starting with a letter/digit. Item length is 1–64; choice/answer length is 1–32. Copy exact regexes from source if needed. Uniqueness is scoped separately to cards, questions and each question's choices.
- Name actual fixed directive/legacy-answer sets. Do not invent targeted classifications for other unknown fields.
- List the actual credential patterns. Do not claim JWT detection.
- The diagnostic boundary is publicError/failure, not cleanDiagnostics.
- Canonical persistence content is compact JSON of a fixed-order nested array; it is not sorted-key or indented JSON. The helper returns a string for the caller to hash. It does not itself produce a digest. R5's rejection is in semantic validation; payload preserves accepted notes.
- Native picker uses the Tauri dialog extension's blocking_pick_file inside spawn_blocking. It is not rfd::AsyncFileDialog. Both dialog waiting and file work are off the UI thread.
- Desktop wrapper checks isTauri, returns null on cancellation or picked metadata/text, and performs no automatic validation. Pure validation is a separate caller step; no preview/payload is returned by the picker wrapper.
- Restore accepted finding names: R1 private diagnostics; R2 preview provenance; R3 import DTO/provider and reader/hash boundaries; R4 conflicting gates; R5 source-note loss. Fixture-drift and bounded scanning are additional checks, not replacements for R3/R4.

Describe what actually exists and its limits. Do not change implementation to match an inaccurate earlier description. Keep platform claims labelled: Node simulations and reader/helper tests do not establish real picker, WKWebView/CSP, macOS12, Windows or installed results.

## 3. Correct receipts without erasing history

Preserve the original authored implementation report and verification receipt as dated snapshots, or issue a dated corrected version with an explicit errata map. Keep interrupted mutation evidence unchanged. Codex already preserves verbatim reviewed originals in its evidence.

Your receipt calls the host macOS26.5.0, while prior/current host observations are macOS27.0.1; SDK26.5 is separate. Verify the actual host and explain the correction. Do not rewrite a historical OS claim from an unsupported assumption.

Separate process-exit evidence: normal --self-test exits 0 after recognizing an intentional mismatch. Your API-level negative log says “would exit.” Cite Codex's actual copied-runner CLI exit-1 evidence with exact scope, or provide equivalent measured process evidence; label Codex results separately from your own. No runner change or repeated 22-mutant run is necessary just to repeat that established result.

At review, there are 93 submitted files: five tracked modifications and 88 untracked files. The 92-entry receipt excludes itself. Recompute final file counts after documentation changes/snapshots rather than copying these counts blindly. State explicitly which receipt is excluded from its own inventory.

## 4. Reconcile and verify only the correction

Update STATUS, PROJECT_HANDOFF and evidence README to describe the corrected handoff as pending Codex re-review. Preserve prior publication links and outstanding gates. Avoid claims of source acceptance or merge.

Regenerate a new dated final hash receipt, preserving the reviewed receipt. Check every intended tracked/new file, relative link, source anchor and whitespace. Confirm code, runner, fixtures, manifests, locks and notice bytes remain identical to the reviewed submission. Report any administrative snapshots added.

Do not rerun the full frontend/build/Rust matrices for documentation-only corrections. Retain the accurately labelled existing results. If you discover a new real code defect, stop expansion, describe it precisely and obtain Codex review before unrelated changes.

## 5. Final handoff and boundaries

Provide branch/base and documentation revision used, receipt verification, complete SA2 claim-to-source errata map, corrected environment/API/limits/hash descriptions, measured-versus-reported evidence, full final inventory/counts and new receipt SHA-256, preserved historical files, unchanged-source proof and link/whitespace results.

No production, UI, persistence, migration, dependency, provider, signing, installed, release or Windows-owner work. A2/M2, Slice B/C and release gates stay pending.

Leave the primary source branch uncommitted/unpushed. Stop for Codex's focused re-review, integration and required source CI.
