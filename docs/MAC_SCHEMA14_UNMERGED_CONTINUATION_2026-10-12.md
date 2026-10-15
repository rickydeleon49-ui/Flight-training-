# Unmerged schema-14 package: focused continuation — October 12, 2026

Assigned implementer: Antigravity, Gemini 3.8 Flash High/high effort. Preserve the existing isolated worktree and partial edits. Do not begin another milestone.

Verified baseline: five required Vitest suites pass 117/117; helper tests pass 14/14; typecheck and Cargo lock check pass. Proof fails 9/11 (source-identity and protected-sources-unchanged). Final artifacts remain stale (9/10 manifest entries, 3/4 checksum entries in latest review). Do not rerun unchanged passing matrices without a relevant new change; required final controller verification still applies.

1. Fix the proof walker to distinguish narrowly recognized, untracked/ignored Cargo/Tauri build infrastructure from submitted source. Preserve exact tracked protected-source hashes, pinned migration/fixture identities, symlink and hard-link guards. Never broadly ignore unknown untracked files or mask altered tracked artifacts. Add sensitivity cases showing generated infrastructure accepted while unexpected source and changed protected files are refused.
2. Run the proof in disposable roots and obtain actual success for both failed stages. Record runtime, command, cwd, stdout/stderr and exit. Keep earlier failed receipts.
3. Update the consolidated receipts, report, README and handoff with current Cargo PASS and actual proof status. Remove obsolete Cargo-unavailable claims from current conclusions; retain clearly labeled historical failures.
4. Finalize all submitted source/docs, then consolidate receipts, generate source manifest and SHA256SUMS last, and verify every recorded byte/hash. Do not subsequently change an artifact without regenerating dependent inventories. Disclose the unavailable observed pre-edit receipt; never fabricate it or claim retrospective observation.

Controller defect: previous Antigravity turns returned SUCCESS with denied read_file actions and empty responses. Those are now blocking, not reviewed as new implementations. Supporting Flight Training repository, bundle and frozen-kit read grants have been expanded. If any remaining access is denied, report the exact resource and stop rather than claim completion.

Finish with one reviewable uncommitted package. Codex independently reviews before integration. Installed-app/profile/signing/release tests remain deferred. Check-ins remain paused. No automatic provider switch.
