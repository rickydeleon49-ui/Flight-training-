# Her Flight Deck schema-13 operator kit — environment for every Terminal session in this run.
# Source this file; it only defines absolute task variables. It never assigns HOME or CODEX_HOME,
# never changes the account, and never points either app at another library.
export HFD_KIT="/Users/Shared/hfd-schema13-kit-2026-10-08"
export HFD_NODE="/opt/homebrew/opt/node@22/bin/node"
export HFD_HELPER="$HFD_KIT/bin/mac-schema13-profile-snapshot.mjs"
export HFD_OP="$HFD_KIT/bin/hfd-operator.sh"
export HFD_ROOT="/Users/hfdtest/Library/Application Support/com.herflightdeck.app"

# Task workspace: created, owned and writable by uid 502 (hfdtest) under /Users/hfdtest/Downloads.
# Keeps immutable read-only kit inputs separate from writable user outputs.
export HFD_WORKSPACE="/Users/hfdtest/Downloads/hfd-schema13-workspace"
export HFD_PROFILES="$HFD_WORKSPACE/profiles"
export HFD_EVIDENCE_PARENT="$HFD_WORKSPACE/evidence"

export HFD_INSTALLERS="$HFD_KIT/installers"
export HFD_FIXTURES="$HFD_KIT/fixtures"
export HFD_PACKET="$HFD_KIT/packet/02-flashcards-and-test.json"
export HFD_APP_NEW="/Users/hfdtest/Applications/HFD-NEW-36a7b39/Her Flight Deck.app"
export HFD_APP_OLD="/Users/hfdtest/Applications/HFD-OLD-2a6a415/Her Flight Deck.app"

if [ -n "${HFD_RUN_ID:-}" ]; then
  export HFD_EVID="$HFD_EVIDENCE_PARENT/$HFD_RUN_ID"
  export HFD_RUN_PROFILES="$HFD_PROFILES/$HFD_RUN_ID"
  export HFD_BACKUP12="$HFD_EVID/hfdbackup-schema12.hfdbackup"
  export HFD_BACKUP13="$HFD_EVID/hfdbackup-schema13.hfdbackup"
else
  unset HFD_EVID HFD_RUN_PROFILES HFD_BACKUP12 HFD_BACKUP13
fi
