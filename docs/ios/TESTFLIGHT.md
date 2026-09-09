# TestFlight and App Store readiness — documented, not executed

_Nothing in this document has been run. It is the sequence a Mac session
should follow once `docs/ios/SETUP.md` has produced a build that actually
runs on a Simulator or device. Do not treat any step here as complete
until it has been performed and its actual result recorded in
`docs/ios/CONTINUATION.md`._

## Preconditions

Per the task brief's own instruction, App Store or TestFlight readiness
must not be claimed until **all** of the following have actually happened,
in this order:

1. The app builds and runs on an iOS Simulator (`docs/ios/SETUP.md` Step 5
   onward).
2. The app has been exercised on a real device — the Simulator does not
   reproduce real memory pressure, real Keychain behavior across app
   installs, or real background/foreground termination behavior, all of
   which matter to this specific app (see `docs/ios/ARCHITECTURE.md` §4
   and §6).
3. Signing and provisioning are configured (below).
4. Entitlements are set correctly for what this app actually needs.
5. A privacy manifest is present and accurate.
6. An archive build validates in Xcode Organizer without errors.
7. The archive uploads to App Store Connect and installs via TestFlight on
   at least one real device.

## Signing and provisioning

- Requires an active Apple Developer Program membership (individual or
  organization) tied to the Apple ID used in Xcode.
- Xcode's "Automatically manage signing" is the simplest path for a
  personal/small-team app like this one; it creates and maintains the
  needed App ID, provisioning profile, and signing certificate. Manual
  signing is only worth the overhead if this app later needs a specific
  entitlement (e.g. an App Group for a share extension) that automatic
  management doesn't provision correctly on its own.
- Bundle identifier decision from `docs/ios/SETUP.md` Step 3 must be final
  before creating the App ID in App Store Connect — changing it later
  means a new App ID and losing continuity with any existing
  TestFlight/App Store listing.

## Entitlements this app is expected to need

- **None** related to iCloud, push notifications, background modes, or
  networking beyond default outbound HTTPS (Gemini API calls via
  `reqwest`) — this app has no server component and no sync feature (the
  task brief explicitly excludes adding cloud sync).
- **Document types** (`.hfdbackup` — see `docs/ios/SETUP.md` Step 8) is an
  `Info.plist` declaration, not an entitlement, but is required for the
  "opened from Files/AirDrop" import path to work at all.
- **Keychain sharing** is not needed unless a future decision shares the
  Gemini key across an app family (e.g. a widget or extension) — not
  planned; do not add this entitlement speculatively.

## Privacy manifest (`PrivacyInfo.xcprivacy`)

Required by Apple for apps using certain "required reason" APIs and for
any third-party SDK that itself requires one. This app's actual data
behavior, which the manifest and App Store privacy questionnaire both need
to accurately reflect:

- **Collected by this app, sent to Apple/anyone else**: nothing. No
  analytics, no crash reporting service, no telemetry. (The task brief
  explicitly excludes adding analytics; this app has none today either,
  on desktop.)
- **Sent to a third party (Google, via the Gemini API)**: the contents of
  a study document, when and only when the user explicitly submits it for
  AI study-aid generation (see `src/logic/aiSafety.ts` and the existing
  desktop confirmation-before-sending flow this app already implements —
  the iOS build should keep the same explicit-confirmation gate rather
  than relaxing it). The Gemini API key itself is sent to Google as
  authentication for that same call; it is never sent anywhere else.
- **Stored only on the device**: the SQLite database (courses, notes,
  study guides, flashcards, journal, finances, settings), all imported and
  generated documents, and the Gemini API key (in Keychain — see
  `docs/ios/ARCHITECTURE.md` §4). None of this leaves the device except
  the one explicit, user-confirmed Gemini submission path above, or when
  the user explicitly exports/shares a `.hfdbackup` file themselves.
- **Required-reason API usage**: audit whichever Tauri plugins and their
  transitive dependencies end up in the final iOS build (this cannot be
  determined without `gen/apple/` existing) for File Timestamp API,
  User Defaults API, or Disk Space API usage, each of which needs an
  approved reason code in the manifest if used. This is a Mac-only,
  post-build audit step — do not guess the manifest contents from source
  review alone.

## Archive and validate

```sh
npx tauri ios build
```

then open the resulting Xcode project/workspace, Product → Archive, and
use Xcode Organizer's "Validate App" before "Distribute App". Validation
failures at this stage commonly concern missing icons at required sizes,
missing privacy manifest entries, or entitlement mismatches — resolve
each and re-validate rather than distributing on a warning.

## TestFlight

1. Distribute the validated archive to App Store Connect (via Organizer,
   or `xcrun altool`/`notarytool` equivalents if scripting this later).
2. Add build to a TestFlight internal or external test group. Internal
   testing (up to 100 users on the same Apple Developer team) requires no
   additional Apple review; external testing requires a first-time Beta
   App Review.
3. Fill in TestFlight's required "What to Test" notes per build — for the
   first build, this should explicitly call out the areas this milestone
   flagged as unverified until now: Keychain persistence across an update
   (install build N, then build N+1, confirm the Gemini key survives),
   large-PDF splitting memory behavior on the actual test device, and the
   full "export on Mac → AirDrop/Files → import on iPhone/iPad" round trip
   with a real backup file.
4. Install via the TestFlight app on a real device using the invite link
   or public link (if external testing is enabled).

## App Store submission

Out of scope for this task's stated deliverables (the brief asks for a
working iOS app receiving Mac backups, not a published listing) and not
attempted or planned here. If it becomes a later goal, it needs: App Store
screenshots per required device size, a privacy policy URL (this app
currently has none, being a private/personal tool — one would need to be
written and hosted), and a completed App Privacy questionnaire in App
Store Connect matching the privacy manifest above.

## What to record once any of this actually happens

For each step performed: the exact Xcode/Tauri CLI version used, the
device or Simulator model and iOS version tested against, and the actual
outcome (including partial failures) — in `docs/ios/CONTINUATION.md`, not
only in this document, since this document describes the intended sequence
and the continuation note is where real results belong.
