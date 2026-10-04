# Slice B preparation: validation correction review

Reviewed on 3 October 2026, America/Los_Angeles. **Outcome: BPREP-R4 is addressed as a proposed design; BPREP-R3 remains open for two bounded validation/test corrections. Preparation is not yet accepted for implementation.**

The revised plan now restores/verifies sql.js foreign-key enforcement after initial open, snapshot export, durable export and replacement recovery; resolves the live handle through a mutable cell, including debrief saves; and specifies disabled-adapter behavior. Native decoding is inside the application boundary, errors are sanitized, and success JSON explicitly uses `materialId`. Stored equality now includes aid titles, notes and question sourcePage. These corrections are documentation specifications, not implemented or tested Slice B behavior.

## Reviewed identity and verification

| Item | Independently measured |
| --- | --- |
| Implementer / reviewer | Gemini / Codex |
| Primary branch / HEAD | `codex/structured-study-import-slice-b-preparation`, `3efe95316b200848178033a68d057f66815cf427` |
| Refreshed publication base | `origin/main` at `5c83d200bd422d7c302179f95a70bc1c773958a0`, PR #64 |
| Submission | Eight files: three modified tracked documents, five untracked documents/evidence files |
| Receipt | Seven entries verified; self-excluding receipt SHA-256 `645c5035d1a8494cf3052eb04844b34ca5b26fef69443def683f4938d9259892` |
| Source/configuration | All 351 tracked files outside `docs/` and `STATUS.md` match primary HEAD byte-for-byte; no unexpected dirty files |
| Document checks | 188 relative file links resolve; all eight files pass whitespace/conflict-marker checks; `git diff --check` passed |
| Matrix | 61 unique rows: 57 source/development and four future installed; all 22 original IDs preserved; all rows remain planned |
| Fresh GitHub scope | 64 PR metadata entries and zero open PRs before this publication; three A2-named preparation/documentation matches, no specific `fix/atomic-study-material-saves` remote branch. This is metadata/ref-name inspection, not every-PR source or Windows-machine inspection. |

[Evidence index](evidence/structured-study-import-slice-b-validation-review-2026-10-03/README.md), [all eight reviewed hashes](evidence/structured-study-import-slice-b-validation-review-2026-10-03/reviewed-all-8-hashes.txt) and [verification](evidence/structured-study-import-slice-b-validation-review-2026-10-03/review-verification.json). The current report/prompt and status/receipt files are preserved verbatim under `submitted/` as inert history.

## BPREP-R3(a) — [P2] Preserve accepted content and restore complete native validation

**Submitted anchors:** report §4.3, static-error table at line 335 (`EMPTY_SUBSTANTIVE_CONTENT`) and operation DTO at lines 280–309; conditional prompt Phase 2 validation bullets, lines 72–77.

The proposed rule requires a guide to have at least one section/card and treats a study set with zero sections/cards as empty. Accepted Slice A instead treats **a nonempty summary** as a substantive guide (`semantic.ts:34–35`) and maps that guide into a study set (`payload.ts:69–90`). Contract §2.4 explicitly permits it. A synthetic call to the actual pure `validatePacketText` accepts a summary-only packet and produces a nonempty summary, zero sections/cards and no test. The new proposed native rule would reject this valid payload. This is a regression in the plan, not a shipped native defect.

The rewrite also removed the previous detailed native invariant table. The current TypeScript shape and short phase bullets retain some count limits but omit heading/body/front/back/question/option/explanation lengths, explicit answer-index bounds, title equality and a normalization policy. A TypeScript interface cannot enforce those at the Rust command boundary. For example, `correctIndex = 5` with two options is still a planned refusal case, but the implementation checklist no longer specifies its check.

**Required correction:** restore one complete normative table for the operation DTO, grounded in accepted `limits.ts`, `schema.ts`, `semantic.ts` and `payload.ts`. Include types, mandatory/nullable presence, unknown-key rejection, normalized code-point lengths, array limits, consistent titles, fixed provenance/defaults, null sourcePage, unique valid options, integer/in-range correctIndex and source-notes retention. Define substantive study content as nonempty normalized summary **or** sections **or** cards, with questions as the separate valid test case. Notes alone are not substantive. Map each refusal to the existing static errors and keep the conditional prompt consistent.

Add planned summary-only acceptance, summary-plus-notes retention and direct-native boundary/index tests. Preserve all existing IDs and label every future row planned. The previous table is available in PR #64's inert submitted report; reuse its validated limits while retaining the new decoding/error boundary.

[Pure validator probe](evidence/structured-study-import-slice-b-validation-review-2026-10-03/summary-only-probe.cjs), [observations](evidence/structured-study-import-slice-b-validation-review-2026-10-03/summary-only-observations.json). The probe runs repository TypeScript through the installed TypeScript compiler in memory; it uses synthetic data and never invokes the app, picker or database. Exit 0 confirms the mismatch; it does not run a proposed native command.

## BPREP-R3(b) — [P2] Use valid RFC UUID v4 conflict fixtures

**Submitted anchors:** report matrix rows TB-CONF-01 through TB-CONF-06, lines 473–478. All six new UUID-looking values have version digit 4 but use a non-RFC variant nibble (`0`–`5` at the start of the fourth group). Offline Python `uuid.UUID` inspection identifies all six as non-RFC variants, with `version` not equal to 4. The two idempotency fixtures are valid RFC UUID v4 values.

For example, `c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f` does not satisfy the specified RFC UUID v4 guard. These cases would return `INVALID_OPERATION_ID` before reaching the intended `IDEMPOTENCY_CONFLICT`, so they cannot prove conflict handling as written.

**Required correction:** replace all six fixtures with independently checked version-4/RFC-variant UUIDs, not merely strings whose third group starts with 4. The fourth group must begin with `8`, `9`, `a` or `b`. Keep a matching operationId/materialId pair for each intended conflict case and other input valid. Separate incoming invalid-ID rejection tests from stored-content conflict tests. Provide a compact fixture audit in the receipt. [Measured six-fixture results](evidence/structured-study-import-slice-b-validation-review-2026-10-03/uuid-fixture-observations.json).

## Disposition and next action

Earlier R1/R2 corrections and R4 lifecycle specification are addressed. The new application decoding boundary, success serialization and stored equality portions of R3 are addressed. Only the R3 validation specification and invalid fixtures above remain assigned; no further architecture redesign is requested.

The receipt still describes a 63-PR check beside a remote main containing PR #64. Label that as the inherited pre-PR64 Codex observation or record an actual fresh check. Likewise distinguish inherited toolchain observations from checks performed during this correction. This is evidence wording, not a new production finding.

All Slice B rows remain planned. Full unchanged frontend/Rust/build matrices were not repeated. No source, dependency, migration, UI, persistence, provider, installed/account/signing, release or Windows-owner messaging work occurred. Slice A remains accepted/merged via PR #62. A2 publication/acceptance, M2 check-in/scoped approval and D1–D9 (including D3) still gate B implementation.

[Gemini's bounded validation-correction assignment](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_VALIDATION_CORRECTIONS_PROMPT_2026-10-03.md) is the next authorized task. The coordinator publishes this review separately; the eight-file dirty preparation submission remains untouched for Gemini.
