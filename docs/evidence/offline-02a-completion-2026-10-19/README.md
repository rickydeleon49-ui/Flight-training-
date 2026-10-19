# OFFLINE-02a completion evidence

Read `../../OFFLINE_02A_COMPLETION_REPORT_2026-10-19.md` and `BUDGETS.md`. This is implementation evidence, **not independent acceptance**. Cold-open and storage budgets remain missed.

- `frozen-manifest.json`, `generate.py`, `PREREGISTRATION.md`: committed at `1f927b5` before any benchmark. Generator seed 20261019; all real input/frame hashes, corpus materials, queries, filters, expected-set hashes, schedule, concurrency protocol and targets fixed here.
- `results.json`: first run, preserved. `results-validation-once.json`: final run after eliminating repeated full quick checks and warming the concurrent case as required. Both have 4,050 timed commands and all 90 independent exact-set/capped-prefix audits. Per-cell p50/p95 use nearest rank. Raw samples/exits/RSS receipts are preserved in the corresponding archives.
- `source-hashes.json`: ten final source inputs and measured optimized harness hash. It does not claim a Git commit includes uncommitted files.
- `inherited-start.json`, `inherited-focused.*`: original four-file checkpoint identity and reproduced ordering failure. The full inherited files/patch remain in the private recovery directory.
- `interruption-proof-development-failure.txt`: retained intermediate failure. The bounded timeout response now returns independently from the separate bounded SQLite-retirement assertion.
- `gate/`: gate summaries and immutable-input JSON; `gate-logs.tar.gz` retains the exact raw local gate logs, final 13-case service rerun, default-release refusal and dev/normal feature trees. See report for exact reuse/count boundaries.
- `gate-missing-dependencies/`: initial exit-127 failure before locked `npm ci`. `npm-ci.txt` records remediation, not a test pass.
- `measured-release-build.txt` inside `gate-logs.tar.gz`: optimized opt-in harness build; missing LLVM strip-library warnings retained, exit 0. No installable release artifact or normal app launch was made.
- `archive-members.json`: exact SHA-256 of every raw receipt within each archive. `SHA256SUMS`: all published evidence files except itself. Verify before review.

## Reproduce safely

The existing private inputs are `/Users/rickymac/.codex/task-recovery/offline-02a-completion-20261019/corpus/` (frozen FAA frame streams and exact worker) and `measure-validation-once/` (last corpus run). Never use an application profile as a harness directory.

Regenerate into a **new** scratch directory with `python3 generate.py --frames FRAME_DIR --out NEW_CORPUS_DIR --manifest NEW_MANIFEST`. Compare the new manifest and every corpus/expected hash with the committed freeze before timing. Public FAA PDF URLs/hashes are frozen; real worker frames are also separately hashed. The inherited local worker has a different executable hash from the historical 01c build; this is disclosed in the freeze and report.

Build only the scratch example: scoped Node/Rust/SDK environment from the report, then `HFD_OFFLINE_EXTRACTION=1 cargo build --locked --release --manifest-path src-tauri/Cargo.toml --example offline_search_measure`. Run `measure.py --tag NEW_TAG --harness ABSOLUTE_BINARY --corpora NEW_CORPUS_DIR --worker EXACT_WORKER --phak HASH_VERIFIED_PUBLIC_PDF`. The runner refuses to overwrite raw receipts, and setup refuses an existing root. No app GUI, keys or provider is involved. The harness initializes a complete scratch database through normal semantic validation; no production readiness bypass was added.

Managed benchmark files are deterministic page JSON with `.pdf` fixture names, for **all** corpora; real corpus page text comes from the actual PDF worker. This tests the production search/hash path deterministically. The separate native composition test uses actual PDF binaries through the real extraction child and search command. Do not conflate these proofs with installed PDF navigation.

Extract each raw archive into its own empty scratch folder, compare each member with `archive-members.json`, and read the per-process samples, command lines, exit values and `/usr/bin/time -l` stderr. Never extract over a working tree or profile. Original unarchived receipts remain in the private recovery directory.

No desktop/browser paint, release signing, minimum-spec testing or memory-pressure simulation is claimed.

Raw gate logs are archived without trimming their generated whitespace. The initial packaging check found whitespace in these logs; preserving their exact bytes inside `gate-logs.tar.gz` fixes delivery hygiene without editing a receipt.
