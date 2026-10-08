# C2 correction re-review evidence — 7 October 2026

The implementation clone's reviewed dirty delivery is frozen by `submitted-source-hashes.json`: 25 paths, branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Original evidence fourteen files and nineteen correction-evidence hashes verify. Old submitted tracking is saved separately; main's authored tracking preserves history and records the re-review outcome.

Independent Node 22.23.3 runs:
- Corrected submitted proof: **15 pass**, exit 0 (`corrected-proof.*`).
- Previous frozen diagnostic, identical to the earlier review: **9 pass**, exit 0 (`prior-frozen.*`), using `C2_REVIEW_MODEL` for the corrected model.
- New `diagnostic.test.mjs`: **1 pass/11 assertion failures**, exit 1 (`new-diagnostic.*`). Use Node `--experimental-strip-types` because it directly imports production standalone TypeScript identity/scheduler modules. It supports `C2_REVIEW_MODEL` for a final corrected model; place the file under this repository-relative evidence path to resolve production and migration imports. The ordinary ASCII identity control passes.

New cases: five parser parity disagreements (limits, lone surrogates, blank malformed JSON and invented control-character rules), wrong step-3 interval, extra index absent from actual shipped migrations, missing within-batch urgency sort, unchecked maximum candidate cap, retained old-filter rows and same-turn duplicate controller rows. Raw failures are semantic assertions, not execution errors.

`query-audit.mjs` executes the submitted 5000-material/10000-event fixture and traces actual read statements. `query-audit.json` contains all statements/returned-row counts and estimated JSON UTF-8 bytes. Fifty due results: **124 SQL calls/439 returned SQL rows**; twenty history results: **21 calls/41 returned SQL rows**. Byte estimates include JSON serialization and are not measured desktop IPC bytes or performance. Raw stdout/exit are retained; the original benchmark is not rerun or overwritten.

Performance findings use submitted receipt/source inspection and the trace. No native, application, installed, real-data/provider testing is claimed. `published-source-hashes.json` hashes coordinator authored status/review/prompt and diagnostic/audit sources; `SHA256SUMS` hashes this evidence pack except itself. Both prior evidence packs remain byte-identical.
