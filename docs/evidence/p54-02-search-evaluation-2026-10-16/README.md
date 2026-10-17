# P54-02 exploratory search proof

Source3266f193, AppleM5/32GiB/macOS27.0.1, existing Node22 and Cargo dependencies, scoped SDK26.5. No application source/dependency/profile changes. Private/native provider calls and desktop launches were not made. Native standalone probe is an example binary, not the desktop app.

`run-evaluation.py` reproduces the probe in a NEW scratch directory; it validates the frozen MiniSearch7.2.0 archive SHA512, extracts only3 regular members, executes no installation scripts, uses existing repo dependencies, adds a disposable example only when absent, compiles it, then removes that exact temporary file even on build failure. It refuses old output directories. Corpus files, vendor code/archive, native binaries and caches are regenerable and deliberately absent from Git.

Reproduction (set your actual repo and NEW scratch paths; keep logs outside the source):

```bash
# Use Node22, existing locked npm/Cargo dependencies and the recorded SDK.
# Fetch the exact public archive URL in minisearch-registry.json to scratch.
python3 docs/evidence/p54-02-search-evaluation-2026-10-16/run-evaluation.py \
  --repo /absolute/path/to/repo \
  --scratch /absolute/path/to/new-owned-scratch \
  --archive /absolute/path/to/minisearch-7.2.0.tgz \
  --sdk /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
```

18 fresh engine processes (3 sizes ×3 repeats ×2 engines),15 timed samples/query.36 exact result-id set comparisons match, with9 explicit default accent-folding differences. Native update/delete/reopen and MiniSearch update/delete/serialized reload controls pass. The simple generated PDF preserves physical page order despite reordered object ids, reports its image-only page as no_extractable_text, and demonstrates post-extraction output limits do not bound allocations. Raw capability/compile options and results are preserved. `summary.json` adds measured process peak RSS from macOS time logs; per-run raw JSON remains unchanged.

Exploratory numbers are not production acceptance: no pre-registered latency targets, real handbook corpus, hard extraction-memory/cancellation proof, native painted interaction, production cache restore lifecycle, older WebKit or Windows observation. Prefix paths differ (native counts, MiniSearch ranks), so their times are not comparable. Peak RSS includes the entire workload: notably MiniSearch serialization AND a second deserialized index, not steady-state index memory. Its separately measured index heap delta is also recorded. Cold indexing excludes PDF extraction; warm query shapes return all matches and do not include Tauri IPC/rendering. No engine or production dependency has been selected.

SHA256SUMS inventories all other evidence files. The earlier exploratory run without result-id set assertions stays in task recovery, not substituted as final evidence. All final runs use the delivered source files.

Publication-only cleanup: one trailing space was removed from the delivered Node probe after the measured run. No token/statement or runtime behavior changed; raw measurement receipts remain untouched.
