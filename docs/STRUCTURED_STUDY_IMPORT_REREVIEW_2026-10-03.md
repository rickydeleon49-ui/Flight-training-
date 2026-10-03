# Structured study-import contract: independent re-review, 3 October 2026

**Disposition: R1–R4 are resolved; contract acceptance still requires R5 below.** This is a re-review of Claude's corrected local `codex/structured-study-import-contract` package, HEAD/base `8fb3b7fe7f8ae425b41c597549f930e1aadb326a`, against the [original independent review](STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md). The [next Claude prompt](CLAUDE_STRUCTURED_STUDY_IMPORT_R5_PROMPT_2026-10-03.md) assigns the remaining work.

All 128 hashes in the correction receipt match. Receipt SHA-256: `ea0b0f79f8264c6fbcd22f73563f37b3a1913b3345886dae1c47e23ca867791d`. Exactly seven of the originally hashed files changed, all as disclosed; 79 match the original receipt. The package comprises 129 paths, including two tracked documentation modifications and 127 untracked files. No application source, package manifest, lockfile or workflow changed. This review publication preserves the local submission and does not adopt dependencies.

## Findings resolved

| Finding | Independent conclusion |
| --- | --- |
| R1: diagnostic privacy | Fixed. Diagnostics are rebuilt from fixed codes/messages, contract-owned path segments and allowlisted numeric/field metadata; arbitrary keys and duplicate IDs are excluded. The original leak diagnostics pass. Permanent privacy regressions and the two-layer mutation checks pass. |
| R2: lost preview claims/references | Fixed for the original finding. `preview.data` retains normalized source claims, export IDs and item-associated refs, while the separate persistence payload excludes them. Note/date-only source claims are warned. R5 concerns a separate guide field below. |
| R3: Slice A provider typing | Fixed. Import DTOs omit and redefine provider, without changing current stored-domain types. Nine generated typed examples compile against actual current domain types; the old `Omit` types still produce the expected two TS2322 errors. |
| R4: adoption gates | The foundation, A2, relevant M2 and installed evidence requirements are restored consistently; a source-only exception requires explicit documented owner authorization. No exception is recorded. The remaining CI wording correction below does not reopen these gates. |
| Aggregate runner exit propagation | Corrected code records failed required steps, continues collecting evidence and exits 1 if any failed. Claude's deliberate-failure self-test is preserved and correctly labelled as Claude's result. |

## R5 — P2: a valid packet can preview guide notes that its persistence payload drops

Exact locations in the submitted corrected prototype, `docs/evidence/structured-study-import-contract-2026-10-03/prototype-corrected/validator.mjs.txt`:

- line 536: `hasGuide` considers only non-empty summary or sections
- lines 626–627: preview includes a guide when `sourceNotes` is non-empty
- lines 635–640: the discarded-data summary covers claims, references and IDs, but not these guide notes
- lines 675–686: a study set is created only when `hasGuide` or flashcards are present

**Trigger:** a packet has one valid question, `guide.sourceNotes` with non-empty text, and no guide summary, sections or flashcards. A variant explicitly supplies empty summary and sections. Both are accepted. Preview contains the notes, `createsStudySet` is false, and `payload.studySet` is null. Nothing in `discardedOnSave` identifies the notes as discarded.

This conflicts with contract §2.13's mapping of guide source notes into the study-set payload and §3.5's preview/save consistency promise. `guide.sourceNotes` is distinct from top-level `source.note`, whose intentional omission is already disclosed. The reference implementation would cause loss of notes if ported into the future import flow. This remains a prototype defect; no shipping app save ran.

Codex's additional diagnostic has two failing cases and four passing controls. Cards plus guide notes and a substantive guide plus notes preserve them; questions plus blank notes stay valid; standalone notes remain an empty packet. [Reproducible evidence](evidence/structured-study-import-rereview-2026-10-03/README.md).

**Focused correction:** define one coherent rule for source notes without a persistable study set. The conservative proposal is to reject non-empty orphan guide notes when there is neither a substantive guide nor cards, while retaining the existing valid combinations and standalone-empty rule. Another documented behavior is possible if it preserves the content and reconciles the contract, preview, payload and canonical hash. Never silently broaden the meaning of a guide or drop non-empty notes behind the preview. Add permanent fixtures/regressions and a mutation check for this boundary.

## Small evidence and handoff corrections

1. **Mutation counts:** the actual submitted JSON and Codex's independent rerun show **16 caught, three neutralized**, 19/19 behaving as expected. The three neutralized cases are M10, M12a and M12b. The README and implementation handoff currently say 15/four; the pasted handoff repeats that error. Correct current summaries without rewriting historical receipts.
2. **CI wording:** handoff §6 describes a required exact-head Windows/macOS CI matrix. The current required check, `Tests, types, and the data-safety guards`, runs on **Ubuntu** in `.github/workflows/checks.yml`. Platform build/installed evidence is separate. Describe the existing required check accurately, keep necessary platform checks and release gates explicit, and do not invent or weaken workflow requirements.

## Checks actually run by Codex

The corrected inert prototype was reconstructed in a new disposable folder. Its exact locked dependencies were reused read-only from the preceding review scratch install. Node 22.23.3 and the unchanged repository TypeScript binary were used. No repository dependency installation or app/database access occurred.

| Check | Result |
| --- | --- |
| Correction hashes | 128/128 matched; receipt hash confirmed |
| Validator fixtures/generated boundaries/bounded reader | 100/100, exit 0 |
| Permanent regressions | 29/29, exit 0 |
| Adapted original diagnostic | 8/8, exit 0 |
| Mutation sensitivity | 19/19 as expected: 16 caught, three neutralized, exit 0 |
| Generated DTO examples against current domain types | nine values compile, exit 0 |
| Old provider type negative control | two expected TS2322 errors, exit 2 |
| Additional source-notes assertions | two fail, four controls pass, exit 1 as expected |

Renderer code and its 23 passing cases were unchanged and were not rerun. The aggregate self-test, corrected CSP/schema/fake-adapter/capability results are Claude-reported in the submitted evidence; Codex did not repeat those checks. The previous independent renderer/CSP/capability results remain recorded in the original review. No installed WebKit, macOS 12, Windows app, VoiceOver, real database, signing or provider test ran. Full unchanged application/Rust matrices were deliberately omitted.

## Next action

Claude corrects R5 and the two documentation discrepancies on the existing Mac branch, preserves original and correction evidence, adds a fresh receipt, and stops for focused re-review. No production slice starts. The corrected R1–R4 behavior must remain intact, and the complete contract package remains uncommitted until independent acceptance.
