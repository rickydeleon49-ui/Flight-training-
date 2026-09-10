# Continuation note — Milestone 1

_Session date: 9 September 2026. Environment: Linux, no Xcode, no macOS,
no Apple Developer tooling. Branch: `feature/ios-portable-backup`, created
from `main` @ `2dbf6df` (app version `0.5.1`)._

## What was found before any code was written

The repository audit turned up two things that changed the shape of this
milestone from what the task brief assumed going in:

1. **A complete, tested, atomic portable backup format already ships on
   desktop** — `src-tauri/src/backup.rs`, `.hfdbackup`, ZIP-based,
   `format_version` 1, with path-traversal protection, hostile-archive
   rejection, staged/atomic/rollback-on-failure Replace restore, and an
   existing Settings UI with macOS-specific guidance (per `STATUS.md`'s "7
   September 2026" entries and `AUDIT.md`). This was not previously written
   up as a specification — `docs/backup-format.md` is that write-up, not a
   new design.
2. **Desktop deliberately does not use the OS keychain**, for a documented,
   correct reason (`secrets.rs`'s module comment: unsigned builds break
   keychain persistence across updates) that does **not** apply to iOS,
   where every build is signed with a stable identity. This is why the
   `CredentialStore` abstraction (§4 of `docs/ios/ARCHITECTURE.md`)
   exists as a genuine platform split rather than "reuse desktop's
   approach."

This meant the actual gap between "what exists" and "what the task brief
asks for" is narrower than a green-field read of the brief would suggest —
Milestone 2's "safe desktop export, safe replace restore, round-trip
tests, settings interface and Mac guidance" is already done. The
milestone report below reflects that: most of the net-new work in this
session is documentation of what's real, plus the interface layer iOS
specifically needs and desktop does not yet have.

## Commands run, in order, with real results

```
git fetch origin main
git checkout -b main origin/main            # (after briefly landing on a stale branch by mistake)
git log --oneline origin/main -25           # confirmed main is at 2dbf6df, well ahead of the branch this session started on
find . -maxdepth 2 ...                      # repo layout
cat src-tauri/Cargo.toml                    # dependency audit
grep -n "^pub \|..." src-tauri/src/backup.rs # backup.rs structure
sed -n '...' src-tauri/src/backup.rs         # read backup.rs in full (~1450 lines)
sed -n '...' src-tauri/src/secrets.rs        # confirmed plain-file credential storage, and why
sed -n '...' src-tauri/src/pdf.rs            # confirmed lopdf loads whole source PDF into memory; confirmed size-based (not page-count) part fitting already exists
grep -n "CREATE TABLE" src-tauri/migrations/*.sql   # schema table inventory for backup-format.md
grep -n "checkpoint" src/data/repositories/appRepository.ts  # confirmed PRAGMA wal_checkpoint(TRUNCATE), abort-on-busy, before every export
curl ... docs.rs, crates.io                  # FAILED — 403 from the outbound proxy; raw curl to arbitrary hosts is not permitted from this sandbox
WebSearch "Tauri 2 mobile plugin-sql iOS support"              # succeeded — cross-platform, no iOS-specific caveat found
WebSearch "keyring-rs crate iOS keychain support version 3"     # succeeded — iOS uses the Protected Store backend, distinct from macOS's Keychain Store, same crate
WebSearch "Tauri 2 plugin-dialog plugin-fs plugin-opener iOS mobile support"  # succeeded — dialog and fs have explicit iOS support; opener has reported iOS issues
WebSearch "Tauri 2 tauri.conf.json bundle iOS minimumSystemVersion ..."       # succeeded — confirmed bundle.iOS.minimumSystemVersion and tauri.ios.conf.json merge convention

git checkout -b feature/ios-portable-backup

# writing docs/backup-format.md, docs/ios/ARCHITECTURE.md,
# docs/ios/THREAT_MODEL.md, docs/ios/SETUP.md, docs/ios/TESTFLIGHT.md,
# docs/ios/CHECKLIST.md, this file — no build/test impact, docs only

# src-tauri/src/platform.rs added; mod platform; added to lib.rs

cd src-tauri && cargo fmt --check           # PASSED, clean, first try
cargo clippy --all-targets -- -D warnings   # FAILED first attempt: 6 dead_code errors
                                             # (trait/struct/fn never used outside #[cfg(test)],
                                             #  and dead_code analysis doesn't count test-only usage
                                             #  for the normal build)
# fix: added `#![allow(dead_code)]` at the top of platform.rs with a comment
# explaining why (scaffolding not yet wired into any command)
cargo clippy --all-targets -- -D warnings   # PASSED after the fix
cargo test                                  # PASSED — 58 tests (55 pre-existing + 3 new in platform::tests)

cd ..
npm run typecheck                           # FAILED — @testing-library/react not installed;
                                             # this session's earlier `npm ci` had run against a
                                             # DIFFERENT, stale branch's package.json (pre-0.5.1)
                                             # before `main` was checked out — not caused by this
                                             # milestone's own changes
npm ci                                      # re-run against main's actual package.json/lock
npm run typecheck                           # PASSED, clean
npm test                                    # PASSED — 313 tests across 36 files
npm run build                               # PASSED — production bundle built
```

`npm ci` also reported "2 moderate severity vulnerabilities" via `npm
audit` — pre-existing on `main`, not investigated or acted on in this
session (out of scope for an iOS-architecture milestone; flagging here for
whoever picks up dependency maintenance, not treating it as this
milestone's responsibility).

## Decisions made, and why

- **Kept the `.hfdbackup` extension** rather than introducing `.hfbackup`
  as the task brief's example suggested — a format that already exists
  and already has that extension in shipped desktop builds should not
  gain a second name; that would only create ambiguity about which
  extension a given build understands. See `docs/backup-format.md`'s
  opening section.
- **Did not restructure the archive's internal layout** (no separate
  `files/documents/` vs `files/pdf-parts/` split as the brief's example
  sketched) — split PDF parts are already ordinary `study_materials` rows
  with their own file in the existing flat `documents/` tree, and their
  "part of" relationship is a database column, not a file-tree location.
  Reorganizing the tree to match the brief's example literally would be a
  breaking, purely cosmetic change to an already-working, already-tested
  format for no functional gain.
- **Added `#![allow(dead_code)]` rather than wiring `platform.rs` into a
  real command** — wiring it in (e.g., adding a `platform_name` Tauri
  command) would have been easy, but it's speculative surface area added
  to a shipped app's command list for a feature (iOS) that cannot yet
  consume it, and it would need its own frontend test coverage to justify
  existing at all. Keeping the module honestly unwired, with a clear
  comment saying so, was judged more honest than dressing it up as
  "integrated."
- **Did not write `src-tauri/capabilities/mobile.json`** — a capabilities
  file is only meaningfully correct once tested against a real build
  requesting real permissions; writing one from documentation alone risks
  either over-granting or under-granting in ways nothing in this
  environment could catch. `docs/ios/CHECKLIST.md` and `docs/ios/SETUP.md`
  both flag this explicitly as the first thing to do once `gen/apple/`
  exists, rather than silently skipping it.
- **Did not touch `pdf.rs`'s memory behavior** — flagged as a real,
  specific risk (`lopdf::Document::load` parses the whole source PDF) in
  `docs/ios/ARCHITECTURE.md` §6, but changing working, tested,
  already-shipped splitting logic without any way to measure whether the
  change is even necessary (no iOS device/simulator here) was judged
  higher-risk than leaving it and recommending on-device measurement
  first in Milestone 4.
- **Did not attempt `tauri ios init`, `rustup target add
  aarch64-apple-ios`, or any iOS-target Rust compilation** — these require
  the iOS SDK, which requires Xcode, which requires macOS. Not available
  on this Linux machine. `rustup target add aarch64-apple-ios` specifically
  was not even attempted, since it would install an unusable target
  without an SDK to compile against and add nothing verifiable.

## What is genuinely new and real from this session

- `docs/backup-format.md` — the first written specification of the
  existing `.hfdbackup` format.
- `docs/ios/ARCHITECTURE.md` — compatibility matrix (verified against
  `Cargo.lock`, `Cargo.toml`, and web-searched plugin/crate documentation,
  not guessed) and platform abstraction design.
- `docs/ios/THREAT_MODEL.md` — threats mapped to the actual mitigating
  code, with honestly-stated gaps.
- `docs/ios/SETUP.md`, `docs/ios/TESTFLIGHT.md` — exact next steps for a
  Mac session, none of them executed here.
- `docs/ios/CHECKLIST.md` — milestone tracking, checked only against
  things that actually ran.
- `src-tauri/src/platform.rs` — `CredentialStore` and `PlatformInfo`
  traits, a desktop `FileCredentialStore` adapter (delegates to unchanged
  `secrets.rs` behavior), unit-tested (3 new tests), compiled clean under
  `cargo clippy -D warnings` and `cargo fmt --check`.
- `src-tauri/tauri.ios.conf.json` — a documented, unverified starting
  point for `tauri ios init`.

## What remains, and is honestly not started

Everything requiring Xcode/macOS: the iOS target itself, any on-device or
Simulator verification of any compatibility-matrix claim, Keychain
integration, Quick Look, the share sheet, receiving files from
Files/AirDrop, restore-on-launch (the desktop `restart_for_restore`
replacement), iPhone/iPad UI adaptation, large-PDF memory measurement, and
everything under Milestone 4. See `docs/ios/CHECKLIST.md` for the itemized
list and `docs/ios/SETUP.md` for the ordered sequence to run them in.

## Validation summary (this session, this machine)

| Check | Result |
|---|---|
| `cargo fmt --check` (src-tauri) | Pass |
| `cargo clippy --all-targets -- -D warnings` (src-tauri) | Pass (after one fix) |
| `cargo test` (src-tauri) | Pass — 58/58 |
| `npm run typecheck` | Pass |
| `npm test` | Pass — 313/313 across 36 files |
| `npm run build` | Pass |
| Any iOS-target build or test | **Not run — no Xcode/macOS available** |

---

# Milestone 2 — review and close-out

_Session date: 9 September 2026, continued. Branch:
`feature/ios-milestone-2-review`, from `main` @ `c1bf1d9` (Milestone 1
merged via PR #14)._

## Where Milestone 1 left off, and what this picked up

Milestone 1's audit had already found Milestone 2's core asks — safe
desktop export, safe Replace restore, round-trip tests, Settings UI, Mac
guidance — essentially complete on `main` before this work began. This
session's job was to **verify that claim rather than assume it**: check
every item in the task brief's testing-requirements list against the
actual test suite, attempt to close any real gap found, and decide
honestly what (if anything) still needed building.

## What was done

1. Re-fetched and reset to `main` (now at `c1bf1d9`, carrying Milestone
   1's merge) and started a fresh branch — Milestone 1's own branch had
   already been merged and deleted as a unit, so continuing on it was not
   an option; per-milestone branches is now the pattern going forward.
2. Went through the task brief's "Testing requirements" list item by item
   against `backup.rs`'s actual test names and bodies (not just names —
   read the bodies of `a_damaged_backup_is_refused_before_anything_of_
   hers_moves`, `an_archive_carrying_anything_unexpected_is_refused`, and
   `a_complete_backup_puts_back_the_database_and_every_document` in full).
   Confirmed manifest validation, format-version compatibility, checksum
   (SQLite-header) mismatch rejection, missing-file rejection, path
   traversal rejection, size/entry-count limits, snapshot consistency, and
   round-trip export/import all have real, passing coverage already.
3. Identified one genuine gap: no test forces a failure **between** the
   protect and install steps of `apply_pending_restore_in` (as opposed to
   before anything moves, or a fully successful install). Wrote one, using
   a Unix permission removal (matching the existing precedent in
   `secrets.rs`'s `#[cfg(unix)]` test) to force the protect step's rename
   to fail.
4. **Ran it. It failed** — not because the restore logic is wrong, but
   because this session's shell runs as `root`, which ignores Unix DAC
   permission bits entirely, so the intended fault never occurred and the
   restore actually completed instead of erroring.
5. Could not confirm the test would behave correctly on a non-root runner
   either (no such runner reachable from here), so **reverted the test**
   rather than commit something unverified — `git diff` against `main`
   after the revert is empty, confirmed before proceeding. This is
   recorded as an open, explicitly-flagged gap in
   `docs/ios/THREAT_MODEL.md` and `docs/ios/CHECKLIST.md`, not silently
   dropped.
6. Considered adding the task brief's requested Mac Settings copy
   ("explain how to export a portable backup for transfer to iPhone or
   iPad") and **decided not to**: no iOS app exists yet to receive such a
   file, so telling this app's real, current user they can send a backup
   to an iPhone app that doesn't exist would be a false claim shipped into
   production UI. Deferred to whichever milestone actually ships iOS
   import capability.

## Commands run

```
git fetch origin main
git checkout main && git reset --hard origin/main   # now at c1bf1d9
git checkout -b feature/ios-milestone-2-review

# read backup.rs test bodies in full (grep + sed -n ranges), cross-checked
# against the task brief's testing-requirements list

# wrote a_restore_that_cannot_protect_current_data_changes_nothing
cargo test backup::tests::a_restore_that_cannot_protect_current_data_changes_nothing
# FAILED: `unwrap_err()` called on `Ok(())` — chmod 0o500 had no effect
# because the process runs as root

# reverted the test (Edit tool, restoring the exact prior content)
git diff --stat            # empty — confirmed clean revert of backup.rs

cd src-tauri
cargo fmt --check           # pass
cargo test                  # pass — 58/58 (back to Milestone 1's baseline)
cd ..

# then: docs/ios/CHECKLIST.md and docs/ios/THREAT_MODEL.md updated with
# the review findings and the reverted-test note; this entry added
```

## Decision log

- **New branch per milestone, not one long-lived branch** — Milestone 1's
  branch was squash-merged and is gone; the task brief's suggested single
  branch name no longer fits once merges are happening per-milestone. This
  entry doesn't rename anything retroactively, just notes the pattern
  going forward.
- **Reverted a failing test rather than fix-and-keep** — the failure here
  is a property of *this sandbox* (root execution), not proof the test's
  approach is wrong on real CI. But since this session cannot verify the
  positive case either, keeping an unverified test would violate the same
  "don't claim what you haven't confirmed" standard this whole effort is
  held to. Flagged prominently instead of silently dropped.
- **No premature product copy** — a documentation requirement in the task
  brief ("Mac guidance for iPhone/iPad transfer") was read against what it
  would actually do if implemented literally right now (mislead a real
  user of a real shipped app), and skipped for that reason rather than
  implemented to satisfy the letter of the brief.

## Where this leaves things, and what's next

**Milestone 2 is now confirmed, not just assumed, complete** for every
part achievable without a native iOS build: export, Replace restore,
rollback-on-corruption, round-trip tests, and Settings UI all verified
against the task brief's own requirements list. The one remaining gap
(fault injection strictly between protect and install) is real but narrow,
and needs a non-root test environment to attempt safely — flagged, not
solved, here.

**Nothing in Milestone 2 needed new production code** — this session's
net contribution is verification and two documentation updates
(`CHECKLIST.md`, `THREAT_MODEL.md`), no `src/` or `src-tauri/src/` diff
against `main`.

**Next is Milestone 3**, and it is fully blocked on the same thing
Milestone 1 already flagged: no macOS, no Xcode, no iOS SDK anywhere in
this environment. Nothing in Milestone 3 (`tauri ios init`, any iOS Rust
target compilation, Keychain/Quick Look/share-sheet plugins, receiving
files from Files/AirDrop) can be attempted from here — see
`docs/ios/SETUP.md` for the exact ordered sequence a Mac session needs to
run. Until a Mac is available, further progress on this task without one
would mean either fabricating results (not acceptable) or continuing to
polish documentation that is already thorough — so the honest status to
report is: **this environment has taken the desktop/documentation side as
far as it can go, and the next real step requires a macOS machine with
Xcode.**

# Audit cleanup — 9 September 2026

The clean audit was implemented on `audit/cleanup-2026-09-09` from remote main `e23de3a`.

Completed on Windows:

- upgraded Vitest past GHSA-82fw-gwwq-j7x9;
- introduced `.hfdbackup` format version 2 with SHA-256 inventory while retaining version 1 restore;
- switched complete exports to SQLite's online backup API;
- added staged `PRAGMA quick_check`, core-schema, and future-schema validation;
- tightened archive compression ratio, path length, component length, and Windows colon checks;
- added regression tests for content tampering, wrong-schema SQLite files, WAL-aware online snapshots, hostile names, compression ratios, and legacy format compatibility;
- gated the desktop platform assertion away from future mobile test targets;
- refreshed root audit/status and backup-format documentation.

Still requires macOS/Xcode: Tauri iOS initialization, simulator/device execution, mobile capabilities, Files/AirDrop receiving, Quick Look, share sheet, Keychain, cold-launch restore, mobile layouts, Instruments, signing, and TestFlight.
