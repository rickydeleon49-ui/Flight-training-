# Schema-17 helper assertions — 20 October 2026

Codex implemented this test-only update for Claude review. All changes remain uncommitted.

- Followed the schema-16 pattern in commit `f02e850` from the OFFLINE-03a fixes worktree. Read migration 0017 and confirmed its registered description is `practice_authoring`.
- Added the two schema-17 objects and updated all four later-schema anchors. Exact drift order and redefinition names came from the real runner output in `source-anchors.log`, not inferred SQL behavior. The frozen schema-14 helper was not edited.
- Baseline `baseline-helper.log`: **EXIT 1**, 23 passed / 3 failed. The lost-special-keys test failed in `assertOnlyLaterSchemas` on the registered migration list, after passing its report-count assertions.
- Final `helper.log`: **EXIT 1**, 25 passed / 1 failed. Both schema-related failures are fixed. The sole remaining failure is `snapshot outside the approved lane refuses and writes nothing`: sandbox process-list diagnostics precede the expected `REFUSED:` line and fail `/^REFUSED: /`. The assertion was preserved.

Exact final stderr reported by that assertion:

```text
sysmon request failed with error: sysmond service not found
pgrep: Cannot get process list
sysmon request failed with error: sysmond service not found
pgrep: Cannot get process list
REFUSED: profile root does not exist: /Users/hfdtest/Library/Application Support/com.herflightdeck.app
```

- `source-anchors.log`: **EXIT 1**, the frozen helper reports exactly its four expected later-schema alarms; 98 of 102 internal checks pass.
- `diff-check.log`: **EXIT 2**, existing trailing whitespace in concurrent source work: `src/data/repositories/documentRepository.test.ts` lines 160, 202, 208, 224, 241 and `src/data/repositories/importStudyPacket.test.ts` line 127. Those files were left untouched.
- Every command log was captured with `python3 /Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py`; each includes the command and real exit code.
- Rebound only the test file's byte count/hash in the schema-14 completion manifest, its timestamp, and the corresponding test/manifest SHA256SUMS entries. All 20 manifest entries and 21 SHA256SUMS entries were verified against current files. `src-tauri/target/flycheck0` was absent.

The requested green gates remain unmet; these receipts do not claim 26 passing tests or a clean full-worktree diff check.
