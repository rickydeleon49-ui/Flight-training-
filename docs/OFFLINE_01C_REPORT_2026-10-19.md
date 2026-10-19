# OFFLINE-01c: real-document fidelity and memory evidence

**Status: implemented, pending independent review.** Claude implemented it; Codex reviews. Base: main `4941b05` (OFFLINE-01a merged). This slice answers the evidence Codex required in its 01a release decision. **Extraction stays dormant:** no import trigger, no UI and no release enablement until a reviewer accepts a cap.

**Slice order:** 01c comes before 01b. The 01a cap rejection was the only blocker, and a readiness UI would have had to stay disabled anyway.

## Corpus: real, public-domain FAA handbooks

These are US government works, downloaded from faa.gov and kept outside Git. `corpus.txt` records the exact URLs, sizes and SHA-256 hashes.

| File | Size | Pages | Result | Text pages | Other pages | Counted peak | Peak RSS | Time |
| --- | ---: | ---: | --- | ---: | --- | ---: | ---: | ---: |
| Pilot's Handbook of Aeronautical Knowledge, full | 53.5 MiB | 524 | success | 522 | 1 `image_only`, 1 `failed` (`page_content_limit`) | 383.0 MiB | 533.9 MiB | 2.4 s |
| Airplane Flying Handbook, full | 260.6 MiB | – | `input_too_large` (over 128 MiB, refused before parsing) | – | – | – | 139.3 MiB | 0.02 s |
| AFH chapter 1 | 24.3 MiB | 16 | success | 16 | – | 64.1 MiB | 68.1 MiB | 0.12 s |
| AFH chapter 4 | 4.5 MiB | 19 | success | 19 | – | 20.8 MiB | 28.9 MiB | 0.05 s |
| AFH glossary | 1.6 MiB | 19 | success | 19 | – | 9.7 MiB | 22.5 MiB | 0.05 s |
| AFH index | 0.6 MiB | 15 | success | 15 | – | 6.9 MiB | 18.3 MiB | 0.02 s |

Raw results: `receipts/corpus-results.json`. The harness is `corpus.py`; the binary is in `receipts/release-worker.sha256`.

## What the real documents showed, and what changed

1. **One outsized page sank the whole handbook.**
   - **What happened:** with the 01a code, the PHAK breached the memory cap at page 449 of 524 (`receipts/corpus-results-before-budget.*`).
   - **The cause:** page 450 decodes to **60.5 MB and 2,181,004 drawing operations** (`receipts/phak-pages-440-460.txt`), and both strict inspection and text extraction built that operation list in full.
   - **The fix, a per-page content budget:** `MAX_PAGE_CONTENT_BYTES` = 8 MiB. It covers a page's decoded content plus every form it invokes, and decoding **stops** at the budget, so the oversized content is never allocated. That page is `failed` with `page_content_limit`, its text is not extracted, and the rest of the document carries on. The next largest page in the PHAK is page 228, at 4.8 MB and 190,377 operations, which is inside the budget.
   - **The result:** the PHAK completes, losing exactly one page.
2. **Loading costs more than the file.**
   - **The PHAK:** loading the 53 MB file holds **238 MiB live** for its 71,546 objects (`receipts/phak-load.txt`). That's about 3.3 KB per object in `lopdf`'s in-memory model; the document's streams account for only 55 MiB of it.
   - **The AFH parts:** chapters with about 1,000 objects load at 2–2.3× their file size (`receipts/afh-load.txt`).
   - **Why the cap rises:** with per-page work, the PHAK's counted peak is **383.0 MiB**, which completes under the old 384 MiB cap with almost no margin. **The cap is proposed at 512 MiB** (`worker.rs`): about 33% headroom over the largest handbook measured.
3. **Content-stream bombs are now stopped earlier,** by the page budget. A 1 GiB content bomb fails only its own page and uses 30 MiB RSS (`receipts/synthetic-measurements.json`). Bombs that decode while **loading** (object streams, cross-reference streams) never reach page inspection and are still stopped by the cap: `memory_limit`, 523.6 MiB RSS against the 512 MiB cap.
4. **Fidelity on real text** (samples in `corpus-results.json`):
   - **Ordinary prose extracts cleanly,** for example page 262: "as air density decreases (higher density altitude), aircraft performance decreases."
   - **Known limits, reported rather than hidden:**
     - Glyphs drawn twice to simulate bold come out doubled (the page 392 map: "aattoorr", "6600°°NN").
     - Some word gaps that are drawn as positioning rather than spaces are lost (page 132: "movingpropeller").
     - `lopdf` reads only page-level text, so text that lives only in forms is `text_unreadable`.

     These affect search quality and belong to OFFLINE-02's normalisation and matching decisions; extraction does not try to repair them.
   - **Unicode and CID:** the FAA files use embedded fonts with ToUnicode maps, and their text (for example "°" and curly quotes) came through correctly. No separate CID fixture without ToUnicode was added; that case is covered by the `text_unreadable` rule.
5. **A diagnostic bug, found and fixed:** with an unlimited budget (`usize::MAX`), the decode limit `budget + 1` wrapped to 0 in release builds, so every page read as empty. The first page-222–230 diagnostic was therefore wrong and has been discarded. Production's 8 MiB budget never hit this, but the arithmetic is now saturating.

## Cap proposal for the reviewer (§6)

- **Proposed cap:** 512 MiB of counted requested bytes, with the per-page content budget of 8 MiB, one worker at a time and a 120 s deadline.
- **Observed RSS:** at most 533.9 MiB on real files (the PHAK) and 523.6 MiB on load-time bombs, about 1.0–1.4× counted.
- **Still not a bound on RSS:** the residual risks from 01a apply unchanged. There is still no sampled RSS watchdog, under the revised contract from 01a.
- **Which documents are refused:** a dense PDF near the 128 MiB input limit could need more than 512 MiB to load. It would be refused as `memory_limit`, honestly, never partially published. The full 261 MiB AFH is already refused by size. The app's existing guidance is to split large handbooks into chapters, and every AFH chapter tested completes using 18–68 MiB.

## Not done, and not claimed

- **Memory-pressure simulation was not run.** `memory_pressure` squeezes memory system-wide, and at critical level macOS may terminate the owner's other running apps. It belongs to installed acceptance on a test machine.
- **Only one Mac was measured** (Apple M5, 32 GiB, macOS 27). Other supported Macs, including minimum-spec 8 GiB machines and macOS 12, are unverified.
- **01b (the UI), the import triggers and installed acceptance are not started.**

## Gate

- Native tests: 761 passed, 0 failed, 9 ignored (the ignored ones include the new release-only diagnostics).
- fmt, strict clippy and the lockfile check pass.
- The release build succeeds, and the corpus and synthetic measurements were taken on that same binary.
- No dependency, lock, migration, frontend or backup-format change in this slice.

Evidence: [`evidence/offline-01c-2026-10-19/`](evidence/offline-01c-2026-10-19/).
