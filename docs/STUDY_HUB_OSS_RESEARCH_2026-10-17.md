# Study Guide hub: GitHub open-source shortlist

**Owner-approved evaluations OSS-01–06; no package adoption.** Requested by the owner after approving STUDY-HUB-01–08. All counts below were verified through GitHub's repository API on 17 October 2026 (local date); exact retrieval time, license metadata and archive flags are preserved in [the metadata snapshot](STUDY_HUB_OSS_REPOSITORIES_2026-10-17.json). The eligibility threshold is **at least 1,000 stars for the actual repository used**. A popular parent project does not qualify its smaller language port automatically.

## 18 October focused refresh

[Offline-study/homework/export research](OFFLINE_STUDY_OPEN_SOURCE_RESEARCH_2026-10-18.md) rechecks the actual search/PDF/OCR repositories and adds conditional CSV/PDF-output candidates, with pinned upstream license-text identities and a new API snapshot. Preserve this document's dated counts and prior evaluations; use the refresh for the newer observation. Owner priority is now offline study → homework → exports after the release/current assignment. No candidate is installed or adopted by either report.

## Candidates that meet the star threshold

| Repository | Stars | License checked | Useful outcome | Recommendation / limit |
| --- | ---: | --- | --- | --- |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | 54,014 | Apache-2.0 | Embedded PDF reading, text/page destinations and text extraction; HUB-01/06/08 | Reuse the existing M4 evaluation. Strong candidate, conditional on a pinned build working on supported Mac WebKit versions. Current upstream FAQ lists Safari18+ even for legacy builds; a successful Node parser proof is not an installed-reader acceptance. |
| [lucaong/minisearch](https://github.com/lucaong/minisearch) | 6,173 | MIT | Offline full-text retrieval of guides and document passages; HUB-01/02/04/06 | First local-search comparison candidate, already covered by P54-02 research. Compare with actual native SQLite FTS5; reuse accepted measurements and resolve memory/latency gaps. It is an in-memory text index, not a PDF parser or OCR engine. |
| [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) | 9,214 | BSD-3-Clause | Show changes before accepting a regenerated guide; HUB-03 | Best focused new candidate. Word/line differences can drive a readable preview. It does not preserve edits, merge conflicts, version records or review history by itself; those remain app contracts. Bound comparison size/time and render changes as escaped text. |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | 38,767 | Apache-2.0 | Read scanned page images locally; HUB-08 and evidence for HUB-01/06 | Evaluate later against a native Mac OCR lane. Bundle worker/WASM/language assets for offline operation; measure cancellation, startup, memory and accuracy. It does **not** read PDFs directly: render selected pages into bounded images first. OCR text is not automatically verified source evidence. |
| [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | 77,046 | Apache-2.0 | Alternative native OCR engine for scans; HUB-08 | Alternative to the JS wrapper, not a second mandatory engine. Adds native binaries, trained-data assets and packaging/architecture work. Compare with macOS-native OCR before choosing. Neither OCR option has been installed or benchmarked here. |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | 16,350 | Apache-2.0 | Optional local embeddings for semantic passage/topic matching; HUB-02/06 | Later bounded experiment only if lexical retrieval demonstrably misses useful results. Browser WASM/WebGPU support, model size and Mac performance remain unverified. Library licensing does not cover every model; separately review the chosen model. Defaults can download hosted assets; an offline lane must explicitly use reviewed local assets. Embeddings do not establish factual support. |
| [oramasearch/orama](https://github.com/oramasearch/orama) | 10,578 | Apache-2.0 from LICENSE.md | Alternative full-text/vector/hybrid retrieval; HUB-02/06 | Conditional challenger if MiniSearch/FTS5 lack a required capability. Benchmark a local package against current proof datasets; do not adopt its cloud products or replace the existing search plan without evidence. GitHub API reports NOASSERTION, so the actual repository license was inspected directly. |
| [krisk/Fuse](https://github.com/krisk/Fuse) | 20,505 | Apache-2.0 | Typo-tolerant lookup of titles and topic labels; HUB-02 | Small optional catalogue-search candidate. Distinguish fuzzy metadata lookup from passage retrieval. Do not add it alongside another adequate search engine without a demonstrated gap. |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4,108 | MIT | Algorithm/reference material for adaptive study; HUB-04 / P54-06 | Eligible **reference**, not a drop-in TypeScript/Rust application dependency. Preserve the scheduler evaluation and version/history contracts. Its stars do not waive the threshold for another repository. |

## Deliberately excluded or deferred

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs): **827** stars; [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs): **445**. Both remain below the owner's direct-adoption threshold. An explicit owner exception or compliant alternative is required before adopting their code. The existing P54-06 evaluation should report this rather than silently switching ports.
- [LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS): **3,082**, MIT, but **archived**. Exclude as a new runtime foundation.
- [LangChain.js](https://github.com/langchain-ai/langchainjs): **18,275**, MIT, active. Meets the count but is deferred: a broad agent/orchestration framework has not been justified for this local single-document workflow. Reconsider only if focused retrieval/source handling cannot meet a concrete approved requirement.
- Connected topic relationships, correction history, recommendation rules and accurate processing state should extend the current SQLite/domain contracts. None requires adding a graph server, replacement database or cloud service merely to implement the proposed UX.

## Recommended evaluation sequence

1. Reuse the existing PDF.js and MiniSearch/FTS5 evidence; close their actual Mac/fidelity/resource gaps rather than restart research or select engines from star counts alone.
2. Evaluate jsdiff for the correction/regeneration preview when HUB-03 starts. It is the clearest additional focused library in this shortlist.
3. Evaluate one OCR lane when scan coverage is assigned; compare native Mac OCR with Tesseract before choosing runtime placement.
4. Consider Transformers.js and Orama only after a measured need for semantic retrieval. Keep fuzzy catalogue search optional.

The current P54 queue and Gemini's calendar-export / scheduler-evaluation assignment remain intact. These findings inform later implementation; no dependency, lockfile, schema, provider or model asset was changed. Pin versions and inspect distributed notices, transitive code, model licenses and supported WebKit behavior before any adoption. Source-level suitability is not proof of installed Mac behavior.

## Primary technical sources

- [PDF.js compatibility FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions), plus existing M4 evaluation in this repository.
- [MiniSearch features and resource model](https://github.com/lucaong/minisearch#features).
- [jsdiff word/line APIs](https://github.com/kpdecker/jsdiff#api).
- [Tesseract.js project scope](https://github.com/naptha/tesseract.js#project-scope): PDF input is outside its scope.
- [Transformers.js local-asset settings](https://github.com/huggingface/transformers.js#custom-usage).
- [Orama license](https://github.com/oramasearch/orama/blob/main/LICENSE.md).
