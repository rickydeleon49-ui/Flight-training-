# Structured study-import Slice B preparation acceptance

Reviewed on 3 October 2026, America/Los_Angeles. **Accepted for documentation publication after the bounded reviewer corrections recorded below. BPREP-R1–R4 are closed at the preparation/specification level.** This does not accept a Slice B implementation or clear any implementation, installed or release gate.

The actual submitted report restores the accepted `material.title`, section `heading`/`body`, question `question` fields and existing limits. It accepts summary-only guides, retains summary-plus-notes, specifies native bounds and answer-index validation, and uses eight valid RFC UUID v4 fixtures. The pasted handoff narrative describes a different DTO and limits; the repository files govern this acceptance.

## Identity and independently measured verification

| Item | Evidence |
| --- | --- |
| Implementer / reviewer-coordinator | Gemini / Codex |
| Primary checkout / submitted branch | `/Users/rickymac/code/Flight-training-`, `codex/structured-study-import-slice-b-preparation` |
| Submitted HEAD / publication base | `3efe95316b200848178033a68d057f66815cf427` / `origin/main` at `ad5e8516c8d3a1d3f002be32735fa391a2373042` (PR #65) |
| Submitted inventory | Three modified tracked documents, five untracked documents/evidence files: eight files total |
| Submitted receipt | Seven entries verified; receipt itself SHA-256 `8b495e060a0d43a62d5938c6dbcc19fc091538887707287cafbb70c1ec905ca6` |
| Source/configuration | All 351 tracked files outside `docs/` and `STATUS.md` match submitted HEAD byte-for-byte; no unexpected dirty files |
| Links / whitespace | 189 submitted relative file links resolve; all eight submitted files pass whitespace/conflict-marker checks; `git diff --check` passed |
| Planned tests | 69 distinct rows: 65 source/development, four future installed. All 61 previous revision IDs retained; all original IDs therefore retained. All rows remain planned, not run. |
| UUID audit | Eight unique fixture UUIDs independently parsed: each version 4, RFC variant; all six conflict fixtures now pass their specified guard |
| Fresh repository observation | 65 PR metadata entries, zero open before this publication; A2-named metadata/refs concern documentation/preparation. No specific `fix/atomic-study-material-saves` remote ref. Metadata/ref inspection does not audit every PR tree or the Windows filesystem. |

[Evidence index](evidence/structured-study-import-slice-b-acceptance-2026-10-03/README.md), [submitted eight-file hashes](evidence/structured-study-import-slice-b-acceptance-2026-10-03/reviewed-all-8-hashes.txt), [verification and UUID results](evidence/structured-study-import-slice-b-acceptance-2026-10-03/review-verification.json).

## Finding disposition

| Finding | Accepted preparation behavior |
| --- | --- |
| R1: observable persistence / recovery ownership | Throwing persistence boundary, mutable live handle, serialized writes, snapshot recovery and retry/refusal specification; final implementation must reconcile with accepted A2. |
| R2: compatibility / evidence | Older mapper label behavior is separated from unverified downgrade/restore usability. D3 remains a proposal; v0.5.1 schema/panel/guard limits are explicit. |
| R3: native contract / accepted content / test fixtures | Application decoding boundary, exact wire JSON and sanitized static errors; complete normative validation table matching Slice A; summary-only and notes retention; stored-content equality; valid UUID/conflict isolation. Added TB-CONT-04/05 and TB-IPC-10–15 are planned. |
| R4: sql.js lifecycle | Initialize and verify foreign keys after open, snapshot, durable export and recovery; resolve the live handle for ordinary/debrief/import operations; specify statement lifetime, queue and disabled-adapter behavior. |

R4 and the native decoding/wire contract were source/specification reviews, not executed Slice B tests. The earlier synthetic dependency and pure-validator probes are preserved in their original review evidence. Unchanged full frontend/Rust/build gates were not repeated. No native save command, app picker, owner storage, installed macOS, VoiceOver, account/signing or Windows-machine test was run here.

## Bounded reviewer corrections and provenance

1. **Receipt baseline:** all seven quoted pre-edit hashes differ from the authoritative archived seven-entry receipt whose SHA-256 is `645c5035d1a8494cf3052eb04844b34ca5b26fef69443def683f4938d9259892`. The supplied command transcript begins with edits and does not establish that local pre-edit check. The publication replaces that claim with the correct archived reference values and explicitly leaves the implementer's before-edit verification unestablished. Codex independently verified the current submitted files; this acceptance relies on that review, not the unsupported earlier claim.
2. **Receipt summary:** replace the unrelated error codes/test suite labels copied from the handoff narrative with the actual report's ten static codes and TB-INST labels. Environment fields are inherited observations. The full original handoff and eight submitted files remain inert audit history.
3. **Normative clarity:** nullable aid keys are required and may explicitly be null; normalizers handle CRLF and lone CR; the source-page message says null consistently with the required-null DTO; the empty-content allowlist row refers to neither aid being substantive; a Rust constructor uses `material_id` while serialized JSON uses `materialId`. These are documentation clarifications, with no production change or new packet format.
4. **Published status / continuation:** link the accepted plan and conditional next prompt, preserve existing Slice A review/CI evidence and every implementation/installed/release gate. The historical submitted branch state is labelled as such.

[Authoritative prior receipt](evidence/structured-study-import-slice-b-acceptance-2026-10-03/authoritative-prior-receipt.txt), [corrected preparation receipt](evidence/structured-study-import-slice-b-preparation-2026-10-03/preparation-receipt.txt), [corrected active seven-entry hashes](evidence/structured-study-import-slice-b-preparation-2026-10-03/final-hashes.txt). The acceptance publication manifest covers the additional acceptance and archive files and excludes itself.

## Next work and preserved gates

The [accepted preparation report](STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md) and [reviewed conditional Gemini implementation prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_IMPLEMENTATION_PROMPT_2026-10-03.md) are ready to use after the existing gates clear. Gemini should perform one current gate check, then either implement from clean synchronized main or report the precise missing evidence and stop; no duplicate preparation rewrite is assigned.

Still required: matching published and independently accepted A2/R6–R7 source, the recorded M2 real-user check-in/scoped approval (or an explicit owner narrowing), D1–D9 approval including D3, and clean synchronized main. The Slice A exception covers A only. A standard test account/signing decision and installed evidence remain separate prerequisites; source/Node/jsdom evidence does not clear macOS 12 or VoiceOver.

The containing PR records the exact reviewed head, required documentation CI, merge and synchronization. After merge, the coordinator can preserve the accepted preparation on its local branch and synchronize the primary Mac checkout using normal commit/switch/fast-forward operations. No reset/stash or unrelated work removal is needed; any unexpected intervening change must be preserved.
