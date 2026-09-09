# iOS portable backup — implementation checklist

_Updated as work lands. A checked item means it actually ran/compiled/
passed in the environment doing the work, not that it was designed or
planned. See `docs/ios/CONTINUATION.md` for the narrative behind each
entry._

## Milestone 1 — Audit, interfaces, format spec, threat model

- [x] Repository audit: branch, working tree, version, test commands
      confirmed (`main` @ `2dbf6df`, app version `0.5.1`, clean tree).
- [x] Compatibility matrix — Rust crates, npm packages, Tauri plugins,
      capabilities surface (`docs/ios/ARCHITECTURE.md` §2).
- [x] Discovered and documented: a complete portable backup format
      (`.hfdbackup`, format_version 1) already ships on desktop — this
      was not previously written up as a spec (`docs/backup-format.md`).
- [x] Discovered and documented: desktop deliberately avoids the OS
      keychain for a reason that does not apply to iOS
      (`docs/ios/ARCHITECTURE.md` §4).
- [x] Threat model and restoration strategy (`docs/ios/THREAT_MODEL.md`).
- [x] Platform abstraction interfaces: `CredentialStore`, `PlatformInfo`
      traits added (`src-tauri/src/platform.rs`), desktop implementation
      wired and unit-tested, iOS implementation explicitly deferred.
- [x] `src-tauri/tauri.ios.conf.json` added as an unverified starting
      point for `tauri ios init` (Tauri 2 platform-override convention).
- [ ] `src-tauri/capabilities/mobile.json` — **not written**; needs a real
      `gen/apple/` project to iterate against (see
      `docs/ios/SETUP.md` Step 5). Writing one blind risks granting or
      omitting permissions incorrectly with no way to check here.

## Milestone 2 — Desktop export/restore hardening

**Already substantially complete on `main` before this branch existed** —
see `docs/backup-format.md` and `docs/ios/THREAT_MODEL.md` for the full
audit of what's already implemented and tested:

- [x] Safe, atomic export (`write_complete_backup`) — already shipped.
- [x] Safe, atomic, rollback-on-failure Replace restore
      (`stage_complete_restore_in` + `apply_pending_restore_in`) —
      already shipped.
- [x] Round-trip and hostile-archive tests — already present in
      `src-tauri/src/backup.rs`'s test module (path traversal, damaged
      database, WAL-carrying, size limits).
- [x] Settings UI with export/restore flow and macOS-specific guidance —
      already shipped (`src/pages/Settings/Settings.tsx`,
      `STATUS.md`'s "macOS attachments and macOS Settings guidance"
      entry).
- [x] Confirmed this milestone's own changes did not regress any of the
      above: full desktop test suite re-run on this branch (see
      `docs/ios/CONTINUATION.md` for the exact commands and results).
- [ ] Per-file checksum manifest (`formatVersion` 2) — **deliberately not
      built**; documented as a tracked future addition in
      `docs/backup-format.md`, not needed to satisfy this milestone's
      Replace-only scope.

## Milestone 3 — iOS target, native surfaces

**Blocked on macOS + Xcode, unavailable in this environment. Nothing in
this section has been attempted.**

- [ ] `tauri ios init` run, `gen/apple/` reviewed into version control.
- [ ] First `tauri ios dev` build reaching the Simulator.
- [ ] `tauri-plugin-sql`, `tauri-plugin-dialog`, `tauri-plugin-fs`
      confirmed working on iOS by actually running the app, not inferred
      from documentation.
- [ ] `mobile.json` capabilities file written and iterated against real
      build feedback.
- [ ] iOS import flow copies a picked/received `.hfdbackup` into app-owned
      storage before any restore command touches it (per
      `docs/ios/ARCHITECTURE.md` §5.1).
- [ ] Receiving `.hfdbackup` opened from Files/AirDrop/a share action
      (`Info.plist` document-type declaration + open-URL handling).
- [ ] `KeychainCredentialStore` implemented and verified to persist across
      an app **update**, not just a relaunch, on-device.
- [ ] Quick Look PDF preview plugin (native Swift).
- [ ] Share-sheet export plugin (native Swift).
- [ ] Restore-on-launch replacing desktop's restart-on-demand (per
      `docs/ios/ARCHITECTURE.md` §7).

## Milestone 4 — iPhone/iPad UI, large-PDF testing, CI, release docs

**Blocked on Milestone 3. Nothing in this section has been attempted.**

- [ ] iPad-friendly layout pass.
- [ ] Compact iPhone layout pass; hover/right-click/fixed-width-panel
      audit and replacement with touch-appropriate patterns.
- [ ] Dynamic Type, safe area, and touch-target audit.
- [ ] Large-PDF splitting exercised on-device with Xcode Instruments
      memory profiling, per `docs/ios/ARCHITECTURE.md` §6 — **decide
      whether `lopdf`'s whole-document-in-memory load is actually a
      problem before building a streaming replacement**; do not
      pre-emptively rewrite working code against an unmeasured risk.
- [ ] Merge-mode restore — **only if it can be built to the same standard
      as Replace** (transactional, tested rollback, documented conflict
      rule, content-hash dedup via a `formatVersion` 2 manifest). If not
      achievable within scope, Merge stays absent from the UI — never
      exposed half-finished.
- [ ] iOS compile-check added to CI (no signing required for a
      build-only check) — see `docs/ios/SETUP.md` for what such a CI job
      would need (a macOS runner; GitHub Actions' `macos-*` runners
      support this, unlike this development environment).
- [ ] TestFlight steps in `docs/ios/TESTFLIGHT.md` actually executed and
      the checklist there updated to reflect real results.

## Never do (from the task brief, restated here for visibility)

- Do not expose a Merge button before it is fully, safely implemented.
- Do not claim the iOS app works before it has compiled and run on a
  Simulator or device.
- Do not claim App Store/TestFlight readiness before signing,
  entitlements, privacy manifest, archive validation, and TestFlight
  installation have all actually happened.
- Do not merge this branch into `main` until reviewed and all checks
  available in the working environment pass.
- Do not rewrite shared git history, move release tags, publish a
  release, or alter signing credentials.
