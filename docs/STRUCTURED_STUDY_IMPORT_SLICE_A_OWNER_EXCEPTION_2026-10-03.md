# Owner decision: source-only Slice A exception, 3 October 2026

**Decision:** the project owner explicitly authorized a narrow, source-only exception for structured study-import **Slice A**. It applies before the remaining foundation/adoption gates: published and accepted A2, installed-Mac evidence, and the M2 real-user check-in.

- **How it was recorded:** the owner answered "Yes, grant exception" in the Claude session on the Mac, 3 October 2026, to an explicit question naming the scope below. It was recorded here before any production code was written.
- **Not the source:** the exception is not inferred from the [contract acceptance](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md) or from the [Slice A assignment](CLAUDE_STRUCTURED_STUDY_IMPORT_SLICE_A_PROMPT_2026-10-03.md).

## Why an exception was needed

On `main` `696b07021f74104b800bc4a37c9ccb4c437a1abb`, the gates in the [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md) and the [open-source Mac handoff](OPEN_SOURCE_MAC_HANDOFF.md) were **not** met:

- A2 is Windows-local and unpublished
- no installed-Mac results exist
- the M2 check-in has not been held

STATUS recorded "None exists" for an owner exception.

## Scope: covered

- Adding exactly `zod@4.6.5` as a production dependency, with `jitless` set before any schema and no `zod/compile`, plus its third-party notice.
- A pure TypeScript `hfd-study-packet` v1 validator implementing the accepted [contract](STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md), R1–R5 included, with in-memory preview data and import persistence DTOs.
- A read-only Rust command `pick_study_packet` with a desktop-only TypeScript wrapper. It uses a native single-file dialog, a bounded read, strict UTF-8, an original-byte SHA-256 and BOM handling.
- Tests and documentation for the above.

## Scope: not covered

- Database writes or a save command (Slice B), an import screen, toolbar or dialog wiring.
- Provider-label or stored-domain type widening, and the replacement flow.
- Markdown rendering or react-markdown (Slice C), or any other new package.
- M2 migrations or schema changes.
- Changes to Gemini requests, prompts or keys; ordinary-file import; backup/restore; the database driver; capabilities; the minimum OS; the version or bundle identity.
- Installation, packaging releases, signing, notarization, account provisioning, release or distribution.

## Gates that remain

| Gate | Applies to | State |
| --- | --- | --- |
| Codex independent review of the Slice A source and the required Ubuntu check on the exact head | merging Slice A | pending |
| Published, accepted A2 conventions; M2 real-user check-in with scoped approval; owner decisions D1–D9 (including D3) | Slice B | not met |
| A separate dependency review and macOS 12.0–12.2 checks | Slice C (optional) | not started |
| Mac/Windows packaging, installed Mac testing on a standard test account, early macOS 12, Windows app behavior, signing/account decisions, release holds | any release containing import code | unverified |

This exception expires with Slice A. It cannot be reused for B, C or any other dependency.
