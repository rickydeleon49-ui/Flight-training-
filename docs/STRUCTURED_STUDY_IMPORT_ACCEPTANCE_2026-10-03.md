# Structured study-import preparation: independent acceptance, 3 October 2026

**Accepted for documentation/contract integration after exact-head CI. R1–R5 are closed.** This accepts the preparation package and its disposable prototype as a reference for future implementation. It does not install a production dependency, authorize a product flow or clear foundation, A2, M2, installed-testing or release gates.

Reviewed submission: Mac clone, `codex/structured-study-import-contract`, HEAD/base `8fb3b7fe7f8ae425b41c597549f930e1aadb326a`; 161 submitted paths (two tracked modifications, 159 untracked files). All 160 hashes in the [R5 receipt](evidence/structured-study-import-contract-2026-10-03/r5-receipt-2026-10-03.txt) matched before Codex's acceptance annotations. Receipt SHA-256: `6e29c21e27155c7dc4263937390c90e4b3be4a6dcd332dcf7c9f7afa3cec083b`. Earlier receipts and evidence remain preserved.

## Review conclusions

| Finding | Accepted behavior |
| --- | --- |
| R1: private text in diagnostics | Fixed allowlisted diagnostic boundary; contract-owned paths and numeric indexes; no arbitrary keys or raw export IDs. |
| R2: lost preview provenance | Normalized claims and per-item references retained in bounded in-memory preview data; separate persistence payload; note/date-only claims warned; omission disclosed. |
| R3: incompatible provider types | Import DTOs omit/redefine provider and compile against unchanged stored-domain types. Reader/validator and original-file/canonical-content hash boundaries are specified. |
| R4: conflicting gates | Preparation, implementation, merge, platform and release gates are distinguished. A narrower source-only exception requires explicit owner authorization. |
| R5: guide notes silently dropped | Non-empty guide source notes require a substantive guide or flashcards. Orphan notes with questions are rejected at `$.guide.sourceNotes`; notes alone remain an empty packet. Accepted notes survive normalization, payload mapping and canonical persistence content. |

R5 changes only a previously accepted but lossy format combination. It creates no product implementation, data write or migration. Its three deliberate defects—guard removed, persisted notes dropped, notes counted as a guide—are independently caught. The mutation summary is now accurate: 19 caught, three neutralized, 22/22 as expected. Required CI is correctly described as the single Ubuntu check; manually dispatched Mac/Windows packaging and installed evidence remain separate.

## Independent verification

Codex reconstructed the layered inert sources (`prototype/` → `prototype-corrected/` → `prototype-r5/`) in a fresh disposable folder and reused the preceding review's exact locked dependency tree read-only. Node 22.23.3 and the existing repository TypeScript binary were used. No repository dependency installation, app-profile access or real database operation occurred.

| Check actually run by Codex | Result |
| --- | --- |
| Submission hashes | 160/160 match; receipt hash confirmed |
| Fixtures/generated boundaries/bounded reader | 106/106 pass |
| Permanent R1/R2/R3/R5 regressions and controls | 41/41 pass |
| Original adapted diagnostics | 8/8 pass |
| Source-notes diagnostics | 6/6 pass |
| Mutations | 22/22 as expected: 19 caught, three neutralized; exit 0 |
| Actual generated DTO examples | nine typed values compile, exit 0 |
| Reviewed old provider-type negative control | two expected TS2322 errors, exit 2 |

[Independent acceptance evidence](evidence/structured-study-import-acceptance-2026-10-03/README.md) preserves the results and commands. The previously independent renderer/CSP/capability checks remain in the [initial review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) and [re-review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md). Unchanged renderer/depth/API/capability checks and full application/Rust matrices were not repeated. Claude's R5 schema checks, fake-adapter/CSP results and aggregate self-test remain Claude-reported; they are not substituted for real database or installed evidence.

## Integration and next work

Publish the complete contract, schema, synthetic fixtures, inert prototype sources, original/correction/R5 receipts and independent acceptance through the required documentation CI path. Codex's acceptance annotations and status reconciliation are administrative changes; the reviewed prototype, tests and historical receipts remain byte-identical. Production source, manifests, locks and workflows remain unchanged.

The [next Claude prompt](CLAUDE_STRUCTURED_STUDY_IMPORT_SLICE_A_PROMPT_2026-10-03.md) defines a bounded first source-code slice: Zod validation and a read-only native packet picker, with no UI or writes. It is a concrete conditional assignment. It may start only when its existing adoption gates are met or the owner explicitly grants the documented narrower exception. No exception is inferred from this acceptance.

Slice B still requires accepted published A2, the M2 check-in/scoped approval and relevant product decisions. Optional Markdown remains a later separate review. Installed Mac, early macOS 12, Windows app behavior, test-account/signing decisions and release holds remain unresolved. MiniSearch, virtualization, embedded PDF, scheduling and provider changes are outside this acceptance.
