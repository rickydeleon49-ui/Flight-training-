# M4 document-navigation preparation: independent re-review

Date: 11 October 2026. Decision: **CORRECTIONS REQUIRED; do not start M4 production.**

Subject: Gemini's corrected, uncommitted preparation at `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, base `c28ab8482c8635b0b2bf74686b081e02bf448f65`. This reviews actual files, not the completion message. The 25 current submitted paths are frozen under [review evidence](evidence/m4-document-navigation-scope-rereview-2026-10-11/README.md). Publication baseline: `196b63f230dbe7a3aad69641272ab5303571cb76`.

## Verified improvements and results

Preserve the fixes for nonfinite/fractional totals, string/NaN split requests, unmapped string labels, deleted-root substitution, originating hash columns, malformed hash checks, cascade deletion, explicit requested-versus-confirmed reading, and provisional migration numbering.

- Submitted checksum manifest: **21/21**; untouched earlier review manifest: **29/29**.
- Independent Node **22.23.3** run: submitted proof **10/10**, submitted SQLite suite **5/5**, Python probe **3 checks**; all exit 0.
- Earlier frozen diagnostic against CURRENT corrected source: **10/10**, exit 0. The frozen diagnostic was relocated beside the current submitted snapshot; its bytes are unchanged, including its relative import. SHA-256 of original and replay file match. Gemini's saved 8-fail/2-control run deliberately imports the historical snapshot. It is a valid baseline reproduction, not a current failure.
- New behavioral diagnostics: **13 failures / 2 passing controls**, exit 1. These are assertions, not toolchain failures. Two failures demonstrate missing required proof interfaces (bounded revalidation and injected persistence), rather than claiming those interfaces already exist.
- Tracked production, dependencies, shipped migrations and shared tracking in the subject checkout are unchanged. Both dirty primary and M3 preparation checkouts remain untouched. No app build or installed run was needed.

## M4-R5 — P1: coordinates still infer destinations and accept inconsistent lineage

Paths: `proof/contractModel.mjs:17–38,83–159,187–202,268–311` in the submitted evaluation pack.

`parsePageReference(42)` returns resolved physical page 42 without provenance. This is exactly the integer-or-null shape of legacy Gemini sourcePage; switching strings to unresolved does not solve numeric ambiguity. `parsePageReference('0', {provenance:'physical_index'})` resolves page zero. `Number.isInteger` accepts values beyond the safe range. Label-map values have neither safe-integer nor document-bound checks.

Nested parent ranges are checked for truthiness only: parent start `'21'` translates child page 3 into **211**, and parent range 21–22 accepts a 16-page child. Root page 103 succeeds despite supplied `sourceTotalPages:100`. Reverse root-to-child output omits the child material ID. Require validated destination ownership, safe integer counts/ranges, destination bounds and explicit provenance; unknown bounds or identity must not become a verified destination. Retain snapshot guidance for unavailable originals.

Seven named R5 diagnostics fail; complete valid nested-parent translation is a passing control. Promote these cases and add verified bounded label-map, deleted-parent and unknown-count controls.

## M4-R6 — P1: durable lifecycle proof and bounded revalidation remain incomplete

Paths: `proof/contractModel.mjs` (`reconcileBookmarksOnContentDrift`), `proof/databaseVerification.test.mjs`, candidate DDL, conditional prompt.

Originating hash columns improve durable ownership. However, reconciliation verifies any matching-hash bookmark without validating its page/count: a saved page 42 becomes verified against a supplied 10-page identity. The diagnostic's third argument is a proposed bound-aware interface; current code ignores it. Implement an equivalent explicit interface rather than preserving this adapter's spelling.

The five in-memory SQLite cases cover preservation of selected existing fields, malformed hashes, manually performed invalidation, cascade, and rollback of one identity update. They do **not** exercise file-backed reopen, mixed generations, unknown identity, actual replacement/revalidation protocol failure after invalidation, backup/restore of changed bytes, or the existing older-binary refusal boundary. No bounded persisted lifecycle helper is supplied. Do not infer those guarantees from SQL column declarations or FK cascade.

Supply a reusable disposable repository/protocol and genuine file-backed SQLite tests. Preserve prior-content rows and original hashes; verify active destinations only after identity, safe page bounds and coordinate provenance agree. Unknown/inconsistent identity stays unresolved; rollback restores all affected identity/bookmark/reading rows. Backups remain authoritative; missing restored files are never silently active.

## M4-R7 — P1: invalid opener intents do not supersede pending operations

Path: `proof/openerController.mjs:32–40,53–80`.

A pending A open starts. B is requested without a file path and fails before incrementing the operation generation. A then resolves and publishes **Opened A**, replacing B's failure. Allocate intent ownership before validation; clear stale notice on all error paths. Failed B after successful A also returns A's page 42 through the global `lastRequestedPage`. Scope progress by material/content identity.

The controller opens and announces `NaN` destinations, and accepts no injected persistence: the requested opener/persistence proof was reduced to in-memory field changes. Add explicit unknown-reference guidance without inventing progress, validated physical destinations, missing-file recovery availability and an injected durable-save boundary. Distinguish “opened but position not saved” from failed opening. Guard late callbacks around each asynchronous boundary, including save, route A→B→A, supersession and unmount. Preserve the working explicit-abort behavior.

Four R7 diagnostics fail (missing-path supersession, cross-material progress, invalid page, absent persistence). Explicit abort is a passing control.

## M4-R8 — P2: evidence and handoff still overstate completion

The new `StructuralPdfParser` is a handwritten regex scanner, not either evaluated PDF engine. It locates `xref`/trailer markers but does not decode object offsets or traverse the catalog/page tree. Replacing `/Count 50` with `/Count 99` while leaving all 50 leaves and byte offsets intact reports success and 99 pages. This diagnostic documents the evidence limitation; **do not repair/build a custom PDF engine** to satisfy the assignment. Run one bounded real parser/candidate load, malformed-input and cleanup demonstration in scratch dependencies, and state its actual runtime and limits. Clearing object fields/one heap delta does not prove memory release or bounded viewer memory.

Pinned package metadata is useful but actual package license/third-party artifact inspection is still absent. “PDFium = Apache-2.0” is insufficient: [upstream PDFium LICENSE](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE) contains redistribution conditions plus Apache text. Inspect exact selected tarballs/WASM notices/transitives; do not replace pinned MIT metadata with moving-main assumptions.

The report's Safari-16.4 “macOS13+” premise is contradicted by [WebKit's own release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), which list Monterey/Big Sur and SIMD. This does not prove installed WKWebView support. Remove guessed “WKWebView ~16.0”/OS-to-engine rules and pin evidence to actual OS/WebKit versions or label unknown.

The conditional prompt still lacks explicit provenance in its parse API, compatible restore/older-binary tests, atomic content revalidation requirements and save-failure semantics. It says a `confirmed_read` page marker means **Completed**, although reading one page cannot establish document completion, and instructs disabling a badge whose click should reveal recovery. Use “Last requested page” and a distinct accessible recovery action; keep confirmed-page and document-completion semantics separate. Carry complete final invariants into the prompt and keep owner defaults OD-1–OD-10 proposed.

Evidence history: receipts 02, 03 and 04 and the original manifest were overwritten locally. Their original bytes remain in the earlier published review snapshot, so nothing is irretrievably lost. Explicitly restore/archive those bytes, then create a distinct correction pack with new receipts/manifests. No sensitivity receipts were supplied. The correction report's “all four resolved” statement is premature.

## Next assignment and boundaries

Use [one active model-neutral correction prompt](M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md), covering R5–R8 together. This narrows/replaces the prior correction assignment; it retains successful R1–R4 work. All owner defaults remain proposed. M3's approved production work proceeds separately. No M4 production, dependency adoption, migration registration, provider calls, installed testing or release is authorized by this review publication. G1–G3 remain deferred/unexecuted/unverified.
