# OFFLINE-02a self-review, corrections and pause — 19 October 2026

**Owner requested: finish the current work, then pause.** No next roadmap task, PR merge, release enablement or app launch is authorized by this report. Codex authored the earlier completion and these corrections: this is a self-review, **not independent acceptance**.

## Review result and fixes

Reviewed base `b84f56c` on `codex/offline-02a-completion`, in the existing `/Users/rickymac/code/Flight-training-offline-01` worktree. All ten submitted source hashes and all 24 published evidence hashes verified before edits. The unrelated primary clone and its dirty `.claude/settings.json` were left untouched.

Two confirmed defects were reproduced before correction: **95 extraction unit cases passed, 2 failed, 5 ignored**.

1. **Index triggers were not validated.** A schema-version marker, database quick check and FTS integrity check could all pass after an insert trigger was dropped or replaced by a no-op: existing rows still agreed, but the next successful publish silently failed to index new text. [`Cache::schema_matches`](../src-tauri/src/extraction/cache.rs#L197) now compares complete schema object definitions against a transient reference built from the actual schema creator, including FTS tables, indexes and trigger bodies. This small catalog check applies to memoized opens as well. A malformed cache is disposable and rebuilt; authoritative data and originals are unaffected. The regression covers both missing and changed triggers and checks exact new hits plus FTS integrity after reopening.
2. **Old hash could acquire a new stamp.** `remember()` previously hashed a file and then fetched the stamp to store with that hash. Replacing the file in that narrow gap could associate the old bytes with the new file's stamp. [`Service::remember`](../src-tauri/src/extraction/service.rs#L219) now brackets the whole operation with a stamp comparison and refuses/removes that association on change. A test-only scheduling hook proves the exact gap; a fresh retry verifies the replacement. The hook is compiled only for tests, with no runtime environment switch or command exposure.

The native initialization path is also completed: the same dedicated search worker validates in the background before becoming ready. Commands return **`index_preparing`** while setup is pending; **`index_unavailable`** distinguishes a failed setup and schedules a bounded retry on the existing worker. Cache replacement schedules revalidation. No query can use a partly checked index. A held-initialization regression proves pending commands are not admitted, a failed-initialization case proves recovery after the root becomes available, and the cache-replacement regression checks the readiness transition. Existing deadline, supersession and startup-interruption regressions remain intact. These states are backend contracts for 02b; no UI work was started.

## Owner budget decision

[The recorded decision](OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md) approves **750 ms at 10k for cold opening** and **3× canonical text bytes for added index storage**. The original 300 ms/1.0× targets and their failed receipts remain unmodified. No different denominator or hidden warm-up is used.

The separate proposed 3-second 30k threshold was not in the approval question and was not adopted. The original ≤1 second **or background validation before enabling search** rule remains. The implementation now reports that background state explicitly. All warm-query, response, memory, validation, 2-second search-deadline and release gates remain unchanged.

## Final measurements and verification

The unchanged frozen seed, corpus hashes, queries, filter sets, exact expected sets and sample schedule were rerun on the final corrected source. Measurement waits for initialization are included in first-query timing, not silently discarded. Final receipts are in [the evidence](evidence/offline-02a-self-review-2026-10-19/README.md).

- **4,050 timed searches, zero errors/timeouts**; all **90 exact reference sets and 90 capped prefixes** match.
- Worst 10k cold open + first query: **588.53 ms**, within the approved 750 ms.
- Added index storage: **1.693×–2.663×**, within the approved 3×. Original 1× target remains visibly failed.
- Worst warm p95: **15.39 ms at 10k**, **38.20 ms at 30k**; concurrent 10k p95 **13.78 ms**. All unchanged budgets pass.
- 30k search-process RSS: **33.5 MiB**, below 256 MiB. Large-cache initialization still uses the explicit background fallback; no installed/minimum-spec or pressure result is claimed.

Final native tests: **813 passed / 11 ignored** (785 unit, 13 service, 15 worker). Strict Clippy, formatting, lock synchronization, whitespace and default-release refusal checks pass; exact commands/counts are recorded in `gate-exits.json` and the raw gate archive. Unchanged frontend results are reused from the previous completion: **3,728 passed / 6 skipped**, typecheck/build and 26 schema-helper assertions. No frontend source or dependency changed. Migrations 1–15, checksum registry, manifests/lockfiles and release versions remain unchanged. The default release build still refuses offline commands, and no workflow opt-in is enabled.

No memory-mapped I/O tuning was adopted. SQLite's [official tradeoffs](https://sqlite.org/mmap.html) include different I/O-error handling and platform restrictions; the approved budget change lets this package retain the existing I/O behavior and full checks. This research is not a new performance or compatibility claim.

## Paused state / next action

Current work is saved on the review branch. **Pause here.** An owner-selected independent reviewer must inspect the corrections, initialization behavior and approved criteria, then run proportional checks. The next prompt is [the final reviewer/resume handoff](OFFLINE_02A_FINAL_REVIEW_RESUME_2026-10-19.md).

After independent acceptance, normal PR creation and exact-head CI precede any merge. Only then may OFFLINE-02b search UI/navigation begin, followed by 02c saved study content, homework and exports. Do not resume automatically.
