# AGENTS.md documentation round — 20 October 2026

Implementer: Codex. Reviewer and merger: Claude. Worktree:
`/Users/rickymac/code/Flight-training-offline-gen-00`, branch `codex/offline-gen`.
Everything is left uncommitted for review.

## Changes

- Added the root `AGENTS.md` (92 lines), using the assigned owner decisions,
  state locations, implementer rules, reviewer recipe and recorded gotchas.
- Updated only the current ownership section of `docs/PROJECT_HANDOFF.md`,
  added the `AGENTS.md` pointer, and moved the temporary 2:00–3:00 AM exception
  into a dated historical entry. Existing history entries are unchanged.
- Rebound the existing schema-14 manifest and `SHA256SUMS` with the same
  `docs/evidence/offline-gen-fix2-2026-10-20/rebind_manifest.py` used previously.
  Only the manifest timestamp, handoff byte count/digest and corresponding
  checksum lines changed. `src-tauri/target/flycheck0` was absent; no deletion
  was needed.

The concurrent GEN-01a source, report and evidence were not edited by this round.
No packages were installed and no commit, push or PR operation was performed.

## Receipts and results

All commands below ran through
`/Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py`,
which selects Node 22 and records raw combined output plus the real exit code.

| Log | Command | Result |
| --- | --- | --- |
| `manifest-rebind.log` | `python3 docs/evidence/offline-gen-fix2-2026-10-20/rebind_manifest.py` | Exit 0; verified 20 manifest entries and 21 checksum entries |
| `schema14.log` | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | Exit 1; 25 passed, 1 failed, none skipped |
| `diff-check.log` | `git diff --check` | Exit 0 |

The single failing schema-14 case is `snapshot outside the approved lane
refuses and writes nothing` at
`scripts/mac-schema14-profile-snapshot.test.mjs:286`. Its expected `^REFUSED: `
prefix was preceded by sandbox process-list diagnostics:
`sysmon request failed with error: sysmond service not found` and
`pgrep: Cannot get process list`. The refusal itself followed those diagnostics.
No test or helper was changed to hide the failure. Claude must independently
rerun the requested checks outside the sandbox; this is not a GREEN review.

## Follow-up: reviewer takeover rule — 20 October 2026

- Added the owner's Claude-usage takeover rule under Roles in `AGENTS.md`,
  with matching current-ownership and Workflow lines in `docs/PROJECT_HANDOFF.md`
  and `ROADMAP.md`. Codex follows the full reviewer recipe; Gemini, then Qwen
  Flash, implement while Codex reviews. Claude resumes from the loop file and
  latest round folder when its usage returns. No implementer reviews or merges
  its own round.
- Rebound the schema-14 manifest timestamp, handoff and roadmap byte counts
  and hashes, and corresponding `SHA256SUMS` entries. No other manifest entries
  changed in this follow-up.
- Kept all earlier documentation work and receipts. Concurrent GEN-01a source,
  docs and evidence were not edited. Everything remains uncommitted.

| Follow-up log | Command | Result |
| --- | --- | --- |
| `manifest-rebind-followup.log` | `python3 docs/evidence/offline-gen-fix2-2026-10-20/rebind_manifest.py` | Exit 0; verified 20 manifest entries and 21 checksum entries |
| `helper-followup.log` | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | Exit 1; 25 passed, 1 failed, none skipped |
| `diff-check-followup.log` | `git diff --check` | Exit 0 |

All three commands used the receipt runner and Node 22 environment above. The
helper failure is the same outside-approved-lane case described above: sandbox
process-list diagnostics precede the expected refusal prefix. The test remains
unchanged; an independent outside-sandbox rerun is still required.
