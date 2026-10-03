# Mac installed-readiness preparation evidence — 3 October 2026

Prepared by Claude on the Mac in `/Users/rickymac/code/Flight-training-`, on branch `codex/mac-installed-readiness-preparation`. The base is clean `main` `8b15948` (PR #54); the work is local and uncommitted, pending Codex review.

**Corrected on 3 October 2026 after [Codex's readiness review](../../MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md) (READINESS-R1 to R4); [accepted by Codex for source integration](../../MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md).** The original receipts below are kept unchanged as historical evidence of the reviewed version.

**No installed evidence exists here.** No app was built, mounted, installed, launched, signed or notarized, and no account or keychain was changed. See the [runbook](../../MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md) and the [preflight usage reference](../../MAC_READINESS_PREFLIGHT.md).

| File | Evidence level | Content |
| --- | --- | --- |
| [`host-preflight-2026-10-03.json`](host-preflight-2026-10-03.json), [`host-preflight-2026-10-03.txt`](host-preflight-2026-10-03.txt) | **Actual host observation, original tool** (schema `/1`, historical) | The JSON and text from `node scripts/mac-readiness-preflight.mjs --receipt …`, exit 0: **9 PASS, 0 FAIL, 3 UNVERIFIED, 3 USER_ACTION**. Its `readyForInstalledUse` is false. Details below. |
| [`host-preflight-corrected-2026-10-03.json`](host-preflight-corrected-2026-10-03.json), [`host-preflight-corrected-2026-10-03.txt`](host-preflight-corrected-2026-10-03.txt) | **Actual host observation, corrected tool** (schema `/2`, 18:40Z) | Exit 0: 9 PASS, 0 FAIL, 3 UNVERIFIED, 3 USER_ACTION. H-SDK passes on the readable version 26.5 (evidenced), not on presence. R-SOURCE was dirty (2 modified, 5 untracked). |
| [`preflight-controls-corrected-2026-10-03.txt`](preflight-controls-corrected-2026-10-03.txt) | **Synthetic controls, corrected** | 34 preflight tests passed; release-safety 51 passed with 1 deliberate skip. Also the old-versus-corrected comparison: the reviewed script fails 23 of 34. |
| [`readiness-correction-receipt-2026-10-03.txt`](readiness-correction-receipt-2026-10-03.txt) | **Correction receipt** | Starting hashes, isolated comparison method, historical diagnostic reproduction, commands and exits |
| [`preflight-controls-2026-10-03.txt`](preflight-controls-2026-10-03.txt) | **Synthetic controls (original, historical)** | 17 focused tests passed; the related `releaseSafety` suite passed 51 with 1 deliberate skip, unchanged. Also four mutation-sensitivity results. |

**Host receipt details** (original run; the corrected run observed the same host, toolchain and SDK values):

| Area | Observed |
| --- | --- |
| Repository | version 0.5.3 in all five sources; `com.herflightdeck.app`; minimum macOS 12.0 |
| Host | macOS 27.0.1 (26A434), Mac17,3, Apple M5, native arm64 |
| Toolchain | Node v22.23.3, npm 10.9.9, rustc and cargo 1.99.0, `aarch64-apple-darwin` |
| SDK | explicit SDK 26.5 present; default SDK 27.0 |
| R-SOURCE | UNVERIFIED, because this task's three new paths were untracked at capture time |
| Owner and installed items | P-TEST-ACCOUNT and P-SIGNING are USER_ACTION; installed smoke shows 0 of 8 phases recorded |

The receipt contains no home path, account name, raw command output, certificate holder or team ID. This was verified by `grep` for `/Users/` and the account name: 0 matches.

**Limits:**

- The host receipt reflects this checkout and this Mac at capture time only.
- In neither run was an artifact supplied: the repository's own bundle folder does not exist, and no other location was searched. Artifact inspection is exercised only by synthetic controls.
- `--assess` was not run, because it can trigger Apple's online lookup.

**Raw logs** (task-owned, outside Git) are in `/private/tmp/claude-501/-Users-rickymac-code/87cc7222-5af2-43b4-bca3-7d3b41c974e3/scratchpad/logs/`:

- `preflight-tests-run1.log` (2 test-code faults, fixed), `preflight-tests-run2.log` (17 passed)
- `focused-final.log`
- `preflight-mut-*.log`
- `tsc.log`
- Correction run: `r-tests-run1.log`, `compare-reviewed.log`, `compare-corrected.log`, `historical-probes-reviewed.json`, `r-focused-final.log`, `r-tsc.log`
