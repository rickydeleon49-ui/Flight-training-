# Local Developer ID signing and notarization (MAC-SIGNING-01, 28 October 2026)

The owner approved a **local-first** path: the Mac installer is built, signed,
notarized and stapled on the owner's Mac, then swapped into the private release
draft. GitHub Actions still builds ad-hoc installers; CI signing is a later,
separate round. Nothing here changes `release.yml`, the bundle identifier
`com.herflightdeck.app`, or the committed `"signingIdentity": "-"`.

Secrets never go in Git, logs, docs or chat. The private key stays in the login
keychain and the notary password stays in the keychain profile. `.gitignore`
also refuses `*.p8`, `*.p12`, `*.cer`, `*.certSigningRequest` and
`*.mobileprovision` as a safety net.

## Owner steps

1. **Certificate (once).** In the Apple Developer account, create a
   *Developer ID Application* certificate and install it in the login keychain.
   Check with `security find-identity -v -p codesigning`: exactly one
   `Developer ID Application: <name> (TEAMID)` line should be listed. If there
   are several, set `APPLE_SIGNING_IDENTITY` to the full name of the one to use.
2. **Notary profile (once).** Preferred: an App Store Connect API key (Users and
   Access → Integrations → App Store Connect API → Team Keys, "Developer" role).
   Download `AuthKey_<KEYID>.p8` once, then in Terminal:
   `xcrun notarytool store-credentials hfd-notary --key <path to AuthKey_KEYID.p8> --key-id <KEYID> --issuer <issuer ID>`
   Keep the `.p8` outside `~/code` afterwards (`.gitignore` also refuses it).
   Alternative: `--apple-id <Apple ID> --team-id <TEAMID>` with an app-specific
   password typed when asked. Either way the profile lives in the keychain, not
   in a file in this repository.
3. **Build.** Prepare the release as usual (`scripts/release.sh <version>`),
   check out the tag `v<version>` with a clean tree, run `npm ci` with Node 22,
   then run `scripts/build-signed-mac.sh <version>`. The script refuses a dirty
   tree, a HEAD that is not exactly the tag, a missing or ambiguous identity and
   a profile that does not work. It builds with `HFD_OFFLINE_EXTRACTION=1`,
   signs with hardened runtime, notarizes the DMG with `--wait` (anything but
   *Accepted* stops it and prints the submission id for `notarytool log`),
   staples and validates the ticket, then verifies the app inside the DMG
   (strict deep `codesign`, Developer ID authority, team, hardened runtime,
   bundle id) and asks Gatekeeper to assess both the DMG and the app as
   *Notarized Developer ID*. It prints the DMG's SHA-256.
4. **Upload.** Replace the Mac DMG in the private `v<version>` release draft with
   this file, keeping the draft's asset name (spaces become periods), and
   replace its line in `SHA256SUMS.txt` and the release notes with the printed
   checksum. Run the usual Apple Silicon installed-app check from the draft
   download before publishing.

## Entitlements

None are added. The app is plain Rust plus the system WKWebView: no bundled
dylibs or sidecars (library validation is satisfied because everything in the
bundle is signed with the same identity), no App Sandbox, and WebKit's JIT runs
in Apple's own WebContent process, so `allow-jit` / `allow-unsigned-executable-memory`
are not needed. Keychain access (Gemini key status, `keyring`) and outgoing
HTTPS to Gemini need no entitlement outside the sandbox.

**First-run check (verify on the first signed build, from a quarantined
download):** the app opens without a Gatekeeper prompt beyond the normal
"downloaded from the Internet" confirmation; the Flight Deck loads (webview
works under hardened runtime); a study PDF imports and offline search works;
Settings can save and clear a Gemini key and one Gemini request succeeds;
backup and restore work. If any of these fails under hardened runtime, add
only the specific entitlement it needs, with a comment, in a new round.

## What stays until a real signed release is verified

The **Open Anyway** owner exception is retired once the first signed release
(0.6.1) is verified: a real signed, notarized release must pass the first-run
check above on an Apple Silicon Mac. The stapled ticket is on the DMG;
the app copied out of it is covered by the same notarization, which Gatekeeper
confirms online on first launch, so do the first launch while online.
