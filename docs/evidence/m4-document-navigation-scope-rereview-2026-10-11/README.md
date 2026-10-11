# M4 corrected-submission independent review evidence

Verdict: corrections required (M4-R5–R8). Subject submission is archived for review, not accepted production code.

- `submitted-hashes.json`: 25 exact current paths, base c28ab8482c8635b0b2bf74686b081e02bf448f65.
- `submitted/`: those same 25 paths. Original prior review remains published separately; no duplicate shipped application sources here.
- `freeze.txt`: lists 11 original paths changed locally, including receipts02–04 and the manifest.
- `checks.json`: exact commands, directories, Node22.23.3 and exits. Initial incidental Node26 execution was replaced by the recorded Node22 checks; verdict identical.
- `submitted-suites.txt`: 15 passed (10 proof /5 SQLite), exit0. `python-probe.txt`:3 checks, exit0.
- `frozen-original.test.mjs`: original earlier diagnostic bytes. `frozen-current.test.mjs`: byte-identical relocated replay; its unchanged relative import now resolves the current snapshot. `frozen-import-adapter.diff` is empty, confirming no textual adapter. `frozen-current.txt`:10 passed, exit0, against CURRENT corrected source.
- `diagnostics.test.mjs` / `diagnostics.txt`: new assertions,13 fail/2 controls pass, exit1. These prove remaining behavior/proof gaps. The bound-aware reconciliation and persistence cases propose absent interfaces and allow equivalent API adapters. The scanner test exposes proof limitations; real-parser evidence may supersede it.
- `primary-sources.json`: checked primary links and narrow findings, without inferring installed platform results.
- `final-invariants.json`: final25/25 source recheck, production/tracking diff empty, protected checkout metadata.

To run from this evidence directory, use Node22 `--test --test-reporter=tap diagnostics.test.mjs` or `frozen-current.test.mjs`. Submitted SQLite tests use cwd-relative migration paths; replay them in a disposable checkout of the recorded base with this frozen submitted `docs/` copied in. Do not run the submitted receipt-writing runner in the original dirty worktree. `run_checks.py` records the exact original scratch execution layout; its temp paths are provenance, not a portable install command.

SHA256SUMS covers all pack files except itself. Raw submitted PDF xref whitespace and original receipt formatting are intentionally preserved.
