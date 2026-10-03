# Independent A6 source acceptance — 2 October 2026

**Decision: accept the A6 source correction and regressions. No blocking source findings remain.** Required GitHub checks on the final publication head remain the merge gate; installed-platform and release approval remain open.

Claude implemented A6 on `codex/mac-gemini-retry-wording-a6`, from main `db1539408368aa48260228029590ab19a4748f4d` (A4 PR #49). Codex reviewed the actual diff, callers, tests and receipts, then committed the reviewed source as `32539bd6be86ac4f6c397f5fc51ca92931facce5`.

## Accepted correction

- The exhausted-generation busy message describes primary attempts and the backup request without using nominal backoff to claim total elapsed time. The unused `total_wait_seconds` helper is removed.
- `describe_refusal` uses generic, context-aware 429/5xx wording. Connection verification can retry the primary model but never uses the backup; its message no longer claims generation's backup history. A single-response helper does not invent operation history.
- The completed-generation paths retain their history-bearing messages. The actual async retry loops, timeouts, backoff/jitter, model selection, payloads, progress, key handling and frontend submission/locking behavior are unchanged. Invalid-key, permission, request and retired-model guidance remains distinct.

## Evidence

Codex independently ran `cargo test --locked --manifest-path src-tauri/Cargo.toml gemini::tests` with SDK 26.5: **30 passed**, none failed. [Sanitized receipt](evidence/mac-a6-retry-wording-2026-10-02/codex-focused-review.txt). The production/test source matches Claude's reported SHA-256 `41ba366b27a1aedca2318fd389ba2ae0d99909ab2e051a5c2e75488e4667fa71`.

Claude's inspected final gate passes: **666 frontend / 4 skipped**, build, **250 Rust / 6 ignored**, formatting, strict Clippy, lock synchronization and diff checks. Codex inspected the raw test/build/Clippy logs and [receipt](evidence/mac-a6-retry-wording-2026-10-02/local-gate-summary.txt); the unchanged full matrix was not independently rerun. Claude's inspected [negative-control receipt](evidence/mac-a6-retry-wording-2026-10-02/regressions-and-negative-control.txt) records three new claim tests failing on the original source and one retained guard passing. The four new tests bring the Gemini module from 26 to 30 cases.

These are pure message-contract tests, not live network, installed app or VoiceOver observations. No dependency, migration, frontend, configuration, model or A2 change is included. Installed Mac/macOS 12/Windows checks, dedicated-account/signing prerequisites, the frozen candidate and release holds remain unchanged.

## Handoff corrections

The report's proposed A5 rewrite is outdated. Current main already has independent deterministic image buffers and visible page IDs in `scripts/generate-pdf-fixtures.mjs`, the fail-closed `scripts/inspect-backup-credentials.mjs`, corresponding `src/logic/releaseSafety.test.ts` coverage, updated fixture metrics and honest memory wording in the Mac tracker. The relevant merged history includes `81f98b2` and `61860b0`; earlier Mac source receipts already record matching generated fixture hashes. This review establishes that those fixes exist, not complete A5 verification on the current Mac.

The next assignment is therefore [Claude's A5 evidence reconciliation](CLAUDE_MAC_A5_EVIDENCE_RECONCILIATION_PROMPT_2026-10-02.md): verify current fixes, identify any actual remaining gap, and avoid rebuilding already-correct tooling.

Codex independently confirms current `sw_vers`: **macOS 27.0.1, build 26A434**. Earlier reports recorded 26.6. This confirms today's OS, not when an upgrade occurred or whether earlier OS entries were accurate. Preserve historical evidence with its recorded identity; no old DMG/signing result is a current installed pass.
