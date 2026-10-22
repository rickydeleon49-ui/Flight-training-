#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <corpus-dir> [out-dir]" >&2
  exit 1
fi

CORPUS_DIR=$(cd "$1" && pwd)
export HFD_REAL_CORPUS="$CORPUS_DIR"
export HFD_OFFLINE_EXTRACTION=1

if [ $# -ge 2 ] && [ -n "$2" ]; then
  mkdir -p "$2"
  OUT_DIR=$(cd "$2" && pwd)
  export HFD_REAL_CORPUS_OUT="$OUT_DIR"
fi

cargo test --locked --release --manifest-path /Users/rickymac/code/Flight-training-real-test/src-tauri/Cargo.toml --test real_corpus -- --ignored --nocapture --test-threads=1
exit $?
