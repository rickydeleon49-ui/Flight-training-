# Owner approval: structured study import Slice B — 4 October 2026

**Decision: approve Slice B implementation with all nine proposed defaults, including the older-version limitation.** The owner responded to the scope presented by Codex: “pprove Slice B with all nine defaults, including the older-version limitation”. The omitted initial “a” is an obvious typo; the approval is unambiguous. This records scoped approval to implement the first usable outside-assistant study-packet import flow, building on accepted Slice A/Zod.

[Approved preparation/specification](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) · [model-neutral implementation assignment](STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-04.md) · [preparation acceptance](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_ACCEPTANCE_2026-10-03.md).

## Approved defaults (D1–D9)

| ID | Approved decision |
| --- | --- |
| D1 | Add **Import study packet…** beside **Add material** in the Study Library toolbar; use the existing desktop file picker and validated packet flow. |
| D2 | Create new materials only. Import does not replace or delete existing materials, study sets or practice tests. Replacement remains deferred. |
| D3 | Store `provider: "import"` and `model: ""` in existing columns, widen types and allowlist mappers, without a new schema migration. The owner acknowledges older-binary attribution ambiguity and unsupported/unverified older-version downgrade/restore behavior. |
| D4 | Persist validated study content only. Do not retain/copy the original packet JSON into managed documents; leave the selected file untouched. |
| D5 | Show packet source references as unverified in preview, clearly disclose that they are not persisted in this slice, and do not append them silently to stored content. |
| D6 | Use exporter IDs for validation/association and answer mapping only; do not persist them as durable item identities. |
| D7 | Determine retry idempotency using actual stored substantive content within the atomic operation, rather than trusting a supplied hash alone. No new column. |
| D8 | A separate import of the same file creates another material; duplicate-file detection/warnings are deferred. Retrying the same save operation is distinct and must remain idempotent. |
| D9 | Plain-text display for this slice. Preserve existing Gemini generation. Any future Markdown adoption is separately gated and limited to imported guides under the proposed later scope; Slice C is not authorized here. |

## User-facing result and validation scope

The user selects a supported UTF-8 JSON study packet (maximum 4 MiB), reviews its guide/cards/questions and warnings, and confirms **Import as new material**. Supported combinations and bounds remain those of the accepted contract/validator. Ordinary PDFs or unstructured pasted prose are not automatically converted into questions. Imported answer keys are supplied claims; structural validation does not verify their factual accuracy. Saved content remains available offline.

Authorize the native and browser-development atomic persistence adapters, bounded and sanitized validation, provider mapping/labels, preview/cancel/save UI, regeneration warnings and the accepted 65 source/development test rows. Implement and map meaningful tests to all accepted requirements. The four installed test rows remain explicitly unverified until separately authorized and performed. Current-version backup/restore must preserve imported content/provenance. No tests may access owner data.

D3 specifically acknowledges that older mappers may label imported content as Gemini-generated; v0.5.1 lacks practice-test/schema support. This approval does not establish backward restore compatibility or authorize testing with the owner's real backups.

## Gate reconciliation and boundaries

Accepted Slice A is merged through PR #62; accepted A2 is published through PR #78, with subsequent Mac acceptance. The [M2 real-user check-in waiver](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md) persists. This approval now satisfies the separate scoped implementation approval and D1–D9 requirements. Older documents saying owner scope/D1–D9 are pending are historical where superseded by this decision. Confirm current-main ancestry and a clean agreed implementation branch once at startup; do not repeat preparation or ask for these same approvals again.

This is permission for Slice B source implementation and appropriate source/development verification, followed by independent review and the existing Git coordination gate. It does not authorize new production dependencies, migrations, replacement import, Markdown, attempt tracking, network/provider calls, testing-account work, owner-profile access, packaging/signing activation, version changes, tags or release publication. Apple enrollment/signing and installed/release gates remain separate and do not prevent this scoped source implementation.

Codex remains the senior developer, independent reviewer and Git coordinator. One owner-selected implementation model may implement from the detailed model-neutral assignment, leave work uncommitted/unpushed, and return a complete review handoff. Preserve accepted work, run focused checks during development and one required sequential local gate after corrections.
