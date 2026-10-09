# Reviewer diagnostic — Finding F-1 (pre-existing flaky native test helper)

**Status: FAILS on this source, PASSES once corrected, controls PASS now.**
Reproducible, stable-path (`cargo test` name filters), disposable — no production file
touched except a scratch copy the probe makes and restores.

## What it proves

`run_gate.sh` step 02 (`cargo test … lineage && … split && … newer_database`) intermittently
exits 101. The cause is **not** split-lineage code: it is `documents.rs::split_test_root()`,
a base test helper that names its temp library `hfd-split-{pid}-{nanos}`. Two documents tests
that call it in the same clock tick reuse one directory, so the second `CREATE TABLE
study_materials` `unwrap()` panics "table study_materials already exists" (`documents.rs:2003`).
`git diff 2a6a415 -- src-tauri/src/documents.rs` has only two hunks, both outside the test
module — the helper is byte-identical to `origin/main`.

## How each claim is demonstrated (raw output in `receipts/`)

| Claim | Evidence | Result |
| --- | --- | --- |
| Fails on this source | `flake-parallel-split.txt` (step-02 `split` filter, default parallelism, looped) | trips on attempt 2/12 |
| Fails on this source | `diag-documents-flake.txt` (`documents::tests` ×12, default parallelism) | 11/12 clean, fails attempt 2 |
| Controls pass now | `diag-control-lineage.txt` (delivered `lineage` ×6 + `pdf::tests` ×6) | 6/6 and 6/6 clean — the feature tests are deterministic |
| Controls pass now | `11-cargo-test-all-single.txt` (full `--all-targets`, `--test-threads=1`) | 444 passed / 6 ignored, exit 0 |
| Passes once corrected | `diag-flake-corrected.txt` (scratch copy `split_test_root` + per-process atomic sequence, `split` filter ×15) | 15/15 clean, then documents.rs restored to `8423f3bc…` |

## The bounded correction (one helper, tests only, no production behaviour)

```rust
fn split_test_root() -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "hfd-split-{}-{}-{}", std::process::id(), n,
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    // …unchanged…
}
```

The delivered `lineage_tests::TempDir::new(label)` already avoids this by carrying a per-test
label; the base documents helper does not. Equivalent alternatives: run the native gate with
`--test-threads=1`, or adopt `tempfile::TempDir`.

## Re-run

```
bash flake_probe.sh <clean-copy-repo-root> [trials]   # default trials=12
```
Exits 0 only when: delivered `lineage` and `pdf::tests` are fully deterministic,
`documents::tests` flakes at default parallelism (>0 of N), `documents::tests` is clean
single-threaded, and the atomic-sequence correction makes it clean at default parallelism.
Capture in `receipts/flake-probe-run.txt`.

## Scope note

F-1 is pre-existing and out of the split-lineage feature's change set. It does not affect
shipping behaviour and does not block integration; it is recorded so the release CI runs the
native suite deterministically (fix the helper, or single-thread it).
