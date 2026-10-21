# OFFLINE-ON-2a implementation evidence

Codex took over MiniMax's uncommitted round on `codex/offline-gen` at
`4239e71`. MiniMax's three-file baseline was superseded by the five-file run
below. No files from `d17a086` were changed. Everything is uncommitted for
Claude's independent review, tests and merge.

## Fixture design and partial-work review

Retained MiniMax's basic PDF layout and fixed-Huffman compression approach.
Removed the unused many-object builder and unused zlib import. Corrected bit
packing, the end-of-block marker, 1/2-byte tails, Adler-32 calculation and word
order, the free-row width and the cross-reference offsets. Replaced unparsed
padding with declared free-object entries. Both builders now run from the
existing generator and have pinned byte sizes and SHA-256 values.

The near-cap fixture has 38,000,000 free entries and expands at load time to
266,000,049 bytes. It measured 412.735 MiB counted peak and completed `ok`.
The over-cap fixture has 150,000,000 free entries, expanding to 1,050,000,049
bytes if uncapped; the default worker refuses it as `memory_limit`, with zero
pages and no partial publication. Both inputs are below 7 MiB and the 128 MiB
input cap. The generator emits repeated-copy codes without allocating the
decoded giant buffer. These stress cases exercise loading, before the page
content budget, and do not represent typical handbook structure.

`fixture-tuning-generation.txt` and `tuning-measurements.txt` preserve the
initial tuning commands and observations. The tuning driver receipt's EXIT 0
means the driver completed; the raw timing-tool error is present and this is
not an acceptance pass. `tuning-build.txt` records its disposable release build.
The two repository temporary helpers and `scripts/__pycache__` were removed.
The pre-existing `node_modules` symlink is preserved.

## Required baseline

Command: `bash scripts/offline-extraction-pressure-check.sh baseline
docs/evidence/offline-on2a-2026-10-21/baseline`, through the receipt runner.
The exact command and EXIT 1 are in `baseline.txt`. Release build EXIT 0
(`baseline/build.txt`); fixture bytes/hashes in `baseline/fixtures.txt`.
The script removed its disposable build and fixtures on exit.

| File | Input bytes | Outcome | Counted peak MiB | Peak RSS MiB | Wall seconds |
| --- | ---: | --- | ---: | --- | ---: |
| synthetic-illustrated-charts.pdf | 54032644 | ok | 115.881 | unavailable | 0.545 |
| synthetic-long-manual.pdf | 330934 | ok | 4.846 | unavailable | 0.142 |
| synthetic-near-cap.pdf | 1676036 | ok | 412.735 | unavailable | 0.192 |
| synthetic-over-cap.pdf | 6614022 | memory_limit | unavailable | unavailable | 0.325 |
| synthetic-small-checklist.pdf | 3360 | ok | 0.068 | unavailable | 0.014 |

**Baseline acceptance did not pass.** All five `/usr/bin/time -l` invocations
failed with `sysctl kern.clockrate: Operation not permitted` (process exit 1).
Worker outcomes, zero partial publication and counted peaks remain recorded in
`baseline/*.probe.json` and `baseline/summary.json`; every RSS value is null.
The over-cap probe's `countedPeakBytes: 0` is a placeholder on refusal, not a
measured peak. No counted-memory value substitutes for RSS. Raw `*.log`
outputs have byte-for-byte `*.txt` copies because logs are git-ignored.
Claude must rerun baseline outside the sandbox to verify RSS <= 640 MiB.
Pressure mode was not run. `memory_pressure -l warn` remains reviewer-only
with owner approval; never use `critical`. No release authorization follows.

## Verification receipts

- `harness-tests-final.txt`: 13 passed. Covers all five exact outcomes, missing,
  extra and substituted fixtures, counted near-cap boundaries, input/RSS caps,
  missing RSS, timing failure, watchdog, malformed output and partial pages.
- `fixture-tests.txt`: default Vite loader blocked writing through the existing
  node_modules symlink (EPERM); no test result from this attempt.
- `fixture-tests-runner.txt`: permitted runner loader; 53 passed, 1 pre-existing
  skipped. Includes independent zlib decoding across length-code boundaries,
  small xref row/offset checks and generation/CLI hashes for all five PDFs.
- `typecheck.txt`: EXIT 0, Node 22.
- `diff-check.txt`: whitespace check receipt.

No real PDFs, profile, keys, generated PDF binaries, dependencies or migrations
were added. No network or pressure tool was used. Extraction was enabled only
for disposable measurement builds. Shipped worker/configuration is unchanged.
