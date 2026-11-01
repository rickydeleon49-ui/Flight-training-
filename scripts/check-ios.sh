#!/usr/bin/env bash
# iOS compile check (local only). Needs the rustup toolchain with the iOS targets.
set -euo pipefail
export PATH=/opt/homebrew/opt/rustup/bin:/opt/homebrew/opt/node@22/bin:$PATH
cd "$(dirname "$0")/.."
# iOS builds go outside src-tauri/target: the data-safety snapshot test refuses unknown entries there.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/her-flight-deck/ios-target}"

if [ "$(command -v cargo)" != "/opt/homebrew/opt/rustup/bin/cargo" ]; then
  echo "check-ios: cargo is $(command -v cargo), not the rustup proxy (/opt/homebrew/opt/rustup/bin/cargo)" >&2
  exit 1
fi
if [ ! -d dist ]; then
  echo "check-ios: dist/ is missing; run npm run build first" >&2
  exit 1
fi
for t in aarch64-apple-ios aarch64-apple-ios-sim; do
  echo "== cargo check --target $t"
  cargo check --locked --manifest-path src-tauri/Cargo.toml --target "$t"
done
echo "== libsqlite3-sys features (expect bundled once)"
cargo tree --locked --manifest-path src-tauri/Cargo.toml -e features -i libsqlite3-sys --target aarch64-apple-ios | head -3
