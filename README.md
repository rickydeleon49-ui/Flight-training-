# Your Flight Deck

A study companion for student pilots. It keeps flight-training study, lessons,
goals, notes and costs in one private workspace on your own computer.

- **Study Library**: import PDFs and handbooks, read them, and search them offline.
- **Flashcards** with spaced review, and **practice tests** you write or import.
- **Flight Journal**: lessons, debriefs, skills and questions for your instructor.
- **Pilot Toolkit**: checkride prep, certificates and records, a cost
  forecast and a preflight check-in.
- **Flight Path, Schedule, Finances and Notes** to plan training and track costs.
- **Optional AI study help** (Google Gemini or Anthropic Claude) with your own API key. The app works
  fully without it.

Your data stays in a local SQLite database. There is no account and no server.
See [PRIVACY.md](PRIVACY.md) for what leaves your computer and when.

Provider API keys use the OS secure store: macOS Keychain on Developer ID signed
builds and the iOS keychain. When the secure store is unavailable, keys fall back
to a private file in the application data folder. An older key file is moved
into the secure store and deleted only after it reads back unchanged.

> **Study aid, not flight instruction.** Always check material against official
> FAA guidance and your flight instructor.

## Platforms

- **macOS** 12 or later, Apple Silicon. Release builds are signed and notarized.
- **iPhone**: build from source (see below). There is no App Store release.
- Windows builds can be made from source but are not currently released.

## Build and run

Needs [Node.js](https://nodejs.org) 22, [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm ci
npm run tauri dev      # desktop app with live reload
npm run tauri build    # package an installer
npm run dev            # browser-only UI mode (no file import, no AI)
```

Browser mode runs the same SQL against a WebAssembly SQLite kept in
`localStorage`, so the interface can be worked on without Rust. The real app
always uses the desktop database.

For an iPhone build, add the iOS Rust targets
(`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`), then use
`npm run tauri ios dev` or `npm run tauri ios build` on a Mac with Xcode.
`scripts/check-ios.sh` is a quick compile check.

## Test

Use Node 22; newer Node versions give false failures.

```bash
npm run typecheck
npm test                                   # Vitest
npm run hygiene                            # no local paths or personal data in the tree
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:cargo-lock
```

CI (`.github/workflows/checks.yml`) runs these on every pull request.

## Offline PDF reading and search

In the desktop app, prepare a PDF once to search its readable text without a
connection and make a study kit from its pages, with no AI or upload. Search also
finds saved guides, cards, practice questions, notes, instructor questions and
homework. Image-only pages need readable text; OCR is not included. Files over
128 MiB are refused. One extraction worker runs at a time, with a 512 MiB
counted-allocation cap, an 8 MiB per-page budget and a 120-second deadline;
the cap is not a bound on total app or process RSS. If a large handbook is slow
on a smaller Mac, the cap can be lowered to 384 MiB. Try individual chapters
when a handbook cannot be prepared.

Build gates: `.github/workflows/release.yml` sets `HFD_OFFLINE_EXTRACTION=1` on
the installer build step, and `.github/workflows/build-desktop.yml` uses the same
opt-in. `scripts/release.sh` exports it for checks before preparing the tag.
For a local release build, use `HFD_OFFLINE_EXTRACTION=1 npm run tauri build`.
The Tauri build config (`src-tauri/tauri.conf.json`) inherits that environment
through `npm run build`; `vite.config.ts` maps it to the frontend flag only for
builds. Without the release opt-in, native extraction and search stay disabled.
In debug builds Rust permits extraction, and the UI needs the explicit
`VITE_OFFLINE_EXTRACTION=1` development flag. Setting an environment variable
after building does not enable an installed app.

## Signed Mac builds

`scripts/build-signed-mac.sh <version>` builds, signs, notarizes and staples the
Mac DMG from the exact release tag. Credentials stay in the keychain, never in
the repository.

1. Create a *Developer ID Application* certificate in your Apple Developer
   account and install it in the login keychain. If several are listed by
   `security find-identity -v -p codesigning`, set `APPLE_SIGNING_IDENTITY`.
2. Store a notarytool profile once:
   `xcrun notarytool store-credentials <profile> --key <AuthKey.p8> --key-id <KEYID> --issuer <issuer ID>`.
   The script uses the profile named by `HFD_NOTARY_PROFILE` (default `hfd-notary`).
   Or skip the keychain and point the script at the API key file:
   `HFD_NOTARY_KEY=<path/AuthKey_KEYID.p8> HFD_NOTARY_KEY_ID=<KEYID> HFD_NOTARY_ISSUER=<issuer ID>`.
   A locked Mac hides keychain profiles (notarytool then says "No Keychain password
   item found"), so the script keeps the display awake while it runs; the key file
   works even if the Mac locks anyway.
3. Check out the tag `v<version>` with a clean tree, run `npm ci`, then run the script.

Never bypass or weaken operating-system protections (Gatekeeper, SmartScreen,
quarantine) to open a build.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

The app icon was generated with an AI image tool for this project and is released with it under the MIT License.
