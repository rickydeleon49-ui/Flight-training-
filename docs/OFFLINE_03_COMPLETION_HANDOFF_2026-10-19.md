# Offline study proposal completion and search-link recovery — 19 October 2026

## Scope and identity

This finishes Claude’s interrupted **proposal** handoff, not the OFFLINE-03 application feature. Claude’s clean `claude/offline-03-plan` worktree was preserved at `fea61bec53266c5048f1df30f715ef7ad4992734` (base `fdbf290`, merged PR #233). Work is isolated on `codex/offline-03-handoff-completion` in `/Users/rickymac/code/Flight-training-offline-03-completion`.

The source for the earlier search backend includes Codex-authored code. This is Codex’s implementation/self-check of a subsequent bounded correction, **not independent acceptance**.

## Claude’s completed review

Claude launched a third read-only proposal review before reaching its usage limit. Its saved result says **VERDICT: GREEN**, with no blocking defects. The original result is copied verbatim to `evidence/offline-03-handoff-completion-2026-10-19/proposal-revision3-independent-review.txt`.

That result applies to **revision 3**. Revision 4 adds the approval record and the retirement-limit policy; these additions still need independent review. No review verdict is being retroactively extended to new work.

## Owner decisions

The owner explicitly answered **“Use all five recommendations”** to the bundled question in this session:
1. Additive migration 0016 for history/origin metadata, without rebuilding existing tables.
2. Regeneration defaults to **Keep my items**.
3. Manual editing (03a/03b) is intended to ship enabled after implementation, independent acceptance and normal release verification.
4. Defer passage quotes (03c) pending extraction acceptance.
5. Retain packet v1 with an explicit warning that per-item author labels do not transfer.

The proposal now accurately lists both study-set columns plus the reserved bookmark quote column. No migration, editing feature, release flag or packet format was changed here.

## Retirement-list boundary

The proposal’s 2,000-entry bound now defines its behavior: deduplicate identical retirement records; allow exactly 2,000; refuse a save needing entry 2,001 without changing active data/history or evicting old records; retain the draft. Saves that do not grow the list remain possible. Raising/resetting the limit needs a separate reviewed change. Required boundary cases are spelled out in the proposal.

## Search-link correction (OFFLINE-02C-LINK-READ)

**Trigger:** a material-page practice-question link calls `getActiveVersion`, and its read rejects. The effect previously attached only a success continuation. It also left a late rejection unhandled after unmount.

**Result:** the effect now consumes failures, applies the existing live-request guard, displays a sanitized error and provides **Retry opening search result**. Retry resolves the link again; it does not write a practice response or start a session. A gone/stale item retains its existing separate message.

Two permanent regressions were added to `MaterialDetailSearchLink.test.ts`:
- failure → sanitized message → successful read-only retry;
- rejection after leaving the material page is consumed.

Before the production correction, the five-case suite exited 1: **1 failed / 4 passed, plus 2 unhandled rejections**. The second regression’s assertion body completed, but Vitest correctly reported its late rejection as an error. With the correction, the five focused search suites pass **51/51, no unhandled errors**. These are source/component tests using synthetic SQLite, not installed-app observations.

## Verification and limits

See `evidence/offline-03-handoff-completion-2026-10-19/` for gate output, explicit exits and source hashes. **Final sequential gate:** typecheck exit 0; frontend **3,777 passed / 6 skipped, zero unhandled errors**, exit 0; frontend build exit 0; diff hygiene exit 0.  Rust application code, dependencies, lockfiles and migrations are unchanged, so native suites and release measurements were not rerun.

PRs #231, #232 and #233 are already merged. Search remains dormant in releases. The saved-content worst-case cached p50 remains **28.2 ms versus the 20 ms target**, honestly reported in the existing 02c report. Minimum-spec/pressure and installed offline-search acceptance remain unverified. FLAKE-CR-01 remains separately open; this package does not suppress or fix it.

No application was launched, no real profile/key read, no provider called, and no installer built, signed or published. No merge is authorized by this report. The next implementation is described in [the implementation assignment](OFFLINE_03_IMPLEMENTATION_PROMPT_2026-10-19.md).
