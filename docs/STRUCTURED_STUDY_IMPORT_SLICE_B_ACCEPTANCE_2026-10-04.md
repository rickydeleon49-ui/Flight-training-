# Structured study import Slice B — independent source acceptance, 4 October 2026

**Accepted for source integration. SB-R1 and SB-R2 are closed.** The owner-approved create-new study-packet import now has an inspectable confirmation preview, atomic durable saving, safe retries and explicit import provenance. This is source acceptance; it does not certify an installed build or authorize release publication. The containing source PR supplies the final GitHub check and merge record.

## Submission and review identity

- Implementer checkout: `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/structured-study-import-slice-b`, HEAD/base `6b418ee3c92f0ba64952d35278aa7c9999f9c824`.
- Reviewed correction receipt: `docs/evidence/structured-study-import-slice-b-2026-10-04/CORRECTIONS_SHA256SUMS`, **64/64 paths verified**, SHA-256 `38df92836552c8d209dadce0b657447c326bb65bd40b718ae556a2811b694415`.
- The original implementation report, mutation results and all original gate logs retain their first-review hashes.
- An additional correction draft directory with its own 40-entry valid receipt was present locally. It is preserved there, rather than publishing a second competing correction report. The 64-entry handoff is the reviewed canonical submission.
- Integration branch: `codex/structured-study-import-slice-b-integration`, based on main `c6dedf26dc5abcbae5c870ad43dfcc7a7c840339` (review PR #91). Codex copied the reviewed source into the restored isolated review worktree and reconciled current documentation. The implementer and dirty primary checkouts were not reset or modified.

## Findings closed

| Finding | Corrected behavior | Independent verification |
| --- | --- | --- |
| SB-R1: omitted content and references | Preview displays normalized guide summary/sections/notes, card faces, questions, choices, packet answer keys and explanations. References remain associated with their cards/questions, labelled unverified and discarded on save. Counts, creation/absence wording, choice-ID disclosure, original-byte hash accessibility and no-upload/answer-origin notice are present. React text rendering preserves the plain-text rule. | Import dialog 21 tests, material detail 4; inspected actual rendering and payload path. Preview/cancel write nothing; existing double-click, safe retry, refresh failure and fallback dialog tests remain green. |
| SB-R2: native NFC omitted | Both native normalizers compose NFC before bounds and semantic checks. Shared native/browser cases now include equivalent duplicate choices, the 200-code-point composed title, equivalent aid titles and non-composing sequences. Canonical stored content and equivalent retries preserve rows and timestamps. | Native study_packet 65 tests; shared frontend contract suite 69 tests; full Rust gate passes. |

The preview uses a keyboard-focusable scroll region with a fixed maximum height; every supported card/question reference remains inspectable. Rendering uses existing saved-view plain-text classes. This is not an installed performance or VoiceOver measurement.

**Small integration correction by Codex:** the submission used Cargo's caret requirement `unicode-normalization = "0.1.25"`. The integration source pins it exactly as `unicode-normalization = "=0.1.25"`, as the correction assignment required. Cargo.lock changes only the root application's dependency list; every resolved package/version/checksum remains unchanged. The crate already ships through lopdf → stringprep and carries its existing MIT/Apache-2.0 license. No new production package or npm dependency was adopted.

## Independent observed results

| Check | Result |
| --- | --- |
| Focused service/import/repository/dialog/material/notice files on submitted correction | exit 0; 124 tests |
| Native study_packet on submitted correction | exit 0; 65 tests |
| Fresh integration-worktree npm ci | exit 0 |
| Typecheck | exit 0 |
| Full frontend tests | exit 0; **2,460 pass, four skip**; 81 files pass, three skip |
| Production build | exit 0 |
| Full Rust all-targets tests | exit 0; **336 pass, six ignored** |
| Clippy with warnings denied | exit 0 |
| Rust formatting | exit 0 |
| Cargo lock synchronization | exit 0 |
| Diff whitespace/conflict check | exit 0 |

The full gate ran once, sequentially, in the integration checkout after the exact pin. It used scoped Node 22/rustup stable and SDK 26.5, disposable test data, a fresh npm install and the existing Rust target cache. [Independent receipts](evidence/structured-study-import-slice-b-acceptance-2026-10-04/README.md) include commands, exits, durations and output. No inherited full-gate result is represented as an independent rerun.

## Evidence precision and limits

The submitted fail-before logs mirror the reviewer’s earlier diagnostics; they are historical reproductions, not new failure executions on corrected code. Permanent regression names and actual passing outputs verify the corrections.

Some submitted prose uses illustrative wording instead of the literal UI text, says seven new dialog scenarios where eight were added, claims guide-section references although the accepted packet format permits references only on cards/questions, and claims an added 201-NFC-title regression that is absent from the submitted new tests. The actual added shared cases are the four listed above. The native 200-title boundary, canonical equivalence and non-composing-sequence tests pass; existing bounds enforcement also passes. These report discrepancies do not expose a remaining source defect and are reconciled here without another implementation round. The frozen original and correction reports are retained as implementation history.

Owner D1–D9 approval, including the older-version limitation, remains effective. No replacement flow, migration, attempt history or Markdown feature was added. MAC-23 / TB-INST-01–04 remain **UNVERIFIED**: installed WKWebView on old/current macOS, VoiceOver, offline installed reopening and installed backup/restore. No application was launched, no account/owner data was used, and no provider request, packaging, signing, notarization, tag or release occurred.

## Next bounded assignment

Use the [model-neutral practice-session scope assignment](M2_PRACTICE_SESSION_SCOPE_PROMPT_2026-10-04.md) to turn the existing M2 design into one concrete first implementation scope for owner approval. Reuse the design, check-in waiver, A2 and accepted import foundation. Do not adopt another library or begin migrations/attempt implementation before that scope is approved. Release credentials and installed verification remain separate.
