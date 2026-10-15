# Schema-14 verification preparation — evidence pack

This pack supports [the report](../../MAC_SCHEMA14_VERIFICATION_PREPARATION_REPORT_2026-10-11.md). It is source-only, bound to `8a260c0b32bc213850ed85bf9488d6ef571354a9`, and was measured on Node 22.23.3. This is round 4, regenerated after the third review. The receipt keeps all three earlier reviews' controller results, the complete round-2 and round-3 receipts and inventories, and the reproduced round-3 pre-fix proof failure, under `reviewHistory`.

| File | Contents |
| --- | --- |
| `verification-receipts.json` | Consolidated receipt, generated first. It holds clone identity and remote state, the base hashes each allowed path had at the pinned commit (a reconstruction: no observed pre-edit receipt exists), four competing-ownership captures, every earlier review's findings and what changed, and every required command (argv, cwd, start, duration, exit, full stdout/stderr, parsed counts). It also embeds the proof-runner receipt (`proof`) and the full source and SHA-256 of the disposable consolidation runner, which was kept outside the repository. |
| `source-manifest.json` | Generated after the receipt. It lists SHA-256 and byte length for every scoped deliverable and every other file in this pack, the pinned commit, and the helper/test hashes the receipt measured. |
| `SHA256SUMS` | Generated last; covers every other file in this directory and never itself. Verify with `shasum -a 256 -c SHA256SUMS` from this directory. |
| `RUNBOOK.md` | The one canonical future operator walkthrough. |

## Summary

- Focused Vitest, five files: 117/117 passed. `node --test` helper tests: 21/21. Proof runner: 12/12 stages, without starting a git process. Schema-14 self-check, run in a disposable copy: 102/102. The distributed helper refuses `self-check` (exit 2): it has no test route. Typecheck, `npm run test:cargo-lock` and whitespace checks pass.
- The historical schema-13 self-check gives 105/106, exit 1. The one failure is the intentional live-source ceiling alarm, reported separately from the passing regressions.
- The proof sets aside gitignored Cargo/Tauri build output (`src-tauri/target`, `src-tauri/gen`) only when it is recognized exactly. It lists what it set aside in its receipt. Stage `source-walker-sensitivity` shows that unexpected source and changed protected files are still reported.
- History, kept and not overwritten: round 1 had a Vitest hard-link failure, a proof blocked on `/dev/null`, and Cargo missing. Round 2 had the proof at 9/11 on unrecognized Cargo build output. Round 3 was not approved: the inventory's `LIKE 'sqlite_%'` hid `sqlitex_…` user objects, and symlinked runtime roots were followed outside the profile. Both are fixed in round 4, each with a guard reversion that reproduces the defect.

## Boundaries

- The proof runner writes only to fresh temporary directories, and its own receipt goes to a new temporary directory. Disposable helper copies, each with a scratch lane in place of the operator lane, are written only there. The repository copy of the receipt was written by the consolidation runner.
- Scratch libraries carry a synthetic SQLx ledger written by the helper's scratch builder, not by SQLx.
- Restores put closed database copies back in place: this is archive-state fidelity. No native backup or restore ran.
- No installed app, real profile, `/Applications`, staged kit, real backup, credential or provider was touched.
- The schema-14 installer identity is unavailable.
