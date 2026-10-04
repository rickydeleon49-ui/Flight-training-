# Gemini: finish the two remaining Slice B validation corrections

Continue on the Mac in `/Users/rickymac/code/Flight-training-`, existing dirty branch `codex/structured-study-import-slice-b-preparation`, HEAD/base `3efe95316b200848178033a68d057f66815cf427`. Correct the remaining BPREP-R3 validation/test specification. **This is documentation work only**, left uncommitted/unpushed for Codex. R4's lifecycle design and the new native decoding/JSON/error/equality boundary are addressed; preserve them.

## 1. Verify the submission and read the review

Fetch and read `docs/STRUCTURED_STUDY_IMPORT_SLICE_B_VALIDATION_REVIEW_2026-10-03.md` and its evidence from GitHub or `git show origin/main:<path>`. Keep the dirty branch in place; do not switch/reset/stash/clean/merge it to read the publication.

Verify all seven entries in `docs/evidence/structured-study-import-slice-b-preparation-2026-10-03/final-hashes.txt`. Its SHA-256 must be `645c5035d1a8494cf3052eb04844b34ca5b26fef69443def683f4938d9259892`. Codex reviewed eight files including the receipt and confirmed all 351 tracked non-documentation files unchanged. Preserve and explain any intervening differences. Codex's latest `submitted/` archive preserves the exact eight-file revision; explicitly rely on that historical archive when replacing the active documents.

## 2. Restore complete native invariants without changing the accepted format

Read accepted `src/logic/studyPacket/limits.ts`, `schema.ts`, `semantic.ts`, `payload.ts` and contract §2.4/§2.8/§3.5. Recover the previous native table from PR #64's inert submitted report, but reconcile it with the current application decoding and static-error contract. The new DTO interface alone does not enforce native field limits.

Publish one normative field-by-field table in the preparation report and reference it explicitly from the conditional implementation prompt. Cover:

- Root operation keys and their required presence; UUID v4 and operationId/materialId equality; lowercase 64-hex contentHash.
- `material` and its sole allowed title; required nullable studySet/practiceTest members; required keys inside each present aid; unknown-key rejection at every object level.
- Title normalization, single-line representation, nonempty 1–200 code points, and both aid titles matching the material title.
- Study summary ≤20,000; sections 0–100, each heading 1–200 and body 1–20,000; cards 0–500, front 1–1,000 and back 1–2,000; sourceNotes ≤5,000.
- Questions 1–200; question 1–2,000 and explanation 1–4,000; options 2–6, each normalized single-line text 1–500 with the accepted duplicate-text rule; correctIndex an integer ≥0 and strictly less than options.length.
- Import provider, empty model, explicit null sourcePage on cards/questions, and fixed material defaults rather than packet-supplied file/link/tag metadata.
- Normalization and Unicode code-point counting grounded in the accepted line/block normalizers. Specify how direct native callers receive the same representation or are rejected if noncanonical. Do not silently introduce a second packet format.
- Exact mapping from each violation to the existing static error codes/messages; no raw field names, payload, paths or SQL/Serde diagnostics escape the application boundary.

Correct substantive content everywhere. A present study set is substantive if its normalized **summary is nonempty OR it contains sections OR it contains cards**. A nonempty practice test is independently valid. Notes alone do not count, and nonempty sourceNotes require the persistable study set. Empty nullable aids must have a clearly specified representation. Preserve summary-only packets and summary-plus-notes packets accepted by Slice A.

Read Codex's `summary-only-probe.cjs` and observations. It calls the accepted pure validator with synthetic input and confirms a valid payload with summary, no sections/cards and no test. Add planned native/sql.js acceptance rows for this form and notes retention. Add or expand direct-native validation rows for negative/fractional/out-of-range correctIndex, title mismatches, normalized empty fields, exact length/count boundaries and nested missing/wrong-type fields. Link requirements to rows; all remain planned until B implementation is authorized.

## 3. Repair and audit the conflict fixtures

All six TB-CONF-01–06 values still fail the specified RFC UUID v4 guard. Their third group begins with 4, but the fourth group begins with a non-RFC variant nibble. Replace every one with a value whose version is 4 and RFC variant has fourth-group prefix `8`, `9`, `a` or `b`.

Validate **every UUID fixture** in the report/prompt using a real parser/version-and-variant check or an equally precise independent check. Record counts/results in the receipt. Do not weaken the intended UUID guard to accommodate invalid examples. Ensure matching operationId/materialId pairs and valid remaining incoming fields, so each conflict test reaches stored-row comparison.

For title/aid-title conflicts, separate valid incoming payload consistency from changed stored rows: when testing a stored aid-title mismatch, mutate the stored title and retry the unchanged valid operation. For material-title conflict, keep incoming aid titles consistent with the incoming material title. Keep malformed IDs or mismatched operation IDs as explicit refusal tests with zero writes. Preserve existing test IDs.

## 4. Reconcile evidence and hand back

Update only the report, conditional implementation prompt, evidence README/receipt, STATUS, PROJECT_HANDOFF and Mac tracker. Mark the bounded corrections delivered **pending Codex re-review**, not accepted. Keep all solved lifecycle, privacy/error, wire JSON, stored-equality, compatibility and release/gate statements consistent.

The current matrix has 61 unique rows (57 source/dev + four installed), and all previous IDs were preserved. Derive totals after additions; report source and installed subtotals separately. Every B row remains planned. A small pure-validator/UUID diagnostic is separate evidence, not native or installed execution.

Label the 63-PR inventory as inherited from Codex before PR #64, or record a fresh metadata check with actual commands/date/count. Codex observed 64 PR entries and zero open before this review publication. Three A2-named matches are documentation/preparation work; no specific Windows implementation branch was found. This cannot establish Windows-filesystem status or every-PR source inspection. Label inherited toolchain observations accordingly.

Verify all deliverable links, whitespace/conflict markers, tracked/untracked inventory and unchanged source. Regenerate a self-excluding receipt while retaining the reviewed identity. Return exact R3 issue-to-correction anchors, complete invariant/refusal table, valid UUID audit, requirement/test map, revised counts, before-edit verification, final hashes and measured checks.

No full unchanged test/build matrix is needed for this documentation assignment. Source, tests, fixtures, manifests, lockfiles, migrations, Slice A evidence and release identity remain unchanged. A2/M2/D1–D9 still gate B code. Do not implement UI/persistence, call providers, access owner storage/accounts, install/sign/release anything or message the Windows owner. Stop for Codex review.
