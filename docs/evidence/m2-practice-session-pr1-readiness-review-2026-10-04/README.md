# M2 PR 1 initialization re-review evidence

This is docs-only review evidence of unaccepted source, not an application merge.

- `submitted-changes.json`: exact branch/base, tracked source diff, new source texts and23 current hashes. Do not apply this over a dirty checkout.
- `source-hashes.json`: hashes relative to the implementation checkout. Independently captured and verified after all temporary tests/restoration.
- `submitted-validation/`: byte-preserved current implementation report/gates and14-entry evidence receipt. Its SHA256SUMS is rooted in that directory; copied Markdown links retain their original directory meaning. Historical versions of these reused local files remain frozen in earlier GitHub evidence packs.
- `browser-startup.test.ts`: real sql.js with WASM and in-memory localStorage; invalid persisted progress reopen must refuse. One failing assertion.
- `native.rs`: two actual SQLite/native initialization proofs, missing FK definition and conversion committed despite semantic failure. Two failing assertions. Writable_schema is used only to simulate a damaged temporary fixture.
- `codex-diagnostic.test.ts`: seven original frontend regressions, still passing.
- `run.py`: exact runner; current Mac/output paths must be adapted deliberately elsewhere. Removes temporary frontend tests/restores original Rust bytes in finally. Selects all existing backup/recovery/practice tests plus the two new cases, sequential native test threads.
- `frontend.txt`: exit1, 29 pass/one additional failure. `native.txt`: exit101, 171 pass/two additional failures. All previous boundary cases pass.
- `results.json`: actual exits/restoration confirmation. `cargo-lock-check.txt`: actual required npm run test:cargo-lock passes after properly authorized execution. Initial read-only attempt lacked access to the build lock; that sandbox issue is not a source defect. `diff-check.txt`: actual git diff --check passes.
- `SHA256SUMS`: this pack's relative hashes, excluding itself.

Full submitted totals remain reported: 2,488 frontend passes/four skips and380 native passes/six ignores. The submitted Gate7 is only a lockfile diff and Gate8 a dirty status snapshot; neither substitutes for the actual required gates. Independent review did not repeat the full matrix after confirmed blockers. No app/profile/provider/installed/account/signing/packaging/release work occurred.
