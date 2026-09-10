# iOS architecture and compatibility audit

_Milestone 1 deliverable, updated during the 2026-09-09 release audit. The
desktop app is version `0.5.1`. This Windows machine has no Xcode or Apple
Developer tooling, so nothing in this document that requires a Mac has been
executed — it is marked as such throughout. See `docs/ios/SETUP.md` for exactly
what a Mac session needs to run next._

## 1. What already exists that this project can build on

Before assuming a green-field iOS build, three things already true of this
codebase change the shape of the work substantially:

1. **A complete, tested, atomic portable-backup format already ships.**
   `src-tauri/src/backup.rs` (54 KB, ~1,450 lines, extensive test coverage
   including hostile-archive, damaged-database, and WAL-carrying cases) is
   the "Portable backup format" and most of "Import and restore behavior"
   this task asked for — already built for desktop. New archives use
   `format_version` 2 with per-file SHA-256 integrity records, and version 1
   archives remain readable. See `docs/backup-format.md` for the full
   specification. iOS work does not need to design this format; it needs to
   **read and write** it compatibly.
2. **The frontend already runs on two SQLite backends behind one interface.**
   `src/data/index.ts` picks `tauriDb.ts` (real SQLite via
   `tauri-plugin-sql`) or `sqlJsDb.ts` (an in-browser WASM fallback) purely
   by feature-detecting `window.__TAURI_INTERNALS__` — which is `true`
   inside **any** Tauri runtime, iOS included. Every repository, every page,
   every piece of business logic in `src/logic/`, `src/domain/`, and
   `src/data/repositories/` is already platform-neutral TypeScript that
   does not know or care whether it is running on macOS, Windows, or (once
   the iOS target exists) iOS.
3. **The app already avoids the OS keychain on desktop, on purpose, with a
   documented reason that does not apply to iOS.** See §4.

The consequence: this is not "port a desktop app to iOS." It is "add an
iOS target to an app whose business logic is already platform-neutral, and
build the handful of genuinely native surfaces — file import/export,
credential storage, PDF preview, sharing — behind clean interfaces." That
is a materially smaller job than the task brief's architecture section
assumes going in, and this document adjusts the plan accordingly rather
than inventing shared-layer work that already exists.

## 2. Compatibility matrix

### 2.1 Rust crates (`src-tauri/Cargo.toml`)

| Crate | Used for | iOS compatibility | Notes |
|---|---|---|---|
| `tauri` 2 | App runtime | **Yes** | Tauri 2's whole premise is desktop + iOS + Android from one core. |
| `tauri-plugin-sql` (sqlite feature) | Database | **Yes** | Cross-platform per Tauri's own plugin docs; SQLite is compiled in, no system library dependency. **Not yet verified on-device by this project** — first real check belongs in Milestone 3 on a Mac. |
| `tauri-plugin-dialog` | Save/open dialogs, backup export/import file pickers | **Yes, with different UX** | iOS surfaces this as the `UIDocumentPickerViewController` / Files picker, not a save panel. The command surface (`open()`, `save()`) is the same API; the picker `.hfdbackup` file the user gets back is **not guaranteed persistently accessible** past the call — see §5.1. |
| `tauri-plugin-fs` | Reading/writing app-owned files | **Yes, with security-scoped resource handling** | iOS requires `startAccessingSecurityScopedResource()` around any read of a file returned by the document picker; the plugin documents that it does this automatically for URLs it hands out, but a file picked via `tauri-plugin-dialog` and then read by direct path (as `documents.rs` does today, via `app.path()` + a plain `std::fs::read`) needs its own care — see §5.1. |
| `tauri-plugin-opener` | Open a PDF in the OS default viewer; reveal a file in Finder/Explorer | **Uncertain / known issues on iOS** | No "default PDF app" and no Finder-equivalent concept exists on iOS. Community reports describe failures opening URLs on iOS with recent `tauri-plugin-opener` versions. **This plugin's two current call sites (`openPath`, `revealItemInDir` in `src/services/documents.ts`) must be replaced on iOS**, not merely retried — see §5.3 (Quick Look) and §5.4 (no reveal-in-Finder equivalent). |
| `keyring` 3.6 | **Currently**: one-time migration of a pre-0.3.0 macOS keychain entry into the plain-file store (`gemini.rs`, `LEGACY_SERVICE`/`LEGACY_ACCOUNT`) — not the live credential store | **Yes, differently** | `keyring` 3.x's iOS backend is the **Protected Store**, not the Keychain Store the macOS backend uses — different API surface, same crate. Already a dependency, so no new crate is needed for §4's iOS `CredentialStore` implementation, but the iOS code path is new and unverified until it runs on-device. |
| `reqwest` (rustls-tls, no native-tls) | Gemini API calls | **Yes** | Pure-Rust TLS (`rustls`), no OpenSSL to cross-compile or link against for iOS — this was already the right choice for desktop portability and pays off again here. |
| `lopdf` | PDF parsing/splitting | **Yes, compiles** | Pure Rust, no C dependencies found in its dependency tree. **Memory behavior is the open question, not compilation** — see §6. |
| `zip` 2.4.2 (`deflate` feature only, `default-features = false`) | Backup archive read/write | **Yes** | `deflate` (not `deflate-zlib`) resolves to `flate2` with the pure-Rust `miniz_oxide` backend (confirmed in `Cargo.lock`: `miniz_oxide` present, no `zlib`/`libz-sys`/`cc` entries driven by `zip`). No C toolchain dependency to cross-compile for iOS. |
| `base64`, `serde`, `serde_json`, `tokio` (time feature only) | Encoding, serialization, retry backoff timers | **Yes** | Pure Rust, platform-neutral. |

**Net finding**: nothing in the current Rust dependency tree is a known
iOS blocker. The dependency choices already made for desktop portability
(rustls over native-tls, pure-Rust zip/deflate, no C FFI) turn out to also
be the right choices for iOS — this was not designed for iOS, but it was
designed cautiously enough that iOS mostly falls out of it. The actual
risks are all in plugin *behavior* (opener) and *native surfaces this app
has never needed before* (Keychain, Quick Look, share sheet), not in
whether the crate graph compiles.

### 2.2 npm dependencies (`package.json`)

All frontend dependencies (`react`, `react-dom`, `react-router-dom`,
`@tauri-apps/api`, `@tauri-apps/plugin-*`, `sql.js`) are either pure
JS/TypeScript or already Tauri's own cross-platform JS bindings. No
frontend dependency is desktop-only. `sql.js` (the WASM fallback) is not
used inside any Tauri runtime, desktop or iOS, so it is irrelevant to the
iOS build either way.

### 2.3 Tauri plugin permission surface (`src-tauri/capabilities/default.json`)

The current single capabilities file grants `dialog:*`, `opener:*`,
`sql:*`, and one scoped `opener:allow-open-url` for
`https://aistudio.google.com/**`, to window `"main"`. Tauri 2's convention
for a multi-platform app is to split capabilities by target
(`"platforms": ["ios", "android"]` vs. desktop-only entries) rather than
share one file unconditionally — some permissions here (`dialog:allow-open`
used for choosing a backup file to restore) are wanted on both; others
(anything implying `opener:allow-reveal-item-in-dir`) have no iOS meaning
and should not be requested there. This needs a Mac-verified
`src-tauri/capabilities/mobile.json` once the iOS target exists (§8) — not
written here, because an unverified capabilities file that silently grants
or silently fails to grant a permission is worse than none.

### 2.4 Application code

| Area | File(s) | Platform-neutral today? |
|---|---|---|
| Repositories, domain logic, validation | `src/data/repositories/*`, `src/domain/*`, `src/logic/*` | **Yes**, entirely. Zero changes anticipated for iOS. |
| Database driver selection | `src/data/index.ts` | **Yes** — already dispatches on Tauri presence, not desktop-vs-not. |
| App data root resolution | `src-tauri/src/storage.rs` | **Yes** — uses `app.path().app_config_dir()`, Tauri's own cross-platform path resolver. Already the *right* abstraction; no change needed. |
| Document storage (import/delete/exists) | `src-tauri/src/documents.rs`, `src/services/documents.ts` | **Mostly** — storage itself is platform-neutral; `openDocument`/`revealDocument` in the TS service call `tauri-plugin-opener`, which is the iOS gap (§5.3–5.4). |
| PDF splitting | `src-tauri/src/pdf.rs` | **Compiles**, memory profile unverified on iOS (§6). |
| Backup/restore | `src-tauri/src/backup.rs`, `src/services/backups.ts` | **Format is portable already** (§1.1); the *file-picker and relaunch* mechanics used to reach it are desktop-shaped (§5.1, §7). |
| Credentials | `src-tauri/src/secrets.rs`, `src-tauri/src/gemini.rs` | **Deliberately not using OS keychain on desktop** (§4) — iOS needs its own implementation, not a reuse of desktop's. |
| Settings UI, macOS-specific guidance copy | `src/pages/Settings/Settings.tsx` | Desktop-specific copy exists (per `STATUS.md`, every section already carries macOS notes); an iOS-specific copy block is new UI work, not a port. |

## 3. Platform abstraction interfaces

Milestone 1 defines these as trait boundaries; only the desktop
implementations are wired up and tested today (they are the *existing*
behavior, adapted into the interface, not rewritten). iOS implementations
are stubs or absent until a Mac session can build and run them — see
`src-tauri/src/platform.rs`, added in this milestone.

```rust
/// Where Gemini's API key lives. Desktop: a plain file (see §4 for why).
/// iOS: the Keychain Protected Store, via `keyring` 3.x's iOS backend.
pub trait CredentialStore {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, key: &str) -> Result<(), String>;
    fn forget(&self) -> Result<(), String>;
}

/// Platform identification for UI copy and capability gating.
pub trait PlatformInfo {
    fn name(&self) -> &'static str; // "macos" | "windows" | "linux" | "ios"
    fn is_mobile(&self) -> bool;
}
```

Deliberately **not** yet expressed as Rust traits in this milestone,
because a trait with only a hypothetical implementation is speculation
dressed as architecture:

- **File import/export** — desktop already uses `tauri-plugin-dialog` +
  `tauri-plugin-fs` directly from TypeScript; iOS needs the same plugins
  but with sandbox-safe copy-on-import (§5.1) added at the TypeScript
  service layer (`src/services/documents.ts`, `src/services/backups.ts`),
  not a new Rust trait. The abstraction already lives at the right layer
  (`isTauri()` / plugin calls), it just needs an iOS-aware implementation
  behind it.
- **PDF preview** — no desktop equivalent to adapt; iOS needs a Quick Look
  integration that is native Swift/Tauri-mobile-plugin work with no Rust
  trait to speak of until that plugin exists (§5.3).
- **Sharing** — same: iOS's `UIActivityViewController` share sheet has no
  desktop analogue to generalize from.

## 4. Credentials: why desktop deliberately avoids the OS keychain, and why iOS should not

`src-tauri/src/secrets.rs` stores the Gemini key as a plain file
(`gemini-key`) inside the app's private data directory, with a code comment
explaining exactly why:

> On macOS a keychain item is bound to the code signature of the
> application that saved it, and this application is not signed with a
> stable identity — so every new version is a different application as far
> as the keychain is concerned. Her key became unreadable after each
> update and she had to paste it again.

This is a correct, deliberate decision for an **unsigned, personally-built
desktop app** distributed outside the App Store. `gemini.rs` still depends
on `keyring` 3.6 for a one-time best-effort migration of any key left in
the old keychain-based store from before this change (`LEGACY_SERVICE` /
`LEGACY_ACCOUNT`), but no live code path writes to the keychain anymore.

**This reasoning does not transfer to iOS.** Every iOS build — a
development build, a TestFlight build, an App Store build — is signed with
a consistent bundle identifier and, for TestFlight/App Store, a consistent
team-issued provisioning identity. iOS Keychain items are scoped to the
app's bundle identifier (and optionally shared via a Keychain Access Group
across an app family), and they survive app updates precisely because the
signing identity *is* stable in a way the desktop app's is not. A
Keychain-backed `CredentialStore` for iOS is not fighting the same problem
desktop was solving around; it is the platform-idiomatic answer with none
of desktop's downside. Storing the key as a plain file inside the iOS app
sandbox would work too (the sandbox is itself the protection boundary) but
would be a strictly weaker choice than Keychain for no benefit, since iOS
Keychain access requires no extra dependency (see §2.1 — `keyring` is
already vendored) and is what App Store review expects for credential
material.

**Decision for this milestone**: keep `secrets.rs` and its plain-file
behavior completely unchanged for desktop (zero regression risk — this
document changes no desktop-facing behavior). Add the `CredentialStore`
trait (§3) with a `FileCredentialStore` desktop implementation that
delegates to the existing `secrets::{load_key, save_key, forget_key}`
functions unmodified. An iOS `KeychainCredentialStore` implementation using
`keyring`'s iOS Protected Store backend is Milestone 3 work, gated behind
`#[cfg(target_os = "ios")]`, and cannot be written with any confidence
until it can be built and exercised on a Mac with the iOS SDK — a
credential-storage bug is exactly the kind of thing that must not ship
unverified.

## 5. Native surfaces with no desktop equivalent

### 5.1 Import must copy into app-owned storage, never depend on the picked location

iOS's `tauri-plugin-dialog` file picker (backing `chooseCompleteBackup()`
in `src/services/backups.ts` today) can return a security-scoped URL to a
file that lives in iCloud Drive, another app's document provider, or a
location the app has only momentary access to. The task brief's constraint
— "The app must never depend on permanent access to the original location
selected in Files" — is not a preference, it is how iOS actually behaves:
that access can be revoked as soon as the picker's scope ends. The fix is
mechanical and already implied by how this app treats **every** import
today (`documents.rs` already copies an imported study material into
`documents/` rather than referencing wherever the user keeps it — see its
own module doc comment: *"Study materials are copied into the application's
own data directory rather than being referenced where the user happens to
keep them"*). The same discipline needs to apply to an imported
`.hfdbackup` file itself: copy it into a temporary app-owned location
immediately after the picker returns, before `inspect_complete_backup`
or `stage_complete_restore` ever look at it, so the whole restore pipeline
operates on app-owned bytes from the first read. This is a small,
mechanical addition to the TypeScript restore flow once the iOS target
exists — no format or Rust-side restore-logic change, since
`stage_complete_restore_in` already takes a plain path and does not care
where it came from.

### 5.2 Receiving a file opened from Files/AirDrop/a share action

This requires iOS-side configuration (`Info.plist` `CFBundleDocumentTypes`
/ `UTExportedTypeDeclarations` declaring `.hfdbackup` as an app-openable
document type, plus an `NSExtension`/URL-handling entry point) that only
exists once `tauri ios init` has generated an Xcode project (§8) — there is
nothing to configure yet. Documented here as a required step for Milestone
3/4, not implemented.

### 5.3 PDF preview

`tauri-plugin-opener`'s `openPath` (used today for "open this study
material") has no iOS-appropriate behavior — there is no default external
PDF viewer app to hand off to the way Preview.app or a Windows file
association exists. The task brief correctly names Quick Look
(`QLPreviewController`) as the iOS-appropriate replacement. This is native
Swift work inside a Tauri mobile plugin — not something achievable from the
Rust/TypeScript layers alone — and is scoped to Milestone 3, blocked on
having a buildable Xcode project to add the plugin to.

### 5.4 "Reveal in Finder/Explorer" has no iOS meaning

`revealItemInDir` (used for the desktop-only affordance of exposing a
missing-file's expected location) should simply not be offered on iOS; the
Settings and Study Library UI need an `isMobile` check (from
`PlatformInfo`, §3) to hide it rather than surface a call that cannot
succeed.

### 5.5 Sharing / exporting a backup

Desktop's `chooseCompleteBackupDestination()` uses a save panel. iOS's
equivalent for "here is a file, do something with it" is the
`UIActivityViewController` share sheet (AirDrop, Files, Mail, Messages,
etc. all live behind one sheet), which is again native-plugin territory,
scoped to Milestone 3/4.

## 6. Large-PDF handling: reviewed, not yet changed

`pdf.rs`'s automatic splitter (`split_pdf_automatically`) already does two
of the four things the task brief asks for: it **measures actual output
size** rather than assuming a page count maps linearly to bytes
(`largest_fitting_last_page` writes a candidate range, reads the real file
size back, and grows or shrinks the range to fit — this is not a fixed
page-count heuristic), and it **cleans up every partial output** on any
failure (`created_paths` is tracked and removed as a unit if the closure
returns `Err`). It also already gives each part its own document record
with a preserved page range (`PdfPart { relative_path, original_file_name,
file_size, first_page, last_page }`), which is what lets each part carry
its own generated study guide downstream.

What it does **not** do, and what remains an open risk specifically for
iOS: `open_pdf` calls `lopdf::Document::load(path)`, which parses the
**entire source PDF** into an in-memory object graph once, up front, before
any splitting happens — not a streaming read. For a large FAA handbook
(hundreds of pages, tens of megabytes) this is unlikely to be a problem on
a desktop machine; it has not been measured against iOS's materially
tighter and more aggressively enforced memory limits (an iOS app can be
jetsam-killed for memory pressure in ways a desktop process usually is
not). This is flagged, not fixed, in this milestone, for two reasons: (1)
it cannot be meaningfully tested without an iOS device or simulator to
observe actual memory behavior against, and (2) `lopdf`'s API is
load-the-whole-document by design — working around that would mean either
a different PDF library or hand-rolled incremental xref parsing, either of
which is a large, independently testable change that should not ride along
with first getting *anything* running on iOS. Recommendation for Milestone 4:
measure first (open representative large handbooks on-device, watch memory
via Xcode Instruments), then decide whether it is actually a problem before
building a streaming replacement for code that already works correctly on
desktop.

## 7. Restore-on-relaunch: the one desktop mechanism iOS cannot reuse

Desktop's restore-apply step deliberately runs in `lib.rs`'s `setup()`
hook, before `tauri-plugin-sql` opens the database, and gets there by
having the frontend call `restart_for_restore()` → `app.request_restart()`
after staging succeeds. iOS apps cannot self-initiate a full process
relaunch the way a desktop process can respawn itself. The existing
`backup_if_upgraded` mechanism (checks a `last-run-version.txt` file
against the running app's version, every cold start, before migrations
run) already demonstrates the pattern iOS should reuse instead: check for
a `.restore-pending/` directory unconditionally in `setup()` on **every**
cold launch, not only after an explicit restart request. The staged
restore is applied automatically the next time the app is opened — no
explicit relaunch call needed, no `restart_for_restore` command on iOS.
This requires no change to `apply_pending_restore_in` itself (it already
takes a plain root path and has no restart-specific logic inside it) —
only to how it is invoked and to the frontend flow that currently prompts
"Restart now to finish restoring" (which becomes "Close and reopen the
app" on iOS, since there is no programmatic restart to offer).

## 8. What actually requires a Mac, and could not be attempted here

- `tauri ios init` — generates `src-tauri/gen/apple/`, an Xcode project.
  Requires Xcode and is not something to hand-author; a fabricated Xcode
  project would be worse than no project. **Not attempted.**
- Any `cargo build --target aarch64-apple-ios` / `x86_64-apple-ios-sim` —
  requires the iOS SDK, which ships with Xcode and is not installable on
  Linux. **Not attempted.**
- Running the app on an iOS Simulator or device, in any form. **Not
  attempted, and no claim in this document should be read as one.**
- Verifying `tauri-plugin-sql`, `tauri-plugin-dialog`, and
  `tauri-plugin-fs` actually behave as their documentation describes on
  iOS specifically (§2.1's "Yes" entries are based on the plugins'
  published cross-platform support, not on-device confirmation).
- Verifying `keyring`'s iOS Protected Store backend against a real
  Keychain on a real signed build.
- Xcode signing, entitlements, a privacy manifest
  (`PrivacyInfo.xcprivacy`), and TestFlight upload — see
  `docs/ios/TESTFLIGHT.md` for the documented (not executed) sequence.

See `docs/ios/SETUP.md` for the exact commands a Mac session should run,
in order, to pick this work up.
