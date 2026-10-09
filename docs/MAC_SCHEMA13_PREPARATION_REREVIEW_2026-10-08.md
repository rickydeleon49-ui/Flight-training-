# Mac schema-13 preparation re-review — 8 October 2026

**Decision: CHANGES REQUESTED on the snapshot helper and operator walkthrough. MACV-R3 is CLOSED.** The corrected OLD/NEW packages pass independent strict verification. The source implementation stays accepted. MACV-R1/R2 preparation is improved but not complete: new findings MACV-R4–R6 prevent treating this as a ready human-run package. G1–G3 remain unexecuted/unverified, including the explicitly blocked post-receipt installed subcase.

## Verified progress

All 22 correction-pack checksums verify and every pack file is listed. The 13 previous production source anchors are unchanged. Both corrected DMGs were independently mounted read-only, inspected without installing/launching, and detached. Their full hashes match:

| Candidate | DMG SHA-256 | Inner executable SHA-256 | strict executable / bundle |
| --- | --- | --- | --- |
| NEW `36a7b39` | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` | `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28` | 0 / 0 |
| OLD `2a6a415` | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` | `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a` | 0 / 0 |

Both are arm64, `com.herflightdeck.app`, ad hoc/runtime with sealed resources. This closes the previous missing bundle signature resources issue. No repeat rebundle/build is needed. Developer ID/notarized/public distribution readiness is not claimed.

The OLD-first sequence, offline packet setup, actual companion siblings, corrected A and C1 coordinates, and honest blocked post-receipt subcase are good changes to preserve. Submitted correction docs are published unchanged as inputs, not accepted assertions that every finding is closed.

Node 22.23.3 independently reproduces the helper self-check: **8/8, exit 0**. Its stderr also shows process inspection failed in the sandbox (`pgrep: Cannot get process list`) yet the suite still passes. The frozen review diagnostic, using the actual helper bodies on isolated scratch data and controlled process-inspection responses, gives **3 controls pass / 7 assertion failures, exit 1**. No app process was started and no real profile was used. The extraction only adds exports/removes the CLI dispatch; it does not fix or replace function bodies. This is helper-level evidence, not installed evidence.

## MACV-R4 — Fail closed and preserve the read-only boundary [P1]

**Source:** `scripts/mac-schema13-profile-snapshot.mjs:79–96,166–197`.

The `try` around `pgrep` also encloses `fail('an app is still running')`. Its catch swallows that refusal as well as real process-inspection errors. A matched PID and inspection exit 2 both return the database path. The two frozen diagnostics prove these fail; the existing self-check has no running-app refusal control. Copying database/WAL separately is only a quiescent view when the app really is stopped.

`snapshot` writes `--json` to any caller-supplied path. Pointing it at its own scratch `her-flight-deck.db` succeeds and overwrites the database with JSON after closing the read handle. The diagnostic proves `refused=false; database preserved=false`, using only the test's disposable file. A claim of a read-only helper needs output-path protection, not only a read-only SQLite connection.

CLI uid defaults to null and `--profile` checks only a basename, so advertised isolation is optional. Tighten the operator entrypoint to UID 502/non-admin and the canonical approved root; keep isolated scratch tests as explicit internal test fixtures rather than disabling production checks. Reject symlink escapes and protect database/WAL/SHM, managed files, and input receipts from `--json` aliases before any output write. Catch only the documented pgrep no-match status as success; matched output, unavailable inspection, invalid results and other errors must refuse. Keep the own refusal outside that catch. Check before any DB/WAL copy; clean temp resources on open/copy failure. Preserve original DB/WAL/SHM bytes in guard tests.

## MACV-R5 — Compare the intended gate and hash complete stored values [P1]

**Source:** helper `digestTable:130–138`, `compare:200–218`; corrected runbook Step C lines 160–163 and Step D lines 175–177.

1. The default comparator unconditionally requires schema-13 tables and ledger 13. Step C invokes it on unchanged schema-12 snapshots. It returns a diff for both absent lineage tables and maxVersion 12, so a correct older-binary refusal is scored as failure. Frozen assertion fails.
2. Step D uses `--history-only`, which skips all document anchors and ledger checks. A changed PDF with identical history returns success. The frozen restore-purpose case demonstrates that false pass; a partial history result cannot certify complete restored data. There is no explicit unchanged/upgrade/restore contract, and the comparator does not prove the entire schema-12 ledger stayed unchanged during refusal.
3. Missing required history entries are treated as `{}` on both sides, so empty history maps pass. Schema tags, table/column presence, required keys, owner/root and baseline requirements are not validated before issuing a success verdict. Frozen malformed-snapshot assertion fails. Retained operation/tombstone tables are also omitted from the helper's inventory; define the inventory against the shipped schema before claiming the whole library unchanged.
4. SQLite `quote(TEXT)` is not a lossless stored-value encoding. In the actual scratch database, updating `before\0one` to `before\0two` changes the stored TEXT bytes, but both digests equal `07ce22b55d60b2d2aff70c5cde0281e01e832aa319d7af70eada37964ff9d517`. The frozen diagnostic fails. Include exact storage type and complete bytes/values in a framed serialization, preserving embedded NULs, separator characters, BLOBs, exact integers and REAL values. Include column identity/order and verify the declared primary keys rather than silently dropping missing ordering columns.

**Correction contract:** define distinct comparisons for unchanged schema12→12 refusal (full ledger/table/file/history invariance), actual schema12→13 upgrade (required baseline12 and after13, allowed new tables, retained history/files unchanged), and schema12 backup→restored13 (valid migrated ledger/tables plus restored history/files). A history-only check may remain as an explicitly partial result, never the complete gate verdict. Validate snapshot structure and required source facts before comparison. The frozen harness now supplies a `purpose` hint (`history`, `unchanged`, `restore`) while the submitted comparator ignores it; this documents intended gate semantics without replacing any assertion. Preserve baseline evidence and promote all seven behaviors to permanent helper regressions. If a refactor changes the private API/extraction boundary, use a disclosed thin adapter preserving the assertions and fixtures, not edited expected results.

## MACV-R6 — Make the human sequence consistent with the fixed helper [P2]

**Corrected runbook references:** lines 63–68, 78–105, 123–126, 134–148, 160–178.

The walkthrough asks for snapshots while OLD is running (A1/A7), immediately after launching NEW (B3), after a failure/backup while NEW is active (B6/B7), and after restore/restart (D3). Once R4 is fixed these commands must refuse. Every snapshot/profile copy must occur after an explicit Quit and confirmed stop, with controlled relaunch steps between UI observations. Use the gate-specific R5 comparisons; Step C cannot use the upgrade comparator.

Nested C2 selects P41–60, where P starts at original101. Its root range is **141–160 of1,050**, length20, not “60–80” (line126 and the correction report). C1's 120–140/21 and A's 3–7/5 are correct.

The document is not yet a standalone operator kit: the transferred inputs do not include the helper/runtime instructions, helper commands use relative repository paths and literal `…` placeholders, some copy/chmod/ls commands abbreviate real paths, and `cp -R`/`mv` may nest into existing destinations on a rerun. Prepare readable task-owned staging, explicit helper/runtime paths, a fresh evidence directory, exact commands and refuse-existing snapshot/switch destinations. Preserve the schema12 refusal profile by moving it aside rather than deleting it with `rm -rf`; validate the active root/UID and neither app running before every switch. Keep backup-folder permissions restored even on an aborted failure test. Refusal verifies unchanged library, not absence of all newly generated startup/safety backups. Record the full backup manifest/hash; the `0.5.3` version alone cannot distinguish OLD from NEW.

Do not claim preparation/source tests executed installed gates. The unimplemented post-receipt seam remains separately proposed and blocked; fixing these helpers does not authorize silently adding that production/debug seam or mark G1 fully passed.

## Scope and publication

The primary dirty checkout is preserved. The reviewer pack freezes all 28 submitted paths, including the helper, raw rebundle logs, original tracking edits and attributes; no unaccepted helper is installed into the repository's shipping `scripts/` through this review PR. Narrow evidence attributes retain raw whitespace. All originals and already valid candidates should be retained. This is a bounded helper/runbook correction, not another broad source review or build.

[One active model-neutral assignment](MAC_SCHEMA13_HELPER_CORRECTIONS_PROMPT_2026-10-08.md) closes R4–R6. [Review evidence and diagnostics](evidence/mac-schema13-preparation-rereview-2026-10-08/README.md). Source acceptance stays accepted; G1–G3 stay unverified pending actual approved-profile observations.
