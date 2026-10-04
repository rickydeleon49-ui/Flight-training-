#!/bin/bash
# Prepares a Claude Code cloud session so the same checks CI runs
# (.github/workflows/checks.yml) work from the first prompt.
# Local machines are left alone: they manage their own toolchains.
#
# Budget: settings.json gives this hook 900 seconds. A fully cold container
# (system libraries, npm ci, first Rust compile) takes about 5 minutes; a
# warm one takes seconds. Any failing step stops the hook with its error.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Frontend dependencies, installed from the committed lock and never
# rewriting it. See npm-deps.sh for the cold and warm paths.
"$CLAUDE_PROJECT_DIR/.claude/hooks/npm-deps.sh" "$CLAUDE_PROJECT_DIR"

# The Rust tests link against the same system libraries a desktop build does.
# Same list as the "Linux desktop libraries" step in checks.yml.
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libxdo-dev
fi

# Tauri's build script requires the frontend bundle to exist before any
# cargo command will compile.
if [ ! -f dist/index.html ]; then
  npm run build
fi

# Compile the Rust test binaries once so the first `cargo test` in the
# session takes seconds. Cheap when the container cache is warm.
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-run
