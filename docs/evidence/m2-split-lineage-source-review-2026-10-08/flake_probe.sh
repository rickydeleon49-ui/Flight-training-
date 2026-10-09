#!/bin/bash
# Reviewer diagnostic for Finding F-1 (pre-existing flaky native test helper).
# Self-contained. Stable module paths only: the cargo test *name filters*
# `documents::tests`, `lineage`, `split`, `pdf::tests` — a later round needs at
# most a resolve-only redirect (run it from any clean copy of the same tree).
#
# Usage:  flake_probe.sh <clean-copy-repo-root> [trials]
# It mutates NOTHING except a scratch copy of documents.rs it makes/restores,
# so it is safe to run against the isolated review copy.
set -u
ROOT=${1:?clean copy repo root}
N=${2:-12}
cd "$ROOT" || exit 2
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH
export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
DOC=src-tauri/src/documents.rs
cargo="cargo test --locked --manifest-path src-tauri/Cargo.toml"

echo "== trials=$N  root=$ROOT =="

# CONTROL 1: the delivered split-lineage tests must be deterministic at default parallelism.
lin=0
for i in $(seq 1 "$N"); do $cargo lineage >/dev/null 2>&1 && lin=$((lin+1)); done
echo "CONTROL  delivered 'lineage' filter: $lin/$N clean (expect $N/$N)"

# CONTROL 2: the delivered splitter tests must be deterministic.
pdf=0
for i in $(seq 1 "$N"); do $cargo pdf::tests >/dev/null 2>&1 && pdf=$((pdf+1)); done
echo "CONTROL  delivered 'pdf::tests' filter: $pdf/$N clean (expect $N/$N)"

# DIAGNOSTIC: the base documents::tests split helper flakes under default parallelism.
dflt=0
for i in $(seq 1 "$N"); do $cargo documents::tests >/dev/null 2>&1 || dflt=$((dflt+1)); done
echo "DIAG     'documents::tests' at DEFAULT parallelism: $dflt/$N runs FAILED (expect >0 = flake reproduced)"

# Same tests, single-threaded: the timing collision cannot occur.
s1=0
for i in $(seq 1 "$N"); do $cargo documents::tests -- --test-threads=1 >/dev/null 2>&1 && s1=$((s1+1)); done
echo "CONTROL  'documents::tests' single-threaded: $s1/$N clean (expect $N/$N)"

# ONCE CORRECTED: give split_test_root a per-process sequence so temp dirs never collide.
cp "$DOC" "$DOC.reviewbak"
python3 - "$DOC" <<'PY'
import sys
p=sys.argv[1]; t=open(p).read()
old='''    fn split_test_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hfd-split-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));'''
new='''    fn split_test_root() -> PathBuf {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "hfd-split-{}-{}-{}",
            std::process::id(),
            n,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));'''
assert t.count(old)==1, "guard line not found verbatim (source drifted from this diagnostic)"
open(p,"w").write(t.replace(old,new))
PY
corr=0
for i in $(seq 1 "$N"); do $cargo documents::tests >/dev/null 2>&1 && corr=$((corr+1)); done
mv "$DOC.reviewbak" "$DOC"
echo "CORRECTED 'documents::tests' at DEFAULT parallelism: $corr/$N clean (expect $N/$N once fixed)"

# Exit 0 only if: controls deterministic, flake reproduced (>0), correction deterministic.
rc=0
[ "$lin" = "$N" ] || { echo "FAIL: delivered lineage tests not deterministic"; rc=1; }
[ "$pdf" = "$N" ] || { echo "FAIL: delivered pdf tests not deterministic"; rc=1; }
[ "$s1"  = "$N" ] || { echo "FAIL: single-threaded control not clean"; rc=1; }
[ "$dflt" -gt 0 ]  || { echo "FAIL: flake not reproduced within trials (rerun with more trials)"; rc=1; }
[ "$corr" = "$N" ] || { echo "FAIL: bounded fix did not restore determinism"; rc=1; }
[ -f "$DOC.reviewbak" ] && { rm -f "$DOC.reviewbak"; echo "note: removed leftover backup"; }
echo "verdict: $([ $rc -eq 0 ] && echo 'F-1 CONFIRMED (pre-existing, bounded fix works, feature tests clean)' || echo 'inconclusive')"
exit $rc
