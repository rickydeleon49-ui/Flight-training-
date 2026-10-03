# Codex readiness acceptance evidence — 3 October 2026

[Independent acceptance](../../MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md) closes READINESS-R1–R4 for source/tooling integration, not installed use.

| File | Evidence |
| --- | --- |
| `review-receipt.txt` | Fourteen input hashes, independent commands/counts/exits and reported-result distinctions |
| `independent-probes.mjs.txt` | Injected probe runner, hash-guarded to exact old/corrected script bytes; inert text outside test discovery |
| `corrected-probe-results.json` | Seven desired outcomes met; exit 0 |
| `reviewed-probe-results.json` | Seven desired outcomes unmet on original bytes; exit 1 intentionally |
| `host-recheck.json` | Default actual read-only observation, schema 2; installed readiness false |

The probes adapt the previous independent cases for schema-2 check identifiers and successful versus failed verification responses, with synthetic SDK directory inspection. No real artifact command is invoked and no owner profile is read. To reproduce, copy the runner text to a task-owned `.mjs` file and pass the exact old or corrected script path as its first argument. Hash guards reject other source versions.

The actual host recheck has 9 PASS, 0 FAIL, 3 UNVERIFIED and 3 USER_ACTION, exit 0. It contains no `/Users/` path. This is host evidence only; it never establishes account isolation, installed behavior, notarization or release approval.
