# TestFlight checklist

Team ID `U7B45SUWS2` is set for automatic signing. Bundle id stays `com.herflightdeck.app`.

## One time (owner)
1. App Store Connect API key (Admin role): key file at `~/.apple-keys/AuthKey_<KEY_ID>.p8`, and `~/.apple-keys/asc.conf` with `ASC_KEY_ID=<KEY_ID>` and `ASC_ISSUER_ID=<issuer id>`. With these, no Xcode sign-in is needed. Without `asc.conf`, the script uses the Apple ID signed in to Xcode > Settings > Accounts.
2. App Store Connect: app record created for `com.herflightdeck.app`.

## Each upload
1. `scripts/testflight.sh` raises the build number (a whole number, never the app version), builds, checks, uploads and records the build number. `--build-only` stops before the upload and prints the .ipa path.
2. `scripts/testflight.sh --check-only` checks the newest .ipa: privacy manifest, Info.plist keys, icon without alpha, Apple Distribution signature, build number higher than the last upload.
3. Wait for Apple's processing email; testers then get the build in the TestFlight app.
4. After a manual upload only: `scripts/testflight.sh --check-only --record`, so the next build number must be higher.

Builds expire after 90 days; upload a new one before then.
