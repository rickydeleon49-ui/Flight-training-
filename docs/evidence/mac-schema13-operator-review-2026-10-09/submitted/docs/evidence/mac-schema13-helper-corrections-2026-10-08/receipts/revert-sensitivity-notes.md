# How to read `revert-sensitivity.json`

Each variant reverts **one** production behaviour in a scratch copy of the corrected helper, then runs
both harnesses against that copy. `selfCheckFailedOnIt` / `diagnosticsFailedOnIt` are `yes` when the
*named* assertion actually flipped to a failure, `not-expected` when that harness deliberately does not
cover the behaviour, and `no` in the two cases explained below — neither of which is a passing revert.

| Variant | Result | Reading |
| --- | --- | --- |
| `output-alias-both-branches-off` | `selfExit=2`, `selfBite=no`, `diagExit=0` | The self-check **aborts** with `file is not a database` (exit 2, so no report is emitted at all): with both alias branches disabled a JSON receipt is written over the scratch SQLite database, and the next check cannot open it. Reproduced separately to confirm the exact stderr. Removing the protection therefore corrupts inputs rather than degrading a check — which is precisely the reviewed defect. The isolated assertions for each branch are the two single-branch variants below, both of which bite. |
| `output-alias-both-branches-off` (diagnostics) | `diagExit=0` | Honest disclosure of a **limit of the frozen harness on the corrected source**: its output case calls `snapshot()` without an internal test context, so the operator approved-uid policy refuses that call *before* the alias guard is reached. The frozen test passes for a second, stricter reason; the helper's own `output: --json cannot overwrite the input database` assertion reaches the alias guard through the internal test path and is what isolates it. The harness itself is unmodified — verified against the reviewer's published `SHA256SUMS` entry. |
| `historyonly-skips-files` | `selfBite=not-expected`, `diagBite=yes` | The corrected comparator resolves every call to a named purpose, so the self-check never exercises a bare `--history-only` file skip; the frozen Step-D restore assertion does fail, which is the reviewed defect. The helper still keeps a dedicated partial-mode check. |

Everything else behaved as designed: `inspection-fail-open`, `matched-pid-tolerated`,
`nul-truncating-text`, `unchanged-demands-schema13` and `no-snapshot-validation` each broke **both** the
self-check assertion named for them and the corresponding frozen review assertion;
`output-alias-path-branch-off`, `output-alias-inode-branch-off`, `no-profile-root-protection` and
`frame-drops-table-identity` broke exactly their own self-check assertion (the frozen harness does not
cover those behaviours, marked `not-expected`).
