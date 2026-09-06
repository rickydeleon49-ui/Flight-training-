#!/usr/bin/env bash
#
# Desktop smoke test — the parts a browser cannot reach.
#
# Unit tests and the browser dev mode cover the product logic and the UI, but
# three things only exist inside the real desktop shell:
#
#   1. the Rust migration runner building a real database,
#   2. the native file chooser opened by the photo input,
#   3. writes landing in the real SQLite file in application data,
#   4. her data still being there after the app is closed and reopened,
#   5. the safety copy taken when a new version opens her database.
#
# This drives the actual Tauri window on a virtual display and checks all
# five, asserting against the database rather than against pixels wherever
# it can. Screenshots are left in the output directory for a human to look at.
#
# Linux only. Requires: Xvfb, xdotool, ImageMagick (import).
#   sudo apt-get install xvfb xdotool imagemagick
#
# Usage:  scripts/desktop-smoke.sh [output-dir]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.smoke}"
DISPLAY_NUM=":99"
APP_ID="com.herflightdeck.app"

# Keep the test's data well away from anything real.
SANDBOX="$(mktemp -d)"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_DATA_HOME="$SANDBOX/data"
DB="$XDG_CONFIG_HOME/$APP_ID/her-flight-deck.db"

mkdir -p "$OUT"
failures=0

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

for tool in Xvfb xdotool import; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool"; exit 2; }
done

cleanup() {
  for pid in $(ps -eo pid,comm | awk '$2 ~ /^her-flight/ {print $1}'); do kill "$pid" 2>/dev/null; done
  [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

shot() { DISPLAY="$DISPLAY_NUM" import -window root "$OUT/$1.png" 2>/dev/null; }
click() { DISPLAY="$DISPLAY_NUM" xdotool mousemove "$1" "$2" click 1; sleep "${3:-2}"; }
query_db() { node -e "
  const {DatabaseSync}=require('node:sqlite');
  try {
    const d=new DatabaseSync(process.argv[1],{readOnly:true});
    const r=d.prepare(process.argv[2]).get();
    console.log(r ? Object.values(r)[0] : '');
  } catch { console.log(''); }
" "$1" "$2" 2>/dev/null; }
query() { query_db "$DB" "$1"; }

APP="$ROOT/src-tauri/target/debug/her-flight-deck"
launch() { DISPLAY="$DISPLAY_NUM" "$APP" >>"$OUT/app.log" 2>&1 & sleep "${1:-14}"; }
quit_app() {
  for pid in $(ps -eo pid,comm | awk '$2 ~ /^her-flight/ {print $1}'); do kill "$pid" 2>/dev/null; done
  sleep 3
}

step "Building"
( cd "$ROOT/src-tauri" && cargo build --quiet ) || { echo "cargo build failed"; exit 1; }

step "Starting"
Xvfb "$DISPLAY_NUM" -screen 0 1400x1000x24 >/dev/null 2>&1 &
XVFB_PID=$!
sleep 2

# Reuse a dev server if one is already up; otherwise start one and wait for
# it. The debug build loads the frontend from this server, so nothing works
# without it — fail loudly rather than limping on into confusing failures.
if curl -sf -o /dev/null http://localhost:1420/; then
  echo "  using the dev server already on :1420"
else
  ( cd "$ROOT" && npm run dev >"$OUT/vite.log" 2>&1 ) &
  VITE_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null http://localhost:1420/ && break
    sleep 1
  done
  if ! curl -sf -o /dev/null http://localhost:1420/; then
    echo
    echo "The dev server did not start. Last lines of $OUT/vite.log:"
    tail -5 "$OUT/vite.log"
    exit 1
  fi
fi

# Start from nothing and let the application create and migrate its own
# database. Upgrading a database that already holds data is covered by
# src/data/migrations.test.ts, which runs the same SQL against real SQLite.
mkdir -p "$(dirname "$DB")"

: >"$OUT/app.log"
launch

step "The window opens"
if DISPLAY="$DISPLAY_NUM" xdotool search --name "Her Flight Deck" >/dev/null 2>&1; then
  pass "desktop window is present"
else
  fail "desktop window never appeared"; shot "00-no-window"; exit 1
fi
shot "01-launched"

step "The application loaded its data"
if grep -qi "could not be opened" "$OUT/app.log" 2>/dev/null; then
  fail "the application reported it could not open the database"
else
  pass "no load error reported"
fi

step "The Rust migration runner builds the schema"
columns="$(query "SELECT COUNT(*) c FROM pragma_table_info('settings') WHERE name IN ('accent_color','why_note','photo')")"
[ "$columns" = "3" ] && pass "new columns added by the migration runner" \
                     || fail "expected 3 new columns, found '${columns:-none}'"
tables="$(query "SELECT COUNT(*) c FROM sqlite_master WHERE type='table'")"
[ -n "$tables" ] && [ "$tables" -ge 17 ] \
  && pass "all tables created ($tables)" || fail "expected at least 17 tables, found '${tables:-none}'"
[ -n "$(query "SELECT id FROM settings WHERE id='profile'")" ] \
  && pass "profile row created on first run" || fail "no profile row was created"

step "The native file chooser"
click 128 791 2      # Settings
DISPLAY="$DISPLAY_NUM" xdotool mousemove 800 500
for _ in $(seq 1 10); do DISPLAY="$DISPLAY_NUM" xdotool click 5; sleep 0.15; done
sleep 1
shot "02-settings"

click 488 219 4      # Add a photo
if DISPLAY="$DISPLAY_NUM" xdotool search --onlyvisible --name "Select File" >/dev/null 2>&1; then
  pass "native chooser opened from the photo input"
else
  fail "native chooser did not open"
fi
shot "03-chooser"

PHOTO="$SANDBOX/smoke-photo.png"
node "$ROOT/scripts/make-smoke-photo.mjs" "$PHOTO" >/dev/null 2>&1
CHOOSER="$(DISPLAY="$DISPLAY_NUM" xdotool search --onlyvisible --name "Select File" | head -1)"
if [ -n "$CHOOSER" ]; then
  DISPLAY="$DISPLAY_NUM" xdotool windowfocus "$CHOOSER" 2>/dev/null; sleep 1
  DISPLAY="$DISPLAY_NUM" xdotool key --window "$CHOOSER" ctrl+l; sleep 1
  DISPLAY="$DISPLAY_NUM" xdotool type --window "$CHOOSER" --delay 40 "$PHOTO"; sleep 1
  DISPLAY="$DISPLAY_NUM" xdotool key --window "$CHOOSER" Return; sleep 5
fi
shot "04-photo-chosen"

step "The photo reaches the real database"
photo="$(query "SELECT photo FROM settings WHERE id='profile'")"
case "$photo" in
  data:image/jpeg*) pass "stored as a jpeg data url" ;;
  "")               fail "no photo was stored" ;;
  *)                fail "unexpected stored value" ;;
esac
size="$(query "SELECT LENGTH(photo) FROM settings WHERE id='profile'")"
if [ -n "$size" ] && [ "$size" -gt 0 ] && [ "$size" -lt 60000 ]; then
  pass "downscaled before storage (${size} bytes)"
else
  fail "stored photo is missing or too large (${size:-none} bytes)"
fi

step "Closing and reopening keeps everything"
quit_app
launch
if DISPLAY="$DISPLAY_NUM" xdotool search --name "Her Flight Deck" >/dev/null 2>&1; then
  pass "the window opens again"
else
  fail "the application did not reopen"
fi
reopened="$(query "SELECT LENGTH(photo) FROM settings WHERE id='profile'")"
if [ -n "$reopened" ] && [ "$reopened" -gt 0 ]; then
  pass "her photo is still there after a restart (${reopened} bytes)"
else
  fail "the photo did not survive closing the application"
fi
shot "05-reopened"

step "A new version's first run copies her database aside"
quit_app
# Pretend an older version wrote what is on disk, which is what an update means.
printf '0.0.1' >"$XDG_CONFIG_HOME/$APP_ID/last-run-version.txt"
launch

VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
COPY="$(ls -d "$XDG_CONFIG_HOME/$APP_ID/backups/"*"-before-$VERSION" 2>/dev/null | head -1)"
if [ -n "$COPY" ]; then
  pass "a copy was taken before $VERSION opened her database"
else
  fail "no safety copy was taken when the version changed"
fi

if [ -n "$COPY" ]; then
  copied="$(query_db "$COPY/her-flight-deck.db" "SELECT LENGTH(photo) FROM settings WHERE id='profile'")"
  if [ -n "$copied" ] && [ "$copied" -gt 0 ]; then
    pass "the copy is a working database holding her photo"
  else
    fail "the copy does not hold her data"
  fi
fi

kept="$(query "SELECT LENGTH(photo) FROM settings WHERE id='profile'")"
if [ -n "$kept" ] && [ "$kept" -gt 0 ]; then
  pass "the update left her live data untouched"
else
  fail "her data did not survive the version change"
fi

recorded="$(cat "$XDG_CONFIG_HOME/$APP_ID/last-run-version.txt" 2>/dev/null)"
[ "$recorded" = "$VERSION" ] && pass "the new version was recorded ($recorded)" \
                             || fail "expected $VERSION recorded, found '${recorded:-none}'"
shot "06-after-update"

step "Result"
if [ "$failures" -eq 0 ]; then
  printf '\033[32mAll desktop checks passed.\033[0m Screenshots in %s\n' "$OUT"
else
  printf '\033[31m%d check(s) failed.\033[0m Screenshots in %s\n' "$failures" "$OUT"
fi
exit "$failures"
