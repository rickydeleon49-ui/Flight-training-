# Claude: finish the structured-import contract's source-notes boundary

Use this prompt in Claude on the Mac. The [independent re-review](STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md) resolves R1–R4 and identifies one remaining prototype defect, R5. This assignment completes preparation; it does not start production adoption.

---

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-` on `codex/structured-study-import-contract`. Finish the remaining contract/prototype correction and evidence cleanup. Keep the package uncommitted and unpushed for Codex's focused re-review. Do not implement a production slice.

## Starting state

Expected HEAD/base: `8fb3b7fe7f8ae425b41c597549f930e1aadb326a`. The last submission contains 129 paths: two modified tracked documents and 127 untracked paths. Before editing, verify all 128 hashes in `docs/evidence/structured-study-import-contract-2026-10-03/correction-receipt-2026-10-03.txt`. Its full SHA-256 should initially be `ea0b0f79f8264c6fbcd22f73563f37b3a1913b3345886dae1c47e23ca867791d`.

Codex has published the re-review separately on main. Read the report, this prompt and the new diagnostic through GitHub or `git show origin/main:<path>` if absent locally. Do not reset, stash away, switch away from or overwrite the dirty package to obtain them. Preserve any unexpected changes and identify their scope. Codex will handle integration after acceptance.

Read the corrected contract §§2.4, 2.13, 3.5 and 8, the implementation handoff, current expected outcomes, corrected validator, regression suite, fixture runner and canonical persistence function. The new evidence is under `docs/evidence/structured-study-import-rereview-2026-10-03/`. Keep the existing ownership and foundation/M2/installed gates.

## R5: prevent undeclared loss of guide source notes

Codex confirmed this exact input combination: one or more valid questions, non-empty `guide.sourceNotes`, and no substantive guide summary/sections or flashcards. The current validator accepts it. The preview shows the notes, but `payload.studySet` is null and `discardedOnSave` does not mention those notes. The same problem occurs when summary and sections are explicitly empty.

This field is `guide.sourceNotes`, which the contract maps into a saved study set. It is not the top-level unverified claim `source.note`, whose omission is already intentional and disclosed.

Define and implement one consistent rule. The conservative proposal is:

- Non-empty normalized `guide.sourceNotes` requires a persistable study set: a substantive guide or at least one flashcard.
- If neither exists, reject the unsupported combination with a fixed, non-echoing error at the appropriate contract-owned path.
- Standalone notes still do not count as a substantive guide or make an otherwise empty packet valid.
- Blank optional notes continue to behave as absent.
- Notes alongside cards or a substantive guide remain accepted and are preserved exactly after the established normalization.

You may propose a different coherent rule if justified, but it must preserve the displayed content, state any format-semantics change explicitly, and align every affected layer. Do not simply hide the notes from the preview, append them to an explanation, copy them into unrelated fields, or silently redefine a notes-only object as a substantive guide. Do not ask the owner to choose a routine parsing rule before completing useful preparation; document the conservative proposal clearly.

Update semantic validation, preview/persistence mapping, warnings/disclosure if affected, canonical hash behavior, DTOs if their shape changes, and contract/schema descriptions together. Reuse the existing normalization and fixed diagnostic boundary. Do not create a database field, migration, file write or import UI.

## Prove the boundary

Add permanent synthetic fixtures/regressions for both failing cases and preserve Codex's four controls:

1. Questions with sourceNotes-only guide.
2. Questions with empty summary/sections and non-empty sourceNotes.
3. Cards plus sourceNotes preserve the notes.
4. Substantive guide plus sourceNotes preserve the notes.
5. Questions with blank notes remain valid.
6. Standalone sourceNotes remain an empty packet.

Expand these where meaningful: omitted versus empty arrays, summary normalized to empty, sections present, flashcard-only and combined packets, whitespace/NFC normalization, and non-empty notes containing a private sentinel. Inspect the actual persistence payload, preview flags, rejection path/code and any discard disclosure. Never print the sentinel through diagnostics.

Run the new checks against the currently reviewed corrected prototype first and record the expected failures. Then run them against the fix. Port Codex's diagnostic into permanent tests or adapt it to the documented result shape with an explanation. Add a deliberate defect that removes the new guard or restores silent omission, and show that the new checks catch it. Keep the existing R1–R4 tests and privacy layers unchanged.

For accepted packets, test that guide source notes are preserved in the canonical persistence form and that changing a saved sourceNotes value changes it. Preview-only source claims/references/IDs must still be excluded from that form. For rejected combinations, no successful preview/persistence payload should be returned and no write occurs.

## Correct the evidence and CI descriptions

The actual mutation results show **16 caught and three neutralized**, 19/19 behaving as expected. The neutralized cases are M10, M12a and M12b. Correct current README/handoff summaries that say 15/four. Preserve original receipts and results, and add a dated clarification where needed. Recalculate all counts after adding the R5 mutant; report caught and neutralized separately.

The implementation handoff's merge gate describes Windows/macOS as the existing required CI matrix. Inspect `.github/workflows/checks.yml`: the required `Tests, types, and the data-safety guards` check currently runs on Ubuntu. Describe required exact-head CI accurately, and keep separate platform build, compatibility and installed/release evidence visible. Do not change workflows, weaken coverage, trigger packaging or treat a Linux documentation check as Mac/Windows installed testing.

## Verification scope

Use the exact locked scratch dependency versions already reviewed: Zod 4.6.5 and react-markdown 10.1.0, with scripts disabled. Keep dependencies outside the repository. Preserve `jitless`, safe rendering, the depth fallback, sourcePage null, import DTOs and the foundation/adoption gates.

Run focused new checks while correcting. At completion, run the validator fixtures/boundaries, permanent regressions, adapted original diagnostics, relevant mutation checks, schema/fixture consistency and the compiling DTO example. Test aggregate exit propagation only if you change the runner. Do not rerun unchanged renderer/depth/API scans or full application/Rust matrices without a new reason.

Add a new evidence folder or clearly dated R5 files. Keep original and prior correction receipts/results unchanged. Update the contract's finding map, implementation handoff, evidence README, expected outcomes, STATUS and project handoff to say R1–R4 resolved and R5 corrected pending independent re-review. Keep proposed product decisions and missing owner approvals labelled accurately.

Check links and whitespace, including untracked files. Confirm production source, repository manifests/locks and workflows remain byte-identical. Do not build, mount, install or launch artifacts; access the owner's application profile; provision accounts/signing; use a live provider or real training data; contact the Windows owner; or begin another roadmap feature.

## Deliver and stop

Provide exact branch/base, complete changed/new inventory and full hashes, R5 issue-to-fix map with permanent test names, before/after results, mutation counts, schema and DTO results, commands/counts/exit codes, intermediate failures and the remaining gates. Distinguish your results from Codex's independent results. Leave everything uncommitted/unpushed and stop for focused re-review.
