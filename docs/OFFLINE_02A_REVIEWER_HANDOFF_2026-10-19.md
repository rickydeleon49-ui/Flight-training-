# Independent reviewer handoff: OFFLINE-02a native search

Review `codex/offline-02a-completion` in `/Users/rickymac/code/Flight-training-offline-01`. Base: `123b4fc`; frozen measurement preregistration: `1f927b5`. Start with `docs/OFFLINE_02A_COMPLETION_REPORT_2026-10-19.md`, the accepted rev6 design and the evidence README. Fetch without pulling/resetting/stashing over dirty work. Verify all ten source hashes before any edit; report competing work rather than overwriting it.

Codex took over Claude's four quota-interrupted files and authored the completion. Your review must be independent. This package has **no acceptance**, and no merge is authorized by its passing functional tests. Its two outstanding acceptance budgets are below. Preserve the inherited checkpoint, all failed receipts, the freeze and both benchmark runs.

## Review the actual implementation

1. Inspect schema-2 creation/disposal, canonical external content, immutable stable rowids, insert/delete triggers, complete/failure/prune transactions and FTS integrity recovery. Verify that only current extractor-version readable text can hit and that no authoritative migration or data path changed.
2. Check literal query grammar/Unicode behavior, deterministic BM25/full tie order at the cutoff, duplicate expansion after the cut, exact-cap sentinel, snippets/metadata/response-byte bounds, trim offsets and coverage exclusions.
3. Check authoritative row resolution, current-session hashes/stamps, managed-path containment, deleted/replaced files and fresh destination hashing. The command must not open files or report a replacement as the old result. Check-to-open is a documented remaining race; 02b must reuse the existing navigation controller.
4. Exercise the bounded admission and command-entry deadline, including resolution/serialization, both startup interruption races, superseded waiting work, request ownership and timer retirement. Cache validation occurs on the background worker before opening the search connection. Verify no search waits on the extraction mutex, no old cache inode remains searchable and a concurrent publish cannot mix candidates/snippets.
5. Inspect both native gate checks and run the preserved default-release refusal proof. `functions` is dev-only, no new dependency/lock package or workflow flag was introduced. No provider, browser FTS or profile access is in scope.
6. Reuse the real-PDF composition proof in `src-tauri/tests/extraction_service.rs`, the 95 extraction unit passes, full gate receipts and exact-set/cap audits. Investigate any confirmed defect with a deterministic failing regression; distinguish contract failures from speculative polish.

## Known acceptance work — handle together in one precise correction report

- **OFFLINE-02A-COLD:** cold 10k open/validation + first serialized query is **570.97 ms**, against ≤300 ms. Cold 30k validation is **2,042.01 ms**; the ≤1 s threshold invokes the background fallback. Review whether that fallback fully meets the contract before calling it closed. Preserve full first-open corruption checks, file-identity invalidation, request deadlines and refusal to search a partly validated index. Do not hide cold work in discarded warm-ups or serve results before validation.
- **OFFLINE-02A-STORAGE:** added index bytes / canonical text bytes is **1.693×–2.663×**, against ≤1.0×. The external content stores the full canonical text plus the inverted index. Explain a concrete representation plan that meets the original contract, or prepare a clearly labeled design amendment for owner approval. Do not change the denominator, quietly loosen the target, remove required text or count a failed budget as passing. A changed cache representation needs its own disposal/recovery/snippet/consistency evidence and appropriate schema handling.

Do not restart 02b, 02c, homework, exports or release enablement. Do not run a desktop app, touch profiles, install candidates, call a provider or simulate memory pressure on this Mac. Minimum-spec/installed acceptance remains separate.

## Proportional verification and publication

Use Node 22 and the existing Rustup stable toolchain; scope SDKROOT to `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Do not modify global toolchains. Relevant commands:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml extraction::
cargo test --locked --manifest-path src-tauri/Cargo.toml --test extraction_service
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:cargo-lock
git diff --check HEAD
```

Reuse the unchanged frontend/full-suite receipts. For changed search/index behavior, repeat the affected frozen reference/cap audits and prescribed timings using fresh scratch caches and the **same** seed, queries, sample counts and targets. Save a new receipt directory/tag; the runner refuses to overwrite existing receipts. The committed generator recreates the private corpora from the preserved public FAA frame streams. See the evidence README for exact reproduction boundaries.

Deliver acceptance with exact evidence **only after all applicable requirements pass**, or one consolidated correction report with source references, triggering scenarios, impact and exact fixes/tests. Since this is a Codex-authored completion, do not represent Codex's own tests as independent acceptance. Update ROADMAP/STATUS/handoff while preserving history. After acceptance, the normal PR and exact-head CI workflow is required before any merge. Do not merge a known-failing performance gate merely to advance the UI task.
