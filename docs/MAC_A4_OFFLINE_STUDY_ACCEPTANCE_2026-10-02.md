# Independent A4 source acceptance — 2 October 2026

**Decision: accept the A4 source correction and regressions. No blocking findings remain in this focused review.** Required GitHub checks on the publication head remain the merge gate; installed offline and release approval remain open.

Claude implemented A4 on the Mac branch `codex/mac-offline-study-a4`, from main `1ae698669bc17f446cbed5bad20ad56538b2ce6e` (merged A3 PR #48). Codex reviewed the actual diff, tests and receipts, then committed that source as `c77dab94fc29fc660fdf319caa52b507e6606f88`.

The production correction is confined to `src/pages/StudyLibrary/MaterialDetail.tsx`. Saved guide/cards and practice-test rendering is independent of Gemini status, file attachment, file availability and submission eligibility. Generation notices and actions are evaluated separately. Existing saved content also remains visible during regeneration and after failure. Source problems and loading/failed/disconnected Gemini status receive explanatory notices.

Codex verified that the request handlers, explicit submission confirmation, cross-material operation lock, stale-result ownership and persistence paths are unchanged. Saved attempts remain transient. This correction introduces no dependency, migration, Rust, key-boundary, minimum-OS or A2 ownership change.

## Verification

- **Independent run:** `MaterialDetailOffline.test.ts` and the unchanged `MaterialDetailGemini.test.ts` pass, **21 tests** (11 new A4 cases plus 10 existing guards), exit 0, duration 2.49 seconds. [Sanitized receipt](evidence/mac-a4-offline-study-2026-10-02/codex-focused-review.txt).
- **Hash verification:** both source/test files and both original evidence files match all four hashes in [Claude's report](MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md). Documentation publication does not change the reviewed source.
- **Claude's final gate, inspected:** **666 frontend passed / 4 skipped**, build passed, **246 Rust passed / 6 ignored**, formatting, strict Clippy, lock synchronization and diff checks passed. Codex inspected the raw test/build/Clippy logs and [gate receipt](evidence/mac-a4-offline-study-2026-10-02/local-gate-summary.txt); the full matrix was not independently rerun.
- **Negative control, inspected:** nine of the eleven new cases fail against the original page; two connected-state guards already pass. [Receipt](evidence/mac-a4-offline-study-2026-10-02/regressions-and-negative-control.txt). Codex did not repeat that source swap.

The new tests use the real provider and disposable SQLite with synthetic saved content. They exercise reading, card reveal/navigation and practice answers/scoring while spying on `fetch` and Gemini generation calls. They cover disconnected/loading/failed status, missing/unsupported/oversized/detached sources, failure retention and another material's in-flight request. The existing ten tests retain direct-handler, preflight, ownership and mutual-exclusion coverage.

These are jsdom/source tests. Installed offline WKWebView use, VoiceOver and installed Windows remain **UNVERIFIED**, including MAC-19. No installed profile, live Gemini request or installer was used. Account/signing prerequisites, the Windows A2 owner, frozen candidate and release holds remain unchanged.

After this publication merges and the clean Mac clone is synchronized, [Claude continues A6 truthful retry wording](CLAUDE_MAC_A6_RETRY_WORDING_PROMPT_2026-10-02.md). Open-source adoption remains subject to the existing roadmap, measured-need, contract, license and platform gates.
