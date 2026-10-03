# Structured study-import contract: independent review, 3 October 2026

**Verdict: corrections required before contract acceptance or production adoption.** Codex reviewed Claude's uncommitted `codex/structured-study-import-contract` package in the Mac clone, based on `8fb3b7fe7f8ae425b41c597549f930e1aadb326a`. Four findings are listed below. This publication contains the review, diagnostics and [Claude correction prompt](CLAUDE_STRUCTURED_STUDY_IMPORT_CORRECTIONS_PROMPT_2026-10-03.md), not the proposed contract implementation.

The submitted package comprises 87 files: two modified status/handoff documents and 85 new contract/schema/evidence files. All 86 hashes in Claude's receipt matched before review. The receipt's full SHA-256 is `b2b8caea744ac6710fe61f3291b3c97c0700de696a336040fdedba9ee0b057f6`. Application source, manifests, lockfiles and workflows are unchanged. Reviewed files remain local and uncommitted; paths below identify that exact submission rather than files published by this review.

## Confirmed findings

### R1 — P1: diagnostic fields can expose secret-shaped packet text

Locations in `docs/evidence/structured-study-import-contract-2026-10-03/prototype/validator.mjs.txt`: `pathString`, lines 149–155; duplicate-key reporting, line 272; unknown-field mapping, lines 463–468; duplicate item/choice IDs, lines 513 and 526. Contract §2.12 promises that packet text is never included in errors, while permitting arbitrary identifier-shaped field names and IDs.

An identifier pattern proves character syntax, not privacy. A synthetic `sk-` plus 30 repeated letters is accepted by `SAFE_NAME_RE` and the item-ID pattern. An unknown field with that name is returned verbatim in `errors[].field`; a nested scan failure includes it in the path. Two questions with that ID return it in `duplicate_id`, even though a later semantic check also reports `credential_like_content`.

Codex reproduced all three exposures without printing or committing a complete token-shaped value. This contradicts both the no-echo promise and the credential guard. It is a defect in the reference prototype, not an exposure in the shipping app.

**Correction:** diagnostic paths may contain only contract-owned field names and numeric indexes. Redact arbitrary names; use indexes/`firstIndex` instead of raw export IDs. Keep fixed error codes/messages and the cap. Apply this at scan, schema and semantic stages, rather than adding another limited secret detector. Add ordinary ASCII private sentinels as well as generated credential-shaped keys/IDs to permanent regressions and mutation checks.

### R2 — P2: successful validation discards the promised preview claims

Locations: prototype `validator.mjs.txt`, lines 550 and 638–657; proposed `PacketPreview`, implementation handoff lines 41–44; contract §§2.9 and 3.1.

The contract requires the preview to display source claims and item-associated unverified references before the user agrees that these will not be saved. The successful result contains only counts, warnings and the lossy persistence payload. Neither the result nor its advertised type retains `source`, export IDs or per-item `sourceRefs`. The UI cannot display those validated values without parsing the raw file again or weakening the contract. In addition, a `source` containing only `createdAt`/`note` produces no `source_claim_unverified` warning, because the prototype checks only `source.generator`.

**Correction:** return a bounded normalized preview-data object or validated packet alongside the separate persistence payload. Retain all source claims and per-item associations there; continue stripping them from saved rows and setting `sourcePage: null`. Flag every non-empty source claim, including note/date-only claims. Define and test the preview type, not only counts.

### R3 — P2: Slice A's proposed payload cannot satisfy its own TypeScript type

Locations: implementation handoff lines 43–44 and Slice B's provider-type change; current `src/domain/types.ts:257,277`.

Slice A returns `provider: "import"`, but its proposed `ImportPayload` uses `Omit<AiStudySet, ...>` and `Omit<PracticeTest, ...>` without omitting/redefining `provider`. Both current domain types require `"gemini"`; widening them is assigned to Slice B. A minimal diagnostic importing the real current types produces two TS2322 errors, exit 2. The proposed independently reviewed Slice A therefore cannot typecheck as specified.

**Correction:** define explicit import-preview/persistence DTOs or omit and redefine `provider` for those DTOs. Leave the current stored-domain/provider changes in their agreed later slice. Include all material defaults or explicitly document where they are supplied. Specify the validated bytes/text boundary and raw-file versus normalized-content hashes consistently. Add a compiling positive type example against the unchanged domain types.

### R4 — P2: implementation gates contradict the accepted adoption plan

Locations: implementation handoff §1 says Slice A needs the foundation gate, but §6 says A can proceed without A2; its future prompt requires A2 only for B. `docs/OPEN_SOURCE_MAC_HANDOFF.md:31` requires foundation corrections and source/installed evidence gaps before production adoption; `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md:100` retains foundation and relevant M2 gates. The contract's own opening also describes broader implementation gates.

Planning and disposable prototypes were explicitly authorized while these gaps remain. The latest assignment did not authorize silently making production Zod adoption an exception. No A2 acceptance or installed-test result has been supplied.

**Correction:** reconcile every gate table and future prompt with the accepted plan. Keep contract/prototype corrections independently actionable now. Production Slice A may begin only after the applicable foundation/adoption gates are satisfied, or the owner explicitly grants a documented narrower source-only exception. B still requires accepted A2 and the M2 check-in/scoped go-ahead; installed results remain unverified. Describe implementation, merge and release gates separately without presenting any missing approval as complete.

## Independent verification

Codex reconstructed the submitted inert sources in a disposable folder, installed the exact locked tree with scripts disabled, and used Node 22.23.3. No application profile or database was accessed.

| Check actually run by Codex | Result |
| --- | --- |
| Submitted file hashes | 86/86 matched; receipt hash confirmed |
| Validator fixtures/generated boundaries/reader | 95/95 passed, exit 0 |
| Renderer hostile/nesting/URL cases | 23/23 passed; 0 fetch calls, exit 0 |
| Zod `jitless` probe | 0 Function constructor calls; seven valid fixtures accepted, exit 0 |
| Legacy capability simulation | validator works; renderer fails without `Object.hasOwn`, works with shim, exit 0 |
| Additional diagnostics | six contract assertions fail (R1/R2); two LF-in-ID rejection controls pass, exit 1 as expected |
| Proposed Slice A provider type | two TS2322 errors, exit 2 as expected |
| npm registry metadata | exact versions, MIT labels and integrity match the submitted lock |

[Evidence and reproducible diagnostics](evidence/structured-study-import-review-2026-10-03/README.md) preserve these results. Claude's 11 mutation checks, schema consistency, default-JIT count and 13 fake-adapter scenarios remain **Claude-reported**; Codex did not rerun them. Fake-adapter observations are not database transaction evidence. Node capability removal is not installed WebKit testing. Full unchanged application/Rust matrices were deliberately not repeated.

One evidence-harness improvement is included in the correction prompt: `prototype/run-all.sh.txt` logs each child exit but does not propagate earlier failures to its final exit. The individual recorded successful steps remain valid; future aggregate runs must return failure when any required step fails.

The exact candidates remain `zod@4.6.5` and `react-markdown@10.1.0`. Primary package metadata was verified through the npm registry; the [Zod documentation](https://zod.dev/api) and [react-markdown security documentation](https://github.com/remarkjs/react-markdown#security) were also consulted. These checks support the bounded experiment, not production acceptance. Plain-text rendering remains the existing safe baseline; Markdown adoption stays optional.

## Disposition

Claude should correct R1–R4 on the current Mac branch and leave the result uncommitted for focused re-review. Preserve the original evidence and add new receipts. No production dependency is accepted by this review. A2, M2 product approval, installed Mac/early macOS 12/Windows behavior and signing/account decisions remain pending. The owner's real app data, frozen artifacts, release holds, Gemini requests and credentials remain outside this task.
