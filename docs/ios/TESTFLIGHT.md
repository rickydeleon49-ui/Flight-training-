# TestFlight checklist

Team ID `U7B45SUWS2` is set for automatic signing. Bundle id stays `com.herflightdeck.app`.

## One time (owner)
1. Xcode > Settings > Accounts: signed in with the Apple ID that owns the developer team.
2. App Store Connect: app record created for `com.herflightdeck.app`.

## Each upload
1. `scripts/testflight.sh` raises the build number (a whole number, never the app version), builds, and prints the .ipa path.
2. `scripts/testflight.sh --check-only` checks the newest .ipa: privacy manifest, Info.plist keys, icon without alpha, Apple Distribution signature, build number higher than the last upload.
3. Upload by hand (Xcode Organizer or Transporter). Wait for the processing email.
4. `scripts/testflight.sh --check-only --record` after a good upload, so the next build number must be higher.

Builds expire after 90 days; upload a new one before then.
