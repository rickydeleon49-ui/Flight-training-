# Claude: first structured study-import source slice on the Mac

This is the detailed implementation assignment following [contract preparation acceptance](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md). **It remains conditional on the authorization gate below.** Contract acceptance is not a production-adoption exception.

---

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-`. Implement only Slice A: the strict structured-packet validator and a read-only native packet picker, using the accepted `hfd-study-packet` v1 contract. Deliver a tested, reviewable source change for Codex. Leave it uncommitted and unpushed.

## 1. Authorization and starting state

Before production edits, confirm either that the applicable foundation/adoption gates are satisfied, or that the owner has explicitly authorized this narrower source-only Slice A before A2/installed/M2 gates. Read the acceptance, current STATUS, the adoption plan, open-source Mac handoff and implementation handoff. Do not infer an exception from contract acceptance, a proposed prompt or a suggested option.

If the owner authorizes the exception, record their exact scope and the remaining gates in a short repository decision note before implementing. That exception covers only this validator/read-only command slice. It does not cover database writes, the import UI, provider-label changes, Markdown rendering, M2 migrations, installation, signing or release. If neither authorization route exists, report the missing gate and keep this assignment pending; do not install production dependencies.

After the accepted preparation is merged, confirm this Mac checkout is clean and synchronized with main. Create a new `codex/` branch for this slice from that exact main commit. Record branch/base and current toolchain. Preserve unexpected changes; do not continue on the old dirty preparation branch or mix unrelated work.

## 2. Ground truth and dependency scope

Read the accepted contract and implementation handoff, `docs/contracts/hfd-study-packet-v1.schema.json`, expected outcomes, all synthetic fixtures, R1–R5 correction maps, and the final prototype in `prototype-r5/` with unchanged helpers/types from the earlier folders. The final behavior includes 106 fixture/boundary/reader cases, 41 permanent regressions, both diagnostic sets and 22 mutation outcomes.

Use Zod only. Re-check the exact reviewed `zod@4.6.5` registry metadata, integrity, license and compatibility before adoption. Pin the accepted exact version. A different version needs explicit rationale and refreshed relevant evidence. Keep the package-lock change limited to the intended dependency; inspect it for unrelated updates.

Set `jitless` before constructing any schema. Never import `zod/compile`. Add a third-party notice entry with the actual copyright/permission text and specify how the notice reaches distributed builds. Do not add react-markdown, remark plugins, search, virtualization, PDF or scheduling packages.

## 3. Pure TypeScript validator

Implement small typed modules for limits, bounded scanning, normalization/schema, semantics, diagnostic mapping, preview DTOs and canonical persistence content. Port behavior thoughtfully; do not paste the prototype unreviewed or rewrite unrelated validators.

Preserve the full contract pipeline: original byte/encoding bounds where applicable; duplicate-key/depth/key/value/integer/string restrictions; format/version gate before full schema; strict unknown fields; normalized code-point limits; ID uniqueness; choice-ID answer membership; ambiguity rejection; credential-like content rejection; packet combinations; and R5 orphan-guide-note rejection.

Maintain the diagnostic guarantee across every failure path: fixed code/message, contract-owned path segments or redaction, numeric positions/limits, fixed allowlisted field names, error cap and omitted count. No raw packet values, export IDs, arbitrary keys, Zod inputs, parser exceptions or file paths may enter failures. Unexpected exceptions return the fixed internal error.

Successful validation returns normalized bounded in-memory preview information plus a separate persistence DTO. Preserve source claims and per-item references for preview; warn on every non-empty claim; disclose what will be discarded. Persistence output excludes claims/refs/export IDs, uses provider `"import"`, model `""`, and `sourcePage: null`. Use import DTOs that redefine provider; do not widen current stored-domain types in this slice.

Guide source notes must be preserved with a substantive guide/cards and included in canonical content. Notes with only questions are rejected; standalone notes remain an empty packet; blank notes are absent. Material draft contains only title; later Slice B owns fixed material defaults. Keep original-file SHA-256 separate from the contract's canonical persistence-content hash. Do not add a hash column or database operation.

## 4. Read-only native boundary

Add a typed `pick_study_packet` Rust command and a desktop-only service wrapper. The native dialog lets the user select one JSON file; the webview must not supply an arbitrary path. Picker cancellation returns the documented empty result.

Open and inspect the selected file safely. Require a regular file, check size before reading, and bound the read to limit plus one byte so growth cannot bypass the 4 MiB cap. Reject unsupported encoding and invalid UTF-8. Compute SHA-256 over original bytes, including BOM; strip one UTF-8 BOM for returned text and report that fact. Return the documented camelCase fields consistently across Rust serialization and TypeScript.

Keep native failures fixed and free of file contents/full paths. Refuse unsupported non-desktop use through the existing desktop-only convention. Run blocking file work outside the UI thread. Follow existing app command/module patterns; inspect capabilities before changing any, and add no broad filesystem/opener permission.

The command performs no document copy, directory creation in the app profile, database operation, persistence or network request. Do not wire it into a toolbar/dialog or change existing ordinary-file import. Test the reader helper using owned temporary synthetic files without opening the native picker or accessing the owner's real app profile.

The pure text validator re-derives UTF-8 byte length/BOM accounting rather than trusting a caller-supplied length. The byte-entry helper must remain available for meaningful unit tests. Keep both entry paths consistent with their documented boundary.

## 5. Tests and completion gate

Port the committed fixtures and boundary tests without real training data. Add meaningful permanent tests covering R1–R5, explicit answer mapping, normalized Unicode limits, source-page isolation, preview/persistence separation, canonical hash stability and changes, encoding/BOM rules and error caps.

Test native reader cancellation representation, zero/at/over-size files, growth after initial size observation, invalid UTF-8, UTF-16 BOMs, regular-file requirement, original-byte hashing and fixed errors. Use deterministic temporary files and injected seams where needed; do not describe a fake observation as actual OS/installed behavior.

Prove that Zod uses no Function constructor with `jitless`. Keep deliberate regression mutations useful: the 19 caught defects must be detected by relevant assertions, while the three single-layer privacy defects may remain contained by the other layer. Do not weaken the boundary merely to make every mutation fail.

Run focused tests during implementation, then the appropriate complete local TypeScript/build and Rust format/lint/test gate once after corrections. Use Node 22 and the known explicit SDK 26.5 where required; do not change global SDK settings. Record exact commands/counts/exits. Avoid overlapping matrices or unnecessary packaging builds. The required GitHub check is the existing Ubuntu job; Mac/Windows packaging and installed evidence remain separate.

## 6. Scope and final handoff

Preserve all existing Gemini requests/prompts/key handling, study data, backup/restore contracts, database driver, managed-document ownership, minimum macOS 12.0, native PDF Open, version/bundle identity and release holds. No import UI, database writes, provider-label/domain widening, replacement flow, migration, Markdown, live provider call, signing, account provisioning, artifact launch or Windows-owner message.

Update STATUS and the project handoff with the source slice, the explicit authorization relied on, actual test evidence and outstanding installed/platform/adoption gates. Add a concise implementation report and receipt with exact file hashes, package provenance and notice handling. Describe any prototype-to-production deviations and intermediate failures.

Leave changes uncommitted/unpushed. Final handoff: exact branch/base, complete file inventory, authorization record, R1–R5 preservation map, focused/full gate results, native reader limits, licensing/bundling evidence, remaining risks and gates. Stop for Codex review; do not start Slice B or C.
