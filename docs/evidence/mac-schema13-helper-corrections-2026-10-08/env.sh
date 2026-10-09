# Her Flight Deck schema-13 operator kit — environment for every Terminal session in this run.
# Source this file; it only defines absolute task variables. It never assigns HOME or CODEX_HOME,
# never changes the account, and never points either app at another library.
export HFD_KIT="/Users/Shared/hfd-schema13-kit-2026-10-08"
export HFD_NODE="/opt/homebrew/opt/node@22/bin/node"
export HFD_HELPER="$HFD_KIT/bin/mac-schema13-profile-snapshot.mjs"
export HFD_OP="$HFD_KIT/bin/hfd-operator.sh"
export HFD_ROOT="/Users/hfdtest/Library/Application Support/com.herflightdeck.app"
export HFD_PROFILES="$HFD_KIT/profiles"
export HFD_EVIDENCE_PARENT="$HFD_KIT/evidence"
export HFD_INSTALLERS="$HFD_KIT/installers"
export HFD_FIXTURES="$HFD_KIT/fixtures"
export HFD_PACKET="$HFD_KIT/packet/02-flashcards-and-test.json"
export HFD_APP_NEW="/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"
export HFD_APP_OLD="/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app"

if [ ! -x "$HFD_NODE" ]; then
  echo "hfd-kit: no executable node at $HFD_NODE — stop and report (do not substitute another runtime)" >&2
elif [ ! -f "$HFD_HELPER" ] || [ ! -f "$HFD_OP" ]; then
  echo "hfd-kit: kit tooling is incomplete — re-verify TRANSFERSHA256SUMS.txt before using anything" >&2
else
  echo "hfd-kit: node $("$HFD_NODE" --version) | kit $HFD_KIT | approved uid 502 (hfdtest) | root $HFD_ROOT"
fi
