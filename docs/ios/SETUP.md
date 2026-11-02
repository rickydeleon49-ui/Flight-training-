# iOS setup — Mac-only steps

_This environment (the one that wrote `docs/ios/ARCHITECTURE.md`,
`docs/backup-format.md`, and `docs/ios/THREAT_MODEL.md`) is Linux with no
Xcode. Nothing in this document has been executed. It is the precise
sequence a macOS session with Xcode installed should run next, in order,
to pick up Milestone 3._

## Prerequisites

- macOS with Xcode installed (a recent Xcode that supports the current
  iOS SDK; check Tauri 2's mobile documentation for the minimum supported
  Xcode version at the time you read this, since it changes).
- An Apple ID at minimum; an active Apple Developer Program membership for
  device testing beyond the Simulator and for any TestFlight step (see
  `docs/ios/TESTFLIGHT.md`).
- Rust installed via `rustup` (matches what `src-tauri/Cargo.toml` already
  assumes: `rust-version = "1.77.2"` or newer).
- Node.js matching whatever `package.json`'s tooling expects (this repo
  uses Vite 7 / TypeScript 5.9 — a current Node LTS is fine).
- The `@tauri-apps/cli` version already pinned in `package.json`
  (`^2.9.0`) — do not upgrade it as a side effect of adding iOS support;
  if a newer CLI is needed for iOS specifically, that is a deliberate,
  separately-reviewed version bump, not implicit.

## Step 1 — clone this branch and install as normal

```sh
git clone <repo-url>
cd Flight-training-
git checkout feature/ios-portable-backup
npm ci
```

Confirm the existing desktop baseline still passes on your machine before
touching iOS at all — this establishes your own known-good baseline
independent of what CI reports:

```sh
npm run typecheck
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
```

If any of these fail on a clean checkout of this branch, stop and report
it rather than proceeding into iOS-specific steps — it means something
regressed between this document being written and you reading it, and
iOS work should not be layered on top of an already-broken baseline.

## Step 2 — add the iOS Rust targets

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

(`x86_64-apple-ios` is only needed if you expect to run the Simulator on
an Intel Mac or need Rosetta-independent x86_64 Simulator builds; on
Apple Silicon, `aarch64-apple-ios-sim` covers the Simulator.)

## Step 3 — initialize the Tauri iOS target

```sh
npx tauri ios init
```

This generates `src-tauri/gen/apple/` — an Xcode project — which does not
exist on this branch today and should **not** be hand-authored; this
command is the only correct way to produce it. Expect to be prompted for
or need to configure:

- A bundle identifier. This repo's existing desktop `identifier` in
  `src-tauri/tauri.conf.json` is `com.herflightdeck.app` — decide whether
  iOS reuses this exact identifier (recommended, for a coherent App
  Store/TestFlight presence under one Apple Developer account) or a
  suffixed variant (`com.herflightdeck.app.ios`), and update
  `src-tauri/tauri.ios.conf.json` (added on this branch, see Step 4)
  accordingly if you choose a variant.
- A development team, once you have one configured in Xcode.

## Step 4 — review the iOS-specific config already prepared on this branch

`src-tauri/tauri.ios.conf.json` was added in Milestone 1 as a documented,
**unverified** starting point for `tauri ios init` to build on — a
platform-override file per Tauri 2's config-merging convention, additive
to `tauri.conf.json` and inert for desktop builds. It sets
`bundle.iOS.minimumSystemVersion` to `16.0`, chosen only as a reasonable
starting point (recent enough that Quick Look and Files-integration APIs
are uniformly available, without being so recent it excludes commonly-used
devices) — reconsider this against actual analytics or the developer's own
target devices once that's a real decision to make, rather than treating
`16.0` as settled. Review its contents against whatever `tauri ios init`
actually generates or expects; treat values in it as a proposal, not a
settled decision, since nothing in it has been checked against a real
Xcode project.

## Step 5 — first build, Simulator only

```sh
npx tauri ios dev
```

This is the first point in the whole plan where any claim about "does this
compile for iOS" can be verified rather than inferred from crate
documentation (see `docs/ios/ARCHITECTURE.md` §2.1 for what was inferred
and needs this confirmation). Expect the first attempt to surface issues
in the plugin permission surface — `src-tauri/capabilities/default.json`
is desktop-only today (see `docs/ios/ARCHITECTURE.md` §2.3); a
`src-tauri/capabilities/mobile.json` scoped to `"platforms": ["ios"]`
needs to be written and iterated on here, against real build/run
feedback, not guessed at from this Linux environment.

Known things to check specifically, per the compatibility matrix in
`docs/ios/ARCHITECTURE.md`:

- Does `tauri-plugin-sql` actually open and migrate the database correctly
  in the iOS sandbox on first launch? (§2.1)
- Does `tauri-plugin-dialog`'s file picker present and return usable
  results for both "pick a file to import" and "choose a save location"
  call shapes already used in `src/services/backups.ts`? (§2.1, §5.1)
- Does anything using `tauri-plugin-opener` (`src/services/documents.ts`'s
  `openDocument`/`revealDocument`) crash, silently no-op, or behave
  unexpectedly, confirming or refuting the community reports cited in
  §2.1? These call sites need iOS-specific replacements regardless of the
  answer — this is about understanding the failure mode, not deciding
  whether to replace them.

## Step 6 — the credential store

Implement `KeychainCredentialStore` (the iOS side of the
`CredentialStore` trait added in `src-tauri/src/platform.rs` on this
branch — see that file's doc comments) using `keyring` 3.x's iOS Protected
Store backend. Test it explicitly against Keychain persistence across an
app **update** (not just a relaunch) on a real device or the Simulator's
equivalent, since that is the exact failure mode desktop deliberately
avoided (see `docs/ios/ARCHITECTURE.md` §4) — confirm iOS does not
reproduce it before trusting Keychain storage for this app's key.

## Step 7 — Quick Look and the share sheet

Both require a native Tauri mobile plugin (Swift). Follow Tauri 2's
"Develop a mobile plugin" guide for the current Tauri version at the time
you do this work; it is out of scope to hand-write Swift here without the
ability to compile or run it. Two plugin surfaces needed:

- A PDF preview command backed by `QLPreviewController`, replacing
  `openDocument`'s iOS behavior.
- A share-sheet command backed by `UIActivityViewController`, for
  exporting a `.hfdbackup` file.

## Step 8 — receiving files from Files/AirDrop/share

Phase 1 uses the in-app picker: in Settings, tap **Get my study material**
and choose the `.hfdbackup` file saved from the Mac. The Files “Open in”
entry is deferred because it needs a deep-link plugin. The selected file is
copied into app-owned `.incoming` storage before it is checked and previewed.

## Step 9 — restore on next launch

The restore applies on the next cold launch via `handle_startup_restore`.
After confirmation, the phone UI stages the checked copy, explains that
Her Flight Deck will close, and exits the app. Open it again to use the
material. Simulator and device verification of this flow is still required.

## Step 10 — device testing, signing, TestFlight

See `docs/ios/TESTFLIGHT.md`.

## Reporting back

Whichever of these steps you complete, update
`docs/ios/CONTINUATION.md` with: which step you reached, the exact
commands run, their actual output (especially failures), and what's next
— the same discipline this milestone's own report followed. Do not mark a
step "done" in `docs/ios/CHECKLIST.md` without it having actually run
successfully on this Mac session; a checklist item checked off from
inference rather than a real run defeats the purpose of the checklist.
