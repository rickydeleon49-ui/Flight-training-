# C1 independent acceptance evidence — 7 October 2026

Corrected submitted source: 37/37 hashes match `submitted-source-hashes.json`; fourteen correction evidence checksums and forty-five original evidence checksums match. Only three production/test paths plus submitted status/handoff differ from original C1. Current-main integration preserves main's documentation history; the two submitted doc snapshots are in `submitted/`.

Independent `npx vitest run src/pages/StudyLibrary/CardReviewPanel.test.ts src/pages/StudyLibrary/CardReviewCodexReview.test.ts src/components/ui/Dialog.fallback.test.ts`: **65 passed**, exit 0, no unhandled errors. The temporary frozen file matches the published reviewer diagnostic byte-for-byte (`frozen-diagnostic.test.ts.txt`) and is removed afterwards. `npm run typecheck` and `npm run build` independently pass on integration source. Node 22.23.3 PATH: `/opt/homebrew/opt/node@22/bin:$PATH`. Raw receipts/exits are in `receipts/`.

Reused, not rerun: verified corrected full frontend receipt (2,695 passed/four skips), original/native Xcode 27 results (415 passed/six ignored; build, Clippy, fmt), because applicable tested source remains unchanged. No installed/profile/provider/release work. The earlier Xcode binary predates these final frontend corrections; current frontend type/build is independently verified instead. Required exact-head source CI is recorded by the containing PR.

`published-source-hashes.json` hashes the final C1 source plus coordinator status/roadmap/acceptance/next-prompt documents. `SHA256SUMS` hashes this evidence pack except itself. Raw logs retain tool-generated whitespace; authored source/docs are checked separately.

Publication hygiene found one extra EOF blank line in the permanent panel test. The coordinator removed only that blank line; executable source and verified behavior are unchanged. Final hashes include this cleanup.

The first CI attempt's single fixture-loop timeout is retained in `receipts/ci-first-attempt.log`. The coordinator splits the 36 Node SQLite fixtures into separate named default-timeout tests, preserving validation and reopen assertions with robust cleanup. Independent corrected parity: 38 passes; typecheck: exit 0. Exact receipts: `ci-parity-correction.*` and `ci-correction-typecheck.*`. Production/native files remain unchanged by this CI correction. Final required CI is available on the containing PR.
