# M4 document navigation scope review — 2026-10-11

**Decision: CORRECTIONS REQUIRED, M4-R1–R4.** Preserve the isolated planning work and native-Open-first direction. The current package is not ready for scope acceptance or owner approval. No production M4 implementation is authorized.

Subject: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, `codex/m4-navigation-viewer-evaluation`, base `c28ab8482c8635b0b2bf74686b081e02bf448f65`. All changes are new M4 documents/evidence; tracked application and lockfiles are unchanged. **19 submitted hashes / 16 original evidence checksums verify.** Independent original proof: **7 passed**, exit 0. Frozen new diagnostics: **8 failed / 2 controls passed**, exit 1. No subject files were edited.

## M4-R1 — Replace unsupported compatibility and performance claims with real evidence [P1]

Report §§1,4–5 and README P6 call the evaluation rigorous and compatibility formally verified, but P6 asserts a hand-written `WEBKIT_COMPATIBILITY_RULES` object. No candidate library, worker, WASM, WebKit or native opener is exercised. P7 checks bytes, header and EOF, not that any parser can load the fixtures. Memory ranges, compressed bundle deltas, smooth 400-MB opening, “100% compatible” and zero crash risk have no measurement receipts.

The report also assigns Monterey Safari 17.6 while denying features shipped in Safari 17.4. [WebKit's primary release notes](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/) explicitly list Promise.withResolvers and Object.groupBy. That contradiction invalidates the hard-coded proof; it does not establish React-PDF compatibility. [React-PDF's current documentation](https://raw.githubusercontent.com/wojtekmaj/react-pdf/main/packages/react-pdf/README.md) specifies Safari 18 minimum. OS support, installed browser, embedded engine and exact-package support must be distinguished.

Exact npm metadata corroborates EmbedPDF 2.15.1's MIT declaration and React-PDF 11.0.0's PDF.js 6.3.289 dependency. Do not “correct” historical artifact licensing from a moving upstream branch. Complete a pinned-package/transitive/assets license inventory, particularly PDFium bundled notices. Record primary links and immutable identities. Provide one bounded actual parser/viewer load and cleanup proof where feasible; clearly mark old-WebKit/installed results unverified. Unmeasured sizes/performance stay unknown or explicitly labeled estimates, with method.

## M4-R2 — Resolve page references without inventing destinations [P1]

`proof/contractModel.mjs` lines 18–165:
- `validatePageIndex(1, NaN)`, Infinity and fractional totals are accepted. Validate finite safe positive integers for both request and total.
- Split translation accepts NaN and string pages; validate request and lineage/range consistency before arithmetic.
- `parsePageReference('3-12')` invents physical page 1; `'42'` becomes physical 42 solely from its spelling. Numeric printed labels and legacy generated `sourcePage` lack coordinate provenance. Keep unresolved label references unresolved; require a verified physical index or page-label mapping. Clamp only explicit physical requests with known bounds and show the correction.
- A nested child with deleted root chooses the live immediate parent as `sourceMaterialId` while returning root coordinates. Root page 103 could consequently be applied as parent page 103. Return explicit destination space/id and unavailable-root state; use parent coordinates only with the stored parent range. Preserve snapshot guidance when source IDs are gone.

The eight diagnostics reproduce these cases. Extend with nested split, deleted root/parent, malformed lineage, unknown counts and verified printed-label maps. Correct the report's claim that Gemini returns string `3-12`: the current response schema is integer-or-null, so ambiguity is real but string output is not its typed contract.

## M4-R3 — Preserve bookmark ownership across content replacement and restore [P1]

Candidate DDL lines 19–50 binds bookmarks and reading state only to material ID; the sole current hash is overwritten independently. A disposable actual schema-13 database plus candidate DDL accepts a bookmark at A/page42, then current identity B/10pages, leaving the old bookmark/read position unchanged and unable to identify their original content. It also accepts `not-a-sha256`. The helper compares two supplied values, but no persistence/replacement protocol supplies the saved original hash.

Specify and prove durable originating-content ownership or an equivalent transactional invalidation design. Validate hashes/page counts and bounded bookmark fields; define unknown identity, identical replacement, changed content, mixed old/new bookmarks, drift acknowledgment, failed replacement rollback, restoration of a different file and restore into older binaries. Apply candidate DDL to genuine populated schema-13 disposable databases; test persistence, FK/cascade behavior, retained pre-existing rows, backup/restore and fault boundaries. Do not claim these are proven by the seven pure helper tests.

## M4-R4 — Make the conditional production prompt match the approved contract [P2]

The conditional prompt omits its scope's content-drift requirement, opening failure/late-response rules, provenance-aware destinations and meaningful backup/restore guards. It hard-codes candidate0015 even though current main ships13 and M3 candidate14 is unregistered. Allocate the next migration from accepted main when implementation is actually authorized; candidate naming is provisional.

A requested page is not a page actually read in an external viewer. Propose honest reading-state semantics: explicit “Mark read” or “Last requested page,” with appropriate labels. Only announce successful opening after the opener resolves; failure/route change must not publish false success or advance progress. Keep recovery usable when a missing-file button is disabled. Cover these in a small injected-opener/persistence controller proof, not just string formatting.

Retain numbered owner defaults as proposed; remove “immediate” activation and all complete/tested/verified tracking claims unsupported by the corrected evidence. Keep shared tracking files untouched while M3 is active. Use the [single correction prompt](M4_DOCUMENT_NAVIGATION_SCOPE_CORRECTIONS_PROMPT_2026-10-11.md).

[Evidence, frozen submission and reproducible diagnostics](evidence/m4-document-navigation-scope-review-2026-10-11/README.md). M3 remains separate; no production source, migration registration, installer, provider or release changes.
