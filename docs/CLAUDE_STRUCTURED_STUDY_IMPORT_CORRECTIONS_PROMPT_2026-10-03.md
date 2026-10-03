# Claude: correct the structured study-import contract and prototype

Copy the following prompt into Claude on this Mac. The [independent review](STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) requests corrections; it does not accept the contract or authorize production adoption.

---

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-`. Your assignment is to correct the structured study-import preparation, prove the corrected behavior with the actual candidate packages, and deliver a coherent future implementation handoff. Keep this as contract/schema/fixture/documentation and disposable-prototype work. Do not begin production Slice A, B or C during this assignment.

## 1. Establish the exact starting state and preserve other work

Confirm the repository, branch and HEAD before editing. Expected branch: `codex/structured-study-import-contract`; expected HEAD/base: `8fb3b7fe7f8ae425b41c597549f930e1aadb326a`. Your previous handoff consists of 87 files, 85 new and two modified. Compare all 86 file hashes listed in `docs/evidence/structured-study-import-contract-2026-10-03/validation-receipt-2026-10-03.txt`; the receipt itself must initially hash to `b2b8caea744ac6710fe61f3291b3c97c0700de696a336040fdedba9ee0b057f6`.

Codex is publishing a separate review-only commit on main. That does not mean your local contract package has been merged. Read the current report/prompt through GitHub or `git show origin/main:<path>` if those files are absent from your branch. Do not switch away from, reset, stash away, overwrite or force-merge the dirty package simply to obtain them. If unexpected files differ, preserve them and identify the owner/scope; finish independent work where possible. Codex will handle safe integration after acceptance.

Read the review, the current contract, JSON Schema, implementation handoff, expected-outcome manifest and prototype sources. Also reconcile `docs/OPEN_SOURCE_MAC_HANDOFF.md`, `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md`, ROADMAP, STATUS and the project handoff. Read the actual domain types for the Slice A DTO correction. Reuse the current clone and disposable scratch approach.

## 2. R1: make diagnostic privacy an invariant

The current prototype exposes arbitrary identifier-shaped packet keys in `field`/`path`, and duplicate export IDs in `id`. Character syntax is not a privacy boundary. A generated secret-shaped key is echoed in an unknown-field error, in a nested scan-error path, and in a duplicate-ID error despite the credential rejection.

Use contract-owned field names and numeric indexes in diagnostics. Unknown user-controlled keys must be redacted; raw export IDs must not be returned. Indexes and `firstIndex` can identify duplicate items without repeating their IDs. Keep fixed messages/codes, numeric limits/offsets and the existing 50-error cap. Preserve targeted directive/legacy-answer errors through fixed allowlists, without including arbitrary input. Apply the same invariant to scan, schema, semantic and unexpected-error handling. Never return raw Zod issues, inputs, raw file paths, parser exception messages or fragments of packet text.

Do not solve this only by expanding credential regexes. Ordinary ASCII private content can resemble an identifier too. Add permanent cases for unknown ASCII keys, duplicate keys, nested unknown-key scan failures, duplicate question/card/choice IDs, credential-shaped variants assembled at runtime, and benign fixed known-field paths. Check the entire returned failure object, not only `message`. Keep complete token-shaped values out of committed fixtures and logs. Add a deliberate diagnostic-echo mutant and show that the new regressions catch it.

Revise contract §2.12 and `PacketError` together so that the documented API actually guarantees the behavior. Explain which fields are fixed and which numeric values are allowed. Keep the existing encoding, bounded scan, version-first schema gate, strict unknown-field handling and answer-key checks intact.

## 3. R2: preserve validated preview information separately from storage

The successful validator currently strips source claims, export IDs and source references before returning, leaving the promised preview unable to display them. Return either a clearly typed normalized validated packet or a bounded preview-data model containing source claims and item-associated references. Keep the persistence payload separate and lossy by design.

The preview must have enough validated data to show generator, createdAt and note as unverified claims, and each card/question's sourceRefs associated with the correct item/order. Export IDs may remain in successful in-memory preview data; they are not durable identity. Source claims, IDs and refs still do not enter stored rows in this version. Imported `sourcePage` must remain null. Disclose what is discarded before confirmation. Never parse the original file again to reconstruct these values.

Flag every non-empty source claim, including note-only and date-only sources; an empty source object need not imply a claim. Test source-only variants, multiple refs on different items, NFC/whitespace normalization, absent/empty source fields, and the existing guide-only/questions-only/card-only combinations. Assert actual preview values and associations as well as counts and warnings. Assert that the same values are absent from persistence output. Add a mutant that drops preview provenance or warns only for generator and prove it is caught.

## 4. R3: make Slice A independently type-correct and specify its boundary

Current `AiStudySet` and `PracticeTest` require provider `"gemini"`. Your proposed Slice A `Omit` types retain that requirement while returning `"import"`; the domain widening belongs to B. Define dedicated import DTOs or explicitly omit/redefine provider in the preview payload types. Keep existing stored-domain types, repository behavior and production code unchanged in this preparation.

Provide a compiling disposable TypeScript example importing the real current domain types. It must represent guide-only, test-only and combined import payloads with provider `"import"`, without unsafe casts or widening shipping types. Make the contract, prototype and handoff agree on material defaults, normalized preview fields and persistence fields. If a later layer supplies defaults, name it explicitly.

Define the reader/validator boundary precisely: native strict UTF-8 and original-byte size/hash checks, BOM behavior, whether the pure validator receives bytes or validated text, and how it enforces limits in unit tests without trusting arbitrary claimed lengths. Distinguish the original file SHA-256 from a canonical normalized persistence-content hash. Specify the canonical fields/order and excluded preview-only claims if the future handoff retains contentHash; do not implement a database hash column or transaction now.

## 5. R4: reconcile gates without silently granting an exception

The accepted adoption plan retains foundation/source/installed evidence gates before production library adoption. Your handoff's Slice A table says foundation gate, but §6 and its future prompt permit A without A2. Reconcile all opening statements, tables, STATUS, handoff rows and copy-ready future prompts. This assignment permits contract/prototype corrections now; it does not grant a new adoption exception.

Distinguish what can be prepared, implemented, merged and released. Production Slice A waits for applicable foundation/adoption gates or an explicit documented owner exception for a narrower source-only slice. Slice B still waits for accepted published A2 conventions and the M2 real-user check-in/scoped approval. Installed Mac testing, early macOS 12 for optional Markdown, Windows app behavior and signing/account decisions stay unverified until performed. Do not turn D1–D12 proposed defaults into owner-approved decisions or describe the older-version provenance mislabel as an accepted owner risk. Keep it a disclosed proposal requiring the appropriate decision before B.

A missing owner decision must not prevent you from completing this correction package. Use conservative clearly labelled proposals, and finish the useful contract, diagnostics and future handoff. Do not repeatedly probe unavailable A2 work or contact its Windows owner.

## 6. Verification and evidence

Use exact `zod@4.6.5`, `react-markdown@10.1.0` and the submitted locked scratch tree with scripts disabled. Preserve `jitless`, the renderer's no-navigation/no-image policy, the depth fallback, the legacy capability simulation, the sourcePage-null mapping and the current plain-text baseline. Re-check primary package metadata if needed; any version change requires an explicit rationale and refreshed relevant evidence. Do not modify repository package manifests, locks or node_modules.

Run new regressions against the reviewed prototype first and record their expected failures. Then run the corrected 95 existing validator cases plus new cases, the 23 renderer cases if the renderer changes, relevant CSP/capability checks, focused mutation tests, schema/fixture consistency and the disposable DTO typecheck. Adapt Codex's diagnostics to your documented preview shape if necessary, explaining the change rather than deleting the assertions. Preserve the two passing LF-in-ID controls. A failure in one aggregate step must make the overall runner fail; the current run-all wrapper logs child exits but can finish successfully after an earlier failure, so correct its exit propagation while preserving useful logs.

Label Node results, capability simulations, fake-adapter scenarios and future real-database tests separately. A fake store is not evidence of SQLite/sql.js atomicity. Do not repeat unchanged application/Rust matrices, build/mount/install/launch artifacts, provision accounts or signing, access the owner's app profile, use real training data, send a provider request, or begin another roadmap feature.

Keep original evidence/receipts unchanged and add dated correction results and a new hash receipt. Update the contract, schema descriptions where affected, implementation handoff, evidence README, STATUS and project handoff to say corrected pending Codex re-review. Preserve historical observations and explain superseded prototype behavior. Run relative-link checks and whitespace checks covering untracked files too; confirm production source/manifests/locks/workflows remain byte-identical.

## 7. Deliver and stop

Leave all changes uncommitted and unpushed. Give Codex: exact branch/base, complete changed/new file inventory and full SHA-256 hashes, R1–R4 issue-to-fix map with permanent test names, before/after regression and mutation results, compiling DTO evidence, exact commands/counts/exit codes, intermediate failures, updated gate/decision table, and material limits. Distinguish your new results from Codex's prior results. Stop for independent re-review; do not start production adoption or the next slice.
