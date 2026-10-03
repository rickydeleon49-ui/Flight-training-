# Independent Mac readiness review evidence — 3 October 2026

Codex reviewed Claude's uncommitted ten-file handoff and preserved it unchanged. [Review](../../MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md) and [correction assignment](../../CLAUDE_MAC_READINESS_CORRECTION_PROMPT_2026-10-03.md).

| File | Meaning |
| --- | --- |
| `review-receipt.txt` | Input hashes, independent commands/counts/exits and publication limits |
| `reviewed-preflight.mjs.txt` | Exact reviewed script snapshot, inert text; not the production tool |
| `reviewed-tests.ts.txt` | Exact reviewed test snapshot, inert text; outside test discovery |
| `reviewed-runbook.md.txt` | Exact reviewed runbook snapshot with the phase-1 stopping condition |
| `preflight-review-probes.mjs.txt` | Hash-guarded independent injected diagnostic; no actual system commands or installed use |
| `probe-results.json` | Seven intentionally unmet expectations on the reviewed script; diagnostic exit 1 |
| `host-recheck.json` | Actual default read-only host observation; exit 0, 9 PASS / 0 FAIL / 3 UNVERIFIED / 3 USER_ACTION; installed readiness false |

Reproduce the original characterization with Node 22 by copying the reviewed script and diagnostic text to fresh task-owned temporary `.mjs` files, then running the diagnostic with the script's absolute path as its first argument. The script hash guard must match the reviewed bytes. This does not exercise a real signature, DMG, Gatekeeper or installed app.

The diagnostic checks desired outcomes and intentionally returns 1 for the reviewed implementation. It is not included in ordinary test discovery or the GitHub test gate. After corrections, use permanent regressions against the real corrected tool; this frozen evidence remains a characterization of the original bytes.

The synthetic SDK existence seam was corrected before the final diagnostic run so missing metadata cannot fall through to the physical Mac's SDK files. The final result reports explicit SDK version unknown for that case. No production mutation was made.

No owner profile, credentials or keychain were inspected. The actual host receipt contains no `/Users/` path. It describes this Mac at capture time only, while the source remained dirty. No installed or release approval is implied.
